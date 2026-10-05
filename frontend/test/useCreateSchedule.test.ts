/**
 * T029 — approve → create funding flow hook (FR-019, data-model V7) — tests
 * FIRST (strict TDD). wagmi is mocked: no live chain, no wallet.
 *
 * Rules under test:
 *  - approval first, then create (sequenced, receipts awaited)
 *  - a sufficient existing allowance skips the approve call entirely
 *  - a failed create reports a friendly error and the retry does not
 *    re-approve (the first approval is already mined)
 *  - success decodes the ScheduleCreated record (id + tx hash) for the
 *    post-creation confirmation view (T030)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { encodeAbiParameters, encodeEventTopics } from 'viem';

const wagmi = vi.hoisted(() => ({
  writeContractAsync: vi.fn(),
  account: {
    address: '0x328809Bc894f92807417D2dAD6b7C998c1aFdac6' as string | undefined,
    chainId: undefined as number | undefined,
  },
  switchChainAsync: vi.fn(),
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getTransactionReceipt: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: wagmi.account.address, chainId: wagmi.account.chainId }),
  useSwitchChain: () => ({ switchChainAsync: wagmi.switchChainAsync, isPending: false }),
  usePublicClient: () => ({
    readContract: wagmi.readContract,
    waitForTransactionReceipt: wagmi.waitForTransactionReceipt,
    getTransactionReceipt: wagmi.getTransactionReceipt,
  }),
  useWriteContract: () => ({ writeContractAsync: wagmi.writeContractAsync }),
}));

import { useCreateSchedule, type CreateScheduleParams } from '../src/hooks/useCreateSchedule';
import { abiFor, activeChainId, contractAddress } from '../src/contracts';

const TOKEN = contractAddress(activeChainId, 'TestToken')! as `0x${string}`;
const FACTORY = contractAddress(activeChainId, 'VestingFactory')! as `0x${string}`;
const GRANTOR = wagmi.account.address!;
const BENEFICIARY = '0x1111111111111111111111111111111111111111';

const APPROVE_HASH = '0xa111111111111111111111111111111111111111111111111111111111111111';
const CREATE_HASH = '0xc333333333333333333333333333333333333333333333333333333333333333';

const PARAMS: CreateScheduleParams = {
  token: TOKEN,
  beneficiary: BENEFICIARY,
  start: 0,
  cliffMonths: 3,
  durationMonths: 6,
  amount: 100n * 10n ** 18n,
};

const callName = (index: number) =>
  (wagmi.writeContractAsync.mock.calls[index][0] as { functionName: string }).functionName;

beforeEach(() => {
  wagmi.writeContractAsync.mockReset();
  wagmi.readContract.mockReset();
  wagmi.waitForTransactionReceipt.mockReset();
  wagmi.account.address = GRANTOR;
  wagmi.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (functionName === 'allowance') return 0n;
    if (functionName === 'balanceOf') return 1_000n * 10n ** 18n;
    if (functionName === 'symbol') return 'TEST';
    return 0n;
  });
  wagmi.waitForTransactionReceipt.mockResolvedValue({ logs: [] });
});

describe('useCreateSchedule', () => {
  it('checks the allowance for (connected grantor → factory) against the generated ABI', async () => {
    wagmi.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === 'allowance' ? PARAMS.amount : 0n,
    );
    wagmi.writeContractAsync.mockResolvedValue(CREATE_HASH);
    const { result } = renderHook(() => useCreateSchedule());

    await act(async () => {
      await result.current.create(PARAMS);
    });

    expect(wagmi.readContract).toHaveBeenCalledWith({
      abi: abiFor('TestToken'),
      address: TOKEN,
      functionName: 'allowance',
      args: [GRANTOR, FACTORY],
    });
    expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(wagmi.writeContractAsync.mock.calls[0][0]).toMatchObject({
      functionName: 'createSchedule',
      args: [PARAMS.token, PARAMS.beneficiary, 0n, 3n, 6n, PARAMS.amount],
      address: FACTORY,
    });
    expect(result.current.state.status).toBe('confirmed');
    expect(result.current.created).toMatchObject({ hash: CREATE_HASH });
  });

  it('approves first, awaits the approval receipt, then creates (FR-019 sequencing)', async () => {
    wagmi.writeContractAsync.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === 'approve' ? APPROVE_HASH : CREATE_HASH,
    );
    const { result } = renderHook(() => useCreateSchedule());

    await act(async () => {
      await result.current.create(PARAMS);
    });

    expect([callName(0), callName(1)]).toEqual(['approve', 'createSchedule']);
    expect(wagmi.writeContractAsync.mock.calls[0][0]).toMatchObject({
      functionName: 'approve',
      address: TOKEN,
      args: [FACTORY, PARAMS.amount],
    });
    // The approval receipt is awaited before create is submitted.
    expect(wagmi.waitForTransactionReceipt).toHaveBeenNthCalledWith(1, { hash: APPROVE_HASH });
    expect(result.current.state.status).toBe('confirmed');
  });

  it('reports a failed create friendly and the retry does NOT re-approve (FR-017, Clar. 3)', async () => {
    let createAttempts = 0;
    wagmi.writeContractAsync.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'approve') return APPROVE_HASH;
      createAttempts += 1;
      if (createAttempts === 1) throw new Error('user rejected the request');
      return CREATE_HASH;
    });
    const { result } = renderHook(() => useCreateSchedule());

    await act(async () => {
      await result.current.create(PARAMS);
    });

    expect(result.current.state.status).toBe('failed');
    expect(result.current.state.error).toBe(
      'You rejected the request in your wallet — nothing was sent.',
    );
    expect(result.current.created).toBeNull();

    // The approval from attempt 1 is now mined → allowance covers the amount.
    wagmi.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === 'allowance' ? PARAMS.amount : 0n,
    );
    await act(async () => {
      await result.current.create(PARAMS);
    });

    const names = wagmi.writeContractAsync.mock.calls.map(
      (call) => (call[0] as { functionName: string }).functionName,
    );
    expect(names).toEqual(['approve', 'createSchedule', 'createSchedule']);
    expect(result.current.state.status).toBe('confirmed');
    expect(result.current.created).toMatchObject({ hash: CREATE_HASH });
  });

  it('decodes ScheduleCreated into the creation record (id + tx hash) for T030', async () => {
    wagmi.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === 'allowance' ? PARAMS.amount : 0n,
    );
    wagmi.writeContractAsync.mockResolvedValue(CREATE_HASH);
    const topics = encodeEventTopics({
      abi: abiFor('VestingFactory'),
      eventName: 'ScheduleCreated',
      args: { id: 7n, grantor: GRANTOR as `0x${string}`, beneficiary: PARAMS.beneficiary },
    });
    const data = encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [TOKEN, 0n, 7_776_000n, 15_552_000n, PARAMS.amount],
    );
    wagmi.waitForTransactionReceipt.mockResolvedValue({
      logs: [{ address: FACTORY, data, topics }],
    });
    const { result } = renderHook(() => useCreateSchedule());

    await act(async () => {
      await result.current.create(PARAMS);
    });

    expect(result.current.created).toEqual({
      id: 7n,
      hash: CREATE_HASH,
      params: PARAMS,
    });
    expect(result.current.state.status).toBe('confirmed');
  });

  it('fails friendly without a connected wallet and never prompts', async () => {
    wagmi.account.address = undefined;
    const { result } = renderHook(() => useCreateSchedule());

    await act(async () => {
      await result.current.create(PARAMS);
    });

    expect(result.current.state.status).toBe('failed');
    expect(result.current.state.error).toBe('Connect a wallet to create a schedule.');
    expect(wagmi.writeContractAsync).not.toHaveBeenCalled();
  });
});
