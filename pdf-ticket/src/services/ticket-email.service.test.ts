// =============================================================================
// Testy: ticket-email.service
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendTicketConfirmationEmail,
  slugify,
  type TicketEmailAdapter,
  type TicketConfirmationInput,
} from './ticket-email.service.js';
import type {
  PdfTicketDbAdapter,
  CryptoAdapter,
} from './pdf-ticket.service.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDbRow(ticketId: string) {
  return {
    ticketId,
    orderId: 'order-1234-5678',
    ticketTypeName: 'Standard',
    zone: 'A',
    seatNumber: '12',
    holderName: 'Jan Novák',
    holderEmail: 'jan@example.com',
    barcodeCode: 'TK-2026-ABCDEF-01',
    totpSecret: 'encrypted-secret',
    issuedAt: new Date('2026-04-01T10:00:00Z'),
    eventName: 'Festival Náměstí Míru',
    eventDate: new Date('2026-08-15T19:00:00Z'),
    eventVenue: 'Hlavní stage',
    eventAddress: 'Náměstí Míru 1, Praha',
  };
}

function makeDeps(overrides?: {
  db?: Partial<PdfTicketDbAdapter>;
  email?: Partial<TicketEmailAdapter>;
}) {
  const db: PdfTicketDbAdapter = {
    findTicketWithDetails: vi.fn(async (id: string) => makeDbRow(id)),
    ...overrides?.db,
  };
  const crypto: CryptoAdapter = {
    decryptTotpSecret: vi.fn(() => 'JBSWY3DPEHPK3PXP'),
    generateTotpCode: vi.fn(() => '12345678'),
  };
  const email: TicketEmailAdapter = {
    send: vi.fn(async () => undefined),
    ...overrides?.email,
  };
  return { db, crypto, email };
}

const baseInput: TicketConfirmationInput = {
  orderId: 'order-1234-5678',
  buyerEmail: 'jan@example.com',
  buyerName: 'Jan Novák',
  eventName: 'Festival Náměstí Míru',
  eventDate: '15. srpna 2026',
  ticketIds: ['aaaaaaaa-1111-2222-3333-444444444444', 'bbbbbbbb-1111-2222-3333-444444444444'],
};

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('handles Czech diacritics', () => {
    expect(slugify('Festival Náměstí Míru')).toBe('festival-namesti-miru');
  });

  it('strips special characters and trims dashes', () => {
    expect(slugify('  Kabát — O2 Arena!!!  ')).toBe('kabat-o2-arena');
  });

  it('truncates to 40 chars', () => {
    const long = 'a'.repeat(60);
    expect(slugify(long).length).toBeLessThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------
// sendTicketConfirmationEmail
// ---------------------------------------------------------------------------

describe('sendTicketConfirmationEmail', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('happy path: 2 tickets → 1 email, 2 attachments, slug in filename', async () => {
    const deps = makeDeps();
    const result = await sendTicketConfirmationEmail(baseInput, deps);

    expect(result).toEqual({ sent: true, attachmentCount: 2 });
    expect(deps.email.send).toHaveBeenCalledTimes(1);

    const sendMock = deps.email.send as ReturnType<typeof vi.fn>;
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe('jan@example.com');
    expect(call.subject).toContain('Festival Náměstí Míru');
    expect(call.attachments).toHaveLength(2);

    for (const att of call.attachments) {
      expect(att.filename).toMatch(/^vstupenka-festival-namesti-miru-[a-f0-9]{8}\.pdf$/);
      expect(att.contentType).toBe('application/pdf');
      expect(Buffer.isBuffer(att.content)).toBe(true);
      // PDF magic bytes
      expect(att.content.slice(0, 4).toString('ascii')).toBe('%PDF');
    }
  }, 20000);

  it('ticket not found → returns { sent: false, attachmentCount: 0 } and logs', async () => {
    const deps = makeDeps({
      db: {
        findTicketWithDetails: vi.fn(async (id: string) =>
          id.startsWith('bbbbbbbb') ? null : makeDbRow(id),
        ),
      },
    });

    const result = await sendTicketConfirmationEmail(baseInput, deps);

    expect(result).toEqual({ sent: false, attachmentCount: 0 });
    expect(console.error).toHaveBeenCalled();
    expect(deps.email.send).not.toHaveBeenCalled();
  }, 20000);

  it('email adapter throws → caught, returns { sent: false }', async () => {
    const deps = makeDeps({
      email: {
        send: vi.fn(async () => {
          throw new Error('SMTP unreachable');
        }),
      },
    });

    const result = await sendTicketConfirmationEmail(baseInput, deps);

    expect(result.sent).toBe(false);
    expect(result.attachmentCount).toBe(0);
    expect(console.error).toHaveBeenCalled();
  }, 20000);

  it('attachment content is valid PDF starting with %PDF magic bytes', async () => {
    const deps = makeDeps();
    await sendTicketConfirmationEmail(
      { ...baseInput, ticketIds: [baseInput.ticketIds[0]] },
      deps,
    );

    const sendMock = deps.email.send as ReturnType<typeof vi.fn>;
    const att = sendMock.mock.calls[0][0].attachments[0];
    const magic = att.content.slice(0, 5).toString('ascii');
    expect(magic).toBe('%PDF-');
  }, 20000);
});
