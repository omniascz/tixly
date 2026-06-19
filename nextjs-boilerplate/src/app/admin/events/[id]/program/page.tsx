'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2, Save, Eye, EyeOff } from 'lucide-react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface CastEntry {
  id?: string;
  artistName: string;
  roleName: string;
  artistId?: string;
  photoUrl?: string;
  bioShort?: string;
  orderIndex: number;
}

interface ProgramData {
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
  isPublished: boolean;
  cast: CastEntry[];
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function EventProgramPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [title, setTitle] = useState('');
  const [aboutText, setAboutText] = useState('');
  const [directorNote, setDirectorNote] = useState('');
  const [dramaturgNote, setDramaturgNote] = useState('');
  const [runningTimeMinutes, setRunningTimeMinutes] = useState('');
  const [intermissions, setIntermissions] = useState('0');
  const [language, setLanguage] = useState('cs');
  const [contentWarnings, setContentWarnings] = useState<string[]>([]);
  const [warningInput, setWarningInput] = useState('');
  const [priceCzk, setPriceCzk] = useState('0');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [galleryInput, setGalleryInput] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [cast, setCast] = useState<CastEntry[]>([]);

  const [programId, setProgramId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadProgram();
  }, [eventId]);

  async function loadProgram() {
    const r = await fetch(`/api/admin/events/${eventId}/program`, {
      headers: authHeaders(),
    });
    if (!r.ok) return;
    const d = (await r.json()) as { program: ProgramData | null };
    if (!d.program) return;
    const p = d.program;
    setProgramId(p.id);
    setTitle(p.title ?? '');
    setAboutText(p.aboutText ?? '');
    setDirectorNote(p.directorNote ?? '');
    setDramaturgNote(p.dramaturgNote ?? '');
    setRunningTimeMinutes(p.runningTimeMinutes != null ? String(p.runningTimeMinutes) : '');
    setIntermissions(String(p.intermissions));
    setLanguage(p.language);
    setContentWarnings(p.contentWarnings);
    setPriceCzk(String(p.programPriceHalire / 100));
    setCoverImageUrl(p.coverImageUrl ?? '');
    setGalleryUrls(p.galleryUrls);
    setIsPublished(p.isPublished);
    setCast(p.cast.length > 0 ? p.cast : []);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    setSaving(true);
    try {
      const priceHalire = Math.round(parseFloat(priceCzk || '0') * 100);
      const body = {
        title: title || null,
        aboutText: aboutText || null,
        directorNote: directorNote || null,
        dramaturgNote: dramaturgNote || null,
        runningTimeMinutes: runningTimeMinutes ? parseInt(runningTimeMinutes, 10) : null,
        intermissions: parseInt(intermissions, 10) || 0,
        language,
        contentWarnings,
        programPriceHalire: priceHalire,
        coverImageUrl: coverImageUrl || null,
        galleryUrls,
        isPublished,
      };

      const r = await fetch(`/api/admin/events/${eventId}/program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      const prog = (d as { program: ProgramData }).program;
      setProgramId(prog.id);

      if (cast.length > 0) {
        const cr = await fetch(`/api/admin/events/${eventId}/program`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            entries: cast.map((c, i) => ({
              artistName: c.artistName,
              roleName: c.roleName,
              artistId: c.artistId || undefined,
              photoUrl: c.photoUrl || undefined,
              bioShort: c.bioShort || undefined,
              orderIndex: i,
            })),
          }),
        });
        if (!cr.ok) {
          const cd = await cr.json();
          setError(cd.error ?? `Cast save failed HTTP ${cr.status}`);
          return;
        }
      } else if (programId) {
        await fetch(`/api/admin/events/${eventId}/program`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ entries: [] }),
        });
      }

      setFeedback('Program uložen.');
    } catch {
      setError('Síťová chyba');
    } finally {
      setSaving(false);
    }
  }

  function addCastRow() {
    setCast((prev) => [
      ...prev,
      { artistName: '', roleName: '', orderIndex: prev.length },
    ]);
  }

  function removeCastRow(i: number) {
    setCast((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateCastRow(i: number, field: keyof CastEntry, value: string) {
    setCast((prev) =>
      prev.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)),
    );
  }

  function addWarning() {
    const w = warningInput.trim();
    if (w && !contentWarnings.includes(w)) {
      setContentWarnings((prev) => [...prev, w]);
    }
    setWarningInput('');
  }

  function addGallery() {
    const u = galleryInput.trim();
    if (u && !galleryUrls.includes(u)) {
      setGalleryUrls((prev) => [...prev, u]);
    }
    setGalleryInput('');
  }

  const priceNum = parseFloat(priceCzk || '0');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Digitální program"
        description="Kupující si přikoupí program za nastavenou cenu. Nahrazuje tištěný."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={isPublished ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsPublished((v) => !v)}
              className="gap-1"
            >
              {isPublished ? (
                <><Eye className="h-3.5 w-3.5" /> Publikováno</>
              ) : (
                <><EyeOff className="h-3.5 w-3.5" /> Nepublikováno</>
              )}
            </Button>
          </div>
        }
      />

      {feedback ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {feedback}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Sekce 1 — Základní info */}
        <Card>
          <CardHeader>
            <CardTitle>Základní info</CardTitle>
            <CardDescription>Texty, které kupující uvidí v digitálním programu.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Název programu</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Hamlet – program"
                maxLength={400}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">O hře</label>
              <textarea
                className="flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={aboutText}
                onChange={(e) => setAboutText(e.target.value)}
                placeholder="Stručný obsah, žánr, historický kontext…"
                maxLength={20000}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Režisérova poznámka</label>
              <textarea
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm italic"
                value={directorNote}
                onChange={(e) => setDirectorNote(e.target.value)}
                placeholder="Slovo režiséra k inscenaci…"
                maxLength={10000}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Dramaturgická poznámka</label>
              <textarea
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={dramaturgNote}
                onChange={(e) => setDramaturgNote(e.target.value)}
                placeholder="Dramaturgický kontext, inspirace, zdroje…"
                maxLength={10000}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Délka (minuty)</label>
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={runningTimeMinutes}
                  onChange={(e) => setRunningTimeMinutes(e.target.value)}
                  placeholder="120"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Počet přestávek</label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={intermissions}
                  onChange={(e) => setIntermissions(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Jazyk</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="cs">Čeština</option>
                  <option value="sk">Slovenština</option>
                  <option value="en">Angličtina</option>
                  <option value="de">Němčina</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Upozornění na obsah</label>
              <div className="flex gap-2">
                <Input
                  value={warningInput}
                  onChange={(e) => setWarningInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addWarning(); } }}
                  placeholder="např. silné světelné efekty"
                  maxLength={200}
                />
                <Button type="button" variant="outline" size="sm" onClick={addWarning}>
                  Přidat
                </Button>
              </div>
              {contentWarnings.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {contentWarnings.map((w) => (
                    <span
                      key={w}
                      className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs"
                    >
                      {w}
                      <button
                        type="button"
                        onClick={() => setContentWarnings((prev) => prev.filter((x) => x !== w))}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sekce 2 — Cena */}
        <Card>
          <CardHeader>
            <CardTitle>Cena programu</CardTitle>
            <CardDescription>
              0 Kč = program je zdarma pro všechny. Jinak kupující zaplatí při checkoutu.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end gap-4">
              <div className="w-40">
                <label className="mb-1 block text-xs font-medium">Cena (Kč)</label>
                <Input
                  type="number"
                  min={0}
                  max={5000}
                  step="1"
                  value={priceCzk}
                  onChange={(e) => setPriceCzk(e.target.value)}
                />
              </div>
              <p className="pb-1 text-sm text-muted-foreground">
                {priceNum === 0
                  ? 'Program bude dostupný zdarma bez nutnosti zakoupení.'
                  : `Kupující zaplatí ${priceNum.toLocaleString('cs-CZ')} Kč — váš čistý příjem (tisk programu obvykle stojí 30–60 Kč/ks).`}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Sekce 3 — Obsazení */}
        <Card>
          <CardHeader>
            <CardTitle>Obsazení</CardTitle>
            <CardDescription>
              Herci, režisér, dramaturg, výprava — vše co chcete zobrazit kupujícím.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {cast.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-2">#</th>
                      <th className="pr-2">Jméno</th>
                      <th className="pr-2">Role</th>
                      <th className="pr-2">Foto URL</th>
                      <th className="pr-2">Bio (krátké)</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cast.map((row, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-1.5 pr-2 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="pr-2">
                          <Input
                            value={row.artistName}
                            onChange={(e) => updateCastRow(i, 'artistName', e.target.value)}
                            placeholder="Jan Novák"
                            className="h-8 text-xs"
                            required
                          />
                        </td>
                        <td className="pr-2">
                          <Input
                            value={row.roleName}
                            onChange={(e) => updateCastRow(i, 'roleName', e.target.value)}
                            placeholder="Hamlet"
                            className="h-8 text-xs"
                            required
                          />
                        </td>
                        <td className="pr-2">
                          <Input
                            value={row.photoUrl ?? ''}
                            onChange={(e) => updateCastRow(i, 'photoUrl', e.target.value)}
                            placeholder="https://…"
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="pr-2">
                          <Input
                            value={row.bioShort ?? ''}
                            onChange={(e) => updateCastRow(i, 'bioShort', e.target.value)}
                            placeholder="Absolvent DAMU…"
                            className="h-8 text-xs"
                          />
                        </td>
                        <td>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-rose-700 hover:bg-rose-50"
                            onClick={() => removeCastRow(i)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addCastRow}>
              <Plus className="h-3.5 w-3.5" /> Přidat osobu
            </Button>
          </CardContent>
        </Card>

        {/* Sekce 4 — Galerie */}
        <Card>
          <CardHeader>
            <CardTitle>Cover a galerie</CardTitle>
            <CardDescription>
              Titulní fotka a doplňkové snímky z inscenace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Cover fotka (URL)</label>
              <Input
                value={coverImageUrl}
                onChange={(e) => setCoverImageUrl(e.target.value)}
                placeholder="https://…"
                maxLength={1000}
              />
              {coverImageUrl && (
                <img
                  src={coverImageUrl}
                  alt="Cover preview"
                  className="mt-2 h-32 w-auto rounded-md border object-cover"
                  onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Galerie</label>
              <div className="flex gap-2">
                <Input
                  value={galleryInput}
                  onChange={(e) => setGalleryInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addGallery(); } }}
                  placeholder="https://…"
                  maxLength={1000}
                />
                <Button type="button" variant="outline" size="sm" onClick={addGallery}>
                  Přidat
                </Button>
              </div>
              {galleryUrls.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {galleryUrls.map((u, i) => (
                    <div key={i} className="group relative">
                      <img
                        src={u}
                        alt=""
                        className="h-20 w-20 rounded-md border object-cover"
                        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                      />
                      <button
                        type="button"
                        onClick={() => setGalleryUrls((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute -right-1 -top-1 hidden rounded-full bg-rose-600 p-0.5 text-white group-hover:block"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving} className="gap-1.5">
            <Save className="h-4 w-4" />
            {saving ? 'Ukládám…' : 'Uložit program'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {isPublished
              ? 'Program bude viditelný kupujícím po uložení.'
              : 'Program je skrytý — kupující ho neuvidí.'}
          </span>
        </div>
      </form>
    </div>
  );
}
