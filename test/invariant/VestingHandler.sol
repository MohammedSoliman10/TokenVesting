// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";
import { TestToken } from "../../src/TestToken.sol";
import { VestingFactory } from "../../src/VestingFactory.sol";

/// @notice T035 — bounded invariant handler for `VestingFactory` (US2, SC-003, SC-004).
/// @dev Written to satisfy `invariant.fail_on_revert = true` (foundry.toml): when the
///      implementation is correct, no entry point below can revert — amounts are bounded to
///      `<= 1e30`, months to {3..120}, time only moves forward, and the expected
///      `NothingToRelease()` reverts of `release` are absorbed with a low-level call.
///      Deliberately NOT a `Test` contract, so the invariant runner only targets the three
///      `public` functions declared here (all getters are `view` and are never called back).
contract VestingHandler {
    /// @dev hevm cheat-code address (same value forge-std derives from keccak256).
    Vm internal constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    /// @notice Factory under test.
    VestingFactory public factory;
    /// @notice Vesting token (also the balance measured by the sum invariant).
    TestToken public token;
    /// @notice Receives every vesting payout (FR-005, spelled `beneficiary`).
    address public beneficiary;

    /// @notice SC-004 ghost: highest `released` ever observed per schedule id.
    mapping(uint256 => uint256) public maxReleasedSeen;
    /// @notice Ghost: cumulative tokens released across all schedules.
    uint256 public ghostSumReleased;

    /// @param factory_ Factory under test.
    /// @param token_ Token the schedules vest.
    /// @param beneficiary_ Payout receiver for every schedule.
    constructor(VestingFactory factory_, TestToken token_, address beneficiary_) {
        factory = factory_;
        token = token_;
        beneficiary = beneficiary_;
        // One blanket approval for every handler-initiated create (never revoked).
        token.approve(address(factory_), type(uint256).max);
    }

    /// @dev Self-contained bounded helper — this contract does not inherit forge-std's Test.
    function _bound(uint256 x, uint256 min, uint256 max) internal pure returns (uint256) {
        return min + (x % (max - min + 1));
    }

    /// @notice Creates a fully funded schedule with spec-bounded parameters
    ///         (amount <= 1e30, months in {3..120}, zero-cliff-compatible start = now).
    function createSchedule(uint256 amountSeed, uint256 durationSeed, uint256 cliffSeed) external {
        uint256 amount = _bound(amountSeed, 1, 1e30);
        uint256 durationMonths = 3 * _bound(durationSeed, 1, 40); // {3, 6, ..., 120}
        uint256 cliffMonths = 3 * _bound(cliffSeed, 0, durationMonths / 3);
        factory.createSchedule(address(token), beneficiary, 0, cliffMonths, durationMonths, amount);
    }

    /// @notice Moves time strictly forward by at most 180 days (never backwards).
    function warp(uint256 dtSeed) external {
        vm.warp(block.timestamp + _bound(dtSeed, 1, 180 days));
    }

    /// @notice Releases a pseudo-random existing schedule. Expected `NothingToRelease()`
    ///         reverts are absorbed; successful payouts update the SC-004 ghosts.
    function releaseSchedule(uint256 idSeed) external {
        uint256 count = factory.scheduleCount();
        if (count == 0) {
            return;
        }
        uint256 id = _bound(idSeed, 1, count);
        uint256 beforeReleased = factory.released(id);
        (bool ok,) = address(factory).call(abi.encodeCall(VestingFactory.release, (id)));
        if (ok) {
            uint256 nowReleased = factory.released(id);
            if (nowReleased > maxReleasedSeen[id]) {
                maxReleasedSeen[id] = nowReleased;
            }
            ghostSumReleased += nowReleased - beforeReleased;
        }
    }
}
