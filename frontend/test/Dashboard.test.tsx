/**
 * T043 — Dashboard page (US2, FR-019…FR-023) — tests FIRST (strict TDD).
 *
 * Rules under test:
 *  - no wallet → a connect prompt, NOT an error and NOT a spinner
 *  - loading → labelled skeleton; error → alert + working Retry (refetch)
 *  - empty wallet → explanation + link to /create
 *  - data → every schedule listed as a card (amounts + progress bar) with its
 *    timeline, all derived from the chain timestamp the hook provides
 *
 * `useSchedules` is mocked at the hook boundary (its own contract is covered
 * in useSchedules.test.tsx); wagmi is mocked for the wallet address.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import Dashboard from '../src/pages/Dashboard';
import type { ScheduleRecord } from '../src/hooks/useSchedules';

const wagmi = vi.hoisted(() => ({
  useAccount: vi.fn(),
  useReadContract: vi.fn(),
  useWriteContract: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
}));
vi.mock('wagmi', () => wagmi);

const hook = vi.hoisted(() => ({ useSchedules: vi.fn() }));
vi.mock('../src/hooks/useSchedules', () => hook);

const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const OTHER_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const START = 1_700_000_000n;
const DAY = 86_400n;
const E18 = 10n ** 18n;
/** 100 days after start — one full interval elapsed, still mid-vesting. */
const NOW = START + 100n * DAY;

function scheduleWith(overrides: Partial<ScheduleRecord>): ScheduleRecord {
  return {
    id: 7n,
    token: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    grantor: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    beneficiary: WALLET,
    start: START,
    cliffDuration: 90n * DAY,
    duration: 180n * DAY,
    totalAmount: 900n * E18,
    released: 0n,
    tokenSymbol: 'TEST',
    tokenDecimals: 18,
    ...overrides,
  };
}

interface Given {
  address?: `0x${string}`;
  schedules?: ScheduleRecord[];
  isLoading?: boolean;
  error?: Error | null;
}

function given(input: Given = {}) {
  const { address, schedules, isLoading = false, error = null } = input;
  const refetch = vi.fn().mockResolvedValue(undefined);
  // NOTE: `address: undefined` must mean "no wallet" — a destructuring default
  // would swallow an explicit undefined, so default only when key is absent.
  wagmi.useAccount.mockReturnValue({ address: 'address' in input ? address : WALLET });
  hook.useSchedules.mockReturnValue({
    data: schedules ? { schedules, now: NOW } : undefined,
    isLoading,
    error,
    refetch,
  });
  return { refetch };
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

describe('Dashboard', () => {
  beforeEach(() => {
    hook.useSchedules.mockReset();
    wagmi.useAccount.mockReset();
    wagmi.useReadContract.mockReset();
    wagmi.useWriteContract.mockReset();
    wagmi.useWaitForTransactionReceipt.mockReset();
    // ClaimButton (rendered inside cards) defaults — tests override as needed
    wagmi.useReadContract.mockReturnValue({
      data: undefined,
      refetch: vi.fn(),
      error: undefined,
    });
    wagmi.useWriteContract.mockReturnValue({
      writeContract: vi.fn(),
      data: undefined,
      isPending: false,
      error: undefined,
      reset: vi.fn(),
    });
    wagmi.useWaitForTransactionReceipt.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
    });
  });

  it('shows a connect prompt, not an error, when no wallet is connected', () => {
    given({ address: undefined });

    renderDashboard();

    expect(screen.getByText('Connect your wallet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a labelled skeleton while schedules are in flight', () => {
    given({ isLoading: true });

    renderDashboard();

    expect(screen.getByRole('status', { name: 'Loading schedules' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error with a Retry that refetches', () => {
    const { refetch } = given({ error: new Error('rpc down') });

    renderDashboard();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('explains an empty wallet and links to the create page', () => {
    given({ schedules: [] });

    renderDashboard();

    expect(screen.getByText('No schedules yet')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Create a schedule' });
    expect(link).toHaveAttribute('href', '/create');
  });

  it('lists every schedule as a card with amounts, progress and a timeline', () => {
    given({
      schedules: [
        scheduleWith({}),
        scheduleWith({
          id: 11n,
          token: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
          totalAmount: 42n * 10n ** 6n,
          tokenSymbol: 'OTHR',
          tokenDecimals: 6,
        }),
      ],
    });

    renderDashboard();

    expect(screen.getByText('Schedule #7')).toBeInTheDocument();
    expect(screen.getByText('Schedule #11')).toBeInTheDocument();
    expect(screen.getByText('900 TEST')).toBeInTheDocument(); // total
    expect(screen.getByText('450 TEST')).toBeInTheDocument(); // releasable at NOW
    expect(screen.getByText('42 OTHR')).toBeInTheDocument();
    expect(screen.getByText('21 OTHR')).toBeInTheDocument();
    // one progress bar + one timeline per schedule
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: 'Vesting timeline' })).toHaveLength(2);
  });

  it('keeps the error hidden when stale data is already on screen', () => {
    const { refetch } = given({ schedules: [scheduleWith({})], error: new Error('refetch failed') });

    renderDashboard();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Schedule #7')).toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled(); // nothing to retry — data is shown
  });

  it('offers the claim action to the beneficiary wallet (connected, releasable > 0)', () => {
    wagmi.useReadContract.mockReturnValue({
      data: 450n * 10n ** 18n,
      refetch: vi.fn(),
      error: undefined,
    });
    given({ schedules: [scheduleWith({})] });

    renderDashboard();

    expect(screen.getByRole('button', { name: 'Claim' })).toBeEnabled();
  });

  it('never offers a claim action to a wallet that is not the beneficiary', () => {
    given({ address: OTHER_WALLET, schedules: [scheduleWith({})] });

    renderDashboard();

    // the schedule card itself is still listed (defense in depth — scenario 7)
    expect(screen.getByText('Schedule #7')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Nothing vested yet' }),
    ).not.toBeInTheDocument();
  });
});
