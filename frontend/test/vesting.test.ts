/**
 * T036 — pure vesting-progress math (`src/lib/vesting.ts`) — tests FIRST
 * (strict TDD, User Story 2 / data-model `ScheduleView`).
 *
 * The math mirrors `VestingFactory.sol` exactly:
 *   - before `start + cliff`      → vested 0
 *   - at/after `start + duration` → vested = totalAmount
 *   - otherwise floor(totalAmount * ((now - start) / 90 days) / (duration / 90 days))
 *
 * Everything is BigInt, and `now` is always PASSED IN — never Date.now():
 * on a local chain with time warping the browser clock and the chain clock
 * differ, and the UI must match the contract.
 *
 * Exact numbers are asserted at: cliff - 1s, the exact cliff, every 90-day
 * boundary and boundary - 1s, start + duration - 1s, start + duration, zero
 * cliff, cliff == duration, a remainder (floor) amount, and a 1e30-scale
 * amount.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveScheduleView,
  nextUnlockAt,
  progress,
  releasableAmount,
  unlockTimestamps,
  vestedAmount,
  vestingState,
  type VestingSchedule,
} from '../src/lib/vesting';

const E18 = 10n ** 18n;
const DAY = 86_400n;
const MONTH = 30n * DAY; // contract month = 30 days
const INTERVAL = 90n * DAY; // contract step = 90 days
const BASE = 1_700_000_000n; // fixed start — deliberately far from Date.now()

/** 3-month cliff (= 1 interval), 9-month duration (= 3 intervals), 900 tokens. */
const A: VestingSchedule = {
  start: BASE,
  cliffDuration: 3n * MONTH,
  duration: 9n * MONTH,
  totalAmount: 900n * E18,
};
const CLIFF_A = BASE + INTERVAL;
const MID_A = BASE + 2n * INTERVAL;
const END_A = BASE + 3n * INTERVAL; // start + duration

describe('vestedAmount — mirrors the contract step formula', () => {
  it('is 0 before start', () => {
    expect(vestedAmount(A, BASE - 1n)).toBe(0n);
  });

  it('is 0 at cliff - 1s', () => {
    expect(vestedAmount(A, CLIFF_A - 1n)).toBe(0n);
  });

  it('is exactly 300e18 at the exact cliff', () => {
    expect(vestedAmount(A, CLIFF_A)).toBe(300n * E18);
  });

  it('holds the previous step at boundary 2 - 1s', () => {
    expect(vestedAmount(A, MID_A - 1n)).toBe(300n * E18);
  });

  it('is exactly 600e18 at boundary 2', () => {
    expect(vestedAmount(A, MID_A)).toBe(600n * E18);
  });

  it('is 600e18 at start + duration - 1s', () => {
    expect(vestedAmount(A, END_A - 1n)).toBe(600n * E18);
  });

  it('is exactly 900e18 at start + duration', () => {
    expect(vestedAmount(A, END_A)).toBe(900n * E18);
  });

  it('never exceeds totalAmount long after the end', () => {
    expect(vestedAmount(A, END_A + 10_000_000n)).toBe(900n * E18);
  });
});

describe('vestedAmount — zero cliff', () => {
  const Z: VestingSchedule = {
    start: BASE,
    cliffDuration: 0n,
    duration: 6n * MONTH, // 2 intervals
    totalAmount: 600n * E18,
  };

  it('is 0 at start (no interval completed yet)', () => {
    expect(vestedAmount(Z, BASE)).toBe(0n);
  });

  it('is 0 at the first boundary - 1s', () => {
    expect(vestedAmount(Z, BASE + INTERVAL - 1n)).toBe(0n);
  });

  it('is 300e18 at the first boundary', () => {
    expect(vestedAmount(Z, BASE + INTERVAL)).toBe(300n * E18);
  });

  it('is 600e18 at start + duration', () => {
    expect(vestedAmount(Z, BASE + 2n * INTERVAL)).toBe(600n * E18);
  });
});

describe('vestedAmount — cliff equal to duration', () => {
  const CD: VestingSchedule = {
    start: BASE,
    cliffDuration: 6n * MONTH,
    duration: 6n * MONTH, // cliff == duration
    totalAmount: 600n * E18,
  };
  const END_CD = BASE + 6n * MONTH;

  it('is 0 until one second before the end', () => {
    expect(vestedAmount(CD, END_CD - 1n)).toBe(0n);
  });

  it('is exactly 600e18 at the end', () => {
    expect(vestedAmount(CD, END_CD)).toBe(600n * E18);
  });
});

describe('vestedAmount — floor division keeps remainders', () => {
  // 10 wei over 4 intervals: floor steps are 2, 5, 7.5→7, 10 — never rounded up.
  const R: VestingSchedule = {
    start: BASE,
    cliffDuration: 0n,
    duration: 12n * MONTH, // 4 intervals
    totalAmount: 10n,
  };

  it('floors at every boundary (10 * k / 4)', () => {
    expect(vestedAmount(R, BASE + INTERVAL)).toBe(2n);
    expect(vestedAmount(R, BASE + 2n * INTERVAL)).toBe(5n);
    expect(vestedAmount(R, BASE + 3n * INTERVAL)).toBe(7n);
    expect(vestedAmount(R, BASE + 4n * INTERVAL)).toBe(10n);
  });

  it('holds the previous step at boundary 3 - 1s', () => {
    expect(vestedAmount(R, BASE + 3n * INTERVAL - 1n)).toBe(5n);
  });
});

describe('vestedAmount — 1e30-scale amount stays exact', () => {
  const BIG: VestingSchedule = {
    start: BASE,
    cliffDuration: 3n * MONTH,
    duration: 9n * MONTH,
    totalAmount: 10n ** 30n,
  };

  it('floors 1e30 / 3 exactly at the cliff', () => {
    expect(vestedAmount(BIG, CLIFF_A)).toBe(333_333_333_333_333_333_333_333_333_333n);
  });

  it('floors 2e30 / 3 exactly at boundary 2', () => {
    expect(vestedAmount(BIG, MID_A)).toBe(666_666_666_666_666_666_666_666_666_666n);
  });

  it('is exactly 1e30 at start + duration', () => {
    expect(vestedAmount(BIG, END_A)).toBe(10n ** 30n);
  });
});

describe('vestingState — not-started | cliff | vesting | fully-vested', () => {
  it('is not-started before start', () => {
    expect(vestingState(A, BASE - 1n)).toBe('not-started');
  });

  it('is cliff at start', () => {
    expect(vestingState(A, BASE)).toBe('cliff');
  });

  it('is cliff at cliff - 1s', () => {
    expect(vestingState(A, CLIFF_A - 1n)).toBe('cliff');
  });

  it('is vesting at the exact cliff', () => {
    expect(vestingState(A, CLIFF_A)).toBe('vesting');
  });

  it('is vesting at start + duration - 1s', () => {
    expect(vestingState(A, END_A - 1n)).toBe('vesting');
  });

  it('is fully-vested at start + duration', () => {
    expect(vestingState(A, END_A)).toBe('fully-vested');
  });

  it('stays fully-vested after the end', () => {
    expect(vestingState(A, END_A + 1n)).toBe('fully-vested');
  });

  it('is vesting (not cliff) at start when the cliff is zero', () => {
    const Z: VestingSchedule = {
      start: BASE,
      cliffDuration: 0n,
      duration: 6n * MONTH,
      totalAmount: 600n * E18,
    };
    expect(vestingState(Z, BASE)).toBe('vesting');
    expect(vestingState(Z, BASE - 1n)).toBe('not-started');
  });

  it('stays cliff for the whole schedule when cliff == duration', () => {
    const CD: VestingSchedule = {
      start: BASE,
      cliffDuration: 6n * MONTH,
      duration: 6n * MONTH,
      totalAmount: 600n * E18,
    };
    expect(vestingState(CD, BASE)).toBe('cliff');
    expect(vestingState(CD, BASE + MONTH)).toBe('cliff');
    expect(vestingState(CD, BASE + 6n * MONTH - 1n)).toBe('cliff');
    expect(vestingState(CD, BASE + 6n * MONTH)).toBe('fully-vested');
  });
});

describe('progress — 0..1 ratio of vested over total', () => {
  it('is 0 before the cliff', () => {
    expect(progress(A, BASE)).toBe(0);
    expect(progress(A, CLIFF_A - 1n)).toBe(0);
  });

  it('is exactly 1/3 at the cliff (300e18 of 900e18)', () => {
    expect(progress(A, CLIFF_A)).toBe(1 / 3);
  });

  it('is exactly 2/3 at boundary 2 (600e18 of 900e18)', () => {
    expect(progress(A, MID_A)).toBe(2 / 3);
  });

  it('is exactly 1 at start + duration and beyond', () => {
    expect(progress(A, END_A)).toBe(1);
    expect(progress(A, END_A + 1000n)).toBe(1);
  });

  it('is ~1/3 at the cliff for a 1e30-scale amount', () => {
    const BIG: VestingSchedule = {
      start: BASE,
      cliffDuration: 3n * MONTH,
      duration: 9n * MONTH,
      totalAmount: 10n ** 30n,
    };
    expect(progress(BIG, CLIFF_A)).toBeCloseTo(1 / 3, 12);
  });

  it('is 0.2 at the first boundary of the 10-wei remainder schedule', () => {
    const R: VestingSchedule = {
      start: BASE,
      cliffDuration: 0n,
      duration: 12n * MONTH,
      totalAmount: 10n,
    };
    expect(progress(R, BASE + INTERVAL)).toBeCloseTo(0.2, 15);
  });
});

describe('releasableAmount — vested minus released', () => {
  it('equals vested at the cliff when nothing was released', () => {
    expect(releasableAmount(A, 0n, CLIFF_A)).toBe(300n * E18);
  });

  it('subtracts what was already released', () => {
    expect(releasableAmount(A, 100n * E18, CLIFF_A)).toBe(200n * E18);
  });

  it('is 0 before the cliff', () => {
    expect(releasableAmount(A, 0n, CLIFF_A - 1n)).toBe(0n);
  });

  it('reflects the remaining tail at the end', () => {
    expect(releasableAmount(A, 300n * E18, END_A)).toBe(600n * E18);
  });
});

describe('nextUnlockAt — strictly after now, null when done', () => {
  it('is the first boundary before start', () => {
    expect(nextUnlockAt(A, BASE - 1n)).toBe(CLIFF_A);
  });

  it('is the cliff when one second away', () => {
    expect(nextUnlockAt(A, CLIFF_A - 1n)).toBe(CLIFF_A);
  });

  it('skips to the following boundary when now is exactly an unlock', () => {
    expect(nextUnlockAt(A, CLIFF_A)).toBe(MID_A);
  });

  it('is the end when one second away', () => {
    expect(nextUnlockAt(A, END_A - 1n)).toBe(END_A);
  });

  it('is null at and after start + duration', () => {
    expect(nextUnlockAt(A, END_A)).toBeNull();
    expect(nextUnlockAt(A, END_A + 100n)).toBeNull();
  });

  it('is the first boundary for a zero-cliff schedule at start', () => {
    const Z: VestingSchedule = {
      start: BASE,
      cliffDuration: 0n,
      duration: 6n * MONTH,
      totalAmount: 600n * E18,
    };
    expect(nextUnlockAt(Z, BASE)).toBe(BASE + INTERVAL);
  });

  it('jumps straight to the end when cliff == duration (nothing vests earlier)', () => {
    const CD: VestingSchedule = {
      start: BASE,
      cliffDuration: 6n * MONTH,
      duration: 6n * MONTH,
      totalAmount: 600n * E18,
    };
    expect(nextUnlockAt(CD, BASE)).toBe(BASE + 6n * MONTH);
  });
});

describe('unlockTimestamps — timeline marks where vested increases', () => {
  it('lists every 90-day boundary of a cliff schedule (cliff is boundary 1)', () => {
    expect(unlockTimestamps(A)).toEqual([CLIFF_A, MID_A, END_A]);
  });

  it('lists both boundaries of a zero-cliff 6-month schedule', () => {
    const Z: VestingSchedule = {
      start: BASE,
      cliffDuration: 0n,
      duration: 6n * MONTH,
      totalAmount: 600n * E18,
    };
    expect(unlockTimestamps(Z)).toEqual([BASE + INTERVAL, BASE + 2n * INTERVAL]);
  });

  it('excludes boundaries before the cliff when cliff == duration', () => {
    const CD: VestingSchedule = {
      start: BASE,
      cliffDuration: 6n * MONTH,
      duration: 6n * MONTH,
      totalAmount: 600n * E18,
    };
    expect(unlockTimestamps(CD)).toEqual([BASE + 6n * MONTH]);
  });

  it('includes all four boundaries of the remainder schedule', () => {
    const R: VestingSchedule = {
      start: BASE,
      cliffDuration: 0n,
      duration: 12n * MONTH,
      totalAmount: 10n,
    };
    expect(unlockTimestamps(R)).toEqual([
      BASE + INTERVAL,
      BASE + 2n * INTERVAL,
      BASE + 3n * INTERVAL,
      BASE + 4n * INTERVAL,
    ]);
  });
});

describe('deriveScheduleView — composes every derived field', () => {
  it('derives vested, releasable, progress, state and next unlock together', () => {
    expect(deriveScheduleView(A, 100n * E18, CLIFF_A)).toEqual({
      vested: 300n * E18,
      releasable: 200n * E18,
      progress: 1 / 3,
      state: 'vesting',
      nextUnlockAt: MID_A,
    });
  });

  it('derives the not-started snapshot before start', () => {
    expect(deriveScheduleView(A, 0n, BASE - 1n)).toEqual({
      vested: 0n,
      releasable: 0n,
      progress: 0,
      state: 'not-started',
      nextUnlockAt: CLIFF_A,
    });
  });
});
