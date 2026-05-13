import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TicketQRService } from '../services/ticket-qr.service.js';
import type { DBAdapter, RedisAdapter, TicketRecord } from '../services/ticket-qr.service.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeTicket(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    ticketId: 'tkt-001',
    userId: 'user-001',
    eventId: 'event-001',
    holderName: 'Jan Novák',
    seatInfo: 'Sector A, Row 3, Seat 12',
    status: 'valid',
    totpSecretEncrypted: Buffer.from('encrypted-secret'),
    totpSecretIv: Buffer.from('iv-12bytes-here!'),
    ...overrides,
  };
}

function makeDb(ticket: TicketRecord | null = makeTicket()): DBAdapter {
  return {
    getTicket: vi.fn().mockResolvedValue(ticket),
    insertScanLog: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRedis(isNew = true): RedisAdapter {
  return {
    setNX: vi.fn().mockResolvedValue(isNew),
  };
}

// ---------------------------------------------------------------------------
// Mock TOTP + QR payload libs (avoid crypto in unit tests)
// ---------------------------------------------------------------------------

vi.mock('../lib/totp.js', () => ({
  generateTOTP: vi.fn().mockReturnValue('123456'),
  verifyTOTP: vi.fn().mockReturnValue(true),
}));

vi.mock('../lib/qr-payload.js', () => ({
  encodeQRPayload: vi.fn().mockReturnValue('encoded-qr-payload'),
  decodeQRPayload: vi.fn().mockReturnValue({
    ticketId: 'tkt-001',
    totpValue: '123456',
    timestamp: Math.floor(Date.now() / 1000),
    eventId: 'event-001',
    signature: 'valid-sig',
  }),
  verifyQRPayload: vi.fn().mockReturnValue(true),
}));

vi.mock('../services/totp-encryption.service.js', () => ({
  decryptSecret: vi.fn().mockResolvedValue(Buffer.from('decrypted-secret')),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TicketQRService.generateQR', () => {
  it('generates a QR payload for a valid ticket', async () => {
    const db = makeDb();
    const redis = makeRedis();
    const service = new TicketQRService(db, redis);

    const qr = await service.generateQR('tkt-001', 'user-001');

    expect(qr).toBe('encoded-qr-payload');
    expect(db.getTicket).toHaveBeenCalledWith('tkt-001');
  });

  it('throws TICKET_NOT_FOUND if ticket does not exist', async () => {
    const db = makeDb(null);
    const service = new TicketQRService(db, makeRedis());

    await expect(service.generateQR('missing', 'user-001')).rejects.toThrow('TICKET_NOT_FOUND');
  });

  it('throws TICKET_OWNERSHIP_DENIED for wrong user', async () => {
    const db = makeDb(makeTicket({ userId: 'other-user' }));
    const service = new TicketQRService(db, makeRedis());

    await expect(service.generateQR('tkt-001', 'user-001')).rejects.toThrow('TICKET_OWNERSHIP_DENIED');
  });

  it('throws TICKET_REVOKED for revoked ticket', async () => {
    const db = makeDb(makeTicket({ status: 'revoked' }));
    const service = new TicketQRService(db, makeRedis());

    await expect(service.generateQR('tkt-001', 'user-001')).rejects.toThrow('TICKET_REVOKED');
  });
});

describe('TicketQRService.validateQR', () => {
  it('returns success for a valid QR scan', async () => {
    const db = makeDb();
    const redis = makeRedis(true);
    const service = new TicketQRService(db, redis);

    const result = await service.validateQR('encoded-qr-payload', 'event-001', 'device-001');

    expect(result.success).toBe(true);
    expect(result.ticketId).toBe('tkt-001');
    expect(result.holderName).toBe('Jan Novák');
    expect(db.insertScanLog).toHaveBeenCalledWith('tkt-001', 'device-001', expect.any(Date));
  });

  it('returns WRONG_EVENT when event ID mismatches', async () => {
    const { decodeQRPayload } = await import('../lib/qr-payload.js');
    vi.mocked(decodeQRPayload).mockReturnValueOnce({
      ticketId: 'tkt-001',
      totpValue: '123456',
      timestamp: Math.floor(Date.now() / 1000),
      eventId: 'event-OTHER',
      signature: 'valid-sig',
    });

    const db = makeDb();
    const service = new TicketQRService(db, makeRedis());
    const result = await service.validateQR('encoded-qr-payload', 'event-001', 'device-001');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('WRONG_EVENT');
  });

  it('returns EXPIRED for a QR older than 90 seconds', async () => {
    const { decodeQRPayload } = await import('../lib/qr-payload.js');
    vi.mocked(decodeQRPayload).mockReturnValueOnce({
      ticketId: 'tkt-001',
      totpValue: '123456',
      timestamp: Math.floor(Date.now() / 1000) - 100,
      eventId: 'event-001',
      signature: 'valid-sig',
    });

    const db = makeDb();
    const service = new TicketQRService(db, makeRedis());
    const result = await service.validateQR('encoded-qr-payload', 'event-001', 'device-001');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('EXPIRED');
  });

  it('returns REVOKED for a revoked ticket', async () => {
    const db = makeDb(makeTicket({ status: 'revoked' }));
    const service = new TicketQRService(db, makeRedis());

    const result = await service.validateQR('encoded-qr-payload', 'event-001', 'device-001');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('REVOKED');
  });

  it('returns INVALID_TOTP when TOTP verification fails', async () => {
    const { verifyTOTP } = await import('../lib/totp.js');
    vi.mocked(verifyTOTP).mockReturnValueOnce(false);

    const db = makeDb();
    const service = new TicketQRService(db, makeRedis());
    const result = await service.validateQR('encoded-qr-payload', 'event-001', 'device-001');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INVALID_TOTP');
  });

  it('returns ALREADY_SCANNED when Redis SETNX returns false (replay)', async () => {
    const db = makeDb();
    const redis = makeRedis(false);
    const service = new TicketQRService(db, redis);

    const result = await service.validateQR('encoded-qr-payload', 'event-001', 'device-001');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('ALREADY_SCANNED');
    expect(db.insertScanLog).not.toHaveBeenCalled();
  });

  it('does not write scan log on failed validation', async () => {
    const { verifyQRPayload } = await import('../lib/qr-payload.js');
    vi.mocked(verifyQRPayload).mockReturnValueOnce(false);

    const db = makeDb();
    const service = new TicketQRService(db, makeRedis());
    await service.validateQR('encoded-qr-payload', 'event-001', 'device-001');

    expect(db.insertScanLog).not.toHaveBeenCalled();
  });
});

describe('TicketQRService.refreshQR', () => {
  it('refreshes QR for valid ticket owner', async () => {
    const db = makeDb();
    const service = new TicketQRService(db, makeRedis());

    const qr = await service.refreshQR('tkt-001', 'user-001');

    expect(qr).toBe('encoded-qr-payload');
  });
});
