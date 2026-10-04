/**
 * Public landing page — placeholder shell (route `/`, task T013).
 * The full Plinth treatment (dot grid, crop marks, highlight marks) lands in
 * task T059 (User Story 4).
 */
import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <section className="py-8">
      <p className="label">Token vesting on Sepolia</p>
      <h1 className="mt-3 text-4xl sm:text-5xl">
        Lock tokens once.
        <br />
        Release them on a schedule.
      </h1>
      <p className="mt-4 max-w-xl text-base">
        Create a vesting schedule with a cliff and 90-day unlock intervals, then follow your
        progress and claim exactly what has vested.
      </p>

      <div className="mt-8 flex flex-wrap gap-4">
        <Link
          to="/create"
          className="press-tile bg-coral px-6 py-3 font-display font-bold uppercase"
        >
          Create a schedule
        </Link>
        <Link
          to="/dashboard"
          className="press-tile bg-paper px-6 py-3 font-display font-bold uppercase"
        >
          View dashboard
        </Link>
      </div>
    </section>
  );
}
