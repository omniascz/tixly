/**
 * POST /api/admin/scanner/cross-pass
 *
 * Body: { membershipId: uuid, eventId: uuid, totpCode?: string, eventDayId?: uuid }
 *
 * Cross-festival pass scan flow:
 *   1. Najde membership a bundle podle membershipId
 *   2. Ověří, že event je v bundle (catalog.cross_pass_events)
 *   3. Ověří, že promotér scaneru vlastní event
 *   4. (Optional) Validates TOTP proti membership.totp_secret_encrypted
 *   5. Per-event idempotence: jeden redemption na (membership, event) → další scan = already_redeemed
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';
import { decryptSecret } from '@/lib/crypto';
import { verifyTotpCode } from '@/lib/totp/verify';


const schema = z.object({
  membershipId: z.string().uuid(),
  eventId: z.string().uuid(),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  eventDayId: z.string().uuid().nullable().optional(),
});

interface MembershipRow {
  id: string;
  status: string;
  bundle_id: string;
  user_id: string;
  totp_secret_encrypted: Buffer;
  bundle_active: boolean;
  bundle_starts_at: string | null;
  bundle_ends_at: string | null;
  bundle_name: string;
  buyer_email: string;
  buyer_name: string | null;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // 1) Membership existuje + bundle pokrývá event
    const m = await client.query<MembershipRow>(
      `SELECT m.id, m.status, m.bundle_id, m.user_id, m.totp_secret_encrypted,
              b.active AS bundle_active, b.starts_at AS bundle_starts_at,
              b.ends_at AS bundle_ends_at, b.name AS bundle_name,
              u.email AS buyer_email, u.name AS buyer_name
       FROM tickets.cross_pass_memberships m
       JOIN catalog.cross_pass_bundles b ON b.id = m.bundle_id
       JOIN identity.users u ON u.id = m.user_id
       WHERE m.id = $1
       FOR UPDATE OF m`,
      [parsed.data.membershipId],
    );

    if (m.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { result: 'not_found', message: 'Cross-pass nenalezen.' },
        { status: 404 },
      );
    }
    const member = m.rows[0];

    if (member.status !== 'active' || !member.bundle_active) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          result: 'inactive',
          message: 'Cross-pass není aktivní (zrušený nebo pozastavený).',
        },
        { status: 409 },
      );
    }

    // Validity window
    const now = Date.now();
    if (member.bundle_starts_at && new Date(member.bundle_starts_at).getTime() > now) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { result: 'not_yet_valid', startsAt: member.bundle_starts_at },
        { status: 409 },
      );
    }
    if (member.bundle_ends_at && new Date(member.bundle_ends_at).getTime() < now) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { result: 'expired', endsAt: member.bundle_ends_at },
        { status: 409 },
      );
    }

    // 2) Bundle pokrývá event?
    const cov = await client.query<{ event_id: string }>(
      `SELECT event_id FROM catalog.cross_pass_events
       WHERE bundle_id = $1 AND event_id = $2`,
      [member.bundle_id, parsed.data.eventId],
    );
    if (cov.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          result: 'event_not_in_bundle',
          message: 'Tento cross-pass nepokrývá tuto akci.',
        },
        { status: 403 },
      );
    }

    // 3) Promotér vlastní event?
    const ev = await client.query<{ promoter_id: string; title: string }>(
      `SELECT promoter_id, title FROM catalog.events WHERE id = $1`,
      [parsed.data.eventId],
    );
    if (ev.rows.length === 0 || ev.rows[0].promoter_id !== promoter.promoterId) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { result: 'wrong_promoter', message: 'Akce patří jinému promotérovi.' },
        { status: 403 },
      );
    }

    // 4) TOTP (volitelně)
    if (parsed.data.totpCode) {
      const secretB64 = decryptSecret(member.totp_secret_encrypted.toString('base64'));
      const secretRaw = Buffer.from(secretB64, 'base64');
      const ok = verifyTotpCode(parsed.data.totpCode, secretRaw, { window: 1 });
      if (!ok) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { result: 'totp_mismatch', message: 'TOTP kód neodpovídá.' },
          { status: 401 },
        );
      }
    }

    // 5) Per-event idempotence
    const existing = await client.query<{ id: string; redeemed_at: string }>(
      `SELECT id, redeemed_at FROM tickets.cross_pass_redemptions
       WHERE membership_id = $1 AND event_id = $2`,
      [member.id, parsed.data.eventId],
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({
        result: 'already_redeemed',
        redeemedAt: existing.rows[0].redeemed_at,
        eventTitle: ev.rows[0].title,
        bundleName: member.bundle_name,
        buyer: { email: member.buyer_email, name: member.buyer_name },
        message: `Cross-pass už byl použit pro tuto akci ${new Date(existing.rows[0].redeemed_at).toLocaleString('cs-CZ')}.`,
      });
    }

    // POZOR: tabulka cross_pass_redemptions nemá sloupec event_day_id (a nikdy neměla —
    // ani pod jiným jménem). Datový model je per-event: idempotence výše je klíčovaná na
    // (membership_id, event_id), per-day redemption neexistuje. eventDayId je z requestu
    // nadále přijímán (viz schema), ale ZÁMĚRNĚ nepersistován. Per-day by byla samostatná
    // featura (nový sloupec + změna idempotence), ne tento drift fix.
    await client.query(
      `INSERT INTO tickets.cross_pass_redemptions
         (membership_id, event_id, scanned_by_user_id)
       VALUES ($1, $2, $3)`,
      [
        member.id,
        parsed.data.eventId,
        promoter.userId,
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      result: 'admitted',
      kind: 'cross_pass',
      eventTitle: ev.rows[0].title,
      bundleName: member.bundle_name,
      buyer: { email: member.buyer_email, name: member.buyer_name },
      admittedAt: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[scanner cross-pass]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
