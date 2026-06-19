'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Share2, Clock, BookOpen } from 'lucide-react';

interface CastEntry {
  id: string;
  artistName: string;
  artistId: string | null;
  roleName: string;
  photoUrl: string | null;
  bioShort: string | null;
  orderIndex: number;
}

interface FullProgram {
  id: string;
  title: string | null;
  aboutText: string | null;
  directorNote: string | null;
  dramaturgNote: string | null;
  runningTimeMinutes: number | null;
  intermissions: number;
  language: string;
  contentWarnings: string[];
  programPriceHalire: number;
  coverImageUrl: string | null;
  galleryUrls: string[];
  cast: CastEntry[];
}

interface LockedProgram {
  id: string;
  title: string | null;
  coverImageUrl: string | null;
  programPriceHalire: number;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatDuration(minutes: number, intermissions: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const dur = h > 0 ? `${h} h ${m > 0 ? `${m} min` : ''}`.trim() : `${m} min`;
  if (intermissions === 0) return dur;
  return `${dur} (${intermissions} ${intermissions === 1 ? 'přestávka' : intermissions < 5 ? 'přestávky' : 'přestávek'})`;
}

export default function ProgramPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = String(params.locale);
  const eventId = String(params.eventId);
  const accessToken = searchParams.get('accessToken');

  const [locked, setLocked] = useState<boolean | null>(null);
  const [program, setProgram] = useState<FullProgram | null>(null);
  const [lockedMeta, setLockedMeta] = useState<LockedProgram | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [activeImage, setActiveImage] = useState<string | null>(null);

  useEffect(() => {
    void loadProgram();
  }, [eventId, accessToken]);

  async function loadProgram() {
    const url = new URL(`/api/programs/${eventId}`, window.location.origin);
    if (accessToken) url.searchParams.set('accessToken', accessToken);

    const r = await fetch(url.toString());
    if (r.status === 404) {
      setNotFound(true);
      return;
    }
    const d = (await r.json()) as {
      locked: boolean;
      program: FullProgram | LockedProgram | null;
    };
    if (!d.program) {
      setNotFound(true);
      return;
    }
    setLocked(d.locked);
    if (d.locked) {
      setLockedMeta(d.program as LockedProgram);
    } else {
      setProgram(d.program as FullProgram);
    }
  }

  async function handleShare() {
    const shareData = {
      title: program?.title ?? 'Digitální program',
      url: window.location.href,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // user dismissed
      }
    } else {
      await navigator.clipboard.writeText(window.location.href);
      alert('Odkaz zkopírován do schránky.');
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-semibold">Program není dostupný</h1>
        <p className="text-muted-foreground">Pro tuto akci nebyl vydán digitální program.</p>
      </div>
    );
  }

  if (locked === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-muted-foreground">
        Načítám…
      </div>
    );
  }

  if (locked && lockedMeta) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="overflow-hidden rounded-xl border shadow-sm">
          {lockedMeta.coverImageUrl && (
            <img
              src={lockedMeta.coverImageUrl}
              alt={lockedMeta.title ?? 'Program'}
              className="h-56 w-full object-cover"
            />
          )}
          <div className="p-6 text-center">
            <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h1 className="mb-1 text-xl font-semibold">{lockedMeta.title ?? 'Digitální program'}</h1>
            <p className="mb-4 text-muted-foreground">
              Plný obsah programu je dostupný po zakoupení.
            </p>
            <p className="mb-6 text-3xl font-bold">
              {(lockedMeta.programPriceHalire / 100).toLocaleString('cs-CZ')} Kč
            </p>
            <Link
              href={`/${locale}/checkout?eventId=${eventId}&addProgram=true`}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Koupit digitální program
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!program) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {program.coverImageUrl && (
        <div className="mb-8 overflow-hidden rounded-xl">
          <img
            src={program.coverImageUrl}
            alt={program.title ?? 'Program'}
            className="h-64 w-full object-cover"
          />
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{program.title ?? 'Digitální program'}</h1>
          {program.runningTimeMinutes != null && (
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {formatDuration(program.runningTimeMinutes, program.intermissions)}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleShare}>
          <Share2 className="h-4 w-4" /> Sdílet
        </Button>
      </div>

      {program.contentWarnings.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {program.contentWarnings.map((w) => (
            <span
              key={w}
              className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800"
            >
              ⚠ {w}
            </span>
          ))}
        </div>
      )}

      {program.aboutText && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">O hře</h2>
          <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
            {program.aboutText}
          </p>
        </section>
      )}

      {program.cast.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">Obsazení</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {program.cast.map((c) => (
              <div key={c.id} className="rounded-lg border p-3 text-center">
                {c.photoUrl ? (
                  <img
                    src={c.photoUrl}
                    alt={c.artistName}
                    className="mx-auto mb-2 h-16 w-16 rounded-full object-cover"
                    onError={(e) => {
                      const el = e.target as HTMLImageElement;
                      el.style.display = 'none';
                      el.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                ) : null}
                <div
                  className={`mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary ${c.photoUrl ? 'hidden' : ''}`}
                >
                  {initials(c.artistName)}
                </div>
                <p className="text-sm font-medium leading-tight">{c.artistName}</p>
                <p className="text-xs text-muted-foreground">{c.roleName}</p>
                {c.bioShort && (
                  <p className="mt-1 text-xs text-muted-foreground">{c.bioShort}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {program.directorNote && (
        <section className="mb-8 rounded-lg border-l-4 border-primary/40 bg-muted/30 p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Slovo režiséra
          </h2>
          <p className="whitespace-pre-wrap italic leading-relaxed">{program.directorNote}</p>
        </section>
      )}

      {program.dramaturgNote && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Dramaturgická poznámka</h2>
          <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
            {program.dramaturgNote}
          </p>
        </section>
      )}

      {program.galleryUrls.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">Galerie</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {program.galleryUrls.map((u, i) => (
              <button
                key={i}
                type="button"
                className="overflow-hidden rounded-lg"
                onClick={() => setActiveImage(u)}
              >
                <img
                  src={u}
                  alt=""
                  className="h-36 w-full object-cover transition-transform hover:scale-105"
                />
              </button>
            ))}
          </div>
        </section>
      )}

      {activeImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setActiveImage(null)}
        >
          <img
            src={activeImage}
            alt=""
            className="max-h-[90vh] max-w-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/30"
            onClick={() => setActiveImage(null)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
