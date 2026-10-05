/**
 * T036/T039 — pure vesting-progress math for the dashboard (data-model
 * `ScheduleView`, derived in `lib/vesting.ts`, FR-009/FR-010, US2).
 *
 * Mirrors `VestingFactory.sol::_vestedAmount` exactly:
 *   - before `start + cliff`      → vested 0
 *   - at/after `start + duration` → vested = totalAmount
 *   - otherwise floor(totalAmount * ((now - start) / 90 days) / (duration / 90 days))
 *
 * Everything is BigInt and `now` is always a parameter — never Date.now():
 * on a local chain with time warping, the browser clock and the chain clock
 * differ, and the UI must match the contract (which uses `block.timestamp`).
 *
 * The contract only accepts cliffs and durations that are whole multiples of
 * the 90-day interval (3-month granularity), so every state transition
 * happens exactly on an interval boundary — which is what `unlockTimestamps`
 * relies on.
 */

/** Derived lifecycle of a schedule (data-model `ScheduleView.state`). */
export type VestingState = 'not-started' | 'cliff' | 'vesting' | 'fully-vested';

/** The four time/amount fields every schedule carries, in seconds / base units. */
export interface VestingSchedule {
  /** Unix seconds the schedule starts vesting from. */
  start: bigint;
  /** Seconds until the cliff (`cliffMonths * 30 days`). */
  cliffDuration: bigint;
  /** Total length in seconds (`durationMonths * 30 days`). */
  duration: bigint;
  /** Total tokens to vest, in base units. */
  totalAmount: bigint;
}

/** Everything the UI derives from a schedule + a chain timestamp. */
export interface ScheduleView {
  /** Tokens vested at `now` (contract `vestedAmount`). */
  vested: bigint;
  /** `vested - released` at `now` (contract `releasableAmount`). */
  releasable: bigint;
  /** `vested / totalAmount` as a 0..1 ratio. */
  progress: number;
  /** Lifecycle label for the card. */
  state: VestingState;
  /** Next timestamp where `vested` increases, `null` once fully vested. */
  nextUnlockAt: bigint | null;
}

/** Contract step: 90 days (`VestingFactory.INTERVAL`). */
export const INTERVAL = 90n * 86_400n;

/**
 * Vested tokens of `schedule` at chain time `now` (floor, mirrors the contract).
 *
 * The first branch also covers "before start" because `cliffDuration >= 0`,
 * exactly like the Solidity version. Since `duration` is a whole multiple of
 * the 90-day interval, `duration / INTERVAL >= 1` — no division by zero — and
 * the middle branch can never exceed `totalAmount`.
 */
export function vestedAmount(schedule: VestingSchedule, now: bigint): bigint {
  if (now < schedule.start + schedule.cliffDuration) {
    return 0n;
  }
  if (now >= schedule.start + schedule.duration) {
    return schedule.totalAmount;
  }
  const completedIntervals = (now - schedule.start) / INTERVAL;
  const totalIntervals = schedule.duration / INTERVAL;
  return (schedule.totalAmount * completedIntervals) / totalIntervals;
}

/** `vested - released` at `now` — what `release(id)` would pay out. */
export function releasableAmount(
  schedule: VestingSchedule,
  released: bigint,
  now: bigint,
): bigint {
  return vestedAmount(schedule, now) - released;
}

/**
 * Lifecycle label at `now`:
 * `not-started` before `start`, `cliff` until `start + cliffDuration`
 * (exclusive of the cliff instant itself — tokens vest there), `vesting`
 * until `start + duration`, then `fully-vested`. A zero cliff means the
 * schedule goes straight from `not-started` to `vesting`.
 */
export function vestingState(schedule: VestingSchedule, now: bigint): VestingState {
  if (now < schedule.start) {
    return 'not-started';
  }
  if (now >= schedule.start + schedule.duration) {
    return 'fully-vested';
  }
  if (now < schedule.start + schedule.cliffDuration) {
    return 'cliff';
  }
  return 'vesting';
}

/**
 * `vested / totalAmount` at `now` as a 0..1 ratio (progress bars, claim
 * gating visuals). `vested` never exceeds `totalAmount`, so the ratio never
 * exceeds 1; the `totalAmount == 0` guard only defends against malformed
 * input (the contract rejects zero amounts at creation).
 */
export function progress(schedule: VestingSchedule, now: bigint): number {
  if (schedule.totalAmount === 0n) {
    return 0;
  }
  return Number(vestedAmount(schedule, now)) / Number(schedule.totalAmount);
}

/**
 * First timestamp where `vested` increases that is strictly after `now`;
 * `null` once every boundary has passed (fully vested).
 */
export function nextUnlockAt(schedule: VestingSchedule, now: bigint): bigint | null {
  const unlocks = unlockTimestamps(schedule);
  for (const unlock of unlocks) {
    if (unlock > now) {
      return unlock;
    }
  }
  return null;
}

/**
 * Every timestamp where `vested` increases, ascending — the timeline marks
 * (start, cliff, each 90-day unlock, end). Boundaries that do not increase
 * `vested` (e.g. everything strictly before the cliff) are excluded, so a
 * cliff equal to the duration yields a single unlock at `start + duration`.
 */
export function unlockTimestamps(schedule: VestingSchedule): bigint[] {
  const totalIntervals = schedule.duration / INTERVAL;
  const timestamps: bigint[] = [];
  for (let k = 1n; k <= totalIntervals; k++) {
    const at = schedule.start + k * INTERVAL;
    if (vestedAmount(schedule, at) > vestedAmount(schedule, at - 1n)) {
      timestamps.push(at);
    }
  }
  return timestamps;
}

/** All derived fields in one call (data-model `ScheduleView`). */
export function deriveScheduleView(
  schedule: VestingSchedule,
  released: bigint,
  now: bigint,
): ScheduleView {
  const vested = vestedAmount(schedule, now);
  return {
    vested,
    releasable: vested - released,
    progress: progress(schedule, now),
    state: vestingState(schedule, now),
    nextUnlockAt: nextUnlockAt(schedule, now),
  };
}
