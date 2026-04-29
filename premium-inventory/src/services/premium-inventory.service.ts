import {
  PremiumTier,
  PremiumSeat,
  TierInput,
  AddSeatsInput,
  PurchaseInput,
  TierStats,
  PremiumInventoryError,
  ServiceDeps,
} from '../types/premium-inventory.types'

export async function createPremiumTier(
  input: TierInput,
  deps: ServiceDeps,
): Promise<PremiumTier> {
  if (input.multiplier < 1.1) {
    throw new PremiumInventoryError(
      'INVALID_MULTIPLIER',
      `Multiplier must be >= 1.1, got ${input.multiplier}`,
    )
  }

  const now = new Date()
  const id = `tier-${Date.now()}-${Math.random().toString(36).slice(2)}`

  await deps.db.execute(
    `INSERT INTO premium_tiers
      (id, event_id, organizer_id, name, description, multiplier, status, max_seats, available_seats, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      input.eventId,
      input.organizerId,
      input.name,
      input.description,
      input.multiplier,
      'draft',
      input.maxSeats,
      input.maxSeats,
      now,
      now,
    ],
  )

  const rows = await deps.db.query<PremiumTier>(
    `SELECT * FROM premium_tiers WHERE id = $1`,
    [id],
  )

  const tier = rows[0]
  if (!tier) {
    throw new PremiumInventoryError('TIER_NOT_FOUND', `Tier ${id} not found after insert`)
  }
  return tier
}

export async function activateTier(
  tierId: string,
  organizerId: string,
  deps: ServiceDeps,
): Promise<PremiumTier> {
  const rows = await deps.db.query<PremiumTier>(
    `SELECT * FROM premium_tiers WHERE id = $1`,
    [tierId],
  )
  const tier = rows[0]

  if (!tier) {
    throw new PremiumInventoryError('TIER_NOT_FOUND', `Tier ${tierId} not found`)
  }

  if (tier.organizerId !== organizerId) {
    throw new PremiumInventoryError(
      'ORGANIZER_NOT_AUTHORIZED',
      `Organizer ${organizerId} does not own tier ${tierId}`,
    )
  }

  const now = new Date()
  await deps.db.execute(
    `UPDATE premium_tiers SET status = $1, updated_at = $2 WHERE id = $3`,
    ['active', now, tierId],
  )

  return { ...tier, status: 'active', updatedAt: now }
}

export async function pauseTier(
  tierId: string,
  organizerId: string,
  deps: ServiceDeps,
): Promise<PremiumTier> {
  const rows = await deps.db.query<PremiumTier>(
    `SELECT * FROM premium_tiers WHERE id = $1`,
    [tierId],
  )
  const tier = rows[0]

  if (!tier) {
    throw new PremiumInventoryError('TIER_NOT_FOUND', `Tier ${tierId} not found`)
  }

  if (tier.organizerId !== organizerId) {
    throw new PremiumInventoryError(
      'ORGANIZER_NOT_AUTHORIZED',
      `Organizer ${organizerId} does not own tier ${tierId}`,
    )
  }

  const now = new Date()
  await deps.db.execute(
    `UPDATE premium_tiers SET status = $1, updated_at = $2 WHERE id = $3`,
    ['paused', now, tierId],
  )

  return { ...tier, status: 'paused', updatedAt: now }
}

export async function addSeatsToTier(
  input: AddSeatsInput,
  deps: ServiceDeps,
): Promise<PremiumSeat[]> {
  const tierRows = await deps.db.query<PremiumTier>(
    `SELECT * FROM premium_tiers WHERE id = $1`,
    [input.tierId],
  )
  const tier = tierRows[0]

  if (!tier) {
    throw new PremiumInventoryError('TIER_NOT_FOUND', `Tier ${input.tierId} not found`)
  }

  const insertedSeats: PremiumSeat[] = []
  const now = new Date()

  for (const seat of input.seats) {
    const seatId = `seat-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const premiumPriceCzk = Math.round(seat.faceValueCzk * tier.multiplier)

    await deps.db.execute(
      `INSERT INTO premium_seats
        (id, tier_id, event_id, seat_id, section, row, number, face_value_czk, premium_price_czk, is_purchased, purchased_at, purchased_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        seatId,
        input.tierId,
        tier.eventId,
        seat.seatId,
        seat.section,
        seat.row,
        seat.number,
        seat.faceValueCzk,
        premiumPriceCzk,
        false,
        null,
        null,
      ],
    )

    insertedSeats.push({
      id: seatId,
      tierId: input.tierId,
      eventId: tier.eventId,
      seatId: seat.seatId,
      section: seat.section,
      row: seat.row,
      number: seat.number,
      faceValueCzk: seat.faceValueCzk,
      premiumPriceCzk,
      isPurchased: false,
      purchasedAt: null,
      purchasedByUserId: null,
    })
  }

  // Update tier maxSeats
  const newMaxSeats = tier.maxSeats + input.seats.length
  await deps.db.execute(
    `UPDATE premium_tiers SET max_seats = $1, updated_at = $2 WHERE id = $3`,
    [newMaxSeats, now, input.tierId],
  )

  return insertedSeats
}

export async function purchasePremiumSeat(
  input: PurchaseInput,
  deps: ServiceDeps,
): Promise<PremiumSeat> {
  return deps.db.transaction(async (txDb) => {
    const tierRows = await txDb.query<PremiumTier>(
      `SELECT * FROM premium_tiers WHERE id = $1`,
      [input.tierId],
    )
    const tier = tierRows[0]

    if (!tier) {
      throw new PremiumInventoryError('TIER_NOT_FOUND', `Tier ${input.tierId} not found`)
    }

    if (tier.status !== 'active') {
      throw new PremiumInventoryError(
        'TIER_NOT_ACTIVE',
        `Tier ${input.tierId} is not active (status: ${tier.status})`,
      )
    }

    const seatRows = await txDb.query<PremiumSeat>(
      `SELECT * FROM premium_seats WHERE seat_id = $1 AND tier_id = $2`,
      [input.seatId, input.tierId],
    )
    const seat = seatRows[0]

    if (!seat) {
      throw new PremiumInventoryError('SEAT_NOT_FOUND', `Seat ${input.seatId} not found in tier ${input.tierId}`)
    }

    if (seat.isPurchased) {
      throw new PremiumInventoryError(
        'SEAT_ALREADY_PURCHASED',
        `Seat ${input.seatId} has already been purchased`,
      )
    }

    const now = new Date()
    await txDb.execute(
      `UPDATE premium_seats SET is_purchased = $1, purchased_at = $2, purchased_by_user_id = $3 WHERE id = $4`,
      [true, now, input.userId, seat.id],
    )

    await txDb.execute(
      `UPDATE premium_tiers SET available_seats = available_seats - 1, updated_at = $1 WHERE id = $2`,
      [now, input.tierId],
    )

    return {
      ...seat,
      isPurchased: true,
      purchasedAt: now,
      purchasedByUserId: input.userId,
    }
  })
}

export async function getAvailablePremiumSeats(
  tierId: string,
  deps: ServiceDeps,
): Promise<PremiumSeat[]> {
  return deps.db.query<PremiumSeat>(
    `SELECT * FROM premium_seats WHERE tier_id = $1 AND is_purchased = false`,
    [tierId],
  )
}

export async function getPremiumTierStats(
  tierId: string,
  deps: ServiceDeps,
): Promise<TierStats> {
  const allSeats = await deps.db.query<PremiumSeat>(
    `SELECT * FROM premium_seats WHERE tier_id = $1`,
    [tierId],
  )

  const totalSeats = allSeats.length
  const soldSeats = allSeats.filter((s) => s.isPurchased).length
  const availableSeats = totalSeats - soldSeats
  const revenue = allSeats
    .filter((s) => s.isPurchased)
    .reduce((sum, s) => sum + s.premiumPriceCzk, 0)
  const sellThroughRate = totalSeats === 0 ? 0 : soldSeats / totalSeats

  return {
    tierId,
    totalSeats,
    soldSeats,
    availableSeats,
    revenue,
    sellThroughRate,
  }
}
