'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Film {
  id: string;
  title: string;
  original_title: string | null;
  poster_url: string | null;
  duration_minutes: number;
  age_rating: string;
  genre: string[];
  director: string | null;
  synopsis: string | null;
  next_screening_at: string;
  screening_count: number;
  cities: string[];
  formats: string[];
}

const AGE_COLOR: Record<string, string> = {
  U:'bg-green-100 text-green-800','7':'bg-blue-100 text-blue-800',
  '12':'bg-yellow-100 text-yellow-800','15':'bg-orange-100 text-orange-800',
  '18':'bg-red-100 text-red-800',X:'bg-slate-900 text-white',
};

export default function CinemaPage(): JSX.Element {
  const { locale } = useParams<{ locale: string }>();
  const [films, setFilms] = useState<Film[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterGenre, setFilterGenre] = useState('');
  const [filterAge, setFilterAge] = useState('');

  useEffect(() => {
    fetch('/api/cinema/now-playing')
      .then((r) => r.json())
      .then((d) => { setFilms((d as { films: Film[] }).films); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const allGenres = [...new Set(films.flatMap((f) => f.genre))].sort();

  const filtered = films.filter((f) => {
    if (filterGenre && !f.genre.includes(filterGenre)) return false;
    if (filterAge && f.age_rating !== filterAge) return false;
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">🎬 Co hraje</h1>
        <p className="text-slate-500 text-sm mt-1">Vyberte film a rezervujte vstupenky online</p>
      </div>

      {/* Filters */}
      {!loading && films.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {allGenres.length > 0 && (
            <select value={filterGenre} onChange={(e) => setFilterGenre(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 bg-white">
              <option value="">Všechny žánry</option>
              {allGenres.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          <select value={filterAge} onChange={(e) => setFilterAge(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 bg-white">
            <option value="">Věkové omezení</option>
            {['U','7','12','15','18'].map((r) => (
              <option key={r} value={r}>{r === 'U' ? 'Pro všechny' : `${r}+`}</option>
            ))}
          </select>
          {(filterGenre || filterAge) && (
            <button onClick={() => { setFilterGenre(''); setFilterAge(''); }}
              className="text-sm text-indigo-700 hover:underline">Zrušit filtry</button>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24">
          <div className="text-5xl mb-4">🎬</div>
          <p className="text-slate-500">Momentálně žádné filmy. Zkuste to znovu brzy.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((film) => (
            <Link key={film.id} href={`/${locale}/cinema/${film.id}`}
              className="group flex flex-col rounded-xl overflow-hidden border hover:border-indigo-300 hover:shadow-lg transition-all">
              {/* Poster */}
              <div className="aspect-[2/3] bg-slate-100 relative overflow-hidden">
                {film.poster_url ? (
                  <img src={film.poster_url} alt={film.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-b from-slate-700 to-slate-900">
                    🎬
                  </div>
                )}
                {/* Age badge overlay */}
                <div className={`absolute top-2 left-2 text-xs px-1.5 py-0.5 rounded font-bold ${AGE_COLOR[film.age_rating] ?? 'bg-slate-100 text-slate-700'}`}>
                  {film.age_rating === 'U' ? 'U' : `${film.age_rating}+`}
                </div>
                {/* 3D/IMAX badge */}
                {film.formats.some((f) => f === 'imax') && (
                  <div className="absolute top-2 right-2 text-xs bg-blue-900 text-white px-1.5 py-0.5 rounded font-bold">IMAX</div>
                )}
                {film.formats.some((f) => f === '3d' || f === '4dx') && !film.formats.some((f) => f === 'imax') && (
                  <div className="absolute top-2 right-2 text-xs bg-slate-800 text-white px-1.5 py-0.5 rounded font-bold">3D</div>
                )}
              </div>
              {/* Info */}
              <div className="p-3 flex-1 flex flex-col">
                <h3 className="font-semibold text-slate-900 text-sm leading-tight mb-1 line-clamp-2">{film.title}</h3>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-auto">
                  <span>⏱ {film.duration_minutes} min</span>
                  {film.genre[0] && <span className="truncate">{film.genre[0]}</span>}
                </div>
                <div className="mt-2 text-xs text-indigo-700 font-medium">
                  {film.screening_count} {film.screening_count === 1 ? 'promítání' : 'promítání'}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
