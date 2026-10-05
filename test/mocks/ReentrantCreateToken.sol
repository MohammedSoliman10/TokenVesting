// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { VestingFactory } from "../../src/VestingFactory.sol";

/// @title ReentrantCreateToken
/// @notice T064 — test fixture: an ERC-20 that, on the transfer that funds a
///         `createSchedule` pull, re-enters the factory with BOTH
///         `createSchedule(...)` (msg.sender = this token) and `release(id)`,
///         records how each attempt ended, then restores the factory's balance
///         so the outer fee-on-transfer delta check settles normally. Used to
///         prove `VestingFactory.createSchedule` is protected by `nonReentrant`.
/// @dev Outcome codes: `0` never attempted, `1` succeeded, `2` blocked by
///      `ReentrancyGuardReentrantCall()`, `3` reverted for another reason.
///      Test-only contract — never deployed to a public network.
contract ReentrantCreateToken is ERC20 {
    /// @notice Outcome of the re-entrant `createSchedule` attempt (codes above).
    uint8 public createOutcome;
    /// @notice Outcome of the re-entrant `release` attempt (codes above).
    uint8 public releaseOutcome;

    /// @dev The factory under attack, set by `arm`.
    VestingFactory public factory;
    /// @dev Existing schedule re-entered through `release`.
    uint256 public attackScheduleId;
    /// @dev Amount used by the re-entrant `createSchedule` (prefunded to SELF).
    uint256 public recreateAmount;
    /// @dev Whether the attack is armed (disarmed after it fires once).
    bool public armed;

    /// @dev Re-entrancy latch so nested transfers inside the attack skip the hook.
    bool internal inTransfer;

    /// @notice Deploys the fixture token.
    constructor() ERC20("Reentrant Create Token", "EVILC") { }

    /// @notice Open mint — fixture helper so tests can fund grantors.
    /// @param to Recipient of the newly minted tokens.
    /// @param amount Amount in base units (18 decimals).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arms the attack and prefunds SELF, so the re-entrant
    ///         `createSchedule` (whose `msg.sender` is this token) passes the
    ///         factory's balance/allowance pre-checks and gets past them into
    ///         the funding pull — exactly the window under review.
    /// @param factory_ Factory to attack.
    /// @param scheduleId Existing schedule passed to the re-entrant `release`.
    /// @param amount Amount used by the re-entrant `createSchedule`.
    function arm(VestingFactory factory_, uint256 scheduleId, uint256 amount) external {
        factory = factory_;
        attackScheduleId = scheduleId;
        recreateAmount = amount;
        _mint(address(this), amount);
        _approve(address(this), address(factory_), amount);
        armed = true;
    }

    /// @dev OpenZeppelin v5 transfer hook. Fires once, on the transfer that
    ///      delivers the outer funding pull to the factory, AFTER balances have
    ///      moved: at that point the factory already holds `expected`, which is
    ///      what it must hold again when the pull settles.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (!armed || inTransfer || from == address(0) || to != address(factory)) {
            return;
        }
        inTransfer = true;
        uint256 expected = balanceOf(address(factory));

        // (1) Re-enter createSchedule: msg.sender of the nested call is this token.
        try factory.createSchedule(address(this), address(0xBEEF), 0, 3, 6, recreateAmount) {
            createOutcome = 1;
        } catch (bytes memory reason) {
            createOutcome = _isGuardRevert(reason) ? 2 : 3;
        }
        // (2) Re-enter release on the pre-existing schedule of this same token.
        try factory.release(attackScheduleId) returns (uint256) {
            releaseOutcome = 1;
        } catch (bytes memory reason) {
            releaseOutcome = _isGuardRevert(reason) ? 2 : 3;
        }

        // The token controls its own ledger: restore the factory's balance to
        // `expected` so the outer fee-on-transfer delta check observes exactly
        // the outer `value`. Without this, a polluted balance would revert the
        // whole transaction (`FeeOnTransferRejected`) and roll the recorded
        // outcomes back with it; a malicious token could equally lie about
        // `balanceOf` itself.
        uint256 current = balanceOf(address(factory));
        if (current < expected) {
            _mint(address(factory), expected - current);
        } else if (current > expected) {
            _transfer(address(factory), address(this), current - expected);
        }

        inTransfer = false;
        armed = false;
    }

    /// @dev ReentrancyGuardReentrantCall() selector — precomputed so the check
    ///      needs no runtime keccak and no extra typecast.
    bytes4 private constant GUARD_SELECTOR = 0x3ee5aeb5;

    /// @dev Matches OpenZeppelin's `ReentrancyGuardReentrantCall()` selector.
    function _isGuardRevert(bytes memory reason) private pure returns (bool) {
        // casting to 'bytes4' is safe because reason.length == 4 is checked first
        // forge-lint: disable-next-line(unsafe-typecast)
        return reason.length == 4 && bytes4(reason) == GUARD_SELECTOR;
    }
}
