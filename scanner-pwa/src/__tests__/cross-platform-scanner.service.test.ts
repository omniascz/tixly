import { describe, it, expect, vi } from 'vitest';
import {
  parseCsv,
  importGuestList,
  validateExternalTicket,
  getScanStats,
  listGuestLists,
} from '../services/cross-platform-scanner.service.js';
import type { DbAdapter } from '../services/cross-platform-scanner.service.js';

function makeGuestListRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gl-001',
    event_id: 'event-001',
    promoter_id: 'promoter-001',
    source_platform: 'ticketportal',
    file_name: 'ticketportal_export.csv',
    ticket_count: 100,
    imported_by: 'staff-001',
    imported_at: '2026-04-14T08:00:00Z',
    notes: null,
    ...overrides,
  };
}

function makeTicketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'it-001',
    guest_list_id: 'gl-001',
    external_ticket_id: 'TP-123456',
    qr_code: 'QR_TICKETPORTAL_001',
    holder_name: 'Martin Kříž',
    seat_info: 'Sektor A, Řada 5, Místo 12',
    ticket_type: 'Stání',
    scanned_at: null,
    scanned_by_staff_id: null,
    scan_result: null,
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

const VALID_CSV = `external_ticket_id,qr_code,holder_name,seat_info,ticket_type
TP-001,QR_001,Petr Novák,Sektor A,Standing
TP-002,QR_002,Jana Dvořáčková,Sektor B,VIP
TP-003,QR_003,,, `;

const MINIMAL_CSV = `external_ticket_id,qr_code
TP-001,QR_001
TP-002,QR_002`;

describe('parseCsv', () => {
  it('parsuje platné CSV s volitelným polemi', () => {
    const rows = parseCsv(VALID_CSV);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      externalTicketId: 'TP-001',
      qrCode: 'QR_001',
      holderName: 'Petr Novák',
      seatInfo: 'Sektor A',
      ticketType: 'Standing',
    });
    expect(rows[2].holderName).toBeUndefined();
  });

  it('parsuje minimální CSV (jen povinné sloupce)', () => {
    const rows = parseCsv(MINIMAL_CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0].externalTicketId).toBe('TP-001');
    expect(rows[0].qrCode).toBe('QR_001');
    expect(rows[0].holderName).toBeUndefined();
  });

  it('přeskočí prázdné řádky', () => {
    const csv = 'external_ticket_id,qr_code\nTP-001,QR_001\n\n\nTP-002,QR_002';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
  });

  it('zpracuje Windows CRLF konce řádků', () => {
    const csv = 'external_ticket_id,qr_code\r\nTP-001,QR_001\r\nTP-002,QR_002';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
  });

  it('zpracuje hodnoty v uvozovkách s čárkou uvnitř', () => {
    const csv = 'external_ticket_id,qr_code,holder_name\nTP-001,QR_001,"Novák, Petr"';
    const rows = parseCsv(csv);
    expect(rows[0].holderName).toBe('Novák, Petr');
  });

  it('vyhodí chybu pro chybějící sloupec external_ticket_id', () => {
    const csv = 'qr_code,holder_name\nQR_001,Jan';
    expect(() => parseCsv(csv)).toThrow('missing column external_ticket_id');
  });

  it('vyhodí chybu pro chybějící sloupec qr_code', () => {
    const csv = 'external_ticket_id,holder_name\nTP-001,Jan';
    expect(() => parseCsv(csv)).toThrow('missing column qr_code');
  });

  it('vyhodí chybu pro CSV bez datových řádků', () => {
    expect(() => parseCsv('external_ticket_id,qr_code')).toThrow('no data rows found');
  });

  it('přeskočí řádky s prázdným qr_code nebo external_ticket_id', () => {
    const csv = 'external_ticket_id,qr_code\nTP-001,\n,QR_002\nTP-003,QR_003';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].qrCode).toBe('QR_003');
  });
});

describe('importGuestList', () => {
  it('importuje guest list z CSV', async () => {
    const db = makeDb([
      [makeGuestListRow()],         // create guest list
      [{ id: 'it-001' }],           // insert ticket 1
      [{ id: 'it-002' }],           // insert ticket 2
      [{ id: 'it-003' }],           // insert ticket 3
    ]);

    const result = await importGuestList({
      eventId: 'event-001',
      promoterId: 'promoter-001',
      sourcePlatform: 'ticketportal',
      fileName: 'ticketportal_export.csv',
      importedBy: 'staff-001',
    }, VALID_CSV, db);

    expect(result.guestList.sourcePlatform).toBe('ticketportal');
    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(db.execute).toHaveBeenCalledOnce(); // update ticket_count
  });

  it('počítá přeskočené duplicitní QR kódy', async () => {
    const db = makeDb([
      [makeGuestListRow()],
      [{ id: 'it-001' }],  // first import ok
      [],                   // second is ON CONFLICT DO NOTHING → empty
    ]);

    const csv = 'external_ticket_id,qr_code\nTP-001,QR_001\nTP-001-dup,QR_001';
    const result = await importGuestList({
      eventId: 'event-001', promoterId: 'promoter-001',
      sourcePlatform: 'manual', fileName: 'test.csv', importedBy: 'staff-001',
    }, csv, db);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('vyhodí chybu pro CSV bez platných řádků', async () => {
    const db = makeDb();
    const csv = 'external_ticket_id,qr_code\n,\n,';
    await expect(importGuestList({
      eventId: 'e', promoterId: 'p', sourcePlatform: 'manual',
      fileName: 'empty.csv', importedBy: 'staff-001',
    }, csv, db)).rejects.toThrow('no valid ticket rows');
  });
});

describe('validateExternalTicket', () => {
  it('vrátí valid pro platný nepřeskenovaný ticket', async () => {
    const db = makeDb([
      [makeTicketRow()],  // found, not scanned
      [makeTicketRow({ scanned_at: '2026-04-14T14:00:00Z', scan_result: 'valid' })],
    ]);

    const result = await validateExternalTicket('QR_TICKETPORTAL_001', 'staff-001', db);
    expect(result.result).toBe('valid');
    expect(result.ticket).not.toBeNull();
    expect(result.ticket!.scanResult).toBe('valid');
  });

  it('vrátí not_found pro neznámý QR kód', async () => {
    const db = makeDb([[]]); // empty
    const result = await validateExternalTicket('QR_UNKNOWN', null, db);
    expect(result.result).toBe('not_found');
    expect(result.ticket).toBeNull();
  });

  it('vrátí duplicate pro již přeskenovaný ticket', async () => {
    const scannedTicket = makeTicketRow({
      scanned_at: '2026-04-14T13:00:00Z',
      scan_result: 'valid',
    });
    const db = makeDb([[scannedTicket]]);

    const result = await validateExternalTicket('QR_TICKETPORTAL_001', 'staff-002', db);
    expect(result.result).toBe('duplicate');
    expect(result.ticket).not.toBeNull();
  });

  it('ošetří race condition při souběžném skenování', async () => {
    const unscannedTicket = makeTicketRow(); // scanned_at = null
    const db = makeDb([
      [unscannedTicket],  // SELECT: not yet scanned
      [],                  // UPDATE WHERE scanned_at IS NULL: returns empty (race)
    ]);

    const result = await validateExternalTicket('QR_TICKETPORTAL_001', 'staff-001', db);
    expect(result.result).toBe('duplicate');
  });
});

describe('getScanStats', () => {
  it('vrátí statistiky skenování pro event', async () => {
    const db = makeDb([
      [{ total: '100', scanned: '75' }],
      [
        { source_platform: 'ticketportal', total: '80', scanned: '60' },
        { source_platform: 'goout', total: '20', scanned: '15' },
      ],
    ]);

    const result = await getScanStats('event-001', 'promoter-001', db);
    expect(result.totalTickets).toBe(100);
    expect(result.scanned).toBe(75);
    expect(result.notScanned).toBe(25);
    expect(result.byPlatform).toHaveLength(2);
    expect(result.byPlatform[0]).toEqual({ sourcePlatform: 'ticketportal', total: 80, scanned: 60 });
  });

  it('vrátí nuly pro event bez dat', async () => {
    const db = makeDb([[{ total: '0', scanned: '0' }], []]);
    const result = await getScanStats('event-001', 'promoter-001', db);
    expect(result.totalTickets).toBe(0);
    expect(result.byPlatform).toHaveLength(0);
  });
});

describe('listGuestLists', () => {
  it('vrátí seznam guest listů pro event', async () => {
    const db = makeDb([[
      makeGuestListRow({ source_platform: 'ticketportal' }),
      makeGuestListRow({ id: 'gl-002', source_platform: 'goout' }),
    ]]);

    const result = await listGuestLists('event-001', 'promoter-001', db);
    expect(result).toHaveLength(2);
    expect(result[0].sourcePlatform).toBe('ticketportal');
    expect(result[1].sourcePlatform).toBe('goout');
  });
});
