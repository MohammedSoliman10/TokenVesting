/**
 * T044 — claim action (US2, FR-021, FR-022): drives `VestingFactory.release`
 * through the shared `useTxStatus` state machine.
 *
 * Gates (all spec-driven):
 *  - visible ONLY when a wallet is connected AND is the schedule's
 *    beneficiary — the dashboard never offers a claim action for someone
 *    else's schedule (acceptance scenario 7). Hooks run before this gate so
 *    React hook order stays stable.
 *  - before the cliff: disabled with the exact text "Nothing vested yet" and
 *    the releasable read stays off (no wasted RPC).
 *  - after the cliff: enabled IF AND ONLY IF the on-chain
 *    `releasableAmount(id)` is greater than zero (FR-021) — the contract's
 *    own view is the authority for the gate, never local guessing.
 *  - after a confirmed receipt both the dashboard schedules and the
 *    releasable read are refetched, so the card shows the fresh numbers
 *    immediately (acceptance scenario 3/4).
 *
 * Failures decode to friendly sentences (FR-017) — e.g. `NothingToRelease()`
 * races where another wallet claimed first.
 */
import { useEffect } from 'react';
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { abiFor, activeChainId, contractAddress } from '../contracts';
import type { ScheduleRecord } from '../hooks/useSchedules';
import { useTxStatus } from '../hooks/useTxStatus';
import { Button } from './primitives/Button';
import { TxStatus } from './states/TxStatus';

export interface ClaimButtonProps {
  schedule: ScheduleRecord;
  /** Latest chain timestamp (from useSchedules — never Date.now()). */
  now: bigint;
  /** Called after a confirmed claim so the dashboard shows fresh numbers. */
  refetchSchedules: () => void | Promise<void>;
}

export function ClaimButton({ schedule, now, refetchSchedules }: ClaimButtonProps) {
  const { address } = useAccount();
  const factoryAddress = contractAddress(activeChainId, 'VestingFactory');
  const beforeCliff = now < schedule.start + schedule.cliffDuration;

  const isBeneficiary =
    address !== undefined && address.toLowerCase() === schedule.beneficiary.toLowerCase();

  // On-chain authority for the gate (FR-021). Off until the cliff passes and
  // unless this wallet is the beneficiary.
  const { data: releasable, refetch: refetchReleasable } = useReadContract({
    address: factoryAddress as `0x${string}`,
    abi: abiFor('VestingFactory'),
    functionName: 'releasableAmount',
    args: [schedule.id],
    chainId: activeChainId,
    query: { enabled: isBeneficiary && !beforeCliff && Boolean(factoryAddress) },
  });

  const { state, onSubmitted, onConfirmed, onFailed, acknowledge, isPending } = useTxStatus(
    'claim',
  );
  const {
    writeContract,
    data: hash,
    isPending: signing,
    error: writeError,
  } = useWriteContract();
  const { data: receipt, error: receiptError } = useWaitForTransactionReceipt({ hash });

  // hash → pending (submitted), receipt → confirmed, errors → failed.
  useEffect(() => {
    if (hash) onSubmitted('claim', hash);
  }, [hash, onSubmitted]);
  useEffect(() => {
    if (receipt) {
      onConfirmed();
      void refetchSchedules();
      void refetchReleasable();
    }
  }, [receipt, onConfirmed, refetchSchedules, refetchReleasable]);
  useEffect(() => {
    if (writeError) onFailed(writeError);
  }, [writeError, onFailed]);
  useEffect(() => {
    if (receiptError) onFailed(receiptError);
  }, [receiptError, onFailed]);

  // Beneficiary gate: hooks above always run; only rendering is gated.
  if (!isBeneficiary) return null;

  // `abiFor` returns the wide `Abi` type, so wagmi can't narrow `data` —
  // releasableAmount(uint256) returns uint256 → bigint.
  const amount = (releasable as bigint | undefined) ?? 0n;
  const busy = signing || isPending;
  const canClaim = !beforeCliff && amount > 0n && !busy;

  const claim = () => {
    if (!factoryAddress) return;
    writeContract({
      address: factoryAddress as `0x${string}`,
      abi: abiFor('VestingFactory'),
      functionName: 'release',
      args: [schedule.id],
      chainId: activeChainId,
    });
  };

  const terminal = state.status === 'confirmed' || state.status === 'failed';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" onClick={claim} busy={busy} disabled={!canClaim}>
        {beforeCliff ? 'Nothing vested yet' : 'Claim'}
      </Button>
      <TxStatus state={state} />
      {state.status === 'failed' && state.error ? (
        <p role="alert" className="text-sm text-ink/80">
          {state.error}
        </p>
      ) : null}
      {terminal ? (
        <Button type="button" variant="secondary" onClick={acknowledge}>
          Dismiss
        </Button>
      ) : null}
    </div>
  );
}
