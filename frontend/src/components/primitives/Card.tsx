import type { HTMLAttributes, ReactNode } from 'react';
import { cx, pressTileClass } from '../../lib/theme';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Small uppercase label pinned above the content (theme.md). */
  label?: string;
  /**
   * `tile` (default) = press-tile primitive; `flat` = white card with a thin
   * light border (theme.md "Cards").
   */
  variant?: 'tile' | 'flat';
}

export function Card({ label, variant = 'tile', className, children, ...rest }: CardProps) {
  const surface =
    variant === 'tile'
      ? cx(pressTileClass, 'bg-canvas')
      : 'rounded-tile border border-ink/15 bg-canvas';

  return (
    <div className={cx(surface, 'p-5 sm:p-6', className)} {...rest}>
      {label ? <p className="label">{label}</p> : null}
      <div className={label ? 'mt-3' : undefined}>{children}</div>
    </div>
  );
}
