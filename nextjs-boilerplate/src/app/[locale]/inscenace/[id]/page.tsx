/**
 * Kolo 8 / krok 1 — veřejná stránka inscenace: karta + všechny budoucí termíny (město, sál, datum, obsazenost).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db/rls-pool';
import { isValidLocale, DEFAULT_LOCALE } from '@/lib/i18n';
import { loadPublicProduction } from '@/lib/theatre/public-program';

export const dynamic = 'force-dynamic';

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return loadPublicProduction(db(), id);
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const d = await load(params.id);
  return d ? { title: `${d.production.title} — Tixly`, description: d.production.subtitle ?? d.production.description ?? undefined } : {};
}

export default async function ProductionPage({ params }: { params: { locale: string; id: string } }) {
  const d = await load(params.id);
  if (!d) notFound();
  const locale = isValidLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const p = d.production;
  const fmt = (iso: string) => new Date(iso).toLocaleString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' });

  return (
    <div className="space-y-8" data-testid="production-page">
      <header className="space-y-2">
        {p.genre ? <p className="text-sm uppercase tracking-wide text-muted-foreground">{p.genre}</p> : null}
        <h1 className="text-3xl font-bold">{p.title}</h1>
        {p.subtitle ? <p className="text-lg text-muted-foreground">{p.subtitle}</p> : null}
        <p className="text-sm text-muted-foreground">
          {[p.author ? `Autor: ${p.author}` : null, p.director ? `Režie: ${p.director}` : null,
            p.durationMin ? `Délka ${p.durationMin} min${p.intermissionMin ? ` (přestávka ${p.intermissionMin} min)` : ''}` : null,
            p.ageRating ? `Přístupnost ${p.ageRating}` : null].filter(Boolean).join(' · ')}
        </p>
      </header>

      {p.photos.length > 0 ? (
        <div className="flex gap-3 overflow-x-auto">
          {p.photos.map((src) => <img key={src} src={src} alt={p.title} className="h-48 rounded-md object-cover" />)}
        </div>
      ) : null}

      <section className="grid gap-6 md:grid-cols-3">
        <div className="space-y-3 md:col-span-2">
          {p.description ? <p className="whitespace-pre-line">{p.description}</p> : null}
          {p.videoUrl ? <a className="text-primary underline" href={p.videoUrl} rel="noopener noreferrer" target="_blank">Video k inscenaci</a> : null}
        </div>
        {p.cast.length > 0 ? (
          <div>
            <h2 className="mb-2 font-semibold">Obsazení</h2>
            <ul className="space-y-1 text-sm">
              {p.cast.map((c) => <li key={`${c.role}-${c.name}`}>{c.role ? <span className="text-muted-foreground">{c.role}: </span> : null}{c.name}</li>)}
            </ul>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Termíny</h2>
        {d.terms.length === 0 ? <p className="text-sm text-muted-foreground">Momentálně nejsou vypsané žádné termíny.</p> : (
          <ul className="divide-y rounded-lg border">
            {d.terms.map((t) => (
              <li key={t.eventId} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="production-term">
                <div>
                  <div className="font-medium">{fmt(t.dateStart)}</div>
                  <div className="text-sm text-muted-foreground">{t.city} · {t.venueName}</div>
                  {t.termNote ? <div className="text-sm">{t.termNote}</div> : null}
                  {t.castAlternation ? <div className="text-xs text-muted-foreground">Alternace: {t.castAlternation}</div> : null}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground">Obsazeno {t.occupancyPct} %</span>
                  {t.salesOpen && t.sold < t.capacity ? (
                    <a href={`/${locale}/events/${t.slug ?? t.eventId}`} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Vstupenky</a>
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground">{t.sold >= t.capacity ? 'Vyprodáno' : 'Prodej ukončen'}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
