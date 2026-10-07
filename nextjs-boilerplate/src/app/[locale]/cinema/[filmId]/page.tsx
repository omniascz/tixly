'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Film {
  id: string; title: string; original_title: string | null;
  synopsis: string | null; poster_url: string | null; backdrop_url: string | null;
  trailer_url: string | null; duration_minutes: number; age_rating: string;
  genre: string[]; director: string | null; cast_main: string | null;
  language: string; original_language: string | null; country: string | null;
  release_year: number | null;
}
interface Screening {
  event_id: string; date_start: string; screening_format: string | null;
  screening_language: string | null; slug: string | null;
  screen_name: string | null; screen_type: string | null;
  has_3d: boolean; is_accessible: boolean;
  venue_id: string; venue_name: string; venue_city: string; venue_address: string | null;
  price_from: number | null; remaining_qty: number | null;
}

const AGE_COLOR: Record<string, string> = {
  U:'bg-green-100 text-green-800','7':'bg-blue-100 text-blue-800',
  '12':'bg-yellow-100 text-yellow-800','15':'bg-orange-100 text-orange-800',
  '18':'bg-red-100 text-red-800',X:'bg-slate-900 text-white',
};
const FORMAT_LABEL: Record<string, string> = {
  '2d':'2D','3d':'3D','imax':'IMAX','4dx':'4DX',
  'dubbed':'Dabing','subtitled':'Titulky','original':'Originál',
  'dubbed_3d':'Dabing 3D','subtitled_3d':'Titulky 3D',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
}
function formatDayShort(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function FilmDetailPage(): JSX.Element {
  const { filmId, locale } = useParams<{ filmId: string; locale: string }>();
  const [film, setFilm] = useState<Film | null>(null);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [byDate, setByDate] = useState<Record<string, Screening[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>('');

  useEffect(() => {
    fetch(`/api/cinema/films/${filmId}`)
      .then((r) => r.json())
      .then((d) => {
        const data = d as { film: Film; screenings: Screening[]; screenings_by_date: Record<string, Screening[]> };
        setFilm(data.film);
        setScreenings(data.screenings);
        setByDate(data.screenings_by_date);
        const firstDate = Object.keys(data.screenings_by_date)[0];
        if (firstDate) setSelectedDate(firstDate);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filmId]);

  const dates = Object.keys(byDate).sort();
  const selectedScreenings = selectedDate ? (byDate[selectedDate] ?? []) : screenings;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 animate-pulse">
        <div className="h-8 bg-slate-100 rounded w-1/3 mb-6" />
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="aspect-[2/3] bg-slate-100 rounded-xl" />
          <div className="lg:col-span-2 space-y-4">
            <div className="h-6 bg-slate-100 rounded w-2/3" />
            <div className="h-4 bg-slate-100 rounded w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!film) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-4">🎬</div>
        <p className="text-slate-500">Film nebyl nalezen.</p>
        <Link href={`/${locale}/cinema`} className="mt-4 inline-block text-indigo-700 hover:underline">← Zpět na Co hraje</Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <Link href={`/${locale}/cinema`} className="text-sm text-indigo-700 hover:underline">← Co hraje</Link>

      {/* Hero section */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Poster */}
        <div className="space-y-3">
          <div className="aspect-[2/3] rounded-xl overflow-hidden bg-slate-100 border relative">
            {film.poster_url ? (
              <img src={film.poster_url} alt={film.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-5xl">🎬</div>
            )}
            <div className={`absolute top-3 left-3 text-xs px-2 py-1 rounded font-bold ${AGE_COLOR[film.age_rating] ?? 'bg-slate-100 text-slate-700'}`}>
              {film.age_rating === 'U' ? 'U' : `${film.age_rating}+`}
            </div>
          </div>
          {film.trailer_url && (
            <a href={film.trailer_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 border rounded-xl py-2.5 text-sm text-slate-700 hover:bg-slate-50 font-medium">
              ▶ Přehrát trailer
            </a>
          )}
        </div>

        {/* Info */}
        <div className="lg:col-span-2 space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{film.title}</h1>
            {film.original_title && film.original_title !== film.title && (
              <p className="text-slate-400 mt-0.5">{film.original_title}</p>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <span className="text-sm border rounded-full px-3 py-1 text-slate-600">⏱ {film.duration_minutes} min</span>
            {film.release_year && <span className="text-sm border rounded-full px-3 py-1 text-slate-600">{film.release_year}</span>}
            {film.country && <span className="text-sm border rounded-full px-3 py-1 text-slate-600">{film.country}</span>}
            {film.genre.map((g) => (
              <span key={g} className="text-sm bg-slate-100 text-slate-700 rounded-full px-3 py-1">{g}</span>
            ))}
          </div>

          {film.synopsis && <p className="text-slate-600 leading-relaxed">{film.synopsis}</p>}

          <div className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
            {film.director && (
              <><span className="text-slate-400">Režisér</span><span className="text-slate-800">{film.director}</span></>
            )}
            {film.cast_main && (
              <><span className="text-slate-400">Hrají</span><span className="text-slate-800">{film.cast_main}</span></>
            )}
            {film.language && (
              <><span className="text-slate-400">Jazyk</span><span className="text-slate-800 uppercase">{film.language}</span></>
            )}
            {film.original_language && film.original_language !== film.language && (
              <><span className="text-slate-400">Orig. jazyk</span><span className="text-slate-800 uppercase">{film.original_language}</span></>
            )}
          </div>
        </div>
      </div>

      {/* Screenings */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-4">
          Vstupenky · {screenings.length} promítání
        </h2>

        {screenings.length === 0 ? (
          <div className="text-center py-12 border rounded-xl text-slate-400">
            <div className="text-3xl mb-2">📅</div>
            <p>Momentálně žádná dostupná promítání.</p>
          </div>
        ) : (
          <>
            {/* Date tabs */}
            {dates.length > 1 && (
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                <button
                  onClick={() => setSelectedDate('')}
                  className={`text-sm px-3 py-1.5 rounded-lg whitespace-nowrap border transition-colors ${
                    selectedDate === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 hover:border-slate-400'
                  }`}
                >
                  Vše
                </button>
                {dates.map((date) => (
                  <button
                    key={date}
                    onClick={() => setSelectedDate(date)}
                    className={`text-sm px-3 py-1.5 rounded-lg whitespace-nowrap border transition-colors ${
                      selectedDate === date ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {formatDayShort(date)}
                  </button>
                ))}
              </div>
            )}

            {/* Grouped by date */}
            {selectedDate ? (
              <ScreeningGroup date={selectedDate} screenings={selectedScreenings} locale={locale} />
            ) : (
              dates.map((date) => (
                <ScreeningGroup key={date} date={date} screenings={byDate[date] ?? []} locale={locale} />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ScreeningGroup({
  date, screenings, locale,
}: {
  date: string;
  screenings: Screening[];
  locale: string;
}): JSX.Element {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
        {formatDay(date)}
      </h3>
      <div className="space-y-2">
        {screenings.map((s) => (
          <Link
            key={s.event_id}
            href={s.slug ? `/${locale}/events/${s.slug}` : `/${locale}/events/${s.event_id}`}
            className="flex items-center gap-4 bg-white border rounded-xl px-4 py-3.5 hover:border-indigo-400 hover:shadow-sm transition-all"
          >
            {/* Time */}
            <div className="text-xl font-bold text-slate-900 w-14 flex-shrink-0">
              {formatTime(s.date_start)}
            </div>

            {/* Format badges */}
            <div className="flex gap-1.5 flex-wrap flex-1">
              {s.screening_format && (
                <span className={`text-xs px-2 py-1 rounded font-medium ${
                  s.screening_format === 'imax' ? 'bg-blue-900 text-white' :
                  s.screening_format.includes('3d') ? 'bg-slate-800 text-white' :
                  'bg-slate-100 text-slate-700'
                }`}>
                  {FORMAT_LABEL[s.screening_format] ?? s.screening_format}
                </span>
              )}
              {s.is_accessible && (
                <span className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-800">♿</span>
              )}
              <div className="text-xs text-slate-400">
                {s.venue_name}
                {s.screen_name && ` · ${s.screen_name}`}
                {s.venue_city && ` · ${s.venue_city}`}
              </div>
            </div>

            {/* Price + CTA */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {s.price_from != null && (
                <div className="text-right">
                  <div className="text-xs text-slate-400">od</div>
                  <div className="font-semibold text-slate-900">
                    {(s.price_from / 100).toFixed(0)} Kč
                  </div>
                </div>
              )}
              {s.remaining_qty != null && s.remaining_qty <= 20 && s.remaining_qty > 0 && (
                <span className="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded">
                  Zbývá {s.remaining_qty}
                </span>
              )}
              {s.remaining_qty === 0 && (
                <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded">Vyprodáno</span>
              )}
              <div className="text-indigo-700 font-medium text-sm">
                {s.remaining_qty === 0 ? '' : 'Koupit →'}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
