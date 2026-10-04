// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TestToken } from "../../src/TestToken.sol";
import { VestingFactory } from "../../src/VestingFactory.sol";
import { FeeOnTransferToken } from "../mocks/FeeOnTransferToken.sol";

/// @notice T020 — atomic funding of `createSchedule` (FR-002, FR-006, data-model V7).
///         Written BEFORE the implementation (constitution II): no schedule may ever
///         exist unfunded, and fee-on-transfer tokens must leave nothing behind.
contract VestingFactoryFundingTest is Test {
    VestingFactory internal factory;
    TestToken internal token;

    address internal grantor = makeAddr("grantor");
    address internal beneficiary = makeAddr("beneficiary");

    function setUp() public {
        factory = new VestingFactory();
        token = new TestToken();
    }

    /// V7: the pull is atomic — factory holds the full amount, grantor is debited.
    function test_Create_PullsFullAmountAtomically() public {
        token.mint(grantor, 300 ether);

        vm.startPrank(grantor);
        token.approve(address(factory), 100 ether);
        uint256 id = factory.createSchedule(address(token), beneficiary, 0, 0, 6, 100 ether);
        vm.stopPrank();

        assertEq(
            token.balanceOf(address(factory)),
            100 ether,
            "factory must hold exactly the schedule amount"
        );
        assertEq(token.balanceOf(grantor), 200 ether, "grantor debited by exactly the amount");

        VestingFactory.Schedule memory schedule = factory.getSchedule(id);
        assertEq(schedule.totalAmount, 100 ether, "stored amount matches the pulled amount");
        assertEq(schedule.grantor, grantor);
        assertEq(schedule.token, address(token));
    }

    /// V7: an exact (non-infinite) approval is consumed completely.
    function test_Create_ConsumesExactAllowance() public {
        token.mint(grantor, 100 ether);

        vm.startPrank(grantor);
        token.approve(address(factory), 100 ether);
        factory.createSchedule(address(token), beneficiary, 0, 0, 6, 100 ether);
        vm.stopPrank();

        assertEq(
            token.allowance(grantor, address(factory)), 0, "allowance fully consumed by the pull"
        );
    }

    /// V7: balance below the amount (allowance sufficient) → InsufficientBalance().
    function test_Create_RevertsWithInsufficientBalance() public {
        token.mint(grantor, 50 ether);

        vm.startPrank(grantor);
        token.approve(address(factory), 100 ether);
        vm.expectRevert(VestingFactory.InsufficientBalance.selector);
        factory.createSchedule(address(token), beneficiary, 0, 0, 6, 100 ether);
        vm.stopPrank();

        assertEq(factory.scheduleCount(), 0, "no schedule stored");
        assertEq(token.balanceOf(address(factory)), 0, "nothing pulled");
    }

    /// V7: allowance below the amount (balance sufficient) → InsufficientAllowance().
    function test_Create_RevertsWithInsufficientAllowance() public {
        token.mint(grantor, 1_000 ether);

        vm.startPrank(grantor);
        token.approve(address(factory), 10 ether);
        vm.expectRevert(VestingFactory.InsufficientAllowance.selector);
        factory.createSchedule(address(token), beneficiary, 0, 0, 6, 100 ether);
        vm.stopPrank();

        assertEq(factory.scheduleCount(), 0, "no schedule stored");
    }

    /// V7: no approval at all → InsufficientAllowance().
    function test_Create_RevertsWithoutAnyApproval() public {
        token.mint(grantor, 1_000 ether);

        vm.prank(grantor);
        vm.expectRevert(VestingFactory.InsufficientAllowance.selector);
        factory.createSchedule(address(token), beneficiary, 0, 0, 6, 100 ether);

        assertEq(factory.scheduleCount(), 0, "no schedule stored");
    }

    /// FR-006: fee-on-transfer tokens are rejected and leave no schedule behind.
    function test_Create_FeeOnTransferTokenIsRejected() public {
        FeeOnTransferToken feeToken = new FeeOnTransferToken();
        feeToken.mint(grantor, 1_000 ether);

        vm.startPrank(grantor);
        feeToken.approve(address(factory), type(uint256).max);

        // Pre-checks pass (balance + allowance are fine); the delta check fails.
        vm.expectRevert(VestingFactory.FeeOnTransferRejected.selector);
        factory.createSchedule(address(feeToken), beneficiary, 0, 0, 6, 100 ether);
        vm.stopPrank();

        assertEq(factory.scheduleCount(), 0, "no schedule may exist after rejected funding");
        assertEq(feeToken.balanceOf(address(factory)), 0, "no tokens kept by the factory");
        assertEq(factory.getSchedule(1).totalAmount, 0, "id 1 must stay empty");

        // Sanity: the mock really is fee-on-transfer (recipient gets 99 of 100).
        address recipient = makeAddr("recipient");
        vm.prank(grantor);
        assertTrue(feeToken.transfer(recipient, 100 ether), "transfer must succeed");
        assertEq(feeToken.balanceOf(recipient), 99 ether, "recipient must receive 1% less");
    }
}
