# Quickstart & Validation Guide

**Feature**: Token Vesting Web App (`001-token-vesting-app`) — [spec.md](./spec.md)
**Purpose**: runnable scenarios that prove the feature works end-to-end.
Implementation detail belongs to `tasks.md`; interface detail to
[contracts/](./contracts/).

## Prerequisites

- Foundry (`forge`, `anvil`, `cast`) — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- Node.js 22 LTS + npm
- A browser wallet extension (MetaMask or equivalent)
- Sepolia ETH for the grantor wallet (faucet) — only for the Sepolia scenario

## One-time setup

```bash
# Contracts (repo root)
forge install                      # OpenZeppelin v5 per remappings.txt
forge build                        # must compile clean (solc 0.8.28, no warnings)

# Frontend
cd frontend
cp .env.example .env               # fill VITE_RPC_URL, VITE_WALLETCONNECT_PROJECT_ID, VITE_CHAIN_ID
npm ci
```

## Local end-to-end run (anvil)

```bash
# Terminal 1 — chain
anvil

# Terminal 2 — deploy; writes addresses + ABIs into frontend/src/contracts/
# --unlocked uses anvil's pre-unlocked accounts (no raw keys on the command
# line); --sender must be anvil account #0, otherwise forge picks its default
# sender, which is NOT unlocked on anvil, and the script fails.
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# Terminal 3 — app
cd frontend && npm run dev         # open the printed localhost URL
```

Expected: `frontend/src/contracts/deployments.json` now contains chain `31337`
with `VestingFactory` + `TestToken` addresses; the UI connects to the local
chain and lists them without any hardcoded addresses.

## Validation scenarios

| # | Scenario | Steps | Expected outcome | Proves |
|---|----------|-------|------------------|--------|
| V1 | Grantor creates + funds a schedule | Connect wallet (anvil) → fund via "Get test tokens" (faucet) or owner `mint` → `/create` → fill valid form (start **now**) → **beneficiary read-back review → Confirm & create** → approve → create | Schedule listed with exact params; grantor balance decreased by full amount; `ScheduleCreated` emitted | US1, FR-001/002/014a/019, SC-001 |
| V2 | Inline validation before wallet prompts | Enter: past start, 4-month duration, 1-month cliff, zero amount, zero address | Each blocked with a specific field error; **no** wallet popup appears | US1.2, FR-003/018, Clar. 1–2 |
| V3 | Nothing releasable before cliff | Create schedule with cliff ≥ 3 months → view `/dashboard` immediately | Releasable = 0, claim button disabled with "nothing vested yet" | US2.1, SC-003 |
| V4 | Cliff + interval unlock math | `cast rpc evm_increaseTime <seconds>` past cliff and one interval, then `cast rpc evm_mine` → reload dashboard | Releasable = (completed intervals ÷ total) × total − released; claim transfers exactly that amount; `TokensReleased` emitted | US2.2–2.3, FR-008/010 |
| V5 | Partial claims never double-spend | Claim at interval 1, warp again, claim at interval 2 | Only newly vested amount claimable; `released` always ≤ `totalAmount` | US2.4, FR-010 |
| V6 | Fully vested at end | Warp to `start + duration` → claim remainder | Releasable = total − released; after claim: releasable 0, progress 100%, 0 tokens stranded | US2.5, SC-004 |
| V7 | Zero-release blocked | Call `release(id)` when nothing is due (UI + `cast send`) | UI prevents; contract reverts `NothingToRelease()` — no zero-value transfer | FR-013, edge case |
| V8 | Permissionless release, beneficiary receives | Second wallet calls `release(id)` for another's schedule | Tokens arrive at **beneficiary**, never the caller | Clar. 4, FR-010 |
| V9 | Fee-on-transfer token rejected | Point `createSchedule` at a fee-taking token | Reverts `FeeOnTransferRejected()`; no schedule exists | Clar. 5, FR-006 |
| V10 | Wrong network + rejected tx | Connect wallet on a non-Sepolia chain → attempt write; then reject a tx in wallet | Switch-network prompt blocks the write; rejection shows failed status + retry, state intact | US3.1/US1.4, FR-016/017 |
| V11 | Loading / empty / error states | Open dashboard with no schedules; kill RPC mid-load | Empty state explains next steps; error state with retry — never blank | FR-023 |
| V12 | Responsive + theme fidelity | Walk V1–V6 flows at 375px and desktop; compare against `docs/design/theme.png` | No horizontal scroll/overlap; press-tile 4/6/0 states, Plinth tokens everywhere | FR-024/025, SC-006 |
| V13 | Public deployment | From repo README, open the Vercel URL in a clean browser | Landing loads <3s, no login, connect entry point visible | US4, FR-026, SC-008 |
| V14 | Deep-link refresh (SPA routing) | While on `/dashboard`, refresh the browser (or open that URL directly) | App shell loads and the dashboard renders — no 404 (`vercel.json` rewrites non-asset paths to `/index.html`) | Amendment 2, research R12 |

## Quality gates (must all pass before "done")

```bash
forge fmt --check                  # formatting (constitution I)
forge build --deny warnings        # zero warnings (constitution V)
forge test                         # unit + fuzz + invariant (constitution II/III)
./script/coverage-gate.sh          # fail if core src/ coverage < 95% (constitution III)

cd frontend
npm run lint                       # ESLint
npm run typecheck                  # tsc --noEmit
npm test                           # Vitest + Testing Library
npm run build                      # vite build
```

CI (`.github/workflows/ci.yml`) runs exactly these jobs on every PR into
`main`; green pipeline = Definition of Done for merge (research R13).

## Sepolia + Vercel (release)

```bash
# One-time: import the deployer key into the encrypted Foundry keystore
cast wallet import deployer --interactive        # key stays in ~/.foundry/keystore

# Deploy to Sepolia (writes chain 11155111 into frontend/src/contracts/deployments.json)
forge script script/Deploy.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast --verify --account deployer

cd frontend && VITE_CHAIN_ID=11155111 npm run build   # local sanity check
# Vercel: root directory = /frontend, env vars VITE_RPC_URL / VITE_WALLETCONNECT_PROJECT_ID / VITE_CHAIN_ID
```

> Never put private keys in env files, the repository, or CI — any
> real-network deployment signs through the Foundry keystore (`--account`).

Expected: README links to the live site; scenario table above passes against
Sepolia with a real wallet.

## Troubleshooting

- **Create reverts `InvalidStart()` right after picking a date** — the tx
  mined after the chosen start passed; use **"Start now"** (sends `0`) or pick
  a later date (research R2).
- **Stale addresses after redeploy** — rerun the deploy script; it rewrites
  `frontend/src/contracts/` (never edit those files by hand).
- **Coverage gate fails locally but you saw 95%+** — run
  `./script/coverage-gate.sh` (it filters to `src/`; raw `forge coverage`
  totals include `script/`).
