/**
 * POST /api/dsa/report
 *
 * DSA Art. 16 — Out-of-court content reporting mechanism.
 * Allows any user (logged in or anonymous) to report illegal content
 * hosted on the Tixly platform.
 *
 * Auth: optional (logged-in users get their userId linked; anonymous OK)
 * Rate limit: 5 reports/15min per IP (enforced via middleware)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { DSA_CATEGORIES, type DsaCategory, hashIp } from '@/lib/compliance/dsa';
import { notifyPlatformAdmin } from '@/lib/notifications/platform-notify';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = DSA_CATEGORIES.map((c) => c.key) as [DsaCategory, ...DsaCategory[]];

const ReportSchema = z.object({
  targetType:   z.enum(['event', 'promoter', 'ticket_type', 'listing']),
  targetId:     z.string().uuid().optional(),
  category:     z.enum(VALID_CATEGORIES),
  description:  z.string().min(20).max(2000),
  evidenceUrl:  z.string().url().optional(),
  reporterEmail: z.string().email().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const userId = req.headers.get('x-user-id') ?? undefined;
    const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '';

    let body: z.infer<typeof ReportSchema>;
    try {
      body = ReportSchema.parse(await req.json());
    } catch (err) {
      return NextResponse.json({ error: 'INVALID_INPUT', details: err }, { status: 400 });
    }

    const ipHash = rawIp ? hashIp(rawIp) : null;

    const res = await db().query<{ id: string }>(
      `INSERT INTO compliance.dsa_reports
         (reporter_user_id, reporter_email, target_type, target_id,
          category, description, evidence_url, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        userId ?? null,
        body.reporterEmail ?? null,
        body.targetType,
        body.targetId ?? null,
        body.category,
        body.description,
        body.evidenceUrl ?? null,
        ipHash,
      ],
    );

    const reportId = res.rows[0].id;

    // Notify platform team for high-severity categories
    const highSeverity = ['csam', 'terrorist_content', 'sanctions_violation'];
    if (highSeverity.includes(body.category)) {
      try {
        await notifyPlatformAdmin({
          kind: 'dsa_high_severity_report',
          title: `[DSA URGENT] ${body.category} report`,
          body: `Report ID ${reportId}: ${body.description.slice(0, 120)}`,
          link: `/admin/compliance/dsa/${reportId}`,
        });
      } catch {
        // best-effort
      }
    }

    return NextResponse.json({
      ok: true,
      reportId,
      message: 'Your report has been received. We will review it within 3 business days.',
    });
  });
}

/** GET /api/dsa/report — public contact info (Art. 11) */
export async function GET(): Promise<Response> {
  return NextResponse.json({
    contactEmail: 'dsa@tixly.cz',
    languages: ['cs', 'sk', 'en'],
    disputeBody: {
      name: 'Czech Trade Inspection Authority (ČOI)',
      url: 'https://www.coi.cz/en/',
    },
    euOdr: 'https://ec.europa.eu/consumers/odr/',
    processingTime: '3 business days',
  });
}
