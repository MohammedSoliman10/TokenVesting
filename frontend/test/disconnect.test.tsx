/**
 * T053 — disconnect / reconnect lifecycle — tests FIRST (strict TDD).
 * wagmi and RainbowKit are mocked at the App level: no live chain.
 *
 * Rules under test:
 *  - disconnect returns the app to its public state: the header shows no
 *    address, the Dashboard shows the connect prompt, and the cached
 *    schedule queries for that wallet are CLEARED (no stale data for a
 *    wallet that is no longer connected)
 *  - reconnecting restores the wallet's schedules (fresh fetch into cache)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => {
  let listeners: Array<() => void> = [];
  const state = {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as string | undefined,
    chainId: 31337 as number | undefined,
    connectors: [{}] as unknown[],
    blockNumber: 1n as bigint | undefined,
  };
  const m = {
    state,
    readContract: vi.fn(),
    multicall: vi.fn(),
    getBlock: vi.fn(),
    getTransactionReceipt: vi.fn(),
    switchChainAsync: vi.fn(),
    writeContract: vi.fn(),
    writeContractAsync: vi.fn(),
    disconnect: vi.fn(),
    releasable: 0n as bigint | undefined,
    /** React-driven snapshot for `useAccount().address`. */
    subscribe(cb: () => void) {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    addressSnapshot: () => state.address as string | undefined,
    setAddress(next: string | undefined) {
      state.address = next;
      listeners.forEach((l) => l());
    },
  };
  m.disconnect.mockImplementation(() => m.setAddress(undefined));
  return m;
});

vi.mock('wagmi', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useAccount: () => ({
      address: useSyncExternalStore(mocks.subscribe, mocks.addressSnapshot),
      chainId: mocks.state.chainId,
    }),
    useDisconnect: () => ({ disconnect: mocks.disconnect }),
    useConnect: () => ({ connectors: mocks.state.connectors }),
    useBlockNumber: () => ({ data: mocks.state.blockNumber }),
    useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync, isPending: false }),
    usePublicClient: () => ({
      chain: undefined,
      readContract: mocks.readContract,
      multicall: mocks.multicall,
      getBlock: mocks.getBlock,
      getTransactionReceipt: mocks.getTransactionReceipt,
      waitForTransactionReceipt: vi.fn(),
    }),
    useWriteContract: () => ({
      writeContract: mocks.writeContract,
      writeContractAsync: mocks.writeContractAsync,
      data: undefined,
      isPending: false,
      error: undefined,
      reset: vi.fn(),
    }),
    useWaitForTransactionReceipt: () => ({ data: undefined, isLoading: false, error: undefined }),
    useReadContract: () => ({ data: mocks.releasable, refetch: vi.fn(), error: undefined }),
  };
});

vi.mock('@rainbow-me/rainbowkit', async () => {
  const { useAccount, useDisconnect } = await import('wagmi');
  return {
    ConnectButton: () => {
      const { address } = useAccount();
      const { disconnect } = useDisconnect();
      return address ? (
        <span>
          <span data-testid="header-address">{address}</span>
          <button type="button" onClick={() => disconnect()}>
            Disconnect
          </button>
        </span>
      ) : (
        <button type="button">Connect wallet</button>
      );
    },
    RainbowKitProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    lightTheme: () => ({}),
  };
});

import App from '../src/App';
import { activeChainId, contractAddress } from '../src/contracts';

const E18 = 10n ** 18n;
const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TOKEN = contractAddress(activeChainId, 'TestToken')! as `0x${string}`;
const BLOCK_TS = 1_700_100_000n;
const scheduleKey = ['schedules', activeChainId, WALLET] as const;

let client: QueryClient;

function renderApp() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.state.address = WALLET;
  mocks.state.chainId = activeChainId;
  mocks.state.connectors = [{}];
  mocks.state.blockNumber = 1n;
  mocks.disconnect.mockClear();
  mocks.readContract.mockReset();
  mocks.multicall.mockReset();
  mocks.getBlock.mockReset();
  localStorage.clear();

  mocks.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === 'getSchedulesByBeneficiary') return [7n];
      throw new Error(`unexpected read: ${functionName}`);
    },
  );
  mocks.getBlock.mockResolvedValue({ timestamp: BLOCK_TS });
  mocks.multicall.mockImplementation(
    async ({ contracts }: { contracts: readonly { functionName: string }[] }) =>
      contracts.map((call) => {
        if (call.functionName === 'getSchedule') {
          return {
            token: TOKEN,
            grantor: WALLET,
            beneficiary: WALLET,
            start: 1_700_000_000n,
            cliffDuration: 7_776_000n,
            duration: 15_552_000n,
            totalAmount: 900n * E18,
            released: 0n,
          };
        }
        if (call.functionName === 'symbol') return 'TEST';
        if (call.functionName === 'decimals') return 18;
        throw new Error(`unexpected multicall: ${call.functionName}`);
      }),
  );
});

describe('T053 — disconnect', () => {
  it('disconnect returns the app to its public state and clears cached schedules', async () => {
    renderApp();

    // connected: the wallet shows in the header and schedules land in the cache
    await waitFor(() =>
      expect(client.getQueryData(scheduleKey)).toBeTruthy(),
    );
    expect(screen.getByTestId('header-address')).toHaveTextContent(WALLET);
    expect(screen.queryByText('Connect your wallet')).not.toBeInTheDocument();

    // disconnect
    act(() => {
      mocks.disconnect();
    });

    // header: no address
    await waitFor(() =>
      expect(screen.queryByTestId('header-address')).not.toBeInTheDocument(),
    );
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);

    // dashboard: the connect prompt (public state), not an error or blank
    expect(screen.getByText('Connect your wallet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // cached schedules for that wallet are cleared — no stale wallet data
    expect(client.getQueryData(scheduleKey)).toBeUndefined();
  });

  it('reconnecting restores the wallet\'s schedules', async () => {
    renderApp();
    await waitFor(() => expect(client.getQueryData(scheduleKey)).toBeTruthy());

    // disconnect → cache cleared
    act(() => {
      mocks.disconnect();
    });
    await waitFor(() => expect(client.getQueryData(scheduleKey)).toBeUndefined());

    // reconnect the same wallet
    act(() => {
      mocks.setAddress(WALLET);
    });

    await waitFor(() =>
      expect(screen.getByTestId('header-address')).toHaveTextContent(WALLET),
    );
    await waitFor(() => expect(client.getQueryData(scheduleKey)).toBeTruthy());
    expect(screen.queryByText('Connect your wallet')).not.toBeInTheDocument();
  });
});
