/**
 * Dashboard route (`/dashboard`, task T043 / US2): the beneficiary's schedule
 * list with vesting progress, timeline and (T044) claim actions.
 *
 * State machine (spec FR-023 — every state everywhere):
 *  - no wallet        → connect prompt (never an error, never a spinner)
 *  - loading          → labelled skeleton
 *  - error, no data   → alert + Retry (refetch)
 *  - empty list       → explanation + link to /create
 *  - data             → ScheduleCard + VestingTimeline per schedule
 *
 * All derived values come from `useSchedules`, whose `now` is the latest
 * block timestamp — the page never reads the browser clock.
 */
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { ClaimButton } from '../components/ClaimButton';
import { ScheduleCard } from '../components/ScheduleCard';
import { VestingTimeline } from '../components/VestingTimeline';
import { Empty } from '../components/states/Empty';
import { ErrorState } from '../components/states/ErrorState';
import { Loading } from '../components/states/Loading';
import { useSchedules } from '../hooks/useSchedules';
import { friendlyErrorMessage } from '../lib/errors';

export default function Dashboard() {
  const { address } = useAccount();
  const { data, isLoading, error, refetch } = useSchedules();

  if (!address) {
    return (
      <section>
        <p className="label">Dashboard</p>
        <h1 className="mt-3 text-3xl">Your vesting schedules</h1>
        <Empty
          className="mt-6"
          title="Connect your wallet"
          description="Your vesting schedules appear here once a wallet is connected."
        />
      </section>
    );
  }

  return (
    <section>
      <p className="label">Dashboard</p>
      <h1 className="mt-3 text-3xl">Your vesting schedules</h1>

      <div className="mt-6">
        {isLoading && !data ? (
          <Loading rows={3} label="Loading schedules" />
        ) : error && !data ? (
          <ErrorState
            message={friendlyErrorMessage(error)}
            onRetry={() => void refetch()}
          />
        ) : !data || data.schedules.length === 0 ? (
          <Empty
            title="No schedules yet"
            description="Schedules where this wallet is the beneficiary will appear here."
            action={
              <Link
                to="/create"
                className="font-display text-sm font-bold uppercase tracking-wide underline hover:no-underline"
              >
                Create a schedule
              </Link>
            }
          />
        ) : (
          <ul className="space-y-8">
            {data.schedules.map((schedule) => (
              <li key={schedule.id.toString()}>
                <ScheduleCard schedule={schedule} now={data.now}>
                  {/* The beneficiary gate lives inside ClaimButton — the card
                      always offers the slot, the button decides visibility. */}
                  <ClaimButton
                    schedule={schedule}
                    now={data.now}
                    refetchSchedules={refetch}
                  />
                </ScheduleCard>
                <div className="mt-3">
                  <VestingTimeline schedule={schedule} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
