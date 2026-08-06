/**
 * POST /api/internal/web-vitals
 *
 * Collect Web Vitals (LCP, FID, CLS, TTFB, INP, FCP) z prohlížeče.
 * Body: { name, value, id, navigationType, url }
 *
 * Storage: jednoduchá audit tabulka, alternativně forward do Datadog / Honeycomb / Sentry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { z } from 'zod';


const schema = z.object({
  name: z.enum(['LCP', 'FID', 'CLS', 'TTFB', 'INP', 'FCP']),
  value: z.number(),
  id: z.string().max(100),
  navigationType: z.string().max(40).optional(),
  url: z.string().url().max(500),
  rating: z.enum(['good', 'needs-improvement', 'poor']).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  let failed = 0;
  const errors: string[] = [];
  const insertVital = () => db().query(
    `INSERT INTO marketing.web_vitals (metric, value, navigation_type, url, rating, recorded_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      parsed.data.name,
      parsed.data.value,
      parsed.data.navigationType ?? null,
      parsed.data.url,
      parsed.data.rating ?? null,
    ],
  );

  try {
    await insertVital();
  } catch (err) {
    // Tabulka nemusi existovat — zalozit a INSERT ZOPAKOVAT.
    // Drive se po CREATE TABLE insert NEOPAKOVAL, takze i v "uspesne" vetvi se
    // metrika ztratila a routa presto vratila ok:true (FINDINGS §133).
    try {
      await db().query(
        `CREATE TABLE IF NOT EXISTS marketing.web_vitals (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          metric TEXT NOT NULL,
          value NUMERIC NOT NULL,
          navigation_type TEXT,
          url TEXT NOT NULL,
          rating TEXT,
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
      );
      await db().query(
        `CREATE INDEX IF NOT EXISTS web_vitals_metric_time_idx ON marketing.web_vitals(metric, recorded_at DESC)`,
      );
      await insertVital();
    } catch (err2) {
      failed = 1;
      errors.push(`${(err as Error).message.slice(0, 80)} | retry: ${(err2 as Error).message.slice(0, 80)}`);
    }
  }
  return NextResponse.json({
    ok: failed === 0,
    processed: failed === 0 ? 1 : 0,
    failed,
    errors,
  });

  });
}
