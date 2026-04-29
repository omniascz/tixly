"use client";

// =============================================================================
// SalesHeatmap — 7 × 24 heatmapa prodejů (den týdne × hodina)
// Barva: bílá (0) → indigo-200 → indigo-500 → indigo-900
// =============================================================================

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSalesHeatmap } from "@/hooks/useDashboard";
import type { HeatmapCell } from "@/types/dashboard";

// ---------------------------------------------------------------------------
// Konstanty
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const DAY_LABELS_FULL = [
  "Neděle",
  "Pondělí",
  "Úterý",
  "Středa",
  "Čtvrtek",
  "Pátek",
  "Sobota",
];

// Indigo palette: intensity 0→1
function intensityToColor(intensity: number): string {
  if (intensity === 0) return "#ffffff";
  if (intensity < 0.2) return "#e0e7ff"; // indigo-100
  if (intensity < 0.4) return "#c7d2fe"; // indigo-200
  if (intensity < 0.6) return "#818cf8"; // indigo-400
  if (intensity < 0.8) return "#4f46e5"; // indigo-600 (≈indigo-500)
  return "#1e1b4b"; // indigo-950 (≈indigo-900)
}

function intensityToTextColor(intensity: number): string {
  return intensity >= 0.6 ? "#ffffff" : "#1e1b4b";
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function SalesHeatmapSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
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

interface SalesHeatmapProps {
  organizerId: string;
  eventId: string;
}

export function SalesHeatmap({ organizerId, eventId }: SalesHeatmapProps) {
  const { data, isLoading, isError } = useSalesHeatmap(organizerId, eventId);

  if (isLoading) return <SalesHeatmapSkeleton />;

  if (isError) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-4 text-sm text-destructive">
          Nepodařilo se načíst heatmapu prodejů.
        </CardContent>
      </Card>
    );
  }

  // Sestavíme mapu [dayOfWeek][hour] → cell
  const cellMap = new Map<string, HeatmapCell>();
  (data ?? []).forEach((cell) => {
    cellMap.set(`${cell.dayOfWeek}-${cell.hour}`, cell);
  });

  const getCell = (day: number, hour: number): HeatmapCell => {
    return (
      cellMap.get(`${day}-${hour}`) ?? {
        dayOfWeek: day,
        hour,
        salesCount: 0,
        intensity: 0,
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Heatmapa prodejů</CardTitle>
        <p className="text-xs text-muted-foreground">Kdy se prodávaly vstupenky (hodina × den)</p>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto">
          <TooltipProvider delayDuration={100}>
            {/* Hlavička: dny týdne */}
            <div
              className="grid gap-0.5"
              style={{
                gridTemplateColumns: `2rem repeat(7, minmax(0, 1fr))`,
              }}
            >
              {/* Prázdný roh */}
              <div />
              {/* Dny */}
              {DAY_LABELS.map((label, dayIndex) => (
                <div
                  key={dayIndex}
                  className="text-center text-xs font-medium text-muted-foreground py-1"
                >
                  {label}
                </div>
              ))}

              {/* Řádky: hodiny 0–23 */}
              {Array.from({ length: 24 }, (_, hour) => (
                <>
                  {/* Popisek hodiny */}
                  <div
                    key={`hour-${hour}`}
                    className="text-right text-xs text-muted-foreground pr-1 flex items-center justify-end"
                    style={{ fontSize: "10px" }}
                  >
                    {`${hour}:00`}
                  </div>

                  {/* 7 buněk pro danou hodinu */}
                  {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                    const cell = getCell(day, hour);
                    const bg = intensityToColor(cell.intensity);
                    const textColor = intensityToTextColor(cell.intensity);
                    const tooltipLabel = `${DAY_LABELS_FULL[day] ?? ""} ${hour}:00 — ${cell.salesCount} prodejů`;

                    return (
                      <Tooltip key={`${day}-${hour}`}>
                        <TooltipTrigger asChild>
                          <div
                            className="rounded-sm transition-transform hover:scale-110 cursor-default"
                            style={{
                              backgroundColor: bg,
                              aspectRatio: "1",
                              minWidth: "1.5rem",
                              minHeight: "1.25rem",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                            role="gridcell"
                            aria-label={tooltipLabel}
                          >
                            {cell.salesCount > 0 && (
                              <span
                                style={{
                                  fontSize: "9px",
                                  color: textColor,
                                  fontWeight: 600,
                                  lineHeight: 1,
                                }}
                              >
                                {cell.salesCount > 99 ? "99+" : cell.salesCount}
                              </span>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          {tooltipLabel}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </>
              ))}
            </div>
          </TooltipProvider>
        </div>

        {/* Legenda */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Méně</span>
          {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((intensity) => (
            <div
              key={intensity}
              className="w-5 h-5 rounded-sm border border-border/40"
              style={{ backgroundColor: intensityToColor(intensity) }}
            />
          ))}
          <span className="text-xs text-muted-foreground">Více</span>
        </div>
      </CardContent>
    </Card>
  );
}
