"use client";

// =============================================================================
// ResalePanel — statistiky resale + nastavení (toggle + provize)
// Optimistic update při PATCH, warning pro aktivní listings
// =============================================================================

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import {
  useResaleStats,
  useResaleSettings,
  usePatchResaleSettings,
} from "@/hooks/useDashboard";
import { formatRevenue } from "@/lib/dashboard";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function ResalePanelSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-32" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-24 w-full" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stat item helper
// ---------------------------------------------------------------------------

function StatItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "bg-muted/50" : ""}`}>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="font-semibold text-sm tabular-nums">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hlavní komponenta
// ---------------------------------------------------------------------------

interface ResalePanelProps {
  organizerId: string;
  eventId: string;
}

export function ResalePanel({ organizerId, eventId }: ResalePanelProps) {
  // ---- Data ----------------------------------------------------------------
  const {
    data: stats,
    isLoading: statsLoading,
  } = useResaleStats(organizerId, eventId);

  const {
    data: settings,
    isLoading: settingsLoading,
  } = useResaleSettings(organizerId, eventId);

  const patch = usePatchResaleSettings(organizerId, eventId);

  // ---- Lokální stav formuláře (pro unsaved changes) ------------------------
  const [localResaleAllowed, setLocalResaleAllowed] = useState<boolean>(true);
  const [localCommissionRate, setLocalCommissionRate] = useState<number>(0);
  const [saved, setSaved] = useState(false);

  // Sync při načtení settings
  useEffect(() => {
    if (settings) {
      setLocalResaleAllowed(settings.resaleAllowed);
      setLocalCommissionRate(settings.resaleCommissionRate);
    }
  }, [settings]);

  // Detekce dirty stavu
  const isDirty =
    settings &&
    (localResaleAllowed !== settings.resaleAllowed ||
      localCommissionRate !== settings.resaleCommissionRate);

  // Varování: chce zakázat resale ale jsou aktivní listings
  const showActiveListingsWarning =
    !localResaleAllowed &&
    settings?.resaleAllowed === true &&
    (settings?.activeListingsCount ?? 0) > 0;

  // ---- Save handler --------------------------------------------------------
  function handleSave() {
    patch.mutate(
      {
        resaleAllowed: localResaleAllowed,
        commissionRate: localCommissionRate,
      },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  }

  if (statsLoading || settingsLoading) return <ResalePanelSkeleton />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resale marketplace</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* === Statistiky === */}
        {stats ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatItem
              label="Celkem inzerátů"
              value={stats.totalListings.toLocaleString("cs-CZ")}
            />
            <StatItem
              label="Aktivní"
              value={stats.activeListings.toLocaleString("cs-CZ")}
              highlight={stats.activeListings > 0}
            />
            <StatItem
              label="Prodané"
              value={stats.soldListings.toLocaleString("cs-CZ")}
            />
            <StatItem
              label="Prům. sleva"
              value={`${(stats.avgDiscount * 100).toFixed(1)} %`}
            />
            <StatItem
              label="Resale revenue"
              value={formatRevenue(stats.resaleRevenue)}
            />
            <StatItem
              label="Provize platformy"
              value={formatRevenue(stats.platformCommission)}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Žádná resale data k zobrazení.
          </p>
        )}

        <Separator />

        {/* === Nastavení === */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium">Nastavení resale pro tuto akci</h4>

          {/* Toggle resale */}
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="resale-toggle" className="text-sm cursor-pointer">
              Povolit resale marketplace pro tuto akci
            </Label>
            <Switch
              id="resale-toggle"
              checked={localResaleAllowed}
              onCheckedChange={setLocalResaleAllowed}
              disabled={patch.isPending}
            />
          </div>

          {/* Warning: aktivní listings */}
          {showActiveListingsWarning && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Existuje <strong>{settings?.activeListingsCount}</strong> aktivních
                inzerátů. Nelze zakázat resale, dokud jsou aktivní. Nejprve počkejte
                na jejich expiraci nebo je zrušte.
              </AlertDescription>
            </Alert>
          )}

          {/* Provize slider / input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="commission-input" className="text-sm">
                Provize platformy
              </Label>
              <span className="text-sm font-medium tabular-nums">
                {localCommissionRate.toFixed(1)} %
              </span>
            </div>
            <input
              id="commission-input"
              type="range"
              min={0}
              max={5}
              step={0.5}
              value={localCommissionRate}
              onChange={(e) => setLocalCommissionRate(parseFloat(e.target.value))}
              disabled={patch.isPending}
              className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
              aria-label="Provize platformy 0–5 %"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0 %</span>
              <span>5 %</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Povolený rozsah: 0–5 %. Aktuálně nastaveno:{" "}
              <strong>{localCommissionRate.toFixed(1)} %</strong>.
            </p>
          </div>

          {/* Chybová zpráva z PATCH */}
          {patch.isError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {patch.error?.message ?? "Uložení se nezdařilo. Zkuste to znovu."}
              </AlertDescription>
            </Alert>
          )}

          {/* Save button */}
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSave}
              disabled={
                patch.isPending ||
                !isDirty ||
                Boolean(showActiveListingsWarning)
              }
              size="sm"
            >
              {patch.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Ukládám...
                </>
              ) : saved ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Uloženo
                </>
              ) : (
                "Uložit nastavení"
              )}
            </Button>
            {isDirty && !patch.isPending && (
              <span className="text-xs text-muted-foreground">
                Máte neuložené změny
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
