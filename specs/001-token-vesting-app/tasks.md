---
description: "Task list for Token Vesting Web App (001-token-vesting-app)"
---

# Tasks: Token Vesting Web App

**Input**: Design documents from `/specs/001-token-vesting-app/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included and **required** — requested by the spec/plan (constitution
principles II & III: Test-First, ≥95% coverage, fuzz + invariant on vesting
math) and explicitly for the faucet cooldown/amount. Write tests FIRST; confirm
they FAIL before implementing.

**Organization**: Tasks are grouped by user story to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Contracts live at repo root (`src/`, `test/`, `script/`); frontend in
`frontend/src/` per [plan.md](./plan.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure per plan.md

- [X] T001 Verify the root `.gitignore` (repository already initialized — do NOT re-init) with these rules: ignore `.env*` except `.env.example`, `out/`, `cache/`, `node_modules/`, `dist/` — explicitly DO NOT ignore `frontend/src/contracts/`, it is committed per research R6 — at `.gitignore`
- [X] T002 Create Foundry config `foundry.toml` with `solc = "0.8.28"` (exact, no floating pragma), fmt settings, fuzz/invariant seeds, coverage config, and `fs_permissions` allowing the deploy script to `read = ["out/"]` and `write = ["frontend/src/contracts/"]` at `foundry.toml`
- [X] T003 [P] Install OpenZeppelin v5 pinned to an exact tag via `forge install OpenZeppelin/openzeppelin-contracts@v5.x.y` and write import aliases in `remappings.txt` (no GitHub URL imports)
- [X] T004 [P] Scaffold the Vite + React + TypeScript app in `frontend/` with pinned dependencies: react, vite, typescript, tailwindcss, wagmi, viem, @tanstack/react-query, @rainbow-me/rainbowkit, recharts, react-hook-form, zod, vitest, @testing-library/react, @fontsource/space-grotesk, @fontsource/inter in `frontend/package.json`
- [X] T005 [P] Configure Tailwind tokens exactly per `docs/design/theme.md`: colors canvas #FFFFFF, paper #FAF7F2, ink #111111, coral #FD9898, soft #FFE2DB; fontFamily display "Space Grotesk", body "Inter"; borderRadius tile 12px; boxShadow rest `0 4px 0 #111111`, hover `0 6px 0 #111111`, press `0 0 0 #111111`; self-host fonts in `frontend/src/index.css`
- [X] T006 [P] Create `frontend/.env.example` documenting `VITE_RPC_URL`, `VITE_WALLETCONNECT_PROJECT_ID`, `VITE_CHAIN_ID` (default 11155111) and confirm `.env*` gitignore rules in `.gitignore`
- [X] T007 [P] Create `frontend/vercel.json` with a rewrite sending all non-asset paths to `/index.html` (SPA deep-link refresh, quickstart V14)
- [X] T008 [P] Write coverage gate script filtering coverage to core contracts under `src/` and failing if line coverage < 95% at `script/coverage-gate.sh`
- [X] T009 [P] Create GitHub Actions workflow: contracts job (`forge fmt --check`, `forge build --deny warnings`, `forge test`, `script/coverage-gate.sh` with fixed fuzz/invariant seeds) and frontend job (`npm ci`, lint, `tsc --noEmit`, `vitest run`, `vite build`) at `.github/workflows/ci.yml`
- [X] T010 [P] Create repository `README.md` skeleton linking to `specs/001-token-vesting-app/quickstart.md` with a placeholder for the deployed site URL
- [X] T011 [P] Configure ESLint and Vitest (jsdom, setup files) for the frontend at `frontend/eslint.config.js` and `frontend/vite.config.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared plumbing EVERY user story needs

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T012 [P] Create the generated-artifacts wiring `frontend/src/contracts/index.ts` that loads `frontend/src/contracts/deployments.json` and `frontend/src/contracts/abis/*.json` and exposes address-by-`VITE_CHAIN_ID` lookup; commit initial placeholder `deployments.json` (`{}`) and `abis/` files (committed to git per research R6)
- [X] T013 [P] Set up wagmi + viem + RainbowKit + TanStack Query providers with Sepolia (11155111) and anvil (31337) chains and the app shell routes `/`, `/create`, `/dashboard` at `frontend/src/lib/wagmi.ts`, `frontend/src/App.tsx`, `frontend/src/main.tsx`
- [X] T014 [P] Build the `PressTile` primitive (2px ink outline, 12px radius, hard-offset shadow rest 4px / hover 6px / press 0px, ~100ms transition) and the `Button`, `Card`, `Tab` components built on it at `frontend/src/components/primitives/`
- [X] T015 [P] Build shared state components — Loading skeleton, Empty, Error-with-retry, TxStatus chip (pending/confirmed/failed) — at `frontend/src/components/states/`
- [X] T016 [P] Create the `useTxStatus` hook implementing `TxState` (`type: 'approve' | 'create' | 'claim' | 'faucet'`, `status: 'idle' | 'pending' | 'confirmed' | 'failed'`) and a custom-error decode helper skeleton at `frontend/src/hooks/useTxStatus.ts` and `frontend/src/lib/errors.ts`

**Checkpoint**: Foundation ready — user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Grantor creates and funds a vesting schedule (Priority: P1) 🎯 MVP

**Goal**: A grantor connects, fills a validated form, approves, and atomically
locks tokens into a schedule (FR-001…FR-006, FR-014, FR-014a, FR-018, FR-019)

**Independent Test**: quickstart scenarios V1 + V2 (create/fund with exact
params; every invalid input blocked inline with no wallet prompt)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

### Tests for User Story 1 (REQUIRED — TDD)

- [ ] T017 [P] [US1] Contract tests FIRST: `mint` is onlyOwner; `faucet()` mints exactly **1,000 tokens (18 decimals = 1000 * 10**18)** to `msg.sender`; second call within 24h reverts `FaucetCooldown()`; usable again after 24h — in `test/unit/TestToken.t.sol`
- [ ] T018 [P] [US1] Create a fee-on-transfer mock ERC-20 (deducts a tax on transfer) for funding tests — in `test/mocks/FeeOnTransferToken.sol`
- [ ] T019 [P] [US1] Contract tests FIRST: validation matrix — token/beneficiary zero → `ZeroAddress()`; `start != 0 && start < block.timestamp` → `InvalidStart()`; `durationMonths == 0 || durationMonths % 3 != 0` → `InvalidDuration()`; `cliffMonths % 3 != 0 || cliffMonths > durationMonths` → `InvalidCliff()`; `amount == 0` → `ZeroAmount()`; `start == 0` resolves to `block.timestamp` — in `test/unit/VestingFactory.Validation.t.sol`
- [ ] T020 [US1] Contract tests FIRST: funding — atomic `transferFrom` pull leaves schedule fully funded; insufficient balance → `InsufficientBalance()`; insufficient allowance → `InsufficientAllowance()`; fee-on-transfer token → `FeeOnTransferRejected()` and no schedule exists (depends on T018) — in `test/unit/VestingFactory.Funding.t.sol`
- [ ] T021 [P] [US1] Contract tests FIRST: `ScheduleCreated` event fields; `getSchedulesByBeneficiary`/`getSchedulesByGrantor` index reads; one grantor creates many schedules with no redeployment; identifier spelled `beneficiary` — in `test/unit/VestingFactory.Indexes.t.sol`

### Implementation for User Story 1

- [ ] T022 [US1] Implement `src/TestToken.sol` (OZ ERC20 + Ownable, owner `mint`, public `faucet()` limited to once per 24h per address with `FaucetCooldown()` and `lastFaucetAt(address)`, 18 decimals) per `specs/001-token-vesting-app/contracts/TestToken.md`, with full NatSpec on every public/external function (constitution I) (green T017)
- [ ] T023 [US1] Implement `src/VestingFactory.sol`: `Schedule` struct, `createSchedule` with the full validation matrix, 0-sentinel start rule, atomic pull with balance-before/after delta check, `ScheduleCreated` event, and on-chain beneficiary/grantor indexes (internal storage, external reads only via `getSchedulesBy*`) with full NatSpec on every public/external function (constitution I) per `specs/001-token-vesting-app/contracts/VestingFactory.md` (green T019–T021)
- [ ] T024 [US1] Implement deploy script that deploys TestToken + VestingFactory and writes addresses and ABIs into `frontend/src/contracts/` using cheatcodes (`vm.readFile`/`vm.parseJson`/`vm.writeJson`, covered by the T002 `fs_permissions`; jq-copy script accepted fallback) — in `script/Deploy.s.sol`
- [ ] T025 [P] [US1] Frontend tests FIRST: schema valid/invalid matrix (every V1–V6 rule) and FaucetButton states (idle/pending/confirmed/failed incl. `FaucetCooldown` decode) — in `frontend/test/schemas.test.ts` and `frontend/test/FaucetButton.test.tsx`
- [ ] T026 [P] [US1] Create the zod schema mirroring chain rules V1–V6 verbatim (address non-zero, `start === 0 || start >= now`, `durationMonths > 0 && durationMonths % 3 === 0`, `cliffMonths % 3 === 0 && cliffMonths <= durationMonths`, `amount > 0` and ≤ wallet balance) plus the "1 month = 30 days" copy constant — in `frontend/src/lib/schemas.ts` (green T025)
- [ ] T027 [P] [US1] Build the "Get test tokens" faucet button driving `faucet()` with `useTxStatus` pending/confirmed/failed — in `frontend/src/components/FaucetButton.tsx` (green T025)
- [ ] T028 [US1] Build the create-schedule form (react-hook-form + zod, date picker → Unix seconds, "Start now" → sends 0, "1 month = 30 days" hint wherever cliff/duration is entered, inline errors BEFORE any wallet prompt) — in `frontend/src/pages/CreateSchedule.tsx` (depends T026)
- [ ] T029 [US1] Implement the approve → create funding flow hook: approval first, create second, reuse a sufficient existing approval, failed-create retry without re-approval — in `frontend/src/hooks/useCreateSchedule.ts` (depends T023, T028)
- [ ] T030 [US1] Add the post-creation confirmation view listing the new schedule with the exact parameters entered and its creation record/tx link — in `frontend/src/pages/CreateSchedule.tsx` (depends T028)
- [ ] T031 [US1] Gate check: `forge fmt --check`, `forge build --deny warnings`, and all US1 `forge test` suites green; US1 Vitest green

**Checkpoint**: User Story 1 fully functional and testable independently (MVP — create + fund + faucet)

---

## Phase 4: User Story 2 - Beneficiary views schedules and claims vested tokens (Priority: P2)

**Goal**: Dashboard lists the connected wallet's schedules with progress and
timeline; claim sends exactly the releasable amount (FR-007…FR-013, FR-020, FR-021)

**Independent Test**: quickstart scenarios V3–V6 (zero before cliff; exact
interval math after warp; partial claims never double-spend; fully vested at
end with 0 stranded)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

### Tests for User Story 2 (REQUIRED — TDD)

- [ ] T032 [P] [US2] Contract tests FIRST: `vestedAmount`/`releasableAmount` boundaries — before cliff = 0, at cliff, after each completed 90-day interval (step formula `(amount * ((now-start)/90 days)) / (duration/90 days)`), at/after `start + duration` = `totalAmount` — in `test/unit/VestingFactory.Vesting.t.sol`
- [ ] T033 [P] [US2] Contract tests FIRST: `release(id)` — callable by anyone but tokens always go to `beneficiary`, sends only the currently releasable amount, `released` never exceeds `totalAmount`, zero releasable → `NothingToRelease()`, `TokensReleased` event, unknown id → `ScheduleNotFound()` — in `test/unit/VestingFactory.Release.t.sol`
- [ ] T034 [P] [US2] Fuzz tests with bounded inputs (amount ≤ 1e30, months ∈ {3..120}, warped timestamps): `releasable == vested - released >= 0`, `vested <= totalAmount`, monotonic vested over time — in `test/fuzz/VestingMath.fuzz.t.sol`
- [ ] T035 [P] [US2] Invariant tests with handler: `released <= totalAmount` (SC-004), `vested == 0` before cliff (SC-003), `vested == totalAmount` at end, `released` never decreases — in `test/invariant/VestingInvariant.t.sol` + `test/invariant/VestingHandler.sol`
- [ ] T036 [P] [US2] Frontend tests FIRST: pure vesting-progress math (state classification not-started/cliff/vesting/fully-vested, progress %, next unlock, releasable display) — in `frontend/test/vesting.test.ts`

### Implementation for User Story 2

- [ ] T037 [US2] Implement the vesting views `vestedAmount(id)`, `releasableAmount(id)`, `released(id)` and interval math in `src/VestingFactory.sol` (green T032, T034)
- [ ] T038 [US2] Implement `release(uint256 id)` with checks-effects-interactions, `SafeERC20.safeTransfer`, and `ReentrancyGuard.nonReentrant` in `src/VestingFactory.sol` (green T033, T035)
- [ ] T039 [US2] Create pure progress-math library shared by chart, progress bar, and claim gating — in `frontend/src/lib/vesting.ts` (green T036)
- [ ] T040 [P] [US2] Create the schedules read hook: `getSchedulesByBeneficiary` → ids → `getSchedule` batched via viem multicall, TanStack Query keyed by chain/address with block refetch — in `frontend/src/hooks/useSchedules.ts`
- [ ] T041 [P] [US2] Build the schedule card and vesting progress bar using the press-tile primitives (token, total, released, releasable, progress) — in `frontend/src/components/ScheduleCard.tsx` and `frontend/src/components/VestingProgress.tsx`
- [ ] T042 [P] [US2] Build the Recharts vesting timeline marking start, cliff, each 90-day unlock, and end with vested step-line and claimed marks — in `frontend/src/components/VestingTimeline.tsx`
- [ ] T043 [US2] Build the dashboard page: list, detail view, loading placeholders, error-with-retry, and the empty state for wallets with no schedules — in `frontend/src/pages/Dashboard.tsx` (depends T040)
- [ ] T044 [US2] Build the claim button: enabled if and only if releasable > 0, claims exactly the currently releasable amount, TxState status, disabled with "nothing vested yet" before cliff — in `frontend/src/components/ClaimButton.tsx`
- [ ] T045 [P] [US2] Frontend tests: dashboard loading/empty/error rendering, claim gating rules, non-beneficiary sees no claim action — in `frontend/test/Dashboard.test.tsx` and `frontend/test/ClaimButton.test.tsx`
- [ ] T046 [US2] Gate check: all `forge test` (unit + fuzz + invariant) green; `./script/coverage-gate.sh` passes; US2 Vitest green

**Checkpoint**: User Stories 1 AND 2 both work independently

---

## Phase 5: User Story 3 - Resilient wallet and transaction experience (Priority: P3)

**Goal**: Wrong-network guard, rejected-tx recovery, and loading/empty/error
states everywhere with responsive layout (FR-015…FR-017, FR-022…FR-024)

**Independent Test**: quickstart scenarios V10 + V11 (wrong network blocks
writes with switch prompt; rejection shows failed status with retry; kill RPC
mid-load → error with retry, never blank)

### Tests for User Story 3 (REQUIRED — TDD)

- [ ] T047 [P] [US3] Frontend tests FIRST: `useTxStatus` state machine — submitted → pending → confirmed; user rejection → failed with friendly message and preserved form data; terminal state visible until acknowledged — in `frontend/test/useTxStatus.test.ts`
- [ ] T048 [P] [US3] Frontend tests FIRST: wrong-network guard — write attempts blocked until chain switch succeeds — in `frontend/test/WrongNetwork.test.tsx`
- [ ] T049 [P] [US3] Frontend tests FIRST: Loading/Empty/Error components — skeletons while loading, retry control invokes reload on error — in `frontend/test/states.test.tsx`

### Implementation for User Story 3

- [ ] T050 [US3] Implement wrong-network detection and switch gating on every write path (create, approve, claim, faucet) — in `frontend/src/hooks/useEnsureChain.ts` wired into `frontend/src/hooks/*.ts` (green T048)
- [ ] T051 [P] [US3] Complete the custom-error → user-message mapping for all contract errors (`FaucetCooldown()`, `NothingToRelease()`, `InvalidStart()`, `InvalidDuration()`, `InvalidCliff()`, `ZeroAddress()`, `ZeroAmount()`, `InsufficientBalance()`, `InsufficientAllowance()`, `FeeOnTransferRejected()`, `ScheduleNotFound()`) — in `frontend/src/lib/errors.ts`
- [ ] T052 [P] [US3] Audit and wire Loading/Empty/Error states on every screen so no screen can render blank or misleading content — in `frontend/src/pages/*.tsx`
- [ ] T053 [US3] Implement disconnect: app returns to public state (no address, no wallet-specific content) and reconnect restores the wallet's schedules — in `frontend/src/App.tsx`
- [ ] T054 [US3] Implement pending-transaction recovery across refresh (persist tx hash, re-derive status on load) — in `frontend/src/hooks/useTxStatus.ts`
- [ ] T055 [P] [US3] Add wallet-not-installed/not-connected guidance instead of silent failure — in `frontend/src/lib/wagmi.ts` (RainbowKit wallet guide config)
- [ ] T056 [US3] Responsive pass: all flows usable at 375px and desktop with no horizontal scrolling or overlap — across `frontend/src/`

**Checkpoint**: All user stories independently functional with full feedback UX

---

## Phase 6: User Story 4 - Public, themed, discoverable site (Priority: P4)

**Goal**: Public landing on the Plinth theme, deployed and linked from README
(FR-025, FR-026; quickstart V13/V14)

**Independent Test**: quickstart V13 (README link → public site, no login) and
V14 (direct `/dashboard` refresh → no 404)

### Tests for User Story 4 (REQUIRED — TDD)

- [ ] T057 [P] [US4] Frontend tests FIRST: landing renders public content and connect CTA with no wallet connected — in `frontend/test/Landing.test.tsx`
- [ ] T058 [P] [US4] Frontend tests FIRST: PressTile rest/hover/press styling matches theme tokens (2px ink outline, 12px radius, 4/6/0px offsets, coral press background) — in `frontend/test/PressTile.test.tsx`

### Implementation for User Story 4

- [ ] T059 [US4] Build the public landing page (faint dot-grid background, left-aligned hero with soft-coral highlight marks, corner crop marks, logo tile, uppercase wide-tracked labels) per `docs/design/theme.md` and `docs/design/theme.png` — in `frontend/src/pages/Landing.tsx` (green T057)
- [ ] T060 [P] [US4] Theme fidelity audit: tokens, fonts, press states, no gradients/blur/dark mode; fix drift — across `frontend/src/` (green T058)
- [ ] T061 [US4] Deploy the frontend to Vercel (root directory `/frontend`, env vars per `frontend/.env.example`) after a Sepolia deploy via `script/Deploy.s.sol`; verify quickstart V13 and V14 (deep-link refresh, no 404)
- [ ] T062 [US4] Replace the README placeholder with the working deployed-site link — in `README.md`

**Checkpoint**: Public site live and reachable from the repository

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Constitution Definition-of-Done gates affecting everything

- [ ] T063 [P] Run `./script/coverage-gate.sh` and close any gaps until core `src/` line coverage ≥ 95% — across `test/`
- [ ] T064 [P] Security hardening review against the spec: CEI ordering, reentrancy, allowance handling, fee-on-transfer delta, no division by zero, `beneficiary` spelling everywhere, custom errors only — across `src/`, `frontend/src/`
- [ ] T065 [P] Verify all merge gates green locally: `forge fmt --check`, `forge build --deny warnings`, `forge test`, `./script/coverage-gate.sh`, frontend `lint`, `typecheck`, `vitest run`, `build` — repo-wide
- [ ] T066 Execute `specs/001-token-vesting-app/quickstart.md` scenarios V1–V14 end-to-end (anvil + Sepolia) and fix any failures — via `specs/001-token-vesting-app/quickstart.md`
- [ ] T067 [P] Finalize documentation: README (setup, quickstart, deployed link), note deploy/keystore workflow (`cast wallet import` + `--account`, never raw keys) — in `README.md`
- [ ] T068 Sweep conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `ci:`) and open the PR into `main` with the constitution checklist — repo-wide

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Stories (Phase 3–6)**: All depend on Foundational completion
  - Recommended order by priority: US1 → US2 → US3 → US4
  - US2 can start once US1's contracts exist (they share `src/VestingFactory.sol`); US3/US4 frontend work can proceed in parallel with US2
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational — no dependency on other stories (MVP)
- **User Story 2 (P2)**: Starts after Foundational — shares `src/VestingFactory.sol` with US1 (extend, don't restructure); independently testable via quickstart V3–V6
- **User Story 3 (P3)**: Starts after Foundational — hardens US1/US2 flows; independently testable via quickstart V10–V11 with mocked wagmi
- **User Story 4 (P4)**: Starts after Foundational — needs US1/US2 screens to exist for the deployed walkthrough; landing itself is independent

### Within Each User Story

- Tests FIRST — write, confirm they FAIL, then implement (constitution II)
- Contracts before deploy script; deploy script before frontend chain wiring
- Pure logic (schemas, vesting math) before UI that consumes it
- Story complete (checkpoint gate green) before moving to the next priority

### Parallel Opportunities

- Setup tasks T003–T011 are all [P] (independent files)
- Foundational tasks T012–T016 are all [P]
- US1 tests T017, T019, T021, T025 (+ T018) run in parallel; US2 tests T032–T036 all parallel; US3 tests T047–T049 parallel; US4 tests T057–T058 parallel
- Once Foundational completes: contract work (US1/US2) and frontend-primitive work (US3/US4) proceed on separate files concurrently
- Polish tasks T063–T065 and T067 are [P]

---

## Parallel Example: User Story 1

```bash
# Launch tests for US1 together:
Task: "T017 TestToken faucet tests → test/unit/TestToken.t.sol"
Task: "T018 Fee-on-transfer mock → test/mocks/FeeOnTransferToken.sol"
Task: "T019 Validation matrix tests → test/unit/VestingFactory.Validation.t.sol"
Task: "T021 Event/index tests → test/unit/VestingFactory.Indexes.t.sol"

# Frontend: tests FIRST, then implementation pieces in parallel:
Task: "T025 Frontend tests → frontend/test/schemas.test.ts + frontend/test/FaucetButton.test.tsx"
Task: "T026 zod schema → frontend/src/lib/schemas.ts"
Task: "T027 FaucetButton → frontend/src/components/FaucetButton.tsx"
```

## Parallel Example: User Story 2

```bash
Task: "T032 Vesting boundary tests → test/unit/VestingFactory.Vesting.t.sol"
Task: "T033 Release tests → test/unit/VestingFactory.Release.t.sol"
Task: "T034 Fuzz tests → test/fuzz/VestingMath.fuzz.t.sol"
Task: "T035 Invariant tests → test/invariant/VestingInvariant.t.sol"
Task: "T036 Progress math tests → frontend/test/vesting.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T047 useTxStatus tests → frontend/test/useTxStatus.test.ts"
Task: "T048 Wrong-network tests → frontend/test/WrongNetwork.test.tsx"
Task: "T049 State components tests → frontend/test/states.test.tsx"
```

## Parallel Example: User Story 4

```bash
Task: "T057 Landing tests → frontend/test/Landing.test.tsx"
Task: "T058 PressTile theme tests → frontend/test/PressTile.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 (tests first → contracts → frontend flow)
4. **STOP and VALIDATE**: run quickstart V1 + V2 against anvil
5. Demo: connect → get test tokens → create → funded schedule visible

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → validate independently → MVP deployable (create + fund works)
3. US2 → validate independently → full vesting lifecycle works
4. US3 → validate independently → trustworthy UX (errors, networks, states)
5. US4 → validate independently → public themed launch + README link
6. Polish → constitution gates green → merge to `main`

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: contracts (US1 → US2)
   - Developer B: frontend flows (US1 UI → US2 UI)
   - Developer C: US3 states/error handling + US4 landing/theme
3. Stories complete and integrate independently at the checkpoints

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] labels map tasks to spec user stories for traceability
- Every user story is independently completable and testable (quickstart scenarios V1–V14)
- Verify tests fail before implementing (constitution II) — bug fixes ship with a failing regression test
- Commit after each task or logical group (conventional commits)
- Stop at any checkpoint to validate the story independently
- Constraints quoted in tasks (e.g., `1000 * 10**18`, `durationMonths % 3 == 0`, once per 24h, ≥95%, "1 month = 30 days") are binding — do not leave them to implementation-time discretion
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence
