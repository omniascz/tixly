// =============================================================================
// Digitally signed PDF tickets — PKI signatures (Feature #185)
//
// Každá PDF vstupenka podepsána kryptografickým klíčem (X.509 certifikátem).
// Při otevření v Adobe Acrobat Reader se zobrazí ověření pravosti.
// Diferenciátor pro pořadatele řešící padělání vstupenek.
//
// SCHEMA: pdf_signatures.* (migration 124)
// =============================================================================

export interface SignedPdfTicket {
  id: string;
  ticketId: string;
  eventId: string;
  pdfUrl: string;                    // URL na podepsaný PDF
  signatureValid: boolean;
  signedAt: string;
  certificateThumbprint: string;
  expiresAt: string | null;
}

export interface SignPdfInput {
  ticketId: string;
  eventId: string;
  pdfContent: Buffer;                // raw PDF bytes
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

/**
 * Injectable interface pro PDF signing — umožňuje testování.
 */
export interface PdfSigningFn {
  (pdfBuffer: Buffer, certificateThumbprint: string): Promise<Buffer>;
}

interface SignedPdfRow {
  id: string;
  ticket_id: string;
  event_id: string;
  pdf_url: string;
  signature_valid: boolean;
  signed_at: string;
  certificate_thumbprint: string;
  expires_at: string | null;
}

function mapSignedPdf(row: SignedPdfRow): SignedPdfTicket {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    eventId: row.event_id,
    pdfUrl: row.pdf_url,
    signatureValid: row.signature_valid,
    signedAt: row.signed_at,
    certificateThumbprint: row.certificate_thumbprint,
    expiresAt: row.expires_at,
  };
}

/**
 * Podepíše PDF a uloží odkaz na podepsaný PDF.
 * V produkci: volá iText/PDFBox s X.509 certifikátem z KMS.
 */
export async function signPdfTicket(
  input: SignPdfInput,
  signFn: PdfSigningFn,
  certificateThumbprint: string,
  db: DbAdapter,
): Promise<SignedPdfTicket> {
  let signedPdfBuffer: Buffer;
  try {
    signedPdfBuffer = await signFn(input.pdfContent, certificateThumbprint);
  } catch (err) {
    throw new Error(`SIGNING_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }

  // V produkci: uploaduj do S3 s signed URL
  const pdfUrl = `https://cdn.tixly.cz/signed-tickets/${input.ticketId}.pdf`;

  const rows = await db.query<SignedPdfRow>(
    `INSERT INTO pdf_signatures.signed_pdfs
       (ticket_id, event_id, pdf_url, signature_valid, certificate_thumbprint)
     VALUES ($1, $2, $3, true, $4)
     RETURNING *`,
    [input.ticketId, input.eventId, pdfUrl, certificateThumbprint],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: signed PDF insert failed');
  return mapSignedPdf(rows[0]);
}

/**
 * Vrátí podepsaný PDF ticket dle ID.
 */
export async function getSignedPdf(ticketId: string, db: DbAdapter): Promise<SignedPdfTicket | null> {
  const rows = await db.query<SignedPdfRow>(
    `SELECT * FROM pdf_signatures.signed_pdfs WHERE ticket_id = $1`,
    [ticketId],
  );
  return rows[0] ? mapSignedPdf(rows[0]) : null;
}

/**
 * Ověří že podpis je stále platný (certificate exp > NOW).
 */
export async function verifySignature(
  pdfId: string,
  db: DbAdapter,
): Promise<{ valid: boolean; reason?: string }> {
  const pdfs = await db.query<SignedPdfRow>(
    `SELECT * FROM pdf_signatures.signed_pdfs WHERE id = $1`,
    [pdfId],
  );
  if (!pdfs[0]) {
    return { valid: false, reason: 'PDF not found' };
  }

  const pdf = pdfs[0];
  if (!pdf.signature_valid) {
    return { valid: false, reason: 'Signature invalid' };
  }
  if (pdf.expires_at && new Date(pdf.expires_at) < new Date()) {
    return { valid: false, reason: 'Certificate expired' };
  }

  return { valid: true };
}

/**
 * Vrátí statistiky podepsaných vstupenek pro event.
 */
export async function getSigningStats(
  eventId: string,
  db: DbAdapter,
): Promise<{ total: number; valid: number; expired: number }> {
  const rows = await db.query<{ total: number; valid: number; expired: number }>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN signature_valid = true AND (expires_at IS NULL OR expires_at > NOW()) THEN 1 ELSE 0 END) as valid,
       SUM(CASE WHEN expires_at <= NOW() THEN 1 ELSE 0 END) as expired
     FROM pdf_signatures.signed_pdfs
     WHERE event_id = $1`,
    [eventId],
  );
  if (!rows[0]) return { total: 0, valid: 0, expired: 0 };
  return {
    total: rows[0].total || 0,
    valid: rows[0].valid || 0,
    expired: rows[0].expired || 0,
  };
}
