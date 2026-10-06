'use client';

import { FormEvent, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { CheckCircle2, XCircle, AlertTriangle, ScanLine, Settings2, Wifi, WifiOff, Camera } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { QrScannerCamera } from '@/components/admin/QrScannerCamera';
import { GroupScanPanel } from '@/components/admin/GroupScanPanel';
import {
  enqueueScan,
  flushQueue,
  getPendingCount,
  saveManifest,
  getManifestMeta,
  validateOffline,
  decodePrintTokenUuid,
  type FlushResult,
  type ManifestMeta,
  type OfflineCheck,
} from '@/lib/scanner/offline-queue';

type ScanResult = {
  result:
    | 'admitted'
    | 'already_used'
    | 'already_redeemed_today'
    | 'revoked'
    | 'not_found'
    | 'invalid_token'
    | 'wrong_promoter'
    | 'wrong_event'
    | 'totp_mismatch'
    | 'invalid_status'
    | 'wrong_zone_or_day'
    | 'flex_limit_exhausted'
    | 'day_not_picked'
    | 'already_inside'
    | 'reentry_limit_exceeded'
    | 'not_inside'
    | 'reentry_disabled'
    | 'exited'
    // Z /scanner/passage: released = odchod, duplicate = dvojí načtení,
    // denied = zamítnuto pravidly, undone = průchod vzat zpět.
    | 'released'
    | 'duplicate'
    | 'denied'
    | 'undone'
    | 'error';
  kind?: 'single_use' | 'multi_day_redemption' | 'entry' | 'reentry';
  /** Z /scanner/passage — směr, který server odvodil, a stav pro obsluhu. */
  direction?: 'entry' | 'exit';
  label?: string;
  scanEventId?: string;
  occupancy?: number;
  secondsSinceLastScan?: number;
  message?: string;
  usedAt?: string;
  revokedAt?: string;
  admittedAt?: string;
  exitedAt?: string;
  scanCount?: number;
  remaining?: number;
  max?: number;
  picksRequired?: number;
  picksUsed?: number;
  ticket?: {
    ticketId: string;
    eventTitle: string;
    ticketTypeName: string;
    holderEmail: string;
    holderName: string | null;
    /** Kolo 8: místo, slevová kategorie a výzva k ověření průkazu (ZTP/P, student…). */
    seat?: string | null;
    category?: string | null;
    verifyId?: string | null;
  };
};

interface GateEvent {
  id: string;
  title: string;
  dateStart: string;
  days: { id: string; label: string | null; startsAt: string; dayIndex: number }[];
  zones: { id: string; name: string; zoneType: string }[];
}

interface GateState {
  eventId: string | null;
  eventDayId: string | null;
  zoneId: string | null;
}

const STORAGE_KEY = 'tixly.scanner.gate';

export default function ScannerPage() {
  const [ticketId, setTicketId] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [scanMode, setScanMode] = useState<
    'auto' | 'passage' | 'reentry_entry' | 'reentry_exit'
  >('auto');
  /** Poslední průchod — pro tlačítko „opravit". */
  const [lastPassage, setLastPassage] = useState<{
    scanEventId: string;
    direction: 'entry' | 'exit';
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [entryMode, setEntryMode] = useState<'single' | 'group'>('single');

  // QR payload parser:
  //   `tixly:<uuid>:<6-digit>`  → ticketId + TOTP (mobilní rotující QR)
  //   `TXP1.<...>` / `TXP2.<...>` → print token z TIŠTĚNÉ vstupenky (TXP2 je vázaný i na akci)
  //   `<uuid>`                  → holý ticketId (manual mode)
  function setTicketIdSmart(raw: string) {
    const trimmed = raw.trim();
    const m = trimmed.match(/^tixly:([0-9a-f-]{36}):(\d{6})$/i);
    if (m) {
      setTicketId(m[1]);
      setTotpCode(m[2]);
      return;
    }
    // Print token: necháme v inputu jako celek, TOTP nemá smysl.
    if (/^TXP[12]\./.test(trimmed)) {
      setTicketId(trimmed);
      setTotpCode('');
      return;
    }
    setTicketId(trimmed);
  }
  const [cameraOpen, setCameraOpen] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [gate, setGate] = useState<GateState>({ eventId: null, eventDayId: null, zoneId: null });
  const [showSettings, setShowSettings] = useState(true);
  // Haptic feedback on scan result (Vibration API — mobile browsers)
  useEffect(() => {
    if (!result || typeof navigator === 'undefined' || !navigator.vibrate) return;
    const denied: ScanResult['result'][] = [
      'already_used', 'already_redeemed_today', 'revoked', 'not_found',
      'invalid_token', 'wrong_promoter', 'totp_mismatch', 'invalid_status',
      'wrong_zone_or_day', 'flex_limit_exhausted', 'day_not_picked',
      'already_inside', 'reentry_limit_exceeded', 'not_inside',
      'reentry_disabled', 'error',
    ];
    // Obsluha se dívá na příchozího, ne do telefonu — vstup a odchod proto
    // musí být rozeznatelné poslepu. Tři různé vzorce: vstup, odchod, zamítnutí.
    if (result.result === 'released' || result.direction === 'exit') {
      navigator.vibrate([60, 50, 60]); // dvě krátké = odchod
    } else if (result.result === 'admitted' || result.result === 'exited') {
      navigator.vibrate(100); // jedna dlouhá = vstup
    } else if (result.result === 'duplicate') {
      navigator.vibrate(40); // jemné ťuknutí = už načteno, nic se nestalo
    } else if (denied.includes(result.result)) {
      navigator.vibrate([200, 80, 200]); // výrazné = zamítnutí
    }
  }, [result]);

  // Poslední průchod si držíme kvůli tlačítku „opravit".
  useEffect(() => {
    if (result?.scanEventId && result.direction) {
      setLastPassage({ scanEventId: result.scanEventId, direction: result.direction });
    }
  }, [result]);

  /**
   * Vezme poslední průchod zpět. Když se zobrazí opačný směr, obsluha NESMÍ
   * pípnout znovu — druhé pípnutí by stav překlopilo zpátky, ale zároveň
   * zapsalo průchod, který se nestal, a u vstupu ubralo z limitu návratů.
   */
  async function undoLastPassage(): Promise<void> {
    if (!lastPassage) return;
    setUndoing(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/admin/scanner/passage/undo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ scanEventId: lastPassage.scanEventId, reason: 'špatný směr' }),
      });
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setResult({
        result: res.ok ? 'undone' : 'error',
        message: j.message ?? j.error ?? 'Opravu se nepodařilo provést.',
      } as ScanResult);
      if (res.ok) setLastPassage(null);
    } finally {
      setUndoing(false);
    }
  }

  // Offline mode state
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [flushReport, setFlushReport] = useState<FlushResult | null>(null);
  const [manifestMeta, setManifestMeta] = useState<ManifestMeta | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);

  const refreshPending = useCallback(async () => {
    try {
      setPendingCount(await getPendingCount());
    } catch {
      // IndexedDB nedostupný (SSR / private mode) — silent fallback
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as GateState;
        setGate(parsed);
        setShowSettings(false);
      }
    } catch {
      // ignore
    }
    void loadGates();
    void refreshPending();

    // Online/offline detection
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    function onOnline() { setOnline(true); }
    function onOffline() { setOnline(false); }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refreshPending]);

  // Když se vrátí spojení a queue není prázdná, automaticky flushni.
  useEffect(() => {
    if (online && pendingCount > 0) {
      void handleFlush();
    }
    // handleFlush dependency by tu způsobila smyčku — disable eslint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, pendingCount]);

  async function handleFlush() {
    try {
      const token = localStorage.getItem('accessToken');
      const report = await flushQueue(token);
      setFlushReport(report);
      await refreshPending();
    } catch {
      // ignore
    }
  }

  async function loadGates() {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/admin/scanner/gates', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return;
      const json = (await res.json()) as { events: GateEvent[] };
      setEvents(json.events);
    } catch {
      // ignore
    }
  }

  // Stav staženého offline whitelistu pro zvolenou akci.
  const refreshManifestMeta = useCallback(async (eventId: string | null) => {
    if (!eventId) {
      setManifestMeta(null);
      return;
    }
    try {
      setManifestMeta(await getManifestMeta(eventId));
    } catch {
      setManifestMeta(null);
    }
  }, []);

  useEffect(() => {
    void refreshManifestMeta(gate.eventId);
  }, [gate.eventId, refreshManifestMeta]);

  // Stáhne seznam platných lístků pro akci a uloží do IndexedDB (nutno udělat
  // ONLINE, ideálně před začátkem představení). Offline pak skener ověřuje proti němu.
  async function downloadManifest() {
    if (!gate.eventId) return;
    setManifestLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/admin/scanner/manifest?eventId=${gate.eventId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        setResult({ result: 'error', message: `Stažení seznamu selhalo (HTTP ${res.status}).` });
        return;
      }
      const json = (await res.json()) as { ticketIds: string[]; generatedAt: string };
      await saveManifest(gate.eventId, json.ticketIds, json.generatedAt);
      await refreshManifestMeta(gate.eventId);
    } catch {
      setResult({ result: 'error', message: 'Stažení seznamu selhalo (síť).' });
    } finally {
      setManifestLoading(false);
    }
  }

  function persistGate(next: GateState) {
    setGate(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  const selectedEvent = events.find((e) => e.id === gate.eventId) ?? null;
  const selectedDay = selectedEvent?.days.find((d) => d.id === gate.eventDayId) ?? null;
  const selectedZone = selectedEvent?.zones.find((z) => z.id === gate.zoneId) ?? null;
  const gateLabel = selectedEvent
    ? `${selectedEvent.title}${selectedDay ? ' · ' + (selectedDay.label ?? `Den ${selectedDay.dayIndex + 1}`) : ''}${selectedZone ? ' · ' + selectedZone.name : ''}`
    : 'Žádná brána zvolena';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const raw = ticketId.trim();
    const isPrintToken = /^TXP[12]\./.test(raw);
    const code = totpCode.trim();

    const payload = {
      ...(isPrintToken ? { printToken: raw } : { ticketId: raw }),
      ...(code && !isPrintToken ? { totpCode: code } : {}),
      // Kolo 3 (V9b): akce brány → API odmítne lístek jiné akce (wrong_event).
      ...(gate.eventId ? { eventId: gate.eventId } : {}),
      ...(gate.eventDayId ? { eventDayId: gate.eventDayId } : {}),
      ...(gate.zoneId ? { zoneId: gate.zoneId } : {}),
    };

    // Offline: zapiš do queue (kvůli serverové rekonciliaci) a pokud máme stažený
    // whitelist pro akci, ověř proti němu — padělaný/cizí lístek odmítni, dvojí
    // vstup zachyť lokálně. Bez whitelistu lístek nejde ověřit — obsluha ho zkontroluje ručně
    // (kolo 12/13: dřív „Přijato offline BEZ ověření" = zelený vstup bez kontroly).
    const offlineCheck = async () => {
      await enqueueScan(payload, gateLabel);
      await refreshPending();

      const offlineTicketId = isPrintToken
        ? decodePrintTokenUuid(raw) ?? undefined
        : raw;
      let check: OfflineCheck = 'no_manifest';
      if (gate.eventId && offlineTicketId) {
        check = await validateOffline(gate.eventId, offlineTicketId);
      }

      if (check === 'not_found') {
        setResult({
          result: 'not_found',
          message: 'OFFLINE: lístek NENÍ ve staženém seznamu platných — NEVPOUŠTĚT.',
        });
      } else if (check === 'already_used') {
        setResult({
          result: 'already_used',
          message: 'OFFLINE: tento lístek už byl tímto zařízením odbaven.',
        });
      } else if (check === 'admitted') {
        setResult({
          result: 'admitted',
          message: 'Přijato offline (ověřeno proti staženému seznamu). Sync po obnovení.',
        });
        setTicketId('');
        setTotpCode('');
      } else {
        setResult({
          result: 'error',
          message: 'OFFLINE: lístek nelze ověřit (není stažený seznam) — zkontroluj ho ručně.',
        });
      }
    };

    if (!online) {
      try {
        await offlineCheck();
      } catch {
        setResult({ result: 'error', message: 'Offline queue selhala (IndexedDB nedostupný).' });
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const token = localStorage.getItem('accessToken');
      // Režim „průchod" neposílá směr — server ho odvodí ze stavu vstupenky
      // a vrátí ho, aby ho obsluha viděla a slyšela.
      const useReentry = scanMode === 'reentry_entry' || scanMode === 'reentry_exit';
      const endpoint =
        scanMode === 'passage'
          ? '/api/admin/scanner/passage'
          : useReentry
            ? '/api/admin/scanner/reentry'
            : '/api/admin/scanner/validate';
      const reentryBody = useReentry
        ? { ...payload, mode: scanMode === 'reentry_entry' ? 'entry' : 'exit' }
        : payload;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(reentryBody),
      });
      const data = (await res.json().catch(() => ({}))) as ScanResult;
      setResult({ ...data, result: data.result ?? 'error' });
      if (
        res.ok &&
        (data.result === 'admitted' || (data.result as string) === 'exited')
      ) {
        setTicketId('');
        setTotpCode('');
      }
    } catch {
      // Síť spadla mezi click a fetch — ověř proti staženému seznamu jako offline
      // (kolo 12/13: dřív „Síť spadla — uloženo" jako zelený vstup bez kontroly)
      try {
        await offlineCheck();
        setOnline(false);
      } catch {
        setResult({ result: 'error', message: 'Síťová chyba i offline queue selhala.' });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scanner"
        description="Manuální validace QR lístku. Pro festivaly nastav bránu (akce + den + zóna) a scanner bude validovat per gate."
        actions={
          <Link href="/admin/scanner/guide" className="text-sm text-primary hover:underline">
            📋 Průvodce pro personál
          </Link>
        }
      />

      {/* Online/offline status badge */}
      <div
        className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
          online
            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
            : 'border-amber-400 bg-amber-50 text-amber-900'
        }`}
      >
        <span className="flex items-center gap-2 font-medium">
          {online ? <Wifi className="h-4 w-4" aria-hidden /> : <WifiOff className="h-4 w-4" aria-hidden />}
          {online ? 'Online — server validuje každý sken' : 'Offline — skeny jdou do lokální fronty'}
        </span>
        {pendingCount > 0 ? (
          <span className="flex items-center gap-2">
            <span className="font-semibold">{pendingCount} čeká na sync</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleFlush()}
              disabled={!online}
            >
              Synchronizovat
            </Button>
          </span>
        ) : null}
      </div>

      {flushReport && (flushReport.attempted > 0 || flushReport.conflicts.length > 0) ? (
        <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-800">
          Sync: <strong>{flushReport.synced}</strong> přeneseno, <strong>{flushReport.failed}</strong> selhalo
          {flushReport.conflicts.length > 0
            ? `, ${flushReport.conflicts.length} konfliktů (lístek byl mezitím neplatný — viz audit)`
            : ''}
          .
          <button
            type="button"
            onClick={() => setFlushReport(null)}
            className="ml-2 text-slate-500 hover:underline"
          >
            zavřít
          </button>
        </div>
      ) : null}

      {/* Offline připravenost: stažený whitelist platných lístků pro zvolenou akci. */}
      {gate.eventId ? (
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {manifestMeta ? (
              <>
                Offline seznam: <strong className="text-foreground">{manifestMeta.count.toLocaleString('cs-CZ')}</strong>{' '}
                lístků · staženo {new Date(manifestMeta.savedAt).toLocaleString('cs-CZ')}
              </>
            ) : (
              <>⚠ Offline seznam není stažený — offline sken nepůjde ověřit. Stáhni před akcí (online).</>
            )}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void downloadManifest()}
            disabled={manifestLoading || !online}
            title={!online ? 'Stažení vyžaduje připojení' : undefined}
          >
            {manifestLoading ? 'Stahuji…' : manifestMeta ? 'Aktualizovat' : 'Stáhnout offline seznam'}
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" aria-hidden /> Brána
            </span>
            <button
              type="button"
              className="text-xs font-normal text-primary hover:underline"
              onClick={() => setShowSettings((s) => !s)}
            >
              {showSettings ? 'Skrýt' : 'Změnit'}
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!showSettings ? (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">{gateLabel}</span>
            </div>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Načítání akcí… Pokud nemáš žádnou nadcházející akci, vytvoř ji
              v sekci „Akce".
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Akce
                </label>
                <select
                  value={gate.eventId ?? ''}
                  onChange={(e) =>
                    persistGate({
                      eventId: e.target.value || null,
                      eventDayId: null,
                      zoneId: null,
                    })
                  }
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— vyber akci —</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title} ({new Date(ev.dateStart).toLocaleDateString('cs-CZ')})
                    </option>
                  ))}
                </select>
              </div>

              {selectedEvent && selectedEvent.days.length > 0 ? (
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                    Den{selectedEvent.days.length > 1 ? ' (povinné pro multi-day)' : ''}
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <ChipButton
                      active={gate.eventDayId === null}
                      onClick={() => persistGate({ ...gate, eventDayId: null })}
                      label="Vše"
                    />
                    {selectedEvent.days.map((d) => (
                      <ChipButton
                        key={d.id}
                        active={gate.eventDayId === d.id}
                        onClick={() => persistGate({ ...gate, eventDayId: d.id })}
                        label={
                          d.label ??
                          new Date(d.startsAt).toLocaleDateString('cs-CZ', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {selectedEvent && selectedEvent.zones.length > 0 ? (
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                    Zóna / scéna
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <ChipButton
                      active={gate.zoneId === null}
                      onClick={() => persistGate({ ...gate, zoneId: null })}
                      label="Vše"
                    />
                    {selectedEvent.zones.map((z) => (
                      <ChipButton
                        key={z.id}
                        active={gate.zoneId === z.id}
                        onClick={() => persistGate({ ...gate, zoneId: z.id })}
                        label={z.name}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowSettings(false)}
                >
                  Hotovo
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Přepínač: jednotlivý lístek vs. skupinové odbavení (1 QR = celá objednávka) */}
      <div className="grid grid-cols-2 gap-1 rounded-md border p-1 text-sm">
        <button
          type="button"
          className={`rounded px-3 py-2 font-medium ${entryMode === 'single' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
          onClick={() => setEntryMode('single')}
          data-testid="mode-single"
        >
          Jednotlivě
        </button>
        <button
          type="button"
          className={`rounded px-3 py-2 font-medium ${entryMode === 'group' ? 'bg-indigo-600 text-white' : 'hover:bg-muted'}`}
          onClick={() => setEntryMode('group')}
          data-testid="mode-group"
        >
          👥 Skupina
        </button>
      </div>

      {entryMode === 'group' ? (
        <GroupScanPanel />
      ) : (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5" aria-hidden /> Validace
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Ticket ID nebo QR payload{' '}
                  <code className="text-[11px] text-muted-foreground">
                    {'tixly:<id>:<code>'}
                  </code>
                </label>
                <div className="flex gap-2">
                  <Input
                    value={ticketId}
                    onChange={(e) => setTicketIdSmart(e.target.value)}
                    placeholder="8a4f7b2e-… / tixly:…:123456 / TXP2.…"
                    required
                    pattern="([0-9a-fA-F-]{36}|TXP[12]\..+)"
                    autoFocus
                    data-testid="scanner-ticket-input"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCameraOpen(true)}
                    title="Otevřít kameru pro sken QR"
                    data-testid="scanner-open-camera"
                  >
                    <Camera className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  TOTP kód (volitelné, z autentikační appky)
                </label>
                <Input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="123456"
                  pattern="\d{6}"
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Režim skenování</label>
                <div className="grid grid-cols-2 gap-1 rounded-md border p-1 text-xs sm:grid-cols-4">
                  <button
                    type="button"
                    className={`rounded px-2 py-1.5 ${scanMode === 'auto' ? 'bg-emerald-600 text-white' : 'hover:bg-muted'}`}
                    onClick={() => setScanMode('auto')}
                  >
                    Standard
                  </button>
                  <button
                    type="button"
                    className={`rounded px-2 py-1.5 ${scanMode === 'passage' ? 'bg-violet-600 text-white' : 'hover:bg-muted'}`}
                    onClick={() => setScanMode('passage')}
                    title="Server sám pozná, jestli člověk jde dovnitř nebo ven"
                  >
                    ⇄ Průchod
                  </button>
                  <button
                    type="button"
                    className={`rounded px-2 py-1.5 ${scanMode === 'reentry_entry' ? 'bg-blue-600 text-white' : 'hover:bg-muted'}`}
                    onClick={() => setScanMode('reentry_entry')}
                  >
                    ↪ Vstup
                  </button>
                  <button
                    type="button"
                    className={`rounded px-2 py-1.5 ${scanMode === 'reentry_exit' ? 'bg-amber-600 text-white' : 'hover:bg-muted'}`}
                    onClick={() => setScanMode('reentry_exit')}
                  >
                    ↩ Výstup
                  </button>
                </div>
                {scanMode !== 'auto' ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Re-entry režim pro festivaly / open-air. Vyžaduje event s
                    <code className="mx-1">reentry_allowed=TRUE</code>.
                  </p>
                ) : null}
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading
                  ? 'Validuji…'
                  : scanMode === 'reentry_exit'
                    ? 'Označit výstup'
                    : 'Validovat lístek'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Výsledek</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {renderResult(result)}
            {lastPassage && scanMode === 'passage' ? (
              <button
                type="button"
                onClick={() => void undoLastPassage()}
                disabled={undoing}
                className="w-full rounded-md border border-amber-400 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
              >
                {undoing
                  ? 'Opravuji…'
                  : `Špatný směr? Vzít zpět ${
                      lastPassage.direction === 'entry' ? 'vstup' : 'odchod'
                    }`}
              </button>
            ) : null}
          </CardContent>
        </Card>
      </div>
      )}

      <QrScannerCamera
        open={cameraOpen}
        onDetected={(raw) => {
          setTicketIdSmart(raw);
          setCameraOpen(false);
        }}
        onClose={() => setCameraOpen(false)}
      />
    </div>
  );
}

function ChipButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
          : 'rounded-full border bg-background px-3 py-1 text-xs font-medium hover:bg-muted'
      }
    >
      {label}
    </button>
  );
}

function renderResult(r: ScanResult | null) {
  if (!r) {
    return (
      <p className="text-sm text-muted-foreground">
        Naskenuj nebo vlož ticket ID, abys viděl výsledek.
      </p>
    );
  }
  // Režim průchodu: obsluha musí směr poznat na první pohled, proto velké
  // písmo a barva. Vedle toho obsazenost — kolik lidí je právě uvnitř.
  if (r.result === 'released' || (r.result === 'admitted' && r.direction === 'entry')) {
    const odchod = r.result === 'released';
    return (
      <div
        className={`space-y-2 rounded-md border p-4 ${
          odchod ? 'border-amber-400 bg-amber-50' : 'border-emerald-400 bg-emerald-50'
        }`}
      >
        <div
          className={`text-3xl font-bold ${odchod ? 'text-amber-900' : 'text-emerald-900'}`}
        >
          {odchod ? '← ODCHOD' : '→ ' + (r.label ?? 'VSTUP')}
        </div>
        {r.ticket ? <TicketDetails t={r.ticket} /> : null}
        <div className="flex flex-wrap gap-4 text-xs">
          {typeof r.occupancy === 'number' ? (
            <span className="font-medium">Uvnitř: {r.occupancy}</span>
          ) : null}
          {typeof r.remaining === 'number' ? (
            <span>Zbývá vstupů: {r.remaining}</span>
          ) : null}
        </div>
      </div>
    );
  }
  if (r.result === 'duplicate') {
    return (
      <div className="space-y-2 rounded-md border border-slate-300 bg-slate-50 p-4">
        <div className="text-2xl font-bold text-slate-700">JIŽ NAČTENO</div>
        <p className="text-sm text-slate-700">{r.message}</p>
        {r.ticket ? <TicketDetails t={r.ticket} /> : null}
      </div>
    );
  }
  if (r.result === 'undone') {
    return (
      <div className="space-y-2 rounded-md border border-blue-300 bg-blue-50 p-4">
        <div className="text-2xl font-bold text-blue-900">OPRAVENO</div>
        <p className="text-sm text-blue-900">{r.message}</p>
      </div>
    );
  }
  if (r.result === 'denied') {
    return (
      <div className="space-y-2 rounded-md border border-rose-300 bg-rose-50 p-4">
        <div className="text-2xl font-bold text-rose-900">ZAMÍTNUTO</div>
        <p className="text-sm text-rose-900">{r.message}</p>
        {r.ticket ? <TicketDetails t={r.ticket} /> : null}
      </div>
    );
  }
  if (r.result === 'admitted') {
    return (
      <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3">
        <div className="flex items-center gap-2 text-emerald-900">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-semibold">
            Vstup povolen
            {r.kind === 'multi_day_redemption' ? ' (multi-day)' : ''}
          </span>
        </div>
        {r.ticket ? <TicketDetails t={r.ticket} /> : null}
        {r.admittedAt ? (
          <p className="text-xs text-emerald-700">
            Přijat: {new Date(r.admittedAt).toLocaleString('cs-CZ')}
          </p>
        ) : null}
      </div>
    );
  }
  if (r.result === 'already_used' || r.result === 'already_redeemed_today') {
    return (
      <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
        <div className="flex items-center gap-2 text-amber-900">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-semibold">
            {r.result === 'already_redeemed_today'
              ? 'Pro tento den už použito'
              : 'Lístek už byl použit'}
          </span>
        </div>
        {r.ticket ? <TicketDetails t={r.ticket} /> : null}
        {r.usedAt ? (
          <p className="text-xs text-amber-800">
            Použit: {new Date(r.usedAt).toLocaleString('cs-CZ')}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-rose-300 bg-rose-50 p-3">
      <div className="flex items-center gap-2 text-rose-900">
        <XCircle className="h-5 w-5" />
        <span className="font-semibold">{labelFor(r.result)}</span>
      </div>
      {r.message ? <p className="text-sm text-rose-800">{r.message}</p> : null}
      {r.picksRequired !== undefined && r.picksUsed !== undefined ? (
        <p className="text-xs text-rose-800">
          Flex pass: {r.picksUsed}/{r.picksRequired} dní vyčerpáno
        </p>
      ) : null}
      {r.ticket ? <TicketDetails t={r.ticket} /> : null}
    </div>
  );
}

function TicketDetails({ t }: { t: NonNullable<ScanResult['ticket']> }) {
  return (
    <div className="text-sm text-foreground">
      {t.verifyId ? (
        <div className="mb-2 rounded-md border-2 border-amber-500 bg-amber-100 px-3 py-2 text-lg font-bold uppercase tracking-wide text-amber-900" role="alert" data-testid="scan-verify-id">
          ⚠ {t.verifyId}
        </div>
      ) : null}
      <div className="font-medium">{t.eventTitle}</div>
      <div className="text-xs text-muted-foreground">{t.ticketTypeName}{t.category ? ` · ${t.category}` : ''}</div>
      {t.seat ? <div className="text-sm font-semibold" data-testid="scan-seat">{t.seat}</div> : null}
      <div className="text-xs text-muted-foreground">
        {t.holderName ? `${t.holderName} · ` : ''}
        {t.holderEmail}
      </div>
    </div>
  );
}

function labelFor(r: ScanResult['result']): string {
  switch (r) {
    case 'revoked':
      return 'Lístek zrušen';
    case 'not_found':
      return 'Lístek nenalezen';
    case 'invalid_token':
      return 'Neplatný kód vstupenky';
    case 'wrong_promoter':
      return 'Lístek jiného promotéra';
    case 'wrong_event':
      return 'Lístek na jinou akci';
    case 'totp_mismatch':
      return 'TOTP kód neodpovídá';
    case 'invalid_status':
      return 'Neplatný stav';
    case 'wrong_zone_or_day':
      return 'Lístek nemá přístup do této zóny / dne';
    case 'flex_limit_exhausted':
      return 'Flex pass vyčerpán';
    case 'day_not_picked':
      return 'Tento den není mezi vybranými termíny';
    case 'reentry_disabled':
      return 'Akce nemá povolený opakovaný vstup';
    case 'reentry_limit_exceeded':
      return 'Vyčerpaný počet vstupů';
    case 'already_inside':
      return 'Držitel je už uvnitř';
    case 'not_inside':
      return 'Držitel není evidovaný uvnitř';
    default:
      return 'Chyba';
  }
}
