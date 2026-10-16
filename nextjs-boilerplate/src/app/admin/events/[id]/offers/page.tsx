'use client';

/**
 * Nabídky umělcům. Sestavení, odeslání odkazem a sledování odpovědi.
 * Přijetím nabídky vznikne smlouva o honoráři i položka v rozpočtu — sama.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRouteParams } from '@/lib/next/route-params';

interface Offer {
  id: string;
  version: number;
  artist_name: string;
  agent_name: string | null;
  agent_email: string | null;
  currency: string;
  royalty_type: string;
  percent_rate: string | null;
  flat_amount_halire: number | null;
  per_ticket_halire: number | null;
  min_guarantee_halire: number | null;
  backend_pct: string | null;
  deposit_minor: number;
  status: string;
  valid_until: string | null;
  sent_at: string | null;
  responded_at: string | null;
  counter_note: string | null;
  signed_at: string | null;
  signer_name: string | null;
  agreement_id: string | null;
  token_expires_at: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'koncept',
  sent: 'odesláno',
  countered: 'protinávrh',
  accepted: 'přijato',
  declined: 'odmítnuto',
  expired: 'propadlo',
  withdrawn: 'staženo',
  superseded: 'nahrazeno',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-800',
  sent: 'bg-blue-100 text-blue-900',
  countered: 'bg-amber-100 text-amber-900',
  accepted: 'bg-emerald-100 text-emerald-900',
  declined: 'bg-rose-100 text-rose-900',
};

function money(minor: number | null, currency: string): string {
  if (minor === null) return '—';
  return `${(minor / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} ${currency}`;
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

export default function OffersPage(_props: { params: Promise<{ id: string }> }) {
  const params = useParams<{ id: string }>();
  const { id: eventId } = useRouteParams(params);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const [artistName, setArtistName] = useState('');
  const [agentEmail, setAgentEmail] = useState('');
  const [guarantee, setGuarantee] = useState('');
  const [percent, setPercent] = useState('');
  const [backend, setBackend] = useState('');
  const [deposit, setDeposit] = useState('');
  const [validUntil, setValidUntil] = useState('');

  const load = useCallback(async (): Promise<void> => {
    const res = await authFetch(`/api/admin/events/${eventId}/offers`);
    if (!res.ok) return;
    const j = (await res.json()) as { offers: Offer[] };
    setOffers(j.offers);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(): Promise<void> {
    if (!artistName.trim()) {
      setError('Vyplň jméno umělce.');
      return;
    }
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const body: Record<string, unknown> = { artistName: artistName.trim() };
      if (agentEmail.trim()) body.agentEmail = agentEmail.trim();
      if (guarantee) body.minGuaranteeMinor = Math.round(Number(guarantee) * 100);
      if (percent) {
        body.percentRate = Number(percent);
        body.royaltyType = guarantee ? 'percent' : 'percent';
      }
      if (!percent && guarantee) body.royaltyType = 'flat';
      if (backend) body.backendPct = Number(backend);
      if (deposit) body.depositMinor = Math.round(Number(deposit) * 100);
      if (validUntil) body.validUntil = new Date(validUntil).toISOString();

      const res = await authFetch(`/api/admin/events/${eventId}/offers`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `Nepodařilo se uložit (HTTP ${res.status}).`);
        return;
      }
      setArtistName('');
      setAgentEmail('');
      setGuarantee('');
      setPercent('');
      setBackend('');
      setDeposit('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function send(offerId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/offers/${offerId}/send`, {
        method: 'POST',
        body: JSON.stringify({ validDays: 14 }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        link?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || !j.link) {
        setError(j.message ?? j.error ?? `Nepodařilo se odeslat (HTTP ${res.status}).`);
        return;
      }
      setLink(j.link);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Nabídky umělcům"
        description="Sestav nabídku, pošli agentovi odkaz a sleduj odpověď. Přijetím vznikne smlouva i položka v rozpočtu."
      />

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Nová nabídka</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Umělec</label>
              <Input value={artistName} onChange={(e) => setArtistName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">E-mail agenta</label>
              <Input value={agentEmail} onChange={(e) => setAgentEmail(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Platí do</label>
              <Input
                type="datetime-local"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Garance</label>
              <Input value={guarantee} onChange={(e) => setGuarantee(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Podíl z tržby %</label>
              <Input value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Nad bodem zlomu %</label>
              <Input value={backend} onChange={(e) => setBackend(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Záloha</label>
              <Input value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" />
            </div>
          </div>
          <Button onClick={create} disabled={busy}>
            {busy ? 'Ukládám…' : 'Vytvořit koncept'}
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {link ? (
        <div className="space-y-2 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
          <p className="font-medium">
            Odkaz pro agenta — ulož si ho hned, znovu ho zobrazit nejde.
          </p>
          <code className="block break-all rounded bg-white/70 p-2 text-xs">{link}</code>
        </div>
      ) : null}

      {offers.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Zatím žádná nabídka.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {offers.map((o) => (
            <Card key={o.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h3 className="text-base font-semibold">{o.artist_name}</h3>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[o.status] ?? 'bg-slate-100'}`}
                  >
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                  <span className="text-xs text-muted-foreground">verze {o.version}</span>
                  {o.agent_email ? (
                    <span className="text-xs text-muted-foreground">{o.agent_email}</span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-4 text-sm">
                  {o.min_guarantee_halire !== null ? (
                    <span>garance {money(o.min_guarantee_halire, o.currency)}</span>
                  ) : null}
                  {o.flat_amount_halire ? (
                    <span>pevně {money(o.flat_amount_halire, o.currency)}</span>
                  ) : null}
                  {o.per_ticket_halire ? (
                    <span>{money(o.per_ticket_halire, o.currency)} za vstupenku</span>
                  ) : null}
                  {o.percent_rate ? <span>{Number(o.percent_rate)} % z tržby</span> : null}
                  {o.backend_pct ? (
                    <span>{Number(o.backend_pct)} % nad bodem zlomu</span>
                  ) : null}
                  {o.deposit_minor > 0 ? (
                    <span>záloha {money(o.deposit_minor, o.currency)}</span>
                  ) : null}
                </div>

                {o.counter_note ? (
                  <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">
                    Protinávrh: {o.counter_note}
                  </p>
                ) : null}
                {o.signed_at ? (
                  <p className="text-xs text-emerald-700">
                    Přijato {new Date(o.signed_at).toLocaleString('cs-CZ')}
                    {o.signer_name ? ` — ${o.signer_name}` : ''}
                    {o.agreement_id ? ' · smlouva založena' : ''}
                  </p>
                ) : null}

                {o.status === 'draft' || o.status === 'sent' || o.status === 'countered' ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void send(o.id)}>
                    {o.status === 'draft' ? 'Odeslat agentovi' : 'Vydat nový odkaz'}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
