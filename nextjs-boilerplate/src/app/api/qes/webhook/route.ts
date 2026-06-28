/**
 * POST /api/qes/webhook
 * Přijímá callback od QTSP poskytovatele (DocuSign Connect, Signicat, nebo mock).
 * Aktualizuje status žádosti a při podpisu updatuje platform.promoters.contract_signed_at.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { getQESProvider } from '@/lib/qes';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });

  const provider = getQESProvider();

  // Ověřit signaturu webhoku
  if (!provider.verifyWebhookSignature(rawBody, headers)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const parsed = provider.parseWebhook(rawBody);
  if (!parsed) {
    // Neznámý event — ignorujeme (200 aby QTSP neopakoval)
    return NextResponse.json({ ok: true });
  }

  const { externalRef, status, proof } = parsed;

  // Najít signing request podle external_ref
  const findR = await runWithServiceContext(() =>
    db().query(
      `SELECT id, promoter_id, document_type, status AS current_status
       FROM platform.qes_signing_requests
       WHERE external_ref = $1
       LIMIT 1`,
      [externalRef],
    ),
  );
  if (findR.rows.length === 0) {
    return NextResponse.json({ ok: true }); // neznámý ref — ignorujeme
  }
  const row = findR.rows[0] as {
    id: string; promoter_id: string; document_type: string; current_status: string;
  };

  // Ignorovat přepis dokončeného stavu
  if (row.current_status === 'signed' || row.current_status === 'rejected') {
    return NextResponse.json({ ok: true });
  }

  const signedAt = status === 'signed' ? (proof?.signedAt ?? new Date().toISOString()) : null;

  await runWithServiceContext(async () => {
    const client = db();
    await client.query(
      `UPDATE platform.qes_signing_requests
       SET status=$1, signed_at=$2, signature_proof=$3, updated_at=NOW()
       WHERE id=$4`,
      [status, signedAt, proof ? JSON.stringify(proof) : null, row.id],
    );

    // Při podpisu promoter_agreement: uložit na promotéra
    if (status === 'signed' && row.document_type === 'promoter_agreement') {
      await client.query(
        `UPDATE platform.promoters
         SET contract_signed_at=$1, updated_at=NOW()
         WHERE id=$2 AND contract_signed_at IS NULL`,
        [signedAt, row.promoter_id],
      );
    }
  });

  return NextResponse.json({ ok: true });
}
