'use client';

/**
 * Nabídka očima agenta. Otevírá se odkazem, bez přihlášení a bez zakládání účtu.
 * Stránka je záměrně jednoduchá: podmínky, tři tlačítka, nic víc.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouteParams } from '@/lib/next/route-params';

interface BonusTier {
  atTickets?: number;
  atSelloutPct?: number;
  amountMinor: number;
}

interface Terms {
  royaltyType: string;
  percentRate: number | null;
  percentBase: string;
  flatMinor: number | null;
  perTicketMinor: number | null;
  minGuaranteeMinor: number | null;
  capMinor: number | null;
  depositMinor: number;
  backendPct: number | null;
  bonusTiers: BonusTier[];
  withholdingTaxPct: number;
}

interface Offer {
  artistName: string;
  agentName: string | null;
  promoterName: string | null;
  eventTitle: string | null;
  performanceDate: string | null;
  venueName: string | null;
  setLengthMinutes: number | null;
  currency: string;
  terms: Terms;
  note: string | null;
  validUntil: string | null;
  status: string;
  counterNote: string | null;
  signedAt: string | null;
  signerName: string | null;
}

function money(minor: number | null, currency: string): string {
  if (minor === null) return '—';
  return `${(minor / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} ${currency}`;
}

const TYPE_LABEL: Record<string, string> = {
  percent: 'Podíl z tržby',
  flat: 'Pevná částka',
  per_ticket: 'Částka za vstupenku',
  percent_plus_flat: 'Pevná částka a podíl z tržby',
};

export default function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = useRouteParams(params);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [canRespond, setCanRespond] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'none' | 'accept' | 'counter'>('none');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await fetch(`/api/offers/${token}`);
      const j = (await res.json()) as {
        offer?: Offer;
        canRespond?: boolean;
        message?: string;
      };
      if (!res.ok || !j.offer) {
        setError(j.message ?? 'Nabídka nebyla nalezena.');
        return;
      }
      setOffer(j.offer);
      setCanRespond(j.canRespond === true);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(action: 'accept' | 'decline' | 'counter'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/offers/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          signerName: signerName.trim() || undefined,
          signerEmail: signerEmail.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const j = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? 'Odpověď se nepodařilo odeslat.');
        return;
      }
      setDone(j.message ?? 'Odpověď odeslána.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="mx-auto max-w-2xl p-8 text-sm text-neutral-500">Načítám…</main>;
  }

  if (error && !offer) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="mb-2 text-xl font-semibold">Nabídka není dostupná</h1>
        <p className="text-sm text-neutral-600">{error}</p>
      </main>
    );
  }

  if (!offer) return null;
  const t = offer.terms;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 md:p-10">
      <header className="border-b pb-4">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Nabídka vystoupení {offer.promoterName ? `· ${offer.promoterName}` : ''}
        </p>
        <h1 className="mt-1 text-2xl font-bold">{offer.artistName}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {offer.eventTitle ?? '—'}
          {offer.performanceDate ? ` · ${new Date(offer.performanceDate).toLocaleDateString('cs-CZ')}` : ''}
          {offer.venueName ? ` · ${offer.venueName}` : ''}
          {offer.setLengthMinutes ? ` · set ${offer.setLengthMinutes} min` : ''}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Honorář</h2>
        <dl className="divide-y rounded-md border">
          <div className="flex justify-between p-3 text-sm">
            <dt>Typ</dt>
            <dd className="font-medium">{TYPE_LABEL[t.royaltyType] ?? t.royaltyType}</dd>
          </div>
          {t.percentRate !== null ? (
            <div className="flex justify-between p-3 text-sm">
              <dt>Podíl z tržby</dt>
              <dd className="font-medium">
                {t.percentRate} % {t.percentBase === 'net_of_vat' ? '(ze základu bez DPH)' : '(z ceny včetně DPH)'}
              </dd>
            </div>
          ) : null}
          {t.flatMinor !== null ? (
            <div className="flex justify-between p-3 text-sm">
              <dt>Pevná částka</dt>
              <dd className="font-medium">{money(t.flatMinor, offer.currency)}</dd>
            </div>
          ) : null}
          {t.perTicketMinor !== null ? (
            <div className="flex justify-between p-3 text-sm">
              <dt>Za vstupenku</dt>
              <dd className="font-medium">{money(t.perTicketMinor, offer.currency)}</dd>
            </div>
          ) : null}
          {t.minGuaranteeMinor !== null ? (
            <div className="flex justify-between p-3 text-sm">
              <dt>Minimální garance</dt>
              <dd className="font-medium">{money(t.minGuaranteeMinor, offer.currency)}</dd>
            </div>
          ) : null}
          {t.backendPct ? (
            <div className="flex justify-between p-3 text-sm">
              <dt>Podíl nad bodem zlomu</dt>
              <dd className="font-medium">{t.backendPct} %</dd>
            </div>
          ) : null}
          {t.capMinor !== null ? (
            <div className="flex justify-between p-3 text-sm">
              <dt>Strop honoráře</dt>
              <dd className="font-medium">{money(t.capMinor, offer.currency)}</dd>
            </div>
          ) : null}
          {t.depositMinor > 0 ? (
            <div className="flex justify-between p-3 text-sm">
              <dt>Záloha při podpisu</dt>
              <dd className="font-medium">{money(t.depositMinor, offer.currency)}</dd>
            </div>
          ) : null}
          {t.bonusTiers.length > 0 ? (
            <div className="p-3 text-sm">
              <dt className="mb-1">Bonusy</dt>
              <dd>
                <ul className="list-disc pl-5">
                  {t.bonusTiers.map((b, i) => (
                    <li key={i}>
                      {b.atTickets ? `od ${b.atTickets} vstupenek` : `od ${b.atSelloutPct} % vyprodanosti`}:{' '}
                      {money(b.amountMinor, offer.currency)}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {t.withholdingTaxPct > 0 ? (
            <div className="flex justify-between p-3 text-sm">
              <dt>Srážková daň</dt>
              <dd className="font-medium">{t.withholdingTaxPct} %</dd>
            </div>
          ) : null}
        </dl>
        {offer.note ? (
          <p className="whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-sm text-neutral-700">
            {offer.note}
          </p>
        ) : null}
        {offer.validUntil ? (
          <p className="text-xs text-neutral-500">
            Nabídka platí do {new Date(offer.validUntil).toLocaleDateString('cs-CZ')}.
          </p>
        ) : null}
      </section>

      {offer.status === 'accepted' ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          Nabídka byla přijata {offer.signedAt ? new Date(offer.signedAt).toLocaleString('cs-CZ') : ''}
          {offer.signerName ? ` — podepsal ${offer.signerName}` : ''}.
        </div>
      ) : null}
      {offer.status === 'declined' ? (
        <div className="rounded-md border p-4 text-sm text-neutral-700">Nabídka byla odmítnuta.</div>
      ) : null}
      {offer.status === 'countered' && offer.counterNote ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Protinávrh odeslán: {offer.counterNote}
        </div>
      ) : null}

      {done ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {done}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {canRespond ? (
        <section className="space-y-3 border-t pt-4">
          {mode === 'none' ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setMode('accept')}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
              >
                Přijmout nabídku
              </button>
              <button
                type="button"
                onClick={() => setMode('counter')}
                className="rounded-md border px-4 py-2 text-sm font-medium"
              >
                Poslat protinávrh
              </button>
              <button
                type="button"
                onClick={() => void respond('decline')}
                disabled={busy}
                className="rounded-md border px-4 py-2 text-sm font-medium text-rose-700"
              >
                Odmítnout
              </button>
            </div>
          ) : null}

          {mode === 'accept' ? (
            <div className="space-y-3">
              <p className="text-sm text-neutral-700">
                Přijetím potvrzujete uvedené podmínky. Zaznamenáme jméno, čas a adresu, ze které
                potvrzení přišlo — slouží to jako doklad o souhlasu.
              </p>
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Jméno a příjmení"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              <input
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="E-mail (nepovinné)"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void respond('accept')}
                  disabled={busy || signerName.trim().length === 0}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? 'Odesílám…' : 'Potvrdit a přijmout'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('none')}
                  className="rounded-md border px-4 py-2 text-sm"
                >
                  Zpět
                </button>
              </div>
            </div>
          ) : null}

          {mode === 'counter' ? (
            <div className="space-y-3">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder="Co byste chtěli změnit?"
                className="w-full rounded-md border p-3 text-sm"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void respond('counter')}
                  disabled={busy || note.trim().length === 0}
                  className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? 'Odesílám…' : 'Odeslat protinávrh'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('none')}
                  className="rounded-md border px-4 py-2 text-sm"
                >
                  Zpět
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
