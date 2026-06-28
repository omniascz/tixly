'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface RoyaltyAgreement {
  id: string;
  artist_name: string;
  artist_email: string | null;
  bank_iban: string | null;
  royalty_type: string;
  percent_rate: number | null;
  flat_amount_halire: number | null;
  per_ticket_halire: number | null;
  min_guarantee_halire: number | null;
  cap_halire: number | null;
  status: string;
  notes: string | null;
  accrued_halire: number;
  tickets_sold: number;
  revenue_halire: number;
}

const fmt = (h: number) => `${(h / 100).toLocaleString('cs-CZ')} Kč`;

const ROYALTY_TYPE_LABEL: Record<string, string> = {
  percent: '% z tržeb',
  flat: 'Fixní honorář',
  per_ticket: 'Za lístek',
  percent_plus_flat: '% + fixní',
};

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-yellow-100 text-yellow-800',
  settled: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
};

export default function ArtistRoyaltiesPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [agreements, setAgreements] = useState<RoyaltyAgreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [selectedLedger, setSelectedLedger] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Array<{
    order_id: string; ticket_revenue_halire: number; tickets_sold: number;
    royalty_amount_halire: number; created_at: string;
  }>>([]);

  // Form state
  const [fName, setFName] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fIban, setFIban] = useState('');
  const [fType, setFType] = useState<'percent' | 'flat' | 'per_ticket' | 'percent_plus_flat'>('percent');
  const [fPercent, setFPercent] = useState('');
  const [fFlat, setFFlat] = useState('');
  const [fPerTicket, setFPerTicket] = useState('');
  const [fMinGuarantee, setFMinGuarantee] = useState('');
  const [fCap, setFCap] = useState('');
  const [fNotes, setFNotes] = useState('');

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/admin/events/${eventId}/royalties`);
    const d = await r.json() as { agreements: RoyaltyAgreement[] };
    setAgreements(d.agreements ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [eventId]);

  async function loadLedger(id: string) {
    if (selectedLedger === id) { setSelectedLedger(null); return; }
    setSelectedLedger(id);
    const r = await fetch(`/api/admin/events/${eventId}/royalties/${id}`);
    const d = await r.json() as { entries: typeof ledger };
    setLedger(d.entries ?? []);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr('');
    const r = await fetch(`/api/admin/events/${eventId}/royalties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist_name: fName,
        artist_email: fEmail || undefined,
        bank_iban: fIban || undefined,
        royalty_type: fType,
        percent_rate: fPercent ? parseFloat(fPercent) : undefined,
        flat_amount_halire: fFlat ? Math.round(parseFloat(fFlat) * 100) : undefined,
        per_ticket_halire: fPerTicket ? Math.round(parseFloat(fPerTicket) * 100) : undefined,
        min_guarantee_halire: fMinGuarantee ? Math.round(parseFloat(fMinGuarantee) * 100) : undefined,
        cap_halire: fCap ? Math.round(parseFloat(fCap) * 100) : undefined,
        notes: fNotes || undefined,
      }),
    });
    if (r.ok) {
      setShowForm(false);
      setFName(''); setFEmail(''); setFIban(''); setFType('percent');
      setFPercent(''); setFFlat(''); setFPerTicket('');
      setFMinGuarantee(''); setFCap(''); setFNotes('');
      await load();
    } else {
      const d = await r.json() as { error?: string };
      setErr(d.error ?? 'Chyba');
    }
    setSaving(false);
  }

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/admin/events/${eventId}/royalties/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await load();
  }

  async function deleteAgreement(id: string) {
    const r = await fetch(`/api/admin/events/${eventId}/royalties/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json() as { error?: string };
      alert(d.error ?? 'Chyba při mazání');
      return;
    }
    await load();
  }

  const totalAccrued = agreements.reduce((s, a) => s + a.accrued_halire, 0);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Royalty umělců</h1>
          <p className="text-slate-500 text-sm mt-1">
            Nastavte podíly umělců z tržeb. Royalty se počítají automaticky při každé platbě.
          </p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setErr(''); }}
          className="bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Přidat smlouvu
        </button>
      </div>

      {/* Summary */}
      {agreements.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-indigo-900">{fmt(totalAccrued)}</div>
            <div className="text-xs text-indigo-600 mt-1">Celkem akumulováno</div>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">
              {agreements.reduce((s, a) => s + a.tickets_sold, 0)}
            </div>
            <div className="text-xs text-slate-500 mt-1">Lístků prodáno</div>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{agreements.length}</div>
            <div className="text-xs text-slate-500 mt-1">Aktivních smluv</div>
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-slate-900">Nová royalty smlouva</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Jméno umělce / skupiny *</label>
              <input required value={fName} onChange={(e) => setFName(e.target.value)}
                placeholder="Jan Novák / The Band"
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">E-mail umělce</label>
              <input type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)}
                placeholder="artist@example.com"
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">IBAN pro výplatu</label>
              <input value={fIban} onChange={(e) => setFIban(e.target.value)}
                placeholder="CZ65 0800 0000 1920 0014 5399"
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Typ royalty</label>
              <div className="grid grid-cols-4 gap-2">
                {(['percent','flat','per_ticket','percent_plus_flat'] as const).map((t) => (
                  <button key={t} type="button"
                    onClick={() => setFType(t)}
                    className={`py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      fType === t
                        ? 'bg-indigo-700 text-white border-indigo-700'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                    }`}>
                    {ROYALTY_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            {(fType === 'percent' || fType === 'percent_plus_flat') && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Procento (%)</label>
                <input type="number" step="0.01" min="0" max="100" value={fPercent}
                  onChange={(e) => setFPercent(e.target.value)}
                  placeholder="15.00"
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
            {(fType === 'flat' || fType === 'percent_plus_flat') && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Fixní honorář (Kč)</label>
                <input type="number" step="1" min="0" value={fFlat}
                  onChange={(e) => setFFlat(e.target.value)}
                  placeholder="5000"
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
            {fType === 'per_ticket' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Za lístek (Kč)</label>
                <input type="number" step="0.01" min="0" value={fPerTicket}
                  onChange={(e) => setFPerTicket(e.target.value)}
                  placeholder="20.00"
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Min. garantovaná výplata (Kč)</label>
              <input type="number" step="1" min="0" value={fMinGuarantee}
                onChange={(e) => setFMinGuarantee(e.target.value)}
                placeholder="volitelné"
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Strop výplaty (Kč)</label>
              <input type="number" step="1" min="0" value={fCap}
                onChange={(e) => setFCap(e.target.value)}
                placeholder="volitelné"
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Poznámky</label>
              <input value={fNotes} onChange={(e) => setFNotes(e.target.value)}
                placeholder="Interní poznámka k smlouvě"
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          {err && <div className="text-sm text-red-600">{err}</div>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Ukládám…' : 'Vytvořit smlouvu'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 border rounded-lg text-sm text-slate-600">Zrušit</button>
          </div>
        </form>
      )}

      {/* Agreements list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">Načítám…</div>
      ) : agreements.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">🎵</div>
          <div>Žádné royalty smlouvy pro tuto akci</div>
        </div>
      ) : (
        <div className="space-y-3">
          {agreements.map((a) => (
            <div key={a.id} className="bg-white border rounded-xl overflow-hidden">
              <div className="p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">🎤 {a.artist_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[a.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {a.status}
                    </span>
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      {ROYALTY_TYPE_LABEL[a.royalty_type] ?? a.royalty_type}
                    </span>
                  </div>

                  {/* Royalty details */}
                  <div className="text-sm text-slate-600 mt-1 flex gap-3 flex-wrap">
                    {a.percent_rate !== null && (
                      <span className="font-semibold text-indigo-700">{a.percent_rate} %</span>
                    )}
                    {a.flat_amount_halire !== null && (
                      <span className="font-semibold text-indigo-700">fix {fmt(a.flat_amount_halire)}</span>
                    )}
                    {a.per_ticket_halire !== null && (
                      <span className="font-semibold text-indigo-700">{fmt(a.per_ticket_halire)}/lístek</span>
                    )}
                    {a.min_guarantee_halire !== null && (
                      <span className="text-slate-400">min {fmt(a.min_guarantee_halire)}</span>
                    )}
                    {a.cap_halire !== null && (
                      <span className="text-slate-400">strop {fmt(a.cap_halire)}</span>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="mt-2 flex gap-4 text-sm">
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-400">Akumulováno</span>
                      <span className="font-semibold text-emerald-700">{fmt(a.accrued_halire)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-400">Lístků</span>
                      <span className="font-medium">{a.tickets_sold}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-400">Tržby</span>
                      <span className="font-medium">{fmt(a.revenue_halire)}</span>
                    </div>
                  </div>

                  {a.artist_email && (
                    <div className="text-xs text-slate-400 mt-1">{a.artist_email}</div>
                  )}
                  {a.bank_iban && (
                    <div className="text-xs font-mono text-slate-400">{a.bank_iban}</div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => void loadLedger(a.id)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
                  >
                    {selectedLedger === a.id ? 'Skrýt ledger' : 'Ledger'}
                  </button>
                  {a.status === 'active' && (
                    <button onClick={() => void updateStatus(a.id, 'paused')}
                      className="text-xs px-3 py-1.5 rounded-lg border border-yellow-300 text-yellow-700 hover:bg-yellow-50">
                      Pozastavit
                    </button>
                  )}
                  {a.status === 'paused' && (
                    <button onClick={() => void updateStatus(a.id, 'active')}
                      className="text-xs px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                      Obnovit
                    </button>
                  )}
                  <button onClick={() => void deleteAgreement(a.id)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
                    Smazat
                  </button>
                </div>
              </div>

              {/* Ledger drawer */}
              {selectedLedger === a.id && (
                <div className="border-t bg-slate-50 p-4">
                  <div className="text-xs font-semibold text-slate-600 mb-2">Ledger — posledních 100 objednávek</div>
                  {ledger.length === 0 ? (
                    <div className="text-sm text-slate-400">Žádné záznamy (žádná platba ještě neproběhla)</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-400 border-b">
                            <th className="text-left py-1 pr-4">Objednávka</th>
                            <th className="text-right pr-4">Tržba</th>
                            <th className="text-right pr-4">Lístky</th>
                            <th className="text-right pr-4">Royalty</th>
                            <th className="text-right">Datum</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledger.map((l) => (
                            <tr key={l.order_id} className="border-b border-slate-100">
                              <td className="py-1 pr-4 font-mono text-slate-500">{l.order_id.slice(0, 8)}…</td>
                              <td className="text-right pr-4">{fmt(l.ticket_revenue_halire)}</td>
                              <td className="text-right pr-4">{l.tickets_sold}</td>
                              <td className="text-right pr-4 font-semibold text-indigo-700">{fmt(l.royalty_amount_halire)}</td>
                              <td className="text-right text-slate-400">
                                {new Date(l.created_at).toLocaleDateString('cs-CZ')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Link to global payouts */}
      {agreements.length > 0 && (
        <div className="bg-slate-50 border rounded-xl p-4 flex items-center justify-between">
          <div className="text-sm text-slate-600">
            Pro generování výplat přejděte do globálního přehledu výplat umělců.
          </div>
          <a href="/admin/artist-payouts"
            className="text-sm text-indigo-700 font-medium hover:underline">
            Výplaty umělců →
          </a>
        </div>
      )}
    </div>
  );
}
