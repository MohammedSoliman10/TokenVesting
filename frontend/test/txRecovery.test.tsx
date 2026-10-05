/**
 * T054 — pending-transaction recovery (FR-022 persistence) — tests FIRST
 * (strict TDD). wagmi is mocked: no live chain.
 *
 * Rules under test:
 *  - a submitted tx hash is persisted in localStorage (the key is asserted
 *    as a literal so this test drives the implementation, not the reverse)
 *  - every storage access is wrapped: when storage is unavailable the app
 *    must still work (submit → pending, acknowledge → idle)
 *  - on reload the persisted hash is re-checked with getTransactionReceipt:
 *      success  → confirmed
 *      reverted → failed (friendly sentence, no raw data)
 *      not found yet → still pending
 *  - the restored terminal state stays visible until acknowledge(), and
 *    acknowledging removes the persisted entry
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const PENDING_KEY = 'token-vesting:pending-tx';

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

const HASH = '0x2222222222222222222222222222222222222222222222222222222222222222';

function persistedEntry(type = 'claim') {
  return JSON.stringify({ type, hash: HASH, chainId: 31337 });
}

beforeEach(() => {
  localStorage.removeItem(PENDING_KEY);
  wagmi.publicClient.getTransactionReceipt.mockReset();
});

describe('pending tx persistence (T054)', () => {
  it('persists the submitted tx hash in localStorage', () => {
    const { result } = renderHook(() => useTxStatus('claim'));

    act(() => result.current.onSubmitted('claim', HASH));

    const raw = localStorage.getItem(PENDING_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({ type: 'claim', hash: HASH });
    expect(result.current.state).toMatchObject({ status: 'pending', hash: HASH });
  });

  it('works when localStorage is unavailable (every access guarded)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    const { result } = renderHook(() => useTxStatus('claim'));
    act(() => result.current.onSubmitted('claim', HASH));
    expect(result.current.state.status).toBe('pending');

    act(() => result.current.onConfirmed());
    expect(result.current.state.status).toBe('confirmed');

    act(() => result.current.acknowledge());
    expect(result.current.state.status).toBe('idle');

    setItem.mockRestore();
    getItem.mockRestore();
    removeItem.mockRestore();
  });
});

describe('reload recovery (T054)', () => {
  it('persisted hash + successful receipt → confirmed, kept until acknowledged', async () => {
    localStorage.setItem(PENDING_KEY, persistedEntry('claim'));
    wagmi.publicClient.getTransactionReceipt.mockResolvedValue({ status: 'success' });

    // a fresh mount (page reload) — even a different screen's hook adopts it
    const { result } = renderHook(() => useTxStatus('faucet'));

    await waitFor(() => expect(result.current.state.status).toBe('confirmed'));
    expect(result.current.state.hash).toBe(HASH);
    expect(result.current.state.type).toBe('claim'); // restored with its original label
    expect(wagmi.publicClient.getTransactionReceipt).toHaveBeenCalledWith({ hash: HASH });

    // terminal state visible until acknowledged; entry removed by acknowledge
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();
    act(() => result.current.acknowledge());
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(result.current.state.status).toBe('idle');
  });

  it('persisted hash + reverted receipt → failed with a friendly sentence', async () => {
    localStorage.setItem(PENDING_KEY, persistedEntry('claim'));
    wagmi.publicClient.getTransactionReceipt.mockResolvedValue({ status: 'reverted' });

    const { result } = renderHook(() => useTxStatus('claim'));

    await waitFor(() => expect(result.current.state.status).toBe('failed'));
    expect(result.current.state.error).toBeTruthy();
    expect(result.current.state.error).not.toMatch(/0x[0-9a-fA-F]{6,}/);
    expect(result.current.state.error).not.toContain('reverted');

    // still visible on re-render until acknowledged
    act(() => result.current.acknowledge());
    expect(result.current.state.status).toBe('idle');
  });

  it('persisted hash but no receipt yet → still pending', async () => {
    localStorage.setItem(PENDING_KEY, persistedEntry('claim'));
    wagmi.publicClient.getTransactionReceipt.mockRejectedValue(
      new Error('TransactionReceiptNotFoundError'),
    );

    const { result } = renderHook(() => useTxStatus('claim'));

    await waitFor(() =>
      expect(wagmi.publicClient.getTransactionReceipt).toHaveBeenCalledWith({ hash: HASH }),
    );
    // let the rejected promise settle
    await act(async () => {});
    expect(result.current.state).toMatchObject({ status: 'pending', hash: HASH });
  });

  it('no persisted entry → the hook starts idle', () => {
    const { result } = renderHook(() => useTxStatus('claim'));
    expect(result.current.state.status).toBe('idle');
    expect(wagmi.publicClient.getTransactionReceipt).not.toHaveBeenCalled();
  });
});
