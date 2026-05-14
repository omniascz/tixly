/**
 * POST /api/admin/events/[id]/ai-description
 *
 * Generuje 3 varianty popisu akce přes Anthropic API.
 * Body: { keywords: string[], tone?: 'casual'|'professional'|'energetic', language?: 'cs'|'en' }
 *
 * Bez ANTHROPIC_API_KEY env vrací template-based fallback. S API key volá
 * Claude API a parsuje JSON odpověď.
 *
 * Vrací: { variants: [{ kind: 'short', text }, { kind: 'medium', text }, { kind: 'long', text }] }
 *
 * Ownership: event musí patřit promotérovi.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  keywords: z.array(z.string().min(1).max(80)).min(1).max(20),
  tone: z.enum(['casual', 'professional', 'energetic']).default('professional'),
  language: z.enum(['cs', 'en']).default('cs'),
});

interface EventRow {
  id: string;
  title: string;
  event_type: string | null;
  venue_name: string | null;
  city: string | null;
  event_date: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const ev = await db().query<EventRow>(
    `SELECT e.id, e.title, e.event_type, v.name AS venue_name, v.city,
            e.event_date::text AS event_date
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE e.id = $1 AND e.promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (ev.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const event = ev.rows[0]!;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      provider: 'template',
      variants: templateFallback(event, parsed.data),
    });
  }

  try {
    const variants = await generateWithClaude({
      apiKey,
      event,
      keywords: parsed.data.keywords,
      tone: parsed.data.tone,
      language: parsed.data.language,
    });
    return NextResponse.json({ provider: 'claude', variants });
  } catch (err) {
    console.error('[ai-description]', err);
    return NextResponse.json({
      provider: 'template_fallback',
      variants: templateFallback(event, parsed.data),
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}

interface Variant {
  kind: 'short' | 'medium' | 'long';
  text: string;
}

interface GenerateInput {
  apiKey: string;
  event: EventRow;
  keywords: string[];
  tone: 'casual' | 'professional' | 'energetic';
  language: 'cs' | 'en';
}

async function generateWithClaude(input: GenerateInput): Promise<Variant[]> {
  const langInstruction = input.language === 'cs' ? 'česky' : 'in English';
  const toneLabel = {
    casual: 'přátelský, neformální',
    professional: 'profesionální, věcný',
    energetic: 'energický, akční',
  }[input.tone];

  const prompt = `Vygeneruj 3 varianty popisu akce ${langInstruction} pro ticketing platformu.

Kontext akce:
- Název: ${input.event.title}
- Typ: ${input.event.event_type ?? 'neuvedeno'}
- Místo: ${input.event.venue_name ?? 'neuvedeno'}${input.event.city ? `, ${input.event.city}` : ''}
- Datum: ${input.event.event_date ?? 'neuvedeno'}
- Klíčová slova: ${input.keywords.join(', ')}
- Tón: ${toneLabel}

Vrať PŘÍMO JSON (bez markdown wrappers), exact format:
{"short": "1-2 věty (max 200 znaků)", "medium": "3-5 vět (max 500 znaků)", "long": "8-12 vět (max 1500 znaků)"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
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

  // Vytáhni JSON z odpovědi (pro případ, že model přidal markdown fence).
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON in Claude response');
  }
  const parsed = JSON.parse(jsonMatch[0]) as {
    short?: string;
    medium?: string;
    long?: string;
  };
  return [
    { kind: 'short', text: parsed.short ?? '' },
    { kind: 'medium', text: parsed.medium ?? '' },
    { kind: 'long', text: parsed.long ?? '' },
  ].filter((v) => v.text.trim().length > 0) as Variant[];
}

function templateFallback(
  event: EventRow,
  input: { keywords: string[]; tone: string; language: string },
): Variant[] {
  const venue = event.venue_name ? ` v ${event.venue_name}` : '';
  const date = event.event_date
    ? new Date(event.event_date).toLocaleDateString('cs-CZ', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'brzy';
  const kws = input.keywords.slice(0, 5).join(', ');

  return [
    {
      kind: 'short',
      text: `${event.title}${venue} — ${date}. ${kws}.`,
    },
    {
      kind: 'medium',
      text: `${event.title} se uskuteční ${date}${venue}. Akce nabídne ${kws}. Rezervuj si vstupenku ještě dnes — kapacita je omezená.`,
    },
    {
      kind: 'long',
      text: `${event.title} je akce, kterou si nenech ujít. Uskuteční se ${date}${venue} a slibuje nezapomenutelný zážitek pro každého návštěvníka. Mezi hlavní atrakce patří ${kws}. Akce je vhodná pro všechny, kteří hledají kvalitní obsah, atmosféru a komunitní zážitek. Doporučujeme přijít včas, protože vstup je omezený kapacitou. Vstupenky jsou v prodeji online — koupíš je rychle a bez čekání. Těšíme se na tebe!`,
    },
  ];
}
