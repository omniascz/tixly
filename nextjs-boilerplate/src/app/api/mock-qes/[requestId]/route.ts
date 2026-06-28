/**
 * GET  /api/mock-qes/[requestId]  — vrátí metadata žádosti (dokument, metadata)
 * POST /api/mock-qes/[requestId]  — potvrdí podpis nebo odmítnutí
 *
 * Toto je INTERNÍ mock endpoint — simuluje QTSP (DocuSign/Signicat).
 * V produkci nahrazen reálným QTSP.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

const APP_URL = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function GET(
  _req: NextRequest,
  { params }: { params: { requestId: string } },
): Promise<Response> {
  const row = await runWithServiceContext(() =>
    db().query(
      `SELECT id, document_type, document_hash, document_content_b64,
              signer_email, signer_name, status, expires_at, created_at
       FROM platform.qes_signing_requests
       WHERE id = $1
       LIMIT 1`,
      [params.requestId],
    ),
  ).then((r) => r.rows[0] as {
    id: string; document_type: string; document_hash: string;
    document_content_b64: string | null;
    signer_email: string; signer_name: string; status: string;
    expires_at: string; created_at: string;
  } | undefined);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.status === 'signed') return NextResponse.json({ error: 'Already signed', status: row.status }, { status: 409 });
  if (row.status === 'rejected') return NextResponse.json({ error: 'Already rejected', status: row.status }, { status: 409 });
  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Request expired', status: 'expired' }, { status: 410 });
  }

  return NextResponse.json({
    id: row.id,
    documentType: row.document_type,
    documentHash: row.document_hash,
    hasPdf: !!row.document_content_b64,
    pdfBase64: row.document_content_b64,
    signerEmail: row.signer_email,
    signerName: row.signer_name,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { requestId: string } },
): Promise<Response> {
  const body = await req.json() as { action: 'sign' | 'reject'; otp?: string };
  if (body.action !== 'sign' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action must be sign or reject' }, { status: 400 });
  }

  const row = await runWithServiceContext(() =>
    db().query(
      `SELECT id, status, expires_at, provider FROM platform.qes_signing_requests WHERE id=$1 LIMIT 1`,
      [params.requestId],
    ),
  ).then((r) => r.rows[0] as { id: string; status: string; expires_at: string; provider: string } | undefined);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.status === 'signed') return NextResponse.json({ error: 'Already signed' }, { status: 409 });
  if (row.status === 'rejected') return NextResponse.json({ error: 'Already rejected' }, { status: 409 });
  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Expired' }, { status: 410 });
  }

  const newStatus = body.action === 'sign' ? 'signed' : 'rejected';
  const signedAt = body.action === 'sign' ? new Date().toISOString() : null;
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '127.0.0.1';

  const proof = body.action === 'sign' ? {
    provider: 'mock',
    externalRef: params.requestId,
    signedAt,
    signatureLevel: 'AES',
    signerIp: ip,
    certificateSubject: 'CN=Mock Signer,O=Tixly Demo,C=CZ',
    certificateIssuer: 'CN=Tixly Mock CA,O=Tixly s.r.o.,C=CZ',
    certificateSerial: `MOCK${Date.now().toString(16).toUpperCase()}`,
  } : null;

  await runWithServiceContext(() =>
    db().query(
      `UPDATE platform.qes_signing_requests
       SET status=$1, signed_at=$2, signature_proof=$3, updated_at=NOW()
       WHERE id=$4`,
      [newStatus, signedAt, proof ? JSON.stringify(proof) : null, params.requestId],
    ),
  );

  // Zavolat vlastní webhook (mock → Tixly)
  const webhookPayload = JSON.stringify({
    requestId: params.requestId,
    status: newStatus,
    signedAt,
    signerIp: ip,
  });
  // fire-and-forget — neblokujeme odpověď
  fetch(`${APP_URL}/api/qes/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: webhookPayload,
  }).catch(() => {});

  return NextResponse.json({ ok: true, status: newStatus, proof });
}
