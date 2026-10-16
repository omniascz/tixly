/**
 * POST /api/admin/events/[id]/dynamic-pricing/suggest
 *
 * Zavolá Claude a požádá o 3 návrhy pravidel dynamického cenování
 * na základě aktuálních metrik a kontextu akce.
 *
 * Bez ANTHROPIC_API_KEY vrací template-based fallback (3 typická pravidla).
 * S API key volá Claude Haiku a parsuje JSON.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { computeDemandMetrics } from '@/lib/pricing/dynamic-engine';

export const dynamic = 'force-dynamic';

interface RuleSuggestion {
  rule_type: string;
  trigger_condition: Record<string, number>;
  price_adjustment: { type: string; value: number };
  applies_to: string;
  priority: number;
  description: string;
  rationale: string;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    const eventR = await db().query(
      `SELECT e.id, e.title, e.date_start, e.event_type, e.dynamic_pricing_enabled,
              v.name AS venue_name, v.city AS venue_city,
              v.capacity AS venue_capacity,
              (SELECT COUNT(*)::int FROM tickets.tickets t
               JOIN orders.orders o ON o.id = t.order_id
               WHERE o.event_id = e.id AND o.status = 'paid') AS tickets_sold,
              (SELECT COALESCE(SUM(tt.total_qty),0)::int
               FROM catalog.ticket_types tt WHERE tt.event_id = e.id) AS capacity_total,
              (SELECT MIN(COALESCE(tt.dynamic_price_minor, tt.base_price))::int
               FROM catalog.ticket_types tt WHERE tt.event_id = e.id) AS price_from_halire,
              (SELECT MAX(COALESCE(tt.dynamic_price_minor, tt.base_price))::int
               FROM catalog.ticket_types tt WHERE tt.event_id = e.id) AS price_to_halire
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       WHERE e.id = $1 AND e.promoter_id = $2`,
      [params.id, ctx.promoterId],
    );
    if (eventR.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const event = eventR.rows[0] as {
      id: string; title: string; date_start: string; event_type: string | null;
      venue_name: string | null; venue_city: string | null; venue_capacity: number | null;
      tickets_sold: number; capacity_total: number;
      price_from_halire: number | null; price_to_halire: number | null;
    };

    const metrics = await computeDemandMetrics(params.id);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        provider: 'template',
        suggestions: templateFallback(metrics),
      });
    }

    try {
      const suggestions = await suggestWithClaude({ apiKey, event, metrics });
      return NextResponse.json({ provider: 'claude', suggestions });
    } catch (err) {
      console.error('[dynamic-pricing/suggest]', err);
      return NextResponse.json({
        provider: 'template_fallback',
        suggestions: templateFallback(metrics),
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  });
}

async function suggestWithClaude(input: {
  apiKey: string;
  event: {
    title: string; date_start: string; event_type: string | null;
    venue_name: string | null; venue_city: string | null; venue_capacity: number | null;
    tickets_sold: number; capacity_total: number;
    price_from_halire: number | null; price_to_halire: number | null;
  };
  metrics: {
    capacity_pct: number; velocity_24h: number; hours_to_event: number;
    demand_score: number;
  };
}): Promise<RuleSuggestion[]> {
  const { event, metrics } = input;
  const priceCzk = event.price_from_halire ? Math.round(event.price_from_halire / 100) : null;
  const priceToCzk = event.price_to_halire ? Math.round(event.price_to_halire / 100) : null;
  const fillPct = Math.round(metrics.capacity_pct * 100);
  const hoursToEvent = Math.round(metrics.hours_to_event);

  const prompt = `Jsi odborný cenový analytik pro ticketing platformu. Navrhni 3 konkrétní pravidla dynamického cenování pro tuto akci.

KONTEXT AKCE:
- Název: ${event.title}
- Typ: ${event.event_type ?? 'event'}
- Místo: ${event.venue_name ?? '–'}${event.venue_city ? `, ${event.venue_city}` : ''}
- Kapacita místa: ${event.venue_capacity ?? event.capacity_total} míst
- Datum: ${event.date_start}
- Hodin do akce: ${hoursToEvent}h

AKTUÁLNÍ METRIKY:
- Prodáno: ${event.tickets_sold} z ${event.capacity_total} (${fillPct}% kapacity)
- Prodej posledních 24h: ${metrics.velocity_24h} lístků
- Demand score: ${(metrics.demand_score * 100).toFixed(1)}/100
- Cena vstupenky: ${priceCzk ? `${priceCzk}–${priceToCzk} Kč` : 'neuvedena'}

DOSTUPNÉ TYPY PRAVIDEL:
- capacity_threshold: trigger_condition = {"capacity_pct": 0.0–1.0} — při přesažení % prodeje
- time_decay: trigger_condition = {"hours_before": N} — N hodin před akcí
- last_minute: bez podmínky — automaticky při ≤48h
- early_bird: trigger_condition = {"days_before": N} — N dní před akcí (sleva)
- velocity_surge: trigger_condition = {"tickets_per_24h": N} — při rychlém prodeji

TYPY ÚPRAVY CENY:
- pct_increase: zvýšení o N %
- pct_decrease: snížení o N %
- set_pct_of_base: nastavit na N % základní ceny

Vrať PŘÍMO JSON pole (bez markdown), 3 pravidla, každé musí být v daném formátu:
[
  {
    "rule_type": "...",
    "trigger_condition": {...},
    "price_adjustment": {"type": "...", "value": N},
    "applies_to": "all",
    "priority": 1–3,
    "description": "Krátký popis (česky, max 60 znaků)",
    "rationale": "Proč toto pravidlo dává smysl pro tuto akci (česky, 1–2 věty)"
  }
]

Pravidla musí být realistická a vhodná pro daný kontext (typ akce, obsazenost, čas).`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const j = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = j.content?.find((c) => c.type === 'text')?.text ?? '';

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array in Claude response');

  const parsed = JSON.parse(jsonMatch[0]) as RuleSuggestion[];
  return parsed.slice(0, 3);
}

function templateFallback(_metrics: {
  capacity_pct: number; hours_to_event: number; velocity_24h: number;
}): RuleSuggestion[] {

  return [
    {
      rule_type: 'capacity_threshold',
      trigger_condition: { capacity_pct: 0.75 },
      price_adjustment: { type: 'pct_increase', value: 15 },
      applies_to: 'all',
      priority: 3,
      description: 'Surge při 75% obsazenosti',
      rationale: `Při prodeji 75 % kapacity roste zájem — zvýšení o 15 % je standardní pro živá vystoupení a konference.`,
    },
    {
      rule_type: 'time_decay',
      trigger_condition: { hours_before: 72 },
      price_adjustment: { type: 'pct_increase', value: 10 },
      applies_to: 'all',
      priority: 2,
      description: 'Last-minute +10% (72h před akcí)',
      rationale: `Impulzivní kupující jsou méně cenově citliví — mírné zvýšení v posledních 3 dnech je standardní praxe.`,
    },
    {
      rule_type: 'early_bird',
      trigger_condition: { days_before: 30 },
      price_adjustment: { type: 'pct_decrease', value: 10 },
      applies_to: 'all',
      priority: 1,
      description: 'Early bird sleva 10% (30+ dní předem)',
      rationale: `Stimulace včasného prodeje snižuje riziko nevyprodanosti — nejefektivnější u kulturních akcí.`,
    },
  ];
}
