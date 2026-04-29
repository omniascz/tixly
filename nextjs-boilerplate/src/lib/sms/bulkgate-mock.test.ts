import { describe, it, expect, vi } from 'vitest';
import { sendSms } from './bulkgate-mock';

interface FakeDb {
  query: ReturnType<typeof vi.fn>;
}

function makeDb(): FakeDb {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe('sendSms — phone normalization', () => {
  it('prefixes Czech 9-digit number with +420', async () => {
    const db = makeDb();
    const r = await sendSms(
      { to: '777123456', text: 'hi' },
      db as unknown as never,
    );
    expect(r.ok).toBe(true);
    const logCall = db.query.mock.calls[0];
    const newValues = JSON.parse(logCall![1]![1] as string);
    expect(newValues.to).toBe('+420777123456');
  });

  it('keeps international + format', async () => {
    const db = makeDb();
    const r = await sendSms(
      { to: '+421900000000', text: 'sk' },
      db as unknown as never,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects bogus phone', async () => {
    const db = makeDb();
    const r = await sendSms(
      { to: 'abc', text: 'hi' },
      db as unknown as never,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Neplatné');
  });
});

describe('sendSms — text length', () => {
  it('rejects > 480 characters', async () => {
    const db = makeDb();
    const r = await sendSms(
      { to: '+420777123456', text: 'a'.repeat(500) },
      db as unknown as never,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('příliš dlouhá');
  });

  it('counts segments by 160 chars', async () => {
    const db = makeDb();
    const r1 = await sendSms(
      { to: '+420777123456', text: 'a'.repeat(50) },
      db as unknown as never,
    );
    expect(r1.costHalire).toBe(100); // 1 segment

    const r2 = await sendSms(
      { to: '+420777123456', text: 'a'.repeat(200) },
      db as unknown as never,
    );
    expect(r2.costHalire).toBe(200); // 2 segments

    const r3 = await sendSms(
      { to: '+420777123456', text: 'a'.repeat(320) },
      db as unknown as never,
    );
    expect(r3.costHalire).toBe(200); // ceil(320/160)=2

    const r4 = await sendSms(
      { to: '+420777123456', text: 'a'.repeat(321) },
      db as unknown as never,
    );
    expect(r4.costHalire).toBe(300); // 3 segments
  });
});

describe('sendSms — provider selection', () => {
  it('returns mock provider when BULKGATE_TOKEN unset', async () => {
    const orig = process.env.BULKGATE_TOKEN;
    delete process.env.BULKGATE_TOKEN;
    const db = makeDb();
    const r = await sendSms(
      { to: '+420777123456', text: 'hi' },
      db as unknown as never,
    );
    expect(r.provider).toBe('mock');
    expect(r.messageId.startsWith('mock-')).toBe(true);
    if (orig) process.env.BULKGATE_TOKEN = orig;
  });
});

describe('sendSms — audit log', () => {
  it('logs to audit.audit_log', async () => {
    const db = makeDb();
    await sendSms(
      {
        to: '+420777123456',
        text: 'test',
        promoterId: 'p-1',
        orderId: 'o-1',
      },
      db as unknown as never,
    );
    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = db.query.mock.calls[0]![0] as string;
    expect(sql).toContain('audit.audit_log');
    const params = db.query.mock.calls[0]![1] as unknown[];
    const newValues = JSON.parse(params[1] as string);
    expect(newValues.promoter_id).toBe('p-1');
    expect(newValues.order_id).toBe('o-1');
  });
});
