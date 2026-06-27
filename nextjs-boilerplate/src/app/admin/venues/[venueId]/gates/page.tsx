'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Trash2, Pencil, DoorOpen, Accessibility, Check, X } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Gate {
  id: string;
  venue_id: string;
  code: string;
  label: string;
  description: string | null;
  is_accessible: boolean;
  sort_order: number;
}

interface GateFormData {
  code: string;
  label: string;
  description: string;
  isAccessible: boolean;
  sortOrder: number;
}

const EMPTY_FORM: GateFormData = { code: '', label: '', description: '', isAccessible: false, sortOrder: 0 };

export default function VenueGatesPage() {
  const { venueId } = useParams<{ venueId: string }>();
  const [gates, setGates]     = useState<Gate[]>([]);
  const [form, setForm]       = useState<GateFormData>(EMPTY_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/admin/venues/${venueId}/gates`);
    if (r.ok) {
      const d = await r.json() as { gates: Gate[] };
      setGates(d.gates);
    }
  }
  useEffect(() => { void load(); }, []);

  function startEdit(g: Gate) {
    setEditing(g.id);
    setForm({ code: g.code, label: g.label, description: g.description ?? '', isAccessible: g.is_accessible, sortOrder: g.sort_order });
  }

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function save() {
    setBusy(true); setError(null);
    const url = editing
      ? `/api/admin/venues/${venueId}/gates/${editing}`
      : `/api/admin/venues/${venueId}/gates`;
    const method = editing ? 'PATCH' : 'POST';
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const d = await r.json() as { error?: string; message?: string };
    if (!r.ok) {
      setError(d.message ?? d.error ?? 'Chyba při ukládání');
    } else {
      cancelEdit();
      await load();
    }
    setBusy(false);
  }

  async function del(gateId: string) {
    if (!confirm('Opravdu smazat bránu?')) return;
    await fetch(`/api/admin/venues/${venueId}/gates/${gateId}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-6 p-6 max-w-3xl">
      <PageHeader
        title="Vstupy / brány"
        description="Fyzické vstupy sálu — Gate A, Vstup sever, Bezbariérový vstup, …"
      />

      <div className="space-y-3">
        {gates.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Zatím žádné vstupy — přidejte první bránu níže.
          </div>
        )}
        {gates.map((g) => (
          <div key={g.id} className="rounded-xl border bg-card p-4">
            {editing === g.id ? (
              <GateForm form={form} setForm={setForm} busy={busy} onSave={save} onCancel={cancelEdit} />
            ) : (
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-lg font-bold">
                    {g.is_accessible ? <Accessibility className="h-5 w-5 text-emerald-500" /> : <DoorOpen className="h-5 w-5" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-sm bg-muted px-2 py-0.5 rounded">{g.code}</span>
                      <span className="font-medium">{g.label}</span>
                      {g.is_accessible && <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-xs">Bezbariérové</Badge>}
                    </div>
                    {g.description && <p className="text-sm text-muted-foreground mt-0.5">{g.description}</p>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(g)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void del(g.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {!editing && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Přidat vstup
          </h3>
          <GateForm form={form} setForm={setForm} busy={busy} onSave={save} onCancel={() => setForm(EMPTY_FORM)} />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function GateForm({ form, setForm, busy, onSave, onCancel }: {
  form: GateFormData;
  setForm: (f: GateFormData) => void;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Kód *</label>
          <input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="A, Gate3, North…"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Název *</label>
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Brána A, Vstup sever…"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Popis</label>
        <input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Boční vstup, 2. patro, výtah C2…"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="acc-gate"
          checked={form.isAccessible}
          onChange={(e) => setForm({ ...form, isAccessible: e.target.checked })}
          className="h-4 w-4 rounded"
        />
        <label htmlFor="acc-gate" className="text-sm flex items-center gap-1.5">
          <Accessibility className="h-4 w-4 text-emerald-500" />
          Bezbariérový vstup
        </label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
            <X className="h-3 w-3 mr-1" /> Zrušit
          </Button>
          <Button size="sm" onClick={onSave} disabled={busy || !form.code || !form.label}>
            <Check className="h-3 w-3 mr-1" /> Uložit
          </Button>
        </div>
      </div>
    </div>
  );
}
