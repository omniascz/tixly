import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendSingleSms,
  sendBulkSms,
  type ServiceDeps,
  type SmsDbAdapter,
  type KafkaProducer,
} from '../services/sms.service.js';
import { BulkgateClient } from '../lib/bulkgate-client.js';
import { SmsError } from '../lib/sms-errors.js';
import { countSmsSegments } from '../lib/sms-segmenter.js';

// ---------------------------------------------------------------------------
// In-memory DB mock
// ---------------------------------------------------------------------------

interface FakeMessageRow {
  id: string;
  promoter_id: string | null;
  recipient_phone: string;
  text: string;
  category: string;
  status: string;
  external_id: string | null;
  error_message: string | null;
  cost_halire: number | null;
  segment_name: string | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

function createFakeDb(initialOptOuts: string[] = []): {
  db: SmsDbAdapter;
  messages: FakeMessageRow[];
  optOuts: Set<string>;
} {
  const messages: FakeMessageRow[] = [];
  const optOuts = new Set<string>(initialOptOuts);
  let idCounter = 1;

  const db: SmsDbAdapter = {
    async query(sql: string, params: unknown[] = []) {
      const s = sql.trim();

      if (s.startsWith('INSERT INTO sms.opt_outs')) {
        optOuts.add(params[0] as string);
        return { rows: [], rowCount: 1 };
      }

      if (s.startsWith('SELECT phone FROM sms.opt_outs WHERE phone = $1')) {
        const phone = params[0] as string;
        return optOuts.has(phone)
          ? { rows: [{ phone }] as any, rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (s.startsWith('SELECT phone FROM sms.opt_outs WHERE phone = ANY')) {
        const phones = params[0] as string[];
        const hits = phones.filter((p) => optOuts.has(p)).map((p) => ({ phone: p }));
        return { rows: hits as any, rowCount: hits.length };
      }

      if (s.startsWith('INSERT INTO sms.messages')) {
        const isBulk = s.includes('segment_name');
        const row: FakeMessageRow = {
          id: `msg-${idCounter++}`,
          promoter_id: (params[0] as string) ?? null,
          recipient_phone: params[1] as string,
          text: params[2] as string,
          category: isBulk ? 'marketing' : (params[3] as string),
          status: isBulk ? 'queued' : 'pending',
          external_id: null,
          error_message: null,
          cost_halire: null,
          segment_name: isBulk ? ((params[3] as string) ?? null) : null,
          sent_at: null,
          delivered_at: null,
          created_at: new Date(),
        };
        messages.push(row);
        return { rows: [row] as any, rowCount: 1 };
      }

      if (s.startsWith('UPDATE sms.messages')) {
        const id = params[0] as string;
        const row = messages.find((m) => m.id === id);
        if (!row) return { rows: [], rowCount: 0 };

        if (s.includes("status = 'sent'") && s.includes('external_id')) {
          row.status = 'sent';
          row.external_id = params[1] as string;
          row.cost_halire = params[2] as number | null;
          row.sent_at = new Date();
        } else if (s.includes("status = 'sent'")) {
          row.status = 'sent';
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

  return { db, messages, optOuts };
}

function createDeps(
  opts: {
    optOuts?: string[];
    configured?: boolean;
  } = {},
): { deps: ServiceDeps; kafka: KafkaProducer; messages: FakeMessageRow[] } {
  const { db, messages } = createFakeDb(opts.optOuts);

  const kafka: KafkaProducer = {
    publish: vi.fn(async () => {}),
  };

  const bulkgate = new BulkgateClient({
    appId: opts.configured ? 123 : 0,
    appToken: opts.configured ? 'token' : '',
    apiBaseUrl: 'https://portal.bulkgate.com/api/1.0',
    senderId: 'gText',
    senderIdValue: 'PulseUp',
    isConfigured: Boolean(opts.configured),
  });

  return { deps: { db, kafka, bulkgate }, kafka, messages };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sms-segmenter', () => {
  it('counts 160 GSM chars as 1 segment', () => {
    expect(countSmsSegments('a'.repeat(160))).toBe(1);
  });

  it('counts 161 GSM chars as 2 segments', () => {
    expect(countSmsSegments('a'.repeat(161))).toBe(2);
  });

  it('uses unicode mode for Czech diacritics (70 chars per segment)', () => {
    expect(countSmsSegments('á'.repeat(70))).toBe(1);
    expect(countSmsSegments('á'.repeat(71))).toBe(2);
  });
});

describe('sendSingleSms — dev mode', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch' as any).mockImplementation(() => {
      throw new Error('fetch should not be called in dev mode');
    });
  });

  it('returns row with status sent and never calls fetch', async () => {
    const { deps } = createDeps({ configured: false });
    const result = await sendSingleSms(
      {
        phone: '+420601234567',
        text: 'Hello',
        category: 'transactional',
      },
      deps,
    );
    expect(result.status).toBe('sent');
    expect(result.externalId).toMatch(/^dev-/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('sendSingleSms — configured mode', () => {
  it('builds correct request body and parses response', async () => {
    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            sms_id: 'bg-123',
            status: 'accepted',
            price: 0.45,
            credit: 100,
            channel: 'sms',
          },
        }),
        { status: 200 },
      ) as any,
    );

    const { deps } = createDeps({ configured: true });
    const result = await sendSingleSms(
      {
        phone: '+420601234567',
        text: 'Hello',
        category: 'transactional',
      },
      deps,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toContain('/simple/transactional');
    const body = JSON.parse(init.body as string);
    expect(body.application_id).toBe(123);
    expect(body.application_token).toBe('token');
    expect(body.number).toBe('420601234567'); // no +
    expect(body.text).toBe('Hello');
    expect(body.sender_id).toBe('gText');
    expect(body.sender_id_value).toBe('PulseUp');

    expect(result.externalId).toBe('bg-123');
    expect(result.status).toBe('sent');
    expect(result.costHalire).toBe(45); // 0.45 * 100
  });
});

describe('sendSingleSms — validation', () => {
  it('throws SMS_INVALID_PHONE for bogus phone', async () => {
    const { deps } = createDeps();
    await expect(
      sendSingleSms(
        { phone: 'not-a-phone', text: 'x', category: 'transactional' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'SMS_INVALID_PHONE' });
  });

  it('throws SMS_TEXT_TOO_LONG for 1600 char text', async () => {
    const { deps } = createDeps();
    await expect(
      sendSingleSms(
        {
          phone: '+420601234567',
          text: 'a'.repeat(1600),
          category: 'transactional',
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'SMS_TEXT_TOO_LONG' });
  });

  it('throws SMS_RECIPIENT_OPTED_OUT for marketing to opted-out phone', async () => {
    const { deps } = createDeps({ optOuts: ['+420601234567'] });
    await expect(
      sendSingleSms(
        {
          phone: '+420601234567',
          text: 'Promo!',
          category: 'marketing',
          promoterId: '00000000-0000-0000-0000-000000000001',
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'SMS_RECIPIENT_OPTED_OUT' });
  });

  it('transactional SMS bypasses opt-out', async () => {
    vi.spyOn(global, 'fetch' as any).mockResolvedValue(
      new Response(
        JSON.stringify({ data: { sms_id: 'x', status: 'sent', price: 0 } }),
        { status: 200 },
      ) as any,
    );
    const { deps } = createDeps({
      optOuts: ['+420601234567'],
      configured: true,
    });
    const result = await sendSingleSms(
      {
        phone: '+420601234567',
        text: 'Vaše vstupenka',
        category: 'transactional',
      },
      deps,
    );
    expect(result.status).toBe('sent');
  });
});

describe('sendBulkSms', () => {
  it('returns total 3, queued 1, rejected 2 (1 invalid, 1 opted-out)', async () => {
    const { deps } = createDeps({
      optOuts: ['+420602222222'],
      configured: false,
    });

    const result = await sendBulkSms(
      {
        promoterId: '00000000-0000-0000-0000-000000000001',
        phones: ['+420601111111', '+420602222222', 'not-a-phone'],
        text: 'Promo',
        category: 'marketing',
      },
      deps,
    );

    expect(result.total).toBe(3);
    expect(result.queued).toBe(1);
    expect(result.rejected).toHaveLength(2);
    const reasons = result.rejected.map((r) => r.reason).sort();
    expect(reasons).toEqual(['invalid_phone', 'opted_out']);
  });
});
