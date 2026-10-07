/**
 * POST /api/v3/tickets/[id]/secure-entry-token
 *
 * Partner client requestne short-lived token pro Secure Entry SDK.
 * Body: { partnerAccountId }
 * Scope: read_tickets
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runWithServiceContext } from '@/lib/db/rls-pool';
import { requireApiAuth, rateLimitCheck } from '@/lib/oauth/guard';
import { issueSecureEntryToken } from '@/lib/secure-entry/sdk';

const schema = z.object({
  partnerAccountId: z.string().min(1).max(200),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const auth = await requireApiAuth(req, 'read_tickets');
  if (!auth.ok) return auth.response;

  if (auth.ctx.type !== 'oauth' || !auth.ctx.clientPkId) {
    return NextResponse.json({
      error: 'oauth_required',
      message: 'Secure Entry vyžaduje OAuth Bearer token (ne API key).',
    }, { status: 403 });
  }
  const clientPkId = auth.ctx.clientPkId;

  const rl = await rateLimitCheck(auth.ctx, `/api/v3/tickets/${params.id}/secure-entry-token`, 'POST');
  if (!rl.ok) return rl.response;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  // Token issuance = server op (validuje ticket on-behalf partnera) → service.
  // Token issuance = server op (validuje ticket on-behalf partnera) → service.
  const result = await runWithServiceContext(() =>
    issueSecureEntryToken({
      clientPkId,
      ticketId: params.id,
      partnerAccountId: parsed.data.partnerAccountId,
    }),
  );

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({
    token: result.token,
    token_type: 'secure_entry',
    expires_at: result.expiresAt,
    refresh_interval_seconds: result.refreshIntervalSeconds,
    sdk_docs: 'https://docs.tixly.cz/secure-entry-sdk',
  }, { status: 201 });
}
