import { cx } from '../../lib/theme';
import type { TxState } from '../../hooks/useTxStatus';

const typeLabel: Record<TxState['type'], string> = {
  approve: 'Approval',
  create: 'Create schedule',
  claim: 'Claim',
  faucet: 'Test tokens',
};

const statusLabel = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  failed: 'Failed',
} as const;

const statusClass = {
  pending: 'bg-soft',
  confirmed: 'bg-paper',
  failed: 'bg-coral',
} as const;

function StatusIcon({ status }: { status: keyof typeof statusLabel }) {
  if (status === 'pending') {
    return (
      <svg viewBox="0 0 12 12" className="h-3 w-3 animate-spin" aria-hidden="true">
        <circle
          cx="6"
          cy="6"
          r="4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="18 10"
        />
      </svg>
    );
  }

  if (status === 'confirmed') {
    return (
      <svg
        viewBox="0 0 12 12"
        className="h-3 w-3"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M2 6.5 4.8 9.2 10 3.5" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3 w-3"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

export interface TxStatusProps {
  state: TxState;
  className?: string;
}

/**
 * Transaction status chip (T015): pending / confirmed / failed. `idle`
 * renders nothing, and terminal states stay on screen until the caller calls
 * `useTxStatus().acknowledge()` (spec FR-022 — status must not vanish).
 */
export function TxStatus({ state, className }: TxStatusProps) {
  if (state.status === 'idle') return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className={cx(
        'inline-flex items-center gap-2 rounded-full border border-ink px-3 py-1 text-xs font-semibold uppercase tracking-wide',
        statusClass[state.status],
        className,
      )}
    >
      <StatusIcon status={state.status} />
      <span>
        {typeLabel[state.type]}: {statusLabel[state.status]}
      </span>
    </span>
  );
}
