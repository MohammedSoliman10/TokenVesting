// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestToken
/// @notice Owner-mintable ERC-20 used to fund vesting schedules in development,
///         testing, and on Sepolia (FR-014), plus a public rate-limited faucet
///         backing the UI's "Get test tokens" button (FR-014a).
/// @dev Standard ERC-20 semantics only — no fees, no rebasing, no hooks (these
///      token classes are rejected at schedule creation, clarified decision 5).
contract TestToken is ERC20, Ownable {
    /// @notice Amount minted per successful `faucet()` call: 1,000 tokens (18 decimals).
    uint256 public constant FAUCET_AMOUNT = 1_000 * 10 ** 18;

    /// @notice Minimum seconds between two `faucet()` calls from the same address (24 hours).
    uint256 public constant FAUCET_COOLDOWN = 24 hours;

    /// @notice Unix timestamp of `account`'s last successful `faucet()` call; 0 if never called.
    mapping(address => uint256) public lastFaucetAt;

    /// @notice Reverts when `faucet()` is called again inside the 24-hour window (FR-014a).
    error FaucetCooldown();

    /// @dev Deploys a "Test Token" ("TEST") with 18 decimals, owned by the deployer.
    constructor() ERC20("Test Token", "TEST") Ownable(msg.sender) { }

    /// @notice Mints `amount` tokens to `to`. Owner only (FR-014).
    /// @param to Recipient of the newly minted tokens.
    /// @param amount Amount in base units (18 decimals).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Mints exactly `FAUCET_AMOUNT` to `msg.sender`, at most once per
    ///         `FAUCET_COOLDOWN` window per address (FR-014a).
    /// @dev Records the claim timestamp before minting (checks-effects-interactions).
    ///      The `last != 0` guard keeps the first claim usable even at timestamp 0.
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown();
        }
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
