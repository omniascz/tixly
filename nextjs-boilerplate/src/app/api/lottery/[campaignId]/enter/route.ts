import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
});

export async function POST(req: NextRequest, props: { params: Promise<{ campaignId: string }> }): Promise<Response> {
  const params = await props.params;
  return runWithServiceContext(async () => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    const campaignRes = await db().query<{
      id: string;
      status: string;
      registration_closes: string;
      draw_at: string;
      entry_count: number;
    }>(
      `SELECT id, status, registration_closes, draw_at, entry_count
       FROM orders.lottery_campaigns
       WHERE id = $1`,
      [params.campaignId],
    );

    if (campaignRes.rows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const campaign = campaignRes.rows[0];

    if (campaign.status !== 'open') {
      return NextResponse.json(
        { error: 'REGISTRATION_CLOSED', message: 'Registrace je uzavřena.' },
        { status: 409 },
      );
    }

    if (new Date(campaign.registration_closes).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'REGISTRATION_CLOSED', message: 'Registrace je uzavřena.' },
        { status: 409 },
      );
    }

    await db().query(
      `INSERT INTO orders.lottery_entries (campaign_id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (campaign_id, email) DO NOTHING`,
      [params.campaignId, parsed.data.email.toLowerCase(), parsed.data.name],
    );

    const countRes = await db().query<{ entry_count: number }>(
      `UPDATE orders.lottery_campaigns
       SET entry_count = (
         SELECT COUNT(*) FROM orders.lottery_entries WHERE campaign_id = $1
       )
       WHERE id = $1
       RETURNING entry_count`,
      [params.campaignId],
    );

    const drawDate = new Date(campaign.draw_at).toLocaleDateString('cs-CZ', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    return NextResponse.json({
      ok: true,
      position: countRes.rows[0]?.entry_count ?? campaign.entry_count,
      message: `Zapsáni! Losování proběhne ${drawDate}.`,
    });
  });
}
