'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Edit3, Calendar, Users, Share2, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface GroupDetail {
  group: {
    id: string;
    name: string;
    slug: string;
    group_type: string;
    status: string;
    description: string | null;
  };
  members: Array<{
    event_id: string;
    title: string;
    slug: string | null;
    date_start: string;
    status: string;
    is_primary: boolean;
  }>;
  shares: Array<{
    id: string;
    shared_with_name: string;
    status: string;
    can_edit_events: boolean;
    can_publish: boolean;
    accepted_at: string | null;
  }>;
}

interface AvailableEvent {
  id: string;
  title: string;
  date_start: string;
}

export default function EventGroupDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<GroupDetail | null>(null);
  const [availableEvents, setAvailableEvents] = useState<AvailableEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Coordinated onsale form
  const [onsaleStart, setOnsaleStart] = useState('');
  const [onsaleEnd, setOnsaleEnd] = useState('');

  // Bulk edit form
  const [bulkRefundDays, setBulkRefundDays] = useState('');
  const [bulkResaleAllowed, setBulkResaleAllowed] = useState<'unchanged' | 'true' | 'false'>('unchanged');
  const [bulkMaxTickets, setBulkMaxTickets] = useState('');

  useEffect(() => {
    void load();
  }, [params.id]);

  async function load() {
    try {
      const detail = await typedGet<GroupDetail>(`/api/admin/event-groups/${params.id}`);
      setData(detail);

      // Load available events (promoter's events not in this group)
      const allEvents = await typedGet<{ events: { id: string; title: string; dateStart: string }[] }>(
        '/api/admin/events',
      );
      const memberIds = new Set(detail.members.map((m) => m.event_id));
      setAvailableEvents(
        (allEvents.events ?? [])
          .filter((e) => !memberIds.has(e.id))
          .map((e) => ({ id: e.id, title: e.title, date_start: e.dateStart })),
      );
    } catch {
      setError('Nelze načíst data');
    }
  }

  async function addEvent(eventId: string) {
    setBusy(true);
    try {
      await typedPost(`/api/admin/event-groups/${params.id}/members`, { eventId }, { throwOnError: true });
      await load();
    } catch {
      setError('Nelze přidat akci');
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent(eventId: string) {
    if (!confirm('Odebrat akci ze skupiny?')) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/event-groups/${params.id}/members?eventId=${eventId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}` },
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function coordinateOnsale() {
    if (!onsaleStart) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      const r = await typedPost<{ eventCount: number }>(
        `/api/admin/event-groups/${params.id}/coordinate-onsale`,
        {
          saleStartAt: new Date(onsaleStart).toISOString(),
          saleEndAt: onsaleEnd ? new Date(onsaleEnd).toISOString() : undefined,
        },
        { throwOnError: true },
      );
      setSuccess(`✅ Onsale koordinován pro ${r.eventCount} akcí`);
      setOnsaleStart(''); setOnsaleEnd('');
      await load();
    } catch (err) {
      setError(err instanceof TypedFetchError ? `HTTP ${err.status}` : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  async function applyBulkEdit() {
    const fields: Record<string, unknown> = {};
    if (bulkRefundDays) fields.refundDeadlineDays = Number(bulkRefundDays);
    if (bulkResaleAllowed !== 'unchanged') fields.resaleAllowed = bulkResaleAllowed === 'true';
    if (bulkMaxTickets) fields.maxTicketsPerOrder = Number(bulkMaxTickets);

    if (Object.keys(fields).length === 0) {
      setError('Žádné pole k úpravě');
      return;
    }

    setBusy(true); setError(null); setSuccess(null);
    try {
      const r = await typedPost<{ updatedCount: number }>(
        `/api/admin/event-groups/${params.id}/bulk-edit`,
        { fields },
        { throwOnError: true },
      );
      setSuccess(`✅ Bulk edit: ${r.updatedCount} akcí updated`);
      setBulkRefundDays(''); setBulkResaleAllowed('unchanged'); setBulkMaxTickets('');
      await load();
    } catch (err) {
      setError(err instanceof TypedFetchError ? `HTTP ${err.status}` : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Načítám…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={data.group.name} description={`${data.group.group_type} • ${data.members.length} akcí`} />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <AlertCircle className="mr-2 inline h-4 w-4" />{error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      {/* Members + add */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Akce v skupině ({data.members.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné akce. Přidej níže.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Název</th><th>Datum</th><th>Stav</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.event_id} className="border-b">
                    <td className="py-2"><Link href={`/admin/events/${m.event_id}`} className="hover:underline">{m.title}</Link></td>
                    <td className="text-xs">{new Date(m.date_start).toLocaleString('cs-CZ')}</td>
                    <td><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{m.status}</span></td>
                    <td className="text-right">
                      <button type="button" onClick={() => void removeEvent(m.event_id)} disabled={busy}
                        className="text-xs text-rose-600 hover:underline">
                        Odebrat
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {availableEvents.length > 0 ? (
            <div className="mt-4 border-t pt-4">
              <p className="mb-2 text-xs font-medium">Přidat akci:</p>
              <select
                onChange={(e) => { if (e.target.value) void addEvent(e.target.value); e.target.value = ''; }}
                className="block w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— Vyber akci —</option>
                {availableEvents.map((e) => (
                  <option key={e.id} value={e.id}>{e.title} ({new Date(e.date_start).toLocaleDateString('cs-CZ')})</option>
                ))}
              </select>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Coordinated Onsale */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Coordinated Onsale
          </CardTitle>
          <CardDescription>Spustit prodej pro všechny akce ve skupině současně</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Začátek prodeje</label>
              <Input type="datetime-local" value={onsaleStart} onChange={(e) => setOnsaleStart(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Konec (volit.)</label>
              <Input type="datetime-local" value={onsaleEnd} onChange={(e) => setOnsaleEnd(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Button onClick={coordinateOnsale} disabled={busy || !onsaleStart || data.members.length === 0}>
                Spustit synchronizovaný onsale
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Edit */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Edit3 className="h-4 w-4" /> Bulk Edit
          </CardTitle>
          <CardDescription>Hromadná editace všech akcí ve skupině</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Refund deadline (dní)</label>
              <Input type="number" min={0} max={365} value={bulkRefundDays}
                onChange={(e) => setBulkRefundDays(e.target.value)} placeholder="14" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Resale povolen</label>
              <select value={bulkResaleAllowed} onChange={(e) => setBulkResaleAllowed(e.target.value as typeof bulkResaleAllowed)}
                className="block h-10 w-full rounded-md border bg-background px-3 text-sm">
                <option value="unchanged">Neměnit</option>
                <option value="true">Povolit</option>
                <option value="false">Zakázat</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Max lístků / objednávka</label>
              <Input type="number" min={1} max={100} value={bulkMaxTickets}
                onChange={(e) => setBulkMaxTickets(e.target.value)} placeholder="10" />
            </div>
            <div className="md:col-span-3">
              <Button onClick={applyBulkEdit} disabled={busy || data.members.length === 0}>
                Aplikovat na {data.members.length} akcí
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Shares */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" /> Cross-Org Sharing ({data.shares.length})
          </CardTitle>
          <CardDescription>Sdílet skupinu s partnerským promotérem (tour delegace)</CardDescription>
        </CardHeader>
        <CardContent>
          {data.shares.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné sdílení. UI pro přidání v M2 milestone.</p>
          ) : (
            <ul className="space-y-2">
              {data.shares.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <div>
                    <span className="font-medium">{s.shared_with_name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {[s.can_edit_events && 'edit', s.can_publish && 'publish'].filter(Boolean).join(', ')}
                    </span>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${
                    s.status === 'accepted' ? 'bg-emerald-100 text-emerald-800' :
                    s.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                    'bg-zinc-100 text-zinc-600'
                  }`}>{s.status}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
