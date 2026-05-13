import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /api/scanner/scans
// Batch record scans from offline queue. Idempotent on (ticket_id, scanned_at).
// Requires Authorization: Bearer token header.
// ---------------------------------------------------------------------------

const ScanRecordSchema = z.object({
  ticketId: z.string().min(1),
  scannedAt: z.number().int().positive(),
  result: z.enum(['valid', 'invalid', 'already_scanned']),
});

const ScansRequestSchema = z.object({
  scans: z.array(ScanRecordSchema),
});

type ScansRequest = z.infer<typeof ScansRequestSchema>;

interface ScansResponse {
  recorded: number;
  duplicates: number;
}

function parseAuthHeader(authHeader?: string): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // --- Auth check ---
  const authHeader = request.headers.get('Authorization');
  const token = parseAuthHeader(authHeader);
  if (!token) {
    return NextResponse.json(
      { error: 'Missing or invalid Authorization header' },
      { status: 401 },
    );
  }

  try {
    const body = await request.json();
    const { scans } = ScansRequestSchema.parse(body);

    if (scans.length === 0) {
      return NextResponse.json(
        { recorded: 0, duplicates: 0 },
        { status: 200 },
      );
    }

    const { Client } = await import('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    let recorded = 0;
    let duplicates = 0;

    // Process each scan with idempotency via upsert
    for (const scan of scans) {
      try {
        // Idempotent insert: if (ticket_id, scanned_at) exists, do nothing
        const result = await client.query(
          `
          INSERT INTO tickets.scans (ticket_id, scanned_at, result, created_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (ticket_id, scanned_at) DO NOTHING
          RETURNING id
          `,
          [scan.ticketId, new Date(scan.scannedAt), scan.result],
        );

        if (result.rows.length > 0) {
          recorded++;
        } else {
          duplicates++;
        }
      } catch (err) {
        console.error('[scanner/scans] error inserting scan', err);
        // Continue processing other scans
      }
    }

    await client.end();

    const response: ScansResponse = {
      recorded,
      duplicates,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: err.errors },
        { status: 400 },
      );
    }
    console.error('[scanner/scans]', err);
    return NextResponse.json(
      { error: 'Failed to record scans' },
      { status: 500 },
    );
  }
}
