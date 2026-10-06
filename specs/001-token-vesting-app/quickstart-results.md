# Quickstart results — V1…V14

Executed 2026-10-06 against commit `45716ef`+ (final phase) by the release run.
Every row names the **actual command or test file** that produced the result —
nothing here is inferred from intent. "Automated test" means the scenario's
assertions exist 1:1 in the committed suites that CI runs on every push.

Environment: Foundry 1.8.5, Node v24.20.0, local `anvil` (chain 31337),
Sepolia (chain 11155111, publicnode RPC), live site
<https://token-vesting-lyart.vercel.app>.

## Scenarios

| # | Scenario | How it was executed | Result |
| - | -------- | ------------------- | ------ |
| V1 | Grantor creates + funds a schedule | `./script/smoke.sh` on anvil (steps 1–3: faucet → approve → `createSchedule` 900e18, read back id=1); `script/smoke-sepolia.sh` on Sepolia (mint → approve → create ×2, read-back asserts, 8/8); **live UI run**: `live-e2e.mjs deployer` created schedule **#6** through the real form, tx `0xf634…8500`, receipt status 1 in block 11852133 | **PASS** |
| V2 | Inline validation before wallet prompts | `frontend/test/CreateSchedule.test.tsx` — *"shows every validation error inline BEFORE any wallet prompt (FR-018)"*; `frontend/test/schemas.test.ts` — past start, non-multiple-of-3 cliff, cliff > duration, zero amount, zero address, boundary cases | **PASS** (automated) |
| V3 | Nothing releasable before cliff | `./script/smoke.sh` step 4/8 (`releasableAmount` = 0 pre-cliff); live: `live-e2e.mjs` run A/B — claim button disabled with exact text *"Nothing vested yet"*, `aria-valuenow=0`, "0% vested" (5 buttons on the OWNER dashboard); `ClaimButton.test.tsx` | **PASS** (anvil + live Sepolia) |
| V4 | Cliff + interval unlock math | `./script/smoke.sh` steps 5/8 (`evm_increaseTime` 90d+1s → 300e18) and 7/8 (warp to end → 600e18); contract math additionally covered by Foundry fuzz/invariant suites (`forge test`, fixed seed `0x5eed`) | **PASS on anvil + fuzz — time travel is impossible on public Sepolia; not re-run there** |
| V5 | Partial claims never double-spend | `./script/smoke.sh` steps 6/8 + 7/8: claim 300e18, warp, claim remainder; cumulative beneficiary delta = exactly 900e18, `released` 300 → 900 ≤ total | **PASS on anvil** (same time-warp caveat) |
| V6 | Fully vested at end | `./script/smoke.sh` step 7/8 (`releasable` at end = 600e18 → after claim `released` == total, 0 stranded) + step 8/8 | **PASS on anvil** (same caveat) |
| V7 | Zero-release blocked | `./script/smoke.sh` 8/8 and `script/smoke-sepolia.sh` — `release()` reverts `NothingToRelease()` selector `0xb10205ed` (anvil **and** Sepolia); UI prevents it live (disabled *"Nothing vested yet"*) | **PASS** (anvil + Sepolia) |
| V8 | Permissionless release, beneficiary receives | `test/unit/VestingFactory.Release.t.sol::test_Release_PermissionlessCallerStillPaysTheBeneficiary`; `./script/smoke.sh` step 6/8 (caller ≠ beneficiary, balance lands on beneficiary) | **PASS** |
| V9 | Fee-on-transfer token rejected | `test/unit/VestingFactory.Funding.t.sol::test_Create_FeeOnTransferTokenIsRejected` (adversarial mock in `test/mocks/FeeOnTransferToken.sol`) | **PASS** |
| V10 | Wrong network + rejected tx | `frontend/test/WrongNetwork.test.tsx` — *"wrong-network guard for every write path (T048)"*; `errors.test.ts` — *"a wallet rejection still reads as a friendly sentence"*; `FaucetButton.test.tsx` failed→acknowledge→retry; **observed live**: the Sepolia e2e run got the friendly FR-017 sentence *"The contract rejected this transaction — nothing was sent."* on the cooldown faucet (no raw revert data) | **PASS** (automated + live observation) |
| V11 | Loading / empty / error states | `Dashboard.test.tsx` (empty wallet explains next steps + link), `useSchedules.test.tsx` (empty result without multicall), `states.test.tsx` (Loading/Empty/Error) | **PASS** (automated; RPC-kill not simulated manually) |
| V12 | Responsive + theme fidelity | `node scripts/responsive-check.mjs` (375px, no horizontal scroll, no console errors, direct-load shell), `node scripts/theme-check.mjs` (vs `docs/design/theme.png`), **live**: `live-check.mjs` at 375×812 and 1280×800 — scrollWidth == innerWidth both | **PASS** |
| V13 | Public deployment | `node scripts/live-check.mjs https://token-vesting-lyart.vercel.app`: HTTP 200 anonymous (no login), landing h1 visible in **644 ms desktop / 510 ms mobile** (< 3 s), "Connect Wallet" entry point visible (screenshot), full-bundle secret scan = **0 hits** | **PASS** |
| V14 | Deep-link refresh (SPA routing) | `live-check.mjs`: **direct** `GET /dashboard` → HTTP 200 + app shell rendered (React root, `header`, `main`) at both viewports; `/create` and unknown `/nope` also 200 with the shell | **PASS** |

## Quality gates (final phase run)

| Gate | Result |
| ---- | ------ |
| `forge fmt --check`, `forge build --deny warnings` | PASS |
| `forge test` | 57 printed suites (62 functions incl. 6 invariant groups), seed `0x5eed` |
| `./script/coverage-gate.sh` | PASS (≥ 95 % lines on `src/`) |
| `frontend`: `lint`, `typecheck`, `vitest run` (211 tests / 20 files), `build` | PASS |
| CI (`gh run` on `45716ef`) | Contracts + Frontend jobs GREEN |
| `./script/smoke.sh` (anvil, this run) | **8/8 PASS** |
| `script/smoke-sepolia.sh` (Sepolia) | **8/8 PASS** |
| `node scripts/live-check.mjs <live-url>` | **PASS (exit 0)** |
| `live-e2e.mjs … deployer` / `… owner` (stub wallet) | **PASS / PASS (exit 0)** |

## Notes & deviations (honesty record)

1. **V4–V6 time travel ran on anvil, not Sepolia** — `evm_increaseTime` only
   exists on a local node; on Sepolia the same math is exercised by the fuzz
   and unit suites, and pre-cliff behavior was verified live (V3/V7).
2. **Duplicate schedule id=2** (Sepolia, 100 TEST) was created by a transient
   parser bug in the first smoke run; it is disclosed in the README table and
   left on chain — nothing is hidden.
3. **`live-e2e.mjs` runs 1–2 left schedules #4 and #5** (development attempts;
   both transactions succeeded on chain) — the passing run is **#6**.
4. **The create flow never renders a lingering "…: Confirmed" chip**:
   `useCreateSchedule` sets `created` and calls `onConfirmed()` back-to-back,
   so React swaps to the T030 confirmation view in the same commit. "Confirmed"
   is therefore asserted via the receipt-gated confirmation view + on-chain
   receipt status 1 + tx-hash binding. A genuine Pending → Confirmed chip cycle
   was observed on the faucet (`Test tokens: Confirmed`) before the 24 h
   `FaucetCooldown` kicked in; later runs show the friendly cooldown sentence.
5. **`VITE_WALLETCONNECT_PROJECT_ID` is not set on Vercel** — injected wallets
   (MetaMask) work via the documented fallback; WalletConnect pairing is the
   one documented manual follow-up (README § Environment).
