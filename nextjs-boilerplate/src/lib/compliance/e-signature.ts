/**
 * eIDAS — Electronic Signatures for Promoter Agreements
 *
 * Regulation (EU) No 910/2014 (eIDAS), Art. 3:
 *   (10) "Electronic signature" means data in electronic form which is attached
 *        to or logically associated with other data in electronic form and which
 *        is used by the signatory to sign.
 *
 * Tixly implements eIDAS Simple Electronic Signature (SES):
 *   - Signatory explicitly accepts document by clicking "I agree"
 *   - Acceptance timestamp + IP + user agent + document hash stored
 *   - Document hash prevents repudiation (proves WHICH version was signed)
 *
 * SES is legally valid under eIDAS Art. 25(1): "An electronic signature shall
 * not be denied legal effect and admissibility as evidence in legal proceedings
 * solely on the grounds that it is in an electronic form or that it does not
 * meet the requirements for qualified electronic signatures."
 *
 * For contracts above €5,000 or with EU public bodies, upgrade to AES/QES
 * via DocuSign/SignNow integration. Out of scope for this version.
 */

import { createHash } from 'crypto';

/** Supported document types */
export type DocumentType =
  | 'terms_of_service'
  | 'promoter_contract'
  | 'dpa'           // Data Processing Agreement (GDPR Art. 28)
  | 'privacy_policy';

/** Current document versions — bump when content changes */
export const DOCUMENT_VERSIONS: Record<DocumentType, string> = {
  terms_of_service:  '2026-06',
  promoter_contract: '2026-06',
  dpa:               '2026-06',
  privacy_policy:    '2026-06',
};

/**
 * Compute SHA-256 hash of document content at current version.
 * In production: hash the actual rendered document text fetched from /legal/*.
 * Stored in compliance.e_signatures.document_hash for later verification.
 */
export function hashDocument(documentType: DocumentType, version: string, content: string): string {
  return createHash('sha256')
    .update(`${documentType}:${version}:${content}`)
    .digest('hex');
}

/** Mask IP for GDPR: zero last IPv4 octet or IPv6 suffix */
export function maskIpForGdpr(ip: string): string {
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 4).join(':') + '::';
  }
  return ip.replace(/\.\d+$/, '.0');
}

export interface ESignatureRecord {
  userId: string;
  promoterId?: string;
  documentType: DocumentType;
  documentVersion: string;
  documentHash: string;
  ipAddress?: string;    // already masked
  userAgent?: string;
  locale?: string;
  signatureMethod: 'click_to_agree';
}

/**
 * Build a record to INSERT into compliance.e_signatures.
 * Call this when the user clicks "I accept" on a legal document.
 *
 * @param rawIp - Raw IP from request headers (will be GDPR-masked before storage)
 */
export function buildESignatureRecord(args: {
  userId: string;
  promoterId?: string;
  documentType: DocumentType;
  documentContent: string;   // rendered text of the document at signing time
  rawIp?: string;
  userAgent?: string;
  locale?: string;
}): ESignatureRecord {
  const version = DOCUMENT_VERSIONS[args.documentType];
  const hash = hashDocument(args.documentType, version, args.documentContent);

  return {
    userId: args.userId,
    promoterId: args.promoterId,
    documentType: args.documentType,
    documentVersion: version,
    documentHash: hash,
    ipAddress: args.rawIp ? maskIpForGdpr(args.rawIp) : undefined,
    userAgent: args.userAgent,
    locale: args.locale,
    signatureMethod: 'click_to_agree',
  };
}

/** Verify that a signature record matches the given document content */
export function verifySignature(
  record: Pick<ESignatureRecord, 'documentType' | 'documentVersion' | 'documentHash'>,
  documentContent: string,
): boolean {
  const expected = hashDocument(record.documentType, record.documentVersion, documentContent);
  return record.documentHash === expected;
}
