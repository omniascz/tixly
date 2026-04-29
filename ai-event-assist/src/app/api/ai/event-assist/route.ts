import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateEventContent } from '../../../../services/event-assist.service.js';
import { createAiClient } from '@tixly/ai-provider';

const InputSchema = z.object({
  idea: z.string().min(10).max(2000),
  venue: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  eventDate: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  lang: z.enum(['cs', 'en']).optional(),
});

// Singleton AI client (re-used across requests)
const aiClient = createAiClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Missing x-promoter-id' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await generateEventContent(
      { ...parsed.data, promoterId },
      (opts) => aiClient.call(opts),
    );
    return NextResponse.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-event-assist] error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'AI generation failed' }, { status: 500 });
  }
}
