/**
 * AI content moderation. Klasifikuje event content do 3 kategorií:
 *   - safe         — auto-publish (může na trust score)
 *   - sensitive    — pending_review (lidský moderátor)
 *   - prohibited   — auto-reject
 *
 * Production: volá OpenAI Moderation API (free) + GPT-4o-mini pro nuance kontextu.
 * Demo (no OPENAI_API_KEY): keyword-based fallback s rozšířeným seznamem.
 */

const PROHIBITED_PATTERNS = [
  // Hate, NSDAP/extremist
  /\bnsdap\b/i,
  /\bheil\b.*hitler/i,
  /\bsieg heil\b/i,
  /\bbílá rasa\b/i,
  /\bjudenfrei\b/i,
  // Drogy explicit sale
  /\bprodej.*kokain\b/i,
  /\bcrystal meth\b/i,
  // Násilí
  /\bcall to violence\b/i,
  /\bzabij(eme|me)\b/i,
];

const SENSITIVE_PATTERNS = [
  /\b18\+\b/i,
  /\berotic/i,
  /\bsex(uál(ní|ně)?|y)\b/i,
  /\bporno?/i,
  /\balkohol|booze|opilost/i,
  /\bpolitic[áa]/i,
  /\bextrem(ism|us|ní)/i,
];

export interface ModerationInput {
  title: string;
  description?: string | null;
  ticketTypeNames?: string[];
}

export interface ModerationResult {
  decision: 'safe' | 'sensitive' | 'prohibited';
  status: 'published' | 'pending_review' | 'rejected';
  reasoning: string;
  confidence: number; // 0..1
  flaggedPatterns: string[];
  provider: 'openai' | 'stub';
}

export async function moderate(input: ModerationInput): Promise<ModerationResult> {
  const corpus = [input.title, input.description ?? '', ...(input.ticketTypeNames ?? [])].join(' ');

  // Production path: OpenAI
  if (process.env.OPENAI_API_KEY && process.env.AI_MODERATION_MODE !== 'stub') {
    try {
      return await moderateWithOpenAI(corpus, input);
    } catch (err) {
      console.error('[ai moderation openai]', err);
      // Fallthrough na stub
    }
  }

  return moderateStub(corpus);
}

async function moderateWithOpenAI(
  corpus: string,
  input: ModerationInput,
): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY!;
  // 1) Free moderation API
  const modRes = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: corpus, model: 'omni-moderation-latest' }),
  });
  if (modRes.ok) {
    const j = (await modRes.json()) as {
      results?: { flagged?: boolean; categories?: Record<string, boolean> }[];
    };
    const r = j.results?.[0];
    if (r?.flagged) {
      const cats = Object.entries(r.categories ?? {})
        .filter(([, v]) => v)
        .map(([k]) => k);
      const isViolent = cats.some((c) => c.includes('hate') || c.includes('violence'));
      return {
        decision: isViolent ? 'prohibited' : 'sensitive',
        status: isViolent ? 'rejected' : 'pending_review',
        reasoning: `OpenAI Moderation flagged: ${cats.join(', ')}`,
        confidence: 0.85,
        flaggedPatterns: cats,
        provider: 'openai',
      };
    }
  }

  // 2) Nuance check via GPT-4o-mini for context
  const promptRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a content moderator for a ticketing platform. Classify events as 'safe' (publish), 'sensitive' (human review), or 'prohibited' (reject). Respond with JSON: { "decision": ..., "reasoning": "..." }. Czech and English content both expected. Reject: hate speech, violence advocacy, illegal drug sales, terrorism. Sensitive: 18+ events, alcohol-heavy parties, controversial political topics. Safe: normal concerts, theatre, family events, sport.`,
        },
        {
          role: 'user',
          content: `Title: ${input.title}\n\nDescription: ${input.description ?? '(none)'}\n\nTicket types: ${input.ticketTypeNames?.join(', ') ?? '(none)'}`,
        },
      ],
      temperature: 0,
    }),
  });
  if (!promptRes.ok) throw new Error(`OpenAI HTTP ${promptRes.status}`);
  const promptJ = (await promptRes.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = promptJ.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as { decision?: string; reasoning?: string };
  const decision: ModerationResult['decision'] =
    parsed.decision === 'prohibited' ? 'prohibited' : parsed.decision === 'sensitive' ? 'sensitive' : 'safe';
  return {
    decision,
    status: decision === 'prohibited' ? 'rejected' : decision === 'sensitive' ? 'pending_review' : 'published',
    reasoning: parsed.reasoning ?? '',
    confidence: 0.9,
    flaggedPatterns: [],
    provider: 'openai',
  };
}

function moderateStub(corpus: string): ModerationResult {
  const flaggedProhibited: string[] = [];
  const flaggedSensitive: string[] = [];
  for (const pat of PROHIBITED_PATTERNS) {
    if (pat.test(corpus)) flaggedProhibited.push(pat.source);
  }
  for (const pat of SENSITIVE_PATTERNS) {
    if (pat.test(corpus)) flaggedSensitive.push(pat.source);
  }
  if (flaggedProhibited.length > 0) {
    return {
      decision: 'prohibited',
      status: 'rejected',
      reasoning: `Stub: matched prohibited pattern(s): ${flaggedProhibited.slice(0, 3).join(', ')}`,
      confidence: 0.95,
      flaggedPatterns: flaggedProhibited,
      provider: 'stub',
    };
  }
  if (flaggedSensitive.length > 0) {
    return {
      decision: 'sensitive',
      status: 'pending_review',
      reasoning: `Stub: matched sensitive pattern(s): ${flaggedSensitive.slice(0, 3).join(', ')}. Human review recommended.`,
      confidence: 0.7,
      flaggedPatterns: flaggedSensitive,
      provider: 'stub',
    };
  }
  return {
    decision: 'safe',
    status: 'published',
    reasoning: 'Stub: no flagged patterns matched. Auto-publish.',
    confidence: 0.6,
    flaggedPatterns: [],
    provider: 'stub',
  };
}
