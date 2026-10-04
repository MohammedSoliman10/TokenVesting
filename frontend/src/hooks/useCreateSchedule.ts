/**
 * T029 — approve → create funding flow hook (FR-019, data-model V7).
 *
 * Sequencing is imperative so the receipt of each step is awaited before the
 * next one starts: allowance pre-check → (approve → wait) → create → wait →
 * decode the `ScheduleCreated` record for the confirmation view (T030).
 *
 * Binding rules:
 *  - a sufficient existing allowance skips the approve call entirely
 *  - a failed create keeps state retryable: the first approval is already
 *    mined, so the retry's allowance pre-check skips re-approving
 *  - users only ever see friendly sentences (FR-017), never raw reverts
 */
import { useCallback, useState } from 'react';
import { decodeEventLog } from 'viem';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { abiFor, activeChainId, contractAddress } from '../contracts';
import { useTxStatus, type TxState } from './useTxStatus';

export interface CreateScheduleParams {
  token: string;
  beneficiary: string;
  /** Unix seconds; 0 = start now (clarification 1). */
  start: number;
  cliffMonths: number;
  durationMonths: number;
  /** Base units of the schedule token. */
  amount: bigint;
}

export interface CreatedSchedule {
  /** `ScheduleCreated.id`, or `null` when the receipt log cannot be decoded. */
  id: bigint | null;
  hash: `0x${string}`;
  params: CreateScheduleParams;
}

export interface UseCreateScheduleResult {
  create: (params: CreateScheduleParams) => Promise<void>;
  state: TxState;
  isCreating: boolean;
  created: CreatedSchedule | null;
  acknowledge: () => void;
  reset: () => void;
}

/**
 * Our own pre-flight failures carry `shortMessage` so `friendlyErrorMessage`
 * surfaces them verbatim (they are already friendly sentences).
 */
function preflightError(message: string): Error & { shortMessage: string } {
  return Object.assign(new Error(message), { shortMessage: message });
}

export function useCreateSchedule(): UseCreateScheduleResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const {
    state,
    onSubmitted,
    onConfirmed,
    onFailed,
    acknowledge,
    reset: resetTx,
    isPending,
  } = useTxStatus('create');
  const [created, setCreated] = useState<CreatedSchedule | null>(null);

  const create = useCallback(
    async (params: CreateScheduleParams) => {
      try {
        if (!address) throw preflightError('Connect a wallet to create a schedule.');
        if (!publicClient) throw preflightError('No network connection — check your wallet.');
        const tokenAddress = contractAddress(activeChainId, 'TestToken');
        const factoryAddress = contractAddress(activeChainId, 'VestingFactory');
        if (!tokenAddress || !factoryAddress) {
          throw preflightError('Contracts are not deployed on this network.');
        }

        setCreated(null);

        // V7 / FR-019 — approval first, but reuse a sufficient existing one.
        const allowance = (await publicClient.readContract({
          abi: abiFor('TestToken'),
          address: tokenAddress as `0x${string}`,
          functionName: 'allowance',
          args: [address, factoryAddress as `0x${string}`],
        })) as bigint;

        if (allowance < params.amount) {
          onSubmitted('approve');
          const approveHash = await writeContractAsync({
            abi: abiFor('TestToken'),
            address: tokenAddress as `0x${string}`,
            functionName: 'approve',
            args: [factoryAddress as `0x${string}`, params.amount],
          });
          onSubmitted('approve', approveHash);
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        onSubmitted('create');
        const createHash = await writeContractAsync({
          abi: abiFor('VestingFactory'),
          address: factoryAddress as `0x${string}`,
          functionName: 'createSchedule',
          args: [
            params.token,
            params.beneficiary,
            BigInt(params.start),
            BigInt(params.cliffMonths),
            BigInt(params.durationMonths),
            params.amount,
          ],
        });
        onSubmitted('create', createHash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

        // Creation record: the factory's ScheduleCreated event in the receipt.
        let id: bigint | null = null;
        const factoryLog = receipt.logs.find(
          (log) => log.address.toLowerCase() === factoryAddress.toLowerCase(),
        );
        if (factoryLog) {
          try {
            const decoded = decodeEventLog({
              abi: abiFor('VestingFactory'),
              eventName: 'ScheduleCreated',
              data: factoryLog.data,
              topics: factoryLog.topics,
            });
            id = (decoded.args as unknown as { id: bigint }).id;
          } catch {
            id = null; // the receipt is authoritative — a missing id must not fail the flow
          }
        }

        setCreated({ id, hash: createHash, params });
        onConfirmed();
      } catch (error) {
        onFailed(error);
      }
    },
    [address, publicClient, writeContractAsync, onSubmitted, onConfirmed, onFailed],
  );

  const reset = useCallback(() => {
    setCreated(null);
    resetTx();
  }, [resetTx]);

  return { create, state, isCreating: isPending, created, acknowledge, reset };
}
