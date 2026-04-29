/**
 * AI social media post generator.
 *
 * Generuje 3 platform-specific posts: Facebook, Instagram, Twitter/X.
 * - Facebook: ~150-200 znaků, 1-2 emojis, tone friendly
 * - Instagram: ~300-500 znaků, lots emojis + hashtags (8-12)
 * - Twitter/X: ~150 znaků (≤ 280), 2-3 hashtags, punchy
 *
 * Production: GPT-4o-mini.
 * Demo: template-based.
 */

export interface SocialPostInput {
  title: string;
  category: string;
  venue?: string;
  dateStart?: string;
  url?: string;
  language?: 'cs' | 'en';
}

export interface SocialPost {
  platform: 'facebook' | 'instagram' | 'twitter';
  text: string;
  hashtags: string[];
  characterCount: number;
  provider: 'openai' | 'stub';
}

export async function generateSocialPosts(input: SocialPostInput): Promise<SocialPost[]> {
  if (process.env.OPENAI_API_KEY && process.env.AI_SOCIAL_MODE !== 'stub') {
    try {
      return await generateWithOpenAI(input);
    } catch (err) {
      console.error('[ai social openai]', err);
    }
  }
  return generateStub(input);
}

async function generateWithOpenAI(input: SocialPostInput): Promise<SocialPost[]> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const lang = input.language ?? 'cs';
  const platforms: Array<{ platform: SocialPost['platform']; spec: string }> = [
    {
      platform: 'facebook',
      spec: '150-200 znaků, friendly tone, 1-2 emojis, výzva k akci, žádné hashtagy v textu',
    },
    {
      platform: 'instagram',
      spec: '300-500 znaků, energetic, hodně emoji, na konci 8-12 relevantních hashtagů',
    },
    {
      platform: 'twitter',
      spec: 'max 250 znaků (rezerva pro link), punchy, 2-3 hashtagy v textu',
    },
  ];
  const results: SocialPost[] = [];
  for (const p of platforms) {
    const prompt = `You are a social media manager promoting an event. Write a ${p.platform} post in ${lang === 'cs' ? 'Czech' : 'English'}. Spec: ${p.spec}.

Event: ${input.title}
Category: ${input.category}
${input.venue ? `Venue: ${input.venue}\n` : ''}${input.dateStart ? `Date: ${input.dateStart}\n` : ''}${input.url ? `URL: ${input.url}\n` : ''}
Output JSON: { "text": "...", "hashtags": ["#tag1", "#tag2"] }`;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 400,
      }),
    });
    if (!res.ok) continue;
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    try {
      const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? '{}') as {
        text?: string;
        hashtags?: string[];
      };
      if (parsed.text) {
        results.push({
          platform: p.platform,
          text: parsed.text,
          hashtags: parsed.hashtags ?? [],
          characterCount: parsed.text.length,
          provider: 'openai',
        });
      }
    } catch {
      // ignore parse error, fallback to stub for this platform
    }
  }
  return results.length > 0 ? results : generateStub(input);
}

function generateStub(input: SocialPostInput): SocialPost[] {
  const lang = input.language ?? 'cs';
  const dateStr = input.dateStart
    ? new Date(input.dateStart).toLocaleDateString(lang === 'cs' ? 'cs-CZ' : 'en-US', {
        day: 'numeric',
        month: 'long',
      })
    : lang === 'cs'
      ? 'brzy'
      : 'soon';
  const venuePart = input.venue ? `📍 ${input.venue}` : '';
  const urlPart = input.url ?? '';

  // Generate hashtags based on category + title words
  const titleWords = input.title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4);
  const hashtags = [
    `#${input.category}`,
    `#tixly`,
    ...titleWords.map((w) => `#${w.replace(/[^a-z0-9]/g, '')}`),
    '#liveevents',
    '#tickets',
  ].slice(0, 10);

  const fb =
    lang === 'cs'
      ? `🎉 ${input.title} — ${dateStr}\n\n${venuePart}\n\nLístky se prodávají rychle, neváhej a rezervuj si svůj zážitek. ${urlPart}`
      : `🎉 ${input.title} — ${dateStr}\n\n${venuePart}\n\nTickets selling fast, don't miss out. ${urlPart}`;

  const ig =
    lang === 'cs'
      ? `🔥 ${input.title} přichází ✨\n\n📅 ${dateStr}\n${venuePart}\n\nZažij to s námi naživo. Tag kamaráda, který musí přijít s tebou! 🎟\n\n${hashtags.join(' ')}`
      : `🔥 ${input.title} is coming ✨\n\n📅 ${dateStr}\n${venuePart}\n\nExperience it live. Tag a friend who has to come with you! 🎟\n\n${hashtags.join(' ')}`;

  const tw =
    lang === 'cs'
      ? `${input.title} — ${dateStr} ${venuePart} 🎟 ${hashtags.slice(0, 3).join(' ')} ${urlPart}`
      : `${input.title} — ${dateStr} ${venuePart} 🎟 ${hashtags.slice(0, 3).join(' ')} ${urlPart}`;

  return [
    {
      platform: 'facebook',
      text: fb,
      hashtags: [],
      characterCount: fb.length,
      provider: 'stub',
    },
    {
      platform: 'instagram',
      text: ig,
      hashtags,
      characterCount: ig.length,
      provider: 'stub',
    },
    {
      platform: 'twitter',
      text: tw.slice(0, 280),
      hashtags: hashtags.slice(0, 3),
      characterCount: tw.length,
      provider: 'stub',
    },
  ];
}
