'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CastMember {
  id: string;
  artist_name: string;
  role_name: string;
  photo_url: string | null;
  bio_short: string | null;
  is_understudy: boolean;
  is_visible: boolean;
  order_index: number;
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

export default function CastPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [cast, setCast] = useState<CastMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    artistName: '',
    roleName: '',
    isUnderstudy: false,
    isVisible: true,
  });

  async function load(): Promise<void> {
    setError(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/cast`);
      if (!r.ok) {
        setError(`HTTP ${r.status}`);
        return;
      }
      const data = (await r.json()) as { cast: CastMember[] };
      setCast(data.cast);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Síťová chyba');
    }
  }

  useEffect(() => {
    void load();
  }, [eventId]);

  async function handleAdd(): Promise<void> {
    if (!form.artistName.trim() || !form.roleName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/cast`, {
        method: 'POST',
        body: JSON.stringify({
          artistName: form.artistName.trim(),
          roleName: form.roleName.trim(),
          isUnderstudy: form.isUnderstudy,
          isVisible: form.isVisible,
          orderIndex: cast.length,
        }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? `HTTP ${r.status}`);
        return;
      }
      setForm({ artistName: '', roleName: '', isUnderstudy: false, isVisible: true });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleVisible(member: CastMember): Promise<void> {
    setBusy(true);
    try {
      await authFetch(`/api/admin/events/${eventId}/cast`, {
        method: 'PATCH',
        body: JSON.stringify({ id: member.id, isVisible: !member.is_visible }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleUnderstudy(member: CastMember): Promise<void> {
    setBusy(true);
    try {
      await authFetch(`/api/admin/events/${eventId}/cast`, {
        method: 'PATCH',
        body: JSON.stringify({ id: member.id, isUnderstudy: !member.is_understudy }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/cast`, {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? `HTTP ${r.status}`);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Obsazení"
        description="Per-repríza casting. Skrytí herci (alternace) nejsou viditelní na veřejné stránce."
      />

      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Tato feature je skrytá veřejnosti (<code>NEXT_PUBLIC_FEATURE_ACTOR_PROFILES=false</code>).
        Data lze zadávat, buyer je neuvidí.
      </div>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Přidat herce</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="mb-1 block text-xs font-medium">Jméno herce</label>
              <Input
                placeholder="Jana Nováková"
                value={form.artistName}
                onChange={(e) => setForm((f) => ({ ...f, artistName: e.target.value }))}
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="mb-1 block text-xs font-medium">Role</label>
              <Input
                placeholder="Hamlet"
                value={form.roleName}
                onChange={(e) => setForm((f) => ({ ...f, roleName: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <input
                id="understudy"
                type="checkbox"
                checked={form.isUnderstudy}
                onChange={(e) => setForm((f) => ({ ...f, isUnderstudy: e.target.checked }))}
                className="h-4 w-4"
              />
              <label htmlFor="understudy" className="text-sm">Je understudy</label>
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <input
                id="visible"
                type="checkbox"
                checked={form.isVisible}
                onChange={(e) => setForm((f) => ({ ...f, isVisible: e.target.checked }))}
                className="h-4 w-4"
              />
              <label htmlFor="visible" className="text-sm">Viditelná</label>
            </div>
            <Button
              onClick={() => void handleAdd()}
              disabled={busy || !form.artistName.trim() || !form.roleName.trim()}
            >
              Přidat
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Obsazení ({cast.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {cast.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné obsazení.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Pořadí</th>
                    <th className="py-2 pr-4 font-medium">Jméno</th>
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 pr-4 font-medium">Viditelná</th>
                    <th className="py-2 pr-4 font-medium">Understudy</th>
                    <th className="py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {cast.map((member) => (
                    <tr key={member.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-muted-foreground">{member.order_index + 1}</td>
                      <td className="py-2 pr-4 font-medium">{member.artist_name}</td>
                      <td className="py-2 pr-4">{member.role_name}</td>
                      <td className="py-2 pr-4">
                        <button
                          type="button"
                          onClick={() => void handleToggleVisible(member)}
                          disabled={busy}
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            member.is_visible
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {member.is_visible ? 'Ano' : 'Ne'}
                        </button>
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          type="button"
                          onClick={() => void handleToggleUnderstudy(member)}
                          disabled={busy}
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            member.is_understudy
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {member.is_understudy ? 'Ano' : 'Ne'}
                        </button>
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => void handleDelete(member.id)}
                          disabled={busy}
                          className="rounded px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50"
                        >
                          Smazat
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
