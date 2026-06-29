'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Zap, TrendingUp, Clock, Settings, Trash2, Plus, Sparkles, RefreshCw } from 'lucide-react';

function authFetch(path: string, opts: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

interface DemandMetrics {
  capacity_total: number;
  capacity_sold: number;
  capacity_pct: number;
  velocity_24h: number;
  hours_to_event: number;
  demand_score: number;
}

interface TicketType {
  id: string;
  name: string;
  base_price: number;
  dynamic_price_minor: number | null;
  dp_min_halire: number | null;
  dp_max_halire: number | null;
  dynamic_pricing_enabled: boolean;
  total_qty: number | null;
  remaining_qty: number | null;
}

interface DPRule {
  id: string;
  rule_type: string;
  trigger_condition: Record<string, number>;
  price_adjustment: { type: string; value: number };
  applies_to: string;
  max_price_multiplier: number;
  min_price_multiplier: number;
  priority: number;
  is_active: boolean;
  applied_count: number;
  last_applied_at: string | null;
  ai_generated: boolean;
}

interface LogEntry {
  id: string;
  ticket_type_name: string;
  old_price_halire: number;
  new_price_halire: number;
  price_diff_pct: number;
  trigger_reason: string;
  demand_score: string;
  applied_at: string;
}

interface PageData {
  event: { id: string; title: string; dynamic_pricing_enabled: boolean; date_start: string };
  rules: DPRule[];
  ticket_types: TicketType[];
  log: LogEntry[];
  metrics: DemandMetrics;
}

interface RuleSuggestion {
  rule_type: string;
  trigger_condition: Record<string, number>;
  price_adjustment: { type: string; value: number };
  applies_to: string;
  priority: number;
  description: string;
  rationale: string;
}

const RULE_TYPE_LABELS: Record<string, string> = {
  capacity_threshold: 'Obsazenost',
  time_decay:         'Čas do akce',
  last_minute:        'Last-minute (≤48h)',
  early_bird:         'Early bird',
  velocity_surge:     'Rychlý prodej',
};

const ADJ_TYPE_LABELS: Record<string, string> = {
  pct_increase:    '% zdražení',
  pct_decrease:    '% sleva',
  set_pct_of_base: '% základní ceny',
};

function fmtPrice(halire: number) {
  return `${Math.round(halire / 100)} Kč`;
}

function DemandGauge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? 'bg-red-500' : pct >= 40 ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-semibold tabular-nums">{pct}/100</span>
    </div>
  );
}

export default function DynamicPricingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([]);
  const [showAddRule, setShowAddRule] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newRule, setNewRule] = useState({
    rule_type: 'capacity_threshold',
    trigger_condition: '{"capacity_pct": 0.75}',
    price_adjustment_type: 'pct_increase',
    price_adjustment_value: '15',
    applies_to: 'all',
    priority: '2',
    max_price_multiplier: '2.00',
    min_price_multiplier: '0.50',
  });

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`/api/admin/events/${id}/dynamic-pricing`);
      if (!r.ok) { router.push('/admin/events'); return; }
      setData(await r.json() as PageData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { void load(); }, [load]);

  async function toggleEventDP(enabled: boolean) {
    setSaving(true);
    await authFetch(`/api/admin/events/${id}/dynamic-pricing`, {
      method: 'PATCH',
      body: JSON.stringify({ dynamic_pricing_enabled: enabled }),
    });
    await load();
    setSaving(false);
  }

  async function toggleTicketTypeDP(ttId: string, enabled: boolean) {
    setSaving(true);
    await authFetch(`/api/admin/events/${id}/dynamic-pricing`, {
      method: 'PATCH',
      body: JSON.stringify({ ticket_type_id: ttId, dp_enabled: enabled }),
    });
    await load();
    setSaving(false);
  }

  async function deleteRule(ruleId: string) {
    if (!confirm('Smazat pravidlo?')) return;
    await authFetch(`/api/admin/events/${id}/dynamic-pricing?rule_id=${ruleId}`, { method: 'DELETE' });
    await load();
  }

  async function addRule() {
    let trigger: Record<string, number>;
    try {
      trigger = JSON.parse(newRule.trigger_condition) as Record<string, number>;
    } catch {
      setError('Neplatný JSON v trigger_condition');
      return;
    }
    setSaving(true);
    setError(null);
    await authFetch(`/api/admin/events/${id}/dynamic-pricing`, {
      method: 'PATCH',
      body: JSON.stringify({
        rule: {
          rule_type: newRule.rule_type,
          trigger_condition: trigger,
          price_adjustment: {
            type: newRule.price_adjustment_type,
            value: parseFloat(newRule.price_adjustment_value),
          },
          applies_to: newRule.applies_to,
          priority: parseInt(newRule.priority),
          max_price_multiplier: parseFloat(newRule.max_price_multiplier),
          min_price_multiplier: parseFloat(newRule.min_price_multiplier),
        },
      }),
    });
    setShowAddRule(false);
    await load();
    setSaving(false);
  }

  async function acceptSuggestion(s: RuleSuggestion) {
    setSaving(true);
    await authFetch(`/api/admin/events/${id}/dynamic-pricing`, {
      method: 'PATCH',
      body: JSON.stringify({ rule: { ...s } }),
    });
    setSuggestions((prev) => prev.filter((x) => x !== s));
    await load();
    setSaving(false);
  }

  async function getSuggestions() {
    setSuggesting(true);
    setSuggestions([]);
    try {
      const r = await authFetch(`/api/admin/events/${id}/dynamic-pricing/suggest`, { method: 'POST' });
      const j = await r.json() as { suggestions?: RuleSuggestion[] };
      setSuggestions(j.suggestions ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  async function runRecalculate() {
    setRecalculating(true);
    try {
      const r = await fetch(`/api/internal/pricing/recalculate?event_id=${id}`, {
        method: 'POST',
        headers: { 'x-internal-token': process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? '' },
      });
      const j = await r.json() as { total_updated?: number };
      alert(`Přepočet hotov — ${j.total_updated ?? 0} typů vstupenek aktualizováno`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRecalculating(false);
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Načítám…</div>;
  if (!data)   return <div className="p-8 text-red-500">{error ?? 'Chyba'}</div>;

  const { event, rules, ticket_types, log, metrics } = data;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/admin/events/${id}`} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            Dynamické ceny
          </h1>
          <p className="text-sm text-muted-foreground">{event.title}</p>
        </div>
        <button
          onClick={() => void runRecalculate()}
          disabled={recalculating}
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${recalculating ? 'animate-spin' : ''}`} />
          Přepočítat nyní
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Demand metrics */}
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <h2 className="font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-blue-500" />
          Aktuální poptávka
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Prodáno</div>
            <div className="font-semibold">{metrics.capacity_sold} / {metrics.capacity_total}</div>
            <div className="text-xs text-muted-foreground">{Math.round(metrics.capacity_pct * 100)}% kapacity</div>
          </div>
          <div>
            <div className="text-muted-foreground">Prodej / 24h</div>
            <div className="font-semibold">{metrics.velocity_24h} lístků</div>
          </div>
          <div>
            <div className="text-muted-foreground">Do akce</div>
            <div className="font-semibold">{metrics.hours_to_event}h</div>
          </div>
          <div>
            <div className="text-muted-foreground">Demand score</div>
            <DemandGauge score={metrics.demand_score} />
          </div>
        </div>
      </div>

      {/* Master toggle */}
      <div className="rounded-lg border bg-card p-4 flex items-center justify-between">
        <div>
          <div className="font-medium">Dynamické ceny aktivní</div>
          <div className="text-sm text-muted-foreground">
            {event.dynamic_pricing_enabled
              ? 'Engine běží — pravidla jsou aktivní a ceny se přepočítávají'
              : 'Přepínač vypnutý — pravidla existují, ale ceny se nemění'}
          </div>
        </div>
        <button
          onClick={() => void toggleEventDP(!event.dynamic_pricing_enabled)}
          disabled={saving}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50
            ${event.dynamic_pricing_enabled ? 'bg-green-500' : 'bg-muted'}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
              ${event.dynamic_pricing_enabled ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
      </div>

      {/* Ticket types */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="font-medium flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Typy vstupenek
        </h2>
        {ticket_types.length === 0 && (
          <p className="text-sm text-muted-foreground">Žádné aktivní typy vstupenek.</p>
        )}
        {ticket_types.map((tt) => (
          <div key={tt.id} className="flex items-center gap-3 py-2 border-b last:border-0">
            <div className="flex-1">
              <div className="font-medium text-sm">{tt.name}</div>
              <div className="text-xs text-muted-foreground">
                Základ: {fmtPrice(tt.base_price)}
                {tt.dynamic_price_minor != null ? ` · Dynamická: ${fmtPrice(tt.dynamic_price_minor)}` : ''}
                {tt.dp_min_halire ? ` · Min: ${fmtPrice(tt.dp_min_halire)}` : ''}
                {tt.dp_max_halire ? ` · Max: ${fmtPrice(tt.dp_max_halire)}` : ''}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {tt.remaining_qty ?? '?'} / {tt.total_qty ?? '?'} zbývá
            </div>
            <button
              onClick={() => void toggleTicketTypeDP(tt.id, !tt.dynamic_pricing_enabled)}
              disabled={saving}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50
                ${tt.dynamic_pricing_enabled ? 'bg-green-500' : 'bg-muted'}`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
                  ${tt.dynamic_pricing_enabled ? 'translate-x-[18px]' : 'translate-x-1'}`}
              />
            </button>
          </div>
        ))}
      </div>

      {/* Rules */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Pravidla ({rules.length})
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => void getSuggestions()}
              disabled={suggesting}
              className="flex items-center gap-1.5 rounded-md border border-purple-300 bg-purple-50 px-3 py-1.5 text-sm text-purple-700 hover:bg-purple-100 disabled:opacity-50"
            >
              <Sparkles className={`h-3.5 w-3.5 ${suggesting ? 'animate-spin' : ''}`} />
              {suggesting ? 'AI přemýšlí…' : 'AI návrhy'}
            </button>
            <button
              onClick={() => setShowAddRule((v) => !v)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              Přidat pravidlo
            </button>
          </div>
        </div>

        {/* AI suggestions */}
        {suggestions.length > 0 && (
          <div className="rounded-md border border-purple-200 bg-purple-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-purple-700 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              AI návrhy — klikni pro přidání
            </div>
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-3 bg-white rounded-md border p-3">
                <div className="flex-1">
                  <div className="font-medium text-sm">{s.description}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.rationale}</div>
                  <div className="text-xs text-purple-600 mt-1">
                    {RULE_TYPE_LABELS[s.rule_type] ?? s.rule_type} ·{' '}
                    {ADJ_TYPE_LABELS[s.price_adjustment.type] ?? s.price_adjustment.type} {s.price_adjustment.value}%
                  </div>
                </div>
                <button
                  onClick={() => void acceptSuggestion(s)}
                  disabled={saving}
                  className="text-xs rounded bg-purple-600 text-white px-2 py-1 hover:bg-purple-700 disabled:opacity-50"
                >
                  Přidat
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add rule form */}
        {showAddRule && (
          <div className="rounded-md border bg-muted/30 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <label className="block text-xs font-medium mb-1">Typ pravidla</label>
                <select
                  value={newRule.rule_type}
                  onChange={(e) => setNewRule((p) => ({ ...p, rule_type: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 bg-background"
                >
                  {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Trigger (JSON)</label>
                <input
                  value={newRule.trigger_condition}
                  onChange={(e) => setNewRule((p) => ({ ...p, trigger_condition: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 bg-background font-mono text-xs"
                  placeholder='{"capacity_pct": 0.75}'
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Typ úpravy</label>
                <select
                  value={newRule.price_adjustment_type}
                  onChange={(e) => setNewRule((p) => ({ ...p, price_adjustment_type: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 bg-background"
                >
                  {Object.entries(ADJ_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Hodnota (%)</label>
                <input
                  type="number"
                  value={newRule.price_adjustment_value}
                  onChange={(e) => setNewRule((p) => ({ ...p, price_adjustment_value: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 bg-background"
                  min="1" max="100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Min cena (násobek základní)</label>
                <input
                  type="number"
                  value={newRule.min_price_multiplier}
                  onChange={(e) => setNewRule((p) => ({ ...p, min_price_multiplier: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 bg-background"
                  step="0.1" min="0.1" max="1.0"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Max cena (násobek základní)</label>
                <input
                  type="number"
                  value={newRule.max_price_multiplier}
                  onChange={(e) => setNewRule((p) => ({ ...p, max_price_multiplier: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 bg-background"
                  step="0.1" min="1.0" max="5.0"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddRule(false)} className="rounded border px-3 py-1.5 text-sm">Zrušit</button>
              <button
                onClick={() => void addRule()}
                disabled={saving}
                className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Uložit pravidlo
              </button>
            </div>
          </div>
        )}

        {/* Rules list */}
        {rules.length === 0 && !showAddRule && (
          <p className="text-sm text-muted-foreground py-2">
            Žádná pravidla — klikni „Přidat pravidlo" nebo použij „AI návrhy".
          </p>
        )}
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={`flex items-start gap-3 py-2 border-b last:border-0 ${!rule.is_active ? 'opacity-50' : ''}`}
          >
            <div className="flex-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{RULE_TYPE_LABELS[rule.rule_type] ?? rule.rule_type}</span>
                {rule.ai_generated && (
                  <span className="text-[10px] rounded bg-purple-100 text-purple-700 px-1.5 py-0.5 font-medium">AI</span>
                )}
                {!rule.is_active && (
                  <span className="text-[10px] rounded bg-muted text-muted-foreground px-1.5 py-0.5">Vypnuto</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Trigger: <code className="bg-muted px-1 rounded">{JSON.stringify(rule.trigger_condition)}</code>
                {' · '}
                Efekt: {ADJ_TYPE_LABELS[rule.price_adjustment.type] ?? rule.price_adjustment.type} {rule.price_adjustment.value}%
              </div>
              <div className="text-xs text-muted-foreground">
                Priorita {rule.priority} · Max ×{rule.max_price_multiplier} · Min ×{rule.min_price_multiplier}
                {rule.applied_count > 0 ? ` · Aplikováno ${rule.applied_count}×` : ''}
              </div>
            </div>
            <button
              onClick={() => void deleteRule(rule.id)}
              className="text-muted-foreground hover:text-red-600 p-1"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="font-medium text-sm">Historie změn cen</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-1.5 pr-3">Typ vstupenky</th>
                  <th className="text-right py-1.5 pr-3">Stará cena</th>
                  <th className="text-right py-1.5 pr-3">Nová cena</th>
                  <th className="text-right py-1.5 pr-3">Změna</th>
                  <th className="text-left py-1.5 pr-3">Důvod</th>
                  <th className="text-left py-1.5">Čas</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{entry.ticket_type_name}</td>
                    <td className="py-1.5 pr-3 text-right text-muted-foreground">{fmtPrice(entry.old_price_halire)}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold">{fmtPrice(entry.new_price_halire)}</td>
                    <td className={`py-1.5 pr-3 text-right font-semibold ${entry.price_diff_pct > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {entry.price_diff_pct > 0 ? '+' : ''}{entry.price_diff_pct.toFixed(1)}%
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground max-w-[200px] truncate">{entry.trigger_reason}</td>
                    <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                      {new Date(entry.applied_at).toLocaleString('cs-CZ', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
