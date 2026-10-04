/**
 * Transaction state machine (data-model `TxState`; tasks T016, T047, T054).
 *
 *   idle → pending (submitted) → confirmed | failed
 *
 * Terminal states (confirmed/failed) stay visible until `acknowledge()` is
 * called — a status that disappears on its own is a spec violation (FR-022).
 * Pending-recovery across page refreshes (persist the hash and re-derive the
 * status) is added in task T054.
 */
import { useCallback, useState } from 'react';
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
  const [state, setState] = useState<TxState>(() => idleState(initialType));

  const onSubmitted = useCallback((type: TxType, hash?: `0x${string}`) => {
    setState(hash ? { type, status: 'pending', hash } : { type, status: 'pending' });
  }, []);

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
    setState((prev) => idleState(prev.type));
  }, []);

  const reset = useCallback((type?: TxType) => {
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
