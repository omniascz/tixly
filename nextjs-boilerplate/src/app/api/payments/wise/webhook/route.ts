/**
 * POST /api/payments/wise/webhook
 *
 * Wise transfer state change notifications.
 * Handles: transfers#state-change (outgoing payout status updates)
 *
 * Security: Wise signs with X-Signature-SHA256 header (SHA-256 HMAC of body).
 * Verify using WISE_WEBHOOK_SECRET env var.
 *
 * Relevant statuses:
 *   outgoing_payment_sent → mark payout 'paid'
 *   funds_refunded        → mark payout 'failed' + note refunded
 *   cancelled             → mark payout 'failed'
 *
 * Wise docs: https://docs.wise.com/api-docs/features/webhooks-notifications
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

interface WiseWebhookEvent {
  event_type: string;       // 'transfers#state-change'
  subscription_id: string;
  resource_id: number;      // Wise transfer ID
  resource_type: string;    // 'TRANSFER'
  occurred_at: string;
  data: {
    resource: {
      id: number;
      profile_id: number;
      status: string;       // 'outgoing_payment_sent' | 'funds_refunded' | 'cancelled' | etc.
      reference?: string;
    };
  };
}

function verifyWiseSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.WISE_WEBHOOK_SECRET;
  if (!secret) return true; // Skip if not configured (dev/test)
  try {
    const hmac = createHmac('sha256', secret).update(rawBody).digest('hex');
    const sig = signature.replace(/^sha256=/, '');
    const a = Buffer.from(hmac, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const rawBody = await req.text();
    const signature = req.headers.get('x-signature-sha256') ?? '';

    if (!verifyWiseSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 400 });
    }

    let event: WiseWebhookEvent;
    try {
      event = JSON.parse(rawBody) as WiseWebhookEvent;
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
    }

    if (event.event_type !== 'transfers#state-change') {
      return NextResponse.json({ ok: true, reason: 'unhandled_event_type' });
    }

    const transferId = String(event.data.resource.id);
    const wiseStatus = event.data.resource.status;

    if (wiseStatus === 'outgoing_payment_sent') {
      const upd = await db().query(
        `UPDATE platform.payouts
         SET status = 'paid', executed_at = COALESCE(executed_at, NOW()), updated_at = NOW()
         WHERE external_payout_id = $1 AND payout_provider = 'wise'
           AND status IN ('processing', 'pending')`,
        [transferId],
      );
      console.info(`[wise webhook] paid transferId=${transferId} rowsUpdated=${upd.rowCount}`);
    } else if (wiseStatus === 'funds_refunded' || wiseStatus === 'cancelled') {
      await db().query(
        `UPDATE platform.payouts
         SET status = 'failed',
             failure_reason = $2,
             updated_at = NOW()
         WHERE external_payout_id = $1 AND payout_provider = 'wise'`,
        [transferId, `Wise status: ${wiseStatus}`],
      );
      console.warn(`[wise webhook] failed transferId=${transferId} status=${wiseStatus}`);
    }

    return NextResponse.json({ ok: true, transferId, wiseStatus });
  });
}
