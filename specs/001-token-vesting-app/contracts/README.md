# Interface Contracts (Phase 1)

This directory documents the **external interfaces** this feature exposes —
the on-chain API consumed by the frontend (and any explorer/SDK user).

| File | Interface |
|------|-----------|
| [VestingFactory.md](./VestingFactory.md) | Schedule creation, indexes, vesting views, release, events, errors |
| [TestToken.md](./TestToken.md) | Owner-mintable test ERC-20 |

Conventions:

- Solidity **exactly 0.8.28**, OpenZeppelin v5 via `forge install` +
  remappings (no URL imports).
- **Custom errors only** — no revert strings; frontend decodes them into
  field-level form messages (research R8).
- `beneficiary` is spelled correctly in every identifier (FR-005).
- ABIs are **generated** from `out/` into `frontend/src/contracts/abis/` by
  `script/Deploy.s.sol` — never hand-maintained (research R6).
- Signatures here are the contract of record for tests
  (TDD: write tests against these before implementation).

Related design docs: [data-model.md](../data-model.md),
[research.md](../research.md).
