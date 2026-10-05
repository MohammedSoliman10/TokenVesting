import type { VestingState } from '../lib/vesting';

export interface VestingProgressProps {
  /** `vested / totalAmount` as a 0..1 ratio. */
  progress: number;
  /** Lifecycle of the schedule at the viewed chain time. */
  state: VestingState;
}

/** Plain-word lifecycle labels (spec US2 acceptance wording). */
const stateLabel: Record<VestingState, string> = {
  'not-started': 'Not started',
  cliff: 'Cliff',
  vesting: 'Vesting',
  'fully-vested': 'Fully vested',
};

/**
 * Vesting progress bar (T041, FR-020): an accessible progressbar filled to
 * `progress`, with the percentage and the lifecycle state in words. Pure —
 * the caller supplies the ratio derived from the chain timestamp.
 */
export function VestingProgress({ progress, state }: VestingProgressProps) {
  const ratio = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const percent = Math.round(ratio * 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">Progress</span>
        <span className="font-display text-sm font-bold">{percent}% vested</span>
      </div>
      <div
        role="progressbar"
        aria-label="Vesting progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-4 overflow-hidden rounded-tile border-2 border-ink bg-paper"
      >
        <div className="h-full bg-coral" style={{ width: `${percent}%` }} />
      </div>
      <p className="label">{stateLabel[state]}</p>
    </div>
  );
}
