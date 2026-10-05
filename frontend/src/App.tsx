/**
 * App shell + routes (task T013): `/`, `/create`, `/dashboard`.
 * Route pages are grown by US1/US2/US4 (T028, T043, T059); the shell itself
 * — header, nav, wallet connect — is stable.
 *
 * T053: when the wallet disconnects (or switches), the cached schedule
 * queries of the previous wallet are cleared — a public session must never
 * show another wallet's data. Reconnecting refetches fresh schedules.
 */
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { useAccount } from 'wagmi';
import CreateSchedule from './pages/CreateSchedule';
import Dashboard from './pages/Dashboard';
import Landing from './pages/Landing';

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
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/create" element={<CreateSchedule />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </main>
    </div>
  );
}
