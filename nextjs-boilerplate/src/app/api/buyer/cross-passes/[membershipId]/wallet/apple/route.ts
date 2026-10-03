import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { buildPkpass } from '@/lib/wallet/apple-pass';
import type { PassData } from '@/lib/wallet/apple-pass';

interface MembershipRow {
  id: string;
  membership_code: string;
  valid_until: string | null;
  user_id: string;
  bundle_name: string;
  card_color: string | null;
  user_name: string | null;
  email: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { membershipId: string } },
): Promise<Response> {
  // Kolo 4: přihlášení před kontrolou konfigurace (anonym dřív dostal 503 a stav konfigurace).
  return runAsUser(req, async (userId) => {
    if (
      !process.env.APPLE_PASS_TYPE_IDENTIFIER &&
      !process.env.APPLE_PASS_CERT_PEM &&
      !process.env.APPLE_TEAM_IDENTIFIER
    ) {
      return NextResponse.json({ error: 'WALLET_NOT_CONFIGURED' }, { status: 503 });
    }
    const r = await db().query<MembershipRow>(
      `SELECT m.id, m.membership_code, m.valid_until, m.user_id,
              b.name AS bundle_name, b.card_color,
              u.name AS user_name, u.email
       FROM tickets.cross_pass_memberships m
       JOIN catalog.cross_pass_bundles b ON b.id = m.bundle_id
       JOIN identity.users u ON u.id = m.user_id
       WHERE m.id = $1`,
      [params.membershipId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const row = r.rows[0];
    if (row.user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const passData: PassData = {
      ticketId: row.id,
      eventTitle: row.bundle_name ?? 'Členská karta',
      eventDateIso: row.valid_until ?? new Date().toISOString(),
      ticketTypeName: 'Člen',
      holderName: row.user_name,
      holderEmail: row.email,
      venueName: null,
      qrPayload: row.membership_code,
      organizationName: 'Tixly',
      brandColorHex: row.card_color,
    };
    const out = buildPkpass(passData);

    await db().query(
      `UPDATE tickets.cross_pass_memberships SET card_issued_at = NOW() WHERE id = $1`,
      [row.id],
    );

    return new NextResponse(new Uint8Array(out.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="clenska-karta-${row.membership_code}.pkpass"`,
        'X-Wallet-Signed': out.signed ? 'true' : 'false',
        ...(out.note ? { 'X-Wallet-Note': encodeURIComponent(out.note) } : {}),
      },
    });
  });
}
