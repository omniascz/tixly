/**
 * AI moderation gate — vrstva 2 z 3-vrstvého content moderation flow (#217).
 *
 * Vrstva 1: keyword blocklist (`catalog.moderation_blocklist`) — okamžitá
 *           detekce známých zakázaných slov, žádný API call.
 * → Vrstva 2 (TENTO MODUL): AI volání nad title + description + ticket_types
 *           → {decision, categories, confidence, reasoning}.
 * Vrstva 3: human review queue (`/platform/event-moderation`).
 *
 * Trust signal: promotér s ≥5 schválenými akcemi v posledních 90 dnech je
 * "trusted" — pokud AI rozhodnutí je 'allow' a confidence ≥ 0.8, akce jde
 * rovnou do `published`. Ostatní (untrusted nebo nízká AI confidence) jdou
 * do `pending_review`.
 *
 * Default: mock provider (regex pattern). V produkci přepojit na Claude
 * API přes injectable `provider` parameter (vidíš `aiProviderFromEnv()`).
 */

export type ModerationDecision = 'allow' | 'flag' | 'reject';

export interface ModerationInput {
  title: string;
  description?: string;
  ticketTypeNames: string[];
  /**
   * Veřejná URL plakátu/cover image (Vercel Blob). Pokud je vyplněná a provider
   * umí vision (`moderateImage`), posoudí se i samotný obrázek — text může být
   * čistý, ale plakát obsahovat hákový kříž / extremistické symboly.
   */
  coverImageUrl?: string | null;
}

export interface ModerationResult {
  decision: ModerationDecision;
  categories: string[];
  /** 0–1, jak moc si je provider jist. */
  confidence: number;
  reasoning: string;
}

export interface ModerationProvider {
  moderate(input: ModerationInput): Promise<ModerationResult>;
  /**
   * Posoudí obrázek plakátu na veřejné URL. Volitelné — provideři bez vision
   * (mock) tuto metodu nemají a obrázková vrstva se přeskočí (fail-open na text).
   */
  moderateImage?(imageUrl: string): Promise<ModerationResult>;
}

/**
 * Mock provider — pro lokální demo bez Anthropic API key.
 * Detekuje:
 *   - reject: scam patterns ("100% return", "investment guarantee", "free crypto"),
 *             extremismus, slurs (low effort regex sample)
 *   - flag: ambivalentní symboly, nadměrný caps lock, podezřelé tags
 *   - allow: jinak
 */
export class MockModerationProvider implements ModerationProvider {
  // Mock provider — synchronous, ale implementuje async interface.
  // eslint-disable-next-line @typescript-eslint/require-await
  async moderate(input: ModerationInput): Promise<ModerationResult> {
    const text = [input.title, input.description ?? '', ...input.ticketTypeNames]
      .join(' ')
      .toLowerCase();

    const rejectPatterns: Array<{ re: RegExp; cat: string }> = [
      { re: /100\s*%\s*(zaručen|guarantee|return)/i, cat: 'scam_promise' },
      { re: /\b(investiční|investment)\s+(příležitost|opportunity)\b/i, cat: 'investment_scam' },
      { re: /\bfree\s+(crypto|bitcoin|nft)\b/i, cat: 'crypto_scam' },
      { re: /\bsex(\s+(trafficking|with\s+minor))/i, cat: 'serious_harm' },
      { re: /\b(racial\s+slur|n-word\s+used)\b/i, cat: 'hate_speech' },
    ];
    for (const p of rejectPatterns) {
      if (p.re.test(text)) {
        return {
          decision: 'reject',
          categories: [p.cat],
          confidence: 0.92,
          reasoning: `Mock provider detekoval pattern „${p.re.source}" (kategorie: ${p.cat}).`,
        };
      }
    }

    const flagPatterns: Array<{ re: RegExp; cat: string }> = [
      { re: /[A-Z]{20,}/, cat: 'caps_spam' },
      { re: /\b(controversial|kontroverzní)\b/i, cat: 'review_needed' },
    ];
    for (const p of flagPatterns) {
      if (p.re.test(input.title + ' ' + (input.description ?? ''))) {
        return {
          decision: 'flag',
          categories: [p.cat],
          confidence: 0.6,
          reasoning: `Mock provider označil k revizi (${p.cat}).`,
        };
      }
    }

    return {
      decision: 'allow',
      categories: [],
      confidence: 0.95,
      reasoning: 'Žádné rizikové patterns detekovány.',
    };
  }
}

/**
 * Claude API provider — pro produkci. NEPOUŽÍVÁ se v lokálním demu (vyžaduje
 * ANTHROPIC_API_KEY a síť). Stub — implementaci doplnit při deployi.
 */
export class ClaudeModerationProvider implements ModerationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-haiku-4-5-20251001',
  ) {}

  async moderate(input: ModerationInput): Promise<ModerationResult> {
    const systemPrompt = `Jsi moderátor obsahu ticketing platformy. Vyhodnoť, zda je daný popis akce vhodný k publikaci.

Pravidla:
- reject (s confidence ≥ 0.8): scam/podvod (zaručený výnos, investiční pyramidy), nelegální obsah (drogy, prostituce, zbraně), extremismus/nenávist, dětské zneužívání, jasné porušení autorských práv (např. „neoficiální" tribute s logem značky)
- flag (s confidence 0.5-0.8): ambivalentní obsah, který stojí za lidskou kontrolu — sportovní hazard, alkohol bez 18+ gating, neověřitelné medical claims, podezřelé influencer kampaně
- allow (s confidence ≥ 0.8): běžné akce — koncert, divadlo, festival, konference, sport

Vrať POUZE JSON v tomto formátu, nic jiného:
{"decision":"allow|flag|reject","categories":[...],"confidence":0-1,"reasoning":"česky max 200 znaků"}`;

    const userContent = `Title: ${input.title}
Description: ${input.description ?? '(žádný popis)'}
Ticket types: ${input.ticketTypeNames.join(', ')}`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 400,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        }),
      });
      if (!res.ok) {
        console.error('[claude-moderation] HTTP', res.status, await res.text().catch(() => ''));
        // Bezpečný default: flag pro human review (nikdy auto-reject při chybě)
        return {
          decision: 'flag',
          categories: ['provider_error'],
          confidence: 0.5,
          reasoning: `Claude API selhalo (HTTP ${res.status})`,
        };
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const textBlock = data.content?.find((b) => b.type === 'text')?.text ?? '';
      // Claude občas obalí JSON v markdown — strip ```json … ```
      const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          decision: 'flag',
          categories: ['parse_error'],
          confidence: 0.5,
          reasoning: 'Claude nevrátil parsovatelný JSON',
        };
      }
      const parsed = JSON.parse(jsonMatch[0]) as Partial<ModerationResult>;
      return {
        decision:
          parsed.decision === 'allow' || parsed.decision === 'reject'
            ? parsed.decision
            : 'flag',
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
        confidence:
          typeof parsed.confidence === 'number'
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0.5,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 200) : '',
      };
    } catch (e) {
      console.error('[claude-moderation] exception', e);
      return {
        decision: 'flag',
        categories: ['exception'],
        confidence: 0.5,
        reasoning: e instanceof Error ? e.message.slice(0, 200) : 'unknown error',
      };
    }
  }

  /**
   * Vision moderace plakátu. Claude dostane obrázek z veřejné URL a posoudí,
   * zda neobsahuje extremistické symboly, násilí, explicitní obsah apod.
   * Fail-safe: jakákoli chyba → 'flag' (nikdy auto-reject při selhání), aby
   * závadný obsah neprošel tiše, ale ani legální akce nebyla shozena kvůli výpadku.
   */
  async moderateImage(imageUrl: string): Promise<ModerationResult> {
    // Vision umíme jen nad veřejnou http(s) URL (Vercel Blob). Data/relativní
    // URL přeskočíme jako 'allow' — text vrstva pořád platí.
    if (!/^https?:\/\//i.test(imageUrl)) {
      return {
        decision: 'allow',
        categories: ['image_skipped_non_http'],
        confidence: 0.3,
        reasoning: 'Obrázek není na veřejné http(s) URL — vision přeskočen.',
      };
    }

    const systemPrompt = `Jsi moderátor plakátů ticketing platformy. Posuď, zda plakát akce obsahuje NEVHODNÝ vizuál.

Pravidla:
- reject (confidence ≥ 0.8): extremistické/nenávistné symboly (hákový kříž/svastika, SS runy, keltský kříž v nenávistném kontextu, číselné kódy 88 / 1488 / 14 words zobrazené jako symbol), nacistická gesta, glorifikace násilí, krev/gore explicitně, dětské zneužívání, explicitní pornografie, prodej drog/zbraní.
- flag (confidence 0.5-0.8): umělecká nahota, zbraně v uměleckém/historickém kontextu, alkohol/párty bez 18+ gating, šokující ale legální obraz, dvojznačné symboly.
- allow (confidence ≥ 0.8): běžné plakáty — koncert, divadlo, festival, konference, sport, rodinná akce.

Vrať POUZE JSON, nic jiného:
{"decision":"allow|flag|reject","categories":[...],"confidence":0-1,"reasoning":"česky max 200 znaků"}`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 400,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'url', url: imageUrl } },
                { type: 'text', text: 'Posuď tento plakát akce podle pravidel.' },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        console.error('[claude-moderation-image] HTTP', res.status, await res.text().catch(() => ''));
        return {
          decision: 'flag',
          categories: ['image_provider_error'],
          confidence: 0.5,
          reasoning: `Vision API selhalo (HTTP ${res.status}) — k lidské revizi.`,
        };
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const textBlock = data.content?.find((b) => b.type === 'text')?.text ?? '';
      const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          decision: 'flag',
          categories: ['image_parse_error'],
          confidence: 0.5,
          reasoning: 'Vision nevrátil parsovatelný JSON — k lidské revizi.',
        };
      }
      const parsed = JSON.parse(jsonMatch[0]) as Partial<ModerationResult>;
      return {
        decision:
          parsed.decision === 'allow' || parsed.decision === 'reject'
            ? parsed.decision
            : 'flag',
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
        confidence:
          typeof parsed.confidence === 'number'
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0.5,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 200) : '',
      };
    } catch (e) {
      console.error('[claude-moderation-image] exception', e);
      return {
        decision: 'flag',
        categories: ['image_exception'],
        confidence: 0.5,
        reasoning: e instanceof Error ? e.message.slice(0, 200) : 'unknown error',
      };
    }
  }
}

export function aiProviderFromEnv(): ModerationProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && process.env.MODERATION_PROVIDER !== 'mock') {
    return new ClaudeModerationProvider(key);
  }
  return new MockModerationProvider();
}

/** Trust threshold — kolik schválených akcí potřebuje promotér k auto-publish. */
export const TRUST_THRESHOLD_PUBLISHED_EVENTS = 5;

export interface GateDecision {
  /** Co dělat se statusem akce. */
  action: 'publish' | 'queue' | 'reject';
  status: 'published' | 'pending_review' | 'rejected';
  /** Výsledek textové moderace (title/description/ticket types). */
  ai: ModerationResult;
  /** Výsledek vision moderace plakátu (null pokud nebyl obrázek nebo provider neumí vision). */
  image: ModerationResult | null;
  trustedPromoter: boolean;
}

/**
 * Orchestrátor: AI rozhodnutí + trust signal → finální action.
 *
 * Pokud `MODERATION_AUTO_PUBLISH_DISABLED=1` v env, auto-publish je vypnut
 * (vše projde human review). Užitečné pro testy a opatrný staging rollout.
 */
export async function runAiGate(
  input: ModerationInput,
  trustedPromoter: boolean,
  provider: ModerationProvider = aiProviderFromEnv(),
): Promise<GateDecision> {
  const ai = await provider.moderate(input);

  // Vision vrstva: posoudíme plakát, pokud je URL a provider umí vision.
  let image: ModerationResult | null = null;
  if (input.coverImageUrl && typeof provider.moderateImage === 'function') {
    image = await provider.moderateImage(input.coverImageUrl);
  }

  // Reject, pokud text NEBO obrázek jistě zamítá.
  const textRejects = ai.decision === 'reject' && ai.confidence >= 0.8;
  const imageRejects = image?.decision === 'reject' && image.confidence >= 0.8;
  if (textRejects || imageRejects) {
    return { action: 'reject', status: 'rejected', ai, image, trustedPromoter };
  }

  // Auto-publish jen když OBĚ vrstvy říkají allow s vysokou jistotou
  // (a obrázek buď chybí, nebo je čistý) — a promotér je trusted.
  const autoPublishDisabled = process.env.MODERATION_AUTO_PUBLISH_DISABLED === '1';
  const textClean = ai.decision === 'allow' && ai.confidence >= 0.8;
  const imageClean = !image || (image.decision === 'allow' && image.confidence >= 0.8);
  if (!autoPublishDisabled && textClean && imageClean && trustedPromoter) {
    return { action: 'publish', status: 'published', ai, image, trustedPromoter };
  }

  // Cokoli jiného (flag, nízká jistota, untrusted, auto-publish off, podezřelý plakát) → lidská revize
  return { action: 'queue', status: 'pending_review', ai, image, trustedPromoter };
}
