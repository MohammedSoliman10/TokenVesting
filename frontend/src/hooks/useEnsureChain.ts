/**
 * T050 — wrong-network guard shared by every write path (FR-015).
 *
 * The app writes to `activeChainId` (the deployment target). When the wallet
 * sits on another chain:
 *  - `isWrongChain` drives a visible "Switch network" prompt (no silent
 *    failures — the user is always told why a write is blocked)
 *  - `ensureChain()` is awaited by every write BEFORE it signs anything:
 *    it resolves `true` when writes may proceed (already on the target, or
 *    the switch SUCCEEDED) and `false` when the switch was rejected/failed —
 *    in that case the write never goes out.
 */
import { useCallback, useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { anvil, sepolia } from 'wagmi/chains';
import { activeChainId } from '../contracts';

/** Display names for the two chains the app supports. */
const CHAIN_NAMES: Record<number, string> = {
  [anvil.id]: anvil.name,
  [sepolia.id]: sepolia.name,
};

/** Human name of a chain id ("Anvil", "Sepolia"), with a sane fallback. */
export function chainNameOf(chainId: number): string {
  return CHAIN_NAMES[chainId] ?? `chain ${chainId}`;
}

export interface UseEnsureChainResult {
  /** The wallet is on a different chain than the app targets. */
  isWrongChain: boolean;
  /** Chain every write must go to. */
  targetChainId: number;
  /** Display name of the target chain (prompt copy). */
  targetChainName: string;
  /** A switch is in flight (prompt button busy state). */
  switching: boolean;
  /**
   * Call before EVERY write. Resolves `true` when the write may proceed —
   * on the right chain already, or after a successful `switchChain`.
   * Resolves `false` when the switch was rejected or failed (write blocked).
   */
  ensureChain: () => Promise<boolean>;
}

export function useEnsureChain(): UseEnsureChainResult {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [switching, setSwitching] = useState(false);

  const isWrongChain = chainId !== undefined && chainId !== activeChainId;

  const ensureChain = useCallback(async (): Promise<boolean> => {
    if (chainId === undefined || chainId === activeChainId) return true;
    setSwitching(true);
    try {
      await switchChainAsync({ chainId: activeChainId });
      return true; // switch succeeded → the caller's write may proceed
    } catch {
      return false; // rejected/failed → blocked; the prompt stays visible
    } finally {
      setSwitching(false);
    }
  }, [chainId, switchChainAsync]);

  return {
    isWrongChain,
    targetChainId: activeChainId,
    targetChainName: chainNameOf(activeChainId),
    switching,
    ensureChain,
  };
}
