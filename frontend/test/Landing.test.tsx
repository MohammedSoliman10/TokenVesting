/**
 * T057 — public landing page + deployment-missing notice — tests FIRST.
 *
 * Rules under test:
 *  - the landing renders fully with NO wallet connected: hero h1, uppercase
 *    pill label, exactly three "how it works" steps (lock tokens / cliff then
 *    90-day unlocks / claim what has vested), the "Create a schedule" link to
 *    /create, the "View dashboard" link to /dashboard and the GitHub footer
 *    link — never a role="alert"
 *  - when `isDeployed(activeChainId)` is false, EVERY route shows the notice
 *    "Contracts are not deployed on <network> yet" and the write buttons
 *    (faucet, create-schedule submit) are disabled; when deployed, no notice
 *  - the deployed-contracts card lists both addresses: on 11155111 each is a
 *    link to https://sepolia.etherscan.io/address/<address>, on 31337 they
 *    are plain text
 *  - /create and /dashboard are React.lazy: a Loading fallback (role=status)
 *    first, then the page itself after the import resolves
 *
 * `../src/contracts` is mocked (deployment flag, addresses, active chain);
 * wagmi and RainbowKit are mocked at the App level — no live chain.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const dep = vi.hoisted(() => ({
  chainId: 31337 as number,
  deployed: true as boolean,
  addresses: {
    31337: {
      VestingFactory: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      TestToken: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    },
    11155111: {
      VestingFactory: '0x2222222222222222222222222222222222222222',
      TestToken: '0x3333333333333333333333333333333333333333',
    },
  } as Record<number, { VestingFactory: string; TestToken: string }>,
}));

const wallet = vi.hoisted(() => ({
  address: undefined as string | undefined,
  chainId: undefined as number | undefined,
}));

const wagmi = vi.hoisted(() => ({
  useAccount: vi.fn(),
  useConnect: vi.fn(),
  usePublicClient: vi.fn(),
  useWriteContract: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
  useSwitchChain: vi.fn(),
  useReadContract: vi.fn(),
  useBlockNumber: vi.fn(),
}));
vi.mock('wagmi', () => wagmi);

vi.mock('@rainbow-me/rainbowkit', () => ({
  ConnectButton: () => <button type="button">Connect wallet</button>,
  RainbowKitProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  lightTheme: () => ({}),
}));

vi.mock('../src/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/contracts')>();
  return {
    ...actual,
    // Mutable per-test: the Sepolia link test flips it to 11155111.
    get activeChainId() {
      return dep.chainId;
    },
    isDeployed: () => dep.deployed,
    addressesFor: (id: number | string) => dep.addresses[Number(id)] ?? {},
    contractAddress: (id: number | string, name: 'VestingFactory' | 'TestToken') =>
      dep.addresses[Number(id)]?.[name],
    activeAddresses: () => dep.addresses[dep.chainId] ?? {},
  };
});

import App from '../src/App';

const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const FACTORY_31337 = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const TOKEN_31337 = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const FACTORY_11155111 = '0x2222222222222222222222222222222222222222';
const TOKEN_11155111 = '0x3333333333333333333333333333333333333333';

function renderApp(route: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  dep.chainId = 31337;
  dep.deployed = true;
  wallet.address = undefined;
  wallet.chainId = 31337;

  wagmi.useAccount.mockImplementation(() => ({
    address: wallet.address,
    chainId: wallet.chainId,
  }));
  wagmi.useConnect.mockReturnValue({ connectors: [{}] });
  wagmi.useBlockNumber.mockReturnValue({ data: undefined });
  wagmi.useSwitchChain.mockReturnValue({ switchChainAsync: vi.fn(), isPending: false });
  wagmi.useReadContract.mockReturnValue({ data: undefined, refetch: vi.fn(), error: undefined });
  wagmi.useWriteContract.mockReturnValue({
    writeContract: vi.fn(),
    writeContractAsync: vi.fn(),
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
  wagmi.usePublicClient.mockReturnValue({
    chain: undefined,
    readContract: vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === 'balanceOf') return 1000n * 10n ** 18n;
        if (functionName === 'symbol') return 'TEST';
        throw new Error(`unexpected read: ${functionName}`);
      },
    ),
    getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_100_000n }),
    multicall: vi.fn(),
    getTransactionReceipt: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  });
});

describe('Landing public content (no wallet connected)', () => {
  it('renders the hero h1 and an uppercase pill label', () => {
    const { container } = renderApp('/');

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(container.querySelector('.label')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows exactly three "how it works" steps in order', () => {
    renderApp('/');

    const how = screen.getByRole('heading', { name: 'How it works' });
    const section = how.closest('section');
    expect(section).not.toBeNull();
    const steps = within(section as HTMLElement).getAllByRole('listitem');

    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent(/lock tokens/i);
    expect(steps[1]).toHaveTextContent(/cliff/i);
    expect(steps[1]).toHaveTextContent(/90-day/i);
    expect(steps[2]).toHaveTextContent(/claim what has vested/i);
  });

  it('links "Create a schedule" to /create and "View dashboard" to /dashboard', () => {
    renderApp('/');

    expect(screen.getByRole('link', { name: 'Create a schedule' })).toHaveAttribute(
      'href',
      '/create',
    );
    expect(screen.getByRole('link', { name: 'View dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('links to the GitHub repository from the footer', () => {
    renderApp('/');

    const github = screen.getByRole('link', { name: /github/i });
    expect(github).toHaveAttribute('href', 'https://github.com/MohammedSoliman10/TokenVesting');
  });

  it('needs no wallet and shows no alert', () => {
    renderApp('/');

    expect(wallet.address).toBeUndefined();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});

// NOTE: declared BEFORE the route tests below on purpose — React.lazy caches
// a resolved chunk per file, so the FIRST render of each route must be the
// one that observes the fallback.
describe('Lazy routes', () => {
  it('/create shows the Loading fallback, then the page', async () => {
    renderApp('/create');

    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Create a vesting schedule' }),
    ).toBeInTheDocument();
  });

  it('/dashboard shows the Loading fallback, then the page', async () => {
    renderApp('/dashboard');

    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Your vesting schedules' }),
    ).toBeInTheDocument();
  });
});

describe('Deployment-missing notice', () => {
  beforeEach(() => {
    dep.deployed = false;
  });

  it.each(['/', '/create', '/dashboard'])(
    'shows "Contracts are not deployed on Anvil yet" on %s',
    async (route) => {
      renderApp(route);

      expect(
        await screen.findByText('Contracts are not deployed on Anvil yet'),
      ).toBeInTheDocument();
    },
  );

  it('disables the faucet and the create-schedule submit while not deployed', async () => {
    wallet.address = WALLET;
    renderApp('/create');

    const submit = await screen.findByRole('button', { name: 'Create schedule' });
    expect(submit).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Get test tokens' })).toBeDisabled();

    // flush the balance read so it never settles after the test
    await waitFor(() => expect(screen.getByText(/Balance: 1000/)).toBeInTheDocument());
  });

  it('shows no notice and keeps the write buttons enabled when deployed', async () => {
    dep.deployed = true; // this describe's beforeEach forces false — control says true
    wallet.address = WALLET;
    renderApp('/create');

    expect(screen.queryByText(/Contracts are not deployed/)).not.toBeInTheDocument();
    const submit = await screen.findByRole('button', { name: 'Create schedule' });
    expect(submit).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Get test tokens' })).toBeEnabled();

    await waitFor(() => expect(screen.getByText(/Balance: 1000/)).toBeInTheDocument());
  });

  it('shows no notice on the landing page when deployed', () => {
    dep.deployed = true; // control: deployed → no notice
    renderApp('/');

    expect(screen.queryByText(/Contracts are not deployed/)).not.toBeInTheDocument();
  });
});

describe('Deployed contracts card', () => {
  it('lists both addresses as plain text on chain 31337', () => {
    renderApp('/');

    expect(screen.getByText('Deployed contracts')).toBeInTheDocument();
    expect(screen.getByText(FACTORY_31337)).toBeInTheDocument();
    expect(screen.getByText(TOKEN_31337)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: FACTORY_31337 })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: TOKEN_31337 })).not.toBeInTheDocument();
  });

  it('links each address to Etherscan on chain 11155111', () => {
    dep.chainId = 11155111;
    renderApp('/');

    const factory = screen.getByRole('link', { name: FACTORY_11155111 });
    expect(factory).toHaveAttribute(
      'href',
      `https://sepolia.etherscan.io/address/${FACTORY_11155111}`,
    );
    const token = screen.getByRole('link', { name: TOKEN_11155111 });
    expect(token).toHaveAttribute(
      'href',
      `https://sepolia.etherscan.io/address/${TOKEN_11155111}`,
    );
  });
});
