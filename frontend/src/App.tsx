/**
 * App shell + routes (task T013): `/`, `/create`, `/dashboard`.
 * Route pages are grown by US1/US2/US4 (T028, T043, T059); the shell itself
 * — header, nav, wallet connect — is stable.
 *
 * T053: when the wallet disconnects (or switches), the cached schedule
 * queries of the previous wallet are cleared — a public session must never
 * show another wallet's data. Reconnecting refetches fresh schedules.
 *
 * T057: /create and /dashboard are React.lazy (Loading fallback while the
 * chunk loads) and the deployment-missing notice sits above the routes so
 * every page shows it exactly once when the active chain has no deployment.
 */
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { Loading } from './components/states/Loading';
import { activeChainId, isDeployed } from './contracts';
import { chainNameOf } from './hooks/useEnsureChain';
import Landing from './pages/Landing';

/** Route pages load on demand — the public landing paints first (T057). */
const CreateSchedule = lazy(() => import('./pages/CreateSchedule'));
const Dashboard = lazy(() => import('./pages/Dashboard'));

/** Clear cached schedules for a wallet that is no longer connected (T053). */
function useClearSchedulesOnDisconnect() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const prevAddress = useRef(address);

  useEffect(() => {
    const prev = prevAddress.current;
    if (prev !== undefined && prev !== address) {
      // disconnected (address undefined) or switched wallet → drop the cache
      void queryClient.removeQueries({ queryKey: ['schedules'] });
    }
    prevAddress.current = address;
  }, [address, queryClient]);
}

/**
 * Deployment-missing notice (T057): when the active chain has no deployment,
 * every route shows exactly one clear notice. Write buttons are gated on the
 * same `isDeployed` flag (FaucetButton, CreateSchedule submit).
 */
function DeploymentNotice() {
  if (isDeployed(activeChainId)) return null;
  return (
    <p role="status" className="press-tile mb-4 bg-soft px-4 py-3 text-sm font-semibold">
      Contracts are not deployed on {chainNameOf(activeChainId)} yet
    </p>
  );
}

export default function App() {
  useClearSchedulesOnDisconnect();

  return (
    <div className="min-h-screen">
      <header className="border-b-2 border-ink px-4 py-3 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <Link to="/" className="press-tile bg-paper px-3 py-1.5 font-display text-sm font-bold">
            TOKEN VESTING
          </Link>

          <nav aria-label="Main" className="flex items-center gap-4 text-sm">
            <Link to="/create" className="font-display uppercase tracking-wide hover:underline">
              Create
            </Link>
            <Link to="/dashboard" className="font-display uppercase tracking-wide hover:underline">
              Dashboard
            </Link>
          </nav>

          <ConnectButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
        <DeploymentNotice />
        <Suspense fallback={<Loading label="Loading page" />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/create" element={<CreateSchedule />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
