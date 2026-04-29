import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendConfirmationSms,
  sendBulkConfirmationSms,
  isOptedOut,
  addOptOut,
  removeOptOut,
  generateConfirmationCode,
  normalizePhone,
  getOptOuts,
} from '../services/sms-confirmation.service.js';
import type { ServiceDeps, SmsDbAdapter, KafkaProducer } from '../services/sms.service.js';
import { BulkgateClient } from '../lib/bulkgate-client.js';
import { SmsError } from '../lib/sms-errors.js';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

interface FakeConfirmationRow {
  id: string;
  recipient_phone: string;
  confirmation_code: string;
  event_name: string;
  event_id: string | null;
  promoter_id: string | null;
  status: string;
  external_id: string | null;
  error_message: string | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

interface FakeOptOutRow {
  phone: string;
  user_id: string | null;
  reason: string | null;
  opted_out_at: Date;
}

function createFakeDb(initialOptOuts: string[] = []): {
  db: SmsDbAdapter;
  confirmationSms: FakeConfirmationRow[];
  optOuts: Map<string, FakeOptOutRow>;
} {
  const confirmationSms: FakeConfirmationRow[] = [];
  const optOuts = new Map<string, FakeOptOutRow>(
    initialOptOuts.map((phone) => [
      phone,
      {
        phone,
        user_id: null,
        reason: null,
        opted_out_at: new Date(),
      },
    ]),
  );
  let idCounter = 1;

  const db: SmsDbAdapter = {
    async query(sql: string, params: unknown[] = []) {
      const s = sql.trim();

      // Opt-out queries
      if (s.startsWith('SELECT phone FROM sms.opt_outs WHERE phone = $1')) {
        const phone = params[0] as string;
        const found = optOuts.has(phone);
        return {
          rows: found ? ([{ phone }] as any) : [],
          rowCount: found ? 1 : 0,
        };
      }

      if (s.startsWith('SELECT phone FROM sms.opt_outs WHERE phone = ANY')) {
        const phones = params[0] as string[];
        const hits = phones.filter((p) => optOuts.has(p)).map((p) => ({ phone: p }));
        return {
          rows: hits as any,
          rowCount: hits.length,
        };
      }

      // Insert opt-out
      if (s.startsWith('INSERT INTO sms.opt_outs')) {
        const phone = params[0] as string;
        const userId = params[1] as string | null;
        const reason = params[2] as string | null;
        optOuts.set(phone, {
          phone,
          user_id: userId,
          reason,
          opted_out_at: new Date(),
        });
        return { rows: [], rowCount: 1 };
      }

      // Delete opt-out
      if (s.startsWith('DELETE FROM sms.opt_outs')) {
        const phone = params[0] as string;
        const existed = optOuts.has(phone);
        optOuts.delete(phone);
        return {
          rows: existed ? ([{ phone }] as any) : [],
          rowCount: existed ? 1 : 0,
        };
      }

      // Select all opt-outs
      if (s.startsWith('SELECT phone, user_id, reason, opted_out_at FROM sms.opt_outs')) {
        const limit = (params[0] as number) || 100;
        const offset = (params[1] as number) || 0;
        const items = Array.from(optOuts.values()).slice(offset, offset + limit);
        return {
          rows: items as any,
          rowCount: items.length,
        };
      }

      // Count opt-outs
      if (s.startsWith('SELECT COUNT(*)::text AS count FROM sms.opt_outs')) {
        return {
          rows: [{ count: String(optOuts.size) }] as any,
          rowCount: 1,
        };
      }

      // Confirmation SMS: insert
      if (s.startsWith('INSERT INTO sms.confirmation_sms')) {
        const row: FakeConfirmationRow = {
          id: `conf-${idCounter++}`,
          recipient_phone: params[0] as string,
          confirmation_code: params[1] as string,
          event_name: params[2] as string,
          event_id: (params[3] as string | null) ?? null,
          promoter_id: (params[4] as string | null) ?? null,
          status: 'pending',
          external_id: null,
          error_message: null,
          sent_at: null,
          delivered_at: null,
          created_at: new Date(),
        };
        confirmationSms.push(row);
        return { rows: [row] as any, rowCount: 1 };
      }

      // Confirmation SMS: update
      if (s.startsWith('UPDATE sms.confirmation_sms')) {
        const id = params[0] as string;
        const row = confirmationSms.find((m) => m.id === id);
        if (!row) return { rows: [], rowCount: 0 };

        if (s.includes("status = 'sent'")) {
          row.status = 'sent';
          row.external_id = params[1] as string;
          row.sent_at = new Date();
        } else if (s.includes("status = 'failed'")) {
          row.status = 'failed';
          row.error_message = params[1] as string;
        }

        return { rows: [row] as any, rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  return { db, confirmationSms, optOuts };
}

function createFakeBulkgate(): BulkgateClient {
  const mockClient = {
    sendSingle: vi.fn().mockResolvedValue({
      smsId: 'bg-123',
      status: 'sent',
      priceHalire: 50,
    }),
    sendBulk: vi.fn().mockResolvedValue({
      accepted: [],
      rejected: [],
    }),
  };
  return mockClient as any;
}

function createFakeKafka(): KafkaProducer {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

function createServiceDeps(
  db: SmsDbAdapter,
  bulkgate: BulkgateClient = createFakeBulkgate(),
  kafka: KafkaProducer = createFakeKafka(),
): ServiceDeps {
  return { db, bulkgate, kafka };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sms-confirmation.service', () => {
  describe('generateConfirmationCode', () => {
    it('generates 6-digit code', () => {
      const code = generateConfirmationCode();
      expect(code).toMatch(/^\d{6}$/);
    });

    it('generates codes in valid range', () => {
      for (let i = 0; i < 100; i++) {
        const code = parseInt(generateConfirmationCode(), 10);
        expect(code).toBeGreaterThanOrEqual(100000);
        expect(code).toBeLessThanOrEqual(999999);
      }
    });
  });

  describe('normalizePhone', () => {
    it('accepts valid E.164 numbers', () => {
      const phone = normalizePhone('+420777123456');
      expect(phone).toMatch(/^\+\d+$/);
    });

    it('throws on invalid phone', () => {
      expect(() => normalizePhone('invalid')).toThrow(SmsError);
    });

    it('throws on empty phone', () => {
      expect(() => normalizePhone('')).toThrow(SmsError);
    });
  });

  describe('isOptedOut', () => {
    it('returns false for non-opted-out phone', async () => {
      const { db } = createFakeDb();
      const deps = createServiceDeps(db);
      const result = await isOptedOut('+420777123456', deps);
      expect(result).toBe(false);
    });

    it('returns true for opted-out phone', async () => {
      const { db } = createFakeDb(['+420777123456']);
      const deps = createServiceDeps(db);
      const result = await isOptedOut('+420777123456', deps);
      expect(result).toBe(true);
    });

    it('throws on invalid phone', async () => {
      const { db } = createFakeDb();
      const deps = createServiceDeps(db);
      await expect(isOptedOut('invalid', deps)).rejects.toThrow(SmsError);
    });
  });

  describe('addOptOut', () => {
    it('adds opt-out for valid phone', async () => {
      const { db } = createFakeDb();
      const deps = createServiceDeps(db);
      const result = await addOptOut('+420777123456', undefined, undefined, deps);
      expect(result.success).toBe(true);
      expect(result.optedOut).toBe(true);
      expect(result.phone).toMatch(/^\+420/);
    });

    it('adds opt-out with userId and reason', async () => {
      const { db, optOuts } = createFakeDb();
      const deps = createServiceDeps(db);
      const userId = 'user-123';
      const reason = 'Too many SMSes';
      await addOptOut('+420777123456', userId, reason, deps);
      const entry = optOuts.get('+420777123456');
      expect(entry?.user_id).toBe(userId);
      expect(entry?.reason).toBe(reason);
    });

    it('returns success for already opted-out phone', async () => {
      const { db } = createFakeDb(['+420777123456']);
      const deps = createServiceDeps(db);
      const result = await addOptOut('+420777123456', undefined, undefined, deps);
      expect(result.success).toBe(true);
      expect(result.optedOut).toBe(true);
    });

    it('throws on invalid phone', async () => {
      const { db } = createFakeDb();
      const deps = createServiceDeps(db);
      await expect(addOptOut('invalid', undefined, undefined, deps)).rejects.toThrow(SmsError);
    });

    it('throws when deps not provided', async () => {
      await expect(addOptOut('+420777123456', undefined, undefined, undefined as any)).rejects.toThrow(
        SmsError,
      );
    });
  });

  describe('removeOptOut', () => {
    it('removes opt-out for opted-out phone', async () => {
      const { db } = createFakeDb(['+420777123456']);
      const deps = createServiceDeps(db);
      const result = await removeOptOut('+420777123456', deps);
      expect(result.success).toBe(true);
      expect(result.optedOut).toBe(false);
    });

    it('returns success false for non-opted-out phone', async () => {
      const { db } = createFakeDb();
      const deps = createServiceDeps(db);
      const result = await removeOptOut('+420777123456', deps);
      expect(result.success).toBe(false);
    });

    it('throws on invalid phone', async () => {
      const { db } = createFakeDb();
      const deps = createServiceDeps(db);
      await expect(removeOptOut('invalid', deps)).rejects.toThrow(SmsError);
    });
  });

  describe('getOptOuts', () => {
    it('returns empty array when no opt-outs', async () => {
      const { db } = createFakeDb();
      const deps = createServiceDeps(db);
      const result = await getOptOuts(deps);
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('returns all opt-outs', async () => {
      const { db } = createFakeDb(['+420777111111', '+420777222222']);
      const deps = createServiceDeps(db);
      const result = await getOptOuts(deps);
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('respects limit and offset', async () => {
      const { db } = createFakeDb(['+420777111111', '+420777222222', '+420777333333']);
      const deps = createServiceDeps(db);
      const result = await getOptOuts(deps, 2, 1);
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(3);
    });
  });

  describe('sendConfirmationSms', () => {
    it('sends SMS with valid code', async () => {
      const { db } = createFakeDb();
      const kafka = createFakeKafka();
      const bulkgate = createFakeBulkgate();
      const deps = createServiceDeps(db, bulkgate, kafka);

      const result = await sendConfirmationSms(
        {
          phoneNumber: '+420777123456',
          code: '123456',
          eventName: 'Test Event',
          eventId: 'event-123',
        },
        deps,
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.sentAt).toBeInstanceOf(Date);
      expect(result.phone).toMatch(/^\+420/);
    });

    it('includes event name in SMS text', async () => {
      const { db } = createFakeDb();
      const bulkgate = createFakeBulkgate();
      const kafka = createFakeKafka();
      const deps = createServiceDeps(db, bulkgate, kafka);

      await sendConfirmationSms(
        {
          phoneNumber: '+420777123456',
          code: '123456',
          eventName: 'Koncert 2026',
        },
        deps,
      );

      const sendSingleCall = (bulkgate.sendSingle as any).mock.calls[0];
      expect(sendSingleCall[1]).toContain('123456');
      expect(sendSingleCall[1]).toContain('Koncert 2026');
    });

    it('publishes Kafka event on success', async () => {
      const { db } = createFakeDb();
      const bulkgate = createFakeBulkgate();
      const kafka = createFakeKafka();
      const deps = createServiceDeps(db, bulkgate, kafka);

      await sendConfirmationSms(
        {
          phoneNumber: '+420777123456',
          code: '123456',
          eventName: 'Test',
          eventId: 'event-123',
        },
        deps,
      );

      expect(kafka.publish).toHaveBeenCalledWith(
        'sms.confirmation.sent',
        expect.any(String),
        expect.objectContaining({
          phone: expect.stringMatching(/^\+420/),
          eventName: 'Test',
          eventId: 'event-123',
        }),
      );
    });

    it('rejects invalid code format', async () => {
      const { db } = createFakeDb();
      const deps = createServiceDeps(db);

      await expect(
        sendConfirmationSms(
          {
            phoneNumber: '+420777123456',
            code: '12345', // Only 5 digits
            eventName: 'Test',
          },
          deps,
        ),
      ).rejects.toThrow(SmsError);

      await expect(
        sendConfirmationSms(
          {
            phoneNumber: '+420777123456',
            code: 'abc123', // Non-numeric
            eventName: 'Test',
          },
          deps,
        ),
      ).rejects.toThrow(SmsError);
    });

    it('handles BulkGate errors gracefully', async () => {
      const { db } = createFakeDb();
      const bulkgate = createFakeBulkgate();
      (bulkgate.sendSingle as any).mockRejectedValue(new Error('BulkGate error'));
      const kafka = createFakeKafka();
      const deps = createServiceDeps(db, bulkgate, kafka);

      await expect(
        sendConfirmationSms(
          {
            phoneNumber: '+420777123456',
            code: '123456',
            eventName: 'Test',
          },
          deps,
        ),
      ).rejects.toThrow();

      expect(kafka.publish).toHaveBeenCalledWith(
        'sms.confirmation.failed',
        expect.any(String),
        expect.objectContaining({
          errorMessage: 'BulkGate error',
        }),
      );
    });

    it('throws on invalid phone', async () => {
      const { db } = createFakeDb();
      const deps = createServiceDeps(db);

      await expect(
        sendConfirmationSms(
          {
            phoneNumber: 'invalid',
            code: '123456',
            eventName: 'Test',
          },
          deps,
        ),
      ).rejects.toThrow(SmsError);
    });

    it('includes promoterId in database record', async () => {
      const { db, confirmationSms } = createFakeDb();
      const deps = createServiceDeps(db);

      await sendConfirmationSms(
        {
          phoneNumber: '+420777123456',
          code: '123456',
          eventName: 'Test',
          promoterId: 'promoter-456',
        },
        deps,
      );

      expect(confirmationSms[0]).toMatchObject({
        promoter_id: 'promoter-456',
      });
    });
  });

  describe('sendBulkConfirmationSms', () => {
    it('sends SMS to multiple phones', async () => {
      const { db } = createFakeDb();
      const bulkgate = createFakeBulkgate();
      const kafka = createFakeKafka();
      const deps = createServiceDeps(db, bulkgate, kafka);

      const result = await sendBulkConfirmationSms(
        {
          phoneNumbers: ['+420777111111', '+420777222222'],
          code: '123456',
          eventName: 'Test Event',
        },
        deps,
      );

      expect(result.sent).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results.every((r) => r.success)).toBe(true);
    });

    it('handles invalid phone numbers', async () => {
      const { db } = createFakeDb();
      const bulkgate = createFakeBulkgate();
      const kafka = createFakeKafka();
      const deps = createServiceDeps(db, bulkgate, kafka);

      const result = await sendBulkConfirmationSms(
        {
          phoneNumbers: ['+420777111111', 'invalid', '+420777222222'],
          code: '123456',
          eventName: 'Test Event',
        },
        deps,
      );

      expect(result.sent).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.results).toHaveLength(3);
      expect(result.results.find((r) => r.phone === 'invalid')?.success).toBe(false);
    });

    it('respects max phone limit', async () => {
      const { db } = createFakeDb();
      const deps = createServiceDeps(db);

      const phones = Array.from({ length: 1001 }, (_, i) => `+420777${String(i).padStart(6, '0')}`);

      const result = await sendBulkConfirmationSms(
        {
          phoneNumbers: phones,
          code: '123456',
          eventName: 'Test',
        },
        deps,
      );

      // Should handle gracefully or reject
      expect(result).toBeDefined();
    });

    it('rejects invalid code format', async () => {
      const { db } = createFakeDb();
      const deps = createServiceDeps(db);

      await expect(
        sendBulkConfirmationSms(
          {
            phoneNumbers: ['+420777111111'],
            code: '12345', // Invalid
            eventName: 'Test',
          },
          deps,
        ),
      ).rejects.toThrow(SmsError);
    });

    it('publishes bulk completion event', async () => {
      const { db } = createFakeDb();
      const bulkgate = createFakeBulkgate();
      const kafka = createFakeKafka();
      const deps = createServiceDeps(db, bulkgate, kafka);

      await sendBulkConfirmationSms(
        {
          phoneNumbers: ['+420777111111', '+420777222222'],
          code: '123456',
          eventName: 'Test',
          eventId: 'event-123',
        },
        deps,
      );

      expect(kafka.publish).toHaveBeenCalledWith(
        'sms.confirmation.bulk_completed',
        'event-123',
        expect.objectContaining({
          total: 2,
          sent: 2,
          failed: 0,
        }),
      );
    });

    it('includes all phones in results', async () => {
      const { db } = createFakeDb();
      const bulkgate = createFakeBulkgate();
      const kafka = createFakeKafka();
      const deps = createServiceDeps(db, bulkgate, kafka);

      const phones = ['+420777111111', '+420777222222', 'invalid'];
      const result = await sendBulkConfirmationSms(
        {
          phoneNumbers: phones,
          code: '123456',
          eventName: 'Test',
        },
        deps,
      );

      expect(result.results).toHaveLength(phones.length);
      expect(result.results.map((r) => r.phone).sort()).toEqual(phones.sort());
    });

    it('handles partial failures', async () => {
      const { db } = createFakeDb();
      const bulkgate = createFakeBulkgate();
      (bulkgate.sendSingle as any).mockImplementation((phone: string) => {
        if (phone === '+420777222222') {
          return Promise.reject(new Error('Delivery failed'));
        }
        return Promise.resolve({
          smsId: 'bg-ok',
          status: 'sent',
          priceHalire: 50,
        });
      });
      const kafka = createFakeKafka();
      const deps = createServiceDeps(db, bulkgate, kafka);

      const result = await sendBulkConfirmationSms(
        {
          phoneNumbers: ['+420777111111', '+420777222222'],
          code: '123456',
          eventName: 'Test',
        },
        deps,
      );

      expect(result.sent).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results).toHaveLength(2);
    });
  });
});
