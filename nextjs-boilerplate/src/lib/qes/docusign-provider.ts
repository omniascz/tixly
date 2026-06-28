/**
 * DocuSign eSignature provider — eIDAS AES/QES via DocuSign EU.
 *
 * Env vars:
 *   DOCUSIGN_INTEGRATION_KEY  — OAuth client ID
 *   DOCUSIGN_SECRET_KEY       — OAuth client secret
 *   DOCUSIGN_ACCOUNT_ID       — DocuSign account GUID
 *   DOCUSIGN_BASE_URL         — https://eu.docusign.net/restapi (EU) nebo https://demo.docusign.net/restapi (sandbox)
 *   DOCUSIGN_HMAC_KEY         — HMAC klíč pro webhook verifikaci
 *
 * eIDAS QES: aktivovat "DocuSign Qualified" pro EU account (certifikát vydán QTSPs
 * Namirial, Certinomis nebo LuxTrust). Nastavit signing_type="qualified" v envelope.
 */

import type {
  IQESProvider, CreateRequestOpts, CreateRequestResult,
  QESStatus, SignatureProof,
} from './types';

interface DocuSignEnvelope {
  envelopeId: string;
  status: string;
  statusChangedDateTime: string;
  recipients?: {
    signers?: Array<{
      email: string;
      name: string;
      status: string;
      signedDateTime?: string;
    }>;
  };
}

interface DocuSignWebhookPayload {
  event: string;
  envelopeId: string;
  status: string;
  envelopeSummary?: DocuSignEnvelope;
}

export class DocuSignProvider implements IQESProvider {
  readonly name = 'docusign' as const;

  private get baseUrl(): string {
    return process.env.DOCUSIGN_BASE_URL ?? 'https://demo.docusign.net/restapi';
  }
  private get accountId(): string {
    return process.env.DOCUSIGN_ACCOUNT_ID ?? '';
  }
  private get hmacKey(): string {
    return process.env.DOCUSIGN_HMAC_KEY ?? '';
  }

  private async getAccessToken(): Promise<string> {
    const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
    const secretKey = process.env.DOCUSIGN_SECRET_KEY;
    if (!integrationKey || !secretKey) throw new Error('DocuSign credentials not configured');
    const creds = Buffer.from(`${integrationKey}:${secretKey}`).toString('base64');
    const r = await fetch('https://account-d.docusign.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${creds}`,
      },
      body: 'grant_type=client_credentials&scope=signature',
    });
    if (!r.ok) throw new Error(`DocuSign OAuth failed: ${r.status}`);
    const d = await r.json() as { access_token: string };
    return d.access_token;
  }

  async createRequest(opts: CreateRequestOpts): Promise<CreateRequestResult> {
    const token = await this.getAccessToken();

    const envelope = {
      emailSubject: `Prosím podepište: ${opts.documentTitle}`,
      status: 'sent',
      documents: [{
        documentId: '1',
        name: `${opts.documentTitle}.pdf`,
        documentBase64: opts.documentPdfBase64,
        fileExtension: 'pdf',
      }],
      recipients: {
        signers: [{
          email: opts.signerEmail,
          name: opts.signerName,
          recipientId: '1',
          routingOrder: '1',
          tabs: {
            signHereTabs: [{
              documentId: '1',
              pageNumber: '1',
              xPosition: '300',
              yPosition: '700',
            }],
          },
          // Pro eIDAS QES: identityVerification s QTSP
          // identityVerification: { workflowId: 'QES_WORKFLOW_ID' }
        }],
      },
      eventNotification: {
        url: opts.webhookUrl,
        loggingEnabled: 'true',
        envelopeEvents: [{ envelopeEventStatusCode: 'completed' }, { envelopeEventStatusCode: 'declined' }],
        includeEnvelopeVoidReason: 'true',
        requireAcknowledgment: 'true',
        useSoapInterface: 'false',
        includeDocuments: 'false',
        hmacKeyId: '1',
      },
      customFields: {
        textCustomFields: [{
          name: 'tixly_internal_id',
          value: opts.internalId,
          show: 'false',
          required: 'false',
        }],
      },
    };

    const r = await fetch(`${this.baseUrl}/v2.1/accounts/${this.accountId}/envelopes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(envelope),
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`DocuSign createEnvelope failed: ${r.status} ${err}`);
    }
    const data = await r.json() as { envelopeId: string };
    const externalRef = data.envelopeId;

    // Získat recipient view URL (embedded signing)
    const viewR = await fetch(
      `${this.baseUrl}/v2.1/accounts/${this.accountId}/envelopes/${externalRef}/views/recipient`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          returnUrl: `${process.env.APP_URL ?? 'http://localhost:3000'}/cs/qes-complete`,
          authenticationMethod: 'none',
          email: opts.signerEmail,
          userName: opts.signerName,
          clientUserId: opts.internalId,
        }),
      },
    );
    const viewData = await viewR.json() as { url: string };

    return { externalRef, signingUrl: viewData.url, provider: 'docusign' };
  }

  async getStatus(externalRef: string): Promise<{ status: QESStatus; proof?: SignatureProof }> {
    const token = await this.getAccessToken();
    const r = await fetch(
      `${this.baseUrl}/v2.1/accounts/${this.accountId}/envelopes/${externalRef}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) return { status: 'pending' };
    const env = await r.json() as DocuSignEnvelope;

    const statusMap: Record<string, QESStatus> = {
      sent: 'sent', delivered: 'viewed', completed: 'signed',
      declined: 'rejected', voided: 'expired',
    };
    return {
      status: statusMap[env.status] ?? 'pending',
      proof: env.status === 'completed' ? {
        provider: 'docusign',
        externalRef,
        signedAt: env.statusChangedDateTime,
        signatureLevel: 'AES',
      } : undefined,
    };
  }

  async downloadSignedDocument(externalRef: string): Promise<Buffer | null> {
    try {
      const token = await this.getAccessToken();
      const r = await fetch(
        `${this.baseUrl}/v2.1/accounts/${this.accountId}/envelopes/${externalRef}/documents/combined`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    } catch { return null; }
  }

  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean {
    if (!this.hmacKey) return true; // skip v dev
    try {
      const { createHmac } = require('crypto') as typeof import('crypto');
      const sig = headers['x-docusign-signature-1'];
      if (!sig) return false;
      const expected = createHmac('sha256', this.hmacKey).update(rawBody).digest('base64');
      return sig === expected;
    } catch { return false; }
  }

  parseWebhook(rawBody: string): { externalRef: string; status: QESStatus; proof?: SignatureProof } | null {
    try {
      const body = JSON.parse(rawBody) as DocuSignWebhookPayload;
      if (!body.envelopeId) return null;
      const statusMap: Record<string, QESStatus> = {
        completed: 'signed', declined: 'rejected', voided: 'expired',
      };
      const newStatus = statusMap[body.status];
      if (!newStatus) return null;
      const signer = body.envelopeSummary?.recipients?.signers?.[0];
      return {
        externalRef: body.envelopeId,
        status: newStatus,
        proof: newStatus === 'signed' ? {
          provider: 'docusign',
          externalRef: body.envelopeId,
          signedAt: signer?.signedDateTime ?? new Date().toISOString(),
          signatureLevel: 'AES',
        } : undefined,
      };
    } catch { return null; }
  }
}
