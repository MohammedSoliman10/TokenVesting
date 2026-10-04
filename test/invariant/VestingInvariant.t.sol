// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestToken } from "../../src/TestToken.sol";
import { VestingFactory } from "../../src/VestingFactory.sol";
import { VestingHandler } from "./VestingHandler.sol";

/// @notice T035 — invariant suite (US2, SC-003, SC-004). Each invariant is re-checked after
///         every bounded handler call; runs/depth/`fail_on_revert` come from foundry.toml.
///         Written BEFORE the implementation (constitution II).
contract VestingInvariantTest is Test {
    VestingFactory internal factory;
    TestToken internal token;
    VestingHandler internal handler;

    address internal beneficiary = makeAddr("beneficiary");

    /// @dev Fixed timeline base so warps stay in a realistic range.
    uint256 internal constant BASE = 1_700_000_000;

    function setUp() public {
        vm.warp(BASE);
        factory = new VestingFactory();
        token = new TestToken();
        handler = new VestingHandler(factory, token, beneficiary);
        // Handler budget: depth 50 * amount bound 1e30 = 5e31 worst case << 1e38.
        token.mint(address(handler), 1e38);
        targetContract(address(handler));
    }

    /// @notice SC-004: no schedule ever releases more than its `totalAmount`.
    function invariant_ReleasedNeverExceedsTotalAmount() public view {
        uint256 count = factory.scheduleCount();
        for (uint256 id = 1; id <= count; ++id) {
            VestingFactory.Schedule memory schedule = factory.getSchedule(id);
            assertLe(
                factory.released(id), schedule.totalAmount, "released must never exceed totalAmount"
            );
        }
    }

    /// @notice SC-003: nothing is vested strictly before the cliff.
    function invariant_VestedIsZeroBeforeTheCliff() public view {
        uint256 count = factory.scheduleCount();
        for (uint256 id = 1; id <= count; ++id) {
            VestingFactory.Schedule memory schedule = factory.getSchedule(id);
            if (block.timestamp < schedule.start + schedule.cliffDuration) {
                assertEq(factory.vestedAmount(id), 0, "vested must be 0 before the cliff");
            }
        }
    }

    /// @notice Once a schedule reaches `start + duration` it is fully vested, forever.
    function invariant_VestedEqualsTotalAmountAtTheEnd() public view {
        uint256 count = factory.scheduleCount();
        for (uint256 id = 1; id <= count; ++id) {
            VestingFactory.Schedule memory schedule = factory.getSchedule(id);
            if (block.timestamp >= schedule.start + schedule.duration) {
                assertEq(
                    factory.vestedAmount(id),
                    schedule.totalAmount,
                    "vested must equal totalAmount at the end"
                );
            }
        }
    }

    /// @notice SC-004 ghost: `released` never decreases for any schedule.
    function invariant_ReleasedNeverDecreases() public view {
        uint256 count = factory.scheduleCount();
        for (uint256 id = 1; id <= count; ++id) {
            assertGe(
                factory.released(id), handler.maxReleasedSeen(id), "released must never decrease"
            );
        }
    }

    /// @notice Solvency: everything still owed (the sum of releasable across schedules) always
    ///         fits inside the factory's token balance, so every pending claim is covered.
    /// @dev NOTE: the literal rule "sum of released <= factory token balance" is
    ///      arithmetically false — the balance already has released tokens subtracted
    ///      (balance = sum(total) - sum(released)), so a fully released schedule alone makes
    ///      sum(released) > 0 = balance. The balance-facing sum is therefore checked against
    ///      what is still OWED, and "sum of released" is checked against funding below.
    function invariant_SumReleasableWithinFactoryBalance() public view {
        uint256 count = factory.scheduleCount();
        uint256 sumReleasable;
        for (uint256 id = 1; id <= count; ++id) {
            sumReleasable += factory.releasableAmount(id);
        }
        assertLe(
            sumReleasable,
            token.balanceOf(address(factory)),
            "sum(releasable) must stay within the factory token balance"
        );
    }

    /// @notice The sum of released tokens across schedules never exceeds the sum of all
    ///         amounts ever funded into the factory (cumulative payouts <= cumulative funding).
    function invariant_SumReleasedNeverExceedsFunded() public view {
        uint256 count = factory.scheduleCount();
        uint256 sumReleased;
        uint256 sumFunded;
        for (uint256 id = 1; id <= count; ++id) {
            VestingFactory.Schedule memory schedule = factory.getSchedule(id);
            sumReleased += factory.released(id);
            sumFunded += schedule.totalAmount;
        }
        assertLe(sumReleased, sumFunded, "sum(released) must never exceed the amounts ever funded");
    }
}
