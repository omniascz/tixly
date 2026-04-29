"use client";

// =============================================================================
// SalesOverviewCards — 4 metrické karty s trendy
// Formát: "125 400 Kč" (mezery jako oddělovač tisíců, CZK)
// =============================================================================

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  TicketIcon,
  ShoppingCart,
  ArrowLeftRight,
  Banknote,
} from "lucide-react";
import { useSalesOverview } from "@/hooks/useDashboard";
import { formatRevenue, calculateTrend } from "@/lib/dashboard";
import type { SalesOverview } from "@/types/dashboard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TrendDirection = "up" | "down" | "neutral";

function TrendBadge({
  percent,
  direction,
}: {
  percent: number;
  direction: TrendDirection;
}) {
  if (direction === "neutral") {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        0 %
      </span>
    );
  }
  const isUp = direction === "up";
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        isUp ? "text-emerald-600" : "text-red-600"
      }`}
    >
      {isUp ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {isUp ? "+" : ""}
      {percent.toFixed(1)} %
    </span>
  );
}

// ---------------------------------------------------------------------------
// Jednotlivá karta
// ---------------------------------------------------------------------------

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trendPercent: number;
  trendDirection: TrendDirection;
  icon: React.ReactNode;
}

function MetricCard({
  title,
  value,
  subtitle,
  trendPercent,
  trendDirection,
  icon,
}: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
        <div className="mt-2">
          <TrendBadge percent={trendPercent} direction={trendDirection} />
          <span className="text-xs text-muted-foreground ml-1">
            vs. předchozích 30 dní
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skeleton verze
// ---------------------------------------------------------------------------

export function SalesOverviewCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-40 mb-2" />
            <Skeleton className="h-3 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hlavní komponenta
// ---------------------------------------------------------------------------

interface SalesOverviewCardsProps {
  organizerId: string;
  eventId?: string;
  /** Celková kapacita pro výpočet % (nepovinné) */
  totalCapacity?: number;
}

export function SalesOverviewCards({
  organizerId,
  eventId,
  totalCapacity,
}: SalesOverviewCardsProps) {
  const { data, isLoading, isError } = useSalesOverview(organizerId, eventId);

  if (isLoading) return <SalesOverviewCardsSkeleton />;

  if (isError || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="col-span-full border-destructive">
          <CardContent className="pt-4 text-sm text-destructive">
            Nepodařilo se načíst přehled prodejů. Zkuste obnovit stránku.
          </CardContent>
        </Card>
      </div>
    );
  }

  const overview: SalesOverview = data;

  // Trendy (vs. předchozí perioda)
  const revenueTrend = calculateTrend(
    overview.totalRevenue,
    overview.previousRevenue ?? 0
  );
  const ticketsTrend = calculateTrend(
    overview.totalTicketsSold,
    overview.previousTicketsSold ?? 0
  );

  const soldCapacitySubtitle =
    totalCapacity !== undefined && totalCapacity > 0
      ? `${Math.round((overview.totalTicketsSold / totalCapacity) * 100)} % kapacity`
      : undefined;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Celkové tržby */}
      <MetricCard
        title="Celkové tržby"
        value={formatRevenue(overview.totalRevenue)}
        trendPercent={Math.abs(revenueTrend)}
        trendDirection={
          revenueTrend > 0.5 ? "up" : revenueTrend < -0.5 ? "down" : "neutral"
        }
        icon={<Banknote className="h-4 w-4" />}
      />

      {/* Prodané vstupenky */}
      <MetricCard
        title="Prodané vstupenky"
        value={overview.totalTicketsSold.toLocaleString("cs-CZ")}
        subtitle={soldCapacitySubtitle}
        trendPercent={Math.abs(ticketsTrend)}
        trendDirection={
          ticketsTrend > 0.5 ? "up" : ticketsTrend < -0.5 ? "down" : "neutral"
        }
        icon={<TicketIcon className="h-4 w-4" />}
      />

      {/* Průměrná objednávka */}
      <MetricCard
        title="Prům. hodnota objednávky"
        value={formatRevenue(overview.avgOrderValue)}
        subtitle={`${overview.totalOrders.toLocaleString("cs-CZ")} objednávek`}
        trendPercent={0}
        trendDirection="neutral"
        icon={<ShoppingCart className="h-4 w-4" />}
      />

      {/* Resale objem */}
      <MetricCard
        title="Resale objem"
        value={formatRevenue(overview.resaleVolume)}
        subtitle={`${overview.resaleTicketCount.toLocaleString("cs-CZ")} vstupenek přes resale`}
        trendPercent={0}
        trendDirection="neutral"
        icon={<ArrowLeftRight className="h-4 w-4" />}
      />
    </div>
  );
}
