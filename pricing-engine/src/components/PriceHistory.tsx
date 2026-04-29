'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts';
import type { PriceHistoryEntry, PricingPhase } from '../types/pricing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PriceHistoryProps {
  ticketTypeId: string;
}

interface ChartDataPoint {
  timestamp: number;
  price: number;
  phase: PricingPhase;
  trigger: string;
  label: string;
}

interface PhaseMarker {
  timestamp: number;
  phase: PricingPhase;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PHASE_COLORS: Record<PricingPhase, string> = {
  early_bird: '#10b981',
  regular: '#3b82f6',
  late: '#f59e0b',
  door: '#ef4444',
};

const PHASE_LABELS: Record<PricingPhase, string> = {
  early_bird: 'Early Bird',
  regular: 'Regular',
  late: 'Late',
  door: 'Na místě',
};

function formatTs(ts: number): string {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(amount);
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as ChartDataPoint | undefined;
  if (point === undefined) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-lg text-sm">
      <p className="font-semibold text-gray-900">{formatCurrency(point.price)}</p>
      <p className="text-gray-500">{PHASE_LABELS[point.phase]}</p>
      <p className="text-gray-400 text-xs mt-1">{formatTs(point.timestamp)}</p>
      {point.trigger !== '' && (
        <p className="text-gray-400 text-xs">{point.trigger}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PriceHistory({ ticketTypeId }: PriceHistoryProps) {
  const [entries, setEntries] = useState<PriceHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const response = await fetch(
          `/api/ticket-types/${ticketTypeId}/price-history`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as PriceHistoryEntry[];
        setEntries(data);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Chyba načítání');
      } finally {
        setIsLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [ticketTypeId]);

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-2xl bg-gray-100 h-64 w-full" />
    );
  }

  if (error !== null) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-500 text-center">
        Žádná historická data pro tuto vstupenku.
      </div>
    );
  }

  // Transform to chart data
  const chartData: ChartDataPoint[] = entries.map((e) => ({
    timestamp: new Date(e.timestamp).getTime(),
    price: e.price,
    phase: e.phase,
    trigger: e.trigger,
    label: formatTs(new Date(e.timestamp).getTime()),
  }));

  // Find phase transition points for reference lines
  const phaseMarkers: PhaseMarker[] = [];
  for (let i = 1; i < chartData.length; i++) {
    const prev = chartData[i - 1];
    const curr = chartData[i];
    if (prev !== undefined && curr !== undefined && prev.phase !== curr.phase) {
      phaseMarkers.push({ timestamp: curr.timestamp, phase: curr.phase });
    }
  }

  const minPrice = Math.min(...chartData.map((d) => d.price));
  const maxPrice = Math.max(...chartData.map((d) => d.price));
  const priceRange = maxPrice - minPrice;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">
        Historie cen
      </h3>

      {/* Phase legend */}
      <div className="mb-4 flex flex-wrap gap-3">
        {(Object.keys(PHASE_LABELS) as PricingPhase[]).map((phase) => (
          <span key={phase} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: PHASE_COLORS[phase] }}
            />
            {PHASE_LABELS[phase]}
          </span>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTs}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
          />
          <YAxis
            domain={[
              Math.max(0, minPrice - priceRange * 0.1),
              maxPrice + priceRange * 0.1,
            ]}
            tickFormatter={(v: number) => `${v} Kč`}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Vertical phase transition markers */}
          {phaseMarkers.map((marker) => (
            <ReferenceLine
              key={`${marker.timestamp}-${marker.phase}`}
              x={marker.timestamp}
              stroke={PHASE_COLORS[marker.phase]}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: PHASE_LABELS[marker.phase],
                position: 'insideTopRight',
                fontSize: 10,
                fill: PHASE_COLORS[marker.phase],
              }}
            />
          ))}

          <Line
            type="monotone"
            dataKey="price"
            stroke="#6366f1"
            strokeWidth={2}
            dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#6366f1' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
