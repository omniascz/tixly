'use client';

import { useState } from 'react';
import { typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface Props {
  packageId: string;
  brandColor: string;
  label: string;
  locale: 'cs' | 'sk' | 'en';
}

const STRINGS = {
  cs: {
    email: 'E-mail',
    name: 'Jméno a příjmení',
    phone: 'Telefon (volitelný)',
    purchase: 'Pokračovat k platbě',
    purchasing: 'Vytvářím objednávku…',
    cancel: 'Zrušit',
    soldOut: 'Vyprodáno mezitím',
    seatTaken: 'Místo již obsazeno jiným kupcem',
    saleNotStarted: 'Prodej zatím nezačal',
    saleEnded: 'Prodej skončil',
    error: 'Chyba',
  },
  sk: {
    email: 'E-mail',
    name: 'Meno a priezvisko',
    phone: 'Telefón (voliteľný)',
    purchase: 'Pokračovať na platbu',
    purchasing: 'Vytváram objednávku…',
    cancel: 'Zrušiť',
    soldOut: 'Medzitým vypredané',
    seatTaken: 'Miesto už obsadené',
    saleNotStarted: 'Predaj ešte nezačal',
    saleEnded: 'Predaj skončil',
    error: 'Chyba',
  },
  en: {
    email: 'Email',
    name: 'Full name',
    phone: 'Phone (optional)',
    purchase: 'Continue to payment',
    purchasing: 'Creating order…',
    cancel: 'Cancel',
    soldOut: 'Sold out',
    seatTaken: 'Seat already taken',
    saleNotStarted: 'Sale not started',
    saleEnded: 'Sale ended',
    error: 'Error',
  },
} as const;

const ERROR_MAP: Record<string, keyof (typeof STRINGS)['cs']> = {
  SOLD_OUT: 'soldOut',
  SEAT_TAKEN: 'seatTaken',
  SALE_NOT_STARTED: 'saleNotStarted',
  SALE_ENDED: 'saleEnded',
};

export function BuyButton({ packageId, brandColor, label, locale }: Props) {
  const t = STRINGS[locale] ?? STRINGS.cs;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data = await typedPost<{ gatewayUrl: string }>(
        '/api/subscriptions/checkout',
        {
          packageId,
          buyerEmail: email,
          buyerName: name,
          buyerPhone: phone || undefined,
        },
        { throwOnError: true, auth: false },
      );
      window.location.href = data.gatewayUrl;
    } catch (err) {
      if (err instanceof TypedFetchError) {
        const body = err.body as { error?: string } | undefined;
        const code = body?.error ?? '';
        const key = ERROR_MAP[code];
        setError(key ? t[key] : `${t.error}: ${code}`);
      } else {
        setError(t.error);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center rounded-md px-6 py-2 text-sm font-medium text-white"
        style={{ background: brandColor }}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-lg border bg-card p-4 text-left">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium">{t.name}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">{t.email}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">{t.phone}</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        {error ? (
          <p className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={busy || !email || !name}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: brandColor }}
          >
            {busy ? t.purchasing : t.purchase}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted/40"
          >
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
