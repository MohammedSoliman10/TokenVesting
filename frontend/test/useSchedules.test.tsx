/**
 * T040 — schedules read hook (US2, research R5) — tests FIRST (strict TDD).
 * wagmi is mocked: no live chain, no wallet.
 *
 * Rules under test:
 *  - ids come from `getSchedulesByBeneficiary`, then every `getSchedule` is
 *    batched into ONE multicall (no per-id RPC round trip)
 *  - token symbol + decimals are fetched once per DISTINCT token
 *  - `now` is the latest block timestamp, never Date.now() (consensus time)
 *  - the query is keyed by chain + wallet address and refetched when a block
 *    arrives (TanStack Query, keyed caching)
 *  - loading / error-with-retry / empty / no-wallet states (FR-023)
 *  - reads work on a chain without a deployed Multicall3 (viem deployless —
 *    local anvil) and use the chain-declared Multicall3 when one exists
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const wagmi = vi.hoisted(() => ({
  account: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as string | undefined,
    chainId: 31337 as number | undefined,
  },
  blockNumber: 1n as bigint | undefined,
  chain: undefined as { contracts?: { multicall3?: { address: string } } } | undefined,
  scheduleIds: [] as bigint[],
  readContract: vi.fn(),
  multicall: vi.fn(),
  getBlock: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: wagmi.account.address, chainId: wagmi.account.chainId }),
  useBlockNumber: () => ({ data: wagmi.blockNumber }),
  usePublicClient: () => ({
    chain: wagmi.chain,
    readContract: wagmi.readContract,
    multicall: wagmi.multicall,
    getBlock: wagmi.getBlock,
  }),
}));

import { useSchedules } from '../src/hooks/useSchedules';
import { abiFor, activeChainId, contractAddress } from '../src/contracts';

const E18 = 10n ** 18n;
const BENEFICIARY = wagmi.account.address!;
const OTHER_WALLET = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const OTHER_CHAIN_ID = 11155111;
const GRANTOR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const FACTORY = contractAddress(activeChainId, 'VestingFactory')!;
const TOKEN = contractAddress(activeChainId, 'TestToken')! as `0x${string}`;
// A second, genuinely distinct token address (must NOT collide with TestToken
// at 0x5FbDB… — a collision makes the "two distinct tokens" fixture meaningless).
const TOKEN_2 = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as `0x${string}`;
/** Latest block timestamp the mock returns — far from wall-clock time. */
const BLOCK_TS = 1_760_000_000n;

interface MockCall {
  address: string;
  functionName: string;
  args?: readonly unknown[];
}

interface MulticallRequest {
  contracts: MockCall[];
  allowFailure?: boolean;
  deployless?: boolean;
}

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

const RAW: Record<string, RawSchedule> = {
  '7': {
    token: TOKEN,
    grantor: GRANTOR as `0x${string}`,
    beneficiary: BENEFICIARY as `0x${string}`,
    start: 1_700_000_000n,
    cliffDuration: 7_776_000n,
    duration: 15_552_000n,
    totalAmount: 900n * E18,
    released: 300n * E18,
  },
  '9': {
    token: TOKEN,
    grantor: GRANTOR as `0x${string}`,
    beneficiary: BENEFICIARY as `0x${string}`,
    start: 1_700_090_000n,
    cliffDuration: 7_776_000n,
    duration: 15_552_000n,
    totalAmount: 120n * E18,
    released: 0n,
  },
  '11': {
    token: TOKEN_2,
    grantor: GRANTOR as `0x${string}`,
    beneficiary: BENEFICIARY as `0x${string}`,
    start: 1_700_180_000n,
    cliffDuration: 7_776_000n,
    duration: 15_552_000n,
    totalAmount: 42n * E18,
    released: 42n * E18,
  },
};

const TOKEN_META: Record<string, { symbol: string; decimals: number }> = {
  [TOKEN.toLowerCase()]: { symbol: 'TEST', decimals: 18 },
  [TOKEN_2.toLowerCase()]: { symbol: 'OTHR', decimals: 6 },
};

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

/** Every multicall request the hook issued, in order. */
const multicallRequests = (): MulticallRequest[] =>
  wagmi.multicall.mock.calls.map((call) => call[0] as MulticallRequest);

/** Requests that batch `getSchedule` reads (as opposed to token metadata). */
const scheduleBatches = (): MulticallRequest[] =>
  multicallRequests().filter((r) => r.contracts[0]?.functionName === 'getSchedule');

/** Requests that batch token symbol/decimals reads. */
const metadataBatches = (): MulticallRequest[] =>
  multicallRequests().filter((r) => r.contracts[0]?.functionName === 'symbol');

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  wagmi.account.address = BENEFICIARY;
  wagmi.account.chainId = 31337;
  wagmi.blockNumber = 1n;
  wagmi.chain = undefined;
  wagmi.scheduleIds = [7n, 9n];
  wagmi.readContract.mockReset();
  wagmi.multicall.mockReset();
  wagmi.getBlock.mockReset();
  wagmi.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === 'getSchedulesByBeneficiary') return wagmi.scheduleIds;
      throw new Error(`unexpected read: ${functionName}`);
    },
  );
  wagmi.getBlock.mockResolvedValue({ timestamp: BLOCK_TS });
  wagmi.multicall.mockImplementation(
    async ({ contracts }: { contracts: readonly MockCall[] }) =>
      contracts.map((call) => {
        if (call.functionName === 'getSchedule') {
          return RAW[String((call.args as readonly bigint[])[0])];
        }
        const meta = TOKEN_META[call.address.toLowerCase()];
        if (call.functionName === 'symbol') return meta?.symbol;
        if (call.functionName === 'decimals') return meta?.decimals;
        throw new Error(`unexpected multicall: ${call.functionName}`);
      }),
  );
});

describe('useSchedules', () => {
  it('loading: reports loading while the schedule ids are in flight', async () => {
    wagmi.readContract.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useSchedules(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it('no wallet: makes no chain reads and does not spin a skeleton', async () => {
    wagmi.account.address = undefined;
    const { result } = renderHook(() => useSchedules(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(wagmi.readContract).not.toHaveBeenCalled();
    expect(wagmi.multicall).not.toHaveBeenCalled();
    expect(wagmi.getBlock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('reads the id list for the connected wallet, then ONE multicall decodes every schedule', async () => {
    const { result } = renderHook(() => useSchedules(), { wrapper });

    await waitFor(() => expect(result.current.data?.schedules).toHaveLength(2));

    // ids: a single read for the connected beneficiary — not per schedule
    expect(wagmi.readContract).toHaveBeenCalledTimes(1);
    expect(wagmi.readContract).toHaveBeenCalledWith({
      abi: abiFor('VestingFactory'),
      address: FACTORY,
      functionName: 'getSchedulesByBeneficiary',
      args: [BENEFICIARY],
    });

    // every getSchedule batched into exactly one multicall
    const batches = scheduleBatches();
    expect(batches).toHaveLength(1);
    expect(batches[0].contracts.map((c) => ({ f: c.functionName, a: c.args }))).toEqual([
      { f: 'getSchedule', a: [7n] },
      { f: 'getSchedule', a: [9n] },
    ]);
    expect(batches[0].contracts[0].address).toBe(FACTORY);
    // total: ids read + schedules batch + metadata batch (no N+1 anywhere)
    expect(wagmi.multicall).toHaveBeenCalledTimes(2);

    expect(result.current.data!.schedules[0]).toEqual({
      id: 7n,
      token: TOKEN,
      grantor: GRANTOR,
      beneficiary: BENEFICIARY,
      start: 1_700_000_000n,
      cliffDuration: 7_776_000n,
      duration: 15_552_000n,
      totalAmount: 900n * E18,
      released: 300n * E18,
      tokenSymbol: 'TEST',
      tokenDecimals: 18,
    });
    expect(result.current.data!.schedules[1]).toMatchObject({
      id: 9n,
      released: 0n,
      totalAmount: 120n * E18,
      tokenSymbol: 'TEST',
      tokenDecimals: 18,
    });
  });

  it('fetches token symbol and decimals once per distinct token (three schedules, two tokens)', async () => {
    wagmi.scheduleIds = [7n, 9n, 11n];
    const { result } = renderHook(() => useSchedules(), { wrapper });

    await waitFor(() => expect(result.current.data?.schedules).toHaveLength(3));

    const batches = metadataBatches();
    expect(batches).toHaveLength(1);
    expect(
      batches[0].contracts.map((c) => `${c.functionName}:${c.address.toLowerCase()}`),
    ).toEqual([
      `symbol:${TOKEN.toLowerCase()}`,
      `decimals:${TOKEN.toLowerCase()}`,
      `symbol:${TOKEN_2.toLowerCase()}`,
      `decimals:${TOKEN_2.toLowerCase()}`,
    ]);

    expect(
      result.current.data!.schedules.map((s) => [s.tokenSymbol, s.tokenDecimals]),
    ).toEqual([
      ['TEST', 18],
      ['TEST', 18],
      ['OTHR', 6],
    ]);
  });

  it('now: the view timestamp is the latest block timestamp, never Date.now()', async () => {
    const { result } = renderHook(() => useSchedules(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(wagmi.getBlock).toHaveBeenCalledWith({ blockTag: 'latest' });
    expect(result.current.data!.now).toBe(BLOCK_TS);
    expect(result.current.data!.now).not.toBe(BigInt(Math.floor(Date.now() / 1000)));
  });

  it('refetches when a new block arrives, without flashing the loading skeleton', async () => {
    const { result, rerender } = renderHook(() => useSchedules(), { wrapper });

    await waitFor(() => expect(result.current.data?.schedules).toHaveLength(2));
    expect(wagmi.readContract).toHaveBeenCalledTimes(1);

    wagmi.blockNumber = 2n;
    rerender();

    await waitFor(() => expect(wagmi.readContract).toHaveBeenCalledTimes(2));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.schedules).toHaveLength(2);
  });

  it('keyed by wallet address: switching accounts refetches for the new wallet', async () => {
    const { rerender } = renderHook(() => useSchedules(), { wrapper });

    await waitFor(() => expect(wagmi.readContract).toHaveBeenCalledTimes(1));

    wagmi.account.address = OTHER_WALLET;
    rerender();

    await waitFor(() => expect(wagmi.readContract).toHaveBeenCalledTimes(2));
    const lastCall = wagmi.readContract.mock.calls.at(-1)![0] as {
      args: readonly string[];
    };
    expect(lastCall.args).toEqual([OTHER_WALLET]);
  });

  it('keyed by chain: switching the wallet network refetches', async () => {
    const { rerender } = renderHook(() => useSchedules(), { wrapper });

    await waitFor(() => expect(wagmi.readContract).toHaveBeenCalledTimes(1));

    wagmi.account.chainId = OTHER_CHAIN_ID;
    rerender();

    await waitFor(() => expect(wagmi.readContract).toHaveBeenCalledTimes(2));
  });

  it('error: surfaces the failure and the retry recovers (FR-023)', async () => {
    wagmi.readContract.mockRejectedValueOnce(new Error('rpc down'));
    const { result } = renderHook(() => useSchedules(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.data?.schedules).toHaveLength(2));
    expect(result.current.error).toBeNull();
  });

  it('empty: a wallet with no schedules gets an empty result and no multicall', async () => {
    wagmi.scheduleIds = [];
    const { result } = renderHook(() => useSchedules(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toEqual({ schedules: [], now: BLOCK_TS });
    expect(wagmi.multicall).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('local anvil (no Multicall3): batches deploylessly so reads work without the contract', async () => {
    // the viem `anvil` chain declares no multicall3 and anvil ships no code
    const { result } = renderHook(() => useSchedules(), { wrapper });

    await waitFor(() => expect(result.current.data?.schedules).toHaveLength(2));

    const requests = multicallRequests();
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.deployless).toBe(true);
    }
  });

  it('Sepolia (Multicall3 declared): batches through the chain-declared contract', async () => {
    wagmi.chain = {
      contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
    };
    const { result } = renderHook(() => useSchedules(), { wrapper });

    await waitFor(() => expect(result.current.data?.schedules).toHaveLength(2));

    for (const request of multicallRequests()) {
      expect(request.deployless).toBeFalsy();
    }
  });
});
