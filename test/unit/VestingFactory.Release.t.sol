// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestToken } from "../../src/TestToken.sol";
import { VestingFactory } from "../../src/VestingFactory.sol";
import { MaliciousToken } from "../mocks/MaliciousToken.sol";

/// @notice T033 — `release(id)` rules (FR-010/FR-011, US2). Written BEFORE the implementation
///         (constitution II): permissionless entry but beneficiary-only payout, only the
///         currently releasable amount, `released` never exceeds `totalAmount` (SC-004),
///         `NothingToRelease()` / `ScheduleNotFound()` on the failure paths, the exact
///         `TokensReleased` event, and re-entrancy blocked by `nonReentrant`.
contract VestingFactoryReleaseTest is Test {
    VestingFactory internal factory;
    TestToken internal token;

    address internal grantor = makeAddr("grantor");
    address internal beneficiary = makeAddr("beneficiary");
    address internal relayer = makeAddr("relayer");

    /// @dev Fixed timeline base so every warp below is exact.
    uint256 internal constant BASE = 1_700_000_000;
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

    /// 900e18 over 9 months (3 intervals): 300e18 vests per completed interval.
    function test_Release_SendsOnlyTheCurrentlyReleasableAmount() public {
        uint256 id = _create(3, 9, 900 ether);
        vm.warp(BASE + INTERVAL); // 300e18 vested

        factory.release(id);

        assertEq(token.balanceOf(beneficiary), 300 ether, "beneficiary got exactly the releasable");
        assertEq(token.balanceOf(address(factory)), 600 ether, "factory keeps the unvested rest");
        assertEq(factory.released(id), 300 ether, "released records exactly the payout");
    }

    /// Anyone may call `release`, but the payout always lands in the beneficiary's wallet.
    function test_Release_PermissionlessCallerStillPaysTheBeneficiary() public {
        uint256 id = _create(3, 9, 900 ether);
        vm.warp(BASE + INTERVAL);

        vm.prank(relayer);
        factory.release(id);

        assertEq(token.balanceOf(beneficiary), 300 ether, "tokens always go to the beneficiary");
        assertEq(token.balanceOf(relayer), 0, "the caller never keeps the tokens");
        assertEq(token.balanceOf(grantor), 1e40 - 900 ether, "grantor untouched by the release");
    }

    function test_Release_RevertsNothingToReleaseBeforeTheCliff() public {
        uint256 id = _create(3, 9, 900 ether);
        vm.warp(BASE + INTERVAL - 1);

        vm.expectRevert(VestingFactory.NothingToRelease.selector);
        factory.release(id);
    }

    function test_Release_RevertsNothingToReleaseOnSecondCallWithoutTimeAdvance() public {
        uint256 id = _create(3, 9, 900 ether);
        vm.warp(BASE + INTERVAL);
        factory.release(id);

        vm.expectRevert(VestingFactory.NothingToRelease.selector);
        factory.release(id);
    }

    function test_Release_RevertsNothingToReleaseWhenFullyReleased() public {
        uint256 id = _create(3, 9, 900 ether);
        vm.warp(BASE + 3 * INTERVAL);
        factory.release(id);

        assertEq(token.balanceOf(beneficiary), 900 ether, "one payout drains the whole schedule");
        vm.expectRevert(VestingFactory.NothingToRelease.selector);
        factory.release(id);
    }

    /// FR-011: id 0 is reserved — every US2 entry point must revert for it.
    function test_Release_RevertsScheduleNotFoundForIdZero() public {
        vm.expectRevert(VestingFactory.ScheduleNotFound.selector);
        factory.release(0);
        vm.expectRevert(VestingFactory.ScheduleNotFound.selector);
        factory.vestedAmount(0);
        vm.expectRevert(VestingFactory.ScheduleNotFound.selector);
        factory.releasableAmount(0);
        vm.expectRevert(VestingFactory.ScheduleNotFound.selector);
        factory.released(0);
    }

    /// FR-011: an id above `scheduleCount` does not exist — same for the views.
    function test_Release_RevertsScheduleNotFoundAboveScheduleCount() public {
        uint256 id = _create(3, 9, 900 ether);
        uint256 unknown = id + 1;

        vm.expectRevert(VestingFactory.ScheduleNotFound.selector);
        factory.release(unknown);
        vm.expectRevert(VestingFactory.ScheduleNotFound.selector);
        factory.vestedAmount(unknown);
        vm.expectRevert(VestingFactory.ScheduleNotFound.selector);
        factory.releasableAmount(unknown);
        vm.expectRevert(VestingFactory.ScheduleNotFound.selector);
        factory.released(unknown);
    }

    function test_Release_EmitsTokensReleasedEvent() public {
        uint256 id = _create(3, 9, 900 ether);
        vm.warp(BASE + INTERVAL);

        vm.expectEmit(true, true, false, true, address(factory));
        emit VestingFactory.TokensReleased(id, beneficiary, 300 ether);
        factory.release(id);
    }

    /// SC-004: cumulative payouts track the vested amount exactly and stop at `totalAmount`.
    function test_Release_ReleasedTracksCumulativePayoutsAndNeverExceedsTotal() public {
        uint256 id = _create(3, 9, 900 ether);

        vm.warp(BASE + INTERVAL);
        factory.release(id);
        assertEq(factory.released(id), 300 ether, "first interval released");

        vm.warp(BASE + 2 * INTERVAL);
        factory.release(id);
        assertEq(factory.released(id), 600 ether, "cumulative 300 + 300");

        vm.warp(BASE + 3 * INTERVAL);
        factory.release(id);
        assertEq(factory.released(id), 900 ether, "released == totalAmount at the end");
        assertLe(factory.released(id), 900 ether, "released never exceeds totalAmount (SC-004)");

        vm.warp(BASE + 4 * INTERVAL);
        vm.expectRevert(VestingFactory.NothingToRelease.selector);
        factory.release(id);
    }

    /// A malicious token re-entering `release` mid-transfer must be blocked, while the outer
    /// release still pays the beneficiary exactly once.
    function test_Release_BlocksReentrancyWithMaliciousToken() public {
        MaliciousToken evil = new MaliciousToken();
        evil.mint(grantor, 900 ether);
        vm.prank(grantor);
        evil.approve(address(factory), 900 ether);
        vm.prank(grantor);
        uint256 id = factory.createSchedule(address(evil), beneficiary, 0, 3, 9, 900 ether);
        evil.setAttack(address(factory), id);

        vm.warp(BASE + INTERVAL); // 300e18 vested
        factory.release(id);

        assertTrue(evil.reentryAttempted(), "the malicious token must attempt re-entrancy");
        assertTrue(evil.reentryReverted(), "nonReentrant must block the re-entrant release");
        assertEq(evil.balanceOf(beneficiary), 300 ether, "beneficiary paid exactly once");
        assertEq(factory.released(id), 300 ether, "released recorded exactly once");
    }
}
