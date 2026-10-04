// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestToken } from "../../src/TestToken.sol";
import { VestingFactory } from "../../src/VestingFactory.sol";

/// @notice T019 — validation matrix for `createSchedule` (FR-003, data-model V1–V6).
///         Written BEFORE the implementation (constitution II). Validation must run
///         before any funding/state, so invalid inputs fail even for a grantor with
///         no balance — which is exactly what these tests exercise.
contract VestingFactoryValidationTest is Test {
    VestingFactory internal factory;
    TestToken internal token;

    address internal grantor = makeAddr("grantor");
    address internal beneficiary = makeAddr("beneficiary");

    uint256 internal constant AMOUNT = 100 ether;

    function setUp() public {
        factory = new VestingFactory();
        token = new TestToken();

        // Realistic clock so "past start" tests cannot collide with the 0-sentinel.
        vm.warp(1_700_000_000);

        // NOTE: funding (owner mint + approve) happens inside the happy-path tests,
        // not here — `mint` is stubbed too, and a setUp() failure would abort the
        // whole suite instead of failing each test on its own expectation.
    }

    /// @dev Fund + approve the grantor for the happy-path tests. The revert tests
    ///      intentionally skip this: validation must fire BEFORE any funding (R3).
    function _fundGrantor() internal {
        token.mint(grantor, AMOUNT);
        vm.prank(grantor);
        token.approve(address(factory), type(uint256).max);
    }

    /// @dev Otherwise-valid arguments: valid token, beneficiary, start-now, no cliff,
    ///      6-month duration, positive amount. Each test perturbs exactly one input.
    function _validParams()
        internal
        view
        returns (
            address token_,
            address beneficiary_,
            uint256 start_,
            uint256 cliffMonths_,
            uint256 durationMonths_,
            uint256 amount_
        )
    {
        return (address(token), beneficiary, 0, 0, 6, AMOUNT);
    }

    /// V1: zero token → ZeroAddress().
    function test_Create_RevertsOnZeroToken() public {
        (, address b, uint256 s, uint256 c, uint256 d, uint256 a) = _validParams();
        vm.expectRevert(VestingFactory.ZeroAddress.selector);
        factory.createSchedule(address(0), b, s, c, d, a);
    }

    /// V2: zero beneficiary → ZeroAddress().
    function test_Create_RevertsOnZeroBeneficiary() public {
        (address t,, uint256 s, uint256 c, uint256 d, uint256 a) = _validParams();
        vm.expectRevert(VestingFactory.ZeroAddress.selector);
        factory.createSchedule(t, address(0), s, c, d, a);
    }

    /// V3: non-zero start in the past → InvalidStart().
    function test_Create_RevertsOnPastStart() public {
        (address t, address b,, uint256 c, uint256 d, uint256 a) = _validParams();
        vm.expectRevert(VestingFactory.InvalidStart.selector);
        factory.createSchedule(t, b, block.timestamp - 1, c, d, a);
    }

    /// V4: durationMonths == 0 → InvalidDuration().
    function test_Create_RevertsOnZeroDuration() public {
        (address t, address b, uint256 s, uint256 c,, uint256 a) = _validParams();
        vm.expectRevert(VestingFactory.InvalidDuration.selector);
        factory.createSchedule(t, b, s, c, 0, a);
    }

    /// V4: durationMonths not a multiple of 3 (4 months) → InvalidDuration().
    function test_Create_RevertsOnNonMultipleDuration() public {
        (address t, address b, uint256 s, uint256 c,, uint256 a) = _validParams();
        vm.expectRevert(VestingFactory.InvalidDuration.selector);
        factory.createSchedule(t, b, s, c, 4, a);
    }

    /// V5: cliffMonths not a multiple of 3 (1 month) → InvalidCliff().
    function test_Create_RevertsOnNonMultipleCliff() public {
        (address t, address b, uint256 s,, uint256 d, uint256 a) = _validParams();
        vm.expectRevert(VestingFactory.InvalidCliff.selector);
        factory.createSchedule(t, b, s, 1, d, a);
    }

    /// V5: cliff (6 months) longer than duration (3 months) → InvalidCliff().
    function test_Create_RevertsOnCliffLongerThanDuration() public {
        (address t, address b, uint256 s,,, uint256 a) = _validParams();
        vm.expectRevert(VestingFactory.InvalidCliff.selector);
        factory.createSchedule(t, b, s, 6, 3, a);
    }

    /// V6: amount == 0 → ZeroAmount().
    function test_Create_RevertsOnZeroAmount() public {
        (address t, address b, uint256 s, uint256 c, uint256 d,) = _validParams();
        vm.expectRevert(VestingFactory.ZeroAmount.selector);
        factory.createSchedule(t, b, s, c, d, 0);
    }

    /// Start rule: start == 0 resolves to block.timestamp at creation.
    function test_Create_StartZeroResolvesToBlockTimestamp() public {
        _fundGrantor();
        (address t, address b,, uint256 c, uint256 d, uint256 a) = _validParams();

        vm.prank(grantor); // the funding pull happens from msg.sender
        uint256 id = factory.createSchedule(t, b, 0, c, d, a);

        VestingFactory.Schedule memory schedule = factory.getSchedule(id);
        assertEq(id, 1, "ids auto-increment from 1");
        assertEq(schedule.start, block.timestamp, "0 sentinel resolved to now");
        assertEq(schedule.beneficiary, b, "V2 identifier spelled beneficiary");
        assertEq(schedule.grantor, grantor, "grantor is msg.sender");
        assertEq(schedule.totalAmount, a);
    }

    /// Start rule: a future start is stored unchanged.
    function test_Create_FutureStartStoredUnchanged() public {
        _fundGrantor();
        (address t, address b,, uint256 c, uint256 d, uint256 a) = _validParams();
        uint256 future = block.timestamp + 30 days;

        vm.prank(grantor); // the funding pull happens from msg.sender
        factory.createSchedule(t, b, future, c, d, a);

        assertEq(factory.getSchedule(1).start, future, "future start kept verbatim");
    }

    /// V5 boundary: cliff equal to the duration is valid (<=, not <).
    function test_Create_CliffEqualToDurationIsValid() public {
        _fundGrantor();
        (address t, address b, uint256 s,,, uint256 a) = _validParams();

        vm.prank(grantor); // the funding pull happens from msg.sender
        factory.createSchedule(t, b, s, 3, 3, a);

        VestingFactory.Schedule memory schedule = factory.getSchedule(1);
        assertEq(schedule.cliffDuration, 3 * 30 days, "3 months = 90 days");
        assertEq(schedule.duration, 3 * 30 days, "3 months = 90 days");
    }

    /// V4/V5: stored durations are month counts * 30 days (data-model constants).
    function test_Create_StoresMonthDurationsInSeconds() public {
        _fundGrantor();
        (address t, address b, uint256 s,,, uint256 a) = _validParams();

        vm.prank(grantor); // the funding pull happens from msg.sender
        factory.createSchedule(t, b, s, 0, 6, a);

        VestingFactory.Schedule memory schedule = factory.getSchedule(1);
        assertEq(schedule.cliffDuration, 0, "0-month cliff");
        assertEq(schedule.duration, 6 * 30 days, "6 months = 180 days");
    }
}
