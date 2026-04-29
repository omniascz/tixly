import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WalletService,
  type WalletDBAdapter,
  type TicketForWallet,
  type EventForWallet,
} from '../services/wallet.service.js';
import { AppleWalletService } from '../services/apple-wallet.service.js';
import { GoogleWalletService } from '../services/google-wallet.service.js';

describe('WalletService', () => {
  let service: WalletService;
  let mockDb: WalletDBAdapter;
  let mockAppleService: AppleWalletService;
  let mockGoogleService: GoogleWalletService;

  beforeEach(() => {
    mockDb = {
      getTicket: vi.fn(),
      getEvent: vi.fn(),
      getPass: vi.fn(),
      upsertPass: vi.fn(),
      updatePassTimestamp: vi.fn(),
      generateDownloadUrl: vi.fn(),
      getCurrentQRPayload: vi.fn(),
    };

    mockAppleService = {
      generatePass: vi.fn(),
      sendPushUpdate: vi.fn(),
    } as any;

    mockGoogleService = {
      generatePassJWT: vi.fn(),
      generateAddToWalletUrl: vi.fn(),
      updatePassBarcode: vi.fn(),
    } as any;

    service = new WalletService(mockDb, mockAppleService, mockGoogleService);
  });

  describe('issueWalletPass', () => {
    it('should issue Apple Wallet pass successfully', async () => {
      const ticketId = 'ticket-apple-001';
      const userId = 'user-001';
      const eventId = 'event-001';

      const mockTicket: TicketForWallet = {
        ticketId,
        eventId,
        userId,
        holderName: 'John Doe',
        seatInfo: 'Row A, Seat 1',
        ticketType: 'Standard',
        totpSecretEncrypted: Buffer.from('encrypted'),
        totpSecretIv: Buffer.from('iv'),
      };

      const mockEvent: EventForWallet = {
        eventId,
        title: 'Concert 2026',
        venueName: 'O2 Arena',
        eventDate: '2026-06-15',
        eventTime: '19:30',
      };

      (mockDb.getTicket as any).mockResolvedValue(mockTicket);
      (mockDb.getEvent as any).mockResolvedValue(mockEvent);
      (mockDb.getCurrentQRPayload as any).mockResolvedValue('TOTP_QR_12345678');
      (mockAppleService.generatePass as any).mockResolvedValue(undefined);
      (mockDb.generateDownloadUrl as any).mockResolvedValue(
        'https://api.tixly.cz/download/pass123',
      );
      (mockDb.upsertPass as any).mockResolvedValue({
        id: 'pass-apple-001',
        ticketId,
        platform: 'apple',
        serialNumber: `ticket-${ticketId}`,
      });

      const result = await service.issueWalletPass(ticketId, 'apple', userId);

      expect(result.platform).toBe('apple');
      expect(result.downloadUrl).toBeDefined();
      expect(mockDb.getTicket).toHaveBeenCalledWith(ticketId);
      expect(mockDb.getEvent).toHaveBeenCalledWith(eventId);
      expect(mockAppleService.generatePass).toHaveBeenCalled();
      expect(mockDb.upsertPass).toHaveBeenCalled();
    });

    it('should issue Google Wallet pass successfully', async () => {
      const ticketId = 'ticket-google-001';
      const userId = 'user-002';
      const eventId = 'event-002';

      const mockTicket: TicketForWallet = {
        ticketId,
        eventId,
        userId,
        holderName: 'Jane Smith',
        seatInfo: 'Row B, Seat 5',
        seatNumber: '5',
        row: 'B',
        section: 'Main',
        ticketType: 'VIP',
        totpSecretEncrypted: Buffer.from('encrypted'),
        totpSecretIv: Buffer.from('iv'),
      };

      const mockEvent: EventForWallet = {
        eventId,
        title: 'Festival 2026',
        venueName: 'Letňany',
        eventDate: '2026-07-20',
        eventTime: '14:00',
      };

      process.env.GOOGLE_WALLET_ISSUER_ID = 'issuer-123';

      (mockDb.getTicket as any).mockResolvedValue(mockTicket);
      (mockDb.getEvent as any).mockResolvedValue(mockEvent);
      (mockDb.getCurrentQRPayload as any).mockResolvedValue('TOTP_QR_87654321');
      (mockGoogleService.generatePassJWT as any).mockResolvedValue(
        'jwt.token.signature',
      );
      (mockGoogleService.generateAddToWalletUrl as any).mockReturnValue(
        'https://pay.google.com/gp/v/save/jwt.token.signature',
      );
      (mockDb.upsertPass as any).mockResolvedValue({
        id: 'pass-google-001',
        ticketId,
        platform: 'google',
      });

      const result = await service.issueWalletPass(ticketId, 'google', userId);

      expect(result.platform).toBe('google');
      expect(result.jwt).toBe('jwt.token.signature');
      expect(result.addToWalletUrl).toBeDefined();
      expect(mockDb.getTicket).toHaveBeenCalledWith(ticketId);
      expect(mockGoogleService.generatePassJWT).toHaveBeenCalled();
      expect(mockDb.upsertPass).toHaveBeenCalled();
    });

    it('should throw error when ticket not found', async () => {
      const ticketId = 'nonexistent-ticket';
      const userId = 'user-003';

      (mockDb.getTicket as any).mockResolvedValue(null);

      await expect(
        service.issueWalletPass(ticketId, 'apple', userId),
      ).rejects.toThrow('ticket not found');
    });

    it('should throw error when user does not own ticket', async () => {
      const ticketId = 'ticket-other-user';
      const userId = 'user-wrong';
      const ticketOwnerId = 'user-correct';

      const mockTicket: TicketForWallet = {
        ticketId,
        eventId: 'event-123',
        userId: ticketOwnerId,
        holderName: 'Owner',
        seatInfo: 'Seat 1',
        ticketType: 'Standard',
        totpSecretEncrypted: Buffer.from('encrypted'),
        totpSecretIv: Buffer.from('iv'),
      };

      (mockDb.getTicket as any).mockResolvedValue(mockTicket);

      await expect(
        service.issueWalletPass(ticketId, 'apple', userId),
      ).rejects.toThrow('does not own ticket');
    });

    it('should throw error when event not found', async () => {
      const ticketId = 'ticket-004';
      const userId = 'user-004';
      const eventId = 'nonexistent-event';

      const mockTicket: TicketForWallet = {
        ticketId,
        eventId,
        userId,
        holderName: 'Test User',
        seatInfo: 'Seat 10',
        ticketType: 'Standard',
        totpSecretEncrypted: Buffer.from('encrypted'),
        totpSecretIv: Buffer.from('iv'),
      };

      (mockDb.getTicket as any).mockResolvedValue(mockTicket);
      (mockDb.getEvent as any).mockResolvedValue(null);

      await expect(
        service.issueWalletPass(ticketId, 'apple', userId),
      ).rejects.toThrow('event not found');
    });

    it('should regenerate pass on re-issuance (idempotent)', async () => {
      const ticketId = 'ticket-reissue';
      const userId = 'user-005';
      const eventId = 'event-reissue';

      const mockTicket: TicketForWallet = {
        ticketId,
        eventId,
        userId,
        holderName: 'Reissue User',
        seatInfo: 'Seat 20',
        ticketType: 'Standard',
        totpSecretEncrypted: Buffer.from('encrypted'),
        totpSecretIv: Buffer.from('iv'),
      };

      const mockEvent: EventForWallet = {
        eventId,
        title: 'Reissue Event',
        venueName: 'Test Venue',
        eventDate: '2026-08-01',
        eventTime: '18:00',
      };

      (mockDb.getTicket as any).mockResolvedValue(mockTicket);
      (mockDb.getEvent as any).mockResolvedValue(mockEvent);
      (mockDb.getCurrentQRPayload as any).mockResolvedValue('NEW_QR_CODE');
      (mockAppleService.generatePass as any).mockResolvedValue(undefined);
      (mockDb.generateDownloadUrl as any).mockResolvedValue('https://example.com/pass');
      (mockDb.upsertPass as any).mockResolvedValue({
        id: 'pass-reissue',
        ticketId,
      });

      const result = await service.issueWalletPass(ticketId, 'apple', userId);

      expect(result.platform).toBe('apple');
      expect(mockAppleService.generatePass).toHaveBeenCalled();
      expect(mockDb.upsertPass).toHaveBeenCalled();
    });
  });

  describe('pushTotpRotationUpdate', () => {
    it('should push TOTP rotation update to both platforms', async () => {
      const ticketId = 'ticket-rotation-001';

      const mockTicket: TicketForWallet = {
        ticketId,
        eventId: 'event-001',
        userId: 'user-001',
        holderName: 'Test',
        seatInfo: 'Seat 1',
        ticketType: 'Standard',
        totpSecretEncrypted: Buffer.from('encrypted'),
        totpSecretIv: Buffer.from('iv'),
      };

      const mockApplePass = { id: 'apple-pass', ticketId };
      const mockGooglePass = { id: 'google-pass', ticketId };

      (mockDb.getTicket as any).mockResolvedValue(mockTicket);
      (mockDb.getPass as any).mockImplementation(async (id, platform) => {
        if (platform === 'apple') return mockApplePass;
        if (platform === 'google') return mockGooglePass;
        return null;
      });
      (mockDb.getCurrentQRPayload as any).mockResolvedValue('NEW_QR_PAYLOAD');
      (mockAppleService.sendPushUpdate as any).mockResolvedValue(undefined);
      (mockGoogleService.updatePassBarcode as any).mockResolvedValue(undefined);
      (mockDb.updatePassTimestamp as any).mockResolvedValue(undefined);

      const result = await service.pushTotpRotationUpdate(ticketId);

      expect(result.apple.attempted).toBe(true);
      expect(result.apple.ok).toBe(true);
      expect(result.google.attempted).toBe(true);
      expect(result.google.ok).toBe(true);
      expect(mockAppleService.sendPushUpdate).toHaveBeenCalledWith(ticketId);
      expect(mockGoogleService.updatePassBarcode).toHaveBeenCalledWith(
        ticketId,
        'NEW_QR_PAYLOAD',
      );
    });

    it('should return ticket_not_found when ticket does not exist', async () => {
      const ticketId = 'nonexistent-rotation';

      (mockDb.getTicket as any).mockResolvedValue(null);

      const result = await service.pushTotpRotationUpdate(ticketId);

      expect(result.apple.attempted).toBe(false);
      expect(result.apple.reason).toBe('ticket_not_found');
      expect(result.google.attempted).toBe(false);
      expect(result.google.reason).toBe('ticket_not_found');
    });

    it('should handle Apple-only pass update', async () => {
      const ticketId = 'ticket-apple-only';

      const mockTicket: TicketForWallet = {
        ticketId,
        eventId: 'event-123',
        userId: 'user-123',
        holderName: 'Apple User',
        seatInfo: 'Seat 5',
        ticketType: 'Standard',
        totpSecretEncrypted: Buffer.from('encrypted'),
        totpSecretIv: Buffer.from('iv'),
      };

      (mockDb.getTicket as any).mockResolvedValue(mockTicket);
      (mockDb.getPass as any).mockImplementation(async (id, platform) => {
        if (platform === 'apple') return { id: 'apple-pass', ticketId };
        return null;
      });
      (mockAppleService.sendPushUpdate as any).mockResolvedValue(undefined);
      (mockDb.updatePassTimestamp as any).mockResolvedValue(undefined);

      const result = await service.pushTotpRotationUpdate(ticketId);

      expect(result.apple.attempted).toBe(true);
      expect(result.apple.ok).toBe(true);
      expect(result.google.attempted).toBe(false);
      expect(result.google.reason).toBe('no_google_pass');
    });

    it('should handle Google-only pass update', async () => {
      const ticketId = 'ticket-google-only';

      const mockTicket: TicketForWallet = {
        ticketId,
        eventId: 'event-456',
        userId: 'user-456',
        holderName: 'Google User',
        seatInfo: 'Seat 10',
        ticketType: 'Standard',
        totpSecretEncrypted: Buffer.from('encrypted'),
        totpSecretIv: Buffer.from('iv'),
      };

      (mockDb.getTicket as any).mockResolvedValue(mockTicket);
      (mockDb.getPass as any).mockImplementation(async (id, platform) => {
        if (platform === 'google') return { id: 'google-pass', ticketId };
        return null;
      });
      (mockDb.getCurrentQRPayload as any).mockResolvedValue('GOOGLE_QR_CODE');
      (mockGoogleService.updatePassBarcode as any).mockResolvedValue(undefined);
      (mockDb.updatePassTimestamp as any).mockResolvedValue(undefined);

      const result = await service.pushTotpRotationUpdate(ticketId);

      expect(result.apple.attempted).toBe(false);
      expect(result.apple.reason).toBe('no_apple_pass');
      expect(result.google.attempted).toBe(true);
      expect(result.google.ok).toBe(true);
    });
  });
});
