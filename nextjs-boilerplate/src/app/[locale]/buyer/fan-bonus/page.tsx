'use client';

import { useEffect, useState, type JSX } from 'react';

interface BonusEntry {
  orderId: string;
  eventId: string;
  earnedHalire: number;
  bonusPct: number;
  voucherCode: string;
  balanceHalire: number;
  expiresAt: string;
  createdAt: string;
}
interface Data {
  totalAvailable: number;
  history: BonusEntry[];
}

const fmt = (h: number) =>
  `${(h / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 0 })} Kč`;

export default function FanBonusWalletPage(): JSX.Element {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    fetch('/api/buyer/fan-bonus', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((d) => { setData(d as Data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function copyCode(code: string) {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-slate-400">
        Načítám…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center text-slate-500">
        Pro zobrazení FanBonus kreditů se prosím přihlaste.
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">💰 Moje FanBonus kredity</h1>
        <p className="text-slate-500 text-sm mt-1">
          Cashback 2–3 % z každého nákupu vstupenky. Použijte kód při příštím nákupu.
        </p>
      </div>

      {/* Total balance */}
      <div className={`rounded-xl p-5 ${data.totalAvailable > 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}`}>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
          Celkový dostupný kredit
        </div>
        <div className={`text-4xl font-bold ${data.totalAvailable > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
          {fmt(data.totalAvailable)}
        </div>
        {data.totalAvailable > 0 && (
          <p className="text-sm text-emerald-800 mt-2">
            Zadejte kód níže do pole „Slevový kód" při příštím nákupu vstupenky.
          </p>
        )}
      </div>

      {/* How to use */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-4 text-sm text-indigo-900">
        <strong>Jak uplatnit:</strong> V checkoutu najděte pole{' '}
        <em>„Slevový kód / voucher"</em>, zadejte kód{' '}
        <code className="bg-indigo-100 px-1 rounded font-mono">FB-XXXX-XXXX</code>{' '}
        a sleva se odečte z ceny objednávky. Každý kód lze uplatnit opakovaně, dokud není vyčerpán zůstatek.
      </div>

      {/* History */}
      {data.history.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🎫</div>
          <h2 className="text-lg font-semibold text-slate-700">Zatím žádné bonusy</h2>
          <p className="text-slate-500 text-sm mt-1">
            FanBonus obdržíte automaticky po nákupu vstupenky na akci s aktivním FanBonus.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="font-semibold text-slate-800">Historie ({data.history.length})</h2>
          {data.history.map((entry) => {
            const expired = new Date(entry.expiresAt) < new Date();
            const used    = entry.balanceHalire === 0;
            const status  = expired ? 'expired' : used ? 'used' : 'available';
            return (
              <div
                key={entry.orderId}
                className={`rounded-xl border p-4 ${
                  status === 'available' ? 'border-emerald-200 bg-white' :
                  'border-slate-200 bg-slate-50 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <code className="font-mono font-bold text-sm tracking-wider text-slate-900">
                        {entry.voucherCode}
                      </code>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        status === 'available' ? 'bg-emerald-100 text-emerald-800' :
                        status === 'used'      ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {status === 'available' ? '✓ Aktivní' : status === 'used' ? 'Vyčerpáno' : 'Expirováno'}
                      </span>
                    </div>

                    <div className="flex gap-4 text-xs text-slate-500 flex-wrap">
                      <span>Vydáno: <strong className="text-slate-700">{fmt(entry.earnedHalire)}</strong></span>
                      <span>Zůstatek: <strong className={entry.balanceHalire > 0 ? 'text-emerald-700' : 'text-slate-400'}>
                        {fmt(entry.balanceHalire)}
                      </strong></span>
                      <span>Cashback: {entry.bonusPct} %</span>
                      <span>Platí do: {new Date(entry.expiresAt).toLocaleDateString('cs-CZ')}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Vydáno {new Date(entry.createdAt).toLocaleDateString('cs-CZ')}
                    </div>
                  </div>

                  {status === 'available' && (
                    <button
                      onClick={() => copyCode(entry.voucherCode)}
                      className={`shrink-0 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                        copied === entry.voucherCode
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      {copied === entry.voucherCode ? '✓ Zkopírováno' : 'Kopírovat kód'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
