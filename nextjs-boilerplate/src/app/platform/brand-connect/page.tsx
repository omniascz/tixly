'use client';

import { useEffect, useState, useCallback } from 'react';
import { HeartHandshake, Plus, Play, Pause, Zap, Building2, BarChart2 } from 'lucide-react';

function authFetch(path: string, opts: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(path, {
    ...opts,
    headers: { ...(opts.headers ?? {}), 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

interface Advertiser {
  id: string;
  company_name: string;
  logo_url: string | null;
  industry: string | null;
  contact_email: string;
  status: string;
  campaign_count: number;
  created_at: string;
}

interface Campaign {
  id: string;
  advertiser_id: string;
  advertiser_name: string;
  advertiser_logo: string | null;
  name: string;
  tagline: string | null;
  status: string;
  fee_per_event_czk: number;
  tixly_cut_pct: number;
  budget_czk: number | null;
  budget_spent_czk: number;
  total_partnerships: number;
  total_impressions: number;
  total_clicks: number;
  target_event_categories: string[] | null;
  target_cities: string[] | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  draft:   'bg-muted text-muted-foreground',
  active:  'bg-green-100 text-green-700',
  paused:  'bg-amber-100 text-amber-700',
  ended:   'bg-red-100 text-red-700',
};

export default function PlatformBrandConnectPage() {
  const [tab, setTab] = useState<'campaigns' | 'advertisers'>('campaigns');
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewAdvertiser, setShowNewAdvertiser] = useState(false);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [matching, setMatching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New advertiser form
  const [advForm, setAdvForm] = useState({ company_name: '', contact_email: '', industry: '', logo_url: '' });
  // New campaign form
  const [campForm, setCampForm] = useState({
    advertiser_id: '', name: '', tagline: '', cta_text: 'Zjistit více', cta_url: '',
    fee_per_event_czk: '500', tixly_cut_pct: '15', budget_czk: '',
    target_event_categories: '', target_cities: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, cRes] = await Promise.all([
        authFetch('/api/platform/brand-connect/advertisers'),
        authFetch('/api/platform/brand-connect/campaigns'),
      ]);
      const aJ = await aRes.json() as { advertisers: Advertiser[] };
      const cJ = await cRes.json() as { campaigns: Campaign[] };
      setAdvertisers(aJ.advertisers ?? []);
      setCampaigns(cJ.campaigns ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createAdvertiser() {
    if (!advForm.company_name || !advForm.contact_email) return;
    const r = await authFetch('/api/platform/brand-connect/advertisers', {
      method: 'POST',
      body: JSON.stringify({ ...advForm, logo_url: advForm.logo_url || undefined }),
    });
    if (r.ok) { setShowNewAdvertiser(false); setAdvForm({ company_name: '', contact_email: '', industry: '', logo_url: '' }); await load(); }
    else { const j = await r.json() as { error?: string }; setError(j.error ?? 'Chyba'); }
  }

  async function createCampaign() {
    if (!campForm.advertiser_id || !campForm.name) return;
    const r = await authFetch('/api/platform/brand-connect/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        advertiser_id: campForm.advertiser_id,
        name: campForm.name,
        tagline: campForm.tagline || undefined,
        cta_text: campForm.cta_text,
        cta_url: campForm.cta_url || undefined,
        fee_per_event_czk: parseInt(campForm.fee_per_event_czk),
        tixly_cut_pct: parseFloat(campForm.tixly_cut_pct),
        budget_czk: campForm.budget_czk ? parseInt(campForm.budget_czk) : undefined,
        target_event_categories: campForm.target_event_categories
          ? campForm.target_event_categories.split(',').map((s) => s.trim())
          : undefined,
        target_cities: campForm.target_cities
          ? campForm.target_cities.split(',').map((s) => s.trim())
          : undefined,
      }),
    });
    if (r.ok) { setShowNewCampaign(false); await load(); }
    else { const j = await r.json() as { error?: string }; setError(j.error ?? 'Chyba'); }
  }

  async function toggleCampaignStatus(c: Campaign) {
    const newStatus = c.status === 'active' ? 'paused' : 'active';
    await authFetch(`/api/platform/brand-connect/campaigns/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
    await load();
  }

  async function matchCampaign(id: string) {
    setMatching(id);
    try {
      const r = await authFetch(`/api/platform/brand-connect/campaigns/${id}/match`, { method: 'POST' });
      const j = await r.json() as { proposed?: number; message?: string; error?: string };
      if (j.error) setError(j.error);
      else alert(`Navrženo ${j.proposed ?? 0} partnerství${j.message ? ` — ${j.message}` : ''}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMatching(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HeartHandshake className="h-6 w-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-bold">Brand Connect</h1>
            <p className="text-sm text-muted-foreground">Správa inzerentů a kampaní — propojení značek s akcemi promotérů</p>
          </div>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(['campaigns','advertisers'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t === 'campaigns' ? `Kampaně (${campaigns.length})` : `Inzerenti (${advertisers.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Načítám…</div>
      ) : tab === 'advertisers' ? (
        /* Advertisers tab */
        <div className="space-y-3">
          <button
            onClick={() => setShowNewAdvertiser((v) => !v)}
            className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Přidat inzerenta
          </button>

          {showNewAdvertiser && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="block text-xs font-medium mb-1">Název společnosti *</label>
                  <input value={advForm.company_name} onChange={(e) => setAdvForm((p) => ({ ...p, company_name: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" placeholder="Allianz pojišťovna" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Kontaktní e-mail *</label>
                  <input type="email" value={advForm.contact_email} onChange={(e) => setAdvForm((p) => ({ ...p, contact_email: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Industry</label>
                  <input value={advForm.industry} onChange={(e) => setAdvForm((p) => ({ ...p, industry: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" placeholder="insurance / beverage / bank…" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Logo URL</label>
                  <input value={advForm.logo_url} onChange={(e) => setAdvForm((p) => ({ ...p, logo_url: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" placeholder="https://…" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowNewAdvertiser(false)} className="rounded border px-3 py-1.5 text-sm">Zrušit</button>
                <button onClick={() => void createAdvertiser()} className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm">Uložit</button>
              </div>
            </div>
          )}

          {advertisers.map((a) => (
            <div key={a.id} className="rounded-lg border bg-card p-4 flex items-center gap-4">
              {a.logo_url ? (
                <img src={a.logo_url} alt={a.company_name} className="h-10 w-10 rounded object-contain border" />
              ) : (
                <div className="h-10 w-10 rounded bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold">
                  <Building2 className="h-5 w-5" />
                </div>
              )}
              <div className="flex-1">
                <div className="font-medium">{a.company_name}</div>
                <div className="text-sm text-muted-foreground">{a.contact_email}{a.industry ? ` · ${a.industry}` : ''}</div>
              </div>
              <div className="text-sm text-muted-foreground">{a.campaign_count} kampaní</div>
            </div>
          ))}
        </div>
      ) : (
        /* Campaigns tab */
        <div className="space-y-3">
          <button
            onClick={() => setShowNewCampaign((v) => !v)}
            className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Nová kampaň
          </button>

          {showNewCampaign && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="block text-xs font-medium mb-1">Inzerent *</label>
                  <select value={campForm.advertiser_id} onChange={(e) => setCampForm((p) => ({ ...p, advertiser_id: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background">
                    <option value="">Vyber…</option>
                    {advertisers.map((a) => <option key={a.id} value={a.id}>{a.company_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Název kampaně *</label>
                  <input value={campForm.name} onChange={(e) => setCampForm((p) => ({ ...p, name: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" placeholder="Letní pojišťění zážitků 2026" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium mb-1">Tagline (max 80 znaků)</label>
                  <input value={campForm.tagline} onChange={(e) => setCampForm((p) => ({ ...p, tagline: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" placeholder="Pojistěte si svůj zážitek s Allianz" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">CTA text</label>
                  <input value={campForm.cta_text} onChange={(e) => setCampForm((p) => ({ ...p, cta_text: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">CTA URL</label>
                  <input value={campForm.cta_url} onChange={(e) => setCampForm((p) => ({ ...p, cta_url: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" placeholder="https://…" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Honorář promotérovi (Kč/akce)</label>
                  <input type="number" value={campForm.fee_per_event_czk} onChange={(e) => setCampForm((p) => ({ ...p, fee_per_event_czk: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" min="0" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Tixly podíl (%)</label>
                  <input type="number" value={campForm.tixly_cut_pct} onChange={(e) => setCampForm((p) => ({ ...p, tixly_cut_pct: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" min="0" max="100" step="1" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Celkový budget (Kč, prázdné = unlimited)</label>
                  <input type="number" value={campForm.budget_czk} onChange={(e) => setCampForm((p) => ({ ...p, budget_czk: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Kategorie akcí (čárkou)</label>
                  <input value={campForm.target_event_categories} onChange={(e) => setCampForm((p) => ({ ...p, target_event_categories: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" placeholder="music, sport, theater" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Cílová města (čárkou)</label>
                  <input value={campForm.target_cities} onChange={(e) => setCampForm((p) => ({ ...p, target_cities: e.target.value }))} className="w-full rounded border px-2 py-1.5 bg-background" placeholder="Praha, Brno" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowNewCampaign(false)} className="rounded border px-3 py-1.5 text-sm">Zrušit</button>
                <button onClick={() => void createCampaign()} className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm">Vytvořit</button>
              </div>
            </div>
          )}

          {campaigns.length === 0 && !showNewCampaign && (
            <div className="text-center py-12 text-muted-foreground">
              <HeartHandshake className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>Žádné kampaně. Přidej inzerenta a vytvoř první kampaň.</p>
            </div>
          )}

          {campaigns.map((c) => (
            <div key={c.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                {c.advertiser_logo ? (
                  <img src={c.advertiser_logo} alt={c.advertiser_name} className="h-10 w-10 rounded object-contain border flex-shrink-0" />
                ) : (
                  <div className="h-10 w-10 rounded bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                    <Building2 className="h-5 w-5" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{c.name}</span>
                    <span className="text-sm text-muted-foreground">· {c.advertiser_name}</span>
                    <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${STATUS_BADGE[c.status] ?? ''}`}>
                      {c.status}
                    </span>
                  </div>
                  {c.tagline && <p className="text-sm text-muted-foreground mt-0.5">{c.tagline}</p>}

                  {/* Stats row */}
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{c.fee_per_event_czk.toLocaleString()} Kč/akce</span>
                    <span>Tixly {c.tixly_cut_pct}%</span>
                    {c.budget_czk && <span>Budget: {c.budget_spent_czk.toLocaleString()}/{c.budget_czk.toLocaleString()} Kč</span>}
                    <span className="flex items-center gap-1"><BarChart2 className="h-3 w-3" />{c.total_partnerships} akcí · {c.total_impressions.toLocaleString()} zobrazení</span>
                    {c.target_event_categories && <span>Kategorie: {c.target_event_categories.join(', ')}</span>}
                    {c.target_cities && <span>Města: {c.target_cities.join(', ')}</span>}
                  </div>
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => void matchCampaign(c.id)}
                    disabled={matching === c.id || c.status !== 'active'}
                    title="Auto-match na vhodné akce"
                    className="flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs hover:bg-secondary disabled:opacity-40"
                  >
                    <Zap className={`h-3 w-3 ${matching === c.id ? 'animate-spin' : ''}`} />
                    Match
                  </button>
                  <button
                    onClick={() => void toggleCampaignStatus(c)}
                    className="flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs hover:bg-secondary"
                  >
                    {c.status === 'active' ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    {c.status === 'active' ? 'Pozastavit' : 'Aktivovat'}
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
