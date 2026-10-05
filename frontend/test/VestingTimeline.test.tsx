/**
 * T042 — VestingTimeline (US2, FR-020) — tests FIRST (strict TDD).
 * Pure Recharts component: no wallet, no chain.
 *
 * Rules under test:
 *  - marks start, cliff, every interior 90-day unlock and end (FR-020)
 *  - a cliff landing exactly on an unlock merges into one marker instead of
 *    two overlapping labels; the final unlock coincides with end
 *  - the vested step-line is drawn with one dot per milestone (start, cliff,
 *    unlocks, end) — values from the vesting math, not the wall clock
 *  - the cumulative claimed amount is marked on the chart
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { VestingTimeline } from '../src/components/VestingTimeline';
import type { ScheduleRecord } from '../src/hooks/useSchedules';

const E18 = 10n ** 18n;
const START = 1_700_000_000n;
const DAY = 86_400n;

function scheduleWith(overrides: Partial<ScheduleRecord>): ScheduleRecord {
  return {
    id: 7n,
    token: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    grantor: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    beneficiary: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    start: START,
    cliffDuration: 30n * DAY, // 1 month — lands BETWEEN unlock boundaries
    duration: 180n * DAY, // 6 months = 2 intervals
    totalAmount: 900n * E18,
    released: 0n,
    tokenSymbol: 'TEST',
    tokenDecimals: 18,
    ...overrides,
  };
}

describe('VestingTimeline', () => {
  it('marks start, cliff, the interior unlock and end', () => {
    const { container } = render(<VestingTimeline schedule={scheduleWith({})} />);

    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Cliff')).toBeInTheDocument();
    expect(screen.getByText('End')).toBeInTheDocument();
    // only the 90-day boundary is an interior unlock (180d == end)
    expect(screen.getAllByText('Unlock')).toHaveLength(1);
    expect(container.querySelector('.recharts-reference-line-line')).not.toBeNull();
  });

  it('merges a cliff that lands exactly on an unlock and marks every later unlock', () => {
    render(
      <VestingTimeline
        schedule={scheduleWith({
          cliffDuration: 90n * DAY, // exactly the first unlock boundary
          duration: 360n * DAY, // 4 intervals → unlocks at 90/180/270/360d
        })}
      />,
    );

    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Cliff + Unlock')).toBeInTheDocument();
    // interior unlocks at 180d and 270d (360d coincides with end)
    expect(screen.getAllByText('Unlock')).toHaveLength(2);
    expect(screen.getByText('End')).toBeInTheDocument();
  });

  it('draws the vested step-line with one dot per milestone', () => {
    const { container } = render(<VestingTimeline schedule={scheduleWith({})} />);

    expect(container.querySelector('path.recharts-line-curve')).not.toBeNull();
    // milestones: start, cliff (30d), unlock (90d), end (180d)
    expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(4);
  });

  it('marks the cumulative claimed amount', () => {
    render(<VestingTimeline schedule={scheduleWith({ released: 300n * E18 })} />);

    expect(screen.getByText('Claimed')).toBeInTheDocument();
    expect(
      document.querySelectorAll('.recharts-reference-line-line').length,
    ).toBeGreaterThanOrEqual(5); // start, cliff, unlock, end + claimed
  });

  it('is exposed to assistive tech as a labelled chart image', () => {
    render(<VestingTimeline schedule={scheduleWith({})} />);

    expect(screen.getByRole('img', { name: 'Vesting timeline' })).toBeInTheDocument();
  });
});
