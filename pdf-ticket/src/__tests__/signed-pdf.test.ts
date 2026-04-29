import { describe, it, expect, vi } from 'vitest';
import {
  signPdfTicket,
  getSignedPdf,
  verifySignature,
  getSigningStats,
} from '../services/signed-pdf.service.js';
import type { DbAdapter } from '../services/signed-pdf.service.js';

const TICKET_ID = 'ticket-001';
const EVENT_ID = 'event-001';
const SIGNED_PDF_ID = 'signed-001';

function makeSignedPdfRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SIGNED_PDF_ID,
    ticket_id: TICKET_ID,
    event_id: EVENT_ID,
    pdf_url: 'https://cdn.tixly.cz/signed-tickets/ticket-001.pdf',
    signature_valid: true,
    signed_at: '2026-04-14T10:00:00Z',
    certificate_thumbprint: 'abc123def456...',
    expires_at: '2027-04-14T23:59:59Z',
    created_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: vi.fn(),
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('signPdfTicket', () => {
  it('podepíše PDF a uloží signed PDF record', async () => {
    const signFn = vi.fn().mockResolvedValue(Buffer.from('signed-pdf-content'));
    const db = makeDb([[makeSignedPdfRow()]]);

    const result = await signPdfTicket({
      ticketId: TICKET_ID,
      eventId: EVENT_ID,
      pdfContent: Buffer.from('unsigned-content'),
    }, signFn, 'cert-thumbprint', db);

    expect(result.signatureValid).toBe(true);
    expect(result.pdfUrl).toContain(TICKET_ID);
    expect(signFn).toHaveBeenCalledWith(
      expect.any(Buffer),
      'cert-thumbprint',
    );
  });

  it('vyhodí SIGNING_ERROR pokud podepsání selže', async () => {
    const signFn = vi.fn().mockRejectedValue(new Error('Invalid certificate'));
    const db = makeDb([]);

    await expect(
      signPdfTicket({
        ticketId: TICKET_ID,
        eventId: EVENT_ID,
        pdfContent: Buffer.from('content'),
      }, signFn, 'cert', db),
    ).rejects.toThrow('SIGNING_ERROR');
  });
});

describe('getSignedPdf', () => {
  it('vrátí podepsaný PDF dle ticket_id', async () => {
    const db = makeDb([[makeSignedPdfRow()]]);

    const result = await getSignedPdf(TICKET_ID, db);

    expect(result).not.toBeNull();
    expect(result?.ticketId).toBe(TICKET_ID);
    expect(result?.signatureValid).toBe(true);
  });

  it('vrátí null pokud PDF neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getSignedPdf(TICKET_ID, db);

    expect(result).toBeNull();
  });
});

describe('verifySignature', () => {
  it('vrátí valid=true pokud je podpis platný a cert nevypršel', async () => {
    const db = makeDb([[makeSignedPdfRow({ signature_valid: true, expires_at: '2027-04-14T23:59:59Z' })]]);

    const result = await verifySignature(SIGNED_PDF_ID, db);

    expect(result.valid).toBe(true);
  });

  it('vrátí valid=false pokud je cert expirován', async () => {
    const db = makeDb([[makeSignedPdfRow({ expires_at: '2025-04-14T23:59:59Z' })]]);

    const result = await verifySignature(SIGNED_PDF_ID, db);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('expired');
  });

  it('vrátí valid=false pokud signature_valid=false', async () => {
    const db = makeDb([[makeSignedPdfRow({ signature_valid: false })]]);

    const result = await verifySignature(SIGNED_PDF_ID, db);

    expect(result.valid).toBe(false);
  });
});

describe('getSigningStats', () => {
  it('vrátí statistiky: total, valid, expired pro event', async () => {
    const db = makeDb([[{ total: 100, valid: 95, expired: 5 }]]);

    const result = await getSigningStats(EVENT_ID, db);

    expect(result.total).toBe(100);
    expect(result.valid).toBe(95);
    expect(result.expired).toBe(5);
  });
});
