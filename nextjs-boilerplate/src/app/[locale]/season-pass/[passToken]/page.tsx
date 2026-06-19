'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface PassInfo {
  id: string;
  holderEmail: string;
  holderName: string | null;
  usesRemaining: number;
  totalUses: number;
  validUntil: string;
  status: string;
  productTitle: string;
  promoterName: string;
  promoterSlug: string;
}

interface UseRecord {
  id: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  usedAt: string;
}

interface UpcomingEvent {
  id: string;
  title: string;
  dateStart: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SeasonPassPage() {
  const params = useParams<{ passToken: string }>();
  const passToken = params?.passToken ?? '';

  const [pass, setPass] = useState<PassInfo | null>(null);
  const [uses, setUses] = useState<UseRecord[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showEvents, setShowEvents] = useState(false);
  const [useBusy, setUseBusy] = useState(false);
  const [useError, setUseError] = useState<string | null>(null);
  const [useSuccess, setUseSuccess] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/season-passes/${passToken}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setError(j.error ?? 'Chyba načítání pasu');
        return;
      }
      const data = await res.json() as {
        pass: PassInfo;
        uses: UseRecord[];
        upcomingEvents: UpcomingEvent[];
      };
      setPass(data.pass);
      setUses(data.uses);
      setUpcomingEvents(data.upcomingEvents);
    } catch {
      setError('Nepodařilo se načíst sezónní pas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (passToken) void load();
  }, [passToken]);

  async function usePassForEvent(eventId: string, eventTitle: string) {
    setUseBusy(true);
    setUseError(null);
    setUseSuccess(null);
    try {
      const res = await fetch(`/api/season-passes/${passToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      const j = await res.json() as {
        error?: string;
        ticketId?: string;
        usesRemaining?: number;
        eventTitle?: string;
      };
      if (!res.ok) {
        const messages: Record<string, string> = {
          NO_USES_REMAINING: 'Nemáš žádné zbývající vstupy.',
          PASS_EXPIRED: 'Sezónní pas vypršel.',
          PASS_NOT_ACTIVE: 'Pas není aktivní.',
          EVENT_PAST: 'Toto představení již proběhlo.',
          NO_COMP_TICKET_TYPE: 'Pro toto představení není k dispozici vstupenka.',
          EVENT_NOT_FOUND: 'Představení nenalezeno.',
        };
        setUseError(messages[j.error ?? ''] ?? (j.error ?? 'Chyba při použití pasu'));
        return;
      }
      setUseSuccess(`Vstupenka na "${j.eventTitle ?? eventTitle}" byla vystavena!`);
      setShowEvents(false);
      await load();
    } finally {
      setUseBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center text-muted-foreground">
        Načítám sezónní pas…
      </div>
    );
  }

  if (error || !pass) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-destructive">{error ?? 'Pas nenalezen.'}</p>
      </div>
    );
  }

  const usedCount = pass.totalUses - pass.usesRemaining;
  const progressPct = pass.totalUses > 0 ? Math.round((usedCount / pass.totalUses) * 100) : 0;
  const isActive = pass.status === 'active' && pass.usesRemaining > 0 && new Date(pass.validUntil).getTime() > Date.now();

  return (
    <div className="mx-auto max-w-xl space-y-6 py-8 px-4">
      <div>
        <h1 className="text-2xl font-bold">{pass.productTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{pass.promoterName}</p>
        {pass.holderName && (
          <p className="mt-1 text-sm text-muted-foreground">Držitel: {pass.holderName}</p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            Moje sezónní karta
            <Badge
              className={
                pass.status === 'active'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
              }
            >
              {pass.status === 'active' ? 'Aktivní' : pass.status === 'expired' ? 'Vypršela' : 'Zrušena'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <p className="text-4xl font-bold tabular-nums">
              {pass.usesRemaining}
              <span className="text-xl font-normal text-muted-foreground">
                {' '}/ {pass.totalUses}
              </span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">zbývajících vstupů</p>
          </div>

          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Zbývá {pass.usesRemaining} z {pass.totalUses} vstupů</span>
              <span>{progressPct} % využito</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Platnost do</span>
            <span className="font-medium">{formatDate(pass.validUntil)}</span>
          </div>

          {useSuccess && (
            <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
              {useSuccess}
            </div>
          )}
          {useError && (
            <div className="rounded-md bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">
              {useError}
            </div>
          )}

          {isActive && (
            <Button
              className="w-full"
              onClick={() => { setShowEvents((v) => !v); setUseError(null); }}
              disabled={useBusy}
            >
              {showEvents ? 'Zavřít výběr' : 'Použít na představení'}
            </Button>
          )}
        </CardContent>
      </Card>

      {showEvents && upcomingEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vyberte představení</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcomingEvents.map((ev) => (
              <div
                key={ev.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div>
                  <p className="font-medium text-sm">{ev.title}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(ev.dateStart)}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={useBusy}
                  onClick={() => void usePassForEvent(ev.id, ev.title)}
                >
                  Vybrat
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {showEvents && upcomingEvents.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Žádná nadcházející představení.
          </CardContent>
        </Card>
      )}

      {uses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historie použití</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {uses.map((u) => (
              <div key={u.id} className="flex items-start justify-between text-sm border-b pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="font-medium">{u.eventTitle}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(u.eventDate)}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">
                  {new Date(u.usedAt).toLocaleDateString('cs-CZ')}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
