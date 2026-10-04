# Implementation Plan: Token Vesting Web App

**Branch**: `001-token-vesting-app` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-token-vesting-app/spec.md`

## Summary

Build a token-vesting dApp: on-chain contracts (a `VestingFactory` that holds
vesting schedules in a single contract + an owner-mintable test ERC-20) written
in Solidity 0.8.28 with OpenZeppelin v5, plus a React/Vite/TypeScript frontend
(`/frontend`) where grantors create and fund schedules (approve → create) and
beneficiaries watch vesting progress and claim vested tokens. Contract reads go
straight to the factory (on-chain beneficiary/grantor indexes — no event
indexer); deployment scripts generate addresses and ABIs into
`frontend/src/contracts/` so the UI never hardcodes them. Sepolia for public
deployment (local anvil for development), Vercel hosting for the frontend,
GitHub Actions enforcing the constitution's quality gates (build clean, format,
tests, ≥95% coverage on core contracts, frontend lint/typecheck/test/build).

## Technical Context

**Language/Version**: Solidity exactly `0.8.28` (no floating pragma); TypeScript 5.x on Node 22 LTS

**Primary Dependencies**: Foundry (forge/anvil/cast), OpenZeppelin Contracts v5
pinned by tag via `forge install` + remappings (Clones evaluated — see
research, SafeERC20, ReentrancyGuard, ERC20, Ownable); frontend: React + Vite,
Tailwind CSS, wagmi + viem, TanStack Query, RainbowKit, Recharts,
react-hook-form + zod, Vitest + Testing Library

**Storage**: N/A — all persistent state lives on-chain; frontend is stateless
beyond wallet session + query cache

**Testing**: `forge test` (unit, fuzz, invariant with fixed seeds in CI),
`forge coverage` gated at ≥95% lines on core contracts; Vitest + Testing
Library for frontend components and vesting-progress logic

**Target Platform**: EVM — Sepolia (public v1) and local anvil (development);
modern browsers (desktop + mobile ≥375px)

**Project Type**: Smart-contract system + web frontend (single repo: contracts
at root, `frontend/` app)

**Performance Goals**: Site usable within 3s (SC-008); dashboard data via plain
contract reads batched with multicall; no indexer latency anywhere

**Constraints**: Coverage gate fail-under-95 on core contracts; solc exactly
0.8.28; custom errors only (no revert strings); `beneficiary` spelled
correctly everywhere; no secrets committed; generated (never hardcoded)
contract addresses/ABIs in the frontend

**Scale/Scope**: v1 — 2 roles, 1 test token type, ~4 screens, unbounded but
small per-user schedule lists (on-chain indexes), no revocation/mainnet

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
(Constitution: [.specify/memory/constitution.md](../../.specify/memory/constitution.md) v1.0.0)

| # | Gate | Plan compliance | Verdict |
|---|------|-----------------|---------|
| I | Code Quality by Default | `forge fmt` + `forge build --deny warnings`; NatSpec required on every external function; one responsibility per contract; no dead code | PASS |
| II | Test-First (NON-NEGOTIABLE) | Task ordering mandated red → green: tests written and failing first for every behavior, regression test per bug fix | PASS |
| III | Testing Rigor & Coverage | Unit + fuzz + invariant tests on vesting math (released ≤ total, nothing before cliff, fully vested at end); ≥95% line coverage gate in CI; fixed fuzz/invariant seeds for determinism | PASS |
| IV | Maintainability | solc pinned exactly 0.8.28; OZ pinned by tag; frontend lockfile; shared design tokens once; comments explain why | PASS |
| V | Verified Working Software | CI DoD: build clean → fmt check → full tests → coverage gate → frontend lint/typecheck/test/build; end-to-end smoke per [quickstart.md](./quickstart.md) before done | PASS |
| — | Additional Constraints | SafeERC20 + checks-effects-interactions + ReentrancyGuard on release; custom errors; audited OZ libraries over hand-rolled logic; every change traceable to this branch/spec | PASS |
| — | Workflow & Quality Gates | GitHub Actions mirrors merge gates; conventional commits; PRs into `main` reviewed against the constitution | PASS |

**Gate result**: PASS — no violations, no complexity-tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/001-token-vesting-app/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (interface contracts)
│   ├── README.md
│   ├── VestingFactory.md
│   └── TestToken.md
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit.specify)
├── spec.md
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── VestingFactory.sol        # Single contract holding all schedules + indexes
└── TestToken.sol             # Owner-mintable ERC-20 + public 24h faucet (OZ)

test/
├── unit/                     # VestingFactory.t.sol, TestToken.t.sol (mint + faucet amount/cooldown), validation rules
├── fuzz/                     # Vesting math fuzz tests (bound inputs)
└── invariant/                # Handler + invariants (released ≤ total, cliff, end-state)

script/
├── Deploy.s.sol              # Deploys TestToken + VestingFactory, writes addresses/ABIs
└── coverage-gate.sh          # fail-under-95 coverage gate for CI

frontend/
├── src/
│   ├── components/
│   │   ├── primitives/       # PressTile, Button, Card, Tab (theme.md tokens, built once)
│   │   └── states/           # Loading / Empty / Error / TxStatus components
│   ├── pages/                # Landing, CreateSchedule, Dashboard
│   ├── contracts/            # GENERATED: abis/, deployments.json, index.ts
│   ├── hooks/                # useSchedules, useTxStatus, useCreateSchedule, useEnsureChain
│   ├── lib/                  # vesting.ts (progress math), schemas.ts (zod), wagmi.ts, errors.ts, theme.ts
│   ├── App.tsx
│   └── main.tsx
├── test/                     # Vitest + Testing Library (*.test.tsx / *.test.ts)
├── .env.example              # VITE_RPC_URL, VITE_WALLETCONNECT_PROJECT_ID, VITE_CHAIN_ID
├── vite.config.ts
├── vercel.json               # SPA rewrite: non-asset paths → /index.html
└── package.json

.github/workflows/ci.yml      # contracts job + frontend job (gates above)
docs/
├── reference/                # TokenVestingPrototype.sol (reference only), SollyWeb3.sol
└── design/                   # theme.md, theme.png (Plinth design system)
specs/001-token-vesting-app/  # this feature's artifacts
foundry.toml                  # solc "0.8.28" exact, fmt, coverage, seeds, fs_permissions
remappings.txt                # @openzeppelin/ imports (forge install, no URL imports)
README.md                     # links to deployed site + quickstart
```

**Structure Decision**: Option 2 (web application) adapted to a dApp monorepo:
Foundry contracts at the repo root (`src/`, `test/`, `script/` — Foundry's
conventional layout, so no custom path config) and the React app isolated in
`frontend/` (its own package.json, Vite root, Vercel project root = `/frontend`).
Generated chain artifacts land in `frontend/src/contracts/` as the single
handshake between the two halves — see [research.md](./research.md) R6.
Those generated files (`deployments.json`, `abis/`) are **committed to git**
(not gitignored) because Vercel builds from the repository, and
`frontend/vercel.json` provides the SPA rewrite so deep links such as
`/dashboard` survive a direct refresh without a 404.

## Complexity Tracking

No constitution violations — all gates pass; nothing to justify.

## Constitution Check (post-design re-evaluation)

Re-checked after Phase 0/1 artifacts: [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/),
[quickstart.md](./quickstart.md).

- Simplicity (Governance): the single-contract mapping design was chosen over
  per-schedule clones — simpler **and** cheaper (research R1) — and it keeps one
  ABI/one address for the frontend.
- Test-First: quickstart validation scenarios are written as behaviors, and
  tasks (Phase 2) must order tests before implementation for each.
- Coverage: fuzz/invariant tests are first-class plan artifacts (research R10),
  not afterthoughts, so the ≥95% gate is achievable.
- Pinned toolchain: solc exactly 0.8.28, OZ pinned by tag, frontend lockfile —
  no floating versions anywhere (research R14).

**Verdict: PASS** — design remains constitution-compliant; no new violations,
no complexity entries required.
