import { useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import type { ScheduleRecord } from '../hooks/useSchedules';
import { theme } from '../lib/theme';
import { unlockTimestamps, vestedAmount } from '../lib/vesting';

export interface VestingTimelineProps {
  schedule: ScheduleRecord;
}

/** Fixed width used until the container is measured (jsdom / no observer). */
const FALLBACK_WIDTH = 640;

interface Marker {
  at: bigint;
  label: string;
}

/** ISO date (UTC) for an axis tick — deterministic across machines. */
function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** Compact token amounts for the value axis (0 → 12.5k, 900 → 900). */
const compactAxis = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

/**
 * Vesting timeline (T042, FR-020): marks start, cliff, every interior
 * 90-day unlock and end, draws the vested step-line (one point per milestone,
 * values from the vesting math — never the browser clock) and marks the
 * cumulative claimed amount.
 *
 * A cliff landing exactly on an unlock shares one merged marker
 * ("Cliff + Unlock"); the final unlock coincides with end and is labelled
 * "End" only, so markers never overlap.
 */
export function VestingTimeline({ schedule }: VestingTimelineProps) {
  const { start, cliffDuration, duration, totalAmount, released, tokenDecimals } = schedule;
  const end = start + duration;
  const cliffAt = start + cliffDuration;
  const toTokens = (base: bigint): number => Number(formatUnits(base, tokenDecimals));

  // --- responsive width (T056): measure the container, no h-scroll ---------
  // The chart fills its card at any viewport (375px and up). jsdom and
  // browsers without ResizeObserver keep the fixed fallback.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measured = element.clientWidth;
    if (measured > 0) setWidth(Math.round(measured));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setWidth(Math.round(next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // --- milestone markers (deduped by timestamp, labels merged) -------------
  const markers: Marker[] = [];
  const addMarker = (at: bigint, label: string): void => {
    const existing = markers.find((marker) => marker.at === at);
    if (existing) {
      existing.label = `${existing.label} + ${label}`;
    } else {
      markers.push({ at, label });
    }
  };

  addMarker(start, 'Start');
  addMarker(cliffAt, 'Cliff');
  for (const unlock of unlockTimestamps(schedule)) {
    if (unlock === end) continue; // the final unlock IS the end marker
    addMarker(unlock, 'Unlock');
  }
  addMarker(end, 'End');

  // --- step-line points: vested at each milestone timestamp ----------------
  const stamps = Array.from(
    new Set([start, cliffAt, ...unlockTimestamps(schedule), end].map((t) => t.toString())),
  )
    .map((t) => BigInt(t))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const points = stamps.map((t) => ({
    t: Number(t),
    vested: toTokens(vestedAmount(schedule, t)),
  }));

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Vesting timeline"
      className="w-full overflow-x-auto"
    >
      <LineChart
        width={width}
        height={280}
        data={points}
        margin={{ top: 24, right: 24, bottom: 8, left: 8 }}
      >
        <XAxis
          dataKey="t"
          type="number"
          domain={[Number(start), Number(end)]}
          tickFormatter={(value: number) => formatDate(value)}
          tick={{ fill: theme.colors.ink, fontSize: 11 }}
          stroke={theme.colors.ink}
        />
        <YAxis
          domain={[0, toTokens(totalAmount)]}
          tickFormatter={(value: number) => compactAxis.format(value)}
          tick={{ fill: theme.colors.ink, fontSize: 11 }}
          stroke={theme.colors.ink}
          width={64}
        />
        {markers.map((marker) => (
          <ReferenceLine
            key={marker.at.toString()}
            x={Number(marker.at)}
            stroke={theme.colors.ink}
            strokeOpacity={0.35}
            strokeDasharray="4 4"
            label={{ value: marker.label, position: 'top' }}
          />
        ))}
        <ReferenceLine
          y={toTokens(released)}
          stroke={theme.colors.coral}
          strokeDasharray="6 4"
          label={{ value: 'Claimed', position: 'top' }}
        />
        <Line
          type="stepAfter"
          dataKey="vested"
          stroke={theme.colors.ink}
          strokeWidth={2.5}
          dot={{ r: 3, fill: theme.colors.coral, stroke: theme.colors.ink, strokeWidth: 1 }}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}
