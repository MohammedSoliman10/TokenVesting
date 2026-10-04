import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx, pressTileClass } from '../../lib/theme';

export type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /** `primary` = coral fill, `secondary` = paper fill (theme.md). */
  variant?: ButtonVariant;
  /** Busy marker: blocks clicks and marks `aria-busy` (used while pending). */
  busy?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-coral',
  secondary: 'bg-paper',
};

/**
 * Button built on the press-tile primitive (theme.md: buttons use press-tile
 * behaviour, display font, uppercase labels).
 */
export function Button({
  variant = 'primary',
  busy = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const inactive = Boolean(disabled) || busy;

  return (
    <button
      type={type}
      disabled={inactive}
      aria-busy={busy}
      className={cx(
        pressTileClass,
        variantClass[variant],
        'px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide',
        inactive && 'pointer-events-none opacity-50',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
