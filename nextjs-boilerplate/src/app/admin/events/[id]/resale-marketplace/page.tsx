'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface ResaleSettings {
  resale_enabled: boolean;
  resale_max_price_pct: number;
  resale_platform_fee_pct: number;
  resale_cooling_hours: number;
  resale_allow_below_face: boolean;
  fansale_mode: boolean;
}
interface ResaleListing {
  id: string;
  ticket_type_name: string;
  seat_label: string | null;
  section_label: string | null;
  original_price_halire: number;
  listing_price_halire: number;
  platform_fee_halire: number;
  seller_payout_halire: number;
  status: string;
  listed_at: string;
  sold_at: string | null;
  seller_email: string | null;
  buyer_email: string | null;
}
interface ResaleStats {
  available_count: string;
  sold_count: string;
  cancelled_count: string;
  total_resale_volume: number;
  total_platform_fees: number;
  avg_markup_pct: string;
}

const fmt = (h: number) => `${(h / 100).toLocaleString('cs-CZ')} Kč`;

const STATUS_COLOR: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-800',
  reserved: 'bg-amber-100 text-amber-800',
  sold: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-slate-100 text-slate-500',
  expired: 'bg-red-100 text-red-700',
};

export default function ResaleMarketplacePage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [settings, setSettings] = useState<ResaleSettings | null>(null);
  const [listings, setListings] = useState<ResaleListing[]>([]);
  const [stats, setStats] = useState<ResaleStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/admin/events/${eventId}/resale-marketplace`);
    const d = await r.json() as { settings: ResaleSettings; listings: ResaleListing[]; stats: ResaleStats };
    setSettings(d.settings);
    setListings(d.listings);
    setStats(d.stats);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [eventId]);

  async function saveSetting(patch: Partial<ResaleSettings>) {
    setSaving(true);
    const r = await fetch(`/api/admin/events/${eventId}/resale-marketplace`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const d = await r.json() as { settings?: ResaleSettings };
    // Pokud backend vrátil aktualizovaný settings (fanSALE one-click), použij ho celý
    setSettings((s) => s ? { ...(d.settings ?? { ...s, ...patch }) } : s);
    setSaving(false);
  }

  async function cancelListing(listingId: string) {
    await fetch(`/api/admin/events/${eventId}/resale-marketplace/${listingId}`, { method: 'DELETE' });
    await load();
  }

  const filtered = listings.filter((l) => filterStatus === 'all' || l.status === filterStatus);

  if (loading || !settings) {
    return <div className="flex items-center justify-center py-24 text-slate-400">Načítám…</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">🔄 Sekundární trh</h1>
        <p className="text-slate-500 text-sm mt-1">Fan-to-fan resale — transparentní, s cenovým stropem</p>
      </div>

      {/* fanSALE one-click toggle */}
      <div className={`rounded-xl border-2 p-5 ${settings.fansale_mode ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg font-bold text-slate-900">🛡️ Tixly fanSALE</span>
              {settings.fansale_mode && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-600 text-white font-semibold">AKTIVNÍ</span>
              )}
            </div>
            <p className="text-sm text-slate-600">
              Přísný cenový strop — vstupenky lze prodat{' '}
              <strong>max. za jmenovitou hodnotu (100 %)</strong>. Žádné přirážky.<br />
              Jedno kliknutí aktivuje resale, nastaví strop na 100 % a povolí prodej pod face value.
            </p>
            {settings.fansale_mode && (
              <p className="text-xs text-emerald-700 mt-1.5 font-medium">
                ✓ resale aktivní · strop = 100 % face value · prodej pod face value povolen
              </p>
            )}
          </div>
          <button
            onClick={() => void saveSetting({ fansale_mode: !settings.fansale_mode })}
            disabled={saving}
            className={`shrink-0 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              settings.fansale_mode
                ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                : 'bg-emerald-700 text-white hover:bg-emerald-800'
            }`}
          >
            {settings.fansale_mode ? 'Vypnout fanSALE' : '🛡️ Aktivovat fanSALE'}
          </button>
        </div>
        {!settings.fansale_mode && (
          <p className="text-xs text-slate-400 mt-3 border-t pt-3">
            Bez fanSALE: níže lze nastavit vlastní cenový strop (např. 110 % = +10 % přirážka).
          </p>
        )}
      </div>

      {/* Enable toggle */}
      <div className={`rounded-xl border p-4 flex items-center justify-between ${settings.resale_enabled ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
        <div>
          <div className="font-semibold text-slate-900">
            {settings.resale_enabled ? '✅ Resale je aktivní' : '⭕ Resale je vypnuto'}
          </div>
          <div className="text-sm text-slate-500 mt-0.5">
            {settings.resale_enabled
              ? 'Fanoušci mohou nabídnout lístky k prodeji.'
              : 'Fanoušci nemohou nabídnout lístky k prodeji.'}
          </div>
        </div>
        <button
          onClick={() => void saveSetting({ resale_enabled: !settings.resale_enabled })}
          disabled={saving}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            settings.resale_enabled
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-emerald-700 text-white hover:bg-emerald-800'
          }`}
        >
          {settings.resale_enabled ? 'Vypnout resale' : 'Aktivovat resale'}
        </button>
      </div>

      {/* Settings */}
      <div className="bg-white border rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-slate-900">Nastavení pravidel</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Maximální cena (% face value)
              {settings.fansale_mode && (
                <span className="ml-2 text-xs text-emerald-700 font-semibold">← zamknuto fanSALE (100 %)</span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" min={100} max={300} step={5}
                value={settings.fansale_mode ? 100 : settings.resale_max_price_pct}
                disabled={settings.fansale_mode}
                onChange={(e) => setSettings((s) => s ? { ...s, resale_max_price_pct: +e.target.value } : s)}
                onBlur={() => !settings.fansale_mode && void saveSetting({ resale_max_price_pct: settings.resale_max_price_pct })}
                className={`w-28 border rounded-lg px-3 py-2 text-sm ${settings.fansale_mode ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}
              />
              <span className="text-sm text-slate-500">
                = max {(settings.fansale_mode ? 0 : settings.resale_max_price_pct - 100).toFixed(0)} % přirážka
              </span>
            </div>
            {!settings.fansale_mode && <p className="text-xs text-slate-400 mt-1">110 = max 10 % nad cenou vstupenky</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Platforma fee (% z resale ceny)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} max={50} step={1}
                value={settings.resale_platform_fee_pct}
                onChange={(e) => setSettings((s) => s ? { ...s, resale_platform_fee_pct: +e.target.value } : s)}
                onBlur={() => void saveSetting({ resale_platform_fee_pct: settings.resale_platform_fee_pct })}
                className="w-24 border rounded-lg px-3 py-2 text-sm"
              />
              <span className="text-sm text-slate-500">% si Tixly nechá z resale ceny</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Cooling period (hodiny od koupě)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} max={720} step={1}
                value={settings.resale_cooling_hours}
                onChange={(e) => setSettings((s) => s ? { ...s, resale_cooling_hours: +e.target.value } : s)}
                onBlur={() => void saveSetting({ resale_cooling_hours: settings.resale_cooling_hours })}
                className="w-24 border rounded-lg px-3 py-2 text-sm"
              />
              <span className="text-sm text-slate-500">min. čekání před listingem</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">0 = ihned; 24 = doporučeno proti flip-scalping</p>
          </div>

          <div className="flex items-start gap-3 pt-5">
            <input
              type="checkbox"
              id="allow_below"
              checked={settings.resale_allow_below_face}
              onChange={(e) => void saveSetting({ resale_allow_below_face: e.target.checked })}
              className="mt-0.5"
            />
            <label htmlFor="allow_below" className="text-sm text-slate-700 cursor-pointer">
              Povolit prodej pod face value
              <div className="text-xs text-slate-400">Fanoušci mohou prodat i se ztrátou</div>
            </label>
          </div>
        </div>

        {/* Live price example */}
        <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600">
          <strong>Příklad</strong> — vstup. za 500 Kč:
          max. cena listingu = {(500 * settings.resale_max_price_pct / 100).toFixed(0)} Kč,
          fee Tixly = {(500 * settings.resale_max_price_pct / 100 * settings.resale_platform_fee_pct / 100).toFixed(0)} Kč,
          prodávající dostane = {(500 * settings.resale_max_price_pct / 100 * (1 - settings.resale_platform_fee_pct / 100)).toFixed(0)} Kč
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{stats.available_count}</div>
            <div className="text-xs text-slate-400 mt-1">Aktivních listingů</div>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-700">{stats.sold_count}</div>
            <div className="text-xs text-slate-400 mt-1">Prodaných</div>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-emerald-700">{fmt(stats.total_platform_fees ?? 0)}</div>
            <div className="text-xs text-slate-400 mt-1">Tixly fee celkem</div>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center col-span-2">
            <div className="text-2xl font-bold text-slate-700">{fmt(stats.total_resale_volume ?? 0)}</div>
            <div className="text-xs text-slate-400 mt-1">Objem resale obchodů</div>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-amber-700">+{Number(stats.avg_markup_pct ?? 0).toFixed(1)} %</div>
            <div className="text-xs text-slate-400 mt-1">Průměrná přirážka (sold)</div>
          </div>
        </div>
      )}

      {/* Listings */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-900">Všechny listingy</h3>
          <div className="flex gap-1">
            {['all', 'available', 'sold', 'cancelled'].map((s) => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
                  filterStatus === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'
                }`}>
                {s === 'all' ? 'Vše' : { available: 'Aktivní', sold: 'Prodané', cancelled: 'Zrušené' }[s] ?? s}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">Žádné listingy</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((l) => {
              const markup = l.original_price_halire > 0
                ? ((l.listing_price_halire / l.original_price_halire - 1) * 100).toFixed(1)
                : '0';
              return (
                <div key={l.id} className="bg-white border rounded-xl px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-900 text-sm">{l.ticket_type_name}</span>
                      {l.seat_label && <span className="text-xs text-slate-400">{l.seat_label}</span>}
                      {l.section_label && <span className="text-xs text-slate-400">{l.section_label}</span>}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[l.status] ?? ''}`}>
                        {l.status}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        Number(markup) > 5 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {Number(markup) >= 0 ? '+' : ''}{markup} %
                      </span>
                    </div>
                    <div className="flex gap-6 mt-1 text-xs text-slate-500">
                      <span>Face: {fmt(l.original_price_halire)}</span>
                      <span>Listing: <strong>{fmt(l.listing_price_halire)}</strong></span>
                      <span>Seller dostane: {fmt(l.seller_payout_halire)}</span>
                      {l.seller_email && <span>Prodávající: {l.seller_email}</span>}
                      {l.buyer_email && <span>Kupující: {l.buyer_email}</span>}
                      <span>{new Date(l.listed_at).toLocaleDateString('cs-CZ')}</span>
                    </div>
                  </div>
                  {l.status === 'available' && (
                    <button
                      onClick={() => void cancelListing(l.id)}
                      className="text-xs px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg shrink-0"
                    >
                      Zrušit
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
