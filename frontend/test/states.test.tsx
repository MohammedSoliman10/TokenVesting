/**
 * T049 — shared loading / empty / error states (FR-023, quickstart V11) —
 * tests FIRST (strict TDD).
 *
 * Rules under test:
 *  - Loading renders a labelled skeleton list (never a blank screen)
 *  - Empty explains WHY it is empty, with an optional action
 *  - ErrorState renders the friendly message with role="alert" and the
 *    Retry control calls back when provided (and is absent otherwise)
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Empty } from '../src/components/states/Empty';
import { ErrorState } from '../src/components/states/ErrorState';
import { Loading } from '../src/components/states/Loading';

describe('Loading', () => {
  it('renders a labelled skeleton list', () => {
    render(<Loading rows={3} label="Loading schedules" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Loading schedules');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3); // skeletons
    expect(screen.getByText('Loading schedules')).toBeInTheDocument(); // sr-only label
  });

  it('defaults to three rows', () => {
    render(<Loading />);
    const status = screen.getByRole('status');
    expect(status.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });
});

describe('Empty', () => {
  it('renders the title and description', () => {
    render(<Empty title="No schedules yet" description="Create one to get started." />);

    expect(screen.getByText('No schedules yet')).toBeInTheDocument();
    expect(screen.getByText('Create one to get started.')).toBeInTheDocument();
  });

  it('renders an optional action that is clickable', () => {
    const onAction = vi.fn();
    render(
      <Empty
        title="No schedules yet"
        action={
          <button type="button" onClick={onAction}>
            Create a schedule
          </button>
        }
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create a schedule' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders no action slot when none is given', () => {
    render(<Empty title="No schedules yet" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('renders as an alert with the friendly message', () => {
    render(<ErrorState message="Could not reach the network." />);

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Could not reach the network.')).toBeInTheDocument();
  });

  it('supports a custom title', () => {
    render(<ErrorState title="Network problem" message="Offline." />);
    expect(screen.getByText('Network problem')).toBeInTheDocument();
  });

  it('the Retry control calls the callback', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Offline." onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows no Retry when no callback is provided', () => {
    render(<ErrorState message="Offline." />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
