# VestingFactory — External Interface

Single contract holding all schedules (mapping design, research R1). One
address, one ABI; frontend reads via plain calls + multicall (research R5).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IVestingFactory {
    // ---- Types ----
    struct Schedule {
        address token;
        address grantor;
        address beneficiary;
        uint256 start;          // resolved: 0 sentinel replaced at creation
        uint256 cliffDuration;  // seconds (multiple of 90 days)
        uint256 duration;       // seconds (positive multiple of 90 days)
        uint256 totalAmount;
        uint256 released;
    }

    // ---- Write path ----
    /// Pulls `amount` from msg.sender atomically (SafeERC20.transferFrom),
    /// rejects fee-on-transfer via balance delta, stores schedule, emits event.
    /// `start == 0` means "start at block.timestamp".
    function createSchedule(
        address token,
        address beneficiary,
        uint256 start,
        uint256 cliffMonths,
        uint256 durationMonths,
        uint256 amount
    ) external returns (uint256 id);

    /// Permissionless: releases exactly the currently releasable amount to
    /// `beneficiary` (CEI + nonReentrant). Reverts NothingToRelease() if zero.
    function release(uint256 id) external;

    // ---- Views (FR-011) ----
    function vestedAmount(uint256 id) external view returns (uint256);
    function releasableAmount(uint256 id) external view returns (uint256);
    function released(uint256 id) external view returns (uint256);

    // ---- Reads / indexes (FR-004, no event indexer) ----
    function scheduleCount() external view returns (uint256);
    function getSchedule(uint256 id) external view returns (Schedule memory);
    function beneficiarySchedules(address beneficiary) external view returns (uint256[] memory);
    function grantorSchedules(address grantor) external view returns (uint256[] memory);
    function getSchedulesByBeneficiary(address beneficiary) external view returns (uint256[] memory);
    function getSchedulesByGrantor(address grantor) external view returns (uint256[] memory);

    // ---- Events (FR-012) ----
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
    event TokensReleased(uint256 indexed id, address indexed beneficiary, uint256 amount);

    // ---- Errors (custom errors only) ----
    error ZeroAddress();
    error InvalidStart();
    error InvalidDuration();
    error InvalidCliff();
    error ZeroAmount();
    error InsufficientBalance();
    error InsufficientAllowance();
    error FeeOnTransferRejected();
    error NothingToRelease();
    error ScheduleNotFound();
}
```

## Behavioral contract

1. **Validation before state** (FR-003, research R3): all parameter checks
   run before any write; `durationMonths > 0 && % 3 == 0` guarantees
   `duration / 90 days >= 1` — division by zero is structurally impossible.
2. **Atomic funding** (FR-002, clarified decision 3): pre-check
   `balanceOf(msg.sender)` and `allowance` → custom errors; `safeTransferFrom`
   full amount; post-check `balanceOf(this)` delta == `amount` else
   `FeeOnTransferRejected()`. No schedule can exist unfunded.
3. **Start rule** (clarified decision 1, research R2): `start == 0` ⇒
   `block.timestamp`; otherwise `start >= block.timestamp`.
4. **Release rules** (FR-007…FR-010, FR-013, clarified decision 4):
   - before cliff ⇒ `vestedAmount == 0`;
   - after cliff ⇒ step function per completed 90-day interval from `start`;
   - at/after `start + duration` ⇒ `totalAmount`;
   - `release(id)` sends **only** `releasableAmount` to `beneficiary`;
     `released` can never exceed `totalAmount`;
   - callable by **anyone**; tokens always go to `beneficiary`;
   - zero releasable ⇒ `NothingToRelease()` (no zero-value transfer);
   - effects before interaction, `SafeERC20.safeTransfer`, `nonReentrant`.
5. **Spelling** (FR-005): `beneficiary` in every identifier.
6. **Invariants** (spec SC-003/SC-004, tested fuzz + invariant-first):
   `released <= totalAmount`; nothing vested before cliff; fully vested at
   end; `releasable = vested - released >= 0`.
