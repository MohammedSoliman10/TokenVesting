/**
 * Dashboard route (`/dashboard`) — placeholder shell (task T013).
 * Schedule list, progress, timeline and claiming land in tasks T040–T045
 * (User Story 2).
 */
export default function Dashboard() {
  return (
    <section>
      <p className="label">Dashboard</p>
      <h1 className="mt-3 text-3xl">Your vesting schedules</h1>

      <div className="press-tile mt-6 bg-paper p-6">
        <p className="text-sm">
          Connect a wallet to see the schedules it is the beneficiary or grantor of, with vested
          totals, progress and claim actions.
        </p>
        <p className="mt-3 text-sm text-ink/60">
          The schedule list is under construction — it arrives with User Story 2.
        </p>
      </div>
    </section>
  );
}
