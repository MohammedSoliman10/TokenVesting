# TestToken — External Interface

Standard owner-mintable test ERC-20 used to fund grants in development,
testing, and on Sepolia (FR-014), plus a public rate-limited faucet backing
the UI's "Get test tokens" button (FR-014a). Based on OpenZeppelin v5 `ERC20`
+ `Ownable` (reference: `docs/reference/SollyWeb3.sol` — its GitHub URL
imports are **not** used; real dependency comes via `forge install` +
remappings).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ITestToken {
    // ERC-20 standard surface (OpenZeppelin):
    // name(), symbol(), decimals(), totalSupply(), balanceOf(),
    // transfer(), allowance(), approve(), transferFrom()

    /// Owner-only mint for funding schedules.
    function mint(address to, uint256 amount) external;

    /// Public self-serve faucet: mints 1,000 tokens (18 decimals) to
    /// msg.sender, at most once per 24 hours per address (FR-014a).
    function faucet() external;

    /// Unix timestamp of `account`'s last successful faucet() call.
    function lastFaucetAt(address account) external view returns (uint256);

    function owner() external view returns (address);
    function transferOwnership(address newOwner) external;

    /// Reverted when faucet() is called again inside the 24h window.
    error FaucetCooldown();
}
```

## Behavioral contract

1. Standard ERC-20 semantics only — **no** fee-on-transfer, no rebasing, no
   hooks (these token classes are rejected at schedule creation,
   clarified decision 5).
2. `mint` is `onlyOwner`; used by the deploy script to fund the dev/grantor
   account.
3. `faucet()` mints exactly **1,000 × 10^18** base units to `msg.sender` for
   any caller, at most once per 24 hours per address; a second call inside
   the window reverts `FaucetCooldown()` (tests MUST cover both the exact
   minted amount and the cooldown, FR-014a).
4. The frontend exposes `faucet()` as a **"Get test tokens"** button on the
   create page with the standard pending → confirmed/failed transaction
   status (FR-014a, FR-022).
5. 18 decimals; frontend amount inputs are decimal strings parsed with
   `decimals` before submission.
6. Interfaces inherited from OZ v5 carry their own custom errors; the
   factory's pre-checks (`InsufficientBalance`/`InsufficientAllowance`)
   surface friendlier errors first for the common cases.
