/**
 * AI event description generator.
 *
 * Production: GPT-4o-mini (cheap, fast).
 * Demo: template-based fallback s 3 styles.
 */

const TEMPLATES = {
  cs: {
    energetic: (title: string, venue: string, date: string) =>
      `${title} přichází ${date} do ${venue}! Připrav se na nezapomenutelný večer plný energie, světel a emocí. Lístky se prodávají rychle — neváhej.`,
    elegant: (title: string, venue: string, date: string) =>
      `Srdečně vás zveme na ${title}, který se uskuteční ${date} v ${venue}. Tešte se na výjimečný kulturní zážitek v důstojné atmosféře.`,
    informative: (title: string, venue: string, date: string) =>
      `${title} — ${date}, ${venue}. Komplexní program, profesionální produkce, exkluzivní zážitek. Doporučujeme rezervovat lístky včas.`,
  },
  en: {
    energetic: (title: string, venue: string, date: string) =>
      `${title} hits ${venue} on ${date}! Get ready for an unforgettable night packed with energy, lights, and emotion. Tickets are flying — don't wait.`,
    elegant: (title: string, venue: string, date: string) =>
      `We cordially invite you to ${title}, taking place at ${venue} on ${date}. An exceptional cultural experience in a refined atmosphere awaits.`,
    informative: (title: string, venue: string, date: string) =>
      `${title} — ${date}, ${venue}. Comprehensive program, professional production, exclusive experience. We recommend booking early.`,
  },
};

export interface DescriptionInput {
  title: string;
  category: string;
  venue?: string;
  dateStart?: string;
  language: 'cs' | 'en' | 'de' | 'fr' | 'nl' | 'es' | 'pl' | 'sk';
  tone?: 'energetic' | 'elegant' | 'informative';
  extraContext?: string;
}

export interface DescriptionVariant {
  text: string;
  tone: 'energetic' | 'elegant' | 'informative';
  provider: 'openai' | 'stub';
}

export async function generateDescriptions(
  input: DescriptionInput,
): Promise<DescriptionVariant[]> {
  if (process.env.OPENAI_API_KEY && process.env.AI_DESC_MODE !== 'stub') {
    try {
      return await generateWithOpenAI(input);
    } catch (err) {
      console.error('[ai description openai]', err);
    }
  }
  return generateStub(input);
}

async function generateWithOpenAI(input: DescriptionInput): Promise<DescriptionVariant[]> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const tones: Array<DescriptionVariant['tone']> = ['energetic', 'elegant', 'informative'];
  const out: DescriptionVariant[] = [];
  for (const tone of tones) {
    const prompt = `You are writing a promotional description for a ticketed event. Output ONLY the description text (200-400 characters), in language code "${input.language}". Tone: ${tone}.

Event: ${input.title}
Category: ${input.category}
${input.venue ? `Venue: ${input.venue}\n` : ''}${input.dateStart ? `Date: ${input.dateStart}\n` : ''}${input.extraContext ? `Extra context: ${input.extraContext}\n` : ''}
Make it engaging, no clichés, no generic phrases like "you don't want to miss". No exclamation overuse.`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 200,
      }),
    });
    if (!res.ok) continue;
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content?.trim();
    if (text) out.push({ text, tone, provider: 'openai' });
  }
  return out.length > 0 ? out : generateStub(input);
}

function generateStub(input: DescriptionInput): DescriptionVariant[] {
  const lang = (input.language === 'en' ? 'en' : 'cs') as 'cs' | 'en';
  const template = TEMPLATES[lang];
  const venue = input.venue ?? (lang === 'cs' ? 'sále' : 'venue');
  const date =
    input.dateStart !== undefined
      ? new Date(input.dateStart).toLocaleDateString(lang === 'cs' ? 'cs-CZ' : 'en-US', {
          dateStyle: 'long',
        })
      : lang === 'cs'
        ? 'brzy'
        : 'soon';
  return (['energetic', 'elegant', 'informative'] as const).map((tone) => ({
    text: template[tone](input.title, venue, date),
    tone,
    provider: 'stub' as const,
  }));
}
