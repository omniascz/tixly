/**
 * Kolo 8 / krok 1 — program podle měst s filtrem město + měsíc (veřejný web).
 */
import { db } from '@/lib/db/rls-pool';
import { isValidLocale, DEFAULT_LOCALE } from '@/lib/i18n';
import { loadProgram } from '@/lib/theatre/public-program';

export const dynamic = 'force-dynamic';

export default async function ProgramPage({ params, searchParams }: {
  params: { locale: string };
  searchParams: { city?: string; month?: string };
}) {
  const locale = isValidLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const month = searchParams.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month) ? searchParams.month : null;
  const city = searchParams.city?.trim() || null;
  const [filtered, all] = await Promise.all([loadProgram(db(), { city, month }), loadProgram(db(), {})]);
  const cities = all.map((c) => c.city).filter(Boolean);
  const months = [...new Set(all.flatMap((c) => c.events.map((e) => new Date(e.dateStart).toLocaleString('sv-SE', { timeZone: 'Europe/Prague' }).slice(0, 7))))].sort();
  const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleString('cs-CZ', { month: 'long', year: 'numeric' });
  const fmt = (iso: string) => new Date(iso).toLocaleString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' });

  return (
    <div className="space-y-6" data-testid="program-page">
      <h1 className="text-3xl font-bold">Program podle měst</h1>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm">Město
          <select name="city" defaultValue={city ?? ''} className="mt-1 block rounded-md border bg-background p-2" data-testid="program-city">
            <option value="">Všechna města</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm">Měsíc
          <select name="month" defaultValue={month ?? ''} className="mt-1 block rounded-md border bg-background p-2" data-testid="program-month">
            <option value="">Všechny měsíce</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Filtrovat</button>
      </form>

      {filtered.length === 0 ? <p className="text-muted-foreground">Pro zvolený filtr nejsou žádná představení.</p> : filtered.map((c) => (
        <section key={c.city} data-testid="program-city-section">
          <h2 className="mb-2 text-xl font-semibold">{c.city}</h2>
          <ul className="divide-y rounded-lg border">
            {c.events.map((e) => (
              <li key={e.eventId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <div className="font-medium">
                    {e.productionId ? <a className="hover:underline" href={`/${locale}/inscenace/${e.productionId}`}>{e.title}</a> : e.title}
                  </div>
                  <div className="text-sm text-muted-foreground">{fmt(e.dateStart)} · {e.venueName}</div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Obsazeno {e.occupancyPct} %</span>
                  <a className="rounded-md border px-3 py-1.5 font-medium hover:bg-muted" href={`/${locale}/events/${e.slug ?? e.eventId}`}>Vstupenky</a>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
