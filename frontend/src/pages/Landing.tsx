/**
 * Public landing page (T057/T059) — the "Plinth" treatment from
 * docs/design/theme.md: faint dot-grid backdrop, logo tile (coral square,
 * ink letter), uppercase pill label with a coral dot, left-aligned hero with
 * soft-coral highlight marks, three "how it works" steps, the deployed
 * contracts card and the GitHub footer link.
 *
 * Renders fully with NO wallet connected (public entry point), and — when the
 * active chain has no deployment — the App shell shows the "Contracts are
 * not deployed…" notice above (see App.tsx); write buttons are gated there.
 *
 * Gradients: only the CSS dot grid. Shadows: hard offset press tiles only.
 * No dark mode.
 */
import { Link } from 'react-router-dom';
import { activeChainId, addressesFor, isDeployed } from '../contracts';

/** Explorer address prefix per chain — absent chains get plain-text addresses. */
const EXPLORER_ADDRESS_URL: Record<string, string> = {
  '11155111': 'https://sepolia.etherscan.io/address/',
};

const HOW_IT_WORKS = [
  {
    title: 'Lock tokens',
    body: 'Create one schedule and hand the tokens over to the contract.',
  },
  {
    title: 'Cliff, then 90-day unlocks',
    body: 'Nothing moves until the cliff; after it, tokens unlock every 90 days.',
  },
  {
    title: 'Claim what has vested',
    body: 'The beneficiary claims the unlocked amount at any time.',
  },
] as const;

/** Both deployed addresses of the active chain (T057) — links on Sepolia. */
function DeployedContracts() {
  if (!isDeployed(activeChainId)) return null;
  const addresses = addressesFor(activeChainId);
  const explorer = EXPLORER_ADDRESS_URL[String(activeChainId)];

  return (
    <section className="press-tile bg-canvas p-5" aria-label="Deployed contracts">
      <p className="label">Deployed contracts</p>
      <dl className="mt-3 space-y-2 text-sm">
        {(['VestingFactory', 'TestToken'] as const).map((name) => {
          const address = addresses[name];
          if (!address) return null;
          return (
            <div key={name}>
              <dt className="inline font-display font-bold">{name}</dt>
              <dd className="ml-2 inline break-all">
                {explorer ? (
                  <a href={`${explorer}${address}`} className="underline hover:no-underline">
                    {address}
                  </a>
                ) : (
                  address
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

export default function Landing() {
  return (
    <section className="dot-grid rounded-tile border-2 border-ink/10 bg-canvas px-6 py-10 sm:px-10">
      {/* Logo tile + pill label */}
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="press-tile flex h-11 w-11 items-center justify-center bg-coral font-display text-xl font-bold"
        >
          V
        </span>
        <p className="label flex items-center gap-2 rounded-full border-2 border-ink bg-paper px-3 py-1 text-ink">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-coral" />
          Token vesting on Sepolia
        </p>
      </div>

      {/* Hero — left-aligned, soft-coral highlight marks behind key words */}
      <h1 className="mt-6 text-4xl sm:text-5xl">
        Lock tokens once.
        <br />
        Release them{' '}
        <mark className="rounded-tile bg-soft px-1 text-ink">on a schedule</mark>.
      </h1>
      <p className="mt-4 max-w-xl text-base">
        Create a vesting schedule with a cliff and{' '}
        <mark className="rounded-tile bg-soft px-1 text-ink">90-day unlock intervals</mark>, then
        follow your progress and claim exactly what has vested.
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

      {/* Three numbered steps */}
      <section className="mt-10">
        <h2 className="text-2xl">How it works</h2>
        <ol className="mt-4 space-y-4">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="press-tile flex h-8 w-8 shrink-0 items-center justify-center bg-soft font-display text-sm font-bold"
              >
                {index + 1}
              </span>
              <div>
                <p className="font-display font-bold">{step.title}</p>
                <p className="mt-0.5 text-sm text-ink/70">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-10">
        <DeployedContracts />
      </div>

      {/* Footer — source repo */}
      <footer className="mt-10 border-t-2 border-ink pt-4 text-sm">
        <a
          href="https://github.com/MohammedSoliman10/TokenVesting"
          className="font-display font-bold uppercase tracking-wide underline underline-offset-4 hover:no-underline"
          rel="noreferrer noopener"
          target="_blank"
        >
          View the source on GitHub
        </a>
      </footer>
    </section>
  );
}
