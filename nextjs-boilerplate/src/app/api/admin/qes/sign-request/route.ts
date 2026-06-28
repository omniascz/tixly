/**
 * POST /api/admin/qes/sign-request
 * Vytvoří žádost o elektronický podpis dokumentu.
 *
 * Body:
 *   documentType: 'promoter_agreement' | 'reseller_agreement' | 'custom'
 *   signerEmail?: string  (default: přihlášený uživatel)
 *   signerName?: string
 *   customDocumentBase64?: string  (jen pro documentType='custom')
 *   customDocumentTitle?: string
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { getQESProvider } from '@/lib/qes';
import { generatePromoterAgreementPdf } from '@/lib/qes/document-generator';
import { sendMail } from '@/lib/email/mailer';

export const dynamic = 'force-dynamic';

const APP_URL = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const body = await req.json() as {
      documentType?: string;
      signerEmail?: string;
      signerName?: string;
      customDocumentBase64?: string;
      customDocumentTitle?: string;
    };

    const documentType = body.documentType ?? 'promoter_agreement';
    if (!['promoter_agreement', 'reseller_agreement', 'custom'].includes(documentType)) {
      return NextResponse.json({ error: 'Invalid documentType' }, { status: 400 });
    }
    if (documentType === 'custom' && !body.customDocumentBase64) {
      return NextResponse.json({ error: 'customDocumentBase64 required for custom document' }, { status: 400 });
    }

    // Načíst promotéra
    const proR = await runWithServiceContext(() =>
      db().query(
        `SELECT p.name, p.email, p.company_ico FROM platform.promoters p WHERE p.id = $1`,
        [ctx.promoterId],
      ),
    );
    if (proR.rows.length === 0) return NextResponse.json({ error: 'Promoter not found' }, { status: 404 });
    const promoter = proR.rows[0] as { name: string; email: string; company_ico: string | null };

    const signerEmail = body.signerEmail ?? promoter.email;
    const signerName = body.signerName ?? promoter.name;

    // Vygenerovat dokument
    let pdfBase64: string;
    let sha256hex: string;
    let documentTitle: string;

    if (documentType === 'custom') {
      pdfBase64 = body.customDocumentBase64!;
      const buf = Buffer.from(pdfBase64, 'base64');
      sha256hex = require('crypto').createHash('sha256').update(buf).digest('hex') as string;
      documentTitle = body.customDocumentTitle ?? 'Dokument k podpisu';
    } else {
      const generated = await generatePromoterAgreementPdf({
        promoterName: signerName,
        companyName: promoter.name,
        ico: promoter.company_ico ?? undefined,
        email: signerEmail,
      });
      pdfBase64 = generated.pdfBase64;
      sha256hex = generated.sha256hex;
      documentTitle = generated.title;
    }

    // Vložit signing request do DB (zatím bez external_ref a signing_url)
    const insR = await runWithServiceContext(() =>
      db().query(
        `INSERT INTO platform.qes_signing_requests
           (promoter_id, document_type, document_hash, document_content_b64,
            signer_email, signer_name, status, provider, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8)
         RETURNING id`,
        [
          ctx.promoterId,
          documentType,
          sha256hex,
          pdfBase64,
          signerEmail,
          signerName,
          process.env.QES_PROVIDER ?? 'mock',
          ctx.userId,
        ],
      ),
    );
    const requestId = insR.rows[0].id as string;

    // Zavolat QTSP poskytovatele
    const provider = getQESProvider();
    const webhookUrl = `${APP_URL}/api/qes/webhook`;
    let result;
    try {
      result = await provider.createRequest({
        documentType: documentType as 'promoter_agreement' | 'reseller_agreement' | 'custom',
        documentPdfBase64: pdfBase64,
        documentHash: sha256hex,
        signerEmail,
        signerName,
        internalId: requestId,
        webhookUrl,
        documentTitle,
      });
    } catch (err) {
      // Rollback DB řádek
      await runWithServiceContext(() =>
        db().query(`DELETE FROM platform.qes_signing_requests WHERE id = $1`, [requestId]),
      );
      throw err;
    }

    // Uložit external_ref + signing_url + status=sent
    await runWithServiceContext(() =>
      db().query(
        `UPDATE platform.qes_signing_requests
         SET external_ref=$1, signing_url=$2, status='sent', updated_at=NOW()
         WHERE id=$3`,
        [result.externalRef, result.signingUrl, requestId],
      ),
    );

    // Poslat email podepisujícímu
    await sendMail({
      to: signerEmail,
      subject: `Podpište dokument: ${documentTitle}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2>Elektronický podpis dokumentu</h2>
          <p>Dobrý den, ${signerName},</p>
          <p>Žádáme vás o podpis dokumentu <strong>${documentTitle}</strong>.</p>
          <p>Dokument podepíšete kliknutím na odkaz níže:</p>
          <p style="margin:24px 0">
            <a href="${result.signingUrl}"
               style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;
                      text-decoration:none;font-weight:bold">
              Podepsat dokument
            </a>
          </p>
          <p style="font-size:12px;color:#666">
            Odkaz je platný 7 dní. SHA-256 dokumentu: <code>${sha256hex}</code><br>
            Podpis probíhá v souladu s nařízením EU 910/2014 (eIDAS).
          </p>
        </div>`,
    });

    return NextResponse.json({
      id: requestId,
      signingUrl: result.signingUrl,
      externalRef: result.externalRef,
      provider: result.provider,
      documentHash: sha256hex,
    }, { status: 201 });
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const rows = await runWithServiceContext(() =>
      db().query(
        `SELECT id, document_type, signer_email, signer_name, status, provider,
                signing_url, signed_at, expires_at, created_at, document_hash
         FROM platform.qes_signing_requests
         WHERE promoter_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [ctx.promoterId],
      ),
    );
    return NextResponse.json({ requests: rows.rows });
  });
}
