import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createOffer,
  activateOffer,
  applyForEligibility,
  approveApplication,
  rejectApplication,
  issueSocialTicket,
  getOfferStats,
  listActiveOffersForEvent,
} from '../services/tickets-for-good.service'
import {
  SocialOffer,
  EligibilityApplication,
  TicketsForGoodError,
  DbAdapter,
  ServiceDeps,
} from '../types/tickets-for-good.types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-04-15T10:00:00Z')

function makeOffer(overrides: Partial<SocialOffer> = {}): SocialOffer {
  return {
    id: 'offer-1',
    eventId: 'event-1',
    organizerId: 'org-1',
    name: 'Healthcare Discount',
    beneficiaryGroup: 'healthcare',
    verificationMethod: 'email_domain',
    allowedEmailDomains: ['fnmotol.cz', 'vfn.cz'],
    organizationCodes: [],
    discountPercent: 50,
    maxTickets: 100,
    maxPerPerson: 2,
    issuedCount: 0,
    status: 'active',
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validUntil: null,
    createdAt: FIXED_NOW,
    ...overrides,
  }
}

function makeApplication(overrides: Partial<EligibilityApplication> = {}): EligibilityApplication {
  return {
    id: 'app-1',
    offerId: 'offer-1',
    userId: 'user-1',
    verificationMethod: 'email_domain',
    submittedEmail: 'doktor@fnmotol.cz',
    submittedOrgCode: null,
    status: 'verified',
    reviewedBy: null,
    rejectionReason: null,
    appliedAt: FIXED_NOW,
    verifiedAt: FIXED_NOW,
    expiresAt: new Date(FIXED_NOW.getTime() + 365 * 24 * 60 * 60 * 1000),
    ...overrides,
  }
}

// ── DbAdapter mock factory ────────────────────────────────────────────────────

function makeDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn) => fn(makeDb())),
    ...overrides,
  }
}

function makeDeps(db: DbAdapter, now = FIXED_NOW): ServiceDeps {
  return { db, now: () => now }
}

// ── createOffer ───────────────────────────────────────────────────────────────

describe('createOffer', () => {
  it('inserts offer with status draft and returns it', async () => {
    const db = makeDb()
    const deps = makeDeps(db)

    const result = await createOffer({
      eventId: 'event-1',
      organizerId: 'org-1',
      name: 'Healthcare Discount',
      beneficiaryGroup: 'healthcare',
      verificationMethod: 'email_domain',
      allowedEmailDomains: ['fnmotol.cz'],
      discountPercent: 50,
      maxTickets: 100,
      validFrom: new Date('2026-01-01T00:00:00Z'),
    }, deps)

    expect(result.status).toBe('draft')
    expect(result.discountPercent).toBe(50)
    expect(result.issuedCount).toBe(0)
    expect(result.maxPerPerson).toBe(2) // default
    expect(db.execute).toHaveBeenCalledOnce()
  })

  it('throws RangeError when discountPercent is below 0', async () => {
    const db = makeDb()
    const deps = makeDeps(db)

    await expect(createOffer({
      eventId: 'event-1',
      organizerId: 'org-1',
      name: 'Bad Offer',
      beneficiaryGroup: 'teachers',
      verificationMethod: 'manual_review',
      discountPercent: -1,
      maxTickets: 10,
      validFrom: new Date(),
    }, deps)).rejects.toThrow(RangeError)
  })

  it('throws RangeError when discountPercent is above 100', async () => {
    const db = makeDb()
    const deps = makeDeps(db)

    await expect(createOffer({
      eventId: 'event-1',
      organizerId: 'org-1',
      name: 'Bad Offer',
      beneficiaryGroup: 'volunteers',
      verificationMethod: 'manual_review',
      discountPercent: 101,
      maxTickets: 10,
      validFrom: new Date(),
    }, deps)).rejects.toThrow(RangeError)
  })

  it('accepts discountPercent = 100 (free tickets)', async () => {
    const db = makeDb()
    const deps = makeDeps(db)

    const result = await createOffer({
      eventId: 'event-1',
      organizerId: 'org-1',
      name: 'Free for Volunteers',
      beneficiaryGroup: 'volunteers',
      verificationMethod: 'organization_code',
      organizationCodes: ['VOL2026'],
      discountPercent: 100,
      maxTickets: 50,
      validFrom: new Date(),
    }, deps)

    expect(result.discountPercent).toBe(100)
    expect(result.status).toBe('draft')
  })

  it('uses provided maxPerPerson instead of default', async () => {
    const db = makeDb()
    const deps = makeDeps(db)

    const result = await createOffer({
      eventId: 'event-1',
      organizerId: 'org-1',
      name: 'Teachers',
      beneficiaryGroup: 'teachers',
      verificationMethod: 'email_domain',
      allowedEmailDomains: ['skola.cz'],
      discountPercent: 30,
      maxTickets: 20,
      maxPerPerson: 4,
      validFrom: new Date(),
    }, deps)

    expect(result.maxPerPerson).toBe(4)
  })
})

// ── activateOffer ─────────────────────────────────────────────────────────────

describe('activateOffer', () => {
  it('changes offer status from draft to active', async () => {
    const offer = makeOffer({ status: 'draft' })
    const db = makeDb({
      query: vi.fn(async () => [offer]),
    })
    const deps = makeDeps(db)

    const result = await activateOffer('offer-1', 'org-1', deps)

    expect(result.status).toBe('active')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE social_offers'),
      expect.arrayContaining(['offer-1']),
    )
  })

  it('throws OFFER_NOT_FOUND when offer does not exist', async () => {
    const db = makeDb({ query: vi.fn(async () => []) })
    const deps = makeDeps(db)

    await expect(activateOffer('no-such-offer', 'org-1', deps))
      .rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' })
  })

  it('throws OFFER_NOT_FOUND when organizerId does not match', async () => {
    const db = makeDb({ query: vi.fn(async () => []) })
    const deps = makeDeps(db)

    await expect(activateOffer('offer-1', 'wrong-org', deps))
      .rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' })
  })
})

// ── applyForEligibility ───────────────────────────────────────────────────────

describe('applyForEligibility — email_domain', () => {
  it('auto-verifies when email domain is in allowedEmailDomains', async () => {
    const offer = makeOffer({ verificationMethod: 'email_domain', allowedEmailDomains: ['fnmotol.cz', 'vfn.cz'] })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([offer])   // offer lookup
        .mockResolvedValueOnce([]),       // duplicate check
    })
    const deps = makeDeps(db)

    const result = await applyForEligibility({
      offerId: 'offer-1',
      userId: 'user-1',
      submittedEmail: 'doktor@fnmotol.cz',
    }, deps)

    expect(result.status).toBe('verified')
    expect(result.verifiedAt).toEqual(FIXED_NOW)
  })

  it('throws DOMAIN_NOT_ALLOWED when email domain is not in the list', async () => {
    const offer = makeOffer({ verificationMethod: 'email_domain', allowedEmailDomains: ['fnmotol.cz'] })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([offer])
        .mockResolvedValueOnce([]),
    })
    const deps = makeDeps(db)

    await expect(applyForEligibility({
      offerId: 'offer-1',
      userId: 'user-1',
      submittedEmail: 'hacker@gmail.com',
    }, deps)).rejects.toMatchObject({ code: 'DOMAIN_NOT_ALLOWED' })
  })
})

describe('applyForEligibility — organization_code', () => {
  it('auto-verifies when org code is valid', async () => {
    const offer = makeOffer({ verificationMethod: 'organization_code', organizationCodes: ['VOL2026', 'CHAR42'] })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([offer])
        .mockResolvedValueOnce([]),
    })
    const deps = makeDeps(db)

    const result = await applyForEligibility({
      offerId: 'offer-1',
      userId: 'user-2',
      submittedOrgCode: 'VOL2026',
    }, deps)

    expect(result.status).toBe('verified')
  })

  it('throws CODE_NOT_VALID when org code is not in the list', async () => {
    const offer = makeOffer({ verificationMethod: 'organization_code', organizationCodes: ['VOL2026'] })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([offer])
        .mockResolvedValueOnce([]),
    })
    const deps = makeDeps(db)

    await expect(applyForEligibility({
      offerId: 'offer-1',
      userId: 'user-2',
      submittedOrgCode: 'WRONG',
    }, deps)).rejects.toMatchObject({ code: 'CODE_NOT_VALID' })
  })
})

describe('applyForEligibility — manual_review', () => {
  it('sets status to pending for manual_review method', async () => {
    const offer = makeOffer({ verificationMethod: 'manual_review' })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([offer])
        .mockResolvedValueOnce([]),
    })
    const deps = makeDeps(db)

    const result = await applyForEligibility({
      offerId: 'offer-1',
      userId: 'user-3',
    }, deps)

    expect(result.status).toBe('pending')
    expect(result.verifiedAt).toBeNull()
  })
})

describe('applyForEligibility — guards', () => {
  it('throws ALREADY_APPLIED when user has existing application', async () => {
    const offer = makeOffer()
    const existingApp = makeApplication()
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([offer])
        .mockResolvedValueOnce([existingApp]),
    })
    const deps = makeDeps(db)

    await expect(applyForEligibility({
      offerId: 'offer-1',
      userId: 'user-1',
      submittedEmail: 'doktor@fnmotol.cz',
    }, deps)).rejects.toMatchObject({ code: 'ALREADY_APPLIED' })
  })

  it('throws OFFER_NOT_FOUND when offer does not exist', async () => {
    const db = makeDb({ query: vi.fn(async () => []) })
    const deps = makeDeps(db)

    await expect(applyForEligibility({
      offerId: 'no-offer',
      userId: 'user-1',
    }, deps)).rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' })
  })

  it('throws OFFER_NOT_ACTIVE when offer status is draft', async () => {
    const offer = makeOffer({ status: 'draft' })
    const db = makeDb({ query: vi.fn(async () => [offer]) })
    const deps = makeDeps(db)

    await expect(applyForEligibility({
      offerId: 'offer-1',
      userId: 'user-1',
    }, deps)).rejects.toMatchObject({ code: 'OFFER_NOT_ACTIVE' })
  })

  it('throws OFFER_NOT_ACTIVE when offer validUntil has passed', async () => {
    const offer = makeOffer({ validUntil: new Date('2025-01-01T00:00:00Z') })
    const db = makeDb({ query: vi.fn(async () => [offer]) })
    const deps = makeDeps(db)

    await expect(applyForEligibility({
      offerId: 'offer-1',
      userId: 'user-1',
    }, deps)).rejects.toMatchObject({ code: 'OFFER_NOT_ACTIVE' })
  })
})

// ── approveApplication ────────────────────────────────────────────────────────

describe('approveApplication', () => {
  it('sets status to verified and records reviewerId', async () => {
    const app = makeApplication({ status: 'pending', verifiedAt: null })
    const db = makeDb({ query: vi.fn(async () => [app]) })
    const deps = makeDeps(db)

    const result = await approveApplication('app-1', 'reviewer-99', deps)

    expect(result.status).toBe('verified')
    expect(result.reviewedBy).toBe('reviewer-99')
    expect(result.verifiedAt).toEqual(FIXED_NOW)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('verified'),
      expect.arrayContaining(['reviewer-99']),
    )
  })

  it('throws APPLICATION_NOT_FOUND when application does not exist', async () => {
    const db = makeDb({ query: vi.fn(async () => []) })
    const deps = makeDeps(db)

    await expect(approveApplication('no-app', 'reviewer-1', deps))
      .rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' })
  })
})

// ── rejectApplication ─────────────────────────────────────────────────────────

describe('rejectApplication', () => {
  it('sets status to rejected and records reason', async () => {
    const app = makeApplication({ status: 'pending' })
    const db = makeDb({ query: vi.fn(async () => [app]) })
    const deps = makeDeps(db)

    const result = await rejectApplication('app-1', 'reviewer-1', 'Fake email detected', deps)

    expect(result.status).toBe('rejected')
    expect(result.rejectionReason).toBe('Fake email detected')
    expect(result.reviewedBy).toBe('reviewer-1')
  })

  it('throws APPLICATION_NOT_FOUND when application does not exist', async () => {
    const db = makeDb({ query: vi.fn(async () => []) })
    const deps = makeDeps(db)

    await expect(rejectApplication('no-app', 'reviewer-1', 'reason', deps))
      .rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' })
  })
})

// ── issueSocialTicket ─────────────────────────────────────────────────────────

describe('issueSocialTicket', () => {
  it('issues ticket and calculates discount correctly (50%)', async () => {
    const app = makeApplication()
    const offer = makeOffer({ issuedCount: 0, maxTickets: 100, discountPercent: 50 })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([app])          // application
        .mockResolvedValueOnce([offer])         // offer
        .mockResolvedValueOnce([{ count: 0 }]), // issuances for user
      transaction: vi.fn(async (fn) => fn(makeDb())),
    })
    const deps = makeDeps(db)

    const result = await issueSocialTicket('app-1', 'ticket-99', 1000, deps)

    expect(result.discountCzk).toBe(500)
    expect(result.finalPriceCzk).toBe(500)
    expect(result.originalPriceCzk).toBe(1000)
    expect(result.ticketId).toBe('ticket-99')
    expect(db.transaction).toHaveBeenCalledOnce()
  })

  it('rounds discount correctly for non-integer results', async () => {
    const app = makeApplication()
    const offer = makeOffer({ discountPercent: 33 })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([app])
        .mockResolvedValueOnce([offer])
        .mockResolvedValueOnce([{ count: 0 }]),
      transaction: vi.fn(async (fn) => fn(makeDb())),
    })
    const deps = makeDeps(db)

    const result = await issueSocialTicket('app-1', 'ticket-1', 100, deps)

    // round(100 * 33 / 100) = round(33) = 33
    expect(result.discountCzk).toBe(33)
    expect(result.finalPriceCzk).toBe(67)
  })

  it('throws APPLICATION_NOT_VERIFIED when application is pending', async () => {
    const app = makeApplication({ status: 'pending' })
    const db = makeDb({ query: vi.fn(async () => [app]) })
    const deps = makeDeps(db)

    await expect(issueSocialTicket('app-1', 'ticket-1', 500, deps))
      .rejects.toMatchObject({ code: 'APPLICATION_NOT_VERIFIED' })
  })

  it('throws APPLICATION_NOT_VERIFIED when application is expired', async () => {
    const app = makeApplication({
      status: 'verified',
      expiresAt: new Date('2025-01-01T00:00:00Z'), // past
    })
    const db = makeDb({ query: vi.fn(async () => [app]) })
    const deps = makeDeps(db)

    await expect(issueSocialTicket('app-1', 'ticket-1', 500, deps))
      .rejects.toMatchObject({ code: 'APPLICATION_NOT_VERIFIED' })
  })

  it('throws MAX_PER_PERSON_EXCEEDED when user has reached the limit', async () => {
    const app = makeApplication()
    const offer = makeOffer({ maxPerPerson: 2 })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([app])
        .mockResolvedValueOnce([offer])
        .mockResolvedValueOnce([{ count: 2 }]), // already issued 2
    })
    const deps = makeDeps(db)

    await expect(issueSocialTicket('app-1', 'ticket-1', 500, deps))
      .rejects.toMatchObject({ code: 'MAX_PER_PERSON_EXCEEDED' })
  })

  it('transitions offer to exhausted when last ticket is issued', async () => {
    const app = makeApplication()
    const offer = makeOffer({ issuedCount: 99, maxTickets: 100 })
    const innerDb = makeDb()
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([app])
        .mockResolvedValueOnce([offer])
        .mockResolvedValueOnce([{ count: 0 }]),
      transaction: vi.fn(async (fn) => fn(innerDb)),
    })
    const deps = makeDeps(db)

    await issueSocialTicket('app-1', 'ticket-last', 200, deps)

    // The inner execute should have been called with 'exhausted'
    const executeCalls = (innerDb.execute as ReturnType<typeof vi.fn>).mock.calls
    const exhaustedCall = executeCalls.find((args: unknown[]) =>
      typeof args[0] === 'string' && args[0].includes('exhausted')
    )
    expect(exhaustedCall).toBeDefined()
  })

  it('throws OFFER_EXHAUSTED when offer is already exhausted', async () => {
    const app = makeApplication()
    const offer = makeOffer({ status: 'exhausted', issuedCount: 100, maxTickets: 100 })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([app])
        .mockResolvedValueOnce([offer]),
    })
    const deps = makeDeps(db)

    await expect(issueSocialTicket('app-1', 'ticket-1', 500, deps))
      .rejects.toMatchObject({ code: 'OFFER_EXHAUSTED' })
  })

  it('throws APPLICATION_NOT_FOUND when application does not exist', async () => {
    const db = makeDb({ query: vi.fn(async () => []) })
    const deps = makeDeps(db)

    await expect(issueSocialTicket('no-app', 'ticket-1', 500, deps))
      .rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' })
  })
})

// ── getOfferStats ─────────────────────────────────────────────────────────────

describe('getOfferStats', () => {
  it('returns correct stats for an offer with issuances', async () => {
    const offer = makeOffer({ issuedCount: 10, maxTickets: 100 })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([offer])
        .mockResolvedValueOnce([{ total_discount: 5000, unique_users: 8 }]),
    })
    const deps = makeDeps(db)

    const stats = await getOfferStats('offer-1', deps)

    expect(stats.offerId).toBe('offer-1')
    expect(stats.issuedCount).toBe(10)
    expect(stats.remaining).toBe(90)
    expect(stats.totalDiscountGivenCzk).toBe(5000)
    expect(stats.uniqueBeneficiaries).toBe(8)
  })

  it('throws OFFER_NOT_FOUND when offer does not exist', async () => {
    const db = makeDb({ query: vi.fn(async () => []) })
    const deps = makeDeps(db)

    await expect(getOfferStats('no-offer', deps))
      .rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' })
  })
})

// ── listActiveOffersForEvent ──────────────────────────────────────────────────

describe('listActiveOffersForEvent', () => {
  it('returns active non-expired offers for the event', async () => {
    const offer1 = makeOffer({ id: 'offer-1' })
    const offer2 = makeOffer({ id: 'offer-2', beneficiaryGroup: 'teachers' })
    const db = makeDb({ query: vi.fn(async () => [offer1, offer2]) })
    const deps = makeDeps(db)

    const results = await listActiveOffersForEvent('event-1', deps)

    expect(results).toHaveLength(2)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      expect.arrayContaining(['event-1']),
    )
  })

  it('returns empty array when no active offers exist', async () => {
    const db = makeDb({ query: vi.fn(async () => []) })
    const deps = makeDeps(db)

    const results = await listActiveOffersForEvent('event-no-offers', deps)

    expect(results).toHaveLength(0)
  })

  it('passes current timestamp for date filtering', async () => {
    const db = makeDb({ query: vi.fn(async () => []) })
    const deps = makeDeps(db)

    await listActiveOffersForEvent('event-1', deps)

    const queryParams = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][1] as unknown[]
    // params[1] should be the ISO string of FIXED_NOW
    expect(queryParams[1]).toBe(FIXED_NOW.toISOString())
  })
})
