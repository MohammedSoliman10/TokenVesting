# Phase 1 — Data Model

**Feature**: Token Vesting Web App (`001-token-vesting-app`)
**Date**: 2026-10-04
**Sources**: [spec.md](./spec.md) Key Entities + FRs, [research.md](./research.md) R1–R8

---

## On-chain entities (source of truth)

### VestingSchedule (struct, stored in `VestingFactory`)

| Field | Type | Rules / validation (FR-003 + clarifications) |
|-------|------|-----------------------------------------------|
| `id` | `uint256` | Auto-increment from 1 (0 reserved as "not found") |
| `token` | `address` | Non-zero (`ZeroAddress()`) — one ERC-20 per schedule |
| `grantor` | `address` | `msg.sender` at creation; indexed (FR-004) |
| `beneficiary` | `address` | Non-zero (`ZeroAddress()`); may equal grantor; spelled `beneficiary` everywhere (FR-005) |
| `start` | `uint256` | Unix seconds. `0` sentinel ⇒ resolved to `block.timestamp` at creation; non-zero must be `>= block.timestamp` (`InvalidStart()`) |
| `cliffDuration` | `uint256` | Seconds; `cliffMonths % 3 == 0` and `<= durationMonths` (`InvalidCliff()`); cliff timestamp = `start + cliffDuration` |
| `duration` | `uint256` | Seconds; `durationMonths > 0 && durationMonths % 3 == 0` (`InvalidDuration()`); guarantees `duration / 90 days >= 1` (no division by zero) |
| `totalAmount` | `uint256` | `> 0` (`ZeroAmount()`); fully pulled from grantor at creation (FR-002) |
| `released` | `uint256` | Starts 0; monotonically non-decreasing; `released <= totalAmount` (invariant, FR-010) |

Constants: `INTERVAL = 90 days`, months are 30-day months (`MONTH = 30 days`).

**Derived values** (never stored — computed by views):
- `totalIntervals = duration / INTERVAL` (≥ 1 by construction)
- `cliffTimestamp = start + cliffDuration`
- `endTimestamp = start + duration`

**Views** (FR-011): `vestedAmount(id)`, `releasableAmount(id)`, `released(id)`
(convenience getter; also a struct field).

### State transitions (per schedule, time-driven)

```text
NOT STARTED      now < start            vested = 0, releasable = 0
CLIFF (locked)   start <= now < cliffTimestamp   vested = 0, releasable = 0   (FR-007)
VESTING          cliffTimestamp <= now < endTimestamp
                 vested = totalAmount * ((now - start) / INTERVAL) / totalIntervals
                 releasable = vested - released                              (FR-008)
FULLY VESTED     now >= endTimestamp     vested = totalAmount                (FR-009)
                 releasable = totalAmount - released
```

Terminal: `released == totalAmount` (nothing left; `release()` reverts
`NothingToRelease()`). Any wallet may call `release()`; tokens always transfer
to `beneficiary` (clarified decision 4).

### Indexes (FR-004 / research R5 — plain reads, no event indexer)

| Index | Type | Purpose |
|-------|------|---------|
| `scheduleCount()` | `uint256` | Total schedules, id upper bound |
| `beneficiarySchedules(address)` | `uint256[]` | Dashboard listing for connected wallet |
| `grantorSchedules(address)` | `uint256[]` | Grantor's created-schedule history |
| `getSchedule(id)` | struct | Full detail by id |
| `getSchedulesByBeneficiary(addr)` / `getSchedulesByGrantor(addr)` | `uint256[]` | Id lists (frontend batches `getSchedule` via multicall) |

### Events (FR-012)

```solidity
event ScheduleCreated(
    uint256 indexed id,
    address indexed grantor,
    address indexed beneficiary,
    address token,
    uint256 start,        // resolved (0 already replaced by creation timestamp)
    uint256 cliffDuration,
    uint256 duration,
    uint256 totalAmount
);
event TokensReleased(uint256 indexed id, address indexed beneficiary, uint256 amount);
```

### Custom errors (no revert strings — research R2/R3/R4)

`ZeroAddress()`, `InvalidStart()`, `InvalidDuration()`, `InvalidCliff()`,
`ZeroAmount()`, `InsufficientBalance()`, `InsufficientAllowance()`,
`FeeOnTransferRejected()`, `NothingToRelease()`, `ScheduleNotFound()`.

### TestToken (ERC-20)

| Field | Type | Rules |
|-------|------|-------|
| `name` / `symbol` / `decimals` | string/string/uint8 | ERC-20 standard (18 decimals) |
| `balances`, `allowances` | mappings | Standard ERC-20 (OpenZeppelin) |
| `owner` | `address` | `Ownable`; only owner may `mint(to, amount)` (FR-014) |
| `lastFaucetAt` | `mapping(address => uint256)` | Public `faucet()` mints a fixed 1,000 tokens (18 decimals) to `msg.sender`, once per 24h per address, else `FaucetCooldown()` (FR-014a) |

---

## Validation rules master table (single source: chain is truth)

| # | Rule | Chain check | UI (zod) mirror | Spec |
|---|------|-------------|-----------------|------|
| V1 | token ≠ 0 | `ZeroAddress()` | `z.string().address()` + non-zero | FR-003 |
| V2 | beneficiary ≠ 0 | `ZeroAddress()` | address + non-zero | FR-003 |
| V3 | start now-or-future | `start == 0 \|\| start >= block.timestamp` | `start === 0 \|\| start >= now` | Clar. 1 |
| V4 | duration multiple of interval, > 0 | `durationMonths > 0 && % 3 == 0` | same on months field | Clar. 2 |
| V5 | cliff multiple of interval, ≤ duration | `cliffMonths % 3 == 0 && <= durationMonths` | same | Clar. 2 |
| V6 | amount > 0 | `ZeroAmount()` | `.gt(0)` + ≤ wallet balance | FR-003 |
| V7 | fully funded (atomic pull) | balance/allowance pre-checks + delta check | approve → create sequencing | FR-002, Clar. 3 |
| V8 | no division by zero | structurally impossible via V4 | n/a | FR-003 |

---

## Frontend data shapes (TypeScript, generated/consumed)

- **`ScheduleView`**: id, token, grantor, beneficiary, start, cliffDuration,
  duration, totalAmount, released — plus derived client fields:
  `vested`, `releasable`, `progress` (0–1), `state`
  (`not-started | cliff | vesting | fully-vested`), `nextUnlockAt`.
  Derived in pure `lib/vesting.ts` from chain views (mirrors chain math; unit
  tested both ways).
- **`WalletSession`**: `status: disconnected | connected | wrong-network`,
  address, chainId.
- **`TxState`**: `{ type: 'approve' | 'create' | 'claim' | 'faucet', status:
  'idle' | 'pending' | 'confirmed' | 'failed', hash?, error? }` (FR-022/FR-017);
  terminal states visible until acknowledged — the "Get test tokens" faucet
  button uses this same state machine (FR-014a).
- **`CreateScheduleForm`** (react-hook-form + zod): token address, beneficiary
  address, start mode (`now ⇒ 0` | `date ⇒ unix seconds`), cliffMonths,
  durationMonths, amount (decimal string → parsed with token decimals).
- **`deployments.json`** (generated): `{ [chainId]: { VestingFactory, TestToken } }`.

## Relationships

```text
Grantor 1 ──── * VestingSchedule * ──── 1 Token
Beneficiary 1 ── * VestingSchedule
WalletSession ── connects as either role (identity = connected address)
Transaction ──── targets 1 VestingSchedule (create / claim) or Token (approve)
```
