// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestToken } from "../../src/TestToken.sol";
import { VestingFactory } from "../../src/VestingFactory.sol";

/// @notice T032 — `vestedAmount`/`releasableAmount` boundaries (FR-009, US2).
///         Written BEFORE the implementation (constitution II): every case asserts the exact
///         wei amount produced by the step formula
///         `totalAmount * ((now - start) / 90 days) / (duration / 90 days)`.
contract VestingFactoryVestingTest is Test {
    VestingFactory internal factory;
    TestToken internal token;

    address internal grantor = makeAddr("grantor");
    address internal beneficiary = makeAddr("beneficiary");

    /// @dev Fixed timeline base so every warp below is exact.
    uint256 internal constant BASE = 1_700_000_000;
    /// @dev One month = 30 days (data-model constant).
    uint256 internal constant MONTH = 30 days;
    /// @dev One vesting interval: 90 days = 3 of the 30-day months.
    uint256 internal constant INTERVAL = 90 days;

    function setUp() public {
        vm.warp(BASE);
        factory = new VestingFactory();
        token = new TestToken();
        token.mint(grantor, 1e40);
        vm.prank(grantor);
        token.approve(address(factory), type(uint256).max);
    }

    /// @dev Creates a schedule starting now (= BASE), fully funded by the grantor.
    function _create(uint256 cliffMonths, uint256 durationMonths, uint256 amount)
        internal
        returns (uint256 id)
    {
        vm.prank(grantor);
        id = factory.createSchedule(
            address(token), beneficiary, 0, cliffMonths, durationMonths, amount
        );
    }

    /// FR-009: strictly before the cliff nothing is vested.
    function test_Vest_BeforeCliffMinusOneSecondIsZero() public {
        uint256 id = _create(3, 9, 900 ether);
        vm.warp(BASE + INTERVAL - 1); // cliff = 3 months = 90 days

        assertEq(factory.vestedAmount(id), 0, "vested must be 0 one second before the cliff");
        assertEq(
            factory.releasableAmount(id), 0, "releasable must be 0 one second before the cliff"
        );
        assertEq(factory.released(id), 0, "nothing released yet");
    }

    /// Exactly at the cliff: one of three intervals completed -> 900e18 * 1 / 3.
    function test_Vest_AtExactCliff() public {
        uint256 id = _create(3, 9, 900 ether);
        vm.warp(BASE + INTERVAL);

        assertEq(factory.vestedAmount(id), 300 ether, "vested = 900e18 * 1/3 at the exact cliff");
        assertEq(factory.releasableAmount(id), 300 ether, "releasable = vested while released == 0");
    }

    /// One assertion per completed 90-day interval of a 9-month (3-interval) schedule.
    function test_Vest_AtEachIntervalBoundary() public {
        uint256 id = _create(0, 9, 900 ether); // zero cliff: boundaries at 90/180/270 days

        vm.warp(BASE + INTERVAL);
        assertEq(factory.vestedAmount(id), 300 ether, "1 of 3 intervals completed");
        vm.warp(BASE + 2 * INTERVAL);
        assertEq(factory.vestedAmount(id), 600 ether, "2 of 3 intervals completed");
        vm.warp(BASE + 3 * INTERVAL);
        assertEq(factory.vestedAmount(id), 900 ether, "3 of 3 intervals = totalAmount");
    }

    /// One second before each boundary the previous boundary's amount is still vested.
    function test_Vest_OneSecondBeforeEachIntervalBoundary() public {
        uint256 id = _create(0, 9, 900 ether);

        vm.warp(BASE + INTERVAL - 1);
        assertEq(factory.vestedAmount(id), 0, "0 intervals completed at boundary 1 - 1s");
        vm.warp(BASE + 2 * INTERVAL - 1);
        assertEq(factory.vestedAmount(id), 300 ether, "1 interval completed at boundary 2 - 1s");
        vm.warp(BASE + 3 * INTERVAL - 1);
        assertEq(factory.vestedAmount(id), 600 ether, "2 intervals completed at boundary 3 - 1s");
    }

    /// One second before `start + duration` the schedule is not fully vested yet.
    function test_Vest_OneSecondBeforeStartPlusDuration() public {
        uint256 id = _create(3, 9, 900 ether);
        vm.warp(BASE + 3 * INTERVAL - 1); // start + duration - 1s = 270 days - 1s

        assertEq(factory.vestedAmount(id), 600 ether, "2 of 3 intervals one second before the end");
        assertLt(factory.vestedAmount(id), 900 ether, "not full one second before the end");
    }

    /// At `start + duration` the schedule is fully vested — and stays fully vested forever,
    /// no matter how many further intervals would have elapsed (never overshoots).
    function test_Vest_FullAtAndLongAfterStartPlusDuration() public {
        uint256 id = _create(0, 9, 900 ether);

        vm.warp(BASE + 3 * INTERVAL);
        assertEq(factory.vestedAmount(id), 900 ether, "full vesting exactly at start + duration");
        vm.warp(BASE + 3 * INTERVAL + 365 days); // far beyond one whole extra interval
        assertEq(factory.vestedAmount(id), 900 ether, "full vesting long after the end");
        assertEq(factory.releasableAmount(id), 900 ether, "everything releasable after the end");
    }

    /// Zero cliff: nothing vests at the start itself, only at completed intervals.
    function test_Vest_ZeroCliff() public {
        uint256 id = _create(0, 6, 600 ether);

        vm.warp(BASE);
        assertEq(factory.vestedAmount(id), 0, "0 of 2 intervals at the start");
        vm.warp(BASE + 1);
        assertEq(factory.vestedAmount(id), 0, "still 0 of 2 intervals one second later");
        vm.warp(BASE + INTERVAL - 1);
        assertEq(factory.vestedAmount(id), 0, "0 intervals one second before the first boundary");
        vm.warp(BASE + INTERVAL);
        assertEq(factory.vestedAmount(id), 300 ether, "600e18 * 1/2 at the first boundary");
    }

    /// Cliff equal to duration: zero until the very last second, full at the end.
    function test_Vest_CliffEqualsDuration() public {
        uint256 id = _create(6, 6, 600 ether);

        vm.warp(BASE + 6 * MONTH - 1); // 6 months = 180 days = start + duration - 1s
        assertEq(factory.vestedAmount(id), 0, "nothing vests while before a cliff == duration");
        vm.warp(BASE + 6 * MONTH);
        assertEq(factory.vestedAmount(id), 600 ether, "the cliff instant is also the end instant");
    }

    /// Rounding is floor division — an indivisible total proves the formula never rounds up.
    function test_Vest_FloorDivisionWithIndivisibleAmount() public {
        uint256 id = _create(0, 6, 5); // 5 wei over 2 intervals -> floor(5 * 1 / 2) = 2

        vm.warp(BASE + INTERVAL);
        assertEq(factory.vestedAmount(id), 2, "floor(5/2) = 2 wei - never rounds up");
        vm.warp(BASE + 2 * INTERVAL);
        assertEq(factory.vestedAmount(id), 5, "full amount once both intervals complete");
    }

    /// The exact `start + duration` instant must hit the full-vesting branch itself: for an
    /// amount whose `totalAmount * (duration / 90 days)` overflows `uint256` (1e76 * 40
    /// intervals > 2**256), falling through to the interval formula at that instant reverts
    /// with an arithmetic panic instead of returning `totalAmount` (FR-009: at/after
    /// `start + duration` = `totalAmount`).
    function test_Vest_FullVestingAtExactEndWithExtremeAmount() public {
        uint256 amount = 1e76;
        token.mint(grantor, amount);
        uint256 id = _create(0, 120, amount); // 120 months = 40 intervals

        vm.warp(BASE);
        assertEq(factory.vestedAmount(id), 0, "nothing vested at the start of an extreme schedule");
        vm.warp(BASE + 120 * MONTH); // exactly start + duration
        assertEq(factory.vestedAmount(id), amount, "extreme amount fully vested at the exact end");
    }
}
