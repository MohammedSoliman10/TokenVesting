// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title FeeOnTransferToken
/// @notice T018 — test fixture: an ERC-20 that burns 1% of every transfer, so the
///         recipient always receives less than `value`. Used to prove that
///         `VestingFactory.createSchedule` rejects fee-on-transfer tokens with
///         `FeeOnTransferRejected()` and leaves no schedule behind (FR-006).
/// @dev Test-only contract — never deployed to a public network.
contract FeeOnTransferToken is ERC20 {
    /// @notice Fee taken on every transfer, in basis points (100 = 1%).
    uint256 public constant FEE_BPS = 100;
    /// @dev Basis-point denominator.
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Deploys a "Fee On Transfer Token" ("FOT").
    constructor() ERC20("Fee On Transfer Token", "FOT") { }

    /// @notice Open mint — fixture helper so tests can fund grantors.
    /// @param to Recipient of the newly minted tokens.
    /// @param amount Amount in base units (18 decimals).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev OpenZeppelin v5 transfer hook: burn the tax from the sender and
    ///      deliver `value - fee` to the recipient (mint/burn paths pass through).
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = (value * FEE_BPS) / BPS_DENOMINATOR;
            if (fee != 0) {
                super._update(from, address(0), fee); // burn the tax
                super._update(from, to, value - fee); // recipient gets less than `value`
                return;
            }
        }
        super._update(from, to, value);
    }
}
