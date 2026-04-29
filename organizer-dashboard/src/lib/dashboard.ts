// =============================================================================
// Dashboard utility funkce — čistá logika (bez DB, bez React)
// Testovatelné přes Vitest bez závislostí na Next.js
// =============================================================================

import type { PricingPhase, HeatmapCell, ZoneCapacity } from "@/types/dashboard";

// ---------------------------------------------------------------------------
// formatRevenue
// Formátuje číslo jako CZK s mezerami jako oddělovači tisíců
// Příklad: 1234567 → "1 234 567 Kč"
// ---------------------------------------------------------------------------

export function formatRevenue(amount: number): string {
  if (!isFinite(amount)) return "0 Kč";
  const rounded = Math.round(amount);
  // Intl.NumberFormat pro cs-CZ používá mezery jako skupinový oddělovač
  const formatted = new Intl.NumberFormat("cs-CZ", {
    style: "decimal",
    maximumFractionDigits: 0,
  }).format(rounded);
  return `${formatted} Kč`;
}

// ---------------------------------------------------------------------------
// calculateFillPercent
// Vypočítá procento obsazenosti zóny (0–100)
// Edge case: oversold (sold > total) → 100%
// ---------------------------------------------------------------------------

export function calculateFillPercent(
  soldSeats: number,
  totalSeats: number,
  lockedSeats = 0
): number {
  if (totalSeats <= 0) return 0;
  const occupied = soldSeats + lockedSeats;
  // Oversold nebo overlock → cap na 100
  if (occupied >= totalSeats) return 100;
  return Math.round((occupied / totalSeats) * 1000) / 10; // 1 des. místo
}

// ---------------------------------------------------------------------------
// normalizeHeatmapIntensity
// Normalizuje pole HeatmapCell: intensity = salesCount / MAX(salesCount)
// Max cell → 1.0, 0 prodejů → 0.0, proporcionální pro ostatní
// ---------------------------------------------------------------------------

export function normalizeHeatmapIntensity(
  cells: Pick<HeatmapCell, "dayOfWeek" | "hour" | "salesCount">[]
): HeatmapCell[] {
  if (cells.length === 0) return [];

  const maxCount = Math.max(...cells.map((c) => c.salesCount));

  return cells.map((c) => ({
    dayOfWeek: c.dayOfWeek,
    hour: c.hour,
    salesCount: c.salesCount,
    intensity:
      maxCount > 0
        ? Math.round((c.salesCount / maxCount) * 100) / 100
        : 0,
  }));
}

// ---------------------------------------------------------------------------
// getPhaseForTimestamp
// Vrátí prodejní fázi pro daný timestamp na základě pricing rules
// ---------------------------------------------------------------------------

export interface PricingRule {
  phase: PricingPhase;
  thresholdDate: Date | null;
  priority: number;
  active: boolean;
}

export function getPhaseForTimestamp(
  timestamp: Date,
  rules: PricingRule[]
): PricingPhase {
  // Seřaď dle priority (nižší = vyšší priorita)
  const active = rules
    .filter(
      (r) =>
        r.active &&
        (r.thresholdDate === null || r.thresholdDate <= timestamp)
    )
    .sort((a, b) => a.priority - b.priority);

  return active[0]?.phase ?? "regular";
}

// ---------------------------------------------------------------------------
// calculateTrend
// Vrátí procentní změnu (current vs. previous), zaokrouhlenou na 1 des. místo
// Edge cases: previous = 0 → +100% pro current > 0, 0 pro current = 0
// ---------------------------------------------------------------------------

export function calculateTrend(
  current: number,
  previous: number
): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  const change = ((current - previous) / previous) * 100;
  return Math.round(change * 10) / 10; // 1 des. místo
}

// ---------------------------------------------------------------------------
// buildZoneCapacity — helper pro sestavení ZoneCapacity z raw dat
// ---------------------------------------------------------------------------

export function buildZoneCapacity(opts: {
  zone: string;
  section: string | null;
  totalSeats: number;
  soldSeats: number;
  lockedSeats: number;
}): ZoneCapacity {
  const { zone, section, totalSeats, soldSeats, lockedSeats } = opts;
  const fillPercent = calculateFillPercent(soldSeats, totalSeats, lockedSeats);
  const availableSeats = Math.max(0, totalSeats - soldSeats - lockedSeats);

  return {
    zone,
    section,
    totalSeats,
    soldSeats,
    lockedSeats,
    availableSeats,
    fillPercent,
  };
}

// ---------------------------------------------------------------------------
// formatGranularityLabel — formátuje timestamp dle granularity (pro CSV/UI)
// ---------------------------------------------------------------------------

export type Granularity = "hour" | "day" | "week";

export function formatGranularityLabel(
  timestamp: Date,
  granularity: Granularity
): string {
  if (granularity === "hour") {
    return timestamp.toLocaleString("cs-CZ", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (granularity === "week") {
    return timestamp.toLocaleDateString("cs-CZ", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  // day
  return timestamp.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
