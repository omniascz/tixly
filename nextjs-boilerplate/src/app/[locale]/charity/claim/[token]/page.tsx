/**
 * Public charity claim page — beneficiary obdrží URL od charity,
 * zadá email/jméno, dostane free ticket.
 *
 * CZ priority #9 (FR/UK/IT audit, Tickets for Good pattern).
 */
'use client';

import { useEffect, useState, use, type JSX } from 'react';

type Preview = {
  status: string;
  expired: boolean;
  event: { id: string; title: string; dateStart: string };
  charityName: string;
  message: string | null;
  expiresAt: string;
};

export default function CharityClaimPage(
  props: {
    params: Promise<{ token: string; locale: string }>;
  }
): JSX.Element {
  const params = use(props.params);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<{ orderId: string } | null>(null);

  useEffect(() => {
    void fetch(`/api/charity/claim/${params.token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP_${r.status}`);
        }
        return r.json() as Promise<Preview>;
      })
      .then(setPreview)
      .catch((e: Error) => setError(e.message));
  }, [params.token]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/charity/claim/${params.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name.trim() || undefined }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP_${r.status}`);
      }
      const body = (await r.json()) as { orderId: string };
      setClaimed(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !preview) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-rose-700">Nedostupný odkaz</h1>
        <p className="mt-3 text-slate-600">
          {error === 'NOT_FOUND'
            ? 'Tato pozvánka neexistuje nebo byla odstraněna.'
            : 'Něco se pokazilo. Zkus obnovit stránku.'}
        </p>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <p className="text-slate-500">Načítám…</p>
      </main>
    );
  }

  if (claimed) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-emerald-700">
          Hotovo, vstupenka je tvá.
        </h1>
        <p className="mt-3 text-slate-600">
          E-mail s QR kódem pošleme na <strong>{email}</strong>. Vezmi si ho s
          sebou na <strong>{preview.event.title}</strong>.
        </p>
      </main>
    );
  }

  const isClosed = preview.status !== 'available' || preview.expired;
  const dateLabel = new Date(preview.event.dateStart).toLocaleString('cs-CZ', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wider text-emerald-700">
          Vstupenka od {preview.charityName}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">
          {preview.event.title}
        </h1>
        <p className="mt-2 text-slate-500">{dateLabel}</p>

        {preview.message && (
          <blockquote className="mt-6 rounded-lg bg-slate-50 p-4 text-slate-700">
            {preview.message}
          </blockquote>
        )}

        {isClosed ? (
          <p className="mt-6 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Tato pozvánka {preview.expired ? 'vypršela' : 'už byla využita'}.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              E-mail
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
                placeholder="tvuj@email.cz"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Jméno (volitelné)
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'Vystavuji…' : 'Vyzvednout vstupenku'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
