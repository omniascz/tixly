/**
 * AI auto-tagging — z title + description vyextrahuje tagy.
 *
 * Production: GPT-4o-mini structured output.
 * Demo: keyword-based extraction s genre/audience/vibe taxonomy.
 */

const GENRE_KEYWORDS: Record<string, string[]> = {
  rock: ['rock', 'metal', 'punk', 'hardcore', 'grunge'],
  pop: ['pop', 'mainstream'],
  electronic: ['edm', 'house', 'techno', 'electronic', 'dnb', 'dubstep', 'trance'],
  jazz: ['jazz', 'swing', 'blues'],
  classical: ['classical', 'klasika', 'symfonický', 'filharmonie', 'opera', 'koncert'],
  hiphop: ['hip-hop', 'hiphop', 'rap', 'trap'],
  folk: ['folk', 'lidovka', 'country'],
  indie: ['indie', 'alternative'],
  reggae: ['reggae', 'ska', 'dub'],
  latin: ['latin', 'salsa', 'bachata', 'reggaeton'],
};

const AUDIENCE_KEYWORDS: Record<string, string[]> = {
  family: ['rodina', 'family', 'děti', 'kids', 'children'],
  adult: ['18+', '21+', 'adult', 'erotic'],
  senior: ['senior', 'seniors'],
  student: ['student', 'isic', 'mládež'],
  vip: ['vip', 'premium', 'luxury'],
};

const VIBE_KEYWORDS: Record<string, string[]> = {
  energetic: ['energy', 'energie', 'wild', 'banger', 'pump'],
  intimate: ['intimate', 'akustic', 'unplugged'],
  spectacular: ['lights', 'show', 'spektákl', 'visual'],
  underground: ['underground', 'klub', 'club'],
  outdoor: ['open-air', 'venku', 'outdoor', 'open air'],
  formal: ['gala', 'gala', 'ples', 'banquet'],
};

export interface AutoTagInput {
  title: string;
  description?: string | null;
  category?: string;
}

export interface AutoTagResult {
  tags: string[];
  byCategory: {
    genre: string[];
    audience: string[];
    vibe: string[];
  };
  provider: 'openai' | 'stub';
}

export async function autoTag(input: AutoTagInput): Promise<AutoTagResult> {
  if (process.env.OPENAI_API_KEY && process.env.AI_TAG_MODE !== 'stub') {
    try {
      return await tagWithOpenAI(input);
    } catch (err) {
      console.error('[ai auto-tag openai]', err);
    }
  }
  return tagStub(input);
}

async function tagWithOpenAI(input: AutoTagInput): Promise<AutoTagResult> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const corpus = `${input.title}\n\n${input.description ?? ''}\nCategory: ${input.category ?? ''}`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Extract event tags from text. Output JSON: { "genre": [], "audience": [], "vibe": [] }. Lowercase, no duplicates, max 3 per category. Genres examples: rock, pop, electronic, jazz, classical, hiphop, folk, indie. Audience: family, adult, senior, student, vip. Vibe: energetic, intimate, spectacular, underground, outdoor, formal.`,
        },
        { role: 'user', content: corpus },
      ],
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = j.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as {
    genre?: string[];
    audience?: string[];
    vibe?: string[];
  };
  const genre = (parsed.genre ?? []).slice(0, 3);
  const audience = (parsed.audience ?? []).slice(0, 3);
  const vibe = (parsed.vibe ?? []).slice(0, 3);
  return {
    tags: [...genre, ...audience, ...vibe],
    byCategory: { genre, audience, vibe },
    provider: 'openai',
  };
}

function tagStub(input: AutoTagInput): AutoTagResult {
  const corpus = `${input.title} ${input.description ?? ''}`.toLowerCase();
  function match(taxonomy: Record<string, string[]>): string[] {
    const out: string[] = [];
    for (const [tag, keywords] of Object.entries(taxonomy)) {
      if (keywords.some((k) => corpus.includes(k.toLowerCase()))) {
        out.push(tag);
      }
    }
    return out.slice(0, 3);
  }
  const genre = match(GENRE_KEYWORDS);
  const audience = match(AUDIENCE_KEYWORDS);
  const vibe = match(VIBE_KEYWORDS);
  return {
    tags: [...genre, ...audience, ...vibe],
    byCategory: { genre, audience, vibe },
    provider: 'stub',
  };
}
