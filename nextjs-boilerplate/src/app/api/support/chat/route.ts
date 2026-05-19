/**
 * POST /api/support/chat
 * Body: { message, promoterId?, language? }
 *
 * Public — chatbot RAG answer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { answerSupport } from '@/lib/ai/support-chat';

const schema = z.object({
  message: z.string().min(2).max(500),
  promoterId: z.string().uuid().optional(),
  language: z.enum(['cs', 'en']).default('cs'),
});

export async function POST(req: NextRequest): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  const result = await answerSupport(parsed.data);
  return NextResponse.json(result);
}
