'use client';

import { useEffect, useMemo, useState } from 'react';
import { Banknote, CalendarClock, PercentCircle, Ticket } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { StatCard } from '@/components/admin/StatCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatCzk, formatCzechDate } from '@/lib/format';

/**
 * Přehled akce.
 *
 * Tahle obrazovka dosud neexistovala — akce měla 76 podstránek a žádnou
 * domovskou. Data bere z /api/admin/events/[id]/live-ops, které už dřív
 * vracelo prodej, tempo odbavení i inventář po typech vstupenek.
 */

interface LiveOps {
  event: { id: string; title: string; dateStart: string | null; currency: string | null };
  sales: { ticketsSold: number; revenueHalire: number; refundedCount: number };
  scanRate: { usedTotal: number };
  inventory: Array<{
    id: string;
    name: string;
    totalQty: number | null;
    remainingQty: number | null;
    soldQty: number | null;
  }>;
}

export default function EventOverviewPage() {
  const params = useParams<{ id: string }>();
  const eventId = params?.id ?? '';

  const [data, setData] = useState<LiveOps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    fetch(`/api/admin/events/${eventId}/live-ops`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Přehled se nepodařilo načíst (HTTP ${res.status}).`);
        return (await res.json()) as LiveOps;
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [eventId]);

  const capacity = useMemo(() => {
    const rows = data?.inventory ?? [];
    const total = rows.reduce((s, r) => s + (r.totalQty ?? 0), 0);
    const sold = rows.reduce((s, r) => s + (r.soldQty ?? 0), 0);
    return { total, sold, free: Math.max(0, total - sold) };
  }, [data]);

  const sellThrough = capacity.total > 0 ? Math.round((capacity.sold / capacity.total) * 100) : null;

  const daysToEvent = useMemo(() => {
    if (!data?.event.dateStart) return null;
    const diff = new Date(data.event.dateStart).getTime() - Date.now();
    return Math.ceil(diff / 86_400_000);
  }, [data]);

  const atp =
    data && data.sales.ticketsSold > 0
      ? Math.round(data.sales.revenueHalire / data.sales.ticketsSold)
      : 0;

  if (loading) {
    return (
      <div>
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <p className="font-medium">{error ?? 'Přehled se nepodařilo načíst.'}</p>
          <p className="mt-1">
            Zkus stránku načíst znovu. Pokud potíž trvá, otevři{' '}
            <Link href={`/admin/events/${eventId}/edit`} className="underline">
              údaje o akci
            </Link>{' '}
            a ověř, že akce existuje.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={data.event.title}
        description={
          data.event.dateStart
            ? `${formatCzechDate(data.event.dateStart)}${
                daysToEvent !== null && daysToEvent >= 0 ? ` · za ${daysToEvent} dní` : ' · proběhlo'
              }`
            : 'Termín zatím není nastavený'
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Prodáno z kapacity"
          value={sellThrough !== null ? `${sellThrough} %` : '—'}
          hint={
            capacity.total > 0
              ? `${capacity.sold} z ${capacity.total} vstupenek`
              : 'Kapacita zatím není nastavená'
          }
          icon={<PercentCircle className="h-4 w-4" />}
        />
        <StatCard
          title="Tržba"
          value={formatCzk(data.sales.revenueHalire)}
          hint={`Průměr ${formatCzk(atp)} na vstupenku`}
          icon={<Banknote className="h-4 w-4" />}
        />
        <StatCard
          title="Vstupenek prodáno"
          value={String(data.sales.ticketsSold)}
          hint={
            data.sales.refundedCount > 0
              ? `${data.sales.refundedCount} vráceno`
              : 'Bez vrácených objednávek'
          }
          icon={<Ticket className="h-4 w-4" />}
        />
        <StatCard
          title={daysToEvent !== null && daysToEvent < 0 ? 'Po akci' : 'Dnů do akce'}
          value={daysToEvent !== null ? String(Math.abs(daysToEvent)) : '—'}
          hint={
            data.scanRate.usedTotal > 0
              ? `${data.scanRate.usedTotal} vstupenek odbaveno`
              : 'Odbavení zatím nezačalo'
          }
          icon={<CalendarClock className="h-4 w-4" />}
        />
      </div>

      {capacity.total > 0 ? (
        <div className="mt-6">
          <div className="mb-2 flex h-7 overflow-hidden rounded-md" aria-hidden>
            <div
              className="flex items-center justify-center bg-primary text-[11px] font-medium text-primary-foreground"
              style={{ width: `${(capacity.sold / capacity.total) * 100}%` }}
            >
              {sellThrough !== null && sellThrough >= 12 ? `${capacity.sold} prodáno` : ''}
            </div>
            <div className="flex flex-1 items-center justify-center bg-secondary text-[11px] text-muted-foreground">
              {capacity.free} volných
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Kapacita {capacity.total} míst · prodáno {capacity.sold} · zbývá {capacity.free}
          </p>
        </div>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Typy vstupenek</CardTitle>
          <CardDescription>Kolik se prodalo z každého typu zvlášť.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.inventory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Akce zatím nemá žádné typy vstupenek.{' '}
              <Link href={`/admin/events/${eventId}/ticket-types`} className="text-primary underline">
                Vytvoř první typ
              </Link>
              .
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2">Typ</th>
                    <th className="text-right">Prodáno</th>
                    <th className="text-right">Kapacita</th>
                    <th className="text-right">Podíl</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inventory.map((row) => {
                    const share =
                      row.totalQty && row.soldQty !== null
                        ? Math.round((row.soldQty / row.totalQty) * 100)
                        : null;
                    return (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="py-2 font-medium">{row.name}</td>
                        <td className="text-right tabular-nums">{row.soldQty ?? '—'}</td>
                        <td className="text-right tabular-nums text-muted-foreground">
                          {row.totalQty ?? 'bez limitu'}
                        </td>
                        <td className="text-right tabular-nums">
                          {share !== null ? `${share} %` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <QuickLink href={`/admin/orders?eventId=${eventId}`} label="Objednávky" hint="Kdo a co koupil" />
        <QuickLink href={`/admin/events/${eventId}/ticket-types`} label="Typy vstupenek" hint="Ceny a kapacita" />
        <QuickLink href={`/admin/events/${eventId}/provoz`} label="Provoz" hint="Vše pro den D" />
        <QuickLink href={`/admin/events/${eventId}/vyuctovani`} label="Vyúčtování" hint="Co akce vydělala" />
      </div>
    </div>
  );
}

function QuickLink({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <Link
      href={href}
      className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
    >
      <div className="font-medium">{label}</div>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </Link>
  );
}
