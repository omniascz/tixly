/**
 * Mock QTSP — simuluje eIDAS QES flow pro demo/development.
 * Signing page: /mock-qes/[requestId]
 * Nevydává reálný certifikát — pouze simuluje process.
 */

import type {
  IQESProvider, CreateRequestOpts, CreateRequestResult,
  QESStatus, SignatureProof,
} from './types';

export class MockQESProvider implements IQESProvider {
  readonly name = 'mock' as const;

  private get appUrl(): string {
    return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  }

  async createRequest(opts: CreateRequestOpts): Promise<CreateRequestResult> {
    // External ref = internal ID (mock nepotřebuje separátní ID)
    const externalRef = opts.internalId;
    const signingUrl = `${this.appUrl}/mock-qes/${externalRef}`;
    return { externalRef, signingUrl, provider: 'mock' };
  }

  async getStatus(_externalRef: string): Promise<{ status: QESStatus; proof?: SignatureProof }> {
    // Status je řízen přímo přes DB v mock flow (POST /api/mock-qes/[id])
    // Tato metoda se volá jen pokud QTSP webhooks nejsou k dispozici.
    return { status: 'pending' };
  }

  async downloadSignedDocument(_externalRef: string): Promise<Buffer | null> {
    return null; // mock nevrací reálný podepsaný dokument
  }

  verifyWebhookSignature(_rawBody: string, _headers: Record<string, string>): boolean {
    // Mock webhook nemá signaturu — vše povoleno (interní endpoint)
    return true;
  }

  parseWebhook(rawBody: string): { externalRef: string; status: QESStatus; proof?: SignatureProof } | null {
    try {
      const body = JSON.parse(rawBody) as {
        requestId?: string; status?: string; signedAt?: string; signerIp?: string;
      };
      if (!body.requestId || !body.status) return null;
      const proof: SignatureProof | undefined =
        body.status === 'signed'
          ? {
              provider: 'mock',
              externalRef: body.requestId,
              signedAt: body.signedAt ?? new Date().toISOString(),
              signatureLevel: 'AES',  // mock = AES (ne QES — bez QSCD)
              signerIp: body.signerIp,
              certificateSubject: 'CN=Mock Signer,O=Tixly Demo,C=CZ',
              certificateIssuer: 'CN=Tixly Mock CA,O=Tixly s.r.o.,C=CZ',
              certificateSerial: Math.floor(Math.random() * 1e15).toString(16).toUpperCase(),
            }
          : undefined;
      return {
        externalRef: body.requestId,
        status: body.status as QESStatus,
        proof,
      };
    } catch {
      return null;
    }
  }
}
