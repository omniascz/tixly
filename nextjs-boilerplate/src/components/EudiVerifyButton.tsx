'use client';

import { useState } from 'react';

/**
 * B5 — ověření evropskou peněženkou (EUDI) se selektivním zveřejněním.
 * Fanoušek dokáže věk/rezidenci/„stejná osoba" bez odhalení identity.
 * „Na klíč": bez EUDI configu backend vrátí 503 a ukážeme neutrální hlášku.
 */

interface Props {
  eventId: string;
  orderId?: string;
}

export function EudiVerifyButton({ eventId, orderId }: Props) {
  const [loading, setLoading] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setMsg(null);
    setUri(null);
    try {
      const res = await fetch('/api/eudi/presentation-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, orderId }),
      });
      const j = (await res.json()) as { openid4vpUri?: string; message?: string; error?: string };
      if (res.status === 503) {
        setMsg('Ověření evropskou peněženkou bude aktivní po spuštění EUDI (mandát EU do 12/2026).');
        return;
      }
      if (!res.ok || !j.openid4vpUri) {
        setMsg(j.message ?? j.error ?? `Nepodařilo se zahájit ověření (HTTP ${res.status}).`);
        return;
      }
      setUri(j.openid4vpUri);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Chyba sítě.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
      <div className="flex items-center gap-2 font-semibold">
        <span aria-hidden>🇪🇺</span>
        Ověřit evropskou peněženkou
      </div>
      <p className="mt-1 text-xs">
        Dokážeš věk nebo rezidenci <strong>bez sdílení identity</strong> (selektivní zveřejnění).
        Anti-scalping bez sběru osobních dat.
      </p>
      {uri ? (
        <a
          href={uri}
          className="mt-2 inline-block rounded-md bg-sky-700 px-3 py-1.5 text-xs font-medium text-white"
        >
          Otevřít peněženku
        </a>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          disabled={loading}
          className="mt-2 rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-sky-100 disabled:opacity-60"
        >
          {loading ? 'Připravuji…' : 'Ověřit se peněženkou'}
        </button>
      )}
      {msg ? <p className="mt-2 text-xs text-sky-700">{msg}</p> : null}
    </div>
  );
}
