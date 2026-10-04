<!--
Sync Impact Report
- Version change: template scaffold (unversioned) → 1.0.0
- Modified principles: none (initial ratification; all scaffold placeholders replaced)
- Added sections:
  - Core Principles I–V (Code Quality, Test-First, Testing Rigor,
    Maintainability, Verified Working Software)
  - Additional Constraints
  - Development Workflow & Quality Gates
  - Governance
- Removed sections: none
- Follow-up TODOs: none
-->

# TokenVesting Constitution

## Core Principles

### I. Code Quality by Default (NON-NEGOTIABLE)

- All code MUST be written to be read first: intention-revealing names, small
  single-purpose functions, and one clear responsibility per contract or module.
- Duplication that hides logic MUST be eliminated; shared logic MUST live in one
  reviewed location with one test suite covering it.
- Every public/external function MUST carry NatSpec documenting purpose,
  parameters, return values, and revert conditions.
- Clever or obscure constructs MUST NOT be merged unless a comment explains why
  the simpler alternative fails.
- Rationale: unreadable code becomes unfixable code; quality defects compound
  faster than features ship.

### II. Test-First Development (NON-NEGOTIABLE)

- Tests MUST be written before implementation for every new behavior
  (Red → Green → Refactor), and MUST fail first when the behavior does not
  yet exist — a test that never failed proves nothing.
- Bug fixes MUST ship with a regression test that fails without the fix.
- Tests MUST assert observable behavior, not implementation details, so that
  refactoring never requires rewriting the test suite.
- Rationale: test-first keeps the spec executable and prevents
  "works on my machine" claims from replacing proof.

### III. Testing Rigor and Coverage

- Every contract/module MUST have unit tests covering happy paths, edge cases,
  and failure/revert paths; every externally callable function MUST have at
  least one test.
- Core value-moving logic MUST have fuzz tests, and stateful logic MUST have
  invariant tests (Foundry: `forge test`, `forge fuzz`, `forge coverage`).
- Core contracts MUST maintain ≥95% line coverage, and a change MUST NOT
  decrease the project's coverage percentage.
- The suite MUST be deterministic: no flaky tests, no arbitrary waits, and
  reproducible fuzz/invariant runs (fixed seeds in CI when debugging).
- Test names MUST describe behavior ("reverts when claim before cliff"), not
  implementation ("test function 3").

### IV. Maintainability and Readability

- The project MUST stay easy to change: consistent layout and formatting
  (`forge fmt`), one pattern per concept, and no dead or commented-out code.
- Toolchain and dependencies MUST be pinned (solc version in `foundry.toml`,
  library versions by tag); upgrades MUST be deliberate and noted in the
  change description.
- Breaking interface changes MUST be versioned and documented with migration
  notes before merge.
- Comments MUST explain "why", never "what"; comments orphaned by code changes
  MUST be deleted in the same change.
- Rationale: maintainability is what lets the final output keep working Great
  after delivery, not just on delivery day.

### V. Verified Working Software (Definition of Done)

- "Works Great" is objective: a feature is DONE only when all of the following
  are true —
  - acceptance criteria in the spec are met and demonstrable;
  - `forge build` completes with zero warnings and `forge fmt --check` passes;
  - the full test suite passes locally and in CI (zero failures, zero skips
    without an approved reason);
  - the coverage gate in Principle III passes;
  - docs/NatSpec are updated to match the change.
- The main branch MUST always be releasable; broken or unverified states MUST
  NOT be merged.
- Final outputs MUST be smoke-verified end-to-end (build → full test run →
  exercise the actual user flow) before work is declared complete.
- Rationale: the deliverable is only valuable if it is proven to work, not
  assumed to work.

## Additional Constraints

- Foundry (forge/anvil/cast) is the primary toolchain; Solidity code MUST be
  `forge fmt`-formatted and compile without warnings.
- Correctness patterns MUST be enforced: checks-effects-interactions, explicit
  revert reasons, no unchecked arithmetic without a documented justification,
  and no floating `pragma` (pin the compiler version).
- Established, audited libraries (e.g., OpenZeppelin) MUST be preferred over
  hand-rolled implementations of token, access-control, or math logic.
- Every change MUST be traceable to a spec requirement or an approved task;
  no drive-by features.

## Development Workflow and Quality Gates

- Work proceeds in small, reviewable increments through the Spec Kit flow:
  specify → plan → tasks → implement → converge.
- Before merge, ALL gates MUST pass: build clean, format check, full tests
  green, coverage gate met, and no new unresolved static-analysis findings of
  high severity.
- Refactoring MUST be behavior-preserving and covered by existing tests before
  it begins.
- Every PR MUST be reviewed against this constitution; violations MUST be
  fixed before merge or explicitly justified and recorded in the change
  description.

## Governance

- This constitution supersedes casual conventions; where conflicts arise, the
  constitution wins until amended.
- Amendments MUST be proposed as a change to `.specify/memory/constitution.md`
  with rationale and migration impact, reviewed, then versioned: MAJOR for
  removals/redefinitions of principles, MINOR for new principles or sections,
  PATCH for clarifications and wording fixes.
- Compliance MUST be verified at each Spec Kit gate (spec, plan, tasks,
  implement, converge); reviewers and implementers are equally responsible for
  flagging violations.
- Complexity MUST be justified; when two compliant designs exist, the simpler
  one MUST be chosen.

**Version**: 1.0.0 | **Ratified**: 2026-10-04 | **Last Amended**: 2026-10-04
