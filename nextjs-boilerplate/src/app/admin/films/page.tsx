'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Film {
  id: string;
  title: string;
  original_title: string | null;
  poster_url: string | null;
  duration_minutes: number;
  age_rating: string;
  genre: string[];
  director: string | null;
  language: string;
  release_year: number | null;
  status: string;
}

const AGE_COLOR: Record<string, string> = {
  U:   'bg-green-100 text-green-800',
  '7': 'bg-blue-100 text-blue-800',
  '12':'bg-yellow-100 text-yellow-800',
  '15':'bg-orange-100 text-orange-800',
  '18':'bg-red-100 text-red-800',
  X:   'bg-slate-900 text-white',
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
}

export default function FilmsPage(): JSX.Element {
  const [films, setFilms] = useState<Film[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    title: '', original_title: '', duration_minutes: '', age_rating: 'U',
    genre: '', director: '', language: 'cs', release_year: '',
    poster_url: '', synopsis: '',
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const r = await authFetch('/api/admin/films');
    if (r.ok) { const d = await r.json() as { films: Film[] }; setFilms(d.films); }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function createFilm() {
    if (!form.title.trim() || !form.duration_minutes) return;
    setSaving(true);
    const r = await authFetch('/api/admin/films', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        duration_minutes: parseInt(form.duration_minutes),
        release_year: form.release_year ? parseInt(form.release_year) : undefined,
        genre: form.genre ? form.genre.split(',').map((g) => g.trim()).filter(Boolean) : [],
      }),
    });
    if (r.ok) { await load(); setShowNew(false); setForm({ title:'',original_title:'',duration_minutes:'',age_rating:'U',genre:'',director:'',language:'cs',release_year:'',poster_url:'',synopsis:'' }); }
    setSaving(false);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">🎬 Filmový katalog</h1>
          <p className="text-slate-500 text-sm mt-1">Spravujte filmy a vytvářejte promítání (kino vertikál)</p>
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800"
        >
          + Přidat film
        </button>
      </div>

      {/* New film form */}
      {showNew && (
        <div className="bg-slate-50 border rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-slate-900">Nový film</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Název *</label>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Oppenheimer" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Originální název</label>
              <input value={form.original_title} onChange={(e) => setForm((f) => ({ ...f, original_title: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Oppenheimer" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Délka (min) *</label>
              <input type="number" value={form.duration_minutes} onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="180" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Věkové omezení</label>
              <select value={form.age_rating} onChange={(e) => setForm((f) => ({ ...f, age_rating: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {['U','7','12','15','18','X'].map((r) => (
                  <option key={r} value={r}>{r === 'U' ? 'U (bez omezení)' : `${r}+`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Žánry (oddělte čárkou)</label>
              <input value={form.genre} onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Drama, Thriller" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Režisér</label>
              <input value={form.director} onChange={(e) => setForm((f) => ({ ...f, director: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Christopher Nolan" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jazyk verze</label>
              <select value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="cs">Česky (dabing)</option>
                <option value="sk">Slovensky</option>
                <option value="en">Anglicky (originál)</option>
                <option value="de">Německy</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Rok vydání</label>
              <input type="number" value={form.release_year} onChange={(e) => setForm((f) => ({ ...f, release_year: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="2026" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">URL plakátu</label>
              <input value={form.poster_url} onChange={(e) => setForm((f) => ({ ...f, poster_url: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="https://..." />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Synopse</label>
              <textarea value={form.synopsis} onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))}
                rows={3} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void createFilm()} disabled={saving || !form.title || !form.duration_minutes}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Ukládám…' : 'Vytvořit film'}
            </button>
            <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-lg text-sm border text-slate-600">
              Zrušit
            </button>
          </div>
        </div>
      )}

      {/* Film list */}
      {loading ? (
        <p className="text-slate-400 text-sm">Načítám…</p>
      ) : films.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🎬</div>
          <p className="text-slate-500">Zatím žádné filmy. Přidejte první film výše.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {films.map((film) => (
            <Link key={film.id} href={`/admin/films/${film.id}`}
              className="bg-white border rounded-xl p-4 flex items-center gap-4 hover:border-slate-400 transition-colors">
              {/* Poster */}
              <div className="w-14 h-20 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                {film.poster_url ? (
                  <img src={film.poster_url} alt={film.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">🎬</div>
                )}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-900">{film.title}</span>
                  {film.original_title && film.original_title !== film.title && (
                    <span className="text-xs text-slate-400">({film.original_title})</span>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${AGE_COLOR[film.age_rating] ?? 'bg-slate-100 text-slate-600'}`}>
                    {film.age_rating === 'U' ? 'U' : `${film.age_rating}+`}
                  </span>
                  {film.status !== 'active' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                      {film.status}
                    </span>
                  )}
                </div>
                <div className="flex gap-4 mt-1 text-xs text-slate-500 flex-wrap">
                  <span>⏱ {film.duration_minutes} min</span>
                  {film.director && <span>🎥 {film.director}</span>}
                  {film.genre.length > 0 && <span>{film.genre.join(', ')}</span>}
                  {film.release_year && <span>{film.release_year}</span>}
                  <span className="uppercase">{film.language}</span>
                </div>
              </div>
              <div className="text-slate-400 text-sm">→</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
