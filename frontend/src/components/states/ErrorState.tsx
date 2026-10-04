import { cx } from '../../lib/theme';
import { Button } from '../primitives/Button';

export interface ErrorStateProps {
  /** What broke, in user language (never raw revert data). */
  message: string;
  title?: string;
  /** Renders the Retry control when provided. */
  onRetry?: () => void;
  className?: string;
}

/**
 * Error state with retry (T015): every failing screen offers a way out
 * instead of rendering nothing (spec FR-023 / quickstart V11).
 */
export function ErrorState({
  message,
  title = 'Something went wrong',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div role="alert" className={cx('press-tile bg-coral p-6', className)}>
      <p className="font-display font-bold uppercase tracking-wide">{title}</p>
      <p className="mt-2 text-sm">{message}</p>
      {onRetry ? (
        <div className="mt-4">
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
