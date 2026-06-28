/**
 * eIDAS QES provider interface.
 * Implementace: MockQESProvider, DocuSignProvider, SignicatProvider.
 */

export type QESDocumentType = 'promoter_agreement' | 'reseller_agreement' | 'custom';
export type QESStatus = 'pending' | 'sent' | 'viewed' | 'signed' | 'rejected' | 'expired';
export type QESProvider = 'mock' | 'docusign' | 'signicat' | 'namirial';

export interface CreateRequestOpts {
  documentType: QESDocumentType;
  documentPdfBase64: string;  // base64 PDF content
  documentHash: string;       // SHA-256 hex
  signerEmail: string;
  signerName: string;
  /** Tixly internal signing request ID — bude v metadata od poskytovatele */
  internalId: string;
  /** URL kam QTSP pošle webhook po podpisu */
  webhookUrl: string;
  /** Název dokumentu zobrazený podepisujícímu */
  documentTitle: string;
  /** Platnost v hodinách */
  expiresInHours?: number;
}

export interface CreateRequestResult {
  /** ID envelopy/žádosti u QTSPs */
  externalRef: string;
  /** URL pro podepisujícího */
  signingUrl: string;
  provider: QESProvider;
}

export interface SignatureProof {
  provider: QESProvider;
  externalRef: string;
  signedAt: string;           // ISO 8601
  certificateSubject?: string;
  certificateSerial?: string;
  certificateIssuer?: string;
  timestampToken?: string;    // base64 RFC 3161
  ocspResponse?: string;      // base64
  signatureLevel?: 'SES' | 'AES' | 'QES';  // eIDAS level
  signerIp?: string;
  signerUserAgent?: string;
}

export interface IQESProvider {
  readonly name: QESProvider;
  createRequest(opts: CreateRequestOpts): Promise<CreateRequestResult>;
  getStatus(externalRef: string): Promise<{ status: QESStatus; proof?: SignatureProof }>;
  downloadSignedDocument(externalRef: string): Promise<Buffer | null>;
  /** Ověří podpis webhooku od QTSP poskytovatele */
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean;
  /** Parsuje webhook payload → externalRef + nový status */
  parseWebhook(rawBody: string): { externalRef: string; status: QESStatus; proof?: SignatureProof } | null;
}
