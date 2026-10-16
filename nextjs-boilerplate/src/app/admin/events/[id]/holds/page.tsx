'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRouteParams } from '@/lib/next/route-params';

interface HoldRow {
  seatId: string;
  sector: string;
  row: string;
  seatNumber: string;
  kind: Kind;
  blocked: boolean;
  label: string | null;
  releaseAt: string | null;
}

interface MapRow {
  label: string;
  available: number;
  held: number;
  sold: number;
  blocked: number;
  firstSeat: string;
  lastSeat: string;
}

interface MapSector {
  name: string;
  rows: MapRow[];
}

type Kind = 'artist' | 'promoter' | 'comp' | 'production';

const KIND_LABELS: Record<Kind, string> = {
  artist: 'Umělec',
  promoter: 'Pořadatel a VIP',
  comp: 'Volné vstupy',
  production: 'Vyřazeno technikou',
};

const KIND_HINTS: Record<Kind, string> = {
  artist: 'Místa pro kapelu, management a jejich hosty.',
  promoter: 'Držená místa pro partnery, sponzory a tisk.',
  comp: 'Místa rozdaná zdarma — soutěže, pozvánky.',
  production: 'Místa, na kterých nejde sedět: zvuk, kamera, zakrytý výhled.',
};

const KIND_COLORS: Record<Kind, string> = {
  artist: 'bg-purple-100 text-purple-900 border-purple-300',
  promoter: 'bg-blue-100 text-blue-900 border-blue-300',
  comp: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  production: 'bg-slate-200 text-slate-900 border-slate-400',
};

const ALL_KINDS: Kind[] = ['artist', 'promoter', 'comp', 'production'];

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

export default function HoldsAdminPage(_props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = useParams<{ id: string }>();
  const { id: eventId } = useRouteParams(params);
  const [holds, setHolds] = useState<HoldRow[]>([]);
  const [sectors, setSectors] = useState<MapSector[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Výběr míst — sektor, řada a rozsah čísel.
  const [sector, setSector] = useState('');
  const [row, setRow] = useState('');
  const [fromSeat, setFromSeat] = useState('');
  const [toSeat, setToSeat] = useState('');
  const [seatIdsRaw, setSeatIdsRaw] = useState('');
  const [showIds, setShowIds] = useState(false);

  const [kind, setKind] = useState<Kind>('artist');
  const [label, setLabel] = useState('');
  const [releaseAt, setReleaseAt] = useState('');

  // Vydání vstupenky na držené místo
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [issueNote, setIssueNote] = useState('');

  const isKill = kind === 'production';

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const rowsOfSector = useMemo<MapRow[]>(
    () => sectors.find((s) => s.name === sector)?.rows ?? [],
    [sectors, sector],
  );
  const selectedRow = useMemo<MapRow | undefined>(
    () => rowsOfSector.find((r) => r.label === row),
    [rowsOfSector, row],
  );

  async function load(): Promise<void> {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/holds`);
      if (!res.ok) {
        setError(`Nepodařilo se načíst místa (HTTP ${res.status}).`);
        return;
      }
      const j = (await res.json()) as {
        holds: HoldRow[];
        totalsByKind: Record<string, number>;
        sectors: MapSector[];
      };
      setHolds(j.holds);
      setTotals(j.totalsByKind);
      setSectors(j.sectors ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function parseSeatIds(raw: string): string[] {
    return raw
      .split(/[\s,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  }

  const manualIds = parseSeatIds(seatIdsRaw);
  const canSubmit = sector !== '' || manualIds.length > 0;

  async function createHolds(): Promise<void> {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const body: Record<string, unknown> = {
        kind,
        label: label.trim() || undefined,
      };
      if (sector !== '') {
        body.selector = {
          sector,
          row: row || undefined,
          from: fromSeat.trim() || undefined,
          to: toSeat.trim() || undefined,
        };
      }
      if (manualIds.length > 0) body.seatIds = manualIds;
      if (!isKill && releaseAt) body.releaseAt = new Date(releaseAt).toISOString();

      const res = await authFetch(`/api/admin/events/${eventId}/holds`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.message ?? j.error ?? `Nepodařilo se uložit (HTTP ${res.status}).`);
        return;
      }
      setSuccess(j.message ?? 'Uloženo.');
      setSeatIdsRaw('');
      setLabel('');
      setReleaseAt('');
      setFromSeat('');
      setToSeat('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  function toggleSeat(seatId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(seatId)) next.delete(seatId);
      else next.add(seatId);
      return next;
    });
  }

  /**
   * Z držených míst vydá vstupenky a pošle je. Když e-mail neodejde,
   * vstupenky zůstanou platné — pošlou se znovu z detailu objednávky.
   */
  async function issueTickets(): Promise<void> {
    if (selected.size === 0) {
      setError('Vyber místa, na která se má vstupenka vydat.');
      return;
    }
    if (!recipientName.trim() || !recipientEmail.trim()) {
      setError('Vyplň jméno a e-mail příjemce.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/holds/issue`, {
        method: 'POST',
        body: JSON.stringify({
          seatIds: [...selected],
          recipientName: recipientName.trim(),
          recipientEmail: recipientEmail.trim(),
          note: issueNote.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `Nepodařilo se vydat (HTTP ${res.status}).`);
        return;
      }
      setSuccess(j.message ?? 'Vstupenky vydané.');
      setSelected(new Set());
      setRecipientName('');
      setRecipientEmail('');
      setIssueNote('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function releaseKind(kindToRelease: Kind): Promise<void> {
    const count = totals[kindToRelease] ?? 0;
    if (!confirm(`Vrátit do prodeje ${count} míst v kategorii „${KIND_LABELS[kindToRelease]}"?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/holds`, {
        method: 'DELETE',
        body: JSON.stringify({ kind: kindToRelease }),
      });
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(j.error ?? `Nepodařilo se uvolnit (HTTP ${res.status}).`);
        return;
      }
      setSuccess(j.message ?? 'Vráceno do prodeje.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function releaseSingle(seatId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/holds`, {
        method: 'DELETE',
        body: JSON.stringify({ seatIds: [seatId] }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Nepodařilo se uvolnit (HTTP ${res.status}).`);
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
        title="Držená a vyřazená místa"
        description="Místa stranou pro umělce, partnery a volné vstupy — a místa, na kterých nejde sedět. Rezervací kupujících v košíku se to nedotkne."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {ALL_KINDS.map((k) => (
          <div key={k} className={`rounded-md border p-3 ${KIND_COLORS[k]}`}>
            <div className="text-xs uppercase opacity-70">{KIND_LABELS[k]}</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold tabular-nums">{totals[k] ?? 0}</span>
              {(totals[k] ?? 0) > 0 ? (
                <button
                  type="button"
                  onClick={() => releaseKind(k)}
                  disabled={busy}
                  className="text-xs opacity-70 hover:underline"
                >
                  Vrátit do prodeje
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="text-sm font-semibold">Vzít místa stranou</h2>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Sektor</label>
              <select
                value={sector}
                onChange={(e) => {
                  setSector(e.target.value);
                  setRow('');
                  setFromSeat('');
                  setToSeat('');
                }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— vyber sektor —</option>
                {sectors.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Řada</label>
              <select
                value={row}
                onChange={(e) => {
                  setRow(e.target.value);
                  setFromSeat('');
                  setToSeat('');
                }}
                disabled={sector === ''}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">celý sektor</option>
                {rowsOfSector.map((r) => (
                  <option key={r.label} value={r.label}>
                    {r.label} — volných {r.available} z{' '}
                    {r.available + r.held + r.sold + r.blocked}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Od místa</label>
              <Input
                value={fromSeat}
                onChange={(e) => setFromSeat(e.target.value)}
                disabled={sector === ''}
                placeholder={selectedRow ? selectedRow.firstSeat : 'první'}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Do místa</label>
              <Input
                value={toSeat}
                onChange={(e) => setToSeat(e.target.value)}
                disabled={sector === ''}
                placeholder={selectedRow ? selectedRow.lastSeat : 'poslední'}
              />
            </div>
          </div>

          {sector !== '' ? (
            <p className="text-[11px] text-muted-foreground">
              Prázdné pole „od" a „do" znamená celou řadu. Bez výběru řady se použije celý sektor.
              Prodaná místa a místa, která má někdo právě v košíku, se nedotknou.
            </p>
          ) : null}

          <div>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => setShowIds((v) => !v)}
            >
              {showIds ? 'Skrýt zadání podle ID' : 'Zadat konkrétní místa podle ID'}
            </button>
            {showIds ? (
              <div className="mt-2">
                <textarea
                  value={seatIdsRaw}
                  onChange={(e) => setSeatIdsRaw(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                  placeholder="ID míst z plánku, oddělená mezerou nebo novým řádkem"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Rozpoznáno {manualIds.length} míst.
                </p>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Důvod</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {ALL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">{KIND_HINTS[kind]}</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Poznámka</label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
                placeholder="např. management kapely, soutěž rádia"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Vrátit do prodeje dne</label>
              <Input
                type="datetime-local"
                value={releaseAt}
                onChange={(e) => setReleaseAt(e.target.value)}
                disabled={isKill}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {isKill
                  ? 'Vyřazené místo se samo nevrátí — technika podle kalendáře nezmizí.'
                  : 'Nevyplněno = drží se, dokud ho nevrátíš ručně.'}
              </p>
            </div>
          </div>

          <Button onClick={createHolds} disabled={busy || !canSubmit}>
            {busy ? 'Zpracovávám…' : isKill ? 'Vyřadit z prodeje' : 'Vzít stranou'}
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">
              Vydat vstupenku na {selected.size} vybraných míst
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Pro koho</label>
                <Input
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Jan Novák"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">E-mail</label>
                <Input
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="jan@example.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Vzkaz do e-mailu</label>
                <Input
                  value={issueNote}
                  onChange={(e) => setIssueNote(e.target.value)}
                  placeholder="Vstupenka pro management kapely"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Vstupenka se vydá na konkrétní sedadla, místa přejdou na prodaná a odejde e-mail
              s QR kódem v příloze.
            </p>
            <div className="flex gap-3">
              <Button onClick={issueTickets} disabled={busy}>
                {busy ? 'Vydávám…' : 'Vydat a poslat e-mailem'}
              </Button>
              <Button variant="outline" onClick={() => setSelected(new Set())} disabled={busy}>
                Zrušit výběr
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {holds.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Žádná místa nejsou stranou — celý sál je v prodeji.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2">Sektor</th>
                <th className="px-3 py-2">Řada</th>
                <th className="px-3 py-2">Místo</th>
                <th className="px-3 py-2">Důvod</th>
                <th className="px-3 py-2">Poznámka</th>
                <th className="px-3 py-2">Vrátit dne</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {holds.map((h) => (
                <tr key={h.seatId} className="border-t text-xs">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(h.seatId)}
                      onChange={() => toggleSeat(h.seatId)}
                      disabled={h.blocked}
                      title={
                        h.blocked
                          ? 'Vyřazené místo — vstupenka na něj nedává smysl'
                          : 'Vybrat pro vydání vstupenky'
                      }
                    />
                  </td>
                  <td className="px-3 py-2">{h.sector}</td>
                  <td className="px-3 py-2">{h.row}</td>
                  <td className="px-3 py-2">{h.seatNumber}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 ${KIND_COLORS[h.kind]}`}>
                      {KIND_LABELS[h.kind]}
                    </span>
                  </td>
                  <td className="px-3 py-2">{h.label ?? '—'}</td>
                  <td className="px-3 py-2">
                    {h.blocked
                      ? 'nevrací se'
                      : h.releaseAt
                        ? new Date(h.releaseAt).toLocaleString('cs-CZ')
                        : 'ručně'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => releaseSingle(h.seatId)}
                      disabled={busy}
                      className="text-rose-700 hover:underline"
                    >
                      Vrátit do prodeje
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
