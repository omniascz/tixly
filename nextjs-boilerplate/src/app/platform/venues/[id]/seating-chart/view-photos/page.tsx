'use client';

/**
 * /platform/venues/[id]/seating-chart/view-photos
 *
 * Platform admin spravuje fotky z pohledu ze sedadla per sektor.
 * Fotky jsou venue-level — sdílí se přes všechny eventy v daném sálu.
 */

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Photo {
  id: string;
  sector_name: string;
  photo_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  sort_order: number;
}

interface ChartLayout {
  sectors?: { name: string }[];
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function SeatViewPhotosPage({ params }: { params: { id: string } }) {
  const venueId = params.id;

  const [sectors, setSectors] = useState<string[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Stav per-sektor formuláře: sectorName → { url, caption, busy, uploadBusy }
  const [form, setForm] = useState<Record<string, { url: string; caption: string }>>({});

  useEffect(() => {
    void (async () => {
      // Načti sektory z aktivního layoutu
      const chartRes = await authFetch(`/api/platform/venues/${venueId}/seating-chart`);
      if (chartRes.ok) {
        const j = (await chartRes.json()) as { chart?: { layout?: ChartLayout } };
        const names = j.chart?.layout?.sectors?.map((s) => s.name) ?? [];
        setSectors(names);
        const init: Record<string, { url: string; caption: string }> = {};
        for (const n of names) init[n] = { url: '', caption: '' };
        setForm(init);
      }

      // Načti existující fotky
      const photoRes = await authFetch(`/api/platform/venues/${venueId}/seat-view-photos`);
      if (photoRes.ok) {
        const j = (await photoRes.json()) as { photos: Photo[] };
        setPhotos(j.photos);
        // Předvyplň form z existujících fotek
        setForm((prev) => {
          const next = { ...prev };
          for (const p of j.photos) {
            next[p.sector_name] = { url: p.photo_url, caption: p.caption ?? '' };
          }
          return next;
        });
      }

      setLoading(false);
    })();
  }, [venueId]);

  function setField(sector: string, field: 'url' | 'caption', value: string) {
    setForm((prev) => ({ ...prev, [sector]: { ...(prev[sector] ?? { url: '', caption: '' }), [field]: value } }));
  }

  async function save(sectorName: string) {
    setError(null);
    setFeedback(null);
    const { url, caption } = form[sectorName] ?? { url: '', caption: '' };
    if (!url.trim()) {
      setError(`Sektor „${sectorName}": zadej URL fotky.`);
      return;
    }
    const res = await authFetch(`/api/platform/venues/${venueId}/seat-view-photos`, {
      method: 'POST',
      body: JSON.stringify({ sectorName, photoUrl: url.trim(), caption: caption.trim() || null }),
    });
    const j = (await res.json().catch(() => ({}))) as { photo?: Photo; error?: string };
    if (!res.ok) {
      setError(j.error ?? `Uložení selhalo (HTTP ${res.status})`);
      return;
    }
    if (j.photo) {
      setPhotos((prev) => {
        const idx = prev.findIndex((p) => p.sector_name === sectorName);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = j.photo!;
          return next;
        }
        return [...prev, j.photo!];
      });
    }
    setFeedback(`✓ Sektor „${sectorName}" uložen.`);
  }

  async function remove(photo: Photo) {
    setError(null);
    setFeedback(null);
    const res = await authFetch(`/api/platform/venues/${venueId}/seat-view-photos/${photo.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? 'Smazání selhalo.');
      return;
    }
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    setForm((prev) => ({ ...prev, [photo.sector_name]: { url: '', caption: '' } }));
    setFeedback(`✓ Foto pro „${photo.sector_name}" smazáno.`);
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Načítám…</div>;
  }

  // Sektor list: z layoutu + případné fotky pro sektory co nejsou v layoutu
  const allSectors = [
    ...sectors,
    ...photos.map((p) => p.sector_name).filter((n) => !sectors.includes(n)),
  ];

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/platform/venues/${venueId}/seating-chart`} className="text-sm text-primary hover:underline">
          ← Zpět na plán sálu
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Pohled ze sedadla — správa fotek</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Nahraj jednu reprezentativní fotku na sektor. Buyer ji uvidí při výběru sedadla —
          zlatá hranice kolem sektoru/sedadla indikuje dostupnou fotku. Shift+klik sedadlo otevře náhled.
          Fotky jsou <strong>venue-level</strong> a sdílí se přes všechny eventy v tomto sálu.
        </p>
      </div>

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}
      {feedback ? <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{feedback}</div> : null}

      {allSectors.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Sál nemá žádné sektory. Nejdříve vytvoř plán sálu.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {allSectors.map((sectorName) => {
            const existingPhoto = photos.find((p) => p.sector_name === sectorName);
            const f = form[sectorName] ?? { url: '', caption: '' };
            return (
              <SectorPhotoCard
                key={sectorName}
                venueId={venueId}
                sectorName={sectorName}
                existingPhoto={existingPhoto ?? null}
                url={f.url}
                caption={f.caption}
                onUrlChange={(v) => setField(sectorName, 'url', v)}
                onCaptionChange={(v) => setField(sectorName, 'caption', v)}
                onSave={() => void save(sectorName)}
                onDelete={() => existingPhoto && void remove(existingPhoto)}
                onUploadDone={(url) => setField(sectorName, 'url', url)}
              />
            );
          })}
        </div>
      )}

      <div className="rounded-md border bg-muted/40 p-4 text-xs text-muted-foreground">
        <strong>Jak na to:</strong> Fotku nahraj přímo níže (JPEG/PNG/WebP, max 10 MB) nebo vlož URL z externího CDN
        (Cloudinary, S3, Imgix…). Thumbnail URL je volitelný — použij ho pro optimalizovanou
        miniaturu (200×150 px), jinak se jako thumbnail použije photo_url.
      </div>
    </div>
  );
}

// ── Per-sektor karta ──────────────────────────────────────────────────────────

interface CardProps {
  venueId: string;
  sectorName: string;
  existingPhoto: Photo | null;
  url: string;
  caption: string;
  onUrlChange: (v: string) => void;
  onCaptionChange: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onUploadDone: (url: string) => void;
}

function SectorPhotoCard({
  venueId,
  sectorName,
  existingPhoto,
  url,
  caption,
  onUrlChange,
  onCaptionChange,
  onSave,
  onDelete,
  onUploadDone,
}: CardProps) {
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadError(null);
    setUploadBusy(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/platform/venues/${venueId}/seat-view-photos/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !j.url) {
        setUploadError(j.error ?? `Upload selhal (HTTP ${res.status})`);
        return;
      }
      onUploadDone(j.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload selhal');
    } finally {
      setUploadBusy(false);
    }
  }

  return (
    <Card className={existingPhoto ? 'border-amber-300' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{sectorName}</span>
          {existingPhoto ? <Badge variant="secondary">Má foto</Badge> : <Badge variant="outline">Bez foto</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Náhled existující fotky */}
        {existingPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={existingPhoto.thumbnail_url ?? existingPhoto.photo_url}
            alt={`Pohled ze sektoru ${sectorName}`}
            className="h-32 w-full rounded-md object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="flex h-32 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
            Žádná fotka
          </div>
        )}

        {/* Upload souboru */}
        <div>
          <label className="flex cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed p-2 text-xs text-primary hover:bg-muted/50">
            {uploadBusy ? 'Nahrávám…' : '📁 Nahrát soubor (JPEG/PNG/WebP)'}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={uploadBusy}
              onChange={handleFile}
            />
          </label>
          {uploadError ? <p className="mt-1 text-xs text-rose-700">{uploadError}</p> : null}
        </div>

        {/* URL paste */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">URL fotky</label>
          <Input
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://cdn.example.com/view-a.jpg"
            className="text-xs"
          />
        </div>

        {/* Popisek */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Popisek (volitelný)</label>
          <Input
            value={caption}
            onChange={(e) => onCaptionChange(e.target.value)}
            placeholder="Výborný výhled na celé jeviště"
            className="text-xs"
          />
        </div>

        {/* Tlačítka */}
        <div className="flex gap-2">
          <Button size="sm" onClick={onSave} disabled={uploadBusy} className="flex-1">
            {existingPhoto ? 'Aktualizovat' : 'Uložit fotku'}
          </Button>
          {existingPhoto ? (
            <Button size="sm" variant="destructive" onClick={onDelete} disabled={uploadBusy}>
              Smazat
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
