/**
 * Create-schedule route (`/create`) — placeholder shell (task T013).
 * The validated create + approve + fund flow lands in tasks T026–T030
 * (User Story 1).
 */
export default function CreateSchedule() {
  return (
    <section>
      <p className="label">New schedule</p>
      <h1 className="mt-3 text-3xl">Create a vesting schedule</h1>

      <div className="press-tile mt-6 bg-canvas p-6">
        <p className="text-sm">
          Pick a beneficiary, a start time, a cliff and a duration (multiples of 3 months), and
          the amount to lock. 1 month = 30 days.
        </p>
        <p className="mt-3 text-sm text-ink/60">
          The form is under construction — connecting a wallet and funding a schedule arrives
          with User Story 1.
        </p>
      </div>
    </section>
  );
}
