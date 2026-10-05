/**
 * T040 — schedules read hook (US2, research R5, FR-016/FR-023).
 *
 * Read path (no event indexer, per spec): `getSchedulesByBeneficiary` → ids →
 * `getSchedule(id)` for every id batched into ONE viem multicall, then token
 * `symbol`/`decimals` in a second multicall once per distinct token — a
 * 50-schedule dashboard costs ~3 round trips, never N+1.
 *
 * TanStack Query caches under `['schedules', chainId, address]` (keyed by
 * chain/address) and every new block triggers one `refetch`, so the dashboard
 * tracks the chain without polling. The view clock is the latest BLOCK
 * timestamp (`getBlock`), never `Date.now()` — vesting math must agree with
 * consensus time, not the browser clock.
 *
 * Multicall3: chains that declare it (Sepolia) use the canonical contract;
 * local anvil declares none and ships no code, so there we use viem's
 * deployless multicall (bytecode carried in the call itself).
 *
 * States: loading while in flight, error + retry on failure, empty when the
 * wallet has no schedules, and no RPC at all without a connected wallet.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Abi, PublicClient } from 'viem';
import { useAccount, useBlockNumber, usePublicClient } from 'wagmi';
import { abiFor, activeChainId, contractAddress } from '../contracts';

export interface ScheduleRecord {
  id: bigint;
  token: `0x${string}`;
  grantor: `0x${string}`;
  beneficiary: `0x${string}`;
  start: bigint;
  cliffDuration: bigint;
  duration: bigint;
  totalAmount: bigint;
  released: bigint;
  tokenSymbol: string;
  tokenDecimals: number;
}

export interface SchedulesData {
  schedules: ScheduleRecord[];
  /** Latest block timestamp (seconds) — never Date.now(). */
  now: bigint;
}

export interface UseSchedulesResult {
  data: SchedulesData | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/** One entry of a multicall batch. */
interface BatchCall {
  abi: Abi;
  address: `0x${string}`;
  functionName: string;
  args: readonly unknown[];
}

/** Decoded `getSchedule(id)` tuple (unnamed output, named components). */
interface RawSchedule {
  token: `0x${string}`;
  grantor: `0x${string}`;
  beneficiary: `0x${string}`;
  start: bigint;
  cliffDuration: bigint;
  duration: bigint;
  totalAmount: bigint;
  released: bigint;
}

/**
 * One multicall for every call in `contracts`. Uses the chain's Multicall3
 * when it declares one, otherwise the deployless variant (local anvil has no
 * Multicall3 code at the canonical address).
 */
async function batch<T>(
  client: PublicClient,
  contracts: BatchCall[],
): Promise<T[]> {
  const hasMulticall3 = Boolean(client.chain?.contracts?.multicall3?.address);
  const results = await client.multicall({
    contracts,
    allowFailure: false,
    ...(hasMulticall3 ? {} : { deployless: true }),
  });
  return results as T[];
}

export function useSchedules(): UseSchedulesResult {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const factoryAddress = contractAddress(activeChainId, 'VestingFactory');

  const { data, isLoading, error, refetch: refetchQuery } = useQuery<
    SchedulesData
  >({
    queryKey: ['schedules', chainId, address],
    enabled: Boolean(address),
    queryFn: async () => {
      if (!address) throw new Error('Connect a wallet to view your schedules.');
      if (!publicClient) {
        throw new Error('No network connection — check your wallet.');
      }
      if (!factoryAddress) {
        throw new Error('Contracts are not deployed on this network.');
      }
      const factory = factoryAddress as `0x${string}`;

      // ids and the latest block timestamp in parallel — the timestamp is the
      // view clock for all vesting math downstream (never Date.now()).
      const [ids, block] = await Promise.all([
        publicClient.readContract({
          abi: abiFor('VestingFactory'),
          address: factory,
          functionName: 'getSchedulesByBeneficiary',
          args: [address],
        }) as Promise<bigint[]>,
        publicClient.getBlock({ blockTag: 'latest' }),
      ]);
      const now = block.timestamp;

      if (ids.length === 0) return { schedules: [], now };

      // every getSchedule in ONE multicall (no per-id round trips)
      const rows = await batch<RawSchedule>(
        publicClient,
        ids.map((id) => ({
          abi: abiFor('VestingFactory'),
          address: factory,
          functionName: 'getSchedule',
          args: [id],
        })),
      );

      // token metadata once per distinct token, one more multicall
      const tokens = [...new Set(rows.map((row) => row.token.toLowerCase()))];
      const metaResults = await batch<unknown>(
        publicClient,
        tokens.flatMap((token) => [
          {
            abi: abiFor('TestToken'),
            address: token as `0x${string}`,
            functionName: 'symbol',
            args: [],
          },
          {
            abi: abiFor('TestToken'),
            address: token as `0x${string}`,
            functionName: 'decimals',
            args: [],
          },
        ]),
      );
      const tokenMeta = new Map<string, { symbol: string; decimals: number }>();
      tokens.forEach((token, index) => {
        tokenMeta.set(token, {
          symbol: String(metaResults[index * 2]),
          decimals: Number(metaResults[index * 2 + 1]),
        });
      });

      const schedules: ScheduleRecord[] = rows.map((row, index) => {
        const meta = tokenMeta.get(row.token.toLowerCase());
        return {
          id: ids[index],
          ...row,
          tokenSymbol: meta ? meta.symbol : 'TOKEN',
          tokenDecimals: meta ? meta.decimals : 18,
        };
      });

      return { schedules, now };
    },
  });

  // Block refetch: the key stays [chain, address] (TanStack caching per
  // wallet); the first observed block only marks the clock — the initial
  // query is already in flight — and every later block triggers one refetch.
  const syncedBlock = useRef<bigint | undefined>(undefined);
  useEffect(() => {
    if (blockNumber === undefined || !address) return;
    if (syncedBlock.current === undefined || syncedBlock.current === blockNumber) {
      syncedBlock.current = blockNumber;
      return;
    }
    syncedBlock.current = blockNumber;
    void refetchQuery();
  }, [blockNumber, address, refetchQuery]);

  return {
    data,
    isLoading,
    error,
    refetch: async () => {
      await refetchQuery();
    },
  };
}
