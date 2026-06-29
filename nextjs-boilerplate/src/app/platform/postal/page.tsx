'use client';

import { useEffect, useState } from 'react';

interface PostalDelivery {
  id: string;
  order_id: string;
  recipient_name: string;
  address_line1: string;
  city: string;
  postal_code: string;
  country: string;
  status: 'pending' | 'dispatched' | 'delivered' | 'returned';
  tracking_number: string | null;
  carrier: string | null;
  dispatched_at: string | null;
  event_title: string;
  buyer_email: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Čeká na expedici',
  dispatched: 'Odesláno',
  delivered: 'Doručeno',
  returned: 'Vráceno',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-400',
  dispatched: 'text-blue-400',
  delivered: 'text-green-400',
  returned: 'text-red-400',
};

function authFetch(url: string, init?: RequestInit) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function PostalFulfillmentPage() {
  const [deliveries, setDeliveries] = useState<PostalDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('pending');
  const [updating, setUpdating] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});

  async function load() {
    const r = await authFetch(`/api/platform/postal?status=${filter}`);
    if (r.ok) {
      const data = (await r.json()) as { deliveries: PostalDelivery[] };
      setDeliveries(data.deliveries ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [filter]);

  async function updateStatus(id: string, status: string, trackingNumber?: string, carrier?: string) {
    setUpdating(id);
    await authFetch(`/api/platform/postal/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, trackingNumber, carrier }),
    });
    await load();
    setUpdating(null);
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Fyzické doručení — fronta</h1>
        <div className="flex gap-2">
          {(['pending', 'dispatched', 'delivered', 'returned'] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === s ? 'bg-indigo-600 text-white' : 'bg-gray-800 hover:bg-gray-700'
              }`}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 py-12 text-center">Načítám...</div>
      ) : deliveries.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">📦</div>
          <p>Žádné zásilky ve stavu „{STATUS_LABELS[filter]}"</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deliveries.map(d => (
            <div key={d.id} className="bg-gray-900 rounded-xl p-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-medium ${STATUS_COLORS[d.status]}`}>
                      {STATUS_LABELS[d.status]}
                    </span>
                    {d.carrier && <span className="text-xs text-gray-500">{d.carrier}</span>}
                  </div>
                  <div className="font-semibold">{d.recipient_name}</div>
                  <div className="text-sm text-gray-400">
                    {d.address_line1}, {d.postal_code} {d.city}, {d.country}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Akce: {d.event_title} · Kupující: {d.buyer_email}
                  </div>
                  {d.tracking_number && (
                    <div className="text-sm text-indigo-400 mt-1">
                      Sledování: {d.tracking_number}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {d.status === 'pending' && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Číslo zásilky"
                        value={trackingInputs[d.id] ?? ''}
                        onChange={e => setTrackingInputs(prev => ({ ...prev, [d.id]: e.target.value }))}
                        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm w-44"
                      />
                      <button
                        onClick={() => updateStatus(d.id, 'dispatched', trackingInputs[d.id], 'PPL')}
                        disabled={updating === d.id}
                        className="bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                      >
                        Odesláno
                      </button>
                    </div>
                  )}
                  {d.status === 'dispatched' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateStatus(d.id, 'delivered')}
                        disabled={updating === d.id}
                        className="bg-green-600 hover:bg-green-500 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                      >
                        ✓ Doručeno
                      </button>
                      <button
                        onClick={() => updateStatus(d.id, 'returned')}
                        disabled={updating === d.id}
                        className="bg-red-700 hover:bg-red-600 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                      >
                        Vráceno
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
