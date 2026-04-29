// =============================================================================
// Collaborative event workflow — unit testy (Feature #49)
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  inviteCollaborator,
  respondToInvitation,
  revokeCollaborator,
  listCollaborators,
  submitChangeRequest,
  reviewChangeRequest,
  listChangeRequests,
} from '../services/collaborator.service.js';
import type { DbAdapter } from '../services/collaborator.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EVENT_ID = 'event-001';
const OWNER_ID = 'owner-promoter-001';
const INVITEE_ID = 'user-002';
const COLLABORATOR_ID = 'collab-001';
const CR_ID = 'cr-001';

function makeCollaboratorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COLLABORATOR_ID,
    event_id: EVENT_ID,
    owner_promoter_id: OWNER_ID,
    invitee_user_id: INVITEE_ID,
    role: 'agent',
    status: 'pending',
    invited_by: OWNER_ID,
    invited_at: '2026-04-14T10:00:00Z',
    responded_at: null,
    ...overrides,
  };
}

function makeChangeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CR_ID,
    event_id: EVENT_ID,
    owner_promoter_id: OWNER_ID,
    requested_by: INVITEE_ID,
    field: 'price_halire',
    ticket_type_id: null,
    old_value: 50000,
    new_value: 45000,
    reason: 'Navrhuji slevu pro větší zájem',
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    rejection_note: null,
    created_at: '2026-04-14T10:00:00Z',
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
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

// ---------------------------------------------------------------------------
// inviteCollaborator
// ---------------------------------------------------------------------------

describe('inviteCollaborator', () => {
  it('vloží nového spolupracovníka a vrátí mapovaný objekt', async () => {
    const db = makeDb([[makeCollaboratorRow()]]);

    const result = await inviteCollaborator(
      EVENT_ID, OWNER_ID, INVITEE_ID, 'agent', OWNER_ID, db,
    );

    expect(result.eventId).toBe(EVENT_ID);
    expect(result.role).toBe('agent');
    expect(result.status).toBe('pending');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('event_id, invitee_user_id');
  });
});

// ---------------------------------------------------------------------------
// respondToInvitation
// ---------------------------------------------------------------------------

describe('respondToInvitation', () => {
  it('přijme pozvánku → status = accepted', async () => {
    const db = makeDb([[makeCollaboratorRow({ status: 'accepted', responded_at: '2026-04-14T11:00:00Z' })]]);

    const result = await respondToInvitation(COLLABORATOR_ID, INVITEE_ID, true, db);

    expect(result.status).toBe('accepted');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("status = $1");
    expect(sql).toContain('invitee_user_id = $3');
  });

  it('odmítne pozvánku → status = declined', async () => {
    const db = makeDb([[makeCollaboratorRow({ status: 'declined', responded_at: '2026-04-14T11:00:00Z' })]]);

    const result = await respondToInvitation(COLLABORATOR_ID, INVITEE_ID, false, db);

    expect(result.status).toBe('declined');
  });

  it('vyhodí NOT_FOUND pokud pozvánka neexistuje nebo už byla zodpovězena', async () => {
    const db = makeDb([[]]); // prázdný výsledek

    await expect(
      respondToInvitation(COLLABORATOR_ID, INVITEE_ID, true, db),
    ).rejects.toThrow('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// revokeCollaborator
// ---------------------------------------------------------------------------

describe('revokeCollaborator', () => {
  it('volá UPDATE s owner_promoter_id pro tenant isolation', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await revokeCollaborator(COLLABORATOR_ID, OWNER_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'revoked'");
    expect(sql).toContain('owner_promoter_id = $2');
  });
});

// ---------------------------------------------------------------------------
// listCollaborators
// ---------------------------------------------------------------------------

describe('listCollaborators', () => {
  it('vrátí seznam spolupracovníků pro akci', async () => {
    const db = makeDb([[
      makeCollaboratorRow({ role: 'agent' }),
      makeCollaboratorRow({ id: 'c-2', role: 'co_promoter', invitee_user_id: 'user-003' }),
    ]]);

    const result = await listCollaborators(EVENT_ID, OWNER_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('agent');
    expect(result[1].role).toBe('co_promoter');
  });
});

// ---------------------------------------------------------------------------
// submitChangeRequest
// ---------------------------------------------------------------------------

describe('submitChangeRequest', () => {
  it('agent může odeslat požadavek na změnu', async () => {
    const db = makeDb([
      [{ role: 'agent', owner_promoter_id: OWNER_ID }], // collaborator lookup
      [makeChangeRequestRow()],                           // insert
    ]);

    const result = await submitChangeRequest(
      EVENT_ID, INVITEE_ID, 'price_halire', 50000, 45000,
      'Navrhuji slevu', db,
    );

    expect(result.field).toBe('price_halire');
    expect(result.status).toBe('pending');
    expect(result.requestedBy).toBe(INVITEE_ID);
  });

  it('viewer nemůže odeslat požadavek na změnu', async () => {
    const db = makeDb([
      [{ role: 'viewer', owner_promoter_id: OWNER_ID }],
    ]);

    await expect(
      submitChangeRequest(EVENT_ID, INVITEE_ID, 'price_halire', 50000, 45000, undefined, db),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('neakceptovaný spolupracovník nemůže odeslat požadavek', async () => {
    const db = makeDb([[]]); // prázdný výsledek — není accepted collaborator

    await expect(
      submitChangeRequest(EVENT_ID, INVITEE_ID, 'capacity', 1000, 800, undefined, db),
    ).rejects.toThrow('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// reviewChangeRequest
// ---------------------------------------------------------------------------

describe('reviewChangeRequest', () => {
  it('vlastník schválí požadavek → status approved + záznam do audit logu', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([[makeChangeRequestRow({ status: 'approved', reviewed_by: OWNER_ID })]], executeMock);

    const result = await reviewChangeRequest(CR_ID, OWNER_ID, true, OWNER_ID, undefined, db);

    expect(result.status).toBe('approved');
    // Audit log záznam
    expect(executeMock).toHaveBeenCalledTimes(1);
    const auditSql = executeMock.mock.calls[0][0] as string;
    expect(auditSql).toContain('collab.change_log');
  });

  it('vlastník zamítne požadavek → status rejected, žádný audit log', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([[makeChangeRequestRow({ status: 'rejected' })]], executeMock);

    const result = await reviewChangeRequest(CR_ID, OWNER_ID, false, OWNER_ID, 'Cena je správná', db);

    expect(result.status).toBe('rejected');
    expect(executeMock).not.toHaveBeenCalled(); // žádný audit log při zamítnutí
  });

  it('SQL dotaz je scoped na owner_promoter_id (tenant isolation)', async () => {
    const db = makeDb([[makeChangeRequestRow({ status: 'approved' })]]);

    await reviewChangeRequest(CR_ID, OWNER_ID, true, OWNER_ID, undefined, db);

    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('owner_promoter_id = $5');
  });

  it('vyhodí NOT_FOUND pokud požadavek neexistuje nebo není pending', async () => {
    const db = makeDb([[]]); // prázdný výsledek

    await expect(
      reviewChangeRequest(CR_ID, OWNER_ID, true, OWNER_ID, undefined, db),
    ).rejects.toThrow('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// listChangeRequests
// ---------------------------------------------------------------------------

describe('listChangeRequests', () => {
  it('vrátí change requesty filtrované dle statusu', async () => {
    const db = makeDb([[makeChangeRequestRow(), makeChangeRequestRow({ id: 'cr-2' })]]);

    const result = await listChangeRequests(EVENT_ID, OWNER_ID, 'pending', db);

    expect(result).toHaveLength(2);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('status = $3');
  });

  it('bez filtru statusu vrátí všechny requesty', async () => {
    const db = makeDb([[makeChangeRequestRow()]]);

    await listChangeRequests(EVENT_ID, OWNER_ID, undefined, db);

    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).not.toContain('status = $3');
  });
});
