// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { TestToken } from "../../src/TestToken.sol";

/// @notice T017 — TestToken: owner-only mint + public faucet with a 24h cooldown
///         (FR-014, FR-014a). Written BEFORE the implementation (constitution II).
contract TestTokenTest is Test {
    TestToken internal token;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    /// @dev Exact faucet amount: 1,000 tokens with 18 decimals (1000 * 10^18).
    uint256 internal constant FAUCET_AMOUNT = 1_000 * 10 ** 18;

    function setUp() public {
        token = new TestToken();
    }

    /// T017: `mint` reverts for every caller that is not the owner.
    function test_Mint_RevertsForNonOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        token.mint(alice, 1 ether);
    }

    /// T017: the owner mints exactly `amount` to the target.
    function test_Mint_OwnerMintsExactAmount() public {
        token.mint(alice, 123 ether);

        assertEq(token.balanceOf(alice), 123 ether);
        assertEq(token.totalSupply(), 123 ether);
        assertEq(token.balanceOf(address(this)), 0, "mint must not touch other balances");
    }

    /// T017: faucet() mints exactly 1,000 * 10^18 base units to msg.sender only.
    function test_Faucet_MintsExactly1000TokensToCaller() public {
        vm.prank(alice);
        token.faucet();

        assertEq(token.balanceOf(alice), FAUCET_AMOUNT, "must be exactly 1000 * 10^18");
        assertEq(token.balanceOf(alice), 1_000 * 10 ** 18, "literal check: 1000 * 10^18");
        assertEq(token.totalSupply(), FAUCET_AMOUNT);
        assertEq(token.balanceOf(bob), 0, "must not mint to anyone else");
        assertEq(token.lastFaucetAt(alice), block.timestamp, "claim timestamp recorded");
    }

    /// T017: a second call inside the 24h window reverts FaucetCooldown().
    function test_Faucet_SecondCallInsideCooldownReverts() public {
        vm.prank(alice);
        token.faucet();

        vm.expectRevert(TestToken.FaucetCooldown.selector);
        vm.prank(alice);
        token.faucet();
    }

    /// T017: one second before the window closes it still reverts FaucetCooldown().
    function test_Faucet_OneSecondBeforeCooldownEndStillReverts() public {
        vm.prank(alice);
        token.faucet();

        vm.warp(block.timestamp + 24 hours - 1);
        vm.expectRevert(TestToken.FaucetCooldown.selector);
        vm.prank(alice);
        token.faucet();
    }

    /// T017: usable again at exactly 24 hours — a second full mint succeeds.
    function test_Faucet_AvailableAgainAfter24Hours() public {
        vm.prank(alice);
        token.faucet();

        vm.warp(block.timestamp + 24 hours);
        vm.prank(alice);
        token.faucet();

        assertEq(token.balanceOf(alice), FAUCET_AMOUNT * 2, "second mint after the window");
        assertEq(token.lastFaucetAt(alice), block.timestamp, "timestamp refreshed");
    }

    /// T017: the cooldown is per address — bob is unaffected by alice's claim.
    function test_Faucet_CooldownIsPerAddress() public {
        vm.prank(alice);
        token.faucet();

        vm.prank(bob);
        token.faucet();

        assertEq(token.balanceOf(bob), FAUCET_AMOUNT, "bob's own faucet");

        vm.expectRevert(TestToken.FaucetCooldown.selector);
        vm.prank(alice);
        token.faucet();
    }
}
