// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VestingFactory
/// @notice Single contract holding every vesting schedule (mapping design,
///         research R1): one address, one ABI; the frontend reads via plain
///         calls (research R5). Creation is atomic — the schedule is pulled
///         from the grantor in the same transaction that stores it (FR-002).
/// @dev Months are 30-day months; cliffs and durations are whole multiples of
///      the 90-day interval, which guarantees `duration / 90 days >= 1`
///      (no division by zero, FR-003). Identifier spelled `beneficiary` (FR-005).
contract VestingFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Length of one month in this system: 30 days (data-model constant).
    uint256 public constant MONTH = 30 days;

    /// @notice Vesting interval: 90 days (3 months) — the step of the release schedule.
    uint256 public constant INTERVAL = 90 days;

    /// @notice One stored vesting schedule (data-model: VestingSchedule).
    /// @param token ERC-20 held by this contract for the schedule.
    /// @param grantor `msg.sender` at creation; pulls the funding.
    /// @param beneficiary Receiver of vested tokens (FR-005, spelled `beneficiary`).
    /// @param start Unix seconds; the `0` sentinel is resolved to `block.timestamp` at creation.
    /// @param cliffDuration Seconds until the cliff (`cliffMonths * 30 days`).
    /// @param duration Total length in seconds (`durationMonths * 30 days`).
    /// @param totalAmount Tokens fully pulled from the grantor at creation.
    /// @param released Tokens already released to the beneficiary; `<= totalAmount`.
    struct Schedule {
        address token;
        address grantor;
        address beneficiary;
        uint256 start;
        uint256 cliffDuration;
        uint256 duration;
        uint256 totalAmount;
        uint256 released;
    }

    /// @notice Reverts when `token` or `beneficiary` is the zero address (FR-003, V1/V2).
    error ZeroAddress();
    /// @notice Reverts when `start` is non-zero and already in the past (FR-003, V3).
    error InvalidStart();
    /// @notice Reverts when `durationMonths` is 0 or not a multiple of 3 (FR-003, V4).
    error InvalidDuration();
    /// @notice Reverts when `cliffMonths` is not a multiple of 3 or exceeds `durationMonths`
    /// (FR-003, V5).
    error InvalidCliff();
    /// @notice Reverts when `amount` is zero (FR-003, V6).
    error ZeroAmount();
    /// @notice Reverts when the grantor does not hold `amount` of `token` (V7).
    error InsufficientBalance();
    /// @notice Reverts when the grantor has not approved this contract for `amount` (V7).
    error InsufficientAllowance();
    /// @notice Reverts when the pull delivers less than `amount` — fee-on-transfer tokens are
    /// rejected (FR-006, V7).
    error FeeOnTransferRejected();
    /// @notice Reverts when a release is attempted with nothing releasable (FR-010, US2).
    error NothingToRelease();
    /// @notice Reverts when an unknown schedule id is used (FR-011, US2).
    error ScheduleNotFound();

    /// @notice Emitted when a schedule is created and atomically funded (FR-012).
    /// @param id New schedule id (auto-increments from 1).
    /// @param grantor Creator and funding source (`msg.sender`).
    /// @param beneficiary Receiver of the vested tokens (FR-005).
    /// @param token ERC-20 of the schedule.
    /// @param start Resolved start (`0` sentinel already replaced by `block.timestamp`).
    /// @param cliffDuration Cliff length in seconds.
    /// @param duration Total duration in seconds.
    /// @param totalAmount Funding pulled from the grantor.
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

    /// @notice Emitted when vested tokens are released to the beneficiary (FR-012, US2).
    /// @param id Schedule that paid out.
    /// @param beneficiary Receiver of the tokens (FR-005).
    /// @param amount Exact amount paid out.
    event TokensReleased(uint256 indexed id, address indexed beneficiary, uint256 amount);

    /// @dev Schedule records by id; id 0 is the reserved "not found" record.
    mapping(uint256 => Schedule) internal schedules;
    /// @dev Total schedules ever created; next id is `scheduleCounter + 1`.
    uint256 internal scheduleCounter;
    /// @dev `beneficiary => schedule ids` — internal storage only; read via
    /// `getSchedulesByBeneficiary` (FR-004).
    mapping(address => uint256[]) internal beneficiarySchedules;
    /// @dev `grantor => schedule ids` — internal storage only; read via `getSchedulesByGrantor`
    /// (FR-004).
    mapping(address => uint256[]) internal grantorSchedules;

    /// @notice Creates a vesting schedule and funds it atomically: the full
    ///         `amount` is pulled from `msg.sender` in this same transaction, so
    ///         no schedule can ever exist unfunded (FR-002).
    /// @dev All parameter checks run before any state write (FR-003, research R3).
    ///      `start == 0` resolves to `block.timestamp`. Fee-on-transfer tokens are
    ///      rejected by comparing the factory's balance before/after the pull (FR-006).
    /// @param token ERC-20 to vest; must be non-zero (`ZeroAddress()`).
    /// @param beneficiary Receiver of vested tokens; must be non-zero (`ZeroAddress()`); may equal
    /// the grantor. @param start Unix seconds: `0` = now, or a non-zero value `>= block.timestamp`
    /// (`InvalidStart()`).
    /// @param cliffMonths Cliff length in whole months (multiple of 3, `<= durationMonths`).
    /// @param durationMonths Total duration in whole months; `> 0` and a multiple of 3
    /// (`InvalidDuration()`). @param amount Total tokens to vest, pulled from the grantor; must be
    /// `> 0` (`ZeroAmount()`).
    /// @return id The new schedule id (auto-increments from 1).
    function createSchedule(
        address token,
        address beneficiary,
        uint256 start,
        uint256 cliffMonths,
        uint256 durationMonths,
        uint256 amount
    ) external returns (uint256 id) {
        // --- FR-003 validation matrix: all checks precede any state write ---
        if (token == address(0) || beneficiary == address(0)) {
            revert ZeroAddress();
        }
        if (start != 0 && start < block.timestamp) {
            revert InvalidStart();
        }
        if (durationMonths == 0 || durationMonths % 3 != 0) {
            revert InvalidDuration();
        }
        if (cliffMonths % 3 != 0 || cliffMonths > durationMonths) {
            revert InvalidCliff();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 resolvedStart = start == 0 ? block.timestamp : start;
        uint256 cliffDuration = cliffMonths * MONTH;
        uint256 duration = durationMonths * MONTH;

        // --- FR-002 funding pre-checks: friendly errors before any transfer ---
        IERC20 erc20 = IERC20(token);
        if (erc20.balanceOf(msg.sender) < amount) {
            revert InsufficientBalance();
        }
        if (erc20.allowance(msg.sender, address(this)) < amount) {
            revert InsufficientAllowance();
        }

        // --- FR-002/FR-006: atomic pull + fee-on-transfer rejection by delta ---
        uint256 balanceBefore = erc20.balanceOf(address(this));
        erc20.safeTransferFrom(msg.sender, address(this), amount);
        if (erc20.balanceOf(address(this)) - balanceBefore != amount) {
            revert FeeOnTransferRejected();
        }

        // --- store + indexes (FR-004) + event (FR-012) ---
        id = ++scheduleCounter; // ids auto-increment from 1; 0 stays "not found"
        schedules[id] = Schedule({
            token: token,
            grantor: msg.sender,
            beneficiary: beneficiary,
            start: resolvedStart,
            cliffDuration: cliffDuration,
            duration: duration,
            totalAmount: amount,
            released: 0
        });
        beneficiarySchedules[beneficiary].push(id);
        grantorSchedules[msg.sender].push(id);

        emit ScheduleCreated(
            id, msg.sender, beneficiary, token, resolvedStart, cliffDuration, duration, amount
        );
    }

    /// @notice Total number of schedules created so far (ids run `1..scheduleCount`).
    /// @return Count of stored schedules.
    function scheduleCount() external view returns (uint256) {
        return scheduleCounter;
    }

    /// @notice Full schedule record by id.
    /// @dev Unknown ids (including the reserved id 0) return an empty struct (FR-011).
    /// @param id Schedule id.
    /// @return The stored schedule, or an empty record if the id does not exist.
    function getSchedule(uint256 id) external view returns (Schedule memory) {
        return schedules[id];
    }

    /// @notice Schedule ids where `beneficiary` is the receiving wallet (FR-004).
    /// @param beneficiary Wallet to look up.
    /// @return Schedule ids in creation order; empty if none.
    function getSchedulesByBeneficiary(address beneficiary)
        external
        view
        returns (uint256[] memory)
    {
        return beneficiarySchedules[beneficiary];
    }

    /// @notice Schedule ids created by `grantor` (FR-004).
    /// @param grantor Wallet to look up.
    /// @return Schedule ids in creation order; empty if none.
    function getSchedulesByGrantor(address grantor) external view returns (uint256[] memory) {
        return grantorSchedules[grantor];
    }

    /// @notice Vested tokens of schedule `id` at `block.timestamp` (FR-009, US2).
    /// @dev Step formula: `0` strictly before the cliff; `totalAmount` at/after
    ///      `start + duration`; otherwise
    ///      `totalAmount * ((now - start) / 90 days) / (duration / 90 days)` with floor
    ///      division. Because `duration` is a whole multiple of the 90-day interval,
    ///      `duration / 90 days >= 1` (no division by zero) and the middle branch can never
    ///      exceed `totalAmount`.
    /// @param id Schedule id; `ScheduleNotFound()` for id 0 or an id above `scheduleCount`.
    /// @return Vested amount in base units — never above `totalAmount`.
    function vestedAmount(uint256 id) external view returns (uint256) {
        return _vestedAmount(_getScheduleOrRevert(id));
    }

    /// @notice Tokens of schedule `id` that are vested but not yet released (FR-010, US2).
    /// @dev `vestedAmount(id) - released(id)`. Releases only ever pay out already-vested
    ///      tokens and `vestedAmount` is monotone in time, so the subtraction never
    ///      underflows.
    /// @param id Schedule id; `ScheduleNotFound()` for id 0 or an id above `scheduleCount`.
    /// @return Amount currently claimable by anyone through `release(id)`.
    function releasableAmount(uint256 id) external view returns (uint256) {
        Schedule storage schedule = _getScheduleOrRevert(id);
        return _vestedAmount(schedule) - schedule.released;
    }

    /// @notice Tokens of schedule `id` already released to the beneficiary (FR-011, US2).
    /// @dev Always `<= totalAmount` (SC-004) and never decreases: `release` only ever adds
    ///      the currently releasable amount.
    /// @param id Schedule id; `ScheduleNotFound()` for id 0 or an id above `scheduleCount`.
    /// @return Cumulative amount paid out so far, in base units.
    function released(uint256 id) external view returns (uint256) {
        return _getScheduleOrRevert(id).released;
    }

    /// @notice Releases the currently releasable tokens of schedule `id` to its beneficiary
    ///         (FR-010, US2).
    /// @dev Permissionless: anyone may call, but the payout always goes to the beneficiary.
    ///      Follows checks-effects-interactions — `released` is increased before the token
    ///      moves — and the whole function is guarded by `nonReentrant`, so a malicious token
    ///      re-entering `release` cannot claim twice. Only the releasable amount is sent; the
    ///      unvested remainder stays in the factory for later intervals.
    /// @param id Schedule id; `ScheduleNotFound()` for id 0 or an id above `scheduleCount`.
    /// @return amount Exact amount paid out to the beneficiary (in base units).
    ///      Reverts with `NothingToRelease()` when nothing is vested beyond what is already
    ///      released.
    function release(uint256 id) external nonReentrant returns (uint256 amount) {
        Schedule storage schedule = _getScheduleOrRevert(id);
        uint256 vested = _vestedAmount(schedule);
        amount = vested - schedule.released;
        if (amount == 0) {
            revert NothingToRelease();
        }

        // Effects first: record the payout before any token moves (re-entrancy safe).
        schedule.released += amount;
        IERC20(schedule.token).safeTransfer(schedule.beneficiary, amount);

        emit TokensReleased(id, schedule.beneficiary, amount);
    }

    /// @dev Shared id validation for the US2 entry points (FR-011): id 0 is reserved and ids
    ///      above `scheduleCounter` were never created.
    /// @param id Schedule id to resolve.
    /// @return schedule Storage pointer to the stored schedule.
    ///      Reverts with `ScheduleNotFound()` if `id` is 0 or above `scheduleCount`.
    function _getScheduleOrRevert(uint256 id) internal view returns (Schedule storage schedule) {
        if (id == 0 || id > scheduleCounter) {
            revert ScheduleNotFound();
        }
        schedule = schedules[id];
    }

    /// @dev Shared vesting math (FR-009): the spec step formula over 90-day intervals.
    /// @param schedule Storage pointer to an existing schedule.
    /// @return Vested amount in base units at `block.timestamp`.
    function _vestedAmount(Schedule storage schedule) internal view returns (uint256) {
        // Strictly before the cliff (covers "before start" too: cliffDuration >= 0).
        if (block.timestamp < schedule.start + schedule.cliffDuration) {
            return 0;
        }
        // At/after start + duration the schedule is fully vested — and never more.
        if (block.timestamp >= schedule.start + schedule.duration) {
            return schedule.totalAmount;
        }
        uint256 completedIntervals = (block.timestamp - schedule.start) / INTERVAL;
        uint256 totalIntervals = schedule.duration / INTERVAL;
        return (schedule.totalAmount * completedIntervals) / totalIntervals;
    }
}
