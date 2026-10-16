'use client';

/**
 * /platform/venues/[id]/seating-chart/view-photos
 *
 * Platform admin spravuje fotky z pohledu ze sedadla per sektor.
 * Fotky jsou venue-level — sdílí se přes všechny eventy v daném sálu.
 */

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Photo {
  id: string;
  sector_name: string;
  photo_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  sort_order: number;
  is_360: boolean;
  embed_url: string | null;
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

export default function SeatViewPhotosPage(_props: { params: Promise<{ id: string }> }) {
  const params = useParams<{ id: string }>();
  const venueId = params.id;

  const [sectors, setSectors] = useState<string[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Stav per-sektor formuláře: sectorName → { url, caption, is360, embedUrl }
  const [form, setForm] = useState<Record<string, { url: string; caption: string; is360: boolean; embedUrl: string }>>({});

  useEffect(() => {
    void (async () => {
      // Načti sektory z aktivního layoutu
      const chartRes = await authFetch(`/api/platform/venues/${venueId}/seating-chart`);
      if (chartRes.ok) {
        const j = (await chartRes.json()) as { chart?: { layout?: ChartLayout } };
        const names = j.chart?.layout?.sectors?.map((s) => s.name) ?? [];
        setSectors(names);
        const init: Record<string, { url: string; caption: string; is360: boolean; embedUrl: string }> = {};
        for (const n of names) init[n] = { url: '', caption: '', is360: false, embedUrl: '' };
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
            next[p.sector_name] = { url: p.photo_url ?? '', caption: p.caption ?? '', is360: p.is_360, embedUrl: p.embed_url ?? '' };
          }
          return next;
        });
      }

      setLoading(false);
    })();
  }, [venueId]);

  function setField(sector: string, field: 'url' | 'caption' | 'embedUrl', value: string) {
    setForm((prev) => ({ ...prev, [sector]: { ...(prev[sector] ?? { url: '', caption: '', is360: false, embedUrl: '' }), [field]: value } }));
  }

  function setIs360(sector: string, value: boolean) {
    setForm((prev) => ({ ...prev, [sector]: { ...(prev[sector] ?? { url: '', caption: '', is360: false, embedUrl: '' }), is360: value } }));
  }

  async function save(sectorName: string) {
    setError(null);
    setFeedback(null);
    const { url, caption, is360, embedUrl } = form[sectorName] ?? { url: '', caption: '', is360: false, embedUrl: '' };
    if (!is360 && !url.trim()) {
      setError(`Sektor „${sectorName}": zadej URL fotky nebo povol 360° a zadej embed URL.`);
      return;
    }
    if (is360 && !embedUrl.trim() && !url.trim()) {
      setError(`Sektor „${sectorName}": pro 360° pohled zadej embed URL nebo photo URL.`);
      return;
    }
    const res = await authFetch(`/api/platform/venues/${venueId}/seat-view-photos`, {
      method: 'POST',
      body: JSON.stringify({ sectorName, photoUrl: url.trim() || null, caption: caption.trim() || null, is360, embedUrl: embedUrl.trim() || null }),
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
    setForm((prev) => ({ ...prev, [photo.sector_name]: { url: '', caption: '', is360: false, embedUrl: '' } }));
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
            const f = form[sectorName] ?? { url: '', caption: '', is360: false, embedUrl: '' };
            return (
              <SectorPhotoCard
                key={sectorName}
                venueId={venueId}
                sectorName={sectorName}
                existingPhoto={existingPhoto ?? null}
                url={f.url}
                caption={f.caption}
                is360={f.is360}
                embedUrl={f.embedUrl}
                onUrlChange={(v) => setField(sectorName, 'url', v)}
                onCaptionChange={(v) => setField(sectorName, 'caption', v)}
                onIs360Change={(v) => setIs360(sectorName, v)}
                onEmbedUrlChange={(v) => setField(sectorName, 'embedUrl', v)}
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
  is360: boolean;
  embedUrl: string;
  onUrlChange: (v: string) => void;
  onCaptionChange: (v: string) => void;
  onIs360Change: (v: boolean) => void;
  onEmbedUrlChange: (v: string) => void;
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
  is360,
  embedUrl,
  onUrlChange,
  onCaptionChange,
  onIs360Change,
  onEmbedUrlChange,
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
          {existingPhoto ? (
            existingPhoto.is_360
              ? <Badge className="bg-indigo-100 text-indigo-800">🔭 360°</Badge>
              : <Badge variant="secondary">Má foto</Badge>
          ) : <Badge variant="outline">Bez foto</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Náhled existující fotky / 360° embed */}
        {existingPhoto ? (
          existingPhoto.is_360 ? (
            <div className="flex h-32 items-center justify-center rounded-md bg-indigo-50 text-xs font-medium text-indigo-800">
              🔭 360° embed nastaven
              {existingPhoto.embed_url ? ` (${existingPhoto.embed_url.slice(0, 30)}…)` : ''}
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={existingPhoto.thumbnail_url ?? existingPhoto.photo_url ?? ''}
              alt={`Pohled ze sektoru ${sectorName}`}
              className="h-32 w-full rounded-md object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )
        ) : (
          <div className="flex h-32 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
            Žádná fotka
          </div>
        )}

        {/* 360° checkbox */}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={is360}
            onChange={(e) => onIs360Change(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          <span className="font-medium">🔭 Je to 360° / VR pohled (zobrazí se jako iframe)</span>
        </label>

        {/* Embed URL (pouze pro 360°) */}
        {is360 ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Embed URL (Matterport, YouTube 360°, Google Photos…)</label>
            <Input
              value={embedUrl}
              onChange={(e) => onEmbedUrlChange(e.target.value)}
              placeholder="https://my.matterport.com/show/?m=…"
              className="text-xs"
            />
            {embedUrl ? (
              <p className="mt-1 text-xs text-blue-700">Náhled: otevře se jako iframe v modalu pro buyer</p>
            ) : null}
          </div>
        ) : null}

        {/* Upload souboru (pouze pro standardní fotku) */}
        {!is360 ? (
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
        ) : null}

        {/* URL paste (pro foto; volitelné i pro 360° jako fallback) */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {is360 ? 'URL náhledového obrázku (volitelné — fallback pro foto)' : 'URL fotky'}
          </label>
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
