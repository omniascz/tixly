/**
 * Public group invitation claim page.
 *
 * Friend obdrží share URL, otevře tuto stránku → vidí event info,
 * organizer's jméno, target_seats a "X z N už zaplatilo" progress.
 * CTA pošle ho do checkoutu s groupInvitation query param.
 *
 * CZ priority #5 (FR/UK/IT audit). Public, no auth.
 */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Preview = {
  invitationId: string;
  status: string;
  expired: boolean;
  organizer: { userId: string; email: string; name: string | null };
  event: { id: string; title: string; dateStart: string };
  ticketTypeId: string | null;
  targetSeats: number;
  message: string | null;
  progress: { alreadyPaid: number; remaining: number; targetSeats: number };
  checkoutUrl: string;
  expiresAt: string;
};

export default function GroupClaimPage({
  params,
}: {
  params: { token: string; locale: string };
}): JSX.Element {
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/group-invitations/${params.token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP_${r.status}`);
        }
        return r.json() as Promise<Preview>;
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [params.token]);

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-rose-700">Pozvánka nedostupná</h1>
        <p className="mt-3 text-slate-600">
          {error === 'INVITATION_NOT_FOUND'
            ? 'Tento odkaz neexistuje nebo byl odstraněn.'
            : 'Něco se pokazilo. Zkus stránku obnovit.'}
        </p>
        <Link
          href={`/${params.locale}/events`}
          className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Procházet akce
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <p className="text-slate-500">Načítám pozvánku…</p>
      </main>
    );
  }

  const organizerLabel = data.organizer.name ?? data.organizer.email;
  const dateLabel = new Date(data.event.dateStart).toLocaleString('cs-CZ', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const isClosed = data.status !== 'open' || data.expired;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wider text-emerald-700">
          Pozvánka do skupiny
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">
          {organizerLabel} tě zve na {data.event.title}
        </h1>
        <p className="mt-2 text-slate-500">{dateLabel}</p>

        {data.message && (
          <blockquote className="mt-6 rounded-lg bg-slate-50 p-4 text-slate-700">
            <span className="text-slate-400">{'„'}</span>
            {data.message}
            <span className="text-slate-400">{'"'}</span>
          </blockquote>
        )}

        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          <Stat label="Plánuje přijít" value={data.progress.targetSeats} />
          <Stat label="Už zaplatilo" value={data.progress.alreadyPaid} />
          <Stat label="Zbývá míst" value={data.progress.remaining} />
        </div>

        <div className="mt-8 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{
              width: `${Math.min(100, (data.progress.alreadyPaid / data.progress.targetSeats) * 100).toFixed(0)}%`,
            }}
          />
        </div>

        <div className="mt-8">
          {isClosed ? (
            <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Pozvánka {data.expired ? 'vypršela' : 'už není aktivní'}. Můžeš si
              ale stále koupit vstupenku samostatně.
            </p>
          ) : (
            <Link
              href={data.checkoutUrl}
              className="block w-full rounded-md bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Připojit se a koupit vstupenku
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}
