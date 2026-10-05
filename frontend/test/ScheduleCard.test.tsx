/**
 * T041 — ScheduleCard + VestingProgress (US2, FR-020) — tests FIRST (strict
 * TDD). Pure components: no wagmi, no wallet, no chain.
 *
 * Rules under test:
 *  - the card shows token, total, released and releasable amounts formatted
 *    with the schedule token's decimals (FR-020)
 *  - every derived value comes from the vesting math fed with the PROVIDED
 *    chain timestamp — the card never reads the wall clock
 *  - the progress bar is an accessible progressbar whose value tracks
 *    vested/total, and the lifecycle state is labelled in plain words
 *  - the claim action renders in the card's action slot (wired in T044)
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ScheduleCard } from '../src/components/ScheduleCard';
import { VestingProgress } from '../src/components/VestingProgress';
import type { ScheduleRecord } from '../src/hooks/useSchedules';

const E18 = 10n ** 18n;
const START = 1_700_000_000n;
const INTERVAL = 7_776_000n; // 90 days
const DURATION = 15_552_000n; // 180 days = 2 intervals
const TOTAL = 900n * E18;

/** A two-interval schedule for TEST (18 decimals). */
const SCHEDULE: ScheduleRecord = {
  id: 7n,
  token: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  grantor: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  beneficiary: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  start: START,
  cliffDuration: INTERVAL,
  duration: DURATION,
  totalAmount: TOTAL,
  released: 0n,
  tokenSymbol: 'TEST',
  tokenDecimals: 18,
};

/** After one full interval: vested = 900 / 2 = 450 TEST. */
const MID = START + INTERVAL + 100n;

describe('VestingProgress', () => {
  it('shows the vested percentage and the lifecycle state in words', () => {
    render(<VestingProgress progress={0.5} state="vesting" />);

    expect(screen.getByText('50% vested')).toBeInTheDocument();
    expect(screen.getByText('Vesting')).toBeInTheDocument();
  });

  it('exposes an accessible progressbar with the percentage as its value', () => {
    render(<VestingProgress progress={0.5} state="vesting" />);

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('fills the bar in proportion to progress', () => {
    const { rerender } = render(<VestingProgress progress={0.5} state="vesting" />);

    const bar = screen.getByRole('progressbar');
    expect(bar.firstChild).toHaveStyle({ width: '50%' });

    rerender(<VestingProgress progress={1} state="fully-vested" />);
    expect(screen.getByRole('progressbar').firstChild).toHaveStyle({ width: '100%' });
  });

  it('labels every lifecycle state distinctly', () => {
    const cases = [
      ['not-started', 'Not started'],
      ['cliff', 'Cliff'],
      ['vesting', 'Vesting'],
      ['fully-vested', 'Fully vested'],
    ] as const;

    for (const [state, label] of cases) {
      const view = render(<VestingProgress progress={0} state={state} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      view.unmount();
    }
  });
});

describe('ScheduleCard', () => {
  it('shows token, total, released and releasable amounts formatted with token decimals', () => {
    render(<ScheduleCard schedule={SCHEDULE} now={MID} />);

    expect(screen.getByText('Schedule #7')).toBeInTheDocument();
    expect(screen.getByText('TEST')).toBeInTheDocument(); // token row
    expect(screen.getByText('900 TEST')).toBeInTheDocument(); // total
    expect(screen.getByText('0 TEST')).toBeInTheDocument(); // released
    expect(screen.getByText('450 TEST')).toBeInTheDocument(); // releasable at MID
  });

  it('derives state and progress from the provided chain time, not the wall clock', () => {
    const { rerender } = render(<ScheduleCard schedule={SCHEDULE} now={MID} />);

    // one interval of two elapsed → 50%, still vesting
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('Vesting')).toBeInTheDocument();

    // at start + duration with 300 TEST already released → 100%, 600 releasable
    rerender(
      <ScheduleCard schedule={{ ...SCHEDULE, released: 300n * E18 }} now={START + DURATION} />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('Fully vested')).toBeInTheDocument();
    expect(screen.getByText('600 TEST')).toBeInTheDocument();
    expect(screen.getByText('300 TEST')).toBeInTheDocument(); // released row
  });

  it('shows nothing vested and Not started before the schedule starts', () => {
    render(<ScheduleCard schedule={SCHEDULE} now={START - 1n} />);

    // released and releasable are both zero before the start
    expect(screen.getAllByText('0 TEST')).toHaveLength(2);
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('renders the claim action in its action slot', () => {
    const onClaim = vi.fn();
    render(
      <ScheduleCard schedule={SCHEDULE} now={MID}>
        <button type="button" onClick={onClaim}>
          Claim
        </button>
      </ScheduleCard>,
    );

    const button = screen.getByRole('button', { name: 'Claim' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onClaim).toHaveBeenCalledTimes(1);
  });
});
