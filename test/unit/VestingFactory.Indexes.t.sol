// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestToken } from "../../src/TestToken.sol";
import { VestingFactory } from "../../src/VestingFactory.sol";

/// @notice T021 — ScheduleCreated event fields and the beneficiary/grantor indexes
///         (FR-004, FR-005, FR-012). Written BEFORE the implementation (constitution II).
contract VestingFactoryIndexesTest is Test {
    /// @dev Mirror of the contract event so `expectEmit` can check every field.
    event ScheduleCreated(
        uint256 indexed id,
        address indexed grantor,
        address indexed beneficiary,
        address token,
        uint256 start,
        uint256 cliffDuration,
        uint256 duration,
        uint256 totalAmount
    );

    VestingFactory internal factory;
    TestToken internal token;

    address internal grantor = makeAddr("grantor");
    address internal beneficiary = makeAddr("beneficiary");
    address internal secondBeneficiary = makeAddr("secondBeneficiary");

    function setUp() public {
        factory = new VestingFactory();
        token = new TestToken();

        // Funding (owner mint + approve) lives in `_create` / the tests themselves:
        // `mint` is stubbed too, and a setUp() failure would abort the suite
        // instead of failing each test on its own expectation.
    }

    /// @dev Fund the grantor for exactly `amount`, then create as the grantor.
    function _create(address to, uint256 amount, uint256 start) internal returns (uint256 id) {
        token.mint(grantor, amount);
        vm.startPrank(grantor);
        token.approve(address(factory), amount);
        id = factory.createSchedule(address(token), to, start, 3, 6, amount);
        vm.stopPrank();
    }

    /// FR-012: every ScheduleCreated field matches the call that produced it.
    function test_Create_EmitsScheduleCreatedWithExactFields() public {
        // Fund FIRST: the expected event below must be matched against the
        // createSchedule call, not against an earlier mint's Transfer event.
        token.mint(grantor, 100 ether);
        vm.prank(grantor);
        token.approve(address(factory), 100 ether);

        uint256 start = block.timestamp + 1 days;

        vm.expectEmit(true, true, true, true);
        emit ScheduleCreated(
            1, // id
            grantor,
            beneficiary,
            address(token),
            start,
            3 * 30 days, // cliffDuration: 3 months
            6 * 30 days, // duration: 6 months
            100 ether
        );

        vm.prank(grantor);
        factory.createSchedule(address(token), beneficiary, start, 3, 6, 100 ether);

        assertEq(factory.scheduleCount(), 1);
    }

    /// FR-004: the beneficiary index lists that wallet's schedule ids in order.
    function test_Indexes_ListScheduleIdsPerBeneficiary() public {
        uint256 first = _create(beneficiary, 100 ether, 0);
        uint256 second = _create(beneficiary, 200 ether, 0);
        uint256 third = _create(secondBeneficiary, 300 ether, 0);

        uint256[] memory byBeneficiary = factory.getSchedulesByBeneficiary(beneficiary);
        assertEq(byBeneficiary.length, 2, "two schedules for the first beneficiary");
        assertEq(byBeneficiary[0], first, "ids in creation order");
        assertEq(byBeneficiary[1], second);

        uint256[] memory bySecond = factory.getSchedulesByBeneficiary(secondBeneficiary);
        assertEq(bySecond.length, 1);
        assertEq(bySecond[0], third);

        assertEq(
            factory.getSchedulesByBeneficiary(makeAddr("stranger")).length,
            0,
            "unknown beneficiary gets an empty list"
        );
    }

    /// FR-004: the grantor index lists everything that wallet created.
    function test_Indexes_ListScheduleIdsPerGrantor() public {
        _create(beneficiary, 100 ether, 0);
        _create(secondBeneficiary, 100 ether, 0);
        _create(beneficiary, 100 ether, 0);

        uint256[] memory byGrantor = factory.getSchedulesByGrantor(grantor);
        assertEq(byGrantor.length, 3, "three schedules from one grantor");
        assertEq(byGrantor[0], 1);
        assertEq(byGrantor[1], 2);
        assertEq(byGrantor[2], 3);

        assertEq(factory.getSchedulesByGrantor(makeAddr("stranger")).length, 0);
    }

    /// FR-004: one grantor creates many schedules against the same deployment.
    function test_OneGrantorCreatesManySchedulesWithoutRedeployment() public {
        address factoryAddress = address(factory);

        for (uint256 i = 1; i <= 5; i++) {
            uint256 id = _create(i % 2 == 0 ? secondBeneficiary : beneficiary, i * 10 ether, 0);
            assertEq(id, i, "ids auto-increment from 1");
        }

        assertEq(factory.scheduleCount(), 5, "all five stored");
        assertEq(address(factory), factoryAddress, "no redeployment happened");
        assertEq(factory.getSchedulesByGrantor(grantor).length, 5, "grantor index complete");

        for (uint256 i = 1; i <= 5; i++) {
            VestingFactory.Schedule memory schedule = factory.getSchedule(i);
            assertEq(schedule.grantor, grantor, "same grantor for every schedule");
            assertEq(
                schedule.beneficiary,
                i % 2 == 0 ? secondBeneficiary : beneficiary,
                "per-schedule beneficiary"
            );
            assertEq(schedule.totalAmount, i * 10 ether);
            assertEq(schedule.released, 0, "fresh schedules have released = 0");
        }
    }

    /// FR-005: the identifier is spelled `beneficiary` — this test does not compile
    ///        otherwise, and the stored value round-trips through `getSchedule`.
    function test_ScheduleExposesSpelledBeneficiary() public {
        uint256 id = _create(beneficiary, 100 ether, 0);

        VestingFactory.Schedule memory schedule = factory.getSchedule(id);
        assertEq(schedule.beneficiary, beneficiary, "field is spelled beneficiary");
        assertEq(schedule.token, address(token));
        assertEq(schedule.cliffDuration, 3 * 30 days);
        assertEq(schedule.duration, 6 * 30 days);

        // Unknown ids read as the reserved empty record (id 0 means "not found").
        assertEq(factory.getSchedule(0).beneficiary, address(0));
        assertEq(factory.getSchedule(id + 1).beneficiary, address(0));
    }
}
