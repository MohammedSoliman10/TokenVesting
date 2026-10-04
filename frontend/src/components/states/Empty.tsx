import type { ReactNode } from 'react';
import { cx } from '../../lib/theme';

export interface EmptyProps {
  title: string;
  description?: string;
  /** Optional call to action rendered under the copy. */
  action?: ReactNode;
  className?: string;
}

/**
 * Empty state (T015): friendly explanation + optional action, styled as a
 * press tile so the screen reads as intentional instead of blank.
 */
export function Empty({ title, description, action, className }: EmptyProps) {
  return (
    <div className={cx('press-tile bg-paper p-8 text-center', className)}>
      <p className="font-display text-lg font-bold">{title}</p>
      {description ? <p className="mt-2 text-sm text-ink/70">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Alias for call sites that prefer the `EmptyState` name. */
export const EmptyState = Empty;
