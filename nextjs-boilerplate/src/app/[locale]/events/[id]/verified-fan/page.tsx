import { Pool } from 'pg';
import { pgPoolOptions } from '@/lib/db/pg-options';
import { notFound } from 'next/navigation';
import { VerifiedFanForm } from './VerifiedFanForm';

interface EventRow {
  id: string;
  title: string;
  date_start: string;
  verified_fan_enabled: boolean;
  verified_fan_presale_starts_at: string | null;
  verified_fan_presale_ends_at: string | null;
  promoter_name: string | null;
  brand_color_hex: string | null;
}

async function fetchEvent(id: string): Promise<EventRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  try {
    const r = await db.query<EventRow>(
      `SELECT e.id, e.title, e.date_start::text,
              e.verified_fan_enabled,
              e.verified_fan_presale_starts_at::text,
              e.verified_fan_presale_ends_at::text,
              p.name AS promoter_name, p.brand_color_hex
         FROM catalog.events e
         LEFT JOIN platform.promoters p ON p.id = e.promoter_id
        WHERE e.id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  } finally {
    await db.end();
  }
}

export const dynamic = 'force-dynamic';

export default async function VerifiedFanRegisterPage(
  props: {
    params: Promise<{ locale: string; id: string }>;
  }
) {
  const params = await props.params;
  const event = await fetchEvent(params.id);
  if (!event) notFound();
  if (!event.verified_fan_enabled) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold">{event.title}</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Tato akce nemá Verified Fan registraci. Vstupenky budou v běžném prodeji.
        </p>
      </div>
    );
  }

  const brand =
    event.brand_color_hex && /^#[0-9a-f]{6}$/i.test(event.brand_color_hex)
      ? event.brand_color_hex
      : '#10b981';

  const presaleStart = event.verified_fan_presale_starts_at
    ? new Date(event.verified_fan_presale_starts_at)
    : null;
  const presaleEnd = event.verified_fan_presale_ends_at
    ? new Date(event.verified_fan_presale_ends_at)
    : null;
  const now = new Date();
  const presaleActive =
    presaleStart && presaleEnd && now >= presaleStart && now <= presaleEnd;
  const registrationClosed = presaleEnd && now > presaleEnd;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <div
        className="rounded-lg p-8 text-white"
        style={{ background: `linear-gradient(135deg, ${brand} 0%, ${brand}dd 100%)` }}
      >
        <p className="text-sm font-medium uppercase tracking-wider opacity-90">
          ⭐ Verified Fan registrace
        </p>
        <h1 className="mt-2 text-3xl font-bold">{event.title}</h1>
        <p className="mt-2 text-sm opacity-90">{event.promoter_name}</p>
      </div>

      <div className="mt-6 rounded-lg border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Jak to funguje</h2>
          <ol className="mt-2 list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>Zaregistruj se jako fanoušek (ověříme, že nejsi bot)</li>
            <li>Vyberemě fanoušky, kteří dostanou unikátní presale kód</li>
            <li>Klíčový pravidlo: <strong>registrace ≠ garance</strong>. Je to filtr proti
                botům a překupníkům, ne fronta s jistotou.</li>
            <li>Pokud budeš vybrán, dostaneš email s kódem před oficiálním onsale</li>
          </ol>
        </div>

        {registrationClosed ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            ⏰ Registrace je už uzavřená. Vstupenky budou v běžném prodeji.
          </div>
        ) : presaleActive ? (
          <VerifiedFanForm eventId={event.id} brandColor={brand} />
        ) : presaleStart ? (
          <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
            Registrace začne {presaleStart.toLocaleString('cs-CZ', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.
          </div>
        ) : (
          <VerifiedFanForm eventId={event.id} brandColor={brand} />
        )}
      </div>

      <p className="mt-4 text-xs text-center text-muted-foreground">
        Pravidla viz <a href="/cs/legal/verified-fan-terms" className="underline">Podmínky Verified Fan programu</a>
      </p>
    </div>
  );
}
