'use client';

/** Zrušení rezervace odkazem z e-mailu (kolo 8 / krok 5) — kupec potvrdí tlačítkem, místa se vrátí do prodeje. */
import { useState, use } from 'react';

export default function CancelReservationPage(props: { searchParams: Promise<{ code?: string; token?: string }> }) {
  const searchParams = use(props.searchParams);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const code = searchParams.code ?? '';

  async function cancel() {
    setState('busy');
    const r = await fetch('/api/public/seat-reservations/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, token: searchParams.token ?? '' }),
    });
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
    if (r.ok) { setState('done'); return; }
    setState('error');
    setMsg(j.message ?? j.error ?? `HTTP ${r.status}`);
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-10">
      <h1 className="text-2xl font-bold">Zrušení rezervace {code}</h1>
      {state === 'done' ? (
        <p className="rounded-md bg-emerald-50 p-3 text-emerald-900" data-testid="cancel-done">Rezervace je zrušená a místa jsme uvolnili. Potvrzení vám přijde e-mailem.</p>
      ) : (
        <>
          <p>Opravdu chcete rezervaci zrušit? Místa se vrátí do prodeje.</p>
          {state === 'error' && <p role="alert" className="rounded-md bg-rose-50 p-3 text-rose-900">{msg}</p>}
          <button
            onClick={() => void cancel()}
            disabled={state === 'busy' || !code}
            className="w-full rounded-md bg-rose-700 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
          >
            Zrušit rezervaci
          </button>
        </>
      )}
    </div>
  );
}
