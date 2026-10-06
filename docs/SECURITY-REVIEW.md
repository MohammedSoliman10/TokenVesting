# Security Review — Token Vesting

**Date:** 2026-10-05 · **Reviewed commit:** `0bfa08c` plus the working-tree changes
described in §2 (the `nonReentrant` guard on `createSchedule` and its tests) ·
**Scope (T064):** `src/VestingFactory.sol`, `src/TestToken.sol`, `script/Deploy.s.sol`
(plus repository/history and CI checks in §8–§9).

**Method:** a line-by-line manual checklist against the spec (§1), an adversarial
re-entrancy test written before the fix (§2), static analysis with slither (§3),
contract-size and gas measurement (§4–§5), documented numeric bounds (§6), and an
honest limitations list (§7).

> ⚠️ **The code is unaudited.** This review is one engineer checking their own work
> with tooling; it is not a substitute for an independent audit. **Not for mainnet
> with real value.**

---

## 1. Findings (manual checklist)

Line numbers refer to `src/VestingFactory.sol` at the reviewed state (the guard
added three Natspec lines, so lines ≥111 shifted by +3 relative to commit `0bfa08c`).

| # | Check | Where | Verdict | Notes |
|---|-------|-------|---------|-------|
| 1 | **CEI in `release`** | `release` 264–277 | ✅ Pass | Read/validate 265–271 → **effect** `released += amount` 273 → **interaction** `safeTransfer` 274 → event 276. Payout recorded before any token moves; `nonReentrant` 264 on top. |
| 2 | **CEI in `createSchedule`** | `createSchedule` 123–186 | ✅ Pass (with note) | Validation 131–146 → pre-checks 152–159 → interaction `safeTransferFrom` 163 + delta check 164–166 → effects store/indexes 168–181 → event 183–185. The interaction must precede the store because the **fee-on-transfer delta check** (finding 5) can only run after the pull; safety comes from single-transaction atomicity (any failure reverts everything, so no half-stored schedule) plus the `nonReentrant` guard (finding 3). |
| 3 | **Re-entrancy (incl. cross-function)** | `createSchedule` 130, `release` 264 | 🔧 **Fixed (this review)** | Was possible: a malicious token could re-enter `createSchedule` **and** `release` during its own funding pull. Fixed by adding `nonReentrant` to `createSchedule` (line 130). OZ `ReentrancyGuard` is contract-wide, so one guard now closes both nested paths. Evidence in §2. |
| 4 | **Allowance & balance pre-checks** | 152–159 | ✅ Pass | `InsufficientBalance()` / `InsufficientAllowance()` fire before any transfer — friendly, explicit errors (redundant with `SafeERC20` reverts, deliberately). |
| 5 | **Fee-on-transfer balance-delta** | 161–166 | ✅ Pass | Factory balance before (162) vs after (164) must equal `amount` exactly, else `FeeOnTransferRejected()`. A rebasing-down token underflows the checked subtraction and reverts; a rebasing-up or fee token mismatches the delta and reverts. |
| 6 | **No division by zero** | 135–140, 304 | ✅ Pass | `durationMonths > 0 && durationMonths % 3 == 0` → `duration ≥ 90 days` → `totalIntervals = duration / INTERVAL ≥ 1` (denominator of line 305 can never be 0). Test coverage: validation suite + `VestingMath` fuzz. |
| 7 | **Overflow bounds** | 305, 149–150, 273 | ⚠️ Accepted, documented | See §6 for the maximum safe amount and the 1e76 test. Creation-side multiplies (`cliffMonths * MONTH`, `durationMonths * MONTH`) use checked math and revert on absurd inputs. |
| 8 | **30-day-month convention** | `MONTH` 20, `INTERVAL` 23 | ✅ Pass | `MONTH = 30 days`; cliffs/durations are whole months (multiples of 3). Documented in the contract header (13–15), the spec, and the UI. No calendar-month ambiguity inside the system. |
| 9 | **id 0 reserved** | 94–97, 169, 285–288 | ✅ Pass | `++scheduleCounter` yields ids from 1; `_getScheduleOrRevert` rejects `0` and unknown ids with `ScheduleNotFound()`; `getSchedule(0)` returns the empty record by contract (192–194). Tests: `ScheduleNotFound` for id 0 on all four entry points. |
| 10 | **`unchecked` blocks** | `src/` | ✅ None | `grep -rnE 'unchecked' src/` → zero matches; everything is Solidity 0.8.28 checked arithmetic. |
| 11 | **`tx.origin` / `delegatecall` / `selfdestruct` / raw `.call`** | `src/`, `script/` | ✅ None | `grep -rnE 'tx\.origin\|delegatecall\|selfdestruct\|\.call\{' src/` → zero matches. All authentication is `msg.sender`. |
| 12 | **Events for state changes** | — | ✅ Pass (one nuance) | `ScheduleCreated` (77–86, emitted 183–185) and `TokensReleased` (92, emitted 276) cover both factory state transitions; `TestToken.mint`/`faucet` emit ERC-20 `Transfer` (and OZ `OwnershipTransferred` on ownership change). Nuance: the faucet's `lastFaucetAt` write (`TestToken.sol:45`) has **no dedicated event** — accepted, cooldowns are per-caller and inferable from the `Transfer`. |
| 13 | **Access control** | — | ✅ Pass (by design) | `VestingFactory`: **none** — `createSchedule` is permissionless (anyone may fund a schedule) and `release` is permissionless but always pays `schedule.beneficiary`, never the caller. `TestToken`: `onlyOwner mint` (`TestToken.sol:32`) plus an **open faucet** (`40–47`: 1,000 TEST per address per 24 h). The faucet token has effectively unlimited supply (owner can mint any amount) — **testnet only**, never deploy it with real value. |
| 14 | **Custom errors only / `beneficiary` spelling** (T064 extras) | `src/`, `frontend/src/` | ✅ Pass | No `require(...)`, no string reverts anywhere in `src/` or `script/` (the only `require(` hit is a Node one-liner inside `script/smoke.sh`). All failure paths use typed custom errors. No `beneficary`/`beneficiairy`-style misspellings across `src/`, `test/`, `script/`, `frontend/src/`, `frontend/test/`; no `recipient`/`owner` naming leakage in the schedule API. |
| 15 | **`script/Deploy.s.sol`** | 32–63 | ✅ Pass | Deploys `TestToken` + `VestingFactory` (33–34) inside `vm.startBroadcast`, then writes addresses/ABIs with forge cheatcodes (`vm.serializeAddress` 48–49, `vm.writeJson` 50/63) into `frontend/src/contracts/` — a local file write bounded by `foundry.toml` `fs_permissions` (read `./out`, read-write `./frontend/src/contracts`). No keys handled by the script itself (broadcast keys come from `--account` keystores, see README). One custom error (`ArtifactLayoutUnexpected`, 24). |

## 2. Re-entrancy: the decision and its evidence

**Question:** `release` is `nonReentrant` — should `createSchedule` be too, given a
malicious token can callback during `safeTransferFrom` (line 163)?

**What was actually possible without the guard** (proved by the test below):
inside the funding pull the token could (a) re-enter `createSchedule` and get a
second schedule **stored mid-call** (interleaved ids, books that no longer matched
the factory's balance), and (b) re-enter `release` and pay out **while creation was
still in flight**. Neither stole other schedules' funds outright — every path is
atomic and `release` is CEI — but the interleaving broke the fee-on-transfer delta
check's accounting assumptions and made cross-function state transitions
non-atomic.

**Decision: YES — `createSchedule` is now `nonReentrant`** (`src/VestingFactory.sol:130`).
TDD order, per the constitution:

1. **Test first:** `test/mocks/ReentrantCreateToken.sol` (callback during the pull,
   attempts both re-entries, records the outcome codes) and
   `test/unit/VestingFactory.Reentrancy.t.sol` (three focused tests).
2. **RED — before the guard** (`forge test --match-contract VestingFactoryReentrancyTest`,
   exit code 1):

   ```
   [FAIL: re-entrant createSchedule must be blocked by nonReentrant: 1 != 2] test_Create_BlocksReentrantCreateScheduleDuringPull()
   [FAIL: re-entrant release must be blocked by nonReentrant: 1 != 2]       test_Create_BlocksReentrantReleaseDuringPull()
   [FAIL: only the outer schedule may be stored: 3 != 2]                    test_Create_StoresExactlyOneScheduleDespiteReentry()
   Suite result: FAILED. 0 passed; 3 failed
   ```

   Outcome code `1` = the re-entrant call **succeeded**; `3 != 2` = a second
   schedule was stored during the outer call.
3. **Guard added**, then **GREEN:** the same suite passes 3/3, the full forge suite
   passes **62/62** (forge 1.7.1 count at the time — CI's forge 1.8.5 prints
   **57**, grouping the 6 invariant functions into one suite entry; all 62 test
   functions run), and coverage stays at **100.00% (72/72 executable lines in
   `src/` on forge 1.7.1; 73/73 on forge 1.8.5)**, above the 95% gate
   (`./script/coverage-gate.sh` → “Coverage gate passed.”).

Because OZ's `ReentrancyGuard` uses a single contract-wide status, the guard blocks
the nested `createSchedule` **and** the nested `release` with
`ReentrancyGuardReentrantCall()` (selector `0x3ee5aeb5`, asserted by the tests).

## 3. Static analysis — slither

- **Install:** `pip`/`pip3`/`pipx`/`ensurepip` do not exist in this environment, so
  a fresh install was impossible — but slither was **already present** (installed
  via `uv`): `slither --version` → **0.11.6**.
- **Run:** `slither . --filter-paths "lib/|test/"` → exit code **255** (findings
  present), output: `analyzed (15 contracts with 102 detectors), 6 result(s) found`.
- **Comparison run:** the identical command against the **pre-guard** working tree
  produced the **same 6 results** — i.e. slither did **not** flag the re-entrancy
  window either way (§2 was found by the manual checklist and the adversarial test,
  not by slither). Recorded honestly rather than hidden.

| # | Detector | Location (slither's lines) | Classification | Reason |
|---|----------|----------------------------|----------------|--------|
| 1 | `divide-before-multiply` | `_vestedAmount` `src/VestingFactory.sol#303,305` | **Accepted (by design)** | The division *is* the spec's step formula (FR-009): vesting counts **completed** 90-day intervals only; the “lost” remainder is intentionally unvested until the next interval. Floor semantics are pinned by `test_Vest_FloorDivisionWithIndivisibleAmount` and the fuzz suite. |
| 2 | `incorrect-equality` (`amount == 0`) | `release` `src/VestingFactory.sol#268` | **False positive** | The detector targets dangerous float comparisons; this is an exact `uint256` check selecting `NothingToRelease()`. |
| 3 | `timestamp` (faucet cooldown) | `TestToken.faucet()` `#42` | **Accepted** | 24-hour cooldown on a testnet faucet; ±15 s miner clock skew cannot change the outcome. |
| 4 | `timestamp` (start validation) | `createSchedule` `#135` | **Accepted** | Spec rule V3 (`start != 0 && start < block.timestamp`); the user picks `start`, skew is irrelevant at day granularity. |
| 5 | `timestamp` (release path) | `release` `#268` | **Accepted** | Vesting math it calls is wall-clock by specification. |
| 6 | `timestamp` (cliff/end comparisons) | `_vestedAmount` `#296,#300` | **Accepted** | Cliff and full-vesting boundaries are defined in whole days; ±15 s cannot violate them. `foundry.toml` already excludes forge-lint's `block-timestamp` with the same rationale. |
| — | *re-entrancy-* detectors | — | **Fixed before analysis** | No re-entrancy findings remained once `nonReentrant` was on `createSchedule` (§2); slither did not report the pre-guard window either. |

## 4. Contract sizes (`forge build --sizes`)

EIP-170 limit: 24,576 B runtime; EIP-3860: 49,152 B initcode.

| Contract | Runtime | Initcode | Runtime margin | Deployable |
|----------|---------|----------|----------------|------------|
| **VestingFactory** | **3,809 B** | 3,873 B | 20,767 B | ✅ |
| **TestToken** | **2,409 B** | 3,013 B | 22,167 B | ✅ |
| ReentrantCreateToken (test mock) | 3,192 B | 3,679 B | — | test-only |
| MaliciousToken (test mock) | 2,346 B | 2,818 B | — | test-only |
| FeeOnTransferToken (test mock) | 2,072 B | 2,557 B | — | test-only |
| VestingHandler (invariant helper) | 1,668 B | 2,036 B | — | test-only |

Both production contracts are far below the limits.

## 5. Gas (`forge test --gas-report`, 62 test functions)

| Function | Min | Avg | Median | Max | # calls |
|----------|-----|-----|--------|-----|---------|
| `VestingFactory.createSchedule` | 27,948 | 275,627 | 269,426 | 337,874 | 7,319 |
| `VestingFactory.release` | 26,674 | 47,222 | 35,463 | 125,212 | 6,368 |
| `TestToken.faucet` | 23,634 | 63,291 | 81,497 | 90,047 | 10 |

Minima are cheap reverting validation failures; medians are representative
successful calls. A `.gas-snapshot` **is** tracked: `forge snapshot` writes 61
entries (every unit/fuzz test plus all 6 invariants individually, with their
`runs`/`calls` counts), so CI diffs any unexpected gas change against it — run
`forge snapshot` and commit the result when a gas change is intentional.

## 6. Overflow bounds — maximum safe amount

The only unbounded multiplication in the vesting math is the mid-schedule branch:

```solidity
return (schedule.totalAmount * completedIntervals) / totalIntervals; // line 305
```

- The `start + duration` branch (299–301) returns `totalAmount` **before** the
  multiply, so the multiply only runs for `completedIntervals ≤ totalIntervals − 1`.
- **Maximum safe amount:** `totalAmount ≤ ⌊(2²⁵⁶ − 1) / (totalIntervals − 1)⌋`
  (for `totalIntervals ≥ 2`; a 3-month schedule has `totalIntervals = 1`, never
  reaches a non-zero multiplier, and cannot overflow at all).
  | Duration | Intervals | Max safe `totalAmount` | In 18-decimal tokens |
  |----------|-----------|------------------------|----------------------|
  | 6 months | 2 | ≈ 1.1579 × 10⁷⁷ | ≈ 1.16 × 10⁵⁹ |
  | 12 months | 4 | ≈ 3.86 × 10⁷⁶ | ≈ 3.86 × 10⁵⁸ |
  | 120 months | 40 | ≈ 2.97 × 10⁷⁵ | ≈ 2.97 × 10⁵⁷ |

  Every real token's entire supply is many orders of magnitude below these bounds.
- **The 1e76 test** (`test/unit/VestingFactory.Vesting.t.sol:151–160`,
  `test_Vest_FullVestingAtExactEndWithExtremeAmount`): `1e76 × 40 intervals > 2²⁵⁶`,
  and the test proves the end-of-schedule branch returns `totalAmount` exactly at
  `start + duration` instead of panicking.
- **Honest caveat (accepted):** for an amount *above* the bound of its own
  duration — e.g. 1e76 over 40 intervals — the **mid-life** multiply still panics
  (`completedIntervals ≥ 12`), so `vestedAmount`/`releasableAmount`/`release`
  revert with an arithmetic panic between intervals 12 and 39 and recover at
  `start + duration`. Unreachable for legitimate supplies (≥ 10⁵⁸ tokens);
  documented here rather than papered over.

## 7. Known limitations

1. **No revocation.** A schedule cannot be cancelled or pulled back. Tokens sent
   with a **wrong beneficiary address are locked** in the factory until
   `start + duration`, at which point the (wrong) address can claim them — nobody
   else can redirect them. **UI status:** the create form
   (`frontend/src/pages/CreateSchedule.tsx:291–299`) has **one** beneficiary input;
   validation is viem's `isAddress(value)` with default options
   (`frontend/src/lib/schemas.ts:51`), plus a non-zero check. Verified against
   the installed viem **2.57.2** (`node -e` one-liner): it is **not**
   checksum-agnostic — a **mixed-case address with a wrong EIP-55 checksum is
   rejected** (`isAddress(bad) === false`; `isAddress(bad, { strict: false }) === true`,
   so the strict default is what rejects it), an all-lowercase address is
   **accepted** (`isAddress(lowercase) === true`), and an all-uppercase one is
   rejected. So a mistyped checksum only protects users who paste mixed-case
   addresses; a lowercase typo still passes. There is **no pre-submission
   confirmation step**, and the rejection uses the generic “must be a 0x
   address” message rather than a dedicated checksum warning — listed as a
   limitation; users must double-check the address themselves (paste, don't
   type).
2. **No admin, no pause.** There is no owner, guardian, or circuit breaker on
   `VestingFactory` — by design (immutable, trustless), but it also means a buggy
   schedule or a hostile token cannot be frozen after the fact.
3. **Shared pool.** Every grantor's funds for the same token sit in one contract
   balance. Release accounting is strictly per-schedule (CEI + `nonReentrant` +
   fee-on-transfer rejection), so one schedule can never pay from another's
   entitlement — but the design assumes that invariant holds (see §1 #5).
4. **Fee-on-transfer and rebasing tokens are rejected** at creation (delta check,
   §1 #5). A token that does not move exactly `amount` cannot create a schedule —
   intentionally fail-closed.
5. **The faucet token has unlimited supply.** `TestToken`'s owner can mint without
   limit and the public faucet mints 1,000 TEST per address per 24 h with a trivial
   Sybil cost. Fine for testnet; **TestToken must never be used on mainnet**.
6. **Extreme-amount mid-life panic** (§6) — accepted for absurd supplies.
7. **30-day months, rigid shape.** “Month” = 30 days everywhere; cliffs and
   durations must be whole multiples of 3 months. No arbitrary schedules, no
   calendar-month semantics, no cliff shorter than 90 days.
8. **Permissionless release.** Anyone may call `release(id)` — the payout can only
   go to the beneficiary, so this is a liveness feature, not a risk.
9. **Unaudited.** One engineer + slither + 62 tests + 100% line coverage is not an
   audit. **Do not deploy to mainnet with real value without an independent audit.**

## 8. Secrets & push-readiness scan

**Tracked files** (`git ls-files | wc -l`) → **142** at Phase 7a (138 when this
scan ran in Phase 6c — the review's own commit then added `LICENSE`,
`docs/SECURITY-REVIEW.md` and the two re-entrancy test files).

- **Forbidden paths — none tracked.** `node_modules/`, `out/`, `cache/`,
  `broadcast/`, `dist/`, `lcov.info`, `test-results/`, `playwright-report/`: zero
  matches. The only `lib/` entry is the submodule gitlink
  `lib/openzeppelin-contracts` (expected).
- **Env files:** only `frontend/.env.example` (template with **empty** values).
  `frontend/.env.local` is **not** tracked; `git check-ignore -v` →
  `.gitignore:23:.env.*	frontend/.env.local`.
- **Keys/keystores:** no `*.key`, `*.pem`, keystore, `secret`, or `mnemonic`
  filenames tracked.
- **10 largest tracked files:** `frontend/package-lock.json` 436,610 B ·
  `docs/design/theme.png` 184,822 B · `docs/screenshots/landing-desktop.png` 77,434 B ·
  `landing-mobile.png` 52,310 B · `.specify/scripts/bash/common.sh` 38,439 B ·
  `create-mobile.png` 35,077 B · `spec.md` 26,045 B · `tasks.md` 25,214 B ·
  `dashboard-mobile.png` 22,819 B · `docs/SECURITY-REVIEW.md` ≈22.5 kB (this
  file, which entered the top-10 when it was committed).
  **Nothing is ≥ 1 MB** (largest is 426 KiB) — nothing to justify or remove.

**Whole-history scan** — all **11 commits** present at scan time
(`git rev-list --all`), every tree
(`git grep <pattern> <revs> -- .`), plus every filename ever added
(`git log --all --diff-filter=A --name-only`):

| Pattern | Hits | Verdict |
|---------|------|---------|
| 64-hex strings (`(0x)?[0-9a-fA-F]{64}`) | `.specify/integrations/*.manifest.json` (22 lines) + `.specify/memory/.constitution-template.json` — these are **SHA-256 file-integrity hashes** in the manifest format; `frontend/test/*` — **fake transaction hashes** (`0x1111…`, `0x2222…`) used as wagmi fixtures; **`script/smoke.sh:30`** — `A0_KEY="0xac0974…f2ff80"`, anvil's **public, well-known dev key**, with a SECURITY header (lines 3–6) saying it must never touch a real network | ✅ Expected / benign |
| `PRIVATE_KEY` / `mnemonic` / `seed phrase` / `BEGIN PRIVATE KEY` | **1 hit:** `script/smoke.sh:4` — a *comment* describing the anvil keys. No private-key assignments, no mnemonic word lists (`junk`/`test test test`/`withdraw` scans: **zero hits**) anywhere in history | ✅ Expected / benign |
| API-key shapes (`alchemy`, `infura`, `etherscan.*key`, `apikey=`, `/v2/<key>`, WalletConnect/Reown project ids) | **No real credentials.** Hits are: the empty template `VITE_WALLETCONNECT_PROJECT_ID=`, docs text (`README`, `research.md`, `quickstart.md`, `plan.md`), the deliberate fallback string `'token-vesting-local-dev'` (`frontend/src/lib/wagmi.ts:29`), and npm registry URLs in `package-lock.json` | ✅ Benign |
| Env-like filenames ever committed | only `frontend/.env.example` | ✅ |
| `broadcast/`, `cache/`, `out/`, `node_modules/`, `dist/` ever committed | **none** | ✅ |

**Result: no blockers.** The only real key material ever committed is anvil's
published dev key in `script/smoke.sh`, which the brief explicitly allows.

**`.gitignore` covers everything required:** `out/`, `cache/`, `broadcast/`,
`lcov.info`, `node_modules/`, `dist/`, `.env`, `.env.*` (with `!.env.example`
exception), plus `frontend/test-results/` and `frontend/playwright-report/`.

**Submodule:** `.gitmodules` uses the **https** URL
`https://github.com/OpenZeppelin/openzeppelin-contracts`; `git submodule status`
shows a pinned commit and `git -C lib/openzeppelin-contracts describe --tags` →
**`v5.7.0`**.

### Frontend dependency advisories (`npm audit`)

Run from `frontend/`. The repository is **public**, with **secret scanning** and
**push protection** enabled, plus **Dependabot alerts** and **Dependabot
security updates** (`.github/dependabot.yml`).

| | findings | high | critical |
| --- | --- | --- | --- |
| Before | 24 | **1** | 0 |
| After scoped overrides | **9** | **0** | 0 |

**Fixed by version-scoped npm overrides** (`frontend/package.json`):

- `ws@8.18.0 → 8.22.0` — **GHSA-96hv-2xvq-fx4p** (high, memory-exhaustion DoS)
  and GHSA-58qx-3vcg-4xpx. The four vulnerable copies were nested under
  `viem@2.23.2`, pinned exactly by `@walletconnect/utils`. The override is keyed
  on `ws@8.18.0`, so `ws@7.5.13` and the root `ws@8.21.0` — neither vulnerable —
  are untouched.
- `decode-uri-component@0.2.2 → 0.5.0` — moderate DoS. This also cleared the
  `query-string` and nested-`viem` findings, which were reported transitively
  through these two.

**Not fixed, and deliberately so** (all 9 remaining moderates require a breaking
major): `wagmi` 2→3, `@rainbow-me/rainbowkit`, `@metamask/sdk` /
`@metamask/utils` / `@walletconnect/*`, and `uuid` 9→11. `npm audit fix --force`
would pull `wagmi@3.7.7`; no `--force` was used.

**`uuid` — GHSA-w5hq-g745-h8pq (moderate), ignored in Dependabot with
reasoning.** The advisory is a missing buffer bounds check in `v3/v5/v6`,
reachable **only when a `buf` argument is passed**. It is patched in `>=11.1.1`,
but every consumer here pins `^8.3.2` or `^9.0.1`, and `@metamask/sdk` still
requires `^8.3.2` at `0.34.0` — so the only update path npm can find
**downgrades `@rainbow-me/rainbowkit` 2.2.11 → 2.0.8**, which Dependabot refuses,
causing its security-update runs to error instead of opening a PR. Audited
against this tree: no consumer code calls `v1/v3/v5/v6` at all (only `v4`,
`parse`, `stringify`, `validate`, `version`, `NIL`; the apparent `v1`/`v5`
imports found in `node_modules` are uuid's own README examples), so the
vulnerable path is unreachable here. Force-fixing would need a 2–3 major jump
across 6 copies. **The advisory is documented here and still reported by
`npm audit`** — it is scoped out of Dependabot's update attempts, not hidden.

## 9. CI validation (`.github/workflows/ci.yml`)

Parsed with `python3 -c "import yaml"` (PyYAML 6.0.3):

- **Workflow:** `CI`, triggers `push: [main]` + `pull_request`, **env
  `FOUNDRY_PROFILE: ci`** — set for every step.
- **Job `contracts`** (ubuntu-latest): `actions/checkout@v4` with
  **`submodules: recursive`** ✅ → `foundry-rs/foundry-toolchain@v1` →
  `forge fmt --check` → `forge build --deny warnings` → `forge test -vvv` →
  `./script/coverage-gate.sh`. Every command exists in this repo (each was run
  for §10 / PART 4 of this review; `coverage-gate.sh` is committed at
  `script/coverage-gate.sh`).
- **Job `frontend`** (working-directory `frontend`): `actions/checkout@v4` →
  `actions/setup-node@v4` (node 24, npm cache on `frontend/package-lock.json`) →
  `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build`.
  All four npm scripts exist in `frontend/package.json`.
- **Fuzz seeds are fixed:** `foundry.toml` → `[profile.default] fuzz = { runs = 256,
  seed = "0x5eed" }`; `[profile.ci] fuzz = { runs = 512, seed = "0x5eed" }`,
  invariant `runs = 128, depth = 50` under `ci` — same seed, more runs. The
  workflow comment (`research R10`) matches the file.
- **CI-exact run:** local `FOUNDRY_PROFILE=ci forge test -vvv` on forge 1.7.1 gave
  `62 tests passed, 0 failed`; the **live CI run** (run 37367091887, forge 1.8.5)
  reports `57 tests passed, 0 failed` across 9 test suites — same **62 test
  functions**, because forge 1.8.5 groups the 6 invariants into one suite entry —
  with 512-run fuzz + 128-run invariants (6,400 invariant calls), and its coverage
  gate prints `100.00% (73/73 executable lines)` (forge 1.8.5 counts one more
  executable line in `src/` than 1.7.1 did).

## 10. Verdict

- **1 fixed** (re-entrancy window on `createSchedule`, TDD-proven, suite green,
  coverage 100% ≥ 95%).
- **4 accepted** timestamp findings + **1 accepted** divide-before-multiply, each
  with the reason above; **1 false positive**; **0 open blockers**.
- **Secrets scan: clean** — no credentials in any revision, required ignores in
  place, submodule pinned at v5.7.0 over https, nothing ≥ 1 MB tracked.
- **CI: valid and green** under `FOUNDRY_PROFILE=ci`.
- **Limitations (§7) stand** — especially no revocation + no address-confirmation
  UI, shared pool, unlimited testnet faucet, and **unaudited status: not for
  mainnet**.
