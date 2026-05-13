import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { AccreditationService } from '../services/accreditation.service';
import type { AccreditationDbAdapter } from '../services/accreditation.service';
import type { Accreditation } from '../types/accreditation.types';
import {
  AccreditationDuplicateError,
  AccreditationNotFoundError,
  AccreditationUnauthorizedError,
} from '../types/accreditation.types';

// ---------------------------------------------------------------------------
// Mock DB Adapter
// ---------------------------------------------------------------------------

function makeMockDb(): AccreditationDbAdapter {
  return {
    findAccreditation: vi.fn(),
    findAccreditationByQr: vi.fn(),
    findByEmail: vi.fn(),
    createAccreditation: vi.fn(),
    updateAccreditation: vi.fn(),
    listByEvent: vi.fn(),
    checkOrganizerOwnership: vi.fn(),
    getZonesByIds: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EVENT_ID = 'event-uuid-001';
const USER_ID = 'user-uuid-001';
const ACCRED_ID = 'accred-uuid-001';
const QR_CODE = 'QR-code-12345';
const ZONE_ID = 'zone-uuid-001';

const MOCK_ACCREDITATION: Accreditation = {
  id: ACCRED_ID,
  event_id: EVENT_ID,
  holder_name: 'John Doe',
  holder_email: 'john@example.com',
  holder_phone: '+420123456789',
  holder_organization: 'Tech Company',
  accreditation_type: 'staff',
  role_description: 'Camera operator',
  zone_access: [ZONE_ID],
  valid_days: ['2026-05-01', '2026-05-02'],
  status: 'requested',
  qr_code: QR_CODE,
  badge_color: '#FF0000',
  photo_url: null,
  requested_by_user_id: USER_ID,
  approved_by_user_id: null,
  issued_at: null,
  approved_at: null,
  rejected_at: null,
  revoked_at: null,
  revocation_reason: null,
  notes: 'VIP access',
  created_at: new Date(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccreditationService', () => {
  let service: AccreditationService;
  let db: AccreditationDbAdapter;

  beforeEach(() => {
    service = new AccreditationService();
    db = makeMockDb();
  });

  // -------------------------------------------------------------------------
  // 1. requestAccreditation
  // -------------------------------------------------------------------------

  it('1. requestAccreditation — creates new accreditation request', async () => {
    vi.mocked(db.findByEmail).mockResolvedValue(null);
    vi.mocked(db.createAccreditation).mockResolvedValue(MOCK_ACCREDITATION);

    const result = await service.requestAccreditation(
      EVENT_ID,
      USER_ID,
      {
        holderName: 'John Doe',
        holderEmail: 'john@example.com',
        holderPhone: '+420123456789',
        holderOrganization: 'Tech Company',
        accreditationType: 'staff',
        roleDescription: 'Camera operator',
        zoneAccess: [ZONE_ID],
        validDays: ['2026-05-01', '2026-05-02'],
        notes: 'VIP access',
      },
      db
    );

    expect(result.id).toBe(ACCRED_ID);
    expect(result.holder_name).toBe('John Doe');
    expect(result.status).toBe('requested');
    expect(vi.mocked(db.findByEmail)).toHaveBeenCalledWith(EVENT_ID, 'john@example.com');
    expect(vi.mocked(db.createAccreditation)).toHaveBeenCalledOnce();
  });

  it('2. requestAccreditation — duplicate email throws error', async () => {
    vi.mocked(db.findByEmail).mockResolvedValue(MOCK_ACCREDITATION);

    await expect(
      service.requestAccreditation(
        EVENT_ID,
        USER_ID,
        {
          holderName: 'John Doe',
          holderEmail: 'john@example.com',
          accreditationType: 'staff',
          zoneAccess: [ZONE_ID],
        },
        db
      )
    ).rejects.toThrow(AccreditationDuplicateError);
  });

  // -------------------------------------------------------------------------
  // 3. approveAccreditation
  // -------------------------------------------------------------------------

  it('3. approveAccreditation — transitions to approved', async () => {
    const approved = { ...MOCK_ACCREDITATION, status: 'approved' as const, approved_by_user_id: USER_ID, approved_at: new Date() };
    vi.mocked(db.findAccreditation).mockResolvedValue(MOCK_ACCREDITATION);
    vi.mocked(db.updateAccreditation).mockResolvedValue(approved);

    const result = await service.approveAccreditation(ACCRED_ID, USER_ID, db);

    expect(result.status).toBe('approved');
    expect(result.approved_by_user_id).toBe(USER_ID);
    expect(vi.mocked(db.updateAccreditation)).toHaveBeenCalledWith(ACCRED_ID, expect.objectContaining({ status: 'approved' }));
  });

  it('4. approveAccreditation — not found throws error', async () => {
    vi.mocked(db.findAccreditation).mockResolvedValue(null);

    await expect(service.approveAccreditation(ACCRED_ID, USER_ID, db)).rejects.toThrow(
      AccreditationNotFoundError
    );
  });

  // -------------------------------------------------------------------------
  // 5. rejectAccreditation
  // -------------------------------------------------------------------------

  it('5. rejectAccreditation — transitions to rejected with reason', async () => {
    const rejected = { ...MOCK_ACCREDITATION, status: 'rejected' as const, revocation_reason: 'Invalid documents', rejected_at: new Date() };
    vi.mocked(db.findAccreditation).mockResolvedValue(MOCK_ACCREDITATION);
    vi.mocked(db.updateAccreditation).mockResolvedValue(rejected);

    const result = await service.rejectAccreditation(ACCRED_ID, USER_ID, 'Invalid documents', db);

    expect(result.status).toBe('rejected');
    expect(result.revocation_reason).toBe('Invalid documents');
    expect(vi.mocked(db.updateAccreditation)).toHaveBeenCalledWith(
      ACCRED_ID,
      expect.objectContaining({
        status: 'rejected',
        revocation_reason: 'Invalid documents',
      })
    );
  });

  // -------------------------------------------------------------------------
  // 6. issueAccreditation
  // -------------------------------------------------------------------------

  it('6. issueAccreditation — transitions to issued', async () => {
    const issued = { ...MOCK_ACCREDITATION, status: 'issued' as const, issued_at: new Date() };
    vi.mocked(db.findAccreditation).mockResolvedValue(MOCK_ACCREDITATION);
    vi.mocked(db.updateAccreditation).mockResolvedValue(issued);

    const result = await service.issueAccreditation(ACCRED_ID, USER_ID, db);

    expect(result.status).toBe('issued');
    expect(result.issued_at).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // 7. activateAccreditation
  // -------------------------------------------------------------------------

  it('7. activateAccreditation — transitions issued to active', async () => {
    const active = { ...MOCK_ACCREDITATION, status: 'active' as const };
    vi.mocked(db.findAccreditation).mockResolvedValue(MOCK_ACCREDITATION);
    vi.mocked(db.updateAccreditation).mockResolvedValue(active);

    const result = await service.activateAccreditation(ACCRED_ID, db);

    expect(result.status).toBe('active');
  });

  // -------------------------------------------------------------------------
  // 8. revokeAccreditation
  // -------------------------------------------------------------------------

  it('8. revokeAccreditation — revokes with reason', async () => {
    const revoked = { ...MOCK_ACCREDITATION, status: 'revoked' as const, revoked_at: new Date(), revocation_reason: 'Misconduct' };
    vi.mocked(db.findAccreditation).mockResolvedValue(MOCK_ACCREDITATION);
    vi.mocked(db.updateAccreditation).mockResolvedValue(revoked);

    const result = await service.revokeAccreditation(ACCRED_ID, USER_ID, 'Misconduct', db);

    expect(result.status).toBe('revoked');
    expect(result.revocation_reason).toBe('Misconduct');
  });

  // -------------------------------------------------------------------------
  // 9. scanAccreditation
  // -------------------------------------------------------------------------

  it('9. scanAccreditation — allowed scan for active accreditation', async () => {
    const active = { ...MOCK_ACCREDITATION, status: 'active' as const };
    vi.mocked(db.findAccreditationByQr).mockResolvedValue(active);
    vi.mocked(db.getZonesByIds).mockResolvedValue([{ id: ZONE_ID, name: 'Main Stage' }]);

    const result = await service.scanAccreditation(QR_CODE, [ZONE_ID], new Date(), db);

    expect(result.allowed).toBe(true);
    expect(result.holder_name).toBe('John Doe');
    expect(result.zone_name).toBe('Main Stage');
  });

  it('10. scanAccreditation — denied when accreditation not found', async () => {
    vi.mocked(db.findAccreditationByQr).mockResolvedValue(null);

    const result = await service.scanAccreditation(QR_CODE, [ZONE_ID], new Date(), db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('nebyla nalezena');
  });

  it('11. scanAccreditation — auto-activates on first scan from issued', async () => {
    const issued = { ...MOCK_ACCREDITATION, status: 'issued' as const };
    const activated = { ...issued, status: 'active' as const };
    vi.mocked(db.findAccreditationByQr).mockResolvedValue(issued);
    vi.mocked(db.getZonesByIds).mockResolvedValue([{ id: ZONE_ID, name: 'Main Stage' }]);
    vi.mocked(db.updateAccreditation).mockResolvedValue(activated);

    const result = await service.scanAccreditation(QR_CODE, [ZONE_ID], new Date(), db);

    expect(result.allowed).toBe(true);
    expect(vi.mocked(db.updateAccreditation)).toHaveBeenCalledWith(
      ACCRED_ID,
      expect.objectContaining({ status: 'active' })
    );
  });

  // -------------------------------------------------------------------------
  // 12. listEventAccreditations
  // -------------------------------------------------------------------------

  it('12. listEventAccreditations — returns filtered list', async () => {
    vi.mocked(db.checkOrganizerOwnership).mockResolvedValue(true);
    vi.mocked(db.listByEvent).mockResolvedValue([MOCK_ACCREDITATION]);

    const result = await service.listEventAccreditations(
      EVENT_ID,
      USER_ID,
      { type: 'staff', status: 'approved' },
      db
    );

    expect(result).toHaveLength(1);
    expect(result[0].holder_name).toBe('John Doe');
    expect(vi.mocked(db.listByEvent)).toHaveBeenCalledWith(EVENT_ID, { type: 'staff', status: 'approved' });
  });

  it('13. listEventAccreditations — unauthorized when not organizer', async () => {
    vi.mocked(db.checkOrganizerOwnership).mockResolvedValue(false);

    await expect(
      service.listEventAccreditations(EVENT_ID, USER_ID, undefined, db)
    ).rejects.toThrow(AccreditationUnauthorizedError);
  });

  // -------------------------------------------------------------------------
  // 14. requestAccreditation — press type creates with correct badge color
  // -------------------------------------------------------------------------

  it('14. requestAccreditation — press type generates blue badge color', async () => {
    vi.mocked(db.findByEmail).mockResolvedValue(null);
    const pressAccred = { ...MOCK_ACCREDITATION, accreditation_type: 'press' as const, badge_color: '#3b82f6' };
    vi.mocked(db.createAccreditation).mockResolvedValue(pressAccred);

    const result = await service.requestAccreditation(
      EVENT_ID,
      USER_ID,
      {
        holderName: 'Press Person',
        holderEmail: 'press@media.com',
        accreditationType: 'press',
        zoneAccess: [ZONE_ID],
      },
      db
    );

    expect(result.accreditation_type).toBe('press');
    expect(vi.mocked(db.createAccreditation)).toHaveBeenCalledWith(
      expect.objectContaining({
        accreditation_type: 'press',
        badge_color: '#3b82f6',
      })
    );
  });

  // -------------------------------------------------------------------------
  // 15. requestAccreditation — vip_host type
  // -------------------------------------------------------------------------

  it('15. requestAccreditation — vip_host type generates purple badge', async () => {
    vi.mocked(db.findByEmail).mockResolvedValue(null);
    const vipAccred = { ...MOCK_ACCREDITATION, accreditation_type: 'vip_host' as const, badge_color: '#8b5cf6' };
    vi.mocked(db.createAccreditation).mockResolvedValue(vipAccred);

    const result = await service.requestAccreditation(
      EVENT_ID,
      USER_ID,
      {
        holderName: 'VIP Host',
        holderEmail: 'vip@company.com',
        accreditationType: 'vip_host',
        zoneAccess: [ZONE_ID],
      },
      db
    );

    expect(result.accreditation_type).toBe('vip_host');
    expect(vi.mocked(db.createAccreditation)).toHaveBeenCalledWith(
      expect.objectContaining({
        accreditation_type: 'vip_host',
        badge_color: '#8b5cf6',
      })
    );
  });

  // -------------------------------------------------------------------------
  // 16. requestAccreditation — vendor (sponsor-like) type
  // -------------------------------------------------------------------------

  it('16. requestAccreditation — vendor type with organization', async () => {
    vi.mocked(db.findByEmail).mockResolvedValue(null);
    const vendorAccred = {
      ...MOCK_ACCREDITATION,
      accreditation_type: 'vendor' as const,
      badge_color: '#f97316',
      holder_organization: 'Sponsor Corp',
    };
    vi.mocked(db.createAccreditation).mockResolvedValue(vendorAccred);

    const result = await service.requestAccreditation(
      EVENT_ID,
      USER_ID,
      {
        holderName: 'Vendor Rep',
        holderEmail: 'vendor@sponsor.com',
        accreditationType: 'vendor',
        holderOrganization: 'Sponsor Corp',
        zoneAccess: [ZONE_ID],
      },
      db
    );

    expect(result.holder_organization).toBe('Sponsor Corp');
    expect(vi.mocked(db.createAccreditation)).toHaveBeenCalledWith(
      expect.objectContaining({
        holder_organization: 'Sponsor Corp',
        badge_color: '#f97316',
      })
    );
  });

  // -------------------------------------------------------------------------
  // 17. scanAccreditation — denied for revoked accreditation
  // -------------------------------------------------------------------------

  it('17. scanAccreditation — denied for revoked accreditation with reason', async () => {
    const revoked = { ...MOCK_ACCREDITATION, status: 'revoked' as const, revoked_at: new Date() };
    vi.mocked(db.findAccreditationByQr).mockResolvedValue(revoked);
    vi.mocked(db.getZonesByIds).mockResolvedValue([{ id: ZONE_ID, name: 'Main Stage' }]);

    const result = await service.scanAccreditation(QR_CODE, [ZONE_ID], new Date(), db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('odebrána');
  });

  // -------------------------------------------------------------------------
  // 18. scanAccreditation — denied for requested (not yet approved)
  // -------------------------------------------------------------------------

  it('18. scanAccreditation — denied for requested status', async () => {
    const requested = { ...MOCK_ACCREDITATION, status: 'requested' as const };
    vi.mocked(db.findAccreditationByQr).mockResolvedValue(requested);
    vi.mocked(db.getZonesByIds).mockResolvedValue([{ id: ZONE_ID, name: 'Main Stage' }]);

    const result = await service.scanAccreditation(QR_CODE, [ZONE_ID], new Date(), db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('není aktivní');
  });

  // -------------------------------------------------------------------------
  // 19. scanAccreditation — denied for wrong zone
  // -------------------------------------------------------------------------

  it('19. scanAccreditation — denied when scanned in unauthorized zone', async () => {
    const active = { ...MOCK_ACCREDITATION, status: 'active' as const, zone_access: ['zone-backstage'] };
    vi.mocked(db.findAccreditationByQr).mockResolvedValue(active);
    vi.mocked(db.getZonesByIds).mockResolvedValue([{ id: 'zone-vip', name: 'VIP Lounge' }]);

    const result = await service.scanAccreditation(QR_CODE, ['zone-vip'], new Date(), db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('zóny');
  });

  // -------------------------------------------------------------------------
  // 20. scanAccreditation — denied on wrong day
  // -------------------------------------------------------------------------

  it('20. scanAccreditation — denied when scanned on invalid day', async () => {
    const active = {
      ...MOCK_ACCREDITATION,
      status: 'active' as const,
      valid_days: ['2026-05-01'],
    };
    vi.mocked(db.findAccreditationByQr).mockResolvedValue(active);
    vi.mocked(db.getZonesByIds).mockResolvedValue([{ id: ZONE_ID, name: 'Main Stage' }]);

    const wrongDay = new Date('2026-05-02T14:00:00Z');
    const result = await service.scanAccreditation(QR_CODE, [ZONE_ID], wrongDay, db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('2026-05-02');
  });

  // -------------------------------------------------------------------------
  // 21. Cross-event isolation — event A's accreditations not in event B
  // -------------------------------------------------------------------------

  it('21. Cross-event isolation — listEventAccreditations only returns accreditations for the queried event', async () => {
    const EVENT_A = 'event-aaa';
    const EVENT_B = 'event-bbb';

    const accredA = { ...MOCK_ACCREDITATION, id: 'accred-a', event_id: EVENT_A };
    const accredB = { ...MOCK_ACCREDITATION, id: 'accred-b', event_id: EVENT_B };

    vi.mocked(db.checkOrganizerOwnership).mockResolvedValue(true);

    // Query event A
    vi.mocked(db.listByEvent).mockResolvedValue([accredA]);
    const resultA = await service.listEventAccreditations(EVENT_A, USER_ID, undefined, db);
    expect(resultA).toHaveLength(1);
    expect(resultA[0].event_id).toBe(EVENT_A);
    expect(vi.mocked(db.listByEvent)).toHaveBeenCalledWith(EVENT_A, undefined);

    // Query event B
    vi.mocked(db.listByEvent).mockResolvedValue([accredB]);
    const resultB = await service.listEventAccreditations(EVENT_B, USER_ID, undefined, db);
    expect(resultB).toHaveLength(1);
    expect(resultB[0].event_id).toBe(EVENT_B);
    expect(vi.mocked(db.listByEvent)).toHaveBeenCalledWith(EVENT_B, undefined);
  });

  // -------------------------------------------------------------------------
  // 22. revokeAccreditation — not found
  // -------------------------------------------------------------------------

  it('22. revokeAccreditation — throws when accreditation not found', async () => {
    vi.mocked(db.findAccreditation).mockResolvedValue(null);

    await expect(
      service.revokeAccreditation('nonexistent', USER_ID, 'Reason', db)
    ).rejects.toThrow(AccreditationNotFoundError);
  });

  // -------------------------------------------------------------------------
  // 23. issueAccreditation — not found
  // -------------------------------------------------------------------------

  it('23. issueAccreditation — throws when accreditation not found', async () => {
    vi.mocked(db.findAccreditation).mockResolvedValue(null);

    await expect(
      service.issueAccreditation('nonexistent', USER_ID, db)
    ).rejects.toThrow(AccreditationNotFoundError);
  });

  // -------------------------------------------------------------------------
  // 24. listEventAccreditations — with status filter only
  // -------------------------------------------------------------------------

  it('24. listEventAccreditations — filters by status only', async () => {
    const approved1 = { ...MOCK_ACCREDITATION, id: 'a1', status: 'approved' as const };
    const approved2 = { ...MOCK_ACCREDITATION, id: 'a2', status: 'approved' as const };

    vi.mocked(db.checkOrganizerOwnership).mockResolvedValue(true);
    vi.mocked(db.listByEvent).mockResolvedValue([approved1, approved2]);

    const result = await service.listEventAccreditations(
      EVENT_ID,
      USER_ID,
      { status: 'approved' },
      db
    );

    expect(result).toHaveLength(2);
    expect(vi.mocked(db.listByEvent)).toHaveBeenCalledWith(EVENT_ID, { status: 'approved' });
  });
});
