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

  async moderate(_input: ModerationInput): Promise<ModerationResult> {
    void this.apiKey;
    void this.model;
    throw new Error('ClaudeModerationProvider není v lokálním demu připojen — use MockModerationProvider');
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
  ai: ModerationResult;
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

  if (ai.decision === 'reject' && ai.confidence >= 0.8) {
    return { action: 'reject', status: 'rejected', ai, trustedPromoter };
  }
  const autoPublishDisabled = process.env.MODERATION_AUTO_PUBLISH_DISABLED === '1';
  if (
    !autoPublishDisabled &&
    ai.decision === 'allow' &&
    ai.confidence >= 0.8 &&
    trustedPromoter
  ) {
    return { action: 'publish', status: 'published', ai, trustedPromoter };
  }
  // Anything else (flag, low confidence, untrusted promoter, auto-publish off) → human review
  return { action: 'queue', status: 'pending_review', ai, trustedPromoter };
}
