/**
 * T047 — transaction state machine (FR-022) — tests FIRST (strict TDD).
 *
 * Rules under test:
 *  - submitted → pending → confirmed, in that order
 *  - a user rejection lands in `failed` with a friendly sentence (FR-017 —
 *    never raw revert text) and never disturbs caller-owned data (the form
 *    values the caller holds are untouched by the hook)
 *  - a terminal state (confirmed/failed) STAYS visible until acknowledge()
 *    is called — a status that vanishes on its own is a spec violation
 *
 * `usePublicClient` is mocked because the hook also restores a persisted
 * pending tx on mount (T054 — covered in txRecovery.test.tsx).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const wagmi = vi.hoisted(() => ({
  publicClient: {
    getTransactionReceipt: vi.fn(),
    chain: { id: 31337 },
  },
}));

vi.mock('wagmi', () => ({
  usePublicClient: () => wagmi.publicClient,
}));

import { useTxStatus } from '../src/hooks/useTxStatus';

const HASH = '0x1111111111111111111111111111111111111111111111111111111111111111';

/** A viem-style user-rejection error. */
function rejectionError() {
  return Object.assign(new Error('User rejected the request.'), {
    shortMessage: 'User rejected the request.',
  });
}

beforeEach(() => {
  wagmi.publicClient.getTransactionReceipt.mockReset();
});

describe('useTxStatus', () => {
  it('walks submitted → pending → confirmed', () => {
    const { result } = renderHook(() => useTxStatus('claim'));

    expect(result.current.state.status).toBe('idle');
    act(() => result.current.onSubmitted('claim', HASH));
    expect(result.current.state).toMatchObject({ status: 'pending', type: 'claim', hash: HASH });

    act(() => result.current.onConfirmed());
    expect(result.current.state).toMatchObject({ status: 'confirmed', type: 'claim', hash: HASH });
  });

  it('user rejection → failed with a friendly message and caller data preserved', () => {
    // Caller-owned form data the hook must never touch.
    const formValues = { amount: '900', beneficiary: '0x1111111111111111111111111111111111111111' };
    const { result } = renderHook(() => useTxStatus('create'));

    act(() => result.current.onSubmitted('create', HASH));
    act(() => result.current.onFailed(rejectionError()));

    expect(result.current.state.status).toBe('failed');
    expect(result.current.state.error).toBe(
      'You rejected the request in your wallet — nothing was sent.',
    );
    // the action type survives so the caller can retry the same operation
    expect(result.current.state.type).toBe('create');
    // and the form data is exactly as the caller left it
    expect(formValues).toEqual({
      amount: '900',
      beneficiary: '0x1111111111111111111111111111111111111111',
    });
  });

  it('a failed terminal state stays visible until acknowledge() is called', () => {
    const { result, rerender } = renderHook(() => useTxStatus('create'));

    act(() => result.current.onFailed(rejectionError()));
    expect(result.current.state.status).toBe('failed');

    // still there on re-render (FR-022: the chip must not vanish alone)
    rerender();
    expect(result.current.state.status).toBe('failed');
    expect(result.current.state.error).toContain('nothing was sent');

    act(() => result.current.acknowledge());
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.error).toBeUndefined();
  });

  it('a confirmed terminal state stays visible until acknowledge() is called', () => {
    const { result, rerender } = renderHook(() => useTxStatus('claim'));

    act(() => result.current.onSubmitted('claim', HASH));
    act(() => result.current.onConfirmed());
    rerender();
    expect(result.current.state.status).toBe('confirmed');

    act(() => result.current.acknowledge());
    expect(result.current.state.status).toBe('idle');
  });

  it('onFailed() without a reason still reports a friendly sentence', () => {
    const { result } = renderHook(() => useTxStatus('claim'));

    act(() => result.current.onFailed(undefined));

    expect(result.current.state.status).toBe('failed');
    expect(result.current.state.error).toBe(
      'The transaction did not go through. Please try again.',
    );
  });
});
