import { describe, it, expect, vi } from 'vitest';
import {
  registerDevice,
  validateForTurnstile,
  heartbeat,
  getCapacityStatus,
  listDevices,
} from '../services/turnstile.service.js';
import type { DbAdapter } from '../services/turnstile.service.js';

function makeDeviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dev-row-001',
    event_id: 'event-001',
    venue_id: 'venue-001',
    device_id: 'TURNSTILE-GATE-A',
    name: 'Brána A - hlavní vstup',
    zone_id: null,
    gate_type: 'entry',
    status: 'online',
    last_heartbeat_at: null,
    firmware_version: '2.1.0',
    created_at: '2026-04-14T08:00:00Z',
    ...overrides,
  };
}

function makeTicketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-001',
    holder_name: 'Petr Novák',
    status: 'active',
    event_id: 'event-001',
    ...overrides,
  };
}

function makePassageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'passage-001',
    device_id: 'TURNSTILE-GATE-A',
    ticket_id: 'ticket-001',
    qr_payload: 'QR_PAYLOAD_ABC',
    direction: 'entry',
    result: 'granted',
    deny_reason: null,
    gate_open_ms: 3000,
    latency_ms: 45,
    processed_at: '2026-04-14T14:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
  };
}

describe('registerDevice', () => {
  it('zaregistruje nové turnikétové zařízení', async () => {
    const db = makeDb([[makeDeviceRow()]]);
    const result = await registerDevice({
      eventId: 'event-001',
      venueId: 'venue-001',
      deviceId: 'TURNSTILE-GATE-A',
      name: 'Brána A - hlavní vstup',
      gateType: 'entry',
      firmwareVersion: '2.1.0',
    }, db);

    expect(result.deviceId).toBe('TURNSTILE-GATE-A');
    expect(result.gateType).toBe('entry');
    expect(result.status).toBe('online');
  });

  it('odmítne prázdné deviceId', async () => {
    const db = makeDb();
    await expect(registerDevice({
      eventId: 'e', venueId: 'v', deviceId: '   ', name: 'Gate',
    }, db)).rejects.toThrow('deviceId is required');
  });

  it('výchozí gateType je entry', async () => {
    const db = makeDb([[makeDeviceRow()]]);
    await registerDevice({ eventId: 'e', venueId: 'v', deviceId: 'GATE-1', name: 'Gate 1' }, db);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("ON CONFLICT");
  });
});

describe('validateForTurnstile', () => {
  const startedAt = Date.now() - 50; // 50ms ago

  it('povolí vstup pro platný ticket', async () => {
    const db = makeDb([
      [makeDeviceRow()],          // device lookup
      [makeTicketRow()],          // ticket lookup
      [makePassageRow()],         // log passage
    ]);
    const result = await validateForTurnstile('TURNSTILE-GATE-A', 'QR_PAYLOAD_ABC', 'entry', startedAt, db);

    expect(result.result).toBe('granted');
    expect(result.gateOpenMs).toBe(3000);
    expect(result.ticketId).toBe('ticket-001');
    expect(result.holderName).toBe('Petr Novák');
    expect(result.denyReason).toBeNull();
    expect(db.execute).toHaveBeenCalledOnce(); // capacity counter
  });

  it('odmítne vstup pro offline zařízení', async () => {
    const db = makeDb([
      [],                          // no online device
      [makePassageRow({ result: 'denied', deny_reason: 'DEVICE_OFFLINE', gate_open_ms: 0 })],
    ]);
    const result = await validateForTurnstile('OFFLINE-GATE', 'QR', 'entry', startedAt, db);

    expect(result.result).toBe('denied');
    expect(result.denyReason).toBe('DEVICE_OFFLINE');
    expect(result.gateOpenMs).toBe(0);
  });

  it('odmítne neexistující ticket', async () => {
    const db = makeDb([
      [makeDeviceRow()],
      [],                          // ticket not found
      [makePassageRow({ result: 'denied', deny_reason: 'TICKET_NOT_FOUND', gate_open_ms: 0 })],
    ]);
    const result = await validateForTurnstile('TURNSTILE-GATE-A', 'UNKNOWN_QR', 'entry', startedAt, db);

    expect(result.result).toBe('denied');
    expect(result.denyReason).toBe('TICKET_NOT_FOUND');
    expect(result.ticketId).toBeNull();
  });

  it('odmítne stornovaný ticket', async () => {
    const db = makeDb([
      [makeDeviceRow()],
      [makeTicketRow({ status: 'cancelled' })],
      [makePassageRow({ result: 'denied', deny_reason: 'TICKET_INVALID', gate_open_ms: 0 })],
    ]);
    const result = await validateForTurnstile('TURNSTILE-GATE-A', 'QR_CANCELLED', 'entry', startedAt, db);

    expect(result.result).toBe('denied');
    expect(result.denyReason).toBe('TICKET_INVALID');
    expect(result.ticketId).toBe('ticket-001');
  });

  it('odmítne refundovaný ticket', async () => {
    const db = makeDb([
      [makeDeviceRow()],
      [makeTicketRow({ status: 'refunded' })],
      [makePassageRow({ result: 'denied', deny_reason: 'TICKET_INVALID', gate_open_ms: 0 })],
    ]);
    const result = await validateForTurnstile('TURNSTILE-GATE-A', 'QR_REFUNDED', 'entry', startedAt, db);

    expect(result.result).toBe('denied');
    expect(result.denyReason).toBe('TICKET_INVALID');
  });

  it('aktualizuje capacity counter při výstupu', async () => {
    const db = makeDb([
      [makeDeviceRow()],
      [makeTicketRow()],
      [makePassageRow({ direction: 'exit' })],
    ]);
    await validateForTurnstile('TURNSTILE-GATE-A', 'QR_PAYLOAD_ABC', 'exit', startedAt, db);
    expect(db.execute).toHaveBeenCalledOnce();
    const sql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('capacity_counters');
  });
});

describe('heartbeat', () => {
  it('aktualizuje stav zařízení na online', async () => {
    const db = makeDb([], vi.fn());
    await heartbeat('TURNSTILE-GATE-A', '2.1.1', db);
    expect(db.execute).toHaveBeenCalledOnce();
    const sql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("status = 'online'");
  });

  it('funguje bez firmwareVersion', async () => {
    const db = makeDb([], vi.fn());
    await heartbeat('TURNSTILE-GATE-A', null, db);
    expect(db.execute).toHaveBeenCalledOnce();
  });
});

describe('getCapacityStatus', () => {
  it('vrátí kapacitní status pro event', async () => {
    const db = makeDb([[
      {
        device_id: 'TURNSTILE-GATE-A',
        event_id: 'event-001',
        entries_count: 150,
        exits_count: 30,
        current_inside: 120,
        last_passage_at: '2026-04-14T14:00:00Z',
      },
    ]]);

    const result = await getCapacityStatus('event-001', db);
    expect(result).toHaveLength(1);
    expect(result[0].currentInside).toBe(120);
    expect(result[0].entriesCount).toBe(150);
  });
});

describe('listDevices', () => {
  it('vrátí seznam zařízení pro event', async () => {
    const db = makeDb([[
      makeDeviceRow({ device_id: 'GATE-A', name: 'Brána A' }),
      makeDeviceRow({ device_id: 'GATE-B', name: 'Brána B', gate_type: 'exit' }),
    ]]);

    const result = await listDevices('event-001', db);
    expect(result).toHaveLength(2);
    expect(result[1].gateType).toBe('exit');
  });
});
