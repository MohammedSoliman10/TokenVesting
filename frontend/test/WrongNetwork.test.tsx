/**
 * T048 — wrong-network guard for ALL FOUR writes (faucet, approve,
 * createSchedule, release/claim) — tests FIRST (strict TDD). wagmi is
 * mocked: no live chain, no wallet.
 *
 * Rules under test (FR-015):
 *  - a write attempt on a chain that is NOT `activeChainId` is BLOCKED —
 *    no wallet write is ever sent
 *  - a visible "Switch network" prompt is shown while the chain is wrong,
 *    and its button calls `switchChain({ chainId: activeChainId })`
 *  - the write only proceeds after `switchChain` SUCCEEDS
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

const wagmi = vi.hoisted(() => ({
  account: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as string | undefined,
    // WRONG chain by default: the app targets `activeChainId` (31337).
    chainId: 11155111 as number | undefined,
  },
  switchChainAsync: vi.fn(),
  writeContract: vi.fn(),
  writeContractAsync: vi.fn(),
  write: { data: undefined, isPending: false, error: undefined, reset: vi.fn() },
  receipt: { data: undefined, isLoading: false, error: undefined },
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  releasable: 0n as bigint | undefined,
  publicClient: { getTransactionReceipt: vi.fn(), chain: { id: 31337 } },
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: wagmi.account.address, chainId: wagmi.account.chainId }),
  useSwitchChain: () => ({ switchChainAsync: wagmi.switchChainAsync, isPending: false }),
  useWriteContract: () => ({
    writeContract: wagmi.writeContract,
    writeContractAsync: wagmi.writeContractAsync,
    data: wagmi.write.data,
    isPending: wagmi.write.isPending,
    error: wagmi.write.error,
    reset: wagmi.write.reset,
  }),
  useWaitForTransactionReceipt: () => wagmi.receipt,
  useReadContract: () => ({ data: wagmi.releasable, refetch: vi.fn(), error: undefined }),
  usePublicClient: () => ({
    readContract: wagmi.readContract,
    waitForTransactionReceipt: wagmi.waitForTransactionReceipt,
    ...wagmi.publicClient,
  }),
}));

import { FaucetButton } from '../src/components/FaucetButton';
import { ClaimButton } from '../src/components/ClaimButton';
import CreateSchedule from '../src/pages/CreateSchedule';
import { useCreateSchedule, type CreateScheduleParams } from '../src/hooks/useCreateSchedule';
import type { ScheduleRecord } from '../src/hooks/useSchedules';
import { activeChainId, contractAddress } from '../src/contracts';

const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const TOKEN = contractAddress(activeChainId, 'TestToken')! as `0x${string}`;
const BENEFICIARY = '0x1111111111111111111111111111111111111111';

const APPROVE_HASH = '0xa111111111111111111111111111111111111111111111111111111111111111';
const CREATE_HASH = '0xc333333333333333333333333333333333333333333333333333333333333333';

const FULL_BALANCE = 1_000n * 10n ** 18n;

const PARAMS: CreateScheduleParams = {
  token: TOKEN,
  beneficiary: BENEFICIARY,
  start: 0,
  cliffMonths: 3,
  durationMonths: 6,
  amount: 100n * 10n ** 18n,
};

/** A schedule whose cliff has passed and whose wallet is the beneficiary. */
const SCHEDULE: ScheduleRecord = {
  id: 1n,
  token: TOKEN,
  grantor: WALLET,
  beneficiary: WALLET,
  start: 1_700_000_000n,
  cliffDuration: 90n * 86_400n,
  duration: 180n * 86_400n,
  totalAmount: 900n * 10n ** 18n,
  released: 0n,
  tokenSymbol: 'TEST',
  tokenDecimals: 18,
};
const AFTER_CLIFF = SCHEDULE.start + SCHEDULE.cliffDuration + 1n;

/** The visible switch-network prompt (button label uses the chain's name). */
const switchButton = () => screen.getByRole('button', { name: 'Switch to Anvil' });

/** "Switch network" wording must be visible while the chain is wrong. */
const promptShown = () => screen.getByText(/Wrong network/);

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Beneficiary address'), {
    target: { value: BENEFICIARY },
  });
  fireEvent.change(screen.getByLabelText('Cliff (months)'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Duration (months)'), { target: { value: '6' } });
  fireEvent.change(screen.getByLabelText('Amount (TEST)'), { target: { value: '100' } });
}

beforeEach(() => {
  wagmi.account.address = WALLET;
  wagmi.account.chainId = 11155111; // wrong for every test in this file
  wagmi.switchChainAsync.mockReset();
  wagmi.switchChainAsync.mockRejectedValue(new Error('user rejected the switch'));
  wagmi.writeContract.mockReset();
  wagmi.writeContractAsync.mockReset();
  wagmi.write.data = undefined;
  wagmi.write.isPending = false;
  wagmi.write.error = undefined;
  wagmi.receipt.data = undefined;
  wagmi.receipt.error = undefined;
  wagmi.releasable = 0n;
  wagmi.readContract.mockReset();
  wagmi.waitForTransactionReceipt.mockReset();
  wagmi.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === 'balanceOf') return FULL_BALANCE;
      if (functionName === 'symbol') return 'TEST';
      if (functionName === 'allowance') return 0n;
      return 0n;
    },
  );
  wagmi.waitForTransactionReceipt.mockResolvedValue({ logs: [] });
});

describe('wrong-network guard for every write path (T048)', () => {
  it('faucet: blocked on the wrong chain, prompt shown, proceeds only after switchChain succeeds', async () => {
    render(<FaucetButton />);

    // prompt is visible while the chain is wrong
    expect(promptShown()).toBeInTheDocument();
    expect(switchButton()).toBeInTheDocument();
    expect(wagmi.switchChainAsync).not.toHaveBeenCalled();

    // click #1: switch is rejected → the write must NOT go out
    fireEvent.click(screen.getByRole('button', { name: 'Get test tokens' }));
    await waitFor(() =>
      expect(wagmi.switchChainAsync).toHaveBeenCalledWith({ chainId: activeChainId }),
    );
    expect(wagmi.writeContract).not.toHaveBeenCalled();

    // click #2: switch now succeeds → the write proceeds
    wagmi.switchChainAsync.mockReset();
    wagmi.switchChainAsync.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Get test tokens' }));
    await waitFor(() =>
      expect(wagmi.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'faucet' }),
      ),
    );
  });

  it('approve + createSchedule: blocked on the wrong chain, prompt shown, proceeds only after switchChain succeeds', async () => {
    const { result } = renderHook(() => useCreateSchedule());

    // the page-level prompt covers the approve/create flow
    render(<CreateSchedule />);
    expect(promptShown()).toBeInTheDocument();
    expect(switchButton()).toBeInTheDocument();

    // click #1: switch rejected → nothing signed, nothing written
    await act(async () => {
      await result.current.create(PARAMS);
    });
    expect(wagmi.switchChainAsync).toHaveBeenCalledWith({ chainId: activeChainId });
    expect(wagmi.writeContractAsync).not.toHaveBeenCalled();

    // click #2: switch succeeds → approve, then createSchedule (sequenced)
    wagmi.switchChainAsync.mockReset();
    wagmi.switchChainAsync.mockResolvedValue(undefined);
    wagmi.writeContractAsync
      .mockResolvedValueOnce(APPROVE_HASH)
      .mockResolvedValueOnce(CREATE_HASH);
    await act(async () => {
      await result.current.create(PARAMS);
    });
    expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(2);
    const calls = wagmi.writeContractAsync.mock.calls.map(
      (call) => (call[0] as { functionName: string }).functionName,
    );
    expect(calls).toEqual(['approve', 'createSchedule']);
  });

  it('create form submit: blocked on the wrong chain, prompt shown, proceeds only after switchChain succeeds', async () => {
    render(<CreateSchedule />);
    await screen.findByText('Balance: 1000 TEST');
    expect(promptShown()).toBeInTheDocument();

    // submit #1: switch rejected → no write
    // Stage F: "Create schedule" only arms the beneficiary read-back; the
    // guard lives behind it, so the wallet is touched on Confirm.
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & create' }));
    await waitFor(() =>
      expect(wagmi.switchChainAsync).toHaveBeenCalledWith({ chainId: activeChainId }),
    );
    expect(wagmi.writeContractAsync).not.toHaveBeenCalled();

    // The prompt must be visible ON the review step too — `create()` bails out
    // silently on the wrong chain, so a bare Confirm would do nothing at all.
    expect(promptShown()).toBeInTheDocument();
    expect(switchButton()).toBeInTheDocument();

    // submit #2: switch succeeds → approve then create
    wagmi.switchChainAsync.mockReset();
    wagmi.switchChainAsync.mockResolvedValue(undefined);
    wagmi.writeContractAsync
      .mockResolvedValueOnce(APPROVE_HASH)
      .mockResolvedValueOnce(CREATE_HASH);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & create' }));
    await waitFor(() =>
      expect(wagmi.writeContractAsync).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'approve' }),
      ),
    );
    expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(2);
    const calls = wagmi.writeContractAsync.mock.calls.map(
      (call) => (call[0] as { functionName: string }).functionName,
    );
    expect(calls).toEqual(['approve', 'createSchedule']);
  });

  it('claim/release: blocked on the wrong chain, prompt shown, proceeds only after switchChain succeeds', async () => {
    wagmi.releasable = 300n * 10n ** 18n;
    render(
      <ClaimButton schedule={SCHEDULE} now={AFTER_CLIFF} refetchSchedules={vi.fn()} />,
    );

    // prompt is visible inside the claim card while the chain is wrong
    expect(promptShown()).toBeInTheDocument();
    expect(switchButton()).toBeInTheDocument();
    expect(wagmi.switchChainAsync).not.toHaveBeenCalled();

    // click #1: switch rejected → release must NOT go out
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    await waitFor(() =>
      expect(wagmi.switchChainAsync).toHaveBeenCalledWith({ chainId: activeChainId }),
    );
    expect(wagmi.writeContract).not.toHaveBeenCalled();

    // click #2: switch succeeds → release proceeds
    wagmi.switchChainAsync.mockReset();
    wagmi.switchChainAsync.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    await waitFor(() =>
      expect(wagmi.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'release' }),
      ),
    );
  });

  it('the prompt button itself switches to the target chain (activeChainId)', async () => {
    wagmi.switchChainAsync.mockResolvedValue(undefined);
    render(<FaucetButton />);

    fireEvent.click(switchButton());
    expect(wagmi.switchChainAsync).toHaveBeenCalledWith({ chainId: activeChainId });
  });

  it('no prompt while the wallet is already on the target chain', () => {
    wagmi.account.chainId = activeChainId;
    render(<FaucetButton />);

    expect(screen.queryByText(/Wrong network/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to Anvil' })).not.toBeInTheDocument();
  });
});
