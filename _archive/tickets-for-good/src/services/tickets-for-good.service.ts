import {
  SocialOffer,
  EligibilityApplication,
  SocialTicketIssuance,
  OfferInput,
  ApplyInput,
  OfferStats,
  TicketsForGoodError,
  DbAdapter,
  ServiceDeps,
} from '../types/tickets-for-good.types'

// ── helpers ──────────────────────────────────────────────────────────────────

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1).toLowerCase()
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ── createOffer ───────────────────────────────────────────────────────────────

export async function createOffer(
  input: OfferInput,
  deps: ServiceDeps,
): Promise<SocialOffer> {
  if (input.discountPercent < 0 || input.discountPercent > 100) {
    throw new RangeError('discountPercent must be between 0 and 100')
  }

  const now = deps.now ? deps.now() : new Date()
  const id = generateId()

  await deps.db.execute(
    `INSERT INTO social_offers
      (id, event_id, organizer_id, name, beneficiary_group, verification_method,
       allowed_email_domains, organization_codes, discount_percent, max_tickets,
       max_per_person, issued_count, status, valid_from, valid_until, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      id,
      input.eventId,
      input.organizerId,
      input.name,
      input.beneficiaryGroup,
      input.verificationMethod,
      JSON.stringify(input.allowedEmailDomains ?? []),
      JSON.stringify(input.organizationCodes ?? []),
      input.discountPercent,
      input.maxTickets,
      input.maxPerPerson ?? 2,
      0,
      'draft',
      input.validFrom.toISOString(),
      input.validUntil ? input.validUntil.toISOString() : null,
      now.toISOString(),
    ],
  )

  return {
    id,
    eventId: input.eventId,
    organizerId: input.organizerId,
    name: input.name,
    beneficiaryGroup: input.beneficiaryGroup,
    verificationMethod: input.verificationMethod,
    allowedEmailDomains: input.allowedEmailDomains ?? [],
    organizationCodes: input.organizationCodes ?? [],
    discountPercent: input.discountPercent,
    maxTickets: input.maxTickets,
    maxPerPerson: input.maxPerPerson ?? 2,
    issuedCount: 0,
    status: 'draft',
    validFrom: input.validFrom,
    validUntil: input.validUntil ?? null,
    createdAt: now,
  }
}

// ── activateOffer ─────────────────────────────────────────────────────────────

export async function activateOffer(
  offerId: string,
  organizerId: string,
  deps: ServiceDeps,
): Promise<SocialOffer> {
  const rows = await deps.db.query<SocialOffer>(
    `SELECT * FROM social_offers WHERE id = $1 AND organizer_id = $2`,
    [offerId, organizerId],
  )
  const offer = rows[0]
  if (!offer) throw new TicketsForGoodError('OFFER_NOT_FOUND', `Offer ${offerId} not found`)

  await deps.db.execute(
    `UPDATE social_offers SET status = 'active' WHERE id = $1`,
    [offerId],
  )

  return { ...offer, status: 'active' }
}

// ── applyForEligibility ───────────────────────────────────────────────────────

export async function applyForEligibility(
  input: ApplyInput,
  deps: ServiceDeps,
): Promise<EligibilityApplication> {
  const now = deps.now ? deps.now() : new Date()

  // Load offer
  const offerRows = await deps.db.query<SocialOffer>(
    `SELECT * FROM social_offers WHERE id = $1`,
    [input.offerId],
  )
  const offer = offerRows[0]
  if (!offer) throw new TicketsForGoodError('OFFER_NOT_FOUND', `Offer ${input.offerId} not found`)
  if (offer.status !== 'active') throw new TicketsForGoodError('OFFER_NOT_ACTIVE', `Offer ${input.offerId} is not active`)

  // validFrom / validUntil check
  if (offer.validFrom > now) throw new TicketsForGoodError('OFFER_NOT_ACTIVE', `Offer ${input.offerId} has not started yet`)
  if (offer.validUntil && offer.validUntil < now) throw new TicketsForGoodError('OFFER_NOT_ACTIVE', `Offer ${input.offerId} has ended`)

  // Duplicate check
  const dupRows = await deps.db.query<EligibilityApplication>(
    `SELECT id FROM eligibility_applications WHERE offer_id = $1 AND user_id = $2`,
    [input.offerId, input.userId],
  )
  if (dupRows.length > 0) throw new TicketsForGoodError('ALREADY_APPLIED', `User ${input.userId} already applied for offer ${input.offerId}`)

  // Determine status based on verification method
  let status: EligibilityApplication['status'] = 'pending'

  if (offer.verificationMethod === 'email_domain') {
    if (!input.submittedEmail) {
      throw new TicketsForGoodError('DOMAIN_NOT_ALLOWED', 'Email is required for email_domain verification')
    }
    const domain = emailDomain(input.submittedEmail)
    const allowedDomains: string[] = Array.isArray(offer.allowedEmailDomains)
      ? offer.allowedEmailDomains
      : (JSON.parse(offer.allowedEmailDomains as unknown as string) as string[])
    if (!allowedDomains.includes(domain)) {
      throw new TicketsForGoodError('DOMAIN_NOT_ALLOWED', `Email domain ${domain} is not allowed`)
    }
    status = 'verified'
  } else if (offer.verificationMethod === 'organization_code') {
    if (!input.submittedOrgCode) {
      throw new TicketsForGoodError('CODE_NOT_VALID', 'Organization code is required')
    }
    const orgCodes: string[] = Array.isArray(offer.organizationCodes)
      ? offer.organizationCodes
      : (JSON.parse(offer.organizationCodes as unknown as string) as string[])
    if (!orgCodes.includes(input.submittedOrgCode)) {
      throw new TicketsForGoodError('CODE_NOT_VALID', `Organization code ${input.submittedOrgCode} is not valid`)
    }
    status = 'verified'
  } else if (offer.verificationMethod === 'manual_review') {
    status = 'pending'
  }

  const id = generateId()
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
  const verifiedAt = status === 'verified' ? now : null

  await deps.db.execute(
    `INSERT INTO eligibility_applications
      (id, offer_id, user_id, verification_method, submitted_email, submitted_org_code,
       status, reviewed_by, rejection_reason, applied_at, verified_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      input.offerId,
      input.userId,
      offer.verificationMethod,
      input.submittedEmail ?? null,
      input.submittedOrgCode ?? null,
      status,
      null,
      null,
      now.toISOString(),
      verifiedAt ? verifiedAt.toISOString() : null,
      expiresAt.toISOString(),
    ],
  )

  return {
    id,
    offerId: input.offerId,
    userId: input.userId,
    verificationMethod: offer.verificationMethod,
    submittedEmail: input.submittedEmail ?? null,
    submittedOrgCode: input.submittedOrgCode ?? null,
    status,
    reviewedBy: null,
    rejectionReason: null,
    appliedAt: now,
    verifiedAt,
    expiresAt,
  }
}

// ── approveApplication ────────────────────────────────────────────────────────

export async function approveApplication(
  applicationId: string,
  reviewerId: string,
  deps: ServiceDeps,
): Promise<EligibilityApplication> {
  const now = deps.now ? deps.now() : new Date()

  const rows = await deps.db.query<EligibilityApplication>(
    `SELECT * FROM eligibility_applications WHERE id = $1`,
    [applicationId],
  )
  const app = rows[0]
  if (!app) throw new TicketsForGoodError('APPLICATION_NOT_FOUND', `Application ${applicationId} not found`)

  await deps.db.execute(
    `UPDATE eligibility_applications SET status = 'verified', reviewed_by = $1, verified_at = $2 WHERE id = $3`,
    [reviewerId, now.toISOString(), applicationId],
  )

  return { ...app, status: 'verified', reviewedBy: reviewerId, verifiedAt: now }
}

// ── rejectApplication ─────────────────────────────────────────────────────────

export async function rejectApplication(
  applicationId: string,
  reviewerId: string,
  reason: string,
  deps: ServiceDeps,
): Promise<EligibilityApplication> {
  const rows = await deps.db.query<EligibilityApplication>(
    `SELECT * FROM eligibility_applications WHERE id = $1`,
    [applicationId],
  )
  const app = rows[0]
  if (!app) throw new TicketsForGoodError('APPLICATION_NOT_FOUND', `Application ${applicationId} not found`)

  await deps.db.execute(
    `UPDATE eligibility_applications SET status = 'rejected', reviewed_by = $1, rejection_reason = $2 WHERE id = $3`,
    [reviewerId, reason, applicationId],
  )

  return { ...app, status: 'rejected', reviewedBy: reviewerId, rejectionReason: reason }
}

// ── issueSocialTicket ─────────────────────────────────────────────────────────

export async function issueSocialTicket(
  applicationId: string,
  ticketId: string,
  originalPriceCzk: number,
  deps: ServiceDeps,
): Promise<SocialTicketIssuance> {
  const now = deps.now ? deps.now() : new Date()

  // Load application
  const appRows = await deps.db.query<EligibilityApplication>(
    `SELECT * FROM eligibility_applications WHERE id = $1`,
    [applicationId],
  )
  const app = appRows[0]
  if (!app) throw new TicketsForGoodError('APPLICATION_NOT_FOUND', `Application ${applicationId} not found`)
  if (app.status !== 'verified') throw new TicketsForGoodError('APPLICATION_NOT_VERIFIED', `Application ${applicationId} is not verified`)
  if (app.expiresAt < now) throw new TicketsForGoodError('APPLICATION_NOT_VERIFIED', `Application ${applicationId} has expired`)

  // Load offer
  const offerRows = await deps.db.query<SocialOffer>(
    `SELECT * FROM social_offers WHERE id = $1`,
    [app.offerId],
  )
  const offer = offerRows[0]
  if (!offer) throw new TicketsForGoodError('OFFER_NOT_FOUND', `Offer ${app.offerId} not found`)
  if (offer.status === 'exhausted') throw new TicketsForGoodError('OFFER_EXHAUSTED', `Offer ${app.offerId} is exhausted`)

  // Check maxPerPerson
  const issuedRows = await deps.db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM social_ticket_issuances WHERE offer_id = $1 AND user_id = $2`,
    [offer.id, app.userId],
  )
  const issuedForUser = Number(issuedRows[0]?.count ?? 0)
  if (issuedForUser >= offer.maxPerPerson) {
    throw new TicketsForGoodError('MAX_PER_PERSON_EXCEEDED', `User ${app.userId} has already received the maximum number of tickets for this offer`)
  }

  const discountCzk = Math.round(originalPriceCzk * offer.discountPercent / 100)
  const finalPriceCzk = originalPriceCzk - discountCzk
  const id = generateId()

  const issuance = await deps.db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO social_ticket_issuances
        (id, application_id, offer_id, user_id, ticket_id, original_price_czk, discount_czk, final_price_czk, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, applicationId, offer.id, app.userId, ticketId, originalPriceCzk, discountCzk, finalPriceCzk, now.toISOString()],
    )

    const newCount = offer.issuedCount + 1
    if (newCount >= offer.maxTickets) {
      await tx.execute(
        `UPDATE social_offers SET issued_count = $1, status = 'exhausted' WHERE id = $2`,
        [newCount, offer.id],
      )
    } else {
      await tx.execute(
        `UPDATE social_offers SET issued_count = $1 WHERE id = $2`,
        [newCount, offer.id],
      )
    }

    return {
      id,
      applicationId,
      offerId: offer.id,
      userId: app.userId,
      ticketId,
      originalPriceCzk,
      discountCzk,
      finalPriceCzk,
      issuedAt: now,
    } satisfies SocialTicketIssuance
  })

  return issuance
}

// ── getOfferStats ─────────────────────────────────────────────────────────────

export async function getOfferStats(
  offerId: string,
  deps: ServiceDeps,
): Promise<OfferStats> {
  const offerRows = await deps.db.query<SocialOffer>(
    `SELECT * FROM social_offers WHERE id = $1`,
    [offerId],
  )
  const offer = offerRows[0]
  if (!offer) throw new TicketsForGoodError('OFFER_NOT_FOUND', `Offer ${offerId} not found`)

  const statsRows = await deps.db.query<{ total_discount: number; unique_users: number }>(
    `SELECT COALESCE(SUM(discount_czk), 0) as total_discount, COUNT(DISTINCT user_id) as unique_users
     FROM social_ticket_issuances WHERE offer_id = $1`,
    [offerId],
  )
  const stats = statsRows[0]

  return {
    offerId,
    issuedCount: offer.issuedCount,
    remaining: offer.maxTickets - offer.issuedCount,
    totalDiscountGivenCzk: Number(stats?.total_discount ?? 0),
    uniqueBeneficiaries: Number(stats?.unique_users ?? 0),
  }
}

// ── listActiveOffersForEvent ──────────────────────────────────────────────────

export async function listActiveOffersForEvent(
  eventId: string,
  deps: ServiceDeps,
): Promise<SocialOffer[]> {
  const now = deps.now ? deps.now() : new Date()

  const rows = await deps.db.query<SocialOffer>(
    `SELECT * FROM social_offers
     WHERE event_id = $1
       AND status = 'active'
       AND valid_from <= $2
       AND (valid_until IS NULL OR valid_until >= $2)`,
    [eventId, now.toISOString()],
  )

  return rows
}
