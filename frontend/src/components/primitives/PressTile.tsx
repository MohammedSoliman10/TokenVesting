import type { HTMLAttributes, ReactNode } from 'react';
import { cx, pressTileClass } from '../../lib/theme';

export interface PressTileProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Surface tone (theme.md): `paper` at rest, `canvas` for card-like tiles. */
  tone?: 'paper' | 'canvas' | 'coral';
}

const toneClass: Record<NonNullable<PressTileProps['tone']>, string> = {
  paper: 'bg-paper',
  canvas: 'bg-canvas',
  coral: 'bg-coral',
};

/**
 * The core "press tile" primitive (docs/design/theme.md): 2px ink outline,
 * 12px radius, hard ink shadow — rest 4px, hover 6px + soft background,
 * press 0 with a downward translate + coral background, ~100ms transitions.
 *
 * The behaviour lives in `.press-tile` (`index.css`) so hover/press are real
 * pseudo-states, not JS-driven styles.
 */
export function PressTile({ tone = 'paper', className, children, ...rest }: PressTileProps) {
  return (
    <div className={cx(pressTileClass, toneClass[tone], className)} {...rest}>
      {children}
    </div>
  );
}
