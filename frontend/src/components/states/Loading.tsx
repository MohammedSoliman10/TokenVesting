import { cx } from '../../lib/theme';

export interface SkeletonProps {
  className?: string;
}

/** Single pulsing placeholder block (paper fill only — no gradients/blur). */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={cx('h-16 animate-pulse rounded-tile bg-paper', className)} />
  );
}

export interface LoadingProps {
  /** Number of skeleton rows to render. */
  rows?: number;
  /** Announced to screen readers while loading. */
  label?: string;
  className?: string;
}

/**
 * Loading state: a labelled skeleton list, so screens are never blank while
 * data is in flight (constitution / spec FR-023).
 */
export function Loading({ rows = 3, label = 'Loading', className }: LoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cx('space-y-3', className)}
    >
      {Array.from({ length: rows }, (_unused, index) => (
        <Skeleton key={index} className="w-full" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
