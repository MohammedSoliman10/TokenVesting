# Token Vesting

A small spec-driven dApp for creating, viewing and claiming ERC-20 vesting
schedules: grantors lock tokens behind a cliff and 90-day release intervals in a
single audited-shape factory contract, beneficiaries watch their vesting progress
on a responsive dashboard and claim exactly what has vested — with wallet and
network guards, transaction-status recovery, and a generated-artifacts handshake
that keeps the frontend and the contracts from ever drifting apart.

**Live site**: LIVE_URL_PLACEHOLDER _(placeholder until the Sepolia deploy, task T062)_

![Landing page — desktop](docs/screenshots/landing-desktop.png)

| Mobile — landing | Mobile — create | Mobile — dashboard |
| ---------------- | --------------- | ------------------ |
| ![Landing mobile](docs/screenshots/landing-mobile.png) | ![Create schedule mobile](docs/screenshots/create-mobile.png) | ![Dashboard mobile](docs/screenshots/dashboard-mobile.png) |

## Features

- **Atomic schedule creation** — `createSchedule` pulls the full amount from the
  grantor in the same transaction that stores the schedule; no schedule can exist
  unfunded, and fee-on-transfer tokens are rejected by a balance-delta check.
- **Cliff + 90-day intervals** — deterministic floor-division vesting, claimable
  by anyone but always paid to the beneficiary.
- **Dashboard** — per-beneficiary and per-grantor views, vesting progress, live
  claim buttons with pending/confirmed/failed status and pending-tx recovery.
- **Test-token faucet** — rate-limited (1,000 TEST / 24 h) for testnets.
- **Wallet & network guards** — wrong-network banner, connect prompts, and an
  honest "contracts not deployed on this chain yet" notice.
- **Responsive & theme-verified** — Plinth design system
  ([`docs/design/theme.md`](docs/design/theme.md)), automated theme and
  responsive Playwright checks with committed screenshots.
- **Generated-artifact handshake** — addresses + ABIs are written by
  `script/Deploy.s.sol` into `frontend/src/contracts/` and committed; the UI
  never hand-copies an ABI.

## How vesting works

- **Months are 30 days.** A schedule has a `start`, a `cliff` (whole multiples of
  3 months), and a `duration` (whole multiples of 3 months, i.e. multiples of the
  90-day interval).
- Before the cliff: **nothing** is vested. At or after `start + duration`:
  **everything** is vested. In between, tokens vest once per **completed
  90-day interval**, with **floor division** (no partial intervals, never rounds
  up):

  ```
  vested = totalAmount × completedIntervals / totalIntervals
  completedIntervals = (now − start) / 90 days      totalIntervals = duration / 90 days
  ```

- **Example:** 900 TEST over 9 months (cliff 3 months, 3 intervals):

  | Time after `start` | Vested | Claimable |
  | ------------------ | ------ | --------- |
  | day 89 (pre-cliff) | 0 | 0 — `release` reverts `NothingToRelease()` |
  | day 90 | 900 × 1/3 = **300** | 300 |
  | day 180 | 900 × 2/3 = **600** | 300 more (600 − 300 already released) |
  | day 270 (= duration) | **900** | the remaining 300 |

  Floor division shows up with indivisible amounts too: 5 wei over 2 intervals
  vests `floor(5 × 1 / 2) = 2` wei after interval 1 and the full 5 after
  interval 2.

## Architecture

```
┌──────────────────────────┐   forge script script/Deploy.s.sol   ┌──────────────────────────────────┐
│ Foundry contracts        │ ───────────────────────────────────► │ frontend/src/contracts/ (GENERA- │
│  src/VestingFactory.sol  │   writes, committed on purpose:      │  TED, committed):                │
│  src/TestToken.sol       │   • deployments.json (per chain id)  │  • deployments.json              │
│  script/Deploy.s.sol     │   • abis/*.json                      │  • abis/{VestingFactory,TestToken}│
└────────────┬─────────────┘                                      └───────────────┬──────────────────┘
             │ deploy (anvil / Sepolia)                            imported by    │
             ▼                                                                 ▼
┌──────────────────────────┐   wagmi + viem (reads batched via Multicall3, ┌──────────────────────────┐
│ EVM node (RPC)           │ ◄── writes via wallet, ABI decode, zod ──────► │ frontend (Vite + React)  │
│  anvil 31337 / Sepolia   │       validated forms, tx-status hooks)       │  RainbowKit + wagmi      │
└──────────────────────────┘                                               └──────────────────────────┘
```

The handshake is one-way: contracts → generated artifacts → frontend. Deploying
regenerates `frontend/src/contracts/`, which you commit so every environment
(Vercel included) builds against the real addresses.

## Project layout

| Path | What it is |
| ---- | ---------- |
| `src/` | `VestingFactory` (all schedules, one address) + `TestToken` (testnet token + faucet) |
| `test/` | Unit, fuzz and invariant Foundry tests (+ `test/mocks/` adversarial tokens) |
| `script/Deploy.s.sol` | Deploys both contracts, writes addresses + ABIs into the frontend |
| `script/smoke.sh` | End-to-end claim flow against a local anvil via `cast` |
| `script/coverage-gate.sh` | Fails below 95% line coverage on `src/` |
| `frontend/` | Vite + React + TypeScript app (Plinth theme, wagmi/RainbowKit) |
| `frontend/src/contracts/` | **Generated** `deployments.json` + `abis/` (committed) |
| `frontend/scripts/` | `responsive-check.mjs` and `theme-check.mjs` Playwright checks |
| `docs/design/` | "Plinth" design system (`theme.md`, `theme.png`) |
| `docs/screenshots/` | Committed screenshots used in this README |
| `docs/SECURITY-REVIEW.md` | Security review: findings, slither, gas, limitations |
| `specs/001-token-vesting-app/` | Spec, plan, research, data model, tasks, quickstart |

## Local run

```bash
# 1. Chain (terminal A) — anvil, chain id 31337
anvil

# 2. Contracts (terminal B) — deploy with anvil's unlocked account #0
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 --broadcast --unlocked \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# 3. Frontend (terminal B)
cd frontend
npm ci
cp .env.example .env.local    # then set VITE_CHAIN_ID=31337
npm run dev                   # reads .env.local (VITE_CHAIN_ID=31337)
```

**MetaMask setup:** add a network with RPC `http://127.0.0.1:8545`, chain id
`31337`, currency `ETH`, and import anvil account #0 (or #1) using its
**publicly known dev key** printed by `anvil`. Those keys are for local testing
only — never reuse them on a real network.

## Tests & gates

```bash
# Contracts — unit + fuzz + invariant (fixed seed 0x5eed), 62 tests
forge test
FOUNDRY_PROFILE=ci forge test      # what CI runs: fuzz 512, invariants 128

# Coverage gate — fails below 95% line coverage on src/
./script/coverage-gate.sh

# Frontend — lint, typecheck, 211 tests, build
cd frontend
npm run lint && npm run typecheck && npm test && npm run build

# Browser checks (Playwright; start `npm run dev` first for theme-check)
node scripts/responsive-check.mjs
node scripts/theme-check.mjs

# End-to-end smoke: faucet → approve → create → warp → claim (anvil must be
# running with the contracts deployed, and `node` + `cast` on PATH)
./script/smoke.sh
```

Merge gates (also run by CI in `.github/workflows/ci.yml`):

```bash
forge fmt --check && forge build --deny warnings && forge test && ./script/coverage-gate.sh
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```

## Environment

| Variable | Purpose |
| -------- | ------- |
| `VITE_CHAIN_ID` | `31337` (local anvil) or `11155111` (Sepolia, default) |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project id — free at <https://cloud.reown.com> (or cloud.walletconnect.com) |
| `VITE_RPC_URL` | Optional custom RPC; defaults to viem's public RPC for the chain |

Copy [`frontend/.env.example`](frontend/.env.example) to `frontend/.env.local`.
`.env*` files are gitignored — only the example template is committed.

## Deploying contracts (Sepolia, keystore)

Use a Foundry keystore so the private key never touches the repo or shell
history:

```bash
# one-time: import the key interactively (stored encrypted in ~/.foundry/keystores)
cast wallet import deployer --interactive

# deploy (keystore prompts for the password; never pass a raw key)
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$SEPOLIA_RPC_URL" --account deployer --broadcast

# the script rewrote addresses + ABIs — commit them so the frontend builds
git add frontend/src/contracts && git commit -m "chore: record Sepolia deployment"
```

**Never commit or paste raw keys.** Keystores only (`cast wallet import` +
`--account`), exactly as CI and the security review assume.

## Deploying the frontend (Vercel)

- **Root directory:** `frontend` · **Framework:** Vite · **Build command:**
  `npm run build` · **Output directory:** `dist`
- **Environment variables:**
  - `VITE_CHAIN_ID` = `11155111`
  - `VITE_WALLETCONNECT_PROJECT_ID` = your project id
  - `VITE_RPC_URL` = optional custom Sepolia RPC
- After the first deploy, **add the Vercel domain to the allowed domains** in
  your WalletConnect/Reown project settings (Project → Allowed domains), or
  WalletConnect connections will be refused on that origin.

## Spec-driven development

This project is built with GitHub's **Spec Kit** workflow: a constitution sets
the engineering rules (TDD, ≥ 95% coverage, merge gates), then each feature goes
`/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`
(waves of test-first tasks) → `/speckit.checklist`. The full spec, plan,
research, data model and task list live in
[`specs/001-token-vesting-app/`](specs/001-token-vesting-app/) — the task file
is the source of truth for what is done and what remains (deploy, live URL,
quickstart run, PR).

## Security

See **[`docs/SECURITY-REVIEW.md`](docs/SECURITY-REVIEW.md)** for the full review:
CEI/re-entrancy analysis (including the `createSchedule` guard added with a
red→green adversarial test), slither results, contract sizes and gas, numeric
bounds, and the secrets/push-readiness scan.

## Known limitations

Copied from the security review (§7) — read the
[full review](docs/SECURITY-REVIEW.md) for context:

1. **No revocation** — a wrong beneficiary address locks the tokens until
   `start + duration`, when only that address can claim. The create form
   validates the address shape but has **no confirmation step and no checksum
   warning** — double-check the address yourself.
2. **No admin / no pause** — immutable by design; nothing can be frozen later.
3. **Shared pool** — all grantors' funds for the same token live in one contract;
   per-schedule accounting keeps releases independent.
4. **Fee-on-transfer and rebasing tokens are rejected** at creation.
5. **Test-token faucet has unlimited supply** — testnet only, never mainnet.
6. **Extreme amounts** (≥ ~10⁵⁸ tokens) can panic mid-schedule — see the
   overflow section of the review.
7. **30-day months, rigid shape** — cliffs/durations in whole multiples of 3
   months; no arbitrary schedules.
8. **Permissionless release** — anyone may trigger a claim, but it always pays
   the beneficiary.
9. **Unaudited** — one engineer plus slither and 62 tests is not an audit;
   **not for mainnet with real value.**
