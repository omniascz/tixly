// =============================================================================
// TESTY: PdfTicketService
//
// Strategie:
//   - generateTicketPdf je mockována — service testy jsou čisté jednotkové testy
//   - PdfTicketDbAdapter + CryptoAdapter injektovány jako vi.fn() mocky
//   - Žádná závislost na pdf-lib, qrcode, bwip-js
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PdfTicketService,
  TicketNotFoundError,
  TicketAccessDeniedError,
  type PdfTicketDbAdapter,
  type CryptoAdapter,
} from '../services/pdf-ticket.service.js';
import { PdfGenerationError } from '../types/pdf-ticket.types.js';

// ---------------------------------------------------------------------------
// Mock: pdf-generator — vrací minimální validní PDF (magic bytes %PDF-)
// ---------------------------------------------------------------------------

vi.mock('../lib/pdf-generator.js', () => ({
  generateTicketPdf: vi.fn(async () => ({
    // Minimální falešné PDF — začíná PDF magic bytes
    pdfBytes: new TextEncoder().encode('%PDF-1.4 fake-pdf-content'),
    filename: 'vstupenka-concert-2026-abcd1234.pdf',
    sizeBytes: 24,
  })),
}));

// Import mockované funkce pro verifikaci volání
import { generateTicketPdf } from '../lib/pdf-generator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTicketRow(ticketId: string = 'ticket-abc123', ownerId: string = 'owner-123') {
  return {
    ticketId,
    orderId: 'order-xyz-9999',
    ticketTypeName: 'VIP',
    zone: 'A',
    seatNumber: '12',
    holderName: 'Jan Novák',
    holderEmail: 'jan.novak@example.com',
    ownerId,
    barcodeCode: 'TK-2026-ABCDEF-01',
    totpSecret: 'AES-encrypted-totp-secret',
    issuedAt: new Date('2026-04-01T10:00:00Z'),
    eventName: 'Festival Náměstí Míru',
    eventDate: new Date('2026-08-15T19:00:00Z'),
    eventVenue: 'Hlavní stage',
    eventAddress: 'Náměstí Míru 1, Praha',
  };
}

function makeMocks() {
  const db: PdfTicketDbAdapter = {
    findTicketWithDetails: vi.fn(),
  };
  const crypto: CryptoAdapter = {
    decryptTotpSecret: vi.fn(),
    generateTotpCode: vi.fn(),
  };
  return { db, crypto };
}

// ---------------------------------------------------------------------------
// Testy
// ---------------------------------------------------------------------------

describe('PdfTicketService', () => {
  let service: PdfTicketService;
  let db: PdfTicketDbAdapter;
  let crypto: CryptoAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PdfTicketService();
    ({ db, crypto } = makeMocks());
  });

  // -------------------------------------------------------------------------
  // generateForTicket — happy path: vrací buffer s PDF magic bytes
  // -------------------------------------------------------------------------

  describe('generateForTicket — happy path', () => {
    it('vrátí PdfGenerationResult, pdfBytes začínají %PDF magic bytes', async () => {
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow('ticket-abc123', 'user-111'),
      );
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue(
        'JBSWY3DPEHPK3PXP',
      );
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockReturnValue(
        '12345678',
      );

      const result = await service.generateForTicket(
        'ticket-abc123',
        'user-111',
        'cs',
        db,
        crypto,
      );

      expect(result).toBeDefined();
      expect(result.pdfBytes).toBeInstanceOf(Uint8Array);

      // PDF magic bytes: %PDF
      const header = Buffer.from(result.pdfBytes.slice(0, 4)).toString('ascii');
      expect(header).toBe('%PDF');
    });

    it('vrátí filename a sizeBytes', async () => {
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow('ticket-abc123', 'user-999'),
      );
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue('secret');
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockReturnValue('00000000');

      const result = await service.generateForTicket(
        'ticket-abc123',
        'user-999',
        'en',
        db,
        crypto,
      );

      expect(typeof result.filename).toBe('string');
      expect(result.filename).toMatch(/\.pdf$/);
      expect(typeof result.sizeBytes).toBe('number');
      expect(result.sizeBytes).toBeGreaterThan(0);
    });

    it('předá správný ticketId do db adaptéru', async () => {
      const ticketId = 'ticket-custom-id-42';
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow(ticketId, 'user-x'),
      );
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue('s');
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockReturnValue('11111111');

      await service.generateForTicket(ticketId, 'user-x', 'cs', db, crypto);

      expect(db.findTicketWithDetails).toHaveBeenCalledWith(ticketId);
      expect(db.findTicketWithDetails).toHaveBeenCalledTimes(1);
    });

    it('funguje s jazykem "en"', async () => {
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow('ticket-abc123', 'user-en'),
      );
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue('s');
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockReturnValue('99999999');

      const result = await service.generateForTicket(
        'ticket-abc123',
        'user-en',
        'en',
        db,
        crypto,
      );

      expect(result.pdfBytes.length).toBeGreaterThan(0);
      // Ověření, že generateTicketPdf byl volán s language: 'en'
      expect(generateTicketPdf).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'en' }),
      );
    });

    it('funguje bez zóny a sedadla (volné stání)', async () => {
      const row = { ...makeTicketRow('ticket-abc123', 'user-ga'), zone: null, seatNumber: null };
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue('s');
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockReturnValue('12345678');

      const result = await service.generateForTicket(
        'ticket-abc123',
        'user-ga',
        'cs',
        db,
        crypto,
      );

      expect(result.pdfBytes.length).toBeGreaterThan(0);
      expect(generateTicketPdf).toHaveBeenCalledWith(
        expect.objectContaining({ zone: null, seatNumber: null }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // TicketNotFoundError
  // -------------------------------------------------------------------------

  describe('generateForTicket — ticket not found', () => {
    it('vyhodí TicketNotFoundError když vstupenka neexistuje', async () => {
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        service.generateForTicket('ghost-ticket', 'user-1', 'cs', db, crypto),
      ).rejects.toThrow(TicketNotFoundError);
    });

    it('TicketNotFoundError obsahuje ticketId v message', async () => {
      const ticketId = 'ghost-ticket-xyz';
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        service.generateForTicket(ticketId, 'user-1', 'cs', db, crypto),
      ).rejects.toThrow(`Vstupenka nenalezena: ${ticketId}`);
    });

    it('TicketNotFoundError.ticketId property je nastaven', async () => {
      const ticketId = 'nonexistent-404';
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      let caughtError: unknown;
      try {
        await service.generateForTicket(ticketId, 'user-1', 'cs', db, crypto);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(TicketNotFoundError);
      expect((caughtError as TicketNotFoundError).ticketId).toBe(ticketId);
    });

    it('crypto adaptér není volán pokud vstupenka neexistuje', async () => {
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        service.generateForTicket('no-ticket', 'user-1', 'cs', db, crypto),
      ).rejects.toThrow(TicketNotFoundError);

      expect(crypto.decryptTotpSecret).not.toHaveBeenCalled();
      expect(crypto.generateTotpCode).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // CryptoAdapter — TOTP dešifrování
  // -------------------------------------------------------------------------

  describe('generateForTicket — crypto adapter volání', () => {
    it('volá decryptTotpSecret se šifrovaným tajemstvím z DB', async () => {
      const row = makeTicketRow('ticket-abc123', 'user-1');
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue('decrypted');
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockReturnValue('12345678');

      await service.generateForTicket('ticket-abc123', 'user-1', 'cs', db, crypto);

      expect(crypto.decryptTotpSecret).toHaveBeenCalledWith(row.totpSecret);
      expect(crypto.decryptTotpSecret).toHaveBeenCalledTimes(1);
    });

    it('volá generateTotpCode s hodnotou vrácenou z decryptTotpSecret', async () => {
      const decryptedSecret = 'BASE32SECRETVALUE';
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow('ticket-abc123', 'user-1'),
      );
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue(
        decryptedSecret,
      );
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockReturnValue('87654321');

      await service.generateForTicket('ticket-abc123', 'user-1', 'cs', db, crypto);

      expect(crypto.generateTotpCode).toHaveBeenCalledWith(decryptedSecret);
      expect(crypto.generateTotpCode).toHaveBeenCalledTimes(1);
    });

    it('předá TOTP kód do generateTicketPdf jako totpCode', async () => {
      const totpCode = '55566677';
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow('ticket-abc123', 'user-1'),
      );
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue('s');
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockReturnValue(totpCode);

      await service.generateForTicket('ticket-abc123', 'user-1', 'cs', db, crypto);

      expect(generateTicketPdf).toHaveBeenCalledWith(
        expect.objectContaining({ totpCode }),
      );
    });

    it('chyba v decryptTotpSecret vyhodí PdfGenerationError s kódem QR_GENERATION_FAILED', async () => {
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow('ticket-abc123', 'user-1'),
      );
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Decryption key invalid');
      });

      let caughtError: unknown;
      try {
        await service.generateForTicket('ticket-abc123', 'user-1', 'cs', db, crypto);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(PdfGenerationError);
      expect((caughtError as PdfGenerationError).code).toBe('QR_GENERATION_FAILED');
      expect((caughtError as PdfGenerationError).message).toContain(
        'Nepodařilo se vygenerovat TOTP kód',
      );
    });

    it('chyba v generateTotpCode vyhodí PdfGenerationError', async () => {
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow('ticket-abc123', 'user-1'),
      );
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue('valid-secret');
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('TOTP window overflow');
      });

      await expect(
        service.generateForTicket('ticket-abc123', 'user-1', 'cs', db, crypto),
      ).rejects.toBeInstanceOf(PdfGenerationError);
    });

    it('PdfGenerationError wrapper zachovává původní příčinu chyby (cause)', async () => {
      const originalError = new Error('AES key too short');
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow('ticket-abc123', 'user-1'),
      );
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw originalError;
      });

      let caughtError: unknown;
      try {
        await service.generateForTicket('ticket-abc123', 'user-1', 'cs', db, crypto);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(PdfGenerationError);
      expect((caughtError as PdfGenerationError).cause).toBe(originalError);
    });
  });

  // -------------------------------------------------------------------------
  // Sestavení PdfTicketData — ověření mapování polí
  // -------------------------------------------------------------------------

  describe('generateForTicket — mapování dat do generateTicketPdf', () => {
    it('předá všechna pole z DB řádku do generateTicketPdf', async () => {
      const row = makeTicketRow('ticket-map-test', 'user-1');
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue('s');
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockReturnValue('12345678');

      await service.generateForTicket('ticket-map-test', 'user-1', 'cs', db, crypto);

      expect(generateTicketPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: row.eventName,
          eventDate: row.eventDate,
          eventVenue: row.eventVenue,
          eventAddress: row.eventAddress,
          ticketId: row.ticketId,
          orderId: row.orderId,
          ticketTypeName: row.ticketTypeName,
          zone: row.zone,
          seatNumber: row.seatNumber,
          holderName: row.holderName,
          holderEmail: row.holderEmail,
          barcodeCode: row.barcodeCode,
          issuedAt: row.issuedAt,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Ownership check — TicketAccessDeniedError
  // -------------------------------------------------------------------------

  describe('generateForTicket — ownership check', () => {
    it('vrátí PDF pokud userId odpovídá ownerId vstupenky', async () => {
      const ownerId = 'owner-match-123';
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow('ticket-abc123', ownerId),
      );
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue('secret');
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockReturnValue('12345678');

      const result = await service.generateForTicket(
        'ticket-abc123',
        ownerId,
        'cs',
        db,
        crypto,
      );

      expect(result.pdfBytes.length).toBeGreaterThan(0);
    });

    it('vyhodí TicketAccessDeniedError pokud userId neodpovídá ownerId', async () => {
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow('ticket-abc123', 'owner-123'),
      );
      (crypto.decryptTotpSecret as ReturnType<typeof vi.fn>).mockReturnValue('secret');
      (crypto.generateTotpCode as ReturnType<typeof vi.fn>).mockReturnValue('12345678');

      await expect(
        service.generateForTicket('ticket-abc123', 'different-user-999', 'cs', db, crypto),
      ).rejects.toThrow(TicketAccessDeniedError);
    });

    it('TicketAccessDeniedError obsahuje správné ticketId a userId', async () => {
      const ticketId = 'ticket-access-denied-test';
      const correctOwner = 'owner-abc';
      const wrongUser = 'hacker-xyz';

      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow(ticketId, correctOwner),
      );

      let caughtError: unknown;
      try {
        await service.generateForTicket(ticketId, wrongUser, 'cs', db, crypto);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(TicketAccessDeniedError);
      const error = caughtError as TicketAccessDeniedError;
      expect(error.ticketId).toBe(ticketId);
      expect(error.userId).toBe(wrongUser);
    });

    it('crypto adaptér není volán pokud ownership check selže', async () => {
      (db.findTicketWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTicketRow('ticket-abc123', 'owner-abc'),
      );

      await expect(
        service.generateForTicket('ticket-abc123', 'unauthorized-user', 'cs', db, crypto),
      ).rejects.toThrow(TicketAccessDeniedError);

      expect(crypto.decryptTotpSecret).not.toHaveBeenCalled();
      expect(crypto.generateTotpCode).not.toHaveBeenCalled();
    });
  });
});
