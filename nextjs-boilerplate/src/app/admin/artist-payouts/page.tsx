'use client';

import { useEffect, useState } from 'react';

interface ArtistPayout {
  id: string;
  artist_name: string;
  artist_email: string | null;
  bank_iban: string | null;
  period_from: string | null;
  period_to: string | null;
  gross_royalties_halire: number;
  adjustments_halire: number;
  net_payout_halire: number;
  currency: string;
  status: string;
  paid_at: string | null;
  payout_method: string | null;
  external_ref: string | null;
  notes: string | null;
  created_at: string;
  event_id: string;
  event_title: string;
}

const fmt = (h: number, cur = 'CZK') => `${(h / 100).toLocaleString('cs-CZ')} ${cur}`;

const STATUS_LABEL: Record<string, string> = {
  pending: 'Čeká', approved: 'Schváleno', processing: 'Probíhá',
  paid: 'Zaplaceno', failed: 'Selhalo', cancelled: 'Zrušeno',
};
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  approved: 'bg-blue-100 text-blue-800',
  processing: 'bg-indigo-100 text-indigo-800',
  paid: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-orange-100 text-orange-800',
};
const TRANSITION_ACTIONS: Record<string, Array<{ label: string; status: string; cls: string }>> = {
  pending:    [{ label: 'Schválit', status: 'approved', cls: 'border-blue-300 text-blue-700 hover:bg-blue-50' }, { label: 'Zrušit', status: 'cancelled', cls: 'border-red-200 text-red-600 hover:bg-red-50' }],
  approved:   [{ label: 'Odeslat', status: 'processing', cls: 'border-indigo-300 text-indigo-700 hover:bg-indigo-50' }, { label: 'Zrušit', status: 'cancelled', cls: 'border-red-200 text-red-600 hover:bg-red-50' }],
  processing: [{ label: 'Zaplaceno ✓', status: 'paid', cls: 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' }, { label: 'Selhalo', status: 'failed', cls: 'border-red-200 text-red-600 hover:bg-red-50' }],
  failed:     [{ label: 'Zkusit znovu', status: 'pending', cls: 'border-slate-300 text-slate-700 hover:bg-slate-50' }],
};

export default function ArtistPayoutsPage() {
  const [payouts, setPayouts] = useState<ArtistPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCalc, setShowCalc] = useState(false);
  const [calcFrom, setCalcFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [calcTo, setCalcTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<{ created: number } | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editMethod, setEditMethod] = useState('');
  const [editRef, setEditRef] = useState('');

  async function load() {
    setLoading(true);
    const r = await fetch('/api/admin/artist-payouts');
    const d = await r.json() as { payouts: ArtistPayout[] };
    setPayouts(d.payouts ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleCalculate(e: React.FormEvent) {
    e.preventDefault();
    setCalculating(true); setCalcResult(null);
    const r = await fetch('/api/admin/artist-payouts/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodFrom: calcFrom, periodTo: calcTo }),
    });
    const d = await r.json() as { created: number };
    setCalcResult(d);
    setCalculating(false);
    if (d.created > 0) { setShowCalc(false); await load(); }
  }

  async function transition(id: string, status: string) {
    const payout = payouts.find((p) => p.id === id);
    const body: Record<string, unknown> = { status };
    if (status === 'paid') {
      body.payout_method = payout?.payout_method ?? 'bank_transfer';
    }
    await fetch(`/api/admin/artist-payouts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await load();
  }

  async function saveEdit(id: string) {
    await fetch(`/api/admin/artist-payouts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: editNotes || undefined,
        payout_method: editMethod || undefined,
        external_ref: editRef || undefined,
      }),
    });
    setEditingId(null);
    await load();
  }

  const filtered = payouts.filter((p) => filterStatus === 'all' || p.status === filterStatus);
  const pendingTotal = payouts.filter((p) => p.status === 'pending').reduce((s, p) => s + p.net_payout_halire, 0);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Výplaty umělců</h1>
          <p className="text-slate-500 text-sm mt-1">Spravujte royalty výplaty napříč všemi akcemi</p>
        </div>
        <button
          onClick={() => { setShowCalc(!showCalc); setCalcResult(null); }}
          className="bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          Vypočítat výplaty
        </button>
      </div>

      {/* Summary bar */}
      {pendingTotal > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-center justify-between">
          <div className="text-sm text-amber-900">
            <strong>{fmt(pendingTotal)}</strong> čeká na schválení
          </div>
          <button
            onClick={async () => {
              const pending = payouts.filter((p) => p.status === 'pending');
              await Promise.all(pending.map((p) => transition(p.id, 'approved')));
            }}
            className="text-sm bg-amber-700 text-white px-4 py-1.5 rounded-lg font-medium hover:bg-amber-800"
          >
            Schválit vše
          </button>
        </div>
      )}

      {/* Calculate drawer */}
      {showCalc && (
        <form onSubmit={handleCalculate} className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-slate-900">Vypočítat royalty za období</h3>
          <p className="text-sm text-slate-600">
            Systém prohledá ledger za zvolené období a vytvoří dávky k výplatě
            pro každou aktivní smlouvu s nenulovým zůstatkem.
          </p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-700 mb-1">Od</label>
              <input type="date" value={calcFrom} onChange={(e) => setCalcFrom(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-700 mb-1">Do</label>
              <input type="date" value={calcTo} onChange={(e) => setCalcTo(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          {calcResult && calcResult.created === 0 && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Za toto období nejsou žádné nové royalty k výplatě.
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={calculating}
              className="bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {calculating ? 'Počítám…' : 'Vypočítat a vytvořit dávky'}
            </button>
            <button type="button" onClick={() => setShowCalc(false)}
              className="px-4 py-2 border rounded-lg text-sm text-slate-600">Zrušit</button>
          </div>
        </form>
      )}

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'pending', 'approved', 'processing', 'paid', 'failed', 'cancelled'].map((s) => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
              filterStatus === s
                ? 'bg-indigo-700 text-white border-indigo-700'
                : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400'
            }`}>
            {s === 'all' ? 'Vše' : STATUS_LABEL[s] ?? s}
            {s !== 'all' && (
              <span className="ml-1 text-xs opacity-70">
                ({payouts.filter((p) => p.status === s).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Payouts list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">Načítám…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">💸</div>
          <div>{payouts.length === 0 ? 'Žádné výplaty. Vypočítejte royalty za zvolené období.' : 'Žádné výplaty v tomto filtru.'}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div key={p.id} className="bg-white border rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">🎤 {p.artist_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[p.status] ?? ''}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                    <span className="text-xs text-slate-400">{p.event_title}</span>
                  </div>

                  <div className="flex gap-6 mt-2">
                    <div>
                      <div className="text-xs text-slate-400">Čistá výplata</div>
                      <div className="text-lg font-bold text-emerald-700">{fmt(p.net_payout_halire, p.currency)}</div>
                    </div>
                    {p.adjustments_halire !== 0 && (
                      <div>
                        <div className="text-xs text-slate-400">Korekce</div>
                        <div className={`text-sm font-medium ${p.adjustments_halire > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {p.adjustments_halire > 0 ? '+' : ''}{fmt(p.adjustments_halire, p.currency)}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-slate-400">Hrubé royalty</div>
                      <div className="text-sm text-slate-600">{fmt(p.gross_royalties_halire, p.currency)}</div>
                    </div>
                    {p.period_from && (
                      <div>
                        <div className="text-xs text-slate-400">Období</div>
                        <div className="text-sm text-slate-600">
                          {new Date(p.period_from).toLocaleDateString('cs-CZ')} –{' '}
                          {p.period_to ? new Date(p.period_to).toLocaleDateString('cs-CZ') : '?'}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-4 mt-1 text-xs text-slate-400">
                    {p.artist_email && <span>{p.artist_email}</span>}
                    {p.bank_iban && <span className="font-mono">{p.bank_iban}</span>}
                    {p.payout_method && <span>{p.payout_method}</span>}
                    {p.external_ref && <span className="font-mono">{p.external_ref}</span>}
                    {p.paid_at && <span>Zaplaceno: {new Date(p.paid_at).toLocaleDateString('cs-CZ')}</span>}
                  </div>
                  {p.notes && <div className="text-xs text-slate-500 mt-1 italic">{p.notes}</div>}

                  {/* Edit form */}
                  {editingId === p.id && (
                    <div className="mt-3 flex gap-2 flex-wrap">
                      <input value={editMethod} onChange={(e) => setEditMethod(e.target.value)}
                        placeholder="Metoda (bank_transfer, wise…)"
                        className="border rounded-lg px-2 py-1 text-xs flex-1 min-w-32" />
                      <input value={editRef} onChange={(e) => setEditRef(e.target.value)}
                        placeholder="Ext. ref (číslo transakce)"
                        className="border rounded-lg px-2 py-1 text-xs flex-1 min-w-32" />
                      <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Poznámka"
                        className="border rounded-lg px-2 py-1 text-xs flex-1 min-w-32" />
                      <button onClick={() => void saveEdit(p.id)}
                        className="text-xs px-3 py-1.5 bg-indigo-700 text-white rounded-lg">Uložit</button>
                      <button onClick={() => setEditingId(null)}
                        className="text-xs px-3 py-1.5 border rounded-lg text-slate-600">Zrušit</button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  {(TRANSITION_ACTIONS[p.status] ?? []).map((act) => (
                    <button key={act.status}
                      onClick={() => void transition(p.id, act.status)}
                      className={`text-xs px-3 py-1.5 rounded-lg border ${act.cls}`}>
                      {act.label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setEditingId(editingId === p.id ? null : p.id);
                      setEditNotes(p.notes ?? '');
                      setEditMethod(p.payout_method ?? '');
                      setEditRef(p.external_ref ?? '');
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
                    Upravit
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
