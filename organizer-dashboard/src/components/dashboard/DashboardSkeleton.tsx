"use client";

// =============================================================================
// DashboardSkeleton — sdílené skeleton loadery pro všechny sekce dashboardu
// =============================================================================

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// OverviewCards skeleton — 4 šedé obdélníky
// ---------------------------------------------------------------------------

export function OverviewCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-4 rounded" />
            </div>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-36 mb-2" />
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-3 w-28" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart skeleton — animovaný placeholder pro graf
// ---------------------------------------------------------------------------

export function ChartSkeleton({ height = 320 }: { height?: number }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="relative w-full rounded-lg overflow-hidden bg-muted/30"
          style={{ height }}
        >
          {/* Simulované pruhy grafu */}
          <div className="absolute inset-0 flex items-end gap-1 px-4 pb-4">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-muted animate-pulse rounded-t-sm"
                style={{
                  height: `${20 + Math.sin(i * 0.5) * 30 + Math.random() * 40}%`,
                  animationDelay: `${i * 50}ms`,
                }}
              />
            ))}
          </div>
          {/* X osa */}
          <div className="absolute bottom-0 left-0 right-0 h-4 bg-muted/50" />
          {/* Y osa */}
          <div className="absolute top-0 left-0 bottom-4 w-8 bg-muted/50" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Heatmap skeleton — grid placeholder
// ---------------------------------------------------------------------------

export function HeatmapSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3 w-56 mt-1" />
      </CardHeader>
      <CardContent>
        <div
          className="grid gap-0.5"
          style={{ gridTemplateColumns: "2rem repeat(7, minmax(0, 1fr))" }}
        >
          {/* Header row */}
          <div />
          {Array.from({ length: 7 }).map((_, d) => (
            <Skeleton key={d} className="h-5" />
          ))}

          {/* 24 rows */}
          {Array.from({ length: 24 }).map((_, hour) => (
            <>
              <Skeleton key={`h-${hour}`} className="h-5 w-7" />
              {Array.from({ length: 7 }).map((__, d) => (
                <Skeleton
                  key={`${d}-${hour}`}
                  className="rounded-sm"
                  style={{
                    aspectRatio: "1",
                    animationDelay: `${(hour * 7 + d) * 10}ms`,
                  }}
                />
              ))}
            </>
          ))}
        </div>

        {/* Legenda */}
        <div className="flex items-center gap-2 mt-4">
          <Skeleton className="h-3 w-10" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-5 rounded-sm" />
          ))}
          <Skeleton className="h-3 w-10" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ZoneCapacity skeleton
// ---------------------------------------------------------------------------

export function ZoneCapacitySkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="flex justify-between">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-6 w-12" />
              </div>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full rounded-full mb-3" />
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((__, j) => (
                  <div key={j} className="text-center">
                    <Skeleton className="h-3 w-12 mx-auto mb-1" />
                    <Skeleton className="h-5 w-8 mx-auto" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResalePanel skeleton
// ---------------------------------------------------------------------------

export function ResalePanelSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-3">
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-px w-full" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-6 w-10 rounded-full" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
          <Skeleton className="h-8 w-32" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Full-page dashboard skeleton (kombinovaný)
// ---------------------------------------------------------------------------

export function DashboardPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Event selector skeleton */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Overview karty */}
      <OverviewCardsSkeleton />

      {/* Timeline graf */}
      <ChartSkeleton />

      {/* Spodní řada */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <ZoneCapacitySkeleton />
        </div>
        <div className="lg:col-span-1">
          <HeatmapSkeleton />
        </div>
        <div className="lg:col-span-1">
          <ResalePanelSkeleton />
        </div>
      </div>
    </div>
  );
}
