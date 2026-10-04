/** GET /api/platform/admin/invoices/[id]?format=pdf|isdoc — faktura provize (platform admin). Kolo 7, C-54. */
import { NextRequest, NextResponse } from 'next/server';
import { loadCommissionTaxDocument } from '@/lib/accounting/commission';
import { taxDocumentResponse } from '@/lib/accounting/render';
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const doc = await asSystemInTx(client, () => loadCommissionTaxDocument(client, params.id));
      await client.query('COMMIT');
      if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return taxDocumentResponse(doc, req.nextUrl.searchParams.get('format'));
    } finally {
      client.release();
    }
  });
}
