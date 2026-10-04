// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestToken } from "../../src/TestToken.sol";
import { VestingFactory } from "../../src/VestingFactory.sol";

/// @notice T034 — fuzzed vesting relations with spec-bounded inputs (amount <= 1e30,
///         months in {3..120}, warped timestamps). Written BEFORE the implementation
///         (constitution II): `releasable == vested - released`, `vested <= totalAmount`,
///         and `vested` never decreases over time.
contract VestingMathFuzzTest is Test {
    VestingFactory internal factory;
    TestToken internal token;

    address internal grantor = makeAddr("grantor");
    address internal beneficiary = makeAddr("beneficiary");

    /// @dev Fixed timeline base so every warp below is exact.
    uint256 internal constant BASE = 1_700_000_000;
    /// @dev Spec bound for fuzzed amounts (T034).
    uint256 internal constant MAX_AMOUNT = 1e30;

    function setUp() public {
        vm.warp(BASE);
        factory = new VestingFactory();
        token = new TestToken();
        token.mint(grantor, MAX_AMOUNT * 10);
        vm.prank(grantor);
        token.approve(address(factory), type(uint256).max);
    }

    /// @dev Bounded spec inputs: `amount <= 1e30`, `durationMonths` a multiple of 3 in
    ///      {3..120}, `cliffMonths` a multiple of 3 in {0..durationMonths}.
    function _boundInputs(uint96 amountSeed, uint32 durationSeed, uint32 cliffSeed)
        internal
        pure
        returns (uint256 amount, uint256 durationMonths, uint256 cliffMonths)
    {
        amount = bound(uint256(amountSeed), 1, MAX_AMOUNT);
        durationMonths = 3 * bound(uint256(durationSeed), 1, 40); // {3, 6, ..., 120}
        cliffMonths = 3 * bound(uint256(cliffSeed), 0, durationMonths / 3);
    }

    /// @dev Independent transcription of the spec step formula (used as the fuzz oracle).
    function _expectedVested(
        uint256 elapsed,
        uint256 cliffDuration,
        uint256 duration,
        uint256 amount
    ) internal pure returns (uint256) {
        if (elapsed < cliffDuration) {
            return 0;
        }
        if (elapsed >= duration) {
            return amount;
        }
        return (amount * (elapsed / 90 days)) / (duration / 90 days);
    }

    /// Core relations: releasable == vested - released, and both bounds hold across a
    /// release in the middle of the schedule.
    function testFuzz_RelableEqualsVestedMinusReleased(
        uint96 amountSeed,
        uint32 durationSeed,
        uint32 cliffSeed,
        uint32 elapsedSeed,
        uint32 extraSeed
    ) public {
        (uint256 amount, uint256 durationMonths, uint256 cliffMonths) =
            _boundInputs(amountSeed, durationSeed, cliffSeed);
        uint256 duration = durationMonths * 30 days;

        vm.prank(grantor);
        uint256 id = factory.createSchedule(
            address(token), beneficiary, 0, cliffMonths, durationMonths, amount
        );

        // --- point 1: a moment inside the schedule, then release whatever is vested ---
        vm.warp(BASE + bound(uint256(elapsedSeed), 0, duration));
        uint256 vested1 = factory.vestedAmount(id);
        assertLe(vested1, amount, "vested must never exceed totalAmount");
        assertEq(
            factory.releasableAmount(id),
            vested1 - factory.released(id),
            "releasable == vested - released"
        );
        if (factory.releasableAmount(id) > 0) {
            factory.release(id);
        } else {
            vm.expectRevert(VestingFactory.NothingToRelease.selector);
            factory.release(id);
        }
        assertEq(factory.released(id), vested1, "release moved exactly the releasable amount");

        // --- point 2: never earlier than point 1 — relations still hold after the release ---
        uint256 t1 = block.timestamp - BASE;
        vm.warp(BASE + bound(uint256(extraSeed), t1, duration + 90 days));
        uint256 vested2 = factory.vestedAmount(id);
        assertGe(vested2, vested1, "vested must never decrease over time");
        assertLe(vested2, amount, "vested must never exceed totalAmount");
        assertEq(
            factory.releasableAmount(id),
            vested2 - factory.released(id),
            "releasable == vested - released after a partial release"
        );

        // --- the end: fully vested, never more ---
        vm.warp(BASE + duration);
        assertEq(factory.vestedAmount(id), amount, "full vesting exactly at start + duration");
        assertLe(factory.released(id), amount, "released must never exceed totalAmount");
    }

    /// Monotonicity along a chain of forward-only warps.
    function testFuzz_VestedNeverDecreasesOverTime(
        uint96 amountSeed,
        uint32 durationSeed,
        uint32 cliffSeed,
        uint32 stepSeed
    ) public {
        (uint256 amount, uint256 durationMonths, uint256 cliffMonths) =
            _boundInputs(amountSeed, durationSeed, cliffSeed);
        uint256 duration = durationMonths * 30 days;

        vm.prank(grantor);
        uint256 id = factory.createSchedule(
            address(token), beneficiary, 0, cliffMonths, durationMonths, amount
        );

        uint256 previous = 0;
        uint256 elapsed;
        for (uint256 i = 0; i < 5; i++) {
            elapsed += bound(uint256(stepSeed) + i, 0, duration);
            vm.warp(BASE + elapsed);
            uint256 vested = factory.vestedAmount(id);
            assertGe(vested, previous, "vested must never decrease over time");
            assertLe(vested, amount, "vested must never exceed totalAmount");
            assertEq(
                factory.releasableAmount(id),
                vested - factory.released(id),
                "releasable == vested - released"
            );
            previous = vested;
        }
    }

    /// The exact step formula, asserted against an independent transcription of the spec.
    function testFuzz_StepFormulaMatchesSpec(
        uint96 amountSeed,
        uint32 durationSeed,
        uint32 cliffSeed,
        uint32 elapsedSeed
    ) public {
        (uint256 amount, uint256 durationMonths, uint256 cliffMonths) =
            _boundInputs(amountSeed, durationSeed, cliffSeed);
        uint256 duration = durationMonths * 30 days;
        uint256 cliffDuration = cliffMonths * 30 days;

        vm.prank(grantor);
        uint256 id = factory.createSchedule(
            address(token), beneficiary, 0, cliffMonths, durationMonths, amount
        );

        uint256 elapsed = bound(uint256(elapsedSeed), 0, duration + 365 days);
        vm.warp(BASE + elapsed);
        assertEq(
            factory.vestedAmount(id),
            _expectedVested(elapsed, cliffDuration, duration, amount),
            "vested matches the spec step formula"
        );
    }
}
