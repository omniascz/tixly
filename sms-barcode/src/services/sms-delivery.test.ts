import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmsService } from './sms.service.js';
import {
  SmsStatus,
  type DbAdapter,
  type BarcodeTicket,
  type SmsDelivery,
  type TwilioConfig,
  type InsertSmsLog,
} from '../types/barcode.types.js';

// ---------------------------------------------------------------------------
// Pomocné fixtures
// ---------------------------------------------------------------------------

const config: TwilioConfig = {
  accountSid: 'ACtest1234567890',
  authToken: 'testtoken',
  phoneNumber: '+15555550000',
  webhookBaseUrl: 'https://tkr.cz',
};

const baseTicket: BarcodeTicket = {
  id: 'ticket-uuid-1',
  ticketTypeId: 'tt-uuid-1',
  ownerId: 'owner-uuid-1',
  holderName: 'Jan Novák',
  barcodeCode: 'TK-2026-847291-X3',
  shortCode: 'aB3xK9qR',
  barcodeScannedAt: null,
  barcodeScannedBy: null,
  status: 'valid',
  eventId: 'event-uuid-1',
  eventName: 'Kabát Praha',
  eventDateStart: new Date('2026-04-15T19:30:00Z'),
  eventDateEnd: null,
  venueId: 'venue-uuid-1',
  venueName: 'O2 Arena',
  venueAddress: 'Praha 9',
  zone: null,
  seatInfo: null,
};

function createMockDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    getTicketWithEventByBarcode: vi.fn(),
    getTicketByShortCode: vi.fn(),
    getTicketById: vi.fn().mockResolvedValue(baseTicket),
    assignBarcodeCodes: vi.fn(),
    markBarcodeScanned: vi.fn(),
    barcodeCodeExists: vi.fn(),
    shortCodeExists: vi.fn(),
    getTicketsForSmsReminder: vi.fn(),
    insertSmsLog: vi.fn().mockResolvedValue(42),
    updateSmsLogStatus: vi.fn(),
    findSmsLogByTicketAndType: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function mockTwilioFetchSuccess(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ sid: 'SMtest123', status: 'queued' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
}

function mockTwilioFetchFailure(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ error_code: '21211', error_message: 'Invalid To phone' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ),
  );
}

// ---------------------------------------------------------------------------
// Testy
// ---------------------------------------------------------------------------

describe('SmsService.sendTicketDelivery', () => {
  let service: SmsService;

  beforeEach(() => {
    service = new SmsService(config);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path — odešle SMS přes Twilio a zaloguje s typem delivery', async () => {
    const db = createMockDb();
    const fetchSpy = mockTwilioFetchSuccess();

    const result = await service.sendTicketDelivery(
      'ticket-uuid-1',
      '+420601234567',
      db,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(SmsStatus.Sent);
    expect(result.messageSid).toBe('SMtest123');
    expect(result.smsLogId).toBe(42);
    expect(result.sentAt).toBeInstanceOf(Date);

    expect(db.insertSmsLog).toHaveBeenCalledTimes(1);
    const insertArg = (db.insertSmsLog as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as InsertSmsLog;
    expect(insertArg.type).toBe('delivery');
    expect(insertArg.status).toBe(SmsStatus.Sent);
    expect(insertArg.messageSid).toBe('SMtest123');
  });

  it('idempotence — již existuje sent záznam, neodesílá znovu', async () => {
    const existing: SmsDelivery = {
      smsLogId: 99,
      ticketId: 'ticket-uuid-1',
      phone: '+420601234567',
      messageSid: 'SMprev',
      status: SmsStatus.Sent,
      sentAt: new Date('2026-04-08T10:00:00Z'),
      errorMessage: null,
    };
    const db = createMockDb({
      findSmsLogByTicketAndType: vi.fn().mockResolvedValue(existing),
    });
    const fetchSpy = mockTwilioFetchSuccess();

    const result = await service.sendTicketDelivery(
      'ticket-uuid-1',
      '+420601234567',
      db,
    );

    expect(result).toEqual(existing);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.insertSmsLog).not.toHaveBeenCalled();
  });

  it('idempotence — existuje delivered záznam, vrací ho beze změny', async () => {
    const existing: SmsDelivery = {
      smsLogId: 100,
      ticketId: 'ticket-uuid-1',
      phone: '+420601234567',
      messageSid: 'SMdone',
      status: SmsStatus.Delivered,
      sentAt: new Date(),
      errorMessage: null,
    };
    const db = createMockDb({
      findSmsLogByTicketAndType: vi.fn().mockResolvedValue(existing),
    });
    const fetchSpy = mockTwilioFetchSuccess();

    const result = await service.sendTicketDelivery(
      'ticket-uuid-1',
      '+420601234567',
      db,
    );

    expect(result.status).toBe(SmsStatus.Delivered);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('failed záznam neblokuje retry — pokusí se znovu odeslat', async () => {
    const failed: SmsDelivery = {
      smsLogId: 7,
      ticketId: 'ticket-uuid-1',
      phone: '+420601234567',
      messageSid: null,
      status: SmsStatus.Failed,
      sentAt: null,
      errorMessage: 'Twilio timeout',
    };
    const db = createMockDb({
      findSmsLogByTicketAndType: vi.fn().mockResolvedValue(failed),
    });
    mockTwilioFetchSuccess();

    const result = await service.sendTicketDelivery(
      'ticket-uuid-1',
      '+420601234567',
      db,
    );

    expect(result.status).toBe(SmsStatus.Sent);
    expect(db.insertSmsLog).toHaveBeenCalledTimes(1);
  });

  it('vstupenka bez barcodeCode → throw', async () => {
    const db = createMockDb({
      getTicketById: vi
        .fn()
        .mockResolvedValue({ ...baseTicket, barcodeCode: null }),
    });

    await expect(
      service.sendTicketDelivery('ticket-uuid-1', '+420601234567', db),
    ).rejects.toThrow(/barcode_code/);
  });

  it('vstupenka neexistuje → throw', async () => {
    const db = createMockDb({
      getTicketById: vi.fn().mockResolvedValue(null),
    });

    await expect(
      service.sendTicketDelivery('missing', '+420601234567', db),
    ).rejects.toThrow(/nenalezena/);
  });

  it('Twilio API selže → log se status=failed, metoda nehází', async () => {
    const db = createMockDb();
    mockTwilioFetchFailure();

    const result = await service.sendTicketDelivery(
      'ticket-uuid-1',
      '+420601234567',
      db,
    );

    expect(result.status).toBe(SmsStatus.Failed);
    expect(result.messageSid).toBeNull();
    expect(result.sentAt).toBeNull();
    expect(result.errorMessage).toMatch(/Twilio API error/);

    expect(db.insertSmsLog).toHaveBeenCalledTimes(1);
    const insertArg = (db.insertSmsLog as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as InsertSmsLog;
    expect(insertArg.status).toBe(SmsStatus.Failed);
    expect(insertArg.type).toBe('delivery');
  });
});
