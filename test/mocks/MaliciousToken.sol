// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal surface the attack needs — `release(uint256)`.
interface IReleasable {
    function release(uint256 id) external;
}

/// @title MaliciousToken
/// @notice T033 — test fixture: an ERC-20 that attempts exactly one re-entrant
///         `release(id)` call during its first transfer after `setAttack`, then
///         records whether the re-entrancy attempt was reverted. Used to prove
///         `VestingFactory.release` is protected by `nonReentrant` (FR-010, US2).
/// @dev Test-only contract — never deployed to a public network.
contract MaliciousToken is ERC20 {
    /// @notice Re-entrancy target (the factory), set by `setAttack`.
    address public attackTarget;
    /// @notice Schedule id the attack will try to re-release.
    uint256 public attackScheduleId;
    /// @notice Whether the attack fired at least once.
    bool public reentryAttempted;
    /// @notice Outcome of the attack: `true` when the re-entrant call reverted.
    bool public reentryReverted;

    /// @dev Re-entrancy latch so the hook cannot recurse forever.
    bool internal inTransfer;

    /// @notice Deploys the fixture token.
    constructor() ERC20("Malicious Token", "EVIL") { }

    /// @notice Open mint — fixture helper so tests can fund grantors.
    /// @param to Recipient of the newly minted tokens.
    /// @param amount Amount in base units (18 decimals).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arms the re-entrancy attack for the next eligible transfer.
    /// @param target Contract to re-enter (`VestingFactory`).
    /// @param id Schedule id passed to `release`.
    function setAttack(address target, uint256 id) external {
        attackTarget = target;
        attackScheduleId = id;
    }

    /// @dev OpenZeppelin v5 transfer hook: after balances move, attempt one
    ///      re-entrant `release`. A blocked attempt is recorded, never propagated,
    ///      so the outer transfer still settles normally.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (
            from != address(0) && to != address(0) && !inTransfer && !reentryAttempted
                && attackTarget != address(0)
        ) {
            inTransfer = true;
            reentryAttempted = true;
            try IReleasable(attackTarget).release(attackScheduleId) {
                reentryReverted = false;
            } catch {
                reentryReverted = true;
            }
            inTransfer = false;
        }
    }
}
