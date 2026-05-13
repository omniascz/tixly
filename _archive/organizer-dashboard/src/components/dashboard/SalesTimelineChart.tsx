"use client";

// =============================================================================
// SalesTimelineChart — Recharts AreaChart s fázovým zbarvením
// Granularity switcher + Date range picker
// =============================================================================

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSalesTimeline } from "@/hooks/useDashboard";
import type { SalesByPeriod, TimelineGranularity } from "@/types/dashboard";
import { formatRevenue } from "@/lib/dashboard";

// ---------------------------------------------------------------------------
// Konstanty: barvy per fáze
// ---------------------------------------------------------------------------

const PHASE_COLORS: Record<string, string> = {
  early_bird: "#16a34a", // zelená
  regular:    "#2563eb", // modrá
  late:       "#ea580c", // oranžová
  door:       "#dc2626", // červená
};

const PHASE_LABELS: Record<string, string> = {
  early_bird: "Early Bird",
  regular:    "Regulérní",
  late:       "Late",
  door:       "Door",
};

// ---------------------------------------------------------------------------
// Formátování osy X dle granularity
// ---------------------------------------------------------------------------

function formatXAxis(timestamp: string, granularity: TimelineGranularity): string {
  const d = new Date(timestamp);
  if (granularity === "hour") {
    return d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  if (granularity === "week") {
    return `T${getISOWeek(d)} ${d.getFullYear()}`;
  }
  // day
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "short" });
}

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

interface TooltipPayload {
  payload?: {
    timestamp: string;
    count: number;
    revenue: number;
    phase: string;
  };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
      <p className="font-semibold mb-1">
        {new Date(d.timestamp).toLocaleString("cs-CZ", {
          day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
        })}
      </p>
      <p className="text-muted-foreground">
        Vstupenky: <span className="text-foreground font-medium">{d.count}</span>
      </p>
      <p className="text-muted-foreground">
        Tržby: <span className="text-foreground font-medium">{formatRevenue(d.revenue)}</span>
      </p>
      <p className="text-muted-foreground">
        Fáze:{" "}
        <span
          className="font-medium"
          style={{ color: PHASE_COLORS[d.phase] ?? "#6b7280" }}
        >
          {PHASE_LABELS[d.phase] ?? d.phase}
        </span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function SalesTimelineChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[320px] w-full" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Hlavní komponenta
// ---------------------------------------------------------------------------

interface SalesTimelineChartProps {
  organizerId: string;
  eventId: string;
}

export function SalesTimelineChart({
  organizerId,
  eventId,
}: SalesTimelineChartProps) {
  const [granularity, setGranularity] = useState<TimelineGranularity>("day");

  // Výchozí rozsah: posledních 30 dní
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [from, setFrom] = useState<string>(
    defaultFrom.toISOString().split("T")[0] ?? ""
  );
  const [to, setTo] = useState<string>(
    now.toISOString().split("T")[0] ?? ""
  );

  const { data, isLoading, isError } = useSalesTimeline(
    organizerId,
    eventId,
    granularity,
    from,
    to
  );

  // Transformuj data pro Recharts (timestamp jako string pro XAxis)
  const chartData = (data ?? []).map((p: SalesByPeriod) => ({
    timestamp: p.timestamp instanceof Date ? p.timestamp.toISOString() : String(p.timestamp),
    count: p.count,
    revenue: p.revenue,
    phase: p.phase,
  }));

  // Pro barevné plochy: rozděl data dle fáze do separátních sérií
  // Recharts nemá nativní podmínkové barevné plochy na jeden dataset,
  // takže vykreslujeme jednu Area a doplňujeme barvu dle dominantní fáze
  const dominantPhase =
    chartData.reduce<Record<string, number>>((acc, d) => {
      acc[d.phase] = (acc[d.phase] ?? 0) + d.count;
      return acc;
    }, {});
  const primaryPhase =
    Object.entries(dominantPhase).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "regular";

  // CSV export URL
  const csvParams = new URLSearchParams({
    eventId,
    granularity,
    from,
    to,
    format: "csv",
  });
  const csvUrl = `/api/organizer/${organizerId}/sales-timeline?${csvParams.toString()}`;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Prodeje v čase</CardTitle>

        <div className="flex flex-wrap items-center gap-2">
          {/* Granularity switcher */}
          <div className="inline-flex rounded-md border overflow-hidden">
            {(["hour", "day", "week"] as TimelineGranularity[]).map((g) => (
              <Button
                key={g}
                variant={granularity === g ? "default" : "ghost"}
                size="sm"
                className="rounded-none border-0"
                onClick={() => setGranularity(g)}
              >
                {g === "hour" ? "Hodina" : g === "day" ? "Den" : "Týden"}
              </Button>
            ))}
          </div>

          {/* Date range picker (Shadcn není dostupný přímo — použijeme html input) */}
          <div className="flex items-center gap-1 text-sm">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border rounded px-2 py-1 text-sm bg-background"
              aria-label="Od"
            />
            <span className="text-muted-foreground">–</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded px-2 py-1 text-sm bg-background"
              aria-label="Do"
            />
          </div>

          {/* CSV Export */}
          <Button variant="outline" size="sm" asChild>
            <a href={csvUrl} download>
              Export CSV
            </a>
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive py-8 text-center">
            Nepodařilo se načíst data grafu.
          </p>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Žádná prodejní data pro zvolené období.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={PHASE_COLORS[primaryPhase] ?? "#2563eb"}
                    stopOpacity={0.25}
                  />
                  <stop
                    offset="95%"
                    stopColor={PHASE_COLORS[primaryPhase] ?? "#2563eb"}
                    stopOpacity={0}
                  />
                </linearGradient>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(v: string) => formatXAxis(v, granularity)}
                tick={{ fontSize: 11 }}
                tickLine={false}
              />
              {/* Levá osa: počet */}
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                label={{
                  value: "Vstupenky",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 11 },
                }}
              />
              {/* Pravá osa: tržby */}
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                label={{
                  value: "Tržby (Kč)",
                  angle: 90,
                  position: "insideRight",
                  style: { fontSize: 11 },
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(value: string) =>
                  value === "count" ? "Vstupenky" : "Tržby (Kč)"
                }
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="count"
                stroke={PHASE_COLORS[primaryPhase] ?? "#2563eb"}
                strokeWidth={2}
                fill="url(#colorCount)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="revenue"
                stroke="#7c3aed"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                fill="url(#colorRevenue)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {/* Legenda fází */}
        <div className="flex flex-wrap gap-3 mt-4">
          {Object.entries(PHASE_LABELS).map(([phase, label]) => (
            <span key={phase} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: PHASE_COLORS[phase] }}
              />
              {label}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
