'use client';

import { useEffect, useState } from 'react';
import { useRouteParams } from '@/lib/next/route-params';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react';

function Label({ className, children }: { className?: string; children: React.ReactNode }) {
  return <label className={`block text-xs font-medium text-muted-foreground mb-1 ${className ?? ''}`}>{children}</label>;
}

interface TicketType {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  basePrice: number;
  totalQty: number;
  remainingQty: number;
  soldQty: number;
  issuedQty: number;
  maxPerUser: number | null;
  zone: string | null;
  isSeated: boolean;
  // mig 432 — presale access codes
  presaleCodeRequired: boolean;
  presaleStartsAt: string | null;
  presaleEndsAt: string | null;
  presaleCode: string | null;
  // mig 433 — per-ticket-type purchase limit
  maxPerBuyer: number | null;
}

function priceLabel(halire: number, currency = 'CZK'): string {
  if (currency === 'CZK') return `${(halire / 100).toFixed(0)} Kč`;
  if (currency === 'EUR') return `€${(halire / 100).toFixed(2)}`;
  return `${(halire / 100).toFixed(2)}`;
}

function soldPct(tt: TicketType): number {
  if (tt.totalQty === 0) return 0;
  return Math.round((tt.soldQty / tt.totalQty) * 100);
}

function authFetch(url: string, opts?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

export default function TicketTypesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = useRouteParams(params);
  const [types, setTypes] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Add form state
  const [addName, setAddName] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addCapacity, setAddCapacity] = useState('');
  const [addMax, setAddMax] = useState('');
  const [addZone, setAddZone] = useState('');
  const [addDesc, setAddDesc] = useState('');

  // Edit state (patch only changed fields)
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editCapacity, setEditCapacity] = useState('');
  const [editMax, setEditMax] = useState('');
  const [editZone, setEditZone] = useState('');
  const [editDesc, setEditDesc] = useState('');
  // mig 432 — presale
  const [editPresaleRequired, setEditPresaleRequired] = useState(false);
  const [editPresaleCode, setEditPresaleCode] = useState('');
  const [editPresaleStartsAt, setEditPresaleStartsAt] = useState('');
  const [editPresaleEndsAt, setEditPresaleEndsAt] = useState('');
  // mig 433 — per-ticket-type purchase limit
  const [editMaxPerBuyer, setEditMaxPerBuyer] = useState('');

  const load = () => {
    setLoading(true);
    void authFetch(`/api/admin/events/${eventId}/ticket-types`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as { ticketTypes: TicketType[] };
        setTypes(d.ticketTypes);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [eventId]);

  function startEdit(tt: TicketType) {
    setEditingId(tt.id);
    setEditName(tt.name);
    setEditPrice(String((tt.basePrice / 100).toFixed(0)));
    setEditPresaleRequired(tt.presaleCodeRequired);
    setEditPresaleCode(tt.presaleCode ?? '');
    setEditPresaleStartsAt(tt.presaleStartsAt ? tt.presaleStartsAt.slice(0, 16) : '');
    setEditPresaleEndsAt(tt.presaleEndsAt ? tt.presaleEndsAt.slice(0, 16) : '');
    setEditMaxPerBuyer(tt.maxPerBuyer ? String(tt.maxPerBuyer) : '');
    setEditCapacity(String(tt.totalQty));
    setEditMax(tt.maxPerUser ? String(tt.maxPerUser) : '');
    setEditZone(tt.zone ?? '');
    setEditDesc(tt.description ?? '');
  }

  async function saveEdit(tt: TicketType) {
    setSaving(true);
    setStatusMsg(null);
    const body: Record<string, unknown> = {};
    if (editName !== tt.name) body.name = editName;
    if (editDesc !== (tt.description ?? '')) body.description = editDesc || null;
    const newPrice = Math.round(parseFloat(editPrice) * 100);
    if (!isNaN(newPrice) && newPrice !== tt.basePrice) body.priceHalire = newPrice;
    const newCap = parseInt(editCapacity, 10);
    if (!isNaN(newCap) && newCap !== tt.totalQty) body.totalQty = newCap;
    const newMax = editMax ? parseInt(editMax, 10) : null;
    if (newMax !== tt.maxPerUser) body.maxPerUser = newMax;
    if (editZone !== (tt.zone ?? '')) body.zone = editZone || null;
    // mig 432 — presale
    if (editPresaleRequired !== tt.presaleCodeRequired) body.presaleCodeRequired = editPresaleRequired;
    if (editPresaleCode !== (tt.presaleCode ?? '')) body.presaleCode = editPresaleCode || null;
    if (editPresaleStartsAt !== (tt.presaleStartsAt ? tt.presaleStartsAt.slice(0, 16) : ''))
      body.presaleStartsAt = editPresaleStartsAt ? new Date(editPresaleStartsAt).toISOString() : null;
    if (editPresaleEndsAt !== (tt.presaleEndsAt ? tt.presaleEndsAt.slice(0, 16) : ''))
      body.presaleEndsAt = editPresaleEndsAt ? new Date(editPresaleEndsAt).toISOString() : null;
    // mig 433 — max per buyer
    const newMaxPerBuyer = editMaxPerBuyer ? parseInt(editMaxPerBuyer, 10) : null;
    if (newMaxPerBuyer !== tt.maxPerBuyer) body.maxPerBuyer = newMaxPerBuyer;

    if (Object.keys(body).length === 0) {
      setEditingId(null);
      setSaving(false);
      return;
    }

    const r = await authFetch(`/api/admin/events/${eventId}/ticket-types/${tt.id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (r.ok) {
      setEditingId(null);
      setStatusMsg('Uloženo');
      load();
    } else {
      const d = (await r.json()) as { message?: string; error?: string };
      setStatusMsg(d.message ?? d.error ?? 'Chyba při ukládání');
    }
  }

  async function handleDelete(tt: TicketType) {
    if (!confirm(`Smazat typ "${tt.name}"?`)) return;
    setSaving(true);
    const r = await authFetch(`/api/admin/events/${eventId}/ticket-types/${tt.id}`, {
      method: 'DELETE',
    });
    setSaving(false);
    if (r.ok) {
      load();
    } else {
      const d = (await r.json()) as { message?: string };
      alert(d.message ?? 'Nelze smazat');
    }
  }

  async function handleAdd() {
    if (!addName.trim() || !addPrice || !addCapacity) return;
    setSaving(true);
    setStatusMsg(null);
    const r = await authFetch(`/api/admin/events/${eventId}/ticket-types`, {
      method: 'POST',
      body: JSON.stringify({
        name: addName.trim(),
        description: addDesc || null,
        priceHalire: Math.round(parseFloat(addPrice) * 100),
        totalQty: parseInt(addCapacity, 10),
        maxPerUser: addMax ? parseInt(addMax, 10) : null,
        zone: addZone || null,
      }),
    });
    setSaving(false);
    if (r.ok) {
      setShowAdd(false);
      setAddName(''); setAddPrice(''); setAddCapacity('');
      setAddMax(''); setAddZone(''); setAddDesc('');
      setStatusMsg('Typ vstupenky přidán');
      load();
    } else {
      const d = (await r.json()) as { message?: string };
      setStatusMsg(d.message ?? 'Chyba');
    }
  }

  async function adjustCapacity(tt: TicketType, delta: number) {
    const newTotal = tt.totalQty + delta;
    if (newTotal < tt.soldQty) return;
    setSaving(true);
    const r = await authFetch(`/api/admin/events/${eventId}/ticket-types/${tt.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ totalQty: newTotal }),
    });
    setSaving(false);
    if (r.ok) load();
    else {
      const d = (await r.json()) as { message?: string };
      setStatusMsg(d.message ?? 'Chyba');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Typy vstupenek"
        description="Správa typů vstupenek — přidávání, editace cen a kapacity za běhu. Kapacitu lze zvýšit kdykoliv; snížit pouze nad počet prodaných."
        actions={
          <Button onClick={() => setShowAdd(!showAdd)} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            Přidat typ
          </Button>
        }
      />

      {statusMsg && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {statusMsg}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Nový typ vstupenky</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label className="text-xs">Název *</Label>
                <Input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Standard, VIP, Student…" />
              </div>
              <div>
                <Label className="text-xs">Cena (CZK) *</Label>
                <Input type="number" min={0} value={addPrice} onChange={(e) => setAddPrice(e.target.value)} placeholder="590" />
              </div>
              <div>
                <Label className="text-xs">Kapacita *</Label>
                <Input type="number" min={1} value={addCapacity} onChange={(e) => setAddCapacity(e.target.value)} placeholder="200" />
              </div>
              <div>
                <Label className="text-xs">Max. na osobu</Label>
                <Input type="number" min={1} max={100} value={addMax} onChange={(e) => setAddMax(e.target.value)} placeholder="4" />
              </div>
              <div>
                <Label className="text-xs">Zóna / sektor</Label>
                <Input value={addZone} onChange={(e) => setAddZone(e.target.value)} placeholder="Hlavní sál, Balkon…" />
              </div>
              <div>
                <Label className="text-xs">Popis</Label>
                <Input value={addDesc} onChange={(e) => setAddDesc(e.target.value)} placeholder="Volitelný popis" />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={handleAdd} disabled={saving || !addName.trim() || !addPrice || !addCapacity} size="sm">
                Přidat
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Zrušit</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Načítám…</p>
      ) : error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : types.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Zatím žádné typy vstupenek. Přidejte první.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {types.map((tt) => {
            const pct = soldPct(tt);
            const isEdit = editingId === tt.id;
            return (
              <Card key={tt.id} className={isEdit ? 'border-primary' : undefined}>
                <CardContent className="py-4">
                  {isEdit ? (
                    /* Edit mode */
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <Label className="text-xs">Název</Label>
                          <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs">Cena (CZK)</Label>
                          <Input type="number" min={0} value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs">
                            Celková kapacita
                            <span className="ml-1 text-muted-foreground">(prodáno: {tt.soldQty})</span>
                          </Label>
                          <Input
                            type="number"
                            min={tt.soldQty}
                            value={editCapacity}
                            onChange={(e) => setEditCapacity(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Max. na osobu</Label>
                          <Input type="number" min={1} max={100} value={editMax} onChange={(e) => setEditMax(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs">Zóna</Label>
                          <Input value={editZone} onChange={(e) => setEditZone(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs">Popis</Label>
                          <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs">Max ks na osobu (mig 433)</Label>
                          <Input type="number" min={1} max={1000} value={editMaxPerBuyer} onChange={(e) => setEditMaxPerBuyer(e.target.value)} placeholder="bez limitu" />
                        </div>
                      </div>
                      {/* Presale nastavení (mig 432) */}
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-3">
                        <p className="text-xs font-semibold text-amber-900">Presale nastavení</p>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editPresaleRequired}
                            onChange={(e) => setEditPresaleRequired(e.target.checked)}
                          />
                          <span className="font-medium text-amber-900">Vyžadovat přístupový kód</span>
                        </label>
                        {editPresaleRequired ? (
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div>
                              <Label className="text-xs">Přístupový kód</Label>
                              <Input
                                value={editPresaleCode}
                                onChange={(e) => setEditPresaleCode(e.target.value.toUpperCase())}
                                placeholder="PRESALE-XXXX"
                                className="font-mono uppercase"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Presale začíná</Label>
                              <Input
                                type="datetime-local"
                                value={editPresaleStartsAt}
                                onChange={(e) => setEditPresaleStartsAt(e.target.value)}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Presale končí</Label>
                              <Input
                                type="datetime-local"
                                value={editPresaleEndsAt}
                                onChange={(e) => setEditPresaleEndsAt(e.target.value)}
                              />
                            </div>
                          </div>
                        ) : null}
                        <p className="text-xs text-amber-800">
                          Kupující budou muset zadat kód během presale období. Po jeho skončení je vstupenka dostupná normálně.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(tt)} disabled={saving}>Uložit</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Zrušit</Button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{tt.name}</span>
                          {tt.zone && (
                            <Badge variant="outline" className="text-xs">{tt.zone}</Badge>
                          )}
                          {tt.soldQty === tt.totalQty && (
                            <Badge className="text-xs bg-rose-100 text-rose-800 border-rose-300">Vyprodáno</Badge>
                          )}
                        </div>
                        {tt.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{tt.description}</p>
                        )}

                        {/* Capacity bar */}
                        <div className="mt-3 space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              {tt.soldQty} prodáno / {tt.remainingQty} zbývá / {tt.totalQty} celkem
                            </span>
                            <span>{pct} %</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full transition-all ${pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>

                        <div className="mt-2 text-xs text-muted-foreground">
                          Cena: <strong>{priceLabel(tt.basePrice)}</strong>
                          {tt.maxPerUser && <> · Max {tt.maxPerUser} / osoba</>}
                        </div>
                      </div>

                      {/* Quick capacity buttons */}
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-muted-foreground">Kapacita</span>
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => adjustCapacity(tt, 10)}
                            disabled={saving}
                            className="flex items-center gap-0.5 rounded px-2 py-0.5 text-xs bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50"
                            title="+10"
                          >
                            <ChevronUp className="h-3 w-3" />+10
                          </button>
                          <button
                            onClick={() => adjustCapacity(tt, 1)}
                            disabled={saving}
                            className="flex items-center gap-0.5 rounded px-2 py-0.5 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            title="+1"
                          >
                            <ChevronUp className="h-3 w-3" />+1
                          </button>
                          <button
                            onClick={() => adjustCapacity(tt, -1)}
                            disabled={saving || tt.remainingQty < 1}
                            className="flex items-center gap-0.5 rounded px-2 py-0.5 text-xs bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                            title="-1"
                          >
                            <ChevronDown className="h-3 w-3" />-1
                          </button>
                          <button
                            onClick={() => adjustCapacity(tt, -10)}
                            disabled={saving || tt.remainingQty < 10}
                            className="flex items-center gap-0.5 rounded px-2 py-0.5 text-xs bg-rose-100 text-rose-800 hover:bg-rose-200 disabled:opacity-50"
                            title="-10"
                          >
                            <ChevronDown className="h-3 w-3" />-10
                          </button>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startEdit(tt)}
                          className="gap-1"
                        >
                          <Pencil className="h-3 w-3" />
                          Upravit
                        </Button>
                        {tt.soldQty === 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(tt)}
                            className="gap-1 text-rose-600 hover:text-rose-700"
                          >
                            <Trash2 className="h-3 w-3" />
                            Smazat
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Kapacitu lze zvyšovat kdykoliv (i při probíhajícím prodeji). Snižovat lze pouze o volná místa — minimem je počet již prodaných vstupenek. Typ s vydanými vstupenkami nelze smazat.
      </p>
    </div>
  );
}
