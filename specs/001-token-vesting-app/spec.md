# Feature Specification: Token Vesting Web App

**Feature Branch**: `001-token-vesting-app`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "Build a Token Vesting web app: Foundry smart contracts plus a public website. WHAT: A grantor locks ERC-20 tokens into a vesting schedule for a beneficiary. Tokens unlock after a cliff, then in periodic intervals until fully vested. The beneficiary connects a wallet and claims what has vested. USERS: Grantor - creates and funds vesting schedules; Beneficiary - views schedules, claims vested tokens. CORE BEHAVIOR (reference prototype: docs/reference/TokenVestingPrototype.sol): Schedule params: token, beneficiary, start time, cliff (months), total duration (months), total amount; nothing is releasable before the cliff; after the cliff, tokens vest in discrete intervals (90 days) proportional to total intervals; fully vested at start + duration; release() sends only the currently releasable amount to the beneficiary and can never exceed the total amount; views: vestedAmount, releasableAmount, released. CONTRACT REQUIREMENTS: verify the schedule is fully funded; validate inputs (non-zero token and beneficiary, valid start, duration at least one interval, no division by zero); safe token transfers; events (ScheduleCreated, TokensReleased); a factory so one grantor can create many schedules without redeploying; test ERC-20 (OpenZeppelin, owner-mintable), reference: docs/reference/SollyWeb3.sol; correct spelling in all public names (beneficiary, not benficiary). WEB APP: connect and disconnect wallet, handle wrong network and rejected transactions; grantor create-schedule form with validation, funding flow (approve, then create); beneficiary dashboard listing their schedules, vesting progress, timeline chart, claim button, transaction status (pending, confirmed, failed); loading, empty, and error states everywhere; responsive layout; visual theme: follow docs/design/theme.md and docs/design/theme.png; publicly deployed and linked from the repo README. OUT OF SCOPE (v1): revocation, multi-token bundles, mainnet."

## Clarifications

### Session 2026-10-04

- Q: When may a vesting schedule start, and how is the start time entered? → A: Start must
  be now or in the future, never in the past; the UI uses a date picker converted to a Unix
  timestamp, and creation rejects any start earlier than the creation time.
- Q: Which duration and cliff values are valid? → A: The total duration must be an exact
  positive multiple of the 90-day interval, and the cliff must also be a multiple of the
  interval and ≤ the duration; anything else is rejected at creation with a clear UI error.
  Months are 30-day months (per the reference prototype), so valid durations are 3, 6, 9, …
  months and valid cliffs are 0, 3, 6, … months up to the duration.
- Q: How is a schedule funded, and can an unfunded schedule ever exist? → A: The factory
  pulls the full amount from the grantor via transferFrom in the same create transaction
  (after approve); a schedule can never exist unfunded — creation reverts atomically
  otherwise.
- Q: Who is allowed to trigger a release, and who receives the tokens? → A: Anyone may call
  release(); tokens always go to the beneficiary.
- Q: Which tokens are supported in v1? → A: Standard ERC-20 only. Fee-on-transfer and
  rebasing tokens are unsupported — creation reverts if the received balance differs from
  the requested amount.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Grantor creates and funds a vesting schedule (Priority: P1)

A grantor opens the site, connects their wallet, fills in a create-schedule form
(token, beneficiary, start time, cliff in months, total duration in months, total
amount), approves the token spend, and confirms creation. The full amount is
locked into a new schedule that the grantor can immediately see listed, with the
exact parameters entered.

**Why this priority**: Nothing else in the product can exist until schedules can
be created and funded. This is the foundation of the system and the first slice
that can be independently demonstrated: after this story, tokens are verifiably
locked and a schedule record exists.

**Independent Test**: With a connected wallet holding test tokens, create and
fund a schedule with valid inputs and verify that (a) the tokens left the
grantor's wallet and are held for the schedule, (b) the schedule appears with
the exact parameters entered, and (c) each invalid input is rejected with a
specific message before any wallet prompt appears.

**Acceptance Scenarios**:

1. **Given** a connected wallet on the supported network with sufficient token
   balance, **When** the grantor enters a valid schedule (token, beneficiary, a
   start time of now or later, a cliff that is a multiple of the 90-day interval
   and ≤ duration, a duration that is a positive multiple of the 90-day interval,
   amount > 0 and ≤ balance), approves the spend, and confirms creation, **Then**
   the schedule is created, fully funded by that same transaction, and listed
   with the exact parameters entered.
2. **Given** the grantor enters a zero/empty token or beneficiary, a start time
   in the past, a duration that is not a positive multiple of the 90-day
   interval, a cliff that is not a multiple of the interval or that exceeds the
   duration, or an amount of zero, **When** they attempt to submit, **Then**
   creation is blocked with a specific inline error and no wallet prompt is
   shown.
3. **Given** the grantor has not previously approved enough token spending,
   **When** they submit the form, **Then** the app requests the token approval
   first and requests schedule creation only after the approval confirms; the
   create transaction then pulls the full amount in that same transaction.
4. **Given** the grantor rejects the wallet approval or the creation
   transaction, **When** the wallet reports the rejection, **Then** the app
   shows a cancelled/failed status, keeps the entered form data, and no schedule
   is created.
5. **Given** the approval succeeded but schedule creation failed (e.g., network
   error or out of gas), **When** the failure is reported, **Then** the app
   shows a failed status with a retry that does not re-ask for an approval that
   is still sufficient.
6. **Given** a grantor who already has one or more schedules, **When** they
   create another schedule, **Then** it succeeds with no additional setup,
   deployment, or configuration steps.
7. **Given** the deployed test token, **When** the grantor needs an initial
   balance to create demonstration schedules, **Then** the token's owner can
   mint test tokens to any address, and those tokens can be used to fund a
   schedule.
8. **Given** a schedule has just been created, **When** its creation record is
   inspected, **Then** a publicly visible `ScheduleCreated` record exists with
   the schedule's parameters, so history can be displayed by the site or a
   block explorer.

---

### User Story 2 - Beneficiary views schedules and claims vested tokens (Priority: P2)

A beneficiary connects their wallet and sees a dashboard listing every schedule
created for them: token, total amount, amount already released, currently
releasable amount, a vesting progress indicator, and a timeline marking the
start, the cliff, each 90-day unlock point, and the end date. When tokens are
releasable, the beneficiary presses the claim button and receives exactly the
currently releasable amount.

**Why this priority**: This is the payoff of the product - the reason tokens are
locked in the first place. It depends on schedules existing, so it follows P1,
but it is independently testable against any pre-existing funded schedule.

**Independent Test**: Given a funded schedule, advance time across the cliff and
90-day interval boundaries and verify that displayed vested, releasable, and
released values match the schedule's rules exactly, and that a claim transfers
exactly the displayed releasable amount.

**Acceptance Scenarios**:

1. **Given** a schedule viewed before its cliff, **When** the dashboard loads,
   **Then** the releasable amount is zero, the claim button is disabled with a
   clear "nothing vested yet" explanation, and no claim transaction can be
   started.
2. **Given** the current time is at or after the cliff and at least one full
   90-day interval has been completed since the start, **When** the dashboard
   loads, **Then** the releasable amount equals (completed intervals ÷ total
   intervals) × total amount, minus anything already released, and the claim
   button is enabled.
3. **Given** a releasable amount greater than zero, **When** the beneficiary
   presses claim and confirms in their wallet, **Then** exactly that amount is
   transferred to the beneficiary, the released value increases by that amount,
   the schedule never reports released greater than total, and the transaction
   reaches a confirmed status.
4. **Given** a schedule with previous partial claims, **When** more intervals
   complete and the dashboard is viewed again, **Then** only the newly vested
   amount is releasable and previously claimed amounts cannot be claimed again.
5. **Given** the current time is at or after start + duration, **When** the
   dashboard loads, **Then** the entire remainder (total − released) is
   releasable, and after claiming it, releasable is zero and progress shows
   100%.
6. **Given** a connected wallet that is the beneficiary of no schedules,
   **When** the dashboard loads, **Then** an empty state explains that no
   schedules exist for this wallet and how one is created.
7. **Given** a wallet that is not the beneficiary of a schedule, **When** it is
   connected, **Then** the dashboard does not offer a claim action for that
   schedule (on-chain release is permissionless, but the dashboard only serves
   the connected wallet's own schedules).
8. **Given** a completed claim, **When** its release record is inspected,
   **Then** a publicly visible `TokensReleased` record exists showing the
   schedule and the amount released, so history can be displayed by the site or
   a block explorer.

---

### User Story 3 - Resilient wallet and transaction experience (Priority: P3)

Every flow gives clear, continuous feedback: the app detects when the wallet is
on the wrong network and guides a switch, shows pending → confirmed/failed
status for every transaction it starts, and presents loading, empty, and error
states (with retry) wherever data is fetched. All of this works on phones and
desktops.

**Why this priority**: Without this, the P1/P2 flows are technically possible
but unreliable and confusing; it makes the product trustworthy enough for real
users.

**Independent Test**: Connect a wallet on an unsupported network, reject a
transaction, throttle or break the data connection, and load the app at a
375px-wide viewport - each must produce the guided behavior described below
rather than a silent hang or broken layout.

**Acceptance Scenarios**:

1. **Given** a wallet connected to an unsupported network, **When** the user
   attempts any action that writes to the chain, **Then** the app prompts to
   switch to the supported network and blocks the action until the switch
   succeeds.
2. **Given** a transaction has been submitted, **When** it is awaiting
   confirmation, **Then** a visible pending status is shown, and it transitions
   to confirmed or failed with a clear message and, where available, a link to
   view the transaction.
3. **Given** chain data is still loading, **When** a screen renders, **Then**
   loading placeholders are shown instead of empty or misleading content; **given**
   data fails to load, **Then** an error state with a retry control is shown.
4. **Given** a wallet that is not installed or not connected, **When** the user
   chooses to connect, **Then** the app offers clear guidance instead of failing
   silently.
5. **Given** any screen at a mobile viewport (375px wide), **When** it is used
   end to end, **Then** all controls remain reachable and readable with no
   horizontal scrolling or overlapping elements.
6. **Given** a connected wallet, **When** the user disconnects, **Then** the
   app returns to its public state (no address shown, no wallet-specific
   content), and reconnecting restores the user's schedules.

---

### User Story 4 - Public, themed, discoverable site (Priority: P4)

The site is publicly reachable without any login, follows the agreed visual
theme, and is linked from the repository README so anyone can find and use it.

**Why this priority**: Delivery polish and reach - the flows must exist first,
but the product is only "done" when the public can access it as specified.

**Independent Test**: Open the repository README, follow the deployment link in
a clean browser (no wallet connected), and verify the landing experience renders
per the design theme and offers the connect/create/dashboard entry points.

**Acceptance Scenarios**:

1. **Given** a visitor with no account and no wallet connected, **When** they
   open the deployed site, **Then** the landing page renders with public
   content and clear entry points to connect a wallet, with no login required.
2. **Given** the design references (`docs/design/theme.md` and
   `docs/design/theme.png`), **When** the site is compared against them, **Then**
   colors, typography, spacing, and component styling match the documented
   theme.
3. **Given** the repository README, **When** it is read, **Then** it contains a
   working link to the publicly deployed site.
4. **Given** a first-time visitor on a slow connection, **When** they open the
   site, **Then** the page becomes usable within a few seconds and shows
   loading feedback until then.

---

### Edge Cases

- Claim attempted exactly at a cliff or interval boundary: the boundary counts
  as reached (timestamp ≥ boundary ⇒ those tokens are vested).
- Duration or cliff that is not an exact multiple of the 90-day interval (e.g.,
  a 4- or 5-month duration, or a 1-month cliff): rejected at creation with a
  clear UI error; no wallet prompt is shown.
- Cliff equal to duration (both interval multiples): nothing releasable until
  start + duration, then the full remainder is claimable. Cliff greater than
  duration: rejected as invalid.
- Start time earlier than the current time, chosen in the date picker: rejected
  as an invalid start - only now-or-future starts are allowed.
- Total amount of zero: rejected - a schedule must lock a positive amount.
- Beneficiary equal to the grantor (self-vesting): allowed.
- Multiple claims within the same interval: the second attempt finds zero
  releasable; the UI blocks it and the release operation fails with a clear
  "nothing to release" error rather than sending a zero-value transfer.
- A third party triggers release on someone else's schedule: allowed - the
  tokens always go to the beneficiary, and the dashboard's claim button remains
  the beneficiary's UI path.
- Grantor's balance or token approval drops between form entry and submission:
  the create transaction reverts atomically (no schedule exists) and the app
  shows a clear funding error.
- Fee-on-transfer or rebasing tokens: unsupported in v1 - creation reverts if
  the balance received differs from the requested amount, so no schedule is
  ever created for such a token.
- RPC/chain unavailable while the dashboard loads: error state with retry, no
  blank screen.
- Transaction pending when the user refreshes the page: pending status is
  recovered or the state is re-derived on reload so the user is never left with
  a stale "success" or missing record.
- Schedules whose beneficiary never returns: funds remain locked (revocation is
  out of scope for v1 - see Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

**Schedule creation and validation**

- **FR-001**: A grantor MUST be able to create a vesting schedule that locks a
  total amount of one chosen token for one beneficiary, with a start time, a
  cliff in months, and a total duration in months.
- **FR-002**: Schedule creation MUST be fully funded atomically: the factory
  MUST pull the full total amount from the grantor (transferFrom) in the same
  create transaction, after approval; if the pull fails for any reason the
  creation reverts and no schedule exists - a schedule can never exist
  unfunded.
- **FR-003**: The system MUST reject invalid schedule inputs: zero token, zero
  beneficiary, a start time in the past (only now-or-future starts are valid;
  the UI collects the start via a date picker converted to a Unix timestamp), a
  duration that is not an exact positive multiple of the 90-day interval, a
  cliff that is not a multiple of the 90-day interval or that exceeds the
  duration, and a total amount of zero; no calculation may divide by zero under
  any input.
- **FR-004**: One grantor MUST be able to create many schedules through a single
  deployed system with no redeployment or per-schedule setup.
- **FR-005**: All public names in the system MUST be spelled correctly -
  `beneficiary` everywhere, never `benficiary`.
- **FR-006**: Token transfers MUST be safe: creation MUST revert if the amount
  actually received differs from the amount requested (rejecting fee-on-transfer
  and rebasing tokens), amounts transferred can never exceed balances held, and
  a failed transfer MUST NOT leave a schedule in a half-created or inconsistent
  state.

**Vesting behavior and release**

- **FR-007**: Nothing MUST be releasable before the cliff is reached.
- **FR-008**: After the cliff, tokens vest in discrete 90-day intervals -
  releasable amount = (completed intervals ÷ total intervals) × total amount,
  minus amounts already released.
- **FR-009**: The schedule MUST be fully vested at start + duration, at which
  point every interval is complete.
- **FR-010**: Releasing MUST be callable by anyone, and tokens MUST always be
  sent to the beneficiary; a release MUST send only the currently releasable
  amount, and the cumulative released amount MUST NEVER exceed the total amount.
- **FR-011**: The system MUST expose the views `vestedAmount`, `releasableAmount`,
  and `released` for every schedule.
- **FR-012**: The system MUST emit an event when a schedule is created
  (`ScheduleCreated`) and when tokens are released (`TokensReleased`), so the
  website and explorers can show history.
- **FR-013**: A release attempted when nothing is releasable MUST fail with a
  clear error instead of performing a zero-value transfer.

**Test token**

- **FR-014**: The system MUST provide a standard test ERC-20 token with
  owner-controlled minting so grants can be funded for demonstration and
  testing (reference: `docs/reference/SollyWeb3.sol`).
- **FR-014a**: The test token MUST also expose a public `faucet()` that mints
  a fixed 1,000 tokens (18 decimals) to the caller, limited to once per 24
  hours per address (custom error `FaucetCooldown()`). The create-schedule
  page MUST offer a "Get test tokens" button that triggers it with the same
  pending/confirmed/failed transaction status as every other write action.

**Web app - wallet**

- **FR-015**: Users MUST be able to connect and disconnect their wallet, and the
  connected address and network MUST be visible while connected.
- **FR-016**: The app MUST detect a wrong network, prompt the user to switch,
  and block chain-writing actions until the correct network is active.
- **FR-017**: Rejected or failed transactions MUST produce a clear, friendly
  failure message, MUST NOT corrupt any displayed state, and MUST leave the
  user able to retry.

**Web app - grantor flow**

- **FR-018**: The grantor create-schedule form MUST validate every FR-003 rule
  inline, before any wallet prompt is shown, and MUST display "1 month = 30
  days" wherever the cliff or duration is entered so the month convention is
  never a surprise.
- **FR-019**: The funding flow MUST be sequenced as token approval first, then
  schedule creation (which pulls the full amount in that transaction), reusing
  an existing sufficient approval instead of re-requesting it.

**Web app - beneficiary flow**

- **FR-020**: The beneficiary dashboard MUST list all schedules for the
  connected wallet showing token, total amount, released, releasable, vesting
  progress, and a timeline marking start, cliff, each 90-day unlock, and end.
- **FR-021**: A claim button MUST be enabled if and only if the releasable
  amount is greater than zero, and MUST claim exactly the currently releasable
  amount.
- **FR-022**: Every write action MUST show transaction status: pending,
  confirmed, or failed, visible until acknowledged.
- **FR-023**: Every screen MUST provide loading, empty, and error states, with a
  retry control wherever data can fail to load.
- **FR-024**: The layout MUST be responsive and fully usable on mobile (from
  375px width) and desktop viewports.

**Delivery**

- **FR-025**: The visual theme MUST follow `docs/design/theme.md` and
  `docs/design/theme.png`.
- **FR-026**: The site MUST be publicly deployed with no login required, and the
  repository README MUST link to it.

### Key Entities

- **Vesting Schedule**: The core record. Attributes: token, beneficiary, start
  time, cliff (months), total duration (months), total amount, amount released
  to date. Constraints: start is now-or-future at creation; duration is a
  positive multiple of the 90-day interval; cliff is an interval multiple ≤
  duration; total amount > 0; the full amount is pulled at creation.
  Derived state over time: Not started → Cliff (locked) → Vesting
  (partially claimable) → Fully vested. Relationships: created by one grantor,
  belongs to one beneficiary, references one token.
- **Token**: The ERC-20 asset locked in schedules; key attributes: name,
  symbol, decimals, holder balances, spending allowances. In v1 this is a
  standard test token with owner-controlled minting; fee-on-transfer and
  rebasing tokens are rejected at creation.
- **Wallet Session**: The user's connection to the app: connected address,
  selected network, connection state (disconnected, connected, wrong network).
- **Transaction**: A user-initiated write action (approve, create schedule,
  claim). Attributes: type, status (pending, confirmed, failed), reference for
  inspection, and the schedule or token it affects.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A grantor with test tokens can create and fund a schedule in
  under 3 minutes on their first attempt, including the token approval step.
- **SC-002**: A beneficiary with a funded, partially vested schedule can claim
  vested tokens in under 1 minute from opening the dashboard.
- **SC-003**: In 100% of test schedules, zero tokens are releasable before the
  cliff is reached.
- **SC-004**: Across full-duration test scenarios, the amount ever released
  equals the total amount exactly after end-of-duration claim (0 tokens
  stranded, 0 tokens over-released) in 100% of cases.
- **SC-005**: 100% of user-initiated transactions reach a visible terminal
  status (confirmed or failed) - no user is ever left without feedback.
- **SC-006**: All core flows (create, fund, browse, claim) complete without
  layout defects at 375px mobile width and on desktop; 0 blocking UI defects in
  the acceptance run.
- **SC-007**: At least 90% of first-time testers complete their primary flow
  (grantor: create+fund, beneficiary: claim) without assistance.
- **SC-008**: The deployed site loads and becomes usable within 3 seconds on a
  standard broadband connection, and is reachable from the README with no
  login.

## Assumptions

- **Out of scope for v1** (per the feature description): revocation of
  schedules, multi-token bundles, and mainnet - v1 targets a public test
  network plus a local development chain.
- The design inputs `docs/design/theme.md` and `docs/design/theme.png` (the
  "Plinth" design-system reference) and the reference contracts
  `docs/reference/TokenVestingPrototype.sol` and `docs/reference/SollyWeb3.sol`
  are present in the repository and are authoritative inputs for later phases.
  The prototype is reference-only and documents known bugs in its header - it
  MUST NOT be copied as-is.
- Months are 30-day months (per the reference prototype) and vesting intervals
  are fixed 90 days; the total duration must be a positive whole multiple of
  the interval (3, 6, 9, … months) and the cliff must be an interval multiple
  (0, 3, 6, … months) not exceeding the duration. A cliff of 0 months (no
  cliff) is allowed. Invalid combinations are rejected at creation with a clear
  UI error.
- Start must be now or in the future, never in the past (no retroactive
  cliffs); the UI collects it with a date picker converted to a Unix timestamp.
- Time is measured by the underlying network's block time; a boundary counts as
  reached when block time ≥ boundary.
- Only standard ERC-20 tokens are supported; fee-on-transfer and rebasing
  tokens are rejected at creation because creation reverts when the amount
  received differs from the amount requested.
- Users have a browser wallet extension; write actions require it, while
  read-only browsing of public content works without one. Users pay their own
  transaction fees in the network's native currency.
- One beneficiary per schedule; a grantor may create a schedule for themselves.
- Existing sufficient token approvals are reused rather than re-requested.
- v1 surfaces schedules to the connected wallet that is the beneficiary (the
  beneficiary dashboard); a grantor management dashboard is out of scope for v1
  - grantors receive a creation confirmation, the emitted creation record, and
  transaction status instead.
- Correct spelling (`beneficiary`) is a hard requirement across contract names,
  events, views, form fields, and UI copy.
