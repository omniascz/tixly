/**
 * POST   /api/admin/kyc/documents — register document URL (uploaded externally to S3/CDN)
 * DELETE /api/admin/kyc/documents?id=X — remove document
 *
 * V demu očekáváme že client uploadl soubor na S3 / Cloudinary / imgur a poslal nám URL.
 * V produkci by tu byl signed POST URL endpoint pro direct upload.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const postSchema = z.object({
  type: z.enum(['contract', 'bank_statement', 'id_proof', 'business_license', 'other']),
  fileUrl: z.string().url().max(500),
  fileName: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role !== 'owner') {
    return NextResponse.json({ error: 'OWNER_ONLY' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const r = await db().query<{ id: string }>(
    `INSERT INTO platform.promoter_documents
       (promoter_id, type, file_url, file_name, uploaded_by_user_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      promoter.promoterId,
      parsed.data.type,
      parsed.data.fileUrl,
      parsed.data.fileName ?? null,
      promoter.userId,
      parsed.data.notes ?? null,
    ],
  );
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role !== 'owner') {
    return NextResponse.json({ error: 'OWNER_ONLY' }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 422 });
  await db().query(
    `DELETE FROM platform.promoter_documents WHERE id = $1 AND promoter_id = $2`,
    [id, promoter.promoterId],
  );
  return NextResponse.json({ ok: true });
}
