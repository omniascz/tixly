// ---------------------------------------------------------------------------
// Accreditation Service
// ---------------------------------------------------------------------------

import { randomUUID } from 'crypto';
import {
  getBadgeColor,
  generateAccreditationQr,
  canScanAccreditation,
  validateAccreditationRequest,
} from '../lib/accreditation-validator';
import {
  AccreditationDuplicateError,
  AccreditationNotFoundError,
  AccreditationUnauthorizedError,
} from '../types/accreditation.types';
import type {
  Accreditation,
  AccreditationScanResult,
  AccreditationStatus,
  AccreditationType,
} from '../types/accreditation.types';

// ---------------------------------------------------------------------------
// DB Adapter interface — implement with your real DB (Prisma, Drizzle, etc.)
// ---------------------------------------------------------------------------

export interface AccreditationDbAdapter {
  findAccreditation(id: string): Promise<Accreditation | null>;
  findAccreditationByQr(qrCode: string): Promise<Accreditation | null>;
  findByEmail(eventId: string, email: string): Promise<Accreditation | null>;
  createAccreditation(data: Omit<Accreditation, 'id' | 'created_at'>): Promise<Accreditation>;
  updateAccreditation(id: string, data: Partial<Accreditation>): Promise<Accreditation>;
  listByEvent(
    eventId: string,
    filters?: { type?: AccreditationType; status?: AccreditationStatus }
  ): Promise<Accreditation[]>;
  checkOrganizerOwnership(eventId: string, userId: string): Promise<boolean>;
  getZonesByIds(zoneIds: string[]): Promise<Array<{ id: string; name: string }>>;
}

// ---------------------------------------------------------------------------
// AccreditationService
// ---------------------------------------------------------------------------

export class AccreditationService {
  // -------------------------------------------------------------------------
  // requestAccreditation
  // Creates a new accreditation request for an event. Checks for duplicates
  // by email within the same event.
  // -------------------------------------------------------------------------
  async requestAccreditation(
    eventId: string,
    requestedByUserId: string,
    data: {
      holderName: string;
      holderEmail: string;
      holderPhone?: string;
      holderOrganization?: string;
      accreditationType: AccreditationType;
      roleDescription?: string;
      zoneAccess: string[];
      validDays?: string[];
      notes?: string;
    },
    db: AccreditationDbAdapter
  ): Promise<Accreditation> {
    validateAccreditationRequest({
      holderName: data.holderName,
      holderEmail: data.holderEmail,
      accreditationType: data.accreditationType,
      zoneAccess: data.zoneAccess,
    });

    const existing = await db.findByEmail(eventId, data.holderEmail);
    if (existing !== null) {
      throw new AccreditationDuplicateError(data.holderEmail, eventId);
    }

    const id = randomUUID();
    const qrCode = generateAccreditationQr(id);
    const badgeColor = getBadgeColor(data.accreditationType);

    return db.createAccreditation({
      event_id: eventId,
      holder_name: data.holderName,
      holder_email: data.holderEmail,
      holder_phone: data.holderPhone ?? null,
      holder_organization: data.holderOrganization ?? null,
      accreditation_type: data.accreditationType,
      role_description: data.roleDescription ?? null,
      zone_access: data.zoneAccess,
      valid_days: data.validDays ?? null,
      status: 'requested',
      qr_code: qrCode,
      badge_color: badgeColor,
      photo_url: null,
      requested_by_user_id: requestedByUserId,
      approved_by_user_id: null,
      issued_at: null,
      approved_at: null,
      rejected_at: null,
      revoked_at: null,
      revocation_reason: null,
      notes: data.notes ?? null,
    });
  }

  // -------------------------------------------------------------------------
  // approveAccreditation
  // Transitions status from 'requested' to 'approved'.
  // -------------------------------------------------------------------------
  async approveAccreditation(
    accreditationId: string,
    approvedByUserId: string,
    db: AccreditationDbAdapter
  ): Promise<Accreditation> {
    const acc = await db.findAccreditation(accreditationId);
    if (!acc) {
      throw new AccreditationNotFoundError(accreditationId);
    }

    return db.updateAccreditation(accreditationId, {
      status: 'approved',
      approved_by_user_id: approvedByUserId,
      approved_at: new Date(),
    });
  }

  // -------------------------------------------------------------------------
  // rejectAccreditation
  // Transitions status from 'requested' to 'rejected'.
  // -------------------------------------------------------------------------
  async rejectAccreditation(
    accreditationId: string,
    _userId: string,
    reason: string,
    db: AccreditationDbAdapter
  ): Promise<Accreditation> {
    const acc = await db.findAccreditation(accreditationId);
    if (!acc) {
      throw new AccreditationNotFoundError(accreditationId);
    }

    return db.updateAccreditation(accreditationId, {
      status: 'rejected',
      revocation_reason: reason,
      rejected_at: new Date(),
    });
  }

  // -------------------------------------------------------------------------
  // issueAccreditation
  // Transitions status from 'approved' to 'issued' — the physical badge has
  // been printed and handed out.
  // -------------------------------------------------------------------------
  async issueAccreditation(
    accreditationId: string,
    _userId: string,
    db: AccreditationDbAdapter
  ): Promise<Accreditation> {
    const acc = await db.findAccreditation(accreditationId);
    if (!acc) {
      throw new AccreditationNotFoundError(accreditationId);
    }

    return db.updateAccreditation(accreditationId, {
      status: 'issued',
      issued_at: new Date(),
    });
  }

  // -------------------------------------------------------------------------
  // activateAccreditation
  // Transitions status from 'issued' to 'active' — triggered on first scan.
  // -------------------------------------------------------------------------
  async activateAccreditation(
    accreditationId: string,
    db: AccreditationDbAdapter
  ): Promise<Accreditation> {
    const acc = await db.findAccreditation(accreditationId);
    if (!acc) {
      throw new AccreditationNotFoundError(accreditationId);
    }

    return db.updateAccreditation(accreditationId, {
      status: 'active',
    });
  }

  // -------------------------------------------------------------------------
  // revokeAccreditation
  // Revokes an accreditation. Can be applied to any active or issued badge.
  // -------------------------------------------------------------------------
  async revokeAccreditation(
    accreditationId: string,
    _userId: string,
    reason: string,
    db: AccreditationDbAdapter
  ): Promise<Accreditation> {
    const acc = await db.findAccreditation(accreditationId);
    if (!acc) {
      throw new AccreditationNotFoundError(accreditationId);
    }

    return db.updateAccreditation(accreditationId, {
      status: 'revoked',
      revoked_at: new Date(),
      revocation_reason: reason,
    });
  }

  // -------------------------------------------------------------------------
  // scanAccreditation
  // Core scan flow. Always resolves with AccreditationScanResult.
  // HTTP 200 in all cases — denial is communicated via `allowed: false`.
  // If the accreditation is in 'issued' state, it is auto-activated on first
  // successful scan.
  // -------------------------------------------------------------------------
  async scanAccreditation(
    qrCode: string,
    zoneIds: string[],
    now: Date,
    db: AccreditationDbAdapter
  ): Promise<AccreditationScanResult> {
    const acc = await db.findAccreditationByQr(qrCode);

    if (!acc) {
      return {
        allowed: false,
        accreditation_id: '',
        holder_name: '',
        accreditation_type: 'staff',
        badge_color: getBadgeColor('staff'),
        zone_name: '',
        valid_today: false,
        reason: 'Akreditace nebyla nalezena.',
      };
    }

    // Resolve zone name for response
    const zones = await db.getZonesByIds(zoneIds);
    const zoneName = zones.length > 0 ? zones[0]!.name : zoneIds[0] ?? '';

    const validToday = acc.valid_days === null
      ? true
      : acc.valid_days.includes(now.toISOString().slice(0, 10));

    const scanCheck = canScanAccreditation(acc, zoneIds, now);

    if (!scanCheck.allowed) {
      return {
        allowed: false,
        accreditation_id: acc.id,
        holder_name: acc.holder_name,
        accreditation_type: acc.accreditation_type,
        badge_color: acc.badge_color,
        zone_name: zoneName,
        valid_today: validToday,
        reason: scanCheck.reason,
      };
    }

    // Auto-activate on first scan if status is 'issued'
    if (acc.status === 'issued') {
      await this.activateAccreditation(acc.id, db);
    }

    return {
      allowed: true,
      accreditation_id: acc.id,
      holder_name: acc.holder_name,
      accreditation_type: acc.accreditation_type,
      badge_color: acc.badge_color,
      zone_name: zoneName,
      valid_today: validToday,
    };
  }

  // -------------------------------------------------------------------------
  // listEventAccreditations
  // Lists accreditations for an event, restricted to the organizer.
  // -------------------------------------------------------------------------
  async listEventAccreditations(
    eventId: string,
    organizerId: string,
    filters: { type?: AccreditationType; status?: AccreditationStatus } | undefined,
    db: AccreditationDbAdapter
  ): Promise<Accreditation[]> {
    const isOwner = await db.checkOrganizerOwnership(eventId, organizerId);
    if (!isOwner) {
      throw new AccreditationUnauthorizedError(organizerId, eventId);
    }

    return db.listByEvent(eventId, filters);
  }
}
