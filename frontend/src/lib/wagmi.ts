/**
 * wagmi + RainbowKit configuration (task T013, research R12).
 *
 * Chains: Sepolia (11155111, public v1 deployment) and local anvil (31337).
 * `VITE_CHAIN_ID` selects which one comes first (i.e. the default chain);
 * everything degrades gracefully to defaults so the app builds and runs
 * with no `.env` at all.
 */
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { anvil, sepolia } from 'wagmi/chains';
import { activeChainId } from '../contracts';

export const SEPOLIA_ID = 11155111;
export const ANVIL_ID = 31337;

/** Chain the app targets (`VITE_CHAIN_ID`, clamped to Sepolia/anvil). */
export const targetChainId = activeChainId;

/** Optional override; unset/empty falls back to viem's public RPC for the chain. */
const rpcUrl = import.meta.env.VITE_RPC_URL || undefined;

/**
 * WalletConnect Cloud project id — a MANUAL step (frontend/.env.example).
 * The fallback only keeps the config buildable with no `.env`; pairing via
 * WalletConnect needs a real id. Injected wallets (MetaMask etc.) work without.
 */
export const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'token-vesting-local-dev';

type ConfigChain = typeof sepolia | typeof anvil;

/** Target chain first (it becomes the default), the other stays switchable. */
export const chains: readonly [ConfigChain, ...ConfigChain[]] =
  targetChainId === ANVIL_ID ? [anvil, sepolia] : [sepolia, anvil];

export const config = getDefaultConfig({
  appName: 'Token Vesting',
  projectId: walletConnectProjectId,
  chains,
  transports: {
    [SEPOLIA_ID]: http(rpcUrl),
    // Local development node (`anvil`, quickstart §local).
    [ANVIL_ID]: http('http://127.0.0.1:8545'),
  },
});
