'use client';

import { useState } from 'react';
import { typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface Props {
  eventId: string;
  brandColor: string;
}

export function VerifiedFanForm({ eventId, brandColor }: Props) {
  const [motivation, setMotivation] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await typedPost(
        `/api/events/${eventId}/verified-fan`,
        { motivation: motivation || undefined },
        { throwOnError: true },
      );
      setSuccess(true);
    } catch (err) {
      if (err instanceof TypedFetchError) {
        const body = err.body as { error?: string; message?: string } | undefined;
        if (err.status === 401) {
          setError('Pro registraci se prosím přihlas nebo si vytvoř účet.');
        } else if (body?.error === 'ALREADY_REGISTERED') {
          setError('Už jsi registrovaný/á — počkej na výběr před onsale.');
        } else {
          setError(body?.message ?? body?.error ?? 'Chyba serveru');
        }
      } else {
        setError('Síťová chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4">
        <p className="text-sm font-medium text-emerald-900">
          ✅ Registrace přijata.
        </p>
        <p className="mt-2 text-xs text-emerald-800">
          Pokud budeš vybrán/a, dostaneš email s unikátním presale kódem před
          oficiálním onsale. Žádná akce nutná — jen čekej na zprávu.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium">
          Proč chceš jít na tuto akci? (volitelné)
        </label>
        <textarea
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Sleduji tuto kapelu už 10 let..."
          className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {motivation.length}/1000 znaků
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="w-full rounded-md px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        style={{ background: brandColor }}
      >
        {busy ? 'Registruji…' : 'Registrovat jako fanoušek'}
      </button>

      <p className="text-[11px] text-center text-muted-foreground">
        Registrací souhlasíš s <a href="/cs/legal/verified-fan-terms" className="underline">podmínkami</a>.
        Tvé údaje použijeme jen pro výběr fanoušků k presale.
      </p>
    </div>
  );
}
