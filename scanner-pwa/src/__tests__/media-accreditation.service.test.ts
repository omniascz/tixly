import { describe, it, expect, vi } from 'vitest';
import {
  submitAccreditationRequest,
  approveAccreditation,
  rejectAccreditation,
  validateAccreditationQr,
  listAccreditationRequests,
  getAccreditationStats,
} from '../services/media-accreditation.service.js';
import type { DbAdapter } from '../services/media-accreditation.service.js';

function makeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-001',
    event_id: 'event-001',
    promoter_id: 'promoter-001',
    requester_name: 'Jana Nováková',
    requester_email: 'jana@press.cz',
    organization: 'Reflex Magazine',
    media_type: 'press',
    requested_zones: ['press-area', 'photo-pit'],
    purpose: 'Reportáž pro tiskový zákazník',
    portfolio_url: null,
    status: 'pending',
    reviewed_by: null,
    review_notes: null,
    approved_zones: [],
    qr_code_payload: null,
    qr_issued_at: null,
    created_at: '2026-04-14T08:00:00Z',
    updated_at: '2026-04-14T08:00:00Z',
    ...overrides,
  };
}

function makeScanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scan-001',
    accreditation_id: 'acc-001',
    zone_id: 'press-area',
    gate_id: 'gate-001',
    scanned_at: '2026-04-14T14:00:00Z',
    result: 'allowed',
    deny_reason: null,
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

describe('submitAccreditationRequest', () => {
  it('vytvoří žádost o akreditaci', async () => {
    const db = makeDb([[makeRequestRow()]]);
    const result = await submitAccreditationRequest({
      eventId: 'event-001',
      promoterId: 'promoter-001',
      requesterName: 'Jana Nováková',
      requesterEmail: 'jana@press.cz',
      organization: 'Reflex Magazine',
      mediaType: 'press',
      requestedZones: ['press-area', 'photo-pit'],
    }, db);

    expect(result.status).toBe('pending');
    expect(result.requesterName).toBe('Jana Nováková');
    expect(result.approvedZones).toEqual([]);
  });

  it('odmítne prázdné jméno', async () => {
    const db = makeDb();
    await expect(submitAccreditationRequest({
      eventId: 'e', promoterId: 'p', requesterName: '   ',
      requesterEmail: 'a@b.cz', organization: 'Org',
      mediaType: 'photo', requestedZones: ['zone-1'],
    }, db)).rejects.toThrow('requesterName is required');
  });

  it('odmítne neplatný email', async () => {
    const db = makeDb();
    await expect(submitAccreditationRequest({
      eventId: 'e', promoterId: 'p', requesterName: 'Jan',
      requesterEmail: 'not-an-email', organization: 'Org',
      mediaType: 'tv', requestedZones: ['zone-1'],
    }, db)).rejects.toThrow('invalid email');
  });

  it('odmítne prázdný seznam zón', async () => {
    const db = makeDb();
    await expect(submitAccreditationRequest({
      eventId: 'e', promoterId: 'p', requesterName: 'Jan',
      requesterEmail: 'jan@test.cz', organization: 'Org',
      mediaType: 'radio', requestedZones: [],
    }, db)).rejects.toThrow('at least one zone');
  });
});

describe('approveAccreditation', () => {
  it('schválí žádost s podmnožinou zón a vygeneruje QR', async () => {
    const approvedRow = makeRequestRow({
      status: 'approved',
      reviewed_by: 'admin-001',
      approved_zones: ['press-area'],
      qr_code_payload: 'MOCK_QR_PAYLOAD',
      qr_issued_at: '2026-04-14T09:00:00Z',
    });
    const db = makeDb([[approvedRow]]);

    const result = await approveAccreditation(
      'acc-001', 'promoter-001', 'admin-001', ['press-area'], 'Schváleno pro tiskovou oblast', db,
    );

    expect(result.status).toBe('approved');
    expect(result.approvedZones).toEqual(['press-area']);
    expect(result.qrCodePayload).toBeTruthy();
  });

  it('odmítne schválení s prázdným seznamem zón', async () => {
    const db = makeDb();
    await expect(approveAccreditation('acc-001', 'promoter-001', 'admin', [], null, db))
      .rejects.toThrow('approvedZones cannot be empty');
  });

  it('vyhodí chybu pokud akreditace nenalezena', async () => {
    const db = makeDb([[]]); // empty
    await expect(approveAccreditation('bad-id', 'promoter-001', 'admin', ['zone-1'], null, db))
      .rejects.toThrow('ACCREDITATION_NOT_FOUND');
  });
});

describe('rejectAccreditation', () => {
  it('zamítne žádost o akreditaci', async () => {
    const rejectedRow = makeRequestRow({ status: 'rejected', reviewed_by: 'admin-001' });
    const db = makeDb([[rejectedRow]]);

    const result = await rejectAccreditation('acc-001', 'promoter-001', 'admin-001', 'Nevyhovující portfolio', db);
    expect(result.status).toBe('rejected');
  });
});

describe('validateAccreditationQr', () => {
  function buildQrPayload(id: string, zones: string[]): string {
    return Buffer.from(JSON.stringify({
      type: 'media_accreditation',
      id,
      zones,
      nonce: 'deadbeef',
    })).toString('base64url');
  }

  it('povolí vstup do schválené zóny', async () => {
    const qr = buildQrPayload('acc-001', ['press-area']);
    const accRow = makeRequestRow({ status: 'approved', approved_zones: ['press-area'] });
    const scanRow = makeScanRow({ result: 'allowed' });
    const db = makeDb([[accRow], [scanRow]]);

    const result = await validateAccreditationQr(qr, 'press-area', 'gate-001', db);
    expect(result.result).toBe('allowed');
    expect(result.denyReason).toBeNull();
  });

  it('odmítne vstup do neschválené zóny', async () => {
    const qr = buildQrPayload('acc-001', ['press-area']);
    const accRow = makeRequestRow({ status: 'approved', approved_zones: ['press-area'] });
    const scanRow = makeScanRow({ result: 'denied', deny_reason: 'ZONE_NOT_IN_APPROVED_LIST', zone_id: 'photo-pit' });
    const db = makeDb([[accRow], [scanRow]]);

    const result = await validateAccreditationQr(qr, 'photo-pit', 'gate-002', db);
    expect(result.result).toBe('denied');
  });

  it('odmítne neplatný QR kód', async () => {
    const scanRow = makeScanRow({ accreditation_id: '00000000-0000-0000-0000-000000000000', result: 'denied', deny_reason: 'INVALID_QR' });
    const db = makeDb([[scanRow]]);

    const result = await validateAccreditationQr('not-valid-base64url!!!', 'press-area', null, db);
    expect(result.result).toBe('denied');
  });

  it('odmítne QR pokud akreditace není schválena', async () => {
    const qr = buildQrPayload('acc-pending', ['press-area']);
    const scanRow = makeScanRow({ result: 'denied', deny_reason: 'ACCREDITATION_NOT_APPROVED' });
    const db = makeDb([[/* empty accRows */], [scanRow]]);

    const result = await validateAccreditationQr(qr, 'press-area', null, db);
    expect(result.result).toBe('denied');
  });
});

describe('listAccreditationRequests', () => {
  it('vrátí seznam žádostí filtrovaný podle statusu', async () => {
    const db = makeDb([[
      makeRequestRow({ status: 'pending' }),
      makeRequestRow({ id: 'acc-002', status: 'pending' }),
    ]]);

    const result = await listAccreditationRequests('event-001', 'promoter-001', 'pending', db);
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('pending');
  });
});

describe('getAccreditationStats', () => {
  it('vrátí statistiky žádostí a skenů', async () => {
    const db = makeDb([
      [{ pending: '3', approved: '5', rejected: '2' }],
      [{ allowed: '12', denied: '2' }],
    ]);

    const result = await getAccreditationStats('event-001', 'promoter-001', db);
    expect(result.total).toBe(10);
    expect(result.approved).toBe(5);
    expect(result.pending).toBe(3);
    expect(result.scansAllowed).toBe(12);
    expect(result.scansDenied).toBe(2);
  });

  it('vrátí nuly pokud nejsou žádná data', async () => {
    const db = makeDb([[{}], [{}]]);
    const result = await getAccreditationStats('event-001', 'promoter-001', db);
    expect(result.total).toBe(0);
    expect(result.scansAllowed).toBe(0);
  });
});
