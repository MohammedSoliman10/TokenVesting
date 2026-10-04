import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx, pressTileClass } from '../../lib/theme';

export interface TabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /** Selected segment of a segmented control (theme.md). */
  active?: boolean;
}

/**
 * Segmented-control segment built on the press-tile primitive: the active
 * segment is paper with ink text; inactive segments sit flat inside the ink
 * pill container.
 */
export function Tab({
  active = false,
  className,
  children,
  type = 'button',
  ...rest
}: TabProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cx(
        pressTileClass,
        'px-4 py-2 font-display text-sm font-bold uppercase tracking-wide',
        active
          ? 'bg-paper'
          : 'border-transparent bg-transparent shadow-none hover:bg-transparent active:bg-transparent active:shadow-none',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
