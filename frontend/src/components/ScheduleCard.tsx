import type { ReactNode } from 'react';
import { formatUnits } from 'viem';
import type { ScheduleRecord } from '../hooks/useSchedules';
import { deriveScheduleView } from '../lib/vesting';
import { Card } from './primitives/Card';
import { VestingProgress } from './VestingProgress';

export interface ScheduleCardProps {
  schedule: ScheduleRecord;
  /** Latest chain timestamp (from useSchedules — never Date.now()). */
  now: bigint;
  /** Claim action slot (wired to ClaimButton in T044). */
  children?: ReactNode;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm opacity-70">{label}</dt>
      <dd className="font-display text-sm font-bold">{value}</dd>
    </div>
  );
}

/**
 * Beneficiary schedule card (T041, FR-020): token, total, released and
 * currently releasable amounts plus the vesting progress bar, all derived
 * from the schedule and the PROVIDED chain timestamp (`now` from useSchedules
 * — the card never reads the browser clock).
 *
 * The `children` slot carries the claim action (T044), so the card stays
 * presentational and testable without a wallet.
 */
export function ScheduleCard({ schedule, now, children }: ScheduleCardProps) {
  const view = deriveScheduleView(schedule, schedule.released, now);
  const amount = (base: bigint): string =>
    `${formatUnits(base, schedule.tokenDecimals)} ${schedule.tokenSymbol}`;

  return (
    <Card label={`Schedule #${schedule.id}`}>
      <dl className="space-y-2">
        <Row label="Token" value={schedule.tokenSymbol} />
        <Row label="Total" value={amount(schedule.totalAmount)} />
        <Row label="Released" value={amount(schedule.released)} />
        <Row label="Releasable" value={amount(view.releasable)} />
      </dl>
      <div className="mt-4">
        <VestingProgress progress={view.progress} state={view.state} />
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </Card>
  );
}
