'use client';

import { useState } from 'react';

/**
 * A4 — buyer vstupní bod pro skupinový nákup „seďte spolu, plaťte každý své".
 *
 * Drží N sousedních sedadel (48h) a vrátí sdílecí odkaz. Přátelé pak přes odkaz
 * claimnou své sedadlo a každý zaplatí svůj podíl vlastní platební bránou.
 * Backend: POST /api/buyer/group-invitations/reserve.
 */

interface Props {
  eventId: string;
  ticketTypeId: string;
}

interface ReserveResult {
  inviteUrl: string;
  seats: { id: string; label: string }[];
  holdExpiresAt: string;
}

export function GroupReserveButton({ eventId, ticketTypeId }: Props) {
  const [open, setOpen] = useState(false);
  const [seatCount, setSeatCount] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReserveResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function reserve() {
    setLoading(true);
    setError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const res = await fetch('/api/buyer/group-invitations/reserve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ eventId, ticketTypeId, seatCount }),
      });
      const j = (await res.json()) as ReserveResult & { error?: string; message?: string };
      if (!res.ok) {
        if (res.status === 401) setError('Nejdřív se přihlas — pak můžeš rezervovat pro partu.');
        else if (j.error === 'NO_ADJACENT_SEATS') setError(j.message ?? 'Tolik sousedních sedadel jsme nenašli.');
        else setError(j.message ?? j.error ?? `Nepodařilo se rezervovat (HTTP ${res.status}).`);
        return;
      }
      setResult({ inviteUrl: j.inviteUrl, seats: j.seats, holdExpiresAt: j.holdExpiresAt });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba sítě.');
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard nedostupný — uživatel zkopíruje ručně */
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-primary hover:underline"
      >
        👥 Rezervovat pro partu
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border bg-muted/30 p-3 text-xs">
      {result ? (
        <div className="space-y-2">
          <div className="font-medium text-emerald-800">
            ✅ Drží se {result.seats.length} sousedních sedadel — pošli odkaz kamarádům.
          </div>
          <div className="text-muted-foreground">
            {result.seats.map((s) => s.label).join(' · ')}
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={result.inviteUrl}
              className="flex-1 rounded border bg-background px-2 py-1"
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              onClick={copyLink}
              className="rounded bg-primary px-2 py-1 font-medium text-primary-foreground"
            >
              {copied ? 'Zkopírováno ✓' : 'Kopírovat'}
            </button>
          </div>
          <p className="text-muted-foreground">
            Každý kamarád si přes odkaz vezme své sedadlo a zaplatí sám za sebe. Nezabraná
            sedadla se za 48 h uvolní.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="font-medium">Seďte spolu, plaťte každý své</div>
          <p className="text-muted-foreground">
            Zamluvíme sousední sedadla, ty pošleš odkaz partě — každý si vezme své a zaplatí sám.
          </p>
          <label className="flex items-center gap-2">
            Počet sedadel:
            <select
              value={seatCount}
              onChange={(e) => setSeatCount(Number(e.target.value))}
              className="rounded border bg-background px-2 py-1"
            >
              {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          {error ? <div className="text-rose-700">{error}</div> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void reserve()}
              disabled={loading}
              className="rounded bg-primary px-3 py-1 font-medium text-primary-foreground disabled:opacity-60"
            >
              {loading ? 'Držím sedadla…' : 'Zamluvit a získat odkaz'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:underline">
              Zrušit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
