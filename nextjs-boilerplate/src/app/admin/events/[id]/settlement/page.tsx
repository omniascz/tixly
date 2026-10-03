'use client';

/**
 * Vyúčtování s umělcem. Sestaví se ze současných dat, zkontroluje se
 * a uzavře — uzavřením se čísla zmrazí a založí se výplata.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouteParams } from '@/lib/next/route-params';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Agreement {
  id: string;
  artist_name: string;
  currency: string;
}

interface Settlement {
  id: string;
  agreement_id: string;
  artist_name: string;
  currency: string;
  status: 'draft' | 'closed' | 'signed' | 'void';
  tickets_sold: number;
  gross_revenue_minor: number;
  fee_minor: number;
  deposit_minor: number;
  withholding_minor: number;
  payable_minor: number;
  closed_at: string | null;
  signed_at: string | null;
  payout_id: string | null;
  document_hash: string | null;
}

interface Detail {
  document: string;
  tampered: boolean;
}

function money(minor: number, currency: string): string {
  return `${(minor / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} ${currency}`;
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

export default function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = useRouteParams(params);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [detail, setDetail] = useState<Record<string, Detail>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [aRes, sRes] = await Promise.all([
      authFetch(`/api/admin/events/${eventId}/royalties`),
      authFetch(`/api/admin/events/${eventId}/artist-settlements`),
    ]);
    if (aRes.ok) {
      const j = (await aRes.json()) as { agreements: Agreement[] };
      setAgreements(j.agreements);
    }
    if (sRes.ok) {
      const j = (await sRes.json()) as { settlements: Settlement[] };
      setSettlements(j.settlements);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function build(agreementId: string): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/artist-settlements`, {
        method: 'POST',
        body: JSON.stringify({ agreementId }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `Nepodařilo se sestavit (HTTP ${res.status}).`);
        return;
      }
      setMessage('Vyúčtování sestaveno. Zkontroluj čísla a teprve pak ho uzavři.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function close(settlementId: string): Promise<void> {
    if (
      !confirm(
        'Uzavřít vyúčtování? Čísla se zmrazí a nepůjde je změnit — pozdější úpravy se řeší dodatkem.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authFetch(
        `/api/admin/events/${eventId}/artist-settlements/${settlementId}/close`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `Nepodařilo se uzavřít (HTTP ${res.status}).`);
        return;
      }
      setMessage(j.message ?? 'Vyúčtování uzavřeno.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function showDocument(settlementId: string): Promise<void> {
    const res = await authFetch(
      `/api/admin/events/${eventId}/artist-settlements/${settlementId}`,
    );
    if (!res.ok) return;
    const j = (await res.json()) as Detail;
    setDetail((d) => ({ ...d, [settlementId]: j }));
  }

  const settledAgreementIds = new Set(settlements.map((s) => s.agreement_id));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Vyúčtování s umělcem"
        description="Uzavřený přehled po akci: prodej, tržba, náklady, honorář podle smlouvy a částka k výplatě."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {message}
        </div>
      ) : null}

      {agreements.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Akce nemá žádnou smlouvu o honoráři. Vyúčtování se počítá z ní.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Sestavit vyúčtování</h2>
            <div className="flex flex-wrap gap-2">
              {agreements.map((a) => (
                <Button
                  key={a.id}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void build(a.id)}
                >
                  {a.artist_name}
                  {settledAgreementIds.has(a.id) ? ' — přepočítat' : ''}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Sestavení použije aktuální prodej a rozpočet. Dokud je vyúčtování rozpracované,
              přepočítává se; uzavřením se čísla zmrazí.
            </p>
          </CardContent>
        </Card>
      )}

      {settlements.map((s) => (
        <Card key={s.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="text-base font-semibold">{s.artist_name}</h3>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  s.status === 'draft'
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-emerald-100 text-emerald-900'
                }`}
              >
                {s.status === 'draft' ? 'rozpracované' : 'uzavřené'}
              </span>
              {s.payout_id ? (
                <span className="text-xs text-muted-foreground">výplata založena</span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Prodáno</div>
                <div className="font-semibold tabular-nums">{s.tickets_sold}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Tržba</div>
                <div className="font-semibold tabular-nums">
                  {money(s.gross_revenue_minor, s.currency)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Honorář</div>
                <div className="font-semibold tabular-nums">{money(s.fee_minor, s.currency)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Záloha / daň</div>
                <div className="font-semibold tabular-nums">
                  {money(s.deposit_minor + s.withholding_minor, s.currency)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">K výplatě</div>
                <div
                  className={`font-semibold tabular-nums ${s.payable_minor < 0 ? 'text-rose-700' : ''}`}
                >
                  {money(s.payable_minor, s.currency)}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {s.status === 'draft' ? (
                <Button size="sm" disabled={busy} onClick={() => void close(s.id)}>
                  Uzavřít a založit výplatu
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => void showDocument(s.id)}>
                Zobrazit dokument
              </Button>
            </div>

            {detail[s.id] ? (
              <div className="space-y-2">
                {detail[s.id].tampered ? (
                  <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                    Uložená čísla nesouhlasí s otiskem pořízeným při uzavření. Dokument neposílej
                    dál a zjisti, kdo do dat sáhl.
                  </div>
                ) : null}
                <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">
                  {detail[s.id].document}
                </pre>
                {s.document_hash ? (
                  <p className="text-[11px] text-muted-foreground">
                    Otisk dokumentu: {s.document_hash.slice(0, 16)}…
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
