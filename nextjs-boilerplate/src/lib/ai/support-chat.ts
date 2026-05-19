/**
 * AI customer support chatbot (RAG).
 *
 * Strategy:
 *   1. Retrieve top-3 FAQ entries by keyword overlap (demo) or embeddings (prod)
 *   2. LLM generates answer based on retrieved context, OR keyword-match fallback
 *
 * Production: GPT-4o-mini s system prompt z FAQ context.
 * Demo: keyword overlap scoring + return best FAQ verbatim.
 */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  language: string;
}

export interface ChatRequest {
  message: string;
  promoterId?: string;
  language?: string;
}

export interface ChatResponse {
  answer: string;
  sources: { id: string; question: string; category: string | null }[];
  confidence: 'high' | 'medium' | 'low';
  provider: 'openai' | 'stub';
}

export async function answerSupport(req: ChatRequest): Promise<ChatResponse> {
  // 1) Retrieve relevant FAQs (platform global + promoter-specific)
  const lang = req.language ?? 'cs';
  const args: unknown[] = [lang];
  let promoterClause = `(promoter_id IS NULL`;
  if (req.promoterId) {
    args.push(req.promoterId);
    promoterClause += ` OR promoter_id = $${args.length}`;
  }
  promoterClause += `)`;
  const r = await db().query<FaqEntry>(
    `SELECT id, question, answer, category, language
     FROM marketing.support_faq
     WHERE language = $1 AND active = true AND ${promoterClause}`,
    args,
  );

  const ranked = rankByKeywordOverlap(r.rows, req.message);
  const top = ranked.slice(0, 3);

  if (top.length === 0) {
    return {
      answer:
        'Bohužel jsem na tvůj dotaz nenašel odpověď v naší databázi. Kontaktuj prosím promotéra přímo přes detail objednávky nebo support@tixly.cz.',
      sources: [],
      confidence: 'low',
      provider: 'stub',
    };
  }

  // Production: ask LLM to synthesize
  if (process.env.OPENAI_API_KEY && process.env.AI_CHAT_MODE !== 'stub') {
    try {
      const llmAnswer = await synthesizeWithOpenAI(req.message, top, lang);
      return {
        answer: llmAnswer,
        sources: top.map((f) => ({ id: f.id, question: f.question, category: f.category })),
        confidence: top[0].score > 0.5 ? 'high' : 'medium',
        provider: 'openai',
      };
    } catch (err) {
      console.error('[ai chat openai]', err);
    }
  }

  // Stub: pokud má top match >0.4 score, vrátí ho verbatim. Jinak fallback.
  const best = top[0];
  if (best.score >= 0.4) {
    return {
      answer: best.answer,
      sources: top.map((f) => ({ id: f.id, question: f.question, category: f.category })),
      confidence: best.score > 0.6 ? 'high' : 'medium',
      provider: 'stub',
    };
  }
  return {
    answer:
      'Možná hledáš odpověď na jeden z těchto dotazů? Klikni a najdeš odpověď. Pokud ne, kontaktuj nás na support@tixly.cz.',
    sources: top.map((f) => ({ id: f.id, question: f.question, category: f.category })),
    confidence: 'low',
    provider: 'stub',
  };
}

function rankByKeywordOverlap(faqs: FaqEntry[], query: string): (FaqEntry & { score: number })[] {
  const tokens = tokenize(query);
  return faqs
    .map((f) => {
      const corpus = `${f.question} ${f.answer}`.toLowerCase();
      const corpusTokens = new Set(tokenize(corpus));
      let matches = 0;
      for (const t of tokens) {
        if (corpusTokens.has(t)) matches += 1;
      }
      return { ...f, score: tokens.length > 0 ? matches / tokens.length : 0 };
    })
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score);
}

function tokenize(s: string): string[] {
  const STOPWORDS = new Set([
    'jak', 'pro', 'kde', 'kdy', 'co', 'je', 'na', 'do', 'mi', 'mě', 'si', 'se',
    'how', 'what', 'where', 'when', 'why', 'the', 'is', 'a', 'an', 'i', 'my', 'me',
  ]);
  return s
    .toLowerCase()
    .split(/[^a-z0-9áéíóúčďěňřšťůýž]+/i)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

async function synthesizeWithOpenAI(
  question: string,
  topFaqs: (FaqEntry & { score: number })[],
  lang: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const context = topFaqs
    .map((f, i) => `[FAQ ${i + 1}]\nQ: ${f.question}\nA: ${f.answer}`)
    .join('\n\n');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a customer support agent for Tixly ticketing platform. Answer ONLY based on the provided FAQ context. Be concise (max 3 sentences). Reply in language code "${lang}". If you can't answer from FAQ, say "Bohužel na tento dotaz nemám odpověď" (in target lang).`,
        },
        {
          role: 'user',
          content: `Question: ${question}\n\nContext:\n${context}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 200,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content?.trim() ?? '';
}
