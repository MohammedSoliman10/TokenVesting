/**
 * T028–T030 — create-schedule form + confirmation view (FR-018, FR-019,
 * FR-014a) — tests FIRST (strict TDD). wagmi is mocked: no live chain.
 *
 * Binding rules under test:
 *  - "1 month = 30 days" sits next to BOTH cliff and duration inputs
 *  - "Start now" sends 0; the date picker sends unix seconds
 *  - every validation error shows inline BEFORE any wallet prompt
 *  - approval is skipped when the existing allowance is already enough
 *  - a failed create keeps the form data and the retry does not re-approve
 *  - the confirmation view echoes the exact parameters + creation record
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { encodeAbiParameters, encodeEventTopics } from 'viem';

const mocks = vi.hoisted(() => ({
  writeContract: vi.fn(),
  writeContractAsync: vi.fn(),
  write: { data: undefined, isPending: false, error: undefined, reset: vi.fn() },
  receipt: { data: undefined, isLoading: false, error: undefined },
  account: { address: '0x328809Bc894f92807417D2dAD6b7C998c1aFdac6' as string | undefined },
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getTransactionReceipt: vi.fn(),
  switchChainAsync: vi.fn(),
  allowance: 0n as bigint,
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: mocks.account.address }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync, isPending: false }),
  usePublicClient: () => ({
    readContract: mocks.readContract,
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
    getTransactionReceipt: mocks.getTransactionReceipt,
  }),
  useWriteContract: () => ({
    writeContract: mocks.writeContract,
    writeContractAsync: mocks.writeContractAsync,
    data: mocks.write.data,
    isPending: mocks.write.isPending,
    error: mocks.write.error,
    reset: mocks.write.reset,
  }),
  useWaitForTransactionReceipt: () => mocks.receipt,
}));

import CreateSchedule from '../src/pages/CreateSchedule';
import { abiFor, activeChainId, contractAddress } from '../src/contracts';
import {
  AMOUNT_BALANCE_MESSAGE,
  AMOUNT_POSITIVE_MESSAGE,
  DURATION_MESSAGE,
  MONTH_CONVENTION_COPY,
} from '../src/lib/schemas';

const TOKEN = contractAddress(activeChainId, 'TestToken')! as `0x${string}`;
const FACTORY = contractAddress(activeChainId, 'VestingFactory')! as `0x${string}`;
const BENEFICIARY = '0x1111111111111111111111111111111111111111';

const APPROVE_HASH = '0xa111111111111111111111111111111111111111111111111111111111111111';
const CREATE_HASH = '0xc333333333333333333333333333333333333333333333333333333333333333';

const FULL_BALANCE = 1_000n * 10n ** 18n;

/** Fill every field with a valid value (start mode stays "now"). */
function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Beneficiary address'), {
    target: { value: BENEFICIARY },
  });
  fireEvent.change(screen.getByLabelText('Cliff (months)'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Duration (months)'), { target: { value: '6' } });
  fireEvent.change(screen.getByLabelText('Amount (TEST)'), { target: { value: '100' } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
}

const calledContracts = () =>
  mocks.writeContractAsync.mock.calls.map(
    (call) => (call[0] as { functionName: string }).functionName,
  );

beforeEach(() => {
  mocks.writeContract.mockReset();
  mocks.writeContractAsync.mockReset();
  mocks.write.data = undefined;
  mocks.write.isPending = false;
  mocks.write.error = undefined;
  mocks.receipt.data = undefined;
  mocks.receipt.error = undefined;
  mocks.account.address = '0x328809Bc894f92807417D2dAD6b7C998c1aFdac6';
  mocks.allowance = 0n;
  mocks.readContract.mockReset();
  mocks.waitForTransactionReceipt.mockReset();
  mocks.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === 'balanceOf') return FULL_BALANCE;
      if (functionName === 'symbol') return 'TEST';
      if (functionName === 'allowance') return mocks.allowance;
      return 0n;
    },
  );
  mocks.waitForTransactionReceipt.mockResolvedValue({ logs: [] });
});

describe('CreateSchedule form (T028)', () => {
  it('shows "1 month = 30 days" next to BOTH the cliff and the duration inputs (FR-018)', async () => {
    render(<CreateSchedule />);
    await screen.findByText('Balance: 1000 TEST');

    expect(screen.getByLabelText('Cliff (months)')).toHaveAccessibleDescription(
      MONTH_CONVENTION_COPY,
    );
    expect(screen.getByLabelText('Duration (months)')).toHaveAccessibleDescription(
      MONTH_CONVENTION_COPY,
    );
  });

  it('shows every validation error inline BEFORE any wallet prompt (FR-018)', async () => {
    render(<CreateSchedule />);
    await screen.findByText('Balance: 1000 TEST');

    fireEvent.change(screen.getByLabelText('Beneficiary address'), {
      target: { value: BENEFICIARY },
    });
    fireEvent.change(screen.getByLabelText('Cliff (months)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Duration (months)'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Amount (TEST)'), { target: { value: '0' } });
    submit();

    expect(await screen.findByText(DURATION_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(AMOUNT_POSITIVE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByLabelText('Duration (months)')).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('"Start now" sends start = 0 on chain', async () => {
    mocks.allowance = FULL_BALANCE;
    render(<CreateSchedule />);
    await screen.findByText('Balance: 1000 TEST');

    fillValidForm();
    submit();

    await waitForWriteContract();
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(mocks.writeContractAsync.mock.calls[0][0]).toMatchObject({
      address: FACTORY,
      functionName: 'createSchedule',
      args: [TOKEN, BENEFICIARY, 0n, 3n, 6n, 100n * 10n ** 18n],
    });
  });

  it('the date picker sends the picked moment as unix seconds', async () => {
    mocks.allowance = FULL_BALANCE;
    render(<CreateSchedule />);
    await screen.findByText('Balance: 1000 TEST');

    fireEvent.click(screen.getByLabelText('Start at'));
    const picked = '2030-01-15T00:00';
    fireEvent.change(await screen.findByLabelText('Start date and time'), {
      target: { value: picked },
    });
    fillValidForm();
    submit();

    await waitForWriteContract();
    const expectedSeconds = BigInt(Math.floor(new Date(picked).getTime() / 1000));
    expect(mocks.writeContractAsync.mock.calls[0][0]).toMatchObject({
      functionName: 'createSchedule',
      args: [TOKEN, BENEFICIARY, expectedSeconds, 3n, 6n, 100n * 10n ** 18n],
    });
  });

  it('skips the approve step when the existing allowance already covers the amount (FR-019)', async () => {
    mocks.allowance = 100n * 10n ** 18n; // already approved for the full amount
    render(<CreateSchedule />);
    await screen.findByText('Balance: 1000 TEST');

    fillValidForm();
    submit();

    await waitForWriteContract();
    expect(calledContracts()).toEqual(['createSchedule']);
    expect(mocks.readContract).toHaveBeenCalledWith({
      abi: abiFor('TestToken'),
      address: TOKEN,
      functionName: 'allowance',
      args: [mocks.account.address, FACTORY],
    });
  });
});

describe('CreateSchedule failure + retry (T029 binding)', () => {
  it('keeps the form data after a failed create and the retry does NOT re-approve (FR-017)', async () => {
    let createAttempts = 0;
    mocks.writeContractAsync.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'approve') return APPROVE_HASH;
      createAttempts += 1;
      if (createAttempts === 1) throw new Error('user rejected the request');
      return CREATE_HASH;
    });
    render(<CreateSchedule />);
    await screen.findByText('Balance: 1000 TEST');

    fillValidForm();
    submit();

    // Failure surfaces a friendly message; nothing of the input is lost.
    expect(
      await screen.findByText('You rejected the request in your wallet — nothing was sent.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Beneficiary address')).toHaveValue(BENEFICIARY);
    expect(screen.getByLabelText('Cliff (months)')).toHaveValue(3); // number input → number value
    expect(screen.getByLabelText('Duration (months)')).toHaveValue(6);
    expect(screen.getByLabelText('Amount (TEST)')).toHaveValue('100');
    expect(calledContracts()).toEqual(['approve', 'createSchedule']);

    // The approval was mined before the failure → allowance now covers it.
    mocks.allowance = 100n * 10n ** 18n;
    submit();

    expect(await screen.findByText('Schedule created')).toBeInTheDocument();
    expect(calledContracts()).toEqual(['approve', 'createSchedule', 'createSchedule']);
  });
});

describe('CreateSchedule confirmation view (T030)', () => {
  it('lists the exact parameters, the creation record and the tx (FR-020-adjacent)', async () => {
    mocks.allowance = FULL_BALANCE;
    mocks.writeContractAsync.mockResolvedValue(CREATE_HASH);
    const topics = encodeEventTopics({
      abi: abiFor('VestingFactory'),
      eventName: 'ScheduleCreated',
      args: {
        id: 7n,
        grantor: mocks.account.address! as `0x${string}`,
        beneficiary: BENEFICIARY,
      },
    });
    const data = encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [TOKEN, 0n, 7_776_000n, 15_552_000n, 100n * 10n ** 18n],
    );
    mocks.waitForTransactionReceipt.mockResolvedValue({
      logs: [{ address: FACTORY, data, topics }],
    });
    render(<CreateSchedule />);
    await screen.findByText('Balance: 1000 TEST');

    fillValidForm();
    submit();

    expect(await screen.findByText('Schedule created')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); // creation record: schedule id
    expect(screen.getByText(TOKEN)).toBeInTheDocument();
    expect(screen.getByText(BENEFICIARY)).toBeInTheDocument();
    expect(screen.getByText('Start now (unix 0)')).toBeInTheDocument();
    expect(screen.getByText('3 months')).toBeInTheDocument();
    expect(screen.getByText('6 months')).toBeInTheDocument();
    expect(screen.getByText('100 TEST')).toBeInTheDocument();
    expect(screen.getByText(CREATE_HASH)).toBeInTheDocument(); // tx link/hash

    // "Create another" returns to a fresh form.
    fireEvent.click(screen.getByRole('button', { name: 'Create another' }));
    expect(screen.getByLabelText('Beneficiary address')).toHaveValue('');
  });
});

describe('CreateSchedule without a wallet (T053)', () => {
  it('shows connect guidance, disables submit and never shows a misleading balance error', async () => {
    mocks.account.address = undefined;
    const { container } = render(<CreateSchedule />);

    // guidance, not a blank or an error
    expect(screen.getByText('Connect a wallet to create a schedule')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // fill the form (no symbol → the amount label carries no ticker)
    fireEvent.change(screen.getByLabelText('Beneficiary address'), {
      target: { value: BENEFICIARY },
    });
    fireEvent.change(screen.getByLabelText('Cliff (months)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Duration (months)'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '100' } });
    // programmatic submit bypasses the disabled button — validation must run
    fireEvent.submit(container.querySelector('form')!);

    // with no wallet the balance is UNKNOWN — "exceeds your wallet balance"
    // would be a lie (V6 must be skipped until a wallet is connected)
    expect(screen.queryByText(AMOUNT_BALANCE_MESSAGE)).not.toBeInTheDocument();

    // and no write can be attempted
    expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
  });
});

describe('CreateSchedule balance read failure (T052 audit)', () => {
  it('shows an inline error with a working Retry when the balance read fails', async () => {
    mocks.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === 'balanceOf') throw new Error('RPC unreachable');
        if (functionName === 'symbol') return 'TEST';
        return 0n;
      },
    );
    render(<CreateSchedule />);

    expect(await screen.findByText('Could not read your balance.')).toBeInTheDocument();
    expect(screen.queryByText(/^Balance:/)).not.toBeInTheDocument();

    // the RPC recovers → Retry re-runs the read
    mocks.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === 'balanceOf') return FULL_BALANCE;
        if (functionName === 'symbol') return 'TEST';
        if (functionName === 'allowance') return mocks.allowance;
        return 0n;
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry balance' }));

    expect(await screen.findByText('Balance: 1000 TEST')).toBeInTheDocument();
    expect(screen.queryByText('Could not read your balance.')).not.toBeInTheDocument();
  });
});

/** `writeContractAsync` is called asynchronously after submit. */
async function waitForWriteContract() {
  await waitFor(() => expect(mocks.writeContractAsync).toHaveBeenCalled());
}
