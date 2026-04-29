// =============================================================================
// AI asistent pro tvorbu akce — Feature #47
//
// Promotér vyplní minimum (hrubá představa, venue, kategorie),
// AI vygeneruje: název, popis, doporučenou cenu, SEO meta, tagy.
//
// Model: claude-haiku-4-5 (rychlý, levný pro interaktivní UX)
// Fallback: claude-sonnet-4-6 pokud haiku selže
// =============================================================================

import type { AiProviderConfig, CallClaudeOptions } from '@tixly/ai-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventAssistInput {
  /** Hrubá představa — pár vět nebo bullet points */
  idea: string;
  /** Název nebo typ venue (volitelné) */
  venue?: string;
  /** Kategorie akce */
  category?: string;
  /** Datum akce (ISO) */
  eventDate?: string;
  /** Odhadovaná kapacita */
  capacity?: number;
  /** Jazyk výstupu: 'cs' | 'en' */
  lang?: 'cs' | 'en';
  /** ID promotéra pro rate limiting a usage tracking */
  promoterId: string;
}

export interface EventAssistOutput {
  /** Navrhovaný název akce (max 80 znaků) */
  title: string;
  /** Popis akce v markdown (300–500 slov) */
  description: string;
  /** Kategorie a podkategorie */
  category: string;
  subcategory: string;
  /** Tagy pro vyhledávání */
  tags: string[];
  /** Doporučená minimální cena vstupenky (halíře) */
  recommendedPriceHalire: number;
  /** SEO meta title */
  seoTitle: string;
  /** SEO meta description (max 160 znaků) */
  seoDescription: string;
  /** Zda byl výsledek ze cache */
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_CS = `Jsi expert na tvorbu kulturních a sportovních akcí v České republice.
Tvým úkolem je pomoci promotérovi vytvořit profesionální popis akce.
Vždy odpovídej ve formátu JSON (bez markdown code bloků).
Doporučené ceny odpovídají CZ trhu v halířích (1 CZK = 100 halířů).
Buď konkrétní, přesvědčivý a zaměř se na zážitek pro návštěvníka.`;

const SYSTEM_EN = `You are an expert in cultural and sports event production.
Your task is to help a promoter create a professional event listing.
Always respond in JSON format (no markdown code blocks).
Recommended prices are in Czech halíře (1 CZK = 100 halíře).
Be specific, compelling, and focus on the attendee experience.`;

function buildPrompt(input: EventAssistInput, lang: 'cs' | 'en'): string {
  const lines = [
    lang === 'cs' ? 'Vytvoř obsah pro akci na základě těchto informací:' : 'Create event content based on:',
    `Idea: ${input.idea}`,
  ];
  if (input.venue) lines.push(`Venue: ${input.venue}`);
  if (input.category) lines.push(`Category: ${input.category}`);
  if (input.eventDate) lines.push(`Date: ${input.eventDate}`);
  if (input.capacity) lines.push(`Capacity: ${input.capacity}`);

  lines.push('');
  lines.push(lang === 'cs'
    ? 'Vrať JSON objekt s těmito klíči: title, description, category, subcategory, tags (array), recommendedPriceHalire (integer), seoTitle, seoDescription'
    : 'Return a JSON object with keys: title, description, category, subcategory, tags (array), recommendedPriceHalire (integer), seoTitle, seoDescription');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// AI caller interface (injected for testability)
// ---------------------------------------------------------------------------

export type CallAiFn = (options: CallClaudeOptions) => Promise<{ text: string; cached: boolean }>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export async function generateEventContent(
  input: EventAssistInput,
  callAi: CallAiFn,
): Promise<EventAssistOutput> {
  const lang = input.lang ?? 'cs';

  const options: CallClaudeOptions = {
    model: 'haiku',
    system: lang === 'cs' ? SYSTEM_CS : SYSTEM_EN,
    user: buildPrompt(input, lang),
    maxTokens: 1024,
    feature: 'event-assist',
    tenantId: input.promoterId,
  };

  const { text, cached } = await callAi(options);

  // Parse AI JSON response
  let parsed: Record<string, unknown>;
  try {
    // Strip potential markdown fences the model may include
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    throw new Error(`AI returned invalid JSON: ${text.slice(0, 200)}`);
  }

  const recommendedPrice = typeof parsed['recommendedPriceHalire'] === 'number'
    ? Math.round(parsed['recommendedPriceHalire'] as number)
    : 0;

  return {
    title: String(parsed['title'] ?? ''),
    description: String(parsed['description'] ?? ''),
    category: String(parsed['category'] ?? input.category ?? ''),
    subcategory: String(parsed['subcategory'] ?? ''),
    tags: Array.isArray(parsed['tags']) ? (parsed['tags'] as unknown[]).map(String) : [],
    recommendedPriceHalire: Math.max(0, recommendedPrice),
    seoTitle: String(parsed['seoTitle'] ?? '').slice(0, 70),
    seoDescription: String(parsed['seoDescription'] ?? '').slice(0, 160),
    cached,
  };
}
