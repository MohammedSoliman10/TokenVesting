# Phase 0 — Research & Decisions

**Feature**: Token Vesting Web App (`001-token-vesting-app`)
**Date**: 2026-10-04
**Status**: All Technical Context unknowns resolved — no NEEDS CLARIFICATION remaining.

Format: **Decision** → **Rationale** → **Alternatives considered**.

---

## R1. Schedule storage: minimal clones vs single factory-held mapping

**Decision**: A single `VestingFactory` contract holds every schedule in
`mapping(uint256 => Schedule)` with monotonically increasing ids. No
per-schedule clone contracts.

**Rationale**:
- *Cheaper*: an EIP-1167 clone costs ~41k gas (create overhead + code deposit)
  **on top of** the same schedule field writes; the mapping stores only the
  struct fields plus index pushes — strictly less gas per schedule.
- *Simpler*: one address, one ABI, one deploy step, one contract to audit and
  test. Frontend reads (`getSchedule(id)`, index getters, views) need no
  address discovery step per schedule; events carry the id only.
- Meets every spec requirement identically: FR-004 (many schedules, no
  redeploy), FR-011 (views per schedule → `vestedAmount(id)` etc.),
  FR-012 (events emitted from the factory), and the mandated on-chain indexes
  (R5) are natural in a mapping design.
- Clones would only pay off if schedules needed independent upgradeability,
  per-schedule ownership, or separate payable logic — none apply in v1
  (revocation is out of scope).

**Alternatives considered**:
- *OpenZeppelin Clones (EIP-1167) per schedule*: rejected — extra deployment
  gas per schedule, per-schedule address discovery (event + cache), more
  moving parts (clone initialization must be atomic to avoid init front-run),
  and no v1 feature requires schedule isolation.
- *Diamond/proxy upgradeable factory*: rejected — YAGNI; upgradeability adds
  governance surface the spec never asked for.
- *Storing only events and rebuilding state off-chain*: rejected — spec
  mandates plain contract reads (no event indexer).

---

## R2. Start-time rule (mined-later reverts)

**Decision**: Contract accepts `start == 0` as "start at `block.timestamp`";
any non-zero `start` must be `>= block.timestamp` else revert `InvalidStart()`.
The UI's **"Start now"** option sends `0`; the date picker sends the chosen
Unix timestamp (seconds).

**Rationale**: The classic failure with date-picked starts is the transaction
mining seconds/minutes after user confirmation, making `start < now` and
reverting. Sending `0` for "now" eliminates that race entirely, while
future-dated starts remain user-intent-exact. Mirrors the clarified spec rule
(now-or-future, never past) without UX friction.

**Alternatives considered**:
- *Accept any `start >= creation - small tolerance`*: rejected — tolerance
  windows are arbitrary and permit retroactive cliffs.
- *UI previews the mined-later risk and asks user to retry*: rejected — worse
  UX and still racy.
- *Only future starts allowed, "now" unsupported*: rejected — most schedules
  start immediately; `0` sentinel is the standard pattern (Sablier/Vesting
  contracts use it).

---

## R3. Schedule validation on-chain (mirror of FR-003 + clarifications)

**Decision**: Validate in the constructor-path of `createSchedule` with custom
errors, using 30-day months and the fixed 90-day interval:

| Rule | Check | Custom error |
|------|-------|--------------|
| token / beneficiary non-zero | `!= address(0)` | `ZeroAddress()` |
| start now-or-future | `start == 0 \|\| start >= block.timestamp` | `InvalidStart()` |
| duration exact interval multiple, > 0 | `durationMonths > 0 && durationMonths % 3 == 0` | `InvalidDuration()` |
| cliff interval multiple, ≤ duration | `cliffMonths % 3 == 0 && cliffMonths <= durationMonths` | `InvalidCliff()` |
| amount > 0 | `amount > 0` | `ZeroAmount()` |
| no division by zero | `totalIntervals = duration / 90 days ≥ 1` guaranteed by the `% 3 == 0` rule | (structurally impossible) |

**Rationale**: `% 3 == 0` on months is exactly "duration is a positive
multiple of the 90-day interval" under the 30-day-month convention the
clarified spec adopts — checked at input time so no vesting computation can
ever divide by zero. All checks precede any state write (fail-fast, cheap).

**Alternatives considered**:
- *Accept seconds instead of months*: rejected — spec entities and the UI are
  month-based; converting in the contract keeps UI/API consistent.
- *Validate only in zod/UI*: rejected — UI validation is a convenience; the
  contract is the source of truth (constitution: correctness enforced on
  chain).

---

## R4. Funding: atomic pull + fee-on-transfer rejection

**Decision**: `createSchedule` pulls funds with OpenZeppelin `SafeERC20.
transferFrom(msg.sender, address(this), amount)` in the same transaction,
bookended by balance checks:
`balBefore = token.balanceOf(this)` → `safeTransferFrom` → require
`balAfter - balBefore == amount` else revert `FeeOnTransferRejected()`.
Pre-checks `balanceOf(msg.sender) >= amount` and `allowance >= amount` emit
friendlier custom errors (`InsufficientBalance()`, `InsufficientAllowance()`)
before the transfer attempt. A schedule only ever exists fully funded (FR-002).

**Rationale**: Single-transaction pull makes "unfunded schedule" a
structural impossibility; the before/after delta is the standard, cheap way to
reject fee-on-transfer/rebasing tokens (clarified decision 5). Pre-checks give
the frontend precise, decodable errors instead of raw OZ bubbles.

**Alternatives considered**:
- *Let SafeERC20 bubble OZ errors*: rejected for pre-check paths — worse UX,
  but kept as backstop for exotic tokens.
- *Transfer-then-verify via hooks/回调 monitoring*: rejected — overkill.
- *Separate funding tx after create*: rejected — would allow unfunded
  schedules to exist (spec violation).

---

## R5. Reading schedules without an event indexer

**Decision**: `VestingFactory` maintains on-chain indexes —
`beneficiarySchedules(address) → uint256[]`, `grantorSchedules(address) →
uint256[]`, plus `scheduleCount()` — so the frontend lists schedules with plain
contract reads (`getSchedulesByBeneficiary(addr)` → ids → `getSchedule(id)`
batched via viem multicall), cached with TanStack Query keyed by
`[chainId, addresses, blockNumber]` and refetched on new blocks.

**Rationale**: Spec/user mandate: no event indexer. Array-based address indexes
are O(1) push, O(n) read where n = that user's schedules (small in v1).
Multicall keeps a 50-schedule dashboard to ~2 RPC round trips. TanStack Query
gives loading/empty/error states for free (FR-023) plus stale-while-revalidate.

**Alternatives considered**:
- *Index events client-side (viem `getContractEvents` + logs)*: rejected —
  explicit no-indexer constraint; log scanning is slower to first paint and
  needs archival RPC.
- *Enumeration via pagination (`schedulesOf(addr, offset, limit)`)*: rejected
  as unnecessary in v1; can be added compatibly later if lists grow large.
- *Storing denormalized schedule arrays per user duplicated in struct*: same as
  chosen — this **is** the chosen design.

---

## R6. Deployment artifacts → frontend handshake

**Decision**: `script/Deploy.s.sol` deploys `TestToken` + `VestingFactory`,
then writes generated files directly into the frontend using pure Foundry
cheatcodes (no FFI): `frontend/src/contracts/deployments.json`
(`{ "31337": {...}, "11155111": {...} }` addresses) and
`frontend/src/contracts/abis/*.json` (ABIs copied from `out/` artifacts via
`vm.readFile` + `vm.parseJson` + `vm.writeJson`).
`frontend/src/contracts/index.ts` re-exports ABIs + address lookup by
`VITE_CHAIN_ID`.

Implementation requires `fs_permissions` in `foundry.toml` so the script may
read `out/` and write `frontend/src/contracts/`
(`read = ["out/"], write = ["frontend/src/contracts/"]`). If the cheatcode
JSON approach proves impractical, the accepted fallback is a small
`jq`-based copy script run immediately after the broadcast — same outputs,
same paths, still no FFI during the script. `deployments.json` and `abis/`
are **committed to git** (not gitignored): Vercel builds from the repository
and has no access to forge artifacts, so the generated files must ship with
the source.

**Rationale**: Addresses and ABIs are *build products of deployment* — the
frontend never hardcodes them (user requirement) and can never go stale: every
deploy regenerates the files in the same command. Pure-cheatcode writing keeps
the flow `forge script … --broadcast` with zero extra tooling. JSON files
import cleanly into TS with `as const` for wagmi's `parseAbi` typing.

**Alternatives considered**:
- *FFI to a node script*: rejected — FFI is a security hazard (enabled
  explicitly, breaks hermetic CI) and unnecessary.
- *VITE_ env var for contract address*: rejected — env drift is exactly the
  "hardcoded or stale" problem the requirement bans; addresses belong in
  versioned generated files (testnet addresses are public, not secrets).
- *wagmi CLI codegen from ABIs*: viable, but adds a generator dependency when
  the deploy script already knows both outputs; revisit only if ABI typing
  proves painful.

---

## R7. Wallet & network UX

**Decision**: RainbowKit for connect/disconnect UI (built on wagmi), wagmi +
viem for all reads/writes, `wagmi` chain config with Sepolia (11155111) +
anvil (31337); `useSwitchChain` gates writes on wrong network (FR-016);
transaction lifecycle = `useWriteContract` → `useWaitForTransactionReceipt`
mapped to pending → confirmed/failed (FR-022), failures (including user
rejection) surfaced through a decodable-error helper + retry (FR-017).

**Rationale**: The user-specified stack is the current wagmi v2 / viem v2 /
RainbowKit v2 standard; it covers every wallet requirement in the spec with
minimal custom code, and TanStack Query (RainbowKit's peer) doubles as the
read cache from R5.

**Alternatives considered**:
- *Web3Modal*: rejected — user specified RainbowKit.
- *Custom connect button + EIP-1193 listeners*: rejected — reimplements
  RainbowKit's edge cases (session persistence, mobile wallets, chain guard).

---

## R8. Form validation: one rule set, two places

**Decision**: A zod schema (`lib/schemas.ts`) encodes exactly the R3 rules
(months % 3, cliff ≤ duration, start ≥ now, amount > 0, address format,
amount ≤ wallet balance at submit); `react-hook-form` binds it to the
create-schedule form. "Start now" sends `0`; the date picker sends Unix
seconds. After a failed chain call, contract custom errors are decoded back
into the same field-level messages.

**Rationale**: FR-018 requires inline validation *before any wallet prompt* —
zod gives that synchronously; mirroring R3 keeps UI and chain messages
identical so users never see two different answers for the same input.
Debounced re-validation plus a final `trigger()` on submit prevents
mid-edit false errors.

**Alternatives considered**:
- *Generate zod schema from Solidity*: rejected — over-engineering for ~7
  fields; manual mirror is tested both ways (schema tests + contract tests).
- *Validate only on-chain, minimal UI checks*: rejected — violates FR-018 and
  wastes user gas on predictable reverts.

---

## R9. Design system: press-tile primitive built once

**Decision**: Tailwind CSS with tokens defined once (theme.md "Tailwind tokens"
block): `canvas #FFFFFF, paper #FAF7F2, ink #111111, coral #FD9898, soft
#FFE2DB`, fonts `display: Space Grotesk`, `body: Inter`, radius `tile: 12px`,
shadows `rest: 0 4px 0 #111111, hover: 0 6px 0 #111111, press: 0 0 0
#111111`. A single `PressTile` primitive implements the 2px ink outline +
4/6/0px hard-offset rest/hover/press states (~100ms transition); `Button`,
`Card`, and `Tab` are built on it and used everywhere (buttons, cards, tabs,
the claim button). Fonts self-hosted via `@fontsource/space-grotesk` +
`@fontsource/inter`. Faint dot-grid background, uppercase wide-tracked small
labels, no gradients/blur/dark mode (v1).

**Rationale**: theme.md/theme.png are authoritative (spec FR-025); building the
primitive once makes every interactive surface behave identically (SC-006
consistency) and keeps the "tactile press" from drifting per-component.
Self-hosting fonts avoids third-party requests (faster first paint, SC-008,
works offline in dev).

**Alternatives considered**:
- *CSS variables only, no Tailwind*: rejected — user specified Tailwind.
- *shadcn/ui or MUI components restyled*: rejected — fighting a foreign
  component model to reach the press-tile spec is more work than 4 primitives.
- *Google Fonts CDN*: rejected — extra DNS/TLS hop on critical path and a
  privacy/availability dependency.

---

## R10. Testing strategy (constitution-aligned, tests first)

**Decision**:
- **TDD ordering**: every behavior's task starts with a failing test
  (red → green → refactor); bug fixes ship with a failing regression test.
- **Unit**: create/validation matrix (every R3 rule + custom error), vesting
  math at boundaries (before/at cliff, at/after each interval, at end),
  release rules (exceeds-total impossible, zero-release reverts, anyone may
  call, tokens always to beneficiary), funding/FoT checks, events, indexes.
- **Fuzz**: `vestedAmount`/`releasableAmount` over bounded inputs
  (`bound(amount, 1, 1e30)`, months ∈ {3,6,…,120}, warped timestamps) —
  invariants asserted per run.
- **Invariant** (handler-driven): `released ≤ totalAmount`;
  `vestedAmount ≤ totalAmount`; `releasable = vested − released ≥ 0`;
  `vested == 0` before cliff; `vested == totalAmount` at `start + duration`;
  `released` never decreases.
- **Determinism**: fixed `FOUNDRY_FUZZ_SEED` / `FOUNDRY_INVARIANT_SEED` env in
  CI (constitution: reproducible runs) while local runs stay random.
- **Frontend**: Vitest + Testing Library for `PressTile` states,
  `vesting.ts` progress math (pure-function tests mirroring R3/R8), zod
  schemas (valid/invalid matrix), TxStatus state machine, loading/empty/error
  rendering. Wallet writes tested via mocked wagmi hooks (no live chain in CI).

**Rationale**: Constitution principles II & III are gates, not suggestions;
invariants directly encode spec success criteria SC-003/SC-004.

**Alternatives considered**:
- *Coverage-first (write tests late to hit 95%)*: rejected — violates
  Test-First; coverage is a floor, not the driver.
- *Fork tests against Sepolia in CI*: rejected — flaky third-party RPC;
  reserved for the quickstart smoke run.

---

## R11. Coverage gate mechanics (fail under 95% on core contracts)

**Decision**: CI runs `forge coverage --report summary --report lcov`; a repo
script (`script/coverage-gate.sh`) filters the report to core contracts under
`src/` (excluding `script/`, tests, and generated files) and fails if line
coverage < 95%. The same script is runnable locally.

**Rationale**: Constitution III demands a ≥95% line-coverage gate on core
contracts; a checked-in script keeps the rule auditable and identical local ↔
CI (no CI-only logic). Stdout summary parsing avoids adding exotic toolchain
dependencies.

**Alternatives considered**:
- *`forge coverage` total only (includes scripts)*: rejected — dilutes the
  core-contract number the gate is about.
- *Third-party SaaS coverage*: rejected — external dependency for a gate we
  can compute locally.
- *Diff coverage (only changed lines)*: rejected — constitution says project
  coverage must not decrease **and** core contracts ≥95%; absolute gate
  covers both.

---

## R12. Networks, hosting, and environment configuration

**Decision**:
- Chains: local anvil (31337) for development, Sepolia (11155111) for the
  public v1 (mainnet explicitly out of scope).
- Hosting: Vercel, **root directory `/frontend`**, static build
  (`vite build`, output `dist`).
- Config strictly via `VITE_` vars, documented in `frontend/.env.example`:
  `VITE_RPC_URL`, `VITE_WALLETCONNECT_PROJECT_ID`, `VITE_CHAIN_ID`
  (default `11155111`). `.env*` gitignored except `.env.example`; no secrets
  committed (WalletConnect project id is a public identifier but still
  env-provided so personal ids never enter the repo).
- SPA routing: `frontend/vercel.json` rewrites every non-asset path to
  `/index.html`, so deep links like `/dashboard` survive a direct refresh —
  no 404 on static hosting.
- Deployment keys: real-network deploys import the key once via
  `cast wallet import deployer --interactive` and run with `--account
  deployer` (encrypted Foundry keystore). Private keys NEVER appear in env
  files, the repository, or CI.

**Rationale**: User-specified. VITE_ prefix is Vercel/Vite-secure by
convention (only these are exposed to the browser bundle — nothing sensitive
may live there).

**Alternatives considered**:
- *Hardcoded RPC/provider defaults*: rejected — inflexible and personal
  quota leakage.
- *Secrets in Vercel env named without VITE_: rejected — nothing server-side
  exists; there are no true secrets in a static dApp frontend.

---

## R13. Source control & CI

**Decision**:
- GitHub, **conventional commits** (`feat:`, `fix:`, `docs:`, `test:`,
  `chore:`, `ci:`), **feature branches** named `NNN-slug` (this branch:
  `001-token-vesting-app`), **PRs into `main`**.
- GitHub Actions (`.github/workflows/ci.yml`) on PR + push to main, two jobs:
  - **contracts**: install Foundry → `forge fmt --check` →
    `forge build --deny warnings` → `forge test` → coverage gate (R11).
  - **frontend**: `npm ci` → lint → `tsc --noEmit` → `vitest run` →
    `vite build`.
  Fixed fuzz seeds make the contracts job reproducible (R10).

**Rationale**: User-specified; each CI job maps 1:1 to constitution gates
(I: fmt/build-clean; II+III: tests/coverage; V: frontend verified) so a green
pipeline = Definition of Done for merge.

**Alternatives considered**:
- *Single combined job*: rejected — parallel jobs fail faster and isolate
  contract vs frontend breakage.
- *Merge queue/monorepo tooling (Nx/Turborepo)*: rejected — two small
  packages don't justify the config surface (YAGNI).

---

## R14. Version pinning & dependency hygiene

**Decision**: `foundry.toml` sets `solc = "0.8.28"` (exact) and every source
file uses `pragma solidity 0.8.28;`. OpenZeppelin v5 installed via
`forge install OpenZeppelin/openzeppelin-contracts@v5.x.y` with
`remappings.txt` (no GitHub URL imports — `docs/reference/SollyWeb3.sol` URL
imports are reference-only and live outside `src/`, so they never compile).
Frontend deps pinned exact in `package.json` + committed lockfile; Node 22
LTS. Pre-merge check: `forge build --deny warnings`.

**Rationale**: Constitution IV + explicit user requirement; exact pins make CI
reproducible and eliminate "works on my machine".

**Alternatives considered**:
- *`pragma ^0.8.28` with floating solc*: rejected — explicitly banned (the
  reference prototype's floating pragma is a listed known bug).

---

## R15. Frontend architecture & routing

**Decision**: Single-page app, React + Vite + TypeScript, client-side routing
(React Router): `/` landing (public, hero, connect CTA), `/create` grantor
form (wallet required), `/dashboard` beneficiary list + detail (wallet
required; empty state for non-beneficiaries), schedule detail view with
Recharts timeline (start / cliff / interval ticks / end, vested step-line vs
claimed marks). Hooks layer (`useSchedules`, `useVestingProgress`,
`useTxStatus`) isolates wagmi from components so components stay
presentation-only and testable. Vesting progress math lives in pure
`lib/vesting.ts` (shared by chart, progress bar, and claim button gating).

**Rationale**: 4 screens per spec; pure-function progress logic is the highest
value unit-test target (mirrors chain math); presentation-only components keep
Vitest runs fast and wallet-free.

**Alternatives considered**:
- *Next.js SSR*: rejected — no server-side need; static Vercel deploy is
  simpler (SC-008 fast first paint without hydration overhead).
- *Reading chain state inside components directly*: rejected — untestable
  without mocks everywhere; hooks layer centralizes mock points.

---

## Open items

None — every Technical Context field and spec ambiguity is resolved above.
Remaining implementation-level details (exact file/function names, test case
lists) belong to `/speckit.tasks`.
