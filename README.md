# Token Vesting

A small dApp for creating, viewing and claiming ERC-20 vesting schedules.
Grantors lock tokens into a cliff + 90-day-interval schedule; beneficiaries
watch their vesting progress and claim exactly what has vested.

**Deployed site**: `https://YOUR-VERCEL-APP.vercel.app` — _placeholder, replaced
after the Sepolia deploy (tasks T061/T062)_

## Status

Implementation in progress. The feature spec, plan and task list live in
[`specs/001-token-vesting-app/`](specs/001-token-vesting-app/).

## Repository layout

| Path                     | What it is                                                        |
| ------------------------ | ----------------------------------------------------------------- |
| `src/`, `test/`, `script/` | Foundry contracts: `VestingFactory`, `TestToken`, deploy script |
| `frontend/`              | Vite + React + TypeScript app (Plinth theme, wagmi/RainbowKit)    |
| `frontend/src/contracts/` | **Generated** addresses + ABIs written by `script/Deploy.s.sol`  |
| `docs/design/`           | "Plinth" design system (`theme.md`, `theme.png`)                  |
| `specs/001-token-vesting-app/` | Spec, plan, research, data model, tasks, quickstart          |

## Quickstart

End-to-end smoke flows (local anvil + Sepolia, V1–V14) are documented in
[`specs/001-token-vesting-app/quickstart.md`](specs/001-token-vesting-app/quickstart.md).

### Contracts

```bash
forge build
forge test
./script/coverage-gate.sh   # fails below 95% line coverage on src/
```

### Frontend

```bash
cd frontend
npm ci
cp .env.example .env.local   # see Environment below
npm run dev
```

Merge gates (also run by CI in `.github/workflows/ci.yml`):

```bash
forge fmt --check && forge build --deny warnings && forge test && ./script/coverage-gate.sh
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```

## Environment

| Variable                          | Purpose                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `VITE_RPC_URL`                    | RPC endpoint (defaults to viem's public RPC for the chain)  |
| `VITE_WALLETCONNECT_PROJECT_ID`   | WalletConnect Cloud project id (manual step: create one at <https://cloud.walletconnect.com>) |
| `VITE_CHAIN_ID`                   | `11155111` (Sepolia, default) or `31337` (local anvil)      |

Copy [`frontend/.env.example`](frontend/.env.example) to `frontend/.env.local`.
`.env*` files are gitignored — only the example template is committed.

## Deploying

- Contracts: `forge script script/Deploy.s.sol --account <keystore> --broadcast`
  (keystore only via `cast wallet import` — **never** commit or paste raw keys).
  The script writes addresses/ABIs into `frontend/src/contracts/`, which is
  committed on purpose so the Vercel build always has them.
- Frontend: Vercel project with root directory `/frontend`, env vars per
  `frontend/.env.example`.
