/**
 * POST /api/payments/wise/webhook
 *
 * Wise transfer state change notifications.
 * Handles: transfers#state-change (outgoing payout status updates)
 *
 * Bezpečnost (kolo 2 — fail-closed):
 *   - Wise podepisuje tělo RSA-SHA256 (Base64 v X-Signature-SHA256), ověřuje se VEŘEJNÝM
 *     klíčem Wise (env WISE_WEBHOOK_PUBLIC_KEY, PEM; produkční/sandbox klíč z dokumentace Wise).
 *     Dřív: HMAC se sdíleným tajemstvím, a bez WISE_WEBHOOK_SECRET se nic neověřovalo.
 *   - Bez veřejného klíče nebo API přístupu → 401, nic se nezmění.
 *   - Stav převodu se před změnou výplaty ověří dotazem GET /v1/transfers/{id} (autoritativní
 *     stav z API, ne z notifikace).
 *
 * Relevant statuses (z API):
 *   outgoing_payment_sent → mark payout 'paid'
 *   funds_refunded        → mark payout 'failed' + note refunded
 *   cancelled             → mark payout 'failed'
 *
 * Wise docs: https://docs.wise.com/guides/developer/webhooks/event-handling
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { getWiseConfig, getWiseTransferStatus, verifyWiseWebhookSignature } from '@/lib/payouts/wise';

export const dynamic = 'force-dynamic';

interface WiseWebhookEvent {
  event_type: string;       // 'transfers#state-change'
  subscription_id?: string;
  schema_version?: string;
  data: {
    resource: { id: number; profile_id?: number; type?: string };
    current_state?: string;  // schema 2.0.0
    previous_state?: string | null;
  };
}

function isWiseEvent(x: unknown): x is WiseWebhookEvent {
  const e = x as WiseWebhookEvent | null;
  return !!e && typeof e === 'object' && typeof e.event_type === 'string'
    && !!e.data && typeof e.data === 'object' && !!e.data.resource && Number.isFinite(Number(e.data.resource.id));
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const rawBody = await req.text();

    if (!process.env.WISE_WEBHOOK_PUBLIC_KEY || !getWiseConfig().isConfigured) {
      console.warn('[wise webhook] WISE_WEBHOOK_PUBLIC_KEY / API credentials missing — rejecting');
      return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 401 });
    }
    if (!verifyWiseWebhookSignature(rawBody, req.headers.get('x-signature-sha256'))) {
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
    }

    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
    }
    if (!isWiseEvent(event)) {
      return NextResponse.json({ error: 'UNKNOWN_EVENT_FORMAT' }, { status: 400 });
    }

    if (event.event_type !== 'transfers#state-change') {
      return NextResponse.json({ ok: true, reason: 'unhandled_event_type' });
    }

    const transferId = String(event.data.resource.id);

    // Autoritativní stav převodu z Wise API.
    let wiseStatus: string;
    try {
      wiseStatus = await getWiseTransferStatus(Number(transferId));
    } catch (err) {
      console.error('[wise webhook] transfer status lookup failed:', err);
      return NextResponse.json({ error: 'WISE_LOOKUP_FAILED' }, { status: 502 });
    }

    if (wiseStatus === 'outgoing_payment_sent') {
      const upd = await db().query(
        `UPDATE platform.payouts
         SET status = 'paid', executed_at = COALESCE(executed_at, NOW()),
             provider_confirmed_at = NOW(), paid_at = COALESCE(paid_at, NOW())
         WHERE external_payout_id = $1 AND payout_provider = 'wise'
           AND status IN ('processing', 'pending')`,
        [transferId],
      );
      console.info(`[wise webhook] paid transferId=${transferId} rowsUpdated=${upd.rowCount}`);
    } else if (wiseStatus === 'funds_refunded' || wiseStatus === 'cancelled') {
      await db().query(
        `UPDATE platform.payouts
         SET status = 'failed',
             failure_reason = $2
         WHERE external_payout_id = $1 AND payout_provider = 'wise'`,
        [transferId, `Wise status: ${wiseStatus}`],
      );
      console.warn(`[wise webhook] failed transferId=${transferId} status=${wiseStatus}`);
    }

    return NextResponse.json({ ok: true, transferId, wiseStatus, notifiedState: event.data.current_state ?? null });
  });
}
