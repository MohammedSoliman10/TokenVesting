/**
 * T054 — pending-transaction persistence (FR-022 recovery across reloads).
 *
 * One submitted hash is stored in localStorage so a page refresh can re-check
 * its receipt (`getTransactionReceipt`) and re-derive confirmed/failed/pending
 * instead of losing the status.
 *
 * EVERY access is wrapped in try/catch: the app must keep working when
 * storage is unavailable (private mode, disabled cookies, quota errors) —
 * persistence is best-effort, the state machine is not.
 */
import type { TxType } from '../hooks/useTxStatus';

/** Storage key for the single tracked pending transaction. */
export const PENDING_TX_STORAGE_KEY = 'token-vesting:pending-tx';

export interface PendingTx {
  type: TxType;
  hash: `0x${string}`;
  /** Chain the tx was sent on — the receipt is re-checked there. */
  chainId?: number;
}

/** `localStorage` when it exists and works; `null` otherwise. */
function storage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    // Touch it: Safari private mode throws on access, not on reference.
    void candidate?.length;
    return candidate ?? null;
  } catch {
    return null;
  }
}

/** Load the persisted pending tx, or `null` (missing, broken, or unreadable). */
export function loadPendingTx(): PendingTx | null {
  try {
    const raw = storage()?.getItem(PENDING_TX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingTx> | null;
    if (!parsed || typeof parsed.hash !== 'string' || !parsed.hash.startsWith('0x')) {
      return null;
    }
    return {
      type: typeof parsed.type === 'string' ? (parsed.type as TxType) : 'create',
      hash: parsed.hash as `0x${string}`,
      chainId: typeof parsed.chainId === 'number' ? parsed.chainId : undefined,
    };
  } catch {
    return null; // corrupt JSON or unavailable storage — never throw
  }
}

/** Best-effort persist of the submitted hash. */
export function savePendingTx(entry: PendingTx): void {
  try {
    storage()?.setItem(PENDING_TX_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // storage unavailable — the app works without recovery
  }
}

/** Best-effort removal (called from acknowledge/reset). */
export function clearPendingTx(): void {
  try {
    storage()?.removeItem(PENDING_TX_STORAGE_KEY);
  } catch {
    // storage unavailable — nothing to clear
  }
}
