/**
 * T044 — ClaimButton (US2, FR-021/FR-022) — tests FIRST (strict TDD).
 * wagmi fully mocked: no wallet, no chain.
 *
 * Rules under test:
 *  - visible ONLY for the connected wallet that is the schedule beneficiary
 *    (no wallet → nothing; other wallet → nothing)
 *  - before the cliff: disabled with the exact text "Nothing vested yet",
 *    and no chain read is fired for the releasable amount
 *  - after the cliff: enabled IF AND ONLY IF the on-chain
 *    releasableAmount(schedule id) is greater than zero (FR-021)
 *  - click → release(id) on the factory with the generated ABI
 *  - pending → confirmed chip (FR-022) and BOTH the dashboard schedules and
 *    the releasable read are refetched after the receipt confirms
 *  - a NothingToRelease revert decodes to a friendly sentence (never raw
 *    revert data, FR-017)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const wagmi = vi.hoisted(() => ({
  account: { address: undefined as string | undefined },
  read: {
    data: undefined as bigint | undefined,
    refetch: vi.fn().mockResolvedValue(undefined),
    options: [] as unknown[],
  },
  writeContract: vi.fn(),
  write: {
    data: undefined as string | undefined,
    isPending: false,
    error: undefined as unknown,
    reset: vi.fn(),
  },
  receipt: {
    data: undefined as { status?: string } | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: wagmi.account.address }),
  useReadContract: (options: unknown) => {
    wagmi.read.options.push(options);
    return { data: wagmi.read.data, refetch: wagmi.read.refetch, error: undefined };
  },
  useWriteContract: () => ({
    writeContract: wagmi.writeContract,
    data: wagmi.write.data,
    isPending: wagmi.write.isPending,
    error: wagmi.write.error,
    reset: wagmi.write.reset,
  }),
  useWaitForTransactionReceipt: () => wagmi.receipt,
}));

import { ClaimButton } from '../src/components/ClaimButton';
import type { ScheduleRecord } from '../src/hooks/useSchedules';
import { abiFor, activeChainId, contractAddress } from '../src/contracts';

const BENEFICIARY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const OTHER_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const HASH = '0x2222222222222222222222222222222222222222222222222222222222222222';
const START = 1_700_000_000n;
const DAY = 86_400n;
const E18 = 10n ** 18n;

const SCHEDULE: ScheduleRecord = {
  id: 7n,
  token: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  grantor: OTHER_WALLET,
  beneficiary: BENEFICIARY,
  start: START,
  cliffDuration: 90n * DAY,
  duration: 180n * DAY,
  totalAmount: 900n * E18,
  released: 0n,
  tokenSymbol: 'TEST',
  tokenDecimals: 18,
};

const BEFORE_CLIFF = START + 10n * DAY;
const AFTER_CLIFF = START + 100n * DAY;

const refetchSchedules = vi.fn().mockResolvedValue(undefined);

/** A viem-style revert carrying the NothingToRelease custom error. */
function nothingToReleaseError() {
  return Object.assign(new Error('execution reverted: NothingToRelease()'), {
    shortMessage: 'execution reverted with custom error NothingToRelease()',
    details: 'NothingToRelease()',
  });
}

function renderButton(now: bigint) {
  return render(
    <ClaimButton schedule={SCHEDULE} now={now} refetchSchedules={refetchSchedules} />,
  );
}

beforeEach(() => {
  wagmi.account.address = BENEFICIARY;
  wagmi.read.data = undefined;
  wagmi.read.refetch.mockClear();
  wagmi.read.options.length = 0;
  wagmi.writeContract.mockReset();
  wagmi.write.data = undefined;
  wagmi.write.isPending = false;
  wagmi.write.error = undefined;
  wagmi.receipt.data = undefined;
  wagmi.receipt.isLoading = false;
  wagmi.receipt.error = undefined;
  refetchSchedules.mockClear();
});

describe('ClaimButton', () => {
  it('renders nothing when no wallet is connected', () => {
    wagmi.account.address = undefined;

    const { container } = renderButton(AFTER_CLIFF);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the connected wallet is not the beneficiary', () => {
    wagmi.account.address = OTHER_WALLET;

    const { container } = renderButton(AFTER_CLIFF);

    expect(container).toBeEmptyDOMElement();
  });

  it('is disabled before the cliff with "Nothing vested yet" and reads nothing yet', () => {
    renderButton(BEFORE_CLIFF);

    const button = screen.getByRole('button', { name: 'Nothing vested yet' });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
    // the releasable read stays off until the cliff passes (no wasted RPC)
    expect(wagmi.read.options[0]).toMatchObject({ query: { enabled: false } });
  });

  it('is enabled after the cliff when the on-chain releasable amount is above zero', () => {
    wagmi.read.data = 450n * E18;

    renderButton(AFTER_CLIFF);

    expect(screen.getByRole('button', { name: 'Claim' })).toBeEnabled();
    expect(wagmi.read.options[0]).toMatchObject({
      functionName: 'releasableAmount',
      args: [SCHEDULE.id],
    });
    expect(wagmi.read.options[0]).toMatchObject({ query: { enabled: true } });
  });

  it('stays disabled after the cliff when nothing is releasable (FR-021)', () => {
    wagmi.read.data = 0n;

    renderButton(START + 180n * DAY); // fully vested, everything claimed

    expect(screen.getByRole('button', { name: 'Claim' })).toBeDisabled();
  });

  it('submits release(id) to the factory with the generated ABI', () => {
    wagmi.read.data = 450n * E18;
    const view = renderButton(AFTER_CLIFF);

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));

    expect(wagmi.writeContract).toHaveBeenCalledWith({
      address: contractAddress(activeChainId, 'VestingFactory'),
      abi: abiFor('VestingFactory'),
      functionName: 'release',
      args: [SCHEDULE.id],
      chainId: activeChainId,
    });
    view.unmount();
  });

  it('shows pending then confirmed, refetching schedules and releasable after the receipt', () => {
    wagmi.read.data = 450n * E18;
    const view = renderButton(AFTER_CLIFF);

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // wallet signed → submitted
    wagmi.write.data = HASH;
    view.rerender(
      <ClaimButton schedule={SCHEDULE} now={AFTER_CLIFF} refetchSchedules={refetchSchedules} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Claim: Pending');

    // receipt found → confirmed + both queries refreshed (FR-022)
    wagmi.receipt.data = { status: 'success' };
    view.rerender(
      <ClaimButton schedule={SCHEDULE} now={AFTER_CLIFF} refetchSchedules={refetchSchedules} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Claim: Confirmed');
    expect(refetchSchedules).toHaveBeenCalledTimes(1);
    expect(wagmi.read.refetch).toHaveBeenCalledTimes(1);
  });

  it('decodes a NothingToRelease revert into a friendly sentence (FR-017)', () => {
    wagmi.read.data = 450n * E18;
    const view = renderButton(AFTER_CLIFF);

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    wagmi.write.error = nothingToReleaseError();
    view.rerender(
      <ClaimButton schedule={SCHEDULE} now={AFTER_CLIFF} refetchSchedules={refetchSchedules} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Claim: Failed');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'There is nothing to release right now — no tokens have vested since your last claim.',
    );
  });
});
