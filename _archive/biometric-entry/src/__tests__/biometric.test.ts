import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enrollBiometric,
  matchFace,
  revokeEnrollment,
  deleteExpiredEnrollments,
  getEnrollment,
  getEnrollmentsForUser,
  exportUserBiometricData,
} from '../services/biometric.service.js';
import {
  BiometricError,
  type BiometricEncryptionAdapter,
  type DbAdapter,
  type EnrollmentInput,
  type FaceMatchAdapter,
  type ServiceDeps,
} from '../types/biometric.types.js';

type Row = Record<string, unknown>;

function makeDbMock() {
  const tables: Record<string, Row[]> = {
    'biometric.enrollments': [],
    'biometric.match_attempts': [],
    'biometric.audit_log': [],
    tickets: [],
    events: [],
  };

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    // events lookup
    if (/FROM events WHERE id/i.test(sql)) {
      const row = tables.events.find((e) => e.id === params[0]);
      return row ? [row] : [];
    }
    // select active enrollments for event match
    if (
      /FROM biometric\.enrollments[\s\S]*event_id = \$1 AND status = 'active' AND template_algorithm = \$2/i.test(
        sql,
      )
    ) {
      return tables['biometric.enrollments'].filter(
        (e) =>
          e.event_id === params[0] &&
          e.status === 'active' &&
          e.template_algorithm === params[1],
      );
    }
    // select by id + user
    if (/FROM biometric\.enrollments WHERE id = \$1 AND user_id = \$2/i.test(sql)) {
      return tables['biometric.enrollments'].filter(
        (e) => e.id === params[0] && e.user_id === params[1],
      );
    }
    // select by id only
    if (/FROM biometric\.enrollments WHERE id = \$1$/i.test(sql.trim())) {
      return tables['biometric.enrollments'].filter((e) => e.id === params[0]);
    }
    // user enrollments
    if (
      /FROM biometric\.enrollments[\s\S]*WHERE user_id = \$1 AND status = 'active'/i.test(
        sql,
      )
    ) {
      return tables['biometric.enrollments'].filter(
        (e) => e.user_id === params[0] && e.status === 'active',
      );
    }
    // all user enrollments (for export)
    if (/FROM biometric\.enrollments WHERE user_id = \$1$/i.test(sql.trim())) {
      return tables['biometric.enrollments'].filter(
        (e) => e.user_id === params[0],
      );
    }
    // match attempts export
    if (
      /FROM biometric\.match_attempts WHERE enrollment_id = ANY\(\$1\)/i.test(sql)
    ) {
      const ids = params[0] as string[];
      return tables['biometric.match_attempts'].filter((a) =>
        ids.includes(a.enrollment_id as string),
      );
    }
    // expired
    if (
      /FROM biometric\.enrollments[\s\S]*expires_at < \$1 AND status != 'deleted'/i.test(
        sql,
      )
    ) {
      const cutoff = params[0] as Date;
      return tables['biometric.enrollments'].filter(
        (e) =>
          (e.expires_at as Date).getTime() < cutoff.getTime() &&
          e.status !== 'deleted',
      );
    }
    // redeem ticket
    if (/UPDATE tickets[\s\S]*redeemed_at IS NULL[\s\S]*RETURNING id/i.test(sql)) {
      const tid = params[0];
      const ticket = tables.tickets.find((t) => t.id === tid);
      if (!ticket || ticket.redeemed_at != null) return [];
      ticket.redeemed_at = params[1];
      return [{ id: ticket.id }];
    }
    return [];
  });

  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO biometric\.enrollments/i.test(sql)) {
      tables['biometric.enrollments'].push({
        id: params[0],
        user_id: params[1],
        event_id: params[2],
        ticket_id: params[3],
        template_encrypted: params[4],
        template_algorithm: params[5],
        status: params[6],
        consent_version: params[7],
        consented_at: params[8],
        consent_source: params[9],
        enrolled_at: params[10],
        expires_at: params[11],
        revoked_at: params[12],
        deleted_at: params[13],
      });
      return;
    }
    if (/INSERT INTO biometric\.match_attempts/i.test(sql)) {
      tables['biometric.match_attempts'].push({
        id: params[0],
        enrollment_id: params[1],
        event_id: params[2],
        gate_id: params[3],
        result: params[4],
        confidence: params[5],
        matched_at: params[6],
        ticket_redeemed: params[7],
      });
      return;
    }
    if (/INSERT INTO biometric\.audit_log/i.test(sql)) {
      tables['biometric.audit_log'].push({
        id: params[0],
        event: params[1],
        payload: params[2],
        created_at: params[3],
      });
      return;
    }
    if (/UPDATE biometric\.enrollments[\s\S]*status = 'revoked'/i.test(sql)) {
      const row = tables['biometric.enrollments'].find((e) => e.id === params[0]);
      if (row) {
        row.status = 'revoked';
        row.revoked_at = params[1];
      }
      return;
    }
    if (
      /UPDATE biometric\.enrollments[\s\S]*template_encrypted = ''/i.test(sql)
    ) {
      const row = tables['biometric.enrollments'].find((e) => e.id === params[0]);
      if (row) {
        row.template_encrypted = '';
        row.status = 'deleted';
        row.deleted_at = params[1];
      }
      return;
    }
  });

  const db: DbAdapter = {
    query: query as unknown as DbAdapter['query'],
    execute: execute as unknown as DbAdapter['execute'],
    transaction: async (fn) => fn(db),
  };

  return { db, tables, query, execute };
}

function makeAdapters(similarityOverride?: (a: number[], b: number[]) => number) {
  const encryption: BiometricEncryptionAdapter = {
    encryptTemplate: vi.fn(async (t: number[]) =>
      Buffer.from(JSON.stringify(t)).toString('base64'),
    ),
    decryptTemplate: vi.fn(async (s: string) =>
      JSON.parse(Buffer.from(s, 'base64').toString('utf8')) as number[],
    ),
  };

  const faceMatch: FaceMatchAdapter = {
    computeSimilarity: vi.fn(
      similarityOverride ??
        ((a: number[], b: number[]) => {
          // default: 1 if identical, else compare first element
          if (a.length !== b.length) return 0;
          let eq = true;
          for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
              eq = false;
              break;
            }
          }
          return eq ? 1 : 0;
        }),
    ),
  };

  return { encryption, faceMatch };
}

function makeDeps(
  similarityOverride?: (a: number[], b: number[]) => number,
  nowFn?: () => Date,
): ServiceDeps & ReturnType<typeof makeDbMock> & ReturnType<typeof makeAdapters> {
  const dbMock = makeDbMock();
  const adapters = makeAdapters(similarityOverride);
  return {
    ...dbMock,
    ...adapters,
    now: nowFn,
  };
}

function mkTemplate(dim = 512, fill = 0.1): number[] {
  return Array(dim).fill(fill);
}

const baseInput: EnrollmentInput = {
  userId: 'user_1',
  eventId: 'evt_1',
  ticketId: 'tix_1',
  faceTemplate: mkTemplate(512, 0.1),
  templateAlgorithm: 'arcface_v2',
  consentVersion: '2026-01-01-v1',
  consentSource: 'mobile_app',
  eventEnd: new Date('2026-06-01T20:00:00Z'),
};

describe('enrollBiometric', () => {
  it('creates an active enrollment on valid input', async () => {
    const deps = makeDeps();
    const e = await enrollBiometric(baseInput, deps);
    expect(e.status).toBe('active');
    expect(e.userId).toBe('user_1');
    expect(e.consentVersion).toBe('2026-01-01-v1');
    expect(deps.encryption.encryptTemplate).toHaveBeenCalledWith(
      baseInput.faceTemplate,
    );
    expect(deps.tables['biometric.enrollments']).toHaveLength(1);
  });

  it('rejects invalid template dimension with INVALID_TEMPLATE', async () => {
    const deps = makeDeps();
    const bad = { ...baseInput, faceTemplate: mkTemplate(100, 0.1) };
    await expect(enrollBiometric(bad, deps)).rejects.toThrow(BiometricError);
    await expect(enrollBiometric(bad, deps)).rejects.toMatchObject({
      code: 'INVALID_TEMPLATE',
    });
  });

  it('requires consent version', async () => {
    const deps = makeDeps();
    await expect(
      enrollBiometric({ ...baseInput, consentVersion: '' }, deps),
    ).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  it('writes enrollment to audit log', async () => {
    const deps = makeDeps();
    await enrollBiometric(baseInput, deps);
    const audit = deps.tables['biometric.audit_log'];
    expect(audit).toHaveLength(1);
    expect(audit[0].event).toBe('biometric.enrolled');
  });

  it('computes expiresAt as event_end + 30 days', async () => {
    const deps = makeDeps();
    const e = await enrollBiometric(baseInput, deps);
    const expected = new Date(
      baseInput.eventEnd!.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    expect(e.expiresAt.getTime()).toBe(expected.getTime());
  });

  it('falls back to DB events table when eventEnd not passed', async () => {
    const deps = makeDeps();
    deps.tables.events.push({
      id: 'evt_db',
      event_end: new Date('2026-07-01T20:00:00Z'),
    });
    const input = { ...baseInput, eventId: 'evt_db', eventEnd: undefined };
    const e = await enrollBiometric(input, deps);
    const expected = new Date(
      new Date('2026-07-01T20:00:00Z').getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    expect(e.expiresAt.getTime()).toBe(expected.getTime());
  });

  it('calls encryption adapter with raw template', async () => {
    const deps = makeDeps();
    await enrollBiometric(baseInput, deps);
    expect(deps.encryption.encryptTemplate).toHaveBeenCalledTimes(1);
    const arg = (deps.encryption.encryptTemplate as any).mock.calls[0][0];
    expect(arg).toHaveLength(512);
  });
});

describe('matchFace', () => {
  async function seedEnrollment(
    deps: ReturnType<typeof makeDeps>,
    overrides: Partial<EnrollmentInput> = {},
  ) {
    const input = { ...baseInput, ...overrides };
    const e = await enrollBiometric(input, deps);
    deps.tables.tickets.push({ id: input.ticketId, redeemed_at: null });
    return e;
  }

  it('returns matched and redeems ticket when similarity above threshold and unique', async () => {
    // Seed with fill=0.1, query with fill=0.1 → identical → similarity=1
    const deps = makeDeps();
    const enrolled = await seedEnrollment(deps);

    const res = await matchFace(
      {
        eventId: 'evt_1',
        gateId: 'gate_A',
        faceTemplate: mkTemplate(512, 0.1),
        templateAlgorithm: 'arcface_v2',
      },
      deps,
    );

    expect(res.result).toBe('matched');
    expect(res.enrollmentId).toBe(enrolled.id);
    expect(res.ticketId).toBe('tix_1');
    expect(res.userId).toBe('user_1');

    const ticket = deps.tables.tickets[0];
    expect(ticket.redeemed_at).toBeInstanceOf(Date);

    const attempt = deps.tables['biometric.match_attempts'][0];
    expect(attempt.ticket_redeemed).toBe(true);
    expect(attempt.enrollment_id).toBe(enrolled.id);
  });

  it('returns no_match when no enrollment matches', async () => {
    const deps = makeDeps();
    await seedEnrollment(deps);

    const res = await matchFace(
      {
        eventId: 'evt_1',
        gateId: 'gate_A',
        faceTemplate: mkTemplate(512, 0.9), // different content → similarity 0
        templateAlgorithm: 'arcface_v2',
      },
      deps,
    );
    expect(res.result).toBe('no_match');
    expect(res.enrollmentId).toBeNull();
  });

  it('returns low_confidence when best candidate between 0.5 and threshold', async () => {
    // Custom similarity returning 0.7 for any pair.
    const deps = makeDeps(() => 0.7);
    await seedEnrollment(deps);

    const res = await matchFace(
      {
        eventId: 'evt_1',
        gateId: 'gate_A',
        faceTemplate: mkTemplate(512, 0.5),
        templateAlgorithm: 'arcface_v2',
      },
      deps,
    );
    expect(res.result).toBe('low_confidence');
    expect(res.enrollmentId).toBeNull();
  });

  it('returns multiple_matches when two enrollments are within ambiguity margin', async () => {
    // Both enrollments get very close scores above threshold.
    let call = 0;
    const deps = makeDeps(() => {
      call += 1;
      return call === 1 ? 0.97 : 0.95; // margin 0.02 < 0.05
    });
    await seedEnrollment(deps, {
      userId: 'user_1',
      ticketId: 'tix_1',
    });
    await seedEnrollment(deps, {
      userId: 'user_2',
      ticketId: 'tix_2',
    });

    const res = await matchFace(
      {
        eventId: 'evt_1',
        gateId: 'gate_A',
        faceTemplate: mkTemplate(512, 0.2),
        templateAlgorithm: 'arcface_v2',
      },
      deps,
    );
    expect(res.result).toBe('multiple_matches');
    expect(res.enrollmentId).toBeNull();
    // No ticket redeemed
    expect(deps.tables.tickets.every((t) => t.redeemed_at == null)).toBe(true);
  });

  it('throws INVALID_TEMPLATE for wrong-dim template', async () => {
    const deps = makeDeps();
    await expect(
      matchFace(
        {
          eventId: 'evt_1',
          gateId: 'gate_A',
          faceTemplate: mkTemplate(100, 0.1),
          templateAlgorithm: 'arcface_v2',
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TEMPLATE' });
  });

  it('algorithm mismatch: enrollment for other algorithm is not considered', async () => {
    const deps = makeDeps(() => 1);
    // Seed arcface
    await seedEnrollment(deps);
    // Query with facenet_v1 (different algo) — no rows should be returned
    const res = await matchFace(
      {
        eventId: 'evt_1',
        gateId: 'gate_A',
        faceTemplate: mkTemplate(128, 0.1),
        templateAlgorithm: 'facenet_v1',
      },
      deps,
    );
    expect(res.result).toBe('no_match');
  });

  it('throws TICKET_ALREADY_REDEEMED when match found but ticket used', async () => {
    const deps = makeDeps();
    await seedEnrollment(deps);
    // Pre-redeem ticket
    deps.tables.tickets[0].redeemed_at = new Date('2026-05-01');

    await expect(
      matchFace(
        {
          eventId: 'evt_1',
          gateId: 'gate_A',
          faceTemplate: mkTemplate(512, 0.1),
          templateAlgorithm: 'arcface_v2',
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'TICKET_ALREADY_REDEEMED' });
  });

  it('writes audit log for every match attempt', async () => {
    const deps = makeDeps();
    await seedEnrollment(deps);
    await matchFace(
      {
        eventId: 'evt_1',
        gateId: 'gate_A',
        faceTemplate: mkTemplate(512, 0.1),
        templateAlgorithm: 'arcface_v2',
      },
      deps,
    );
    const matchAudits = deps.tables['biometric.audit_log'].filter(
      (a) => a.event === 'biometric.match',
    );
    expect(matchAudits.length).toBeGreaterThanOrEqual(1);
  });
});

describe('revokeEnrollment', () => {
  it('revokes successfully when owner matches', async () => {
    const deps = makeDeps();
    const e = await enrollBiometric(baseInput, deps);
    const revoked = await revokeEnrollment(e.id, 'user_1', deps);
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).toBeInstanceOf(Date);
  });

  it('fails if caller is not the owner', async () => {
    const deps = makeDeps();
    const e = await enrollBiometric(baseInput, deps);
    await expect(
      revokeEnrollment(e.id, 'someone_else', deps),
    ).rejects.toMatchObject({ code: 'ENROLLMENT_NOT_FOUND' });
  });

  it('writes revocation to audit log', async () => {
    const deps = makeDeps();
    const e = await enrollBiometric(baseInput, deps);
    await revokeEnrollment(e.id, 'user_1', deps);
    const revokeAudits = deps.tables['biometric.audit_log'].filter(
      (a) => a.event === 'biometric.revoked',
    );
    expect(revokeAudits).toHaveLength(1);
  });
});

describe('deleteExpiredEnrollments', () => {
  it('clears template, sets status=deleted and writes audit', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const deps = makeDeps(undefined, () => now);
    // event_end in the past so expires_at is already past "now"
    await enrollBiometric(
      {
        ...baseInput,
        eventEnd: new Date('2026-06-01T20:00:00Z'),
      },
      deps,
    );

    const res = await deleteExpiredEnrollments(deps);
    expect(res.deletedCount).toBe(1);

    const row = deps.tables['biometric.enrollments'][0];
    expect(row.status).toBe('deleted');
    expect(row.template_encrypted).toBe('');
    expect(row.deleted_at).toBe(now);

    const audits = deps.tables['biometric.audit_log'].filter(
      (a) => a.event === 'biometric.auto_deleted',
    );
    expect(audits).toHaveLength(1);
  });

  it('does not touch still-valid enrollments', async () => {
    const now = new Date('2026-04-01T00:00:00Z');
    const deps = makeDeps(undefined, () => now);
    await enrollBiometric(baseInput, deps); // expires 2026-07-01
    const res = await deleteExpiredEnrollments(deps);
    expect(res.deletedCount).toBe(0);
    expect(deps.tables['biometric.enrollments'][0].status).toBe('active');
  });
});

describe('getEnrollment / getEnrollmentsForUser', () => {
  it('getEnrollment enforces ownership', async () => {
    const deps = makeDeps();
    const e = await enrollBiometric(baseInput, deps);
    const got = await getEnrollment(e.id, 'user_1', deps);
    expect(got.id).toBe(e.id);
    await expect(getEnrollment(e.id, 'other', deps)).rejects.toMatchObject({
      code: 'ENROLLMENT_NOT_FOUND',
    });
  });

  it('getEnrollmentsForUser returns only active ones', async () => {
    const deps = makeDeps();
    const a = await enrollBiometric(baseInput, deps);
    const b = await enrollBiometric(
      { ...baseInput, ticketId: 'tix_2' },
      deps,
    );
    await revokeEnrollment(b.id, 'user_1', deps);
    const list = await getEnrollmentsForUser('user_1', deps);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(a.id);
  });
});

describe('exportUserBiometricData (GDPR Art. 15)', () => {
  it('exports enrollments metadata without template_encrypted', async () => {
    const deps = makeDeps();
    const e = await enrollBiometric(baseInput, deps);
    deps.tables.tickets.push({ id: 'tix_1', redeemed_at: null });
    await matchFace(
      {
        eventId: 'evt_1',
        gateId: 'gate_A',
        faceTemplate: mkTemplate(512, 0.1),
        templateAlgorithm: 'arcface_v2',
      },
      deps,
    );

    const dump = await exportUserBiometricData('user_1', deps);
    expect(dump.userId).toBe('user_1');
    expect(dump.enrollments).toHaveLength(1);
    expect(dump.enrollments[0]).not.toHaveProperty('templateEncrypted');
    expect(dump.enrollments[0].id).toBe(e.id);
    expect(dump.matchAttempts.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty collections for unknown user', async () => {
    const deps = makeDeps();
    const dump = await exportUserBiometricData('ghost', deps);
    expect(dump.enrollments).toHaveLength(0);
    expect(dump.matchAttempts).toHaveLength(0);
  });
});
