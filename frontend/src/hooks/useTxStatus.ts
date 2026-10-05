/**
 * Transaction state machine (data-model `TxState`; tasks T016, T047, T054).
 *
 *   idle → pending (submitted) → confirmed | failed
 *
 * Terminal states (confirmed/failed) stay visible until `acknowledge()` is
 * called — a status that disappears on its own is a spec violation (FR-022).
 *
 * T054: every submitted hash is persisted (best-effort, storage guarded) and
 * re-checked with `getTransactionReceipt` on the next mount, so a page
 * refresh recovers the status: success → confirmed, reverted → failed,
 * not found yet → still pending. `acknowledge()` removes the persisted entry.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { clearPendingTx, loadPendingTx, savePendingTx } from '../lib/pendingTx';
import { friendlyErrorMessage } from '../lib/errors';

export type TxType = 'approve' | 'create' | 'claim' | 'faucet';
export type TxStatusName = 'idle' | 'pending' | 'confirmed' | 'failed';

export interface TxState {
  type: TxType;
  status: TxStatusName;
  hash?: `0x${string}`;
  /** Friendly, user-facing message (never raw revert data). */
  error?: string;
}

/** Receipt says the tx was mined but reverted on-chain. */
const ON_CHAIN_REVERTED_MESSAGE =
  'This transaction failed on-chain — nothing changed. Please try again.';

function idleState(type: TxType): TxState {
  return { type, status: 'idle' };
}

export interface UseTxStatusResult {
  /** Current transaction state. */
  state: TxState;
  /** Wallet signed and the transaction was submitted → `pending`. */
  onSubmitted: (type: TxType, hash?: `0x${string}`) => void;
  /** Receipt found on-chain → `confirmed`. */
  onConfirmed: () => void;
  /** Rejected, reverted or RPC failure → `failed` with a friendly message. */
  onFailed: (error?: unknown) => void;
  /** Dismiss a terminal state → back to `idle` (chip stays until this). */
  acknowledge: () => void;
  /** Start over, optionally switching which transaction type is tracked. */
  reset: (type?: TxType) => void;
  /** Convenience flags for UI gating. */
  isPending: boolean;
  isTerminal: boolean;
}

export function useTxStatus(initialType: TxType = 'create'): UseTxStatusResult {
  // Read once on mount: a hash persisted before a reload (T054).
  const [restored] = useState(() => loadPendingTx());
  const publicClient = usePublicClient({ chainId: restored?.chainId });

  const [state, setState] = useState<TxState>(() =>
    restored ? { type: restored.type, status: 'pending', hash: restored.hash } : idleState(initialType),
  );

  // Recovery: re-check the persisted receipt once on mount.
  useEffect(() => {
    if (!restored || !restored.hash) return;
    if (!publicClient) return; // no client for that chain → stays pending
    let cancelled = false;
    void (async () => {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: restored.hash });
        if (cancelled || !receipt) return;
        if (receipt.status === 'success') {
          setState((prev) =>
            prev.hash === restored.hash
              ? { ...prev, status: 'confirmed', error: undefined }
              : prev,
          );
        } else if (receipt.status === 'reverted') {
          setState((prev) =>
            prev.hash === restored.hash
              ? { ...prev, status: 'failed', error: ON_CHAIN_REVERTED_MESSAGE }
              : prev,
          );
        }
      } catch {
        // not found yet (or an RPC hiccup) → the chip stays pending
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restored, publicClient]);

  const onSubmitted = useCallback(
    (type: TxType, hash?: `0x${string}`) => {
      setState(hash ? { type, status: 'pending', hash } : { type, status: 'pending' });
      if (hash) {
        // best-effort persistence — storage may be unavailable (T054)
        savePendingTx({ type, hash, chainId: publicClient?.chain?.id });
      }
    },
    [publicClient],
  );

  const onConfirmed = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'confirmed', error: undefined }));
  }, []);

  const onFailed = useCallback((error?: unknown) => {
    setState((prev) => ({
      ...prev,
      status: 'failed',
      error: friendlyErrorMessage(error),
    }));
  }, []);

  const acknowledge = useCallback(() => {
    // FR-022: dismissing the terminal chip also drops the persisted entry.
    clearPendingTx();
    setState((prev) => idleState(prev.type));
  }, []);

  const reset = useCallback((type?: TxType) => {
    clearPendingTx();
    setState((prev) => idleState(type ?? prev.type));
  }, []);

  return {
    state,
    onSubmitted,
    onConfirmed,
    onFailed,
    acknowledge,
    reset,
    isPending: state.status === 'pending',
    isTerminal: state.status === 'confirmed' || state.status === 'failed',
  };
}
