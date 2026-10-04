/**
 * T025 — FaucetButton state machine (FR-014a, FR-017, FR-022).
 * Written BEFORE `src/components/FaucetButton.tsx` (strict TDD). wagmi is
 * mocked: no live chain, no wallet — assertions only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const wagmi = vi.hoisted(() => ({
  writeContract: vi.fn(),
  write: {
    data: undefined as string | undefined,
    isPending: false,
    error: undefined as unknown,
    reset: vi.fn(),
  },
  receipt: {
    data: undefined as { status?: string } | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('wagmi', () => ({
  useWriteContract: () => ({
    writeContract: wagmi.writeContract,
    data: wagmi.write.data,
    isPending: wagmi.write.isPending,
    error: wagmi.write.error,
    reset: wagmi.write.reset,
  }),
  useWaitForTransactionReceipt: () => wagmi.receipt,
}));

import { FaucetButton } from '../src/components/FaucetButton';
import { abiFor, activeChainId, contractAddress } from '../src/contracts';

const HASH = '0x1111111111111111111111111111111111111111111111111111111111111111';

/** A viem-style revert carrying the FaucetCooldown custom error. */
function faucetCooldownError() {
  return Object.assign(new Error('execution reverted: FaucetCooldown()'), {
    shortMessage: 'execution reverted with custom error FaucetCooldown()',
    details: 'FaucetCooldown()',
  });
}

beforeEach(() => {
  wagmi.writeContract.mockReset();
  wagmi.write.data = undefined;
  wagmi.write.isPending = false;
  wagmi.write.error = undefined;
  wagmi.receipt.data = undefined;
  wagmi.receipt.isLoading = false;
  wagmi.receipt.error = undefined;
});

describe('FaucetButton', () => {
  it('idle: renders the control with no status shown', () => {
    render(<FaucetButton />);

    expect(screen.getByRole('button', { name: /get test tokens/i })).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('click: calls faucet() on the deployed TestToken with the generated ABI (nothing hardcoded)', () => {
    render(<FaucetButton />);

    fireEvent.click(screen.getByRole('button', { name: /get test tokens/i }));

    expect(wagmi.writeContract).toHaveBeenCalledTimes(1);
    const call = wagmi.writeContract.mock.calls[0][0] as {
      address: string;
      abi: unknown;
      functionName: string;
    };
    expect(call.functionName).toBe('faucet');
    expect(call.address).toBe(contractAddress(activeChainId, 'TestToken'));
    expect(call.abi).toBe(abiFor('TestToken')); // same reference as the generated ABI
  });

  it('signing: the control is busy while the wallet prompt is open', () => {
    wagmi.write.isPending = true;
    render(<FaucetButton />);

    expect(screen.getByRole('button', { name: /get test tokens/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /get test tokens/i })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('pending: submitted transaction shows the status chip and blocks double submission', () => {
    wagmi.write.data = HASH;
    render(<FaucetButton />);

    expect(screen.getByRole('status')).toHaveTextContent('Test tokens: Pending');
    expect(screen.getByRole('button', { name: /get test tokens/i })).toBeDisabled();
  });

  it('confirmed: the receipt flips the chip to confirmed', () => {
    wagmi.write.data = HASH;
    wagmi.receipt.data = { status: 'success' };
    render(<FaucetButton />);

    expect(screen.getByRole('status')).toHaveTextContent('Test tokens: Confirmed');
    expect(screen.getByRole('button', { name: /get test tokens/i })).toBeEnabled();
  });

  it('failed: decodes FaucetCooldown into a friendly message (users never see raw revert data)', () => {
    wagmi.write.error = faucetCooldownError();
    render(<FaucetButton />);

    expect(screen.getByRole('status')).toHaveTextContent('Test tokens: Failed');
    expect(screen.getByRole('alert')).toHaveTextContent(
      /already claimed test tokens in the last 24 hours/i,
    );
    expect(screen.queryByText(/FaucetCooldown/)).not.toBeInTheDocument();
  });

  it('failed: stays visible until acknowledged, then the control is retryable', () => {
    wagmi.write.error = faucetCooldownError();
    render(<FaucetButton />);

    expect(screen.getByRole('status')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get test tokens/i })).toBeEnabled();
  });
});
