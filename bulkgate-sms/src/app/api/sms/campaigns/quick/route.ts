import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';

// POST /api/sms/campaigns/quick
//
// Admin quick-send: pick clients by filter, compose text, send immediately.
// Filters: all | branch_id | package_status | custom_ids[]
// Does NOT use the full audience-segmentation pipeline — just a direct query.
// For each recipient, enqueues a row into sms.outbox (or calls sendSingleSms
// via the same bulkgate adapter). Response returns { queued, skipped }.
//
// This mirrors PulseUp's POST /admin-hromadna-sms.

const QuickCampaignSchema = z.object({
  text: z.string().min(1).max(2000),
  filter: z.discriminatedUnion('type', [
    z.object({ type: z.literal('all') }),
    z.object({ type: z.literal('branch'), branchId: z.string().uuid() }),
    z.object({ type: z.literal('active_package') }),
    z.object({ type: z.literal('ids'), clientIds: z.array(z.string().uuid()).min(1).max(1000) }),
  ]),
  channel: z.enum(['sms', 'email', 'both']).default('sms'),
  dryRun: z.boolean().optional(),
});

let _pool: Pool | undefined;
function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  const role = req.headers.get('x-user-role');
  const promoterId = req.headers.get('x-promoter-id');
  if (!userId || (role !== 'admin' && role !== 'promoter_admin')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  let body: z.infer<typeof QuickCampaignSchema>;
  try {
    body = QuickCampaignSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'VALIDATION', issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  // Build recipient query
  let recipientQuery: string;
  let recipientParams: unknown[];

  switch (body.filter.type) {
    case 'all':
      recipientQuery = `SELECT id, phone, email, first_name FROM identity.clients WHERE phone IS NOT NULL`;
      recipientParams = [];
      if (promoterId) {
        recipientQuery += ` AND promoter_id = $1`;
        recipientParams = [promoterId];
      }
      break;
    case 'branch':
      recipientQuery = `
        SELECT DISTINCT c.id, c.phone, c.email, c.first_name
          FROM identity.clients c
          JOIN ems.reservations r ON r.client_id = c.id
          JOIN ems.slots s ON s.id = r.slot_id
         WHERE s.branch_id = $1
           AND c.phone IS NOT NULL`;
      recipientParams = [body.filter.branchId];
      break;
    case 'active_package':
      recipientQuery = `
        SELECT DISTINCT c.id, c.phone, c.email, c.first_name
          FROM identity.clients c
          JOIN permanentky.client_packages p ON p.client_id = c.id
         WHERE p.status = 'active'
           AND p.valid_until > NOW()
           AND c.phone IS NOT NULL`;
      recipientParams = [];
      break;
    case 'ids':
      recipientQuery = `
        SELECT id, phone, email, first_name
          FROM identity.clients
         WHERE id = ANY($1::uuid[])
           AND phone IS NOT NULL`;
      recipientParams = [body.filter.clientIds];
      break;
  }

  recipientQuery += ` LIMIT 5000`;

  const { rows: recipients } = await pool().query<{
    id: string;
    phone: string;
    email: string | null;
    first_name: string | null;
  }>(recipientQuery, recipientParams);

  if (body.dryRun) {
    return NextResponse.json({
      dryRun: true,
      recipientCount: recipients.length,
      sampleRecipients: recipients.slice(0, 10).map((r) => ({
        id: r.id,
        phone: r.phone?.replace(/.{4}$/, '****'),
        firstName: r.first_name,
      })),
    });
  }

  // Enqueue messages. In production this should go through Kafka or a job queue.
  // For now, insert into a lightweight outbox table and let the sms-dispatcher
  // pick them up. We use a direct INSERT to keep this endpoint self-contained.
  let queued = 0;
  let skipped = 0;
  for (const r of recipients) {
    if (body.channel === 'sms' || body.channel === 'both') {
      if (r.phone) {
        try {
          await pool().query(
            `INSERT INTO sms.outbox (phone, text, category, promoter_id, created_by)
             VALUES ($1, $2, 'marketing', $3, $4)
             ON CONFLICT DO NOTHING`,
            [r.phone, body.text, promoterId, userId],
          );
          queued++;
        } catch {
          skipped++;
        }
      } else {
        skipped++;
      }
    }
    if (body.channel === 'email' || body.channel === 'both') {
      if (r.email) {
        try {
          await pool().query(
            `INSERT INTO email.outbox (email, subject, body_text, category, promoter_id, created_by)
             VALUES ($1, $2, $3, 'marketing', $4, $5)
             ON CONFLICT DO NOTHING`,
            [r.email, 'Zpráva od vašeho studia', body.text, promoterId, userId],
          );
          queued++;
        } catch {
          skipped++;
        }
      }
    }
  }

  return NextResponse.json({
    queued,
    skipped,
    recipientCount: recipients.length,
    channel: body.channel,
  });
}
