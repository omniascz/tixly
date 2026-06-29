'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface TransferInfo {
  to_email: string;
  expires_at: string;
  event_title: string;
  date_start: string;
  cover_image_url: string | null;
  venue_name: string;
  city: string;
  ticket_type_name: string;
}

export default function ClaimTransferPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [transfer, setTransfer] = useState<TransferInfo | null>(null);
  const [error, setError] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/tickets/transfer/${token}`)
      .then(r => r.json())
      .then((data: { transfer?: TransferInfo; error?: string }) => {
        if (data.error) setError(data.error);
        else setTransfer(data.transfer ?? null);
        setLoading(false);
      })
      .catch(() => { setError('Síťová chyba'); setLoading(false); });
  }, [token]);

  async function claim() {
    const userId = localStorage.getItem('userId');
    if (!userId) {
      router.push(`/cs/login?next=/cs/tickets/transfer/${token}`);
      return;
    }
    setClaiming(true);
    const r = await fetch(`/api/tickets/transfer/${token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
        Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}`,
      },
      body: '{}',
    });
    const data = (await r.json()) as { claimed?: boolean; error?: string };
    if (!r.ok) {
      setError(data.error ?? 'Chyba přijetí vstupenky');
    } else {
      setClaimed(true);
    }
    setClaiming(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Načítám přenos vstupenky...
      </div>
    );
  }

  if (error === 'TRANSFER_EXPIRED') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">⏰</div>
          <h1 className="text-xl font-bold mb-2">Platnost přesunu vypršela</h1>
          <p className="text-gray-400">Tento odkaz platil 72 hodin. Požádej odesílatele o nový.</p>
        </div>
      </div>
    );
  }

  if (error === 'TRANSFER_ALREADY_USED' || claimed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">{claimed ? '🎟️' : '✓'}</div>
          <h1 className="text-xl font-bold mb-2">
            {claimed ? 'Vstupenka přijata!' : 'Vstupenka již přijata'}
          </h1>
          {claimed && <p className="text-gray-400 mb-6">Vstupenku najdeš v Moje vstupenky.</p>}
          <Link href="/cs/my-tickets" className="bg-indigo-600 hover:bg-indigo-500 px-6 py-2 rounded-xl text-white font-medium">
            Moje vstupenky
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-red-400">
          <div className="text-4xl mb-3">⚠️</div>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!transfer) return null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl overflow-hidden">
          {transfer.cover_image_url && (
            <img src={transfer.cover_image_url} alt={transfer.event_title}
              className="w-full h-40 object-cover" />
          )}
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-1">Přijmout vstupenku</h1>
            <p className="text-gray-500 text-sm mb-6">
              Někdo ti posílá vstupenku na tuto akci
            </p>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-6 space-y-1">
              <div className="font-semibold text-lg">{transfer.event_title}</div>
              <div className="text-sm text-gray-500">
                {new Date(transfer.date_start).toLocaleDateString('cs', {
                  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                })}
              </div>
              <div className="text-sm text-gray-500">{transfer.venue_name} · {transfer.city}</div>
              <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mt-2">
                {transfer.ticket_type_name}
              </div>
            </div>

            <div className="text-xs text-gray-400 mb-4">
              Vyprší:{' '}
              {new Date(transfer.expires_at).toLocaleDateString('cs', {
                day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
              })}
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400 mb-4">
                {error === 'EMAIL_MISMATCH'
                  ? 'Vstupenka byla zaslána na jiný email. Přihlas se se správným účtem.'
                  : error}
              </div>
            )}

            <button
              onClick={claim}
              disabled={claiming}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-lg transition-colors disabled:opacity-50"
            >
              {claiming ? 'Přijímám...' : '🎟️ Přijmout vstupenku'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
