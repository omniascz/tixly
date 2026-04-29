"use client";

// =============================================================================
// ZoneCapacityGrid — grid karet per zóna s real-time polling 15s
// Progress bar: zelená 0–70%, žlutá 70–90%, červená 90–100%
// Locked seats: šedý segment v progress baru
// =============================================================================

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useZoneCapacity } from "@/hooks/useDashboard";
import type { ZoneCapacity } from "@/types/dashboard";

// ---------------------------------------------------------------------------
// Barva fill baru dle obsazenosti
// ---------------------------------------------------------------------------

function getFillColor(fillPercent: number): string {
  if (fillPercent >= 90) return "bg-red-500";
  if (fillPercent >= 70) return "bg-amber-400";
  return "bg-emerald-500";
}

function getFillBgColor(fillPercent: number): string {
  if (fillPercent >= 90) return "bg-red-100";
  if (fillPercent >= 70) return "bg-amber-100";
  return "bg-emerald-100";
}

// ---------------------------------------------------------------------------
// Jedna karta zóny
// ---------------------------------------------------------------------------

function ZoneCard({ zone }: { zone: ZoneCapacity }) {
  const soldPercent = zone.totalSeats > 0
    ? (zone.soldSeats / zone.totalSeats) * 100
    : 0;
  const lockedPercent = zone.totalSeats > 0
    ? (zone.lockedSeats / zone.totalSeats) * 100
    : 0;

  const fillColor = getFillColor(zone.fillPercent);
  const fillBg = getFillBgColor(zone.fillPercent);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">{zone.zone}</CardTitle>
            {zone.section && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Sekce: {zone.section}
              </p>
            )}
          </div>
          <span
            className={`text-lg font-bold tabular-nums ${
              zone.fillPercent >= 90
                ? "text-red-600"
                : zone.fillPercent >= 70
                ? "text-amber-600"
                : "text-emerald-600"
            }`}
          >
            {zone.fillPercent.toFixed(1)} %
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {/* Kombinovaný progress bar: sold + locked */}
        <div
          className={`relative h-4 rounded-full overflow-hidden ${fillBg}`}
          role="progressbar"
          aria-valuenow={zone.fillPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Obsazenost zóny ${zone.zone}: ${zone.fillPercent.toFixed(1)}%`}
        >
          {/* Sold segment */}
          <div
            className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ${fillColor}`}
            style={{ width: `${Math.min(soldPercent, 100)}%` }}
          />
          {/* Locked segment (šedý, hned za sold) */}
          {lockedPercent > 0 && (
            <div
              className="absolute top-0 h-full bg-gray-400 opacity-60"
              style={{
                left: `${Math.min(soldPercent, 100)}%`,
                width: `${Math.min(lockedPercent, 100 - soldPercent)}%`,
              }}
            />
          )}
        </div>

        {/* Číselné statistiky */}
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Prodáno</p>
            <p className="font-semibold text-sm tabular-nums">
              {zone.soldSeats.toLocaleString("cs-CZ")}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Zamčeno</p>
            <p className="font-semibold text-sm tabular-nums text-gray-500">
              {zone.lockedSeats.toLocaleString("cs-CZ")}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Volno</p>
            <p
              className={`font-semibold text-sm tabular-nums ${
                zone.availableSeats === 0 ? "text-red-600" : "text-emerald-600"
              }`}
            >
              {zone.availableSeats.toLocaleString("cs-CZ")}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-1">
          Celkem: {zone.totalSeats.toLocaleString("cs-CZ")} míst
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function ZoneCapacityGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-full rounded-full mb-3" />
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((__, j) => (
                <Skeleton key={j} className="h-8" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hlavní komponenta
// ---------------------------------------------------------------------------

interface ZoneCapacityGridProps {
  organizerId: string;
  eventId: string;
}

export function ZoneCapacityGrid({
  organizerId,
  eventId,
}: ZoneCapacityGridProps) {
  const { data, isLoading, isError, dataUpdatedAt } = useZoneCapacity(
    organizerId,
    eventId
  );

  if (isLoading) return <ZoneCapacityGridSkeleton />;

  if (isError) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-4 text-sm text-destructive">
          Nepodařilo se načíst kapacity zón.
        </CardContent>
      </Card>
    );
  }

  const zones = data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Kapacita zón</h3>
        {dataUpdatedAt > 0 && (
          <p className="text-xs text-muted-foreground">
            Aktualizováno:{" "}
            {new Date(dataUpdatedAt).toLocaleTimeString("cs-CZ", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </p>
        )}
      </div>

      {zones.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Žádná data kapacity k zobrazení.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {zones.map((zone) => (
            <ZoneCard
              key={`${zone.zone}-${zone.section ?? "none"}`}
              zone={zone}
            />
          ))}
        </div>
      )}

      {/* Legenda */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" />
          0–70 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-amber-400" />
          70–90 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-500" />
          90–100 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-gray-400 opacity-60" />
          Zamčeno
        </span>
      </div>
    </div>
  );
}
