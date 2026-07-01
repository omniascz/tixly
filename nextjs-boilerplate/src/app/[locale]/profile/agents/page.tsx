'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * Správa nákupních AI agentů (C8) — člověk zaregistruje agenta a udělí mu delegovaný
 * mandát (max cena/počet/platnost). Agent pak nakupuje jen v těchto mezích.
 */

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

export default function AgentsPage() {
  const [name, setName] = useState('');
  const [agent, setAgent] = useState<{ agentId: string; apiKey: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Mandát
  const [maxPriceCzk, setMaxPriceCzk] = useState('2000');
  const [maxQty, setMaxQty] = useState('2');
  const [expiresInHours, setExpiresInHours] = useState('48');
  const [mandateMsg, setMandateMsg] = useState<string | null>(null);

  async function register() {
    if (!name.trim()) { setError('Zadej název agenta.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await authFetch('/api/buyer/agents/register', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      const j = (await res.json()) as { agentId?: string; apiKey?: string; message?: string; error?: string };
      if (!res.ok || !j.agentId || !j.apiKey) {
        setError(j.message ?? j.error ?? `Registrace selhala (HTTP ${res.status}).`);
        return;
      }
      setAgent({ agentId: j.agentId, apiKey: j.apiKey });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba sítě.');
    } finally {
      setBusy(false);
    }
  }

  async function grantMandate() {
    if (!agent) return;
    setBusy(true); setMandateMsg(null);
    try {
      const res = await authFetch(`/api/buyer/agents/${agent.agentId}/mandate`, {
        method: 'POST',
        body: JSON.stringify({
          maxPriceMinor: Math.round(Number(maxPriceCzk) * 100),
          maxQty: Number(maxQty),
          expiresInHours: Number(expiresInHours),
        }),
      });
      const j = (await res.json()) as { mandateId?: string; message?: string; error?: string };
      if (!res.ok || !j.mandateId) {
        setMandateMsg(j.message ?? j.error ?? `Mandát selhal (HTTP ${res.status}).`);
        return;
      }
      setMandateMsg(`✓ Mandát udělen — agent smí koupit max ${maxQty} vst. do ${maxPriceCzk} Kč/ks, ${expiresInHours} h.`);
    } catch (e) {
      setMandateMsg(e instanceof Error ? e.message : 'Chyba sítě.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4">
      <div>
        <Link href="../" className="text-sm text-primary hover:underline">← Zpět na profil</Link>
        <h1 className="mt-1 text-2xl font-bold">🤖 Nákupní agenti</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pověř svého AI asistenta nákupem lístků — v mezích, které mu ty určíš. Agent je vázaný
          na tvůj ověřený účet, takže nemůže obcházet limity (anti-scalping).
        </p>
      </div>

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      {!agent ? (
        <section className="space-y-2 rounded-lg border p-4">
          <div className="text-sm font-medium">1 · Zaregistruj agenta</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Např. Můj asistent"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void register()}
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy ? 'Registruji…' : 'Zaregistrovat agenta'}
          </button>
        </section>
      ) : (
        <>
          <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
            <div className="font-medium text-amber-900">✅ Agent zaregistrován — ulož si klíč (ukáže se jen teď)</div>
            <input
              readOnly
              value={agent.apiKey}
              onFocus={(e) => e.target.select()}
              className="w-full rounded border bg-white px-2 py-1 font-mono text-xs"
            />
            <p className="text-xs text-amber-800">Agent tímto klíčem (hlavička <code>x-agent-key</code>) žádá o autorizaci nákupu.</p>
          </section>

          <section className="space-y-2 rounded-lg border p-4">
            <div className="text-sm font-medium">2 · Uděl mandát (co smí)</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <label>Max cena / ks (Kč)
                <input type="number" min={0} value={maxPriceCzk} onChange={(e) => setMaxPriceCzk(e.target.value)}
                  className="mt-1 w-full rounded border bg-background px-2 py-1" />
              </label>
              <label>Max počet
                <input type="number" min={1} max={50} value={maxQty} onChange={(e) => setMaxQty(e.target.value)}
                  className="mt-1 w-full rounded border bg-background px-2 py-1" />
              </label>
              <label>Platnost (h)
                <input type="number" min={1} max={720} value={expiresInHours} onChange={(e) => setExpiresInHours(e.target.value)}
                  className="mt-1 w-full rounded border bg-background px-2 py-1" />
              </label>
            </div>
            {mandateMsg ? <div className="text-xs text-emerald-800">{mandateMsg}</div> : null}
            <button
              type="button"
              onClick={() => void grantMandate()}
              disabled={busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busy ? 'Uděluji…' : 'Udělit mandát'}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
