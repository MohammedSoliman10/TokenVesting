// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { VestingFactory } from "../../src/VestingFactory.sol";
import { ReentrantCreateToken } from "../mocks/ReentrantCreateToken.sol";

/// @notice T064 — `createSchedule` re-entrancy rules. Written BEFORE the guard
///         (constitution II): while a funding pull is in flight, a malicious
///         token must NOT be able to re-enter `createSchedule` (interleaving a
///         second schedule into the outer call's window) or `release` (paying
///         out mid-creation) — both are cross-function re-entrancy against the
///         contract-wide `ReentrancyGuard`, and both must revert with
///         `ReentrancyGuardReentrantCall()`.
contract VestingFactoryReentrancyTest is Test {
    VestingFactory internal factory;
    ReentrantCreateToken internal evil;

    address internal grantor = makeAddr("grantor");
    address internal beneficiary = makeAddr("beneficiary");

    /// @dev Fixed timeline base so every warp below is exact.
    uint256 internal constant BASE = 1_700_000_000;
    /// @dev One vesting interval: 90 days = 3 of the 30-day months.
    uint256 internal constant INTERVAL = 90 days;

    function setUp() public {
        vm.warp(BASE);
        factory = new VestingFactory();
        evil = new ReentrantCreateToken();
        evil.mint(grantor, 100 ether);
        vm.prank(grantor);
        evil.approve(address(factory), type(uint256).max);
    }

    /// @dev Pre-existing schedule of the same malicious token (50e18 over 6
    ///      months, one interval in, so 25e18 is releasable), then arms the
    ///      attack for the NEXT funding pull.
    function _armAttack() internal returns (uint256 existing) {
        vm.prank(grantor);
        existing = factory.createSchedule(address(evil), beneficiary, 0, 0, 6, 50 ether);
        vm.warp(BASE + INTERVAL);
        evil.arm(factory, existing, 10 ether);
    }

    /// @dev The outer 20e18 creation whose funding pull triggers the attack.
    function _createWhileAttacked() internal returns (uint256 id) {
        vm.prank(grantor);
        id = factory.createSchedule(address(evil), beneficiary, 0, 0, 6, 20 ether);
    }

    /// Re-entering `createSchedule` from inside the pull must revert with the
    /// guard's error instead of storing a schedule in the outer call's window.
    function test_Create_BlocksReentrantCreateScheduleDuringPull() public {
        _armAttack();
        _createWhileAttacked();

        assertEq(
            evil.createOutcome(), 2, "re-entrant createSchedule must be blocked by nonReentrant"
        );
    }

    /// Re-entering `release` from inside the pull must revert with the guard's
    /// error instead of paying the beneficiary mid-creation.
    function test_Create_BlocksReentrantReleaseDuringPull() public {
        _armAttack();
        _createWhileAttacked();

        assertEq(evil.releaseOutcome(), 2, "re-entrant release must be blocked by nonReentrant");
        assertEq(evil.balanceOf(beneficiary), 0, "no payout may slip through during creation");
    }

    /// The attack fires inside the pull, yet only the outer schedule may be
    /// stored and the books must balance exactly: 50e18 existing + 20e18 pulled.
    function test_Create_StoresExactlyOneScheduleDespiteReentry() public {
        _armAttack();
        uint256 id = _createWhileAttacked();

        assertFalse(evil.armed(), "the attack must have fired during the pull");
        assertEq(factory.scheduleCount(), 2, "only the outer schedule may be stored");
        assertEq(id, 2, "the outer creation keeps the next id");
        assertEq(
            evil.balanceOf(address(factory)), 70 ether, "funds intact: 50 existing + 20 pulled"
        );
        assertEq(evil.balanceOf(grantor), 30 ether, "grantor debited exactly once, by 20");
    }
}
