/**
 * GroupInviteButton — buyer-organizer vygeneruje share link pro
 * group bookings (CZ priority #5).
 *
 * Login required. Když není přihlášený → "Přihlas se a vytvoř pozvánku".
 * Po vytvoření zobrazí URL s copy-to-clipboard.
 */
'use client';

import { Users } from 'lucide-react';
import { useState } from 'react';

type Created = { inviteUrl: string };

export function GroupInviteButton({
  eventId,
  ticketTypeId,
}: {
  eventId: string;
  ticketTypeId?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(4);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/buyer/group-invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          ticketTypeId,
          targetSeats: target,
          message: message.trim() || undefined,
        }),
      });
      if (r.status === 401) {
        setError('Pro vytvoření skupinové pozvánky se přihlas.');
        return;
      }
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP_${r.status}`);
      }
      const body = (await r.json()) as Created;
      setResult(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(): Promise<void> {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
      >
        <Users className="h-3.5 w-3.5" />
        Pozvi skupinu
      </button>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-slate-900">
        Pozvi kamarády na tuhle akci
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Vytvoří share link. Každý si platí sám, ale uvidíš kdo už koupil.
      </p>

      {result ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-emerald-700">
            Pozvánka vytvořena.
          </p>
          <input
            readOnly
            value={result.inviteUrl}
            onClick={(e) => e.currentTarget.select()}
            className="mt-2 w-full rounded-md border bg-slate-50 px-2 py-1.5 text-xs"
          />
          <button
            type="button"
            onClick={copyLink}
            className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            {copied ? 'Zkopírováno' : 'Kopírovat odkaz'}
          </button>
        </div>
      ) : (
        <>
          <label className="mt-3 block text-xs font-medium text-slate-700">
            Kolik lidí má přijít? (2–50)
            <input
              type="number"
              min={2}
              max={50}
              value={target}
              onChange={(e) =>
                setTarget(Math.max(2, Math.min(50, Number(e.target.value) || 2)))
              }
              className="mt-1 block w-24 rounded-md border px-2 py-1 text-sm"
            />
          </label>
          <label className="mt-3 block text-xs font-medium text-slate-700">
            Zpráva pro kamarády (volitelné)
            <textarea
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              className="mt-1 block w-full rounded-md border px-2 py-1 text-sm"
              placeholder="Pojďte se mnou na koncert!"
            />
          </label>
          {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={create}
              disabled={busy}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'Vytvářím…' : 'Vytvořit pozvánku'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border px-3 py-1.5 text-xs"
            >
              Zrušit
            </button>
          </div>
        </>
      )}
    </div>
  );
}
