import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DbAdapter, PremiumTier, PremiumSeat } from '../types/premium-inventory.types'
import { PremiumInventoryError } from '../types/premium-inventory.types'
import {
  createPremiumTier,
  activateTier,
  pauseTier,
  addSeatsToTier,
  purchasePremiumSeat,
  getAvailablePremiumSeats,
  getPremiumTierStats,
} from '../services/premium-inventory.service'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTier(overrides: Partial<PremiumTier> = {}): PremiumTier {
  return {
    id: 'tier-1',
    eventId: 'event-1',
    organizerId: 'org-1',
    name: 'VIP Front Row',
    description: 'Best seats in the house',
    multiplier: 1.5,
    status: 'draft',
    maxSeats: 10,
    availableSeats: 10,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function makeSeat(overrides: Partial<PremiumSeat> = {}): PremiumSeat {
  return {
    id: 'pseat-1',
    tierId: 'tier-1',
    eventId: 'event-1',
    seatId: 'seat-abc',
    section: 'A',
    row: '1',
    number: '5',
    faceValueCzk: 1000,
    premiumPriceCzk: 1500,
    isPurchased: false,
    purchasedAt: null,
    purchasedByUserId: null,
    ...overrides,
  }
}

function makeDb(tierResult: PremiumTier | null, seatResults: PremiumSeat[] = []): DbAdapter {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('premium_tiers')) {
        return tierResult ? [tierResult] : []
      }
      if (sql.includes('premium_seats')) {
        return seatResults
      }
      return []
    }),
    execute: vi.fn(async () => {}),
    transaction: vi.fn(async (fn) => {
      const txDb: DbAdapter = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('premium_tiers')) {
            return tierResult ? [tierResult] : []
          }
          if (sql.includes('premium_seats')) {
            return seatResults
          }
          return []
        }),
        execute: vi.fn(async () => {}),
        transaction: vi.fn(),
      }
      return fn(txDb)
    }),
  }
}

// ── createPremiumTier ──────────────────────────────────────────────────────

describe('createPremiumTier', () => {
  it('creates a tier with status draft when multiplier is valid (1.5)', async () => {
    const tier = makeTier({ status: 'draft' })
    const db = makeDb(tier)

    const result = await createPremiumTier(
      {
        eventId: 'event-1',
        organizerId: 'org-1',
        name: 'VIP Front Row',
        description: 'Best seats',
        multiplier: 1.5,
        maxSeats: 10,
      },
      { db },
    )

    expect(db.execute).toHaveBeenCalled()
    expect(result.status).toBe('draft')
    expect(result.multiplier).toBe(1.5)
  })

  it('creates a tier when multiplier is exactly 1.1', async () => {
    const tier = makeTier({ multiplier: 1.1, status: 'draft' })
    const db = makeDb(tier)

    const result = await createPremiumTier(
      {
        eventId: 'event-1',
        organizerId: 'org-1',
        name: 'Tier Minimum',
        description: 'Min multiplier',
        multiplier: 1.1,
        maxSeats: 5,
      },
      { db },
    )

    expect(result.status).toBe('draft')
  })

  it('throws INVALID_MULTIPLIER when multiplier is 1.0', async () => {
    const db = makeDb(null)

    await expect(
      createPremiumTier(
        {
          eventId: 'event-1',
          organizerId: 'org-1',
          name: 'Bad Tier',
          description: 'Bad',
          multiplier: 1.0,
          maxSeats: 5,
        },
        { db },
      ),
    ).rejects.toThrow(PremiumInventoryError)

    await expect(
      createPremiumTier(
        {
          eventId: 'event-1',
          organizerId: 'org-1',
          name: 'Bad Tier',
          description: 'Bad',
          multiplier: 1.0,
          maxSeats: 5,
        },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_MULTIPLIER' })
  })

  it('throws INVALID_MULTIPLIER when multiplier is 1.05', async () => {
    const db = makeDb(null)

    await expect(
      createPremiumTier(
        {
          eventId: 'event-1',
          organizerId: 'org-1',
          name: 'Bad Tier',
          description: 'Bad',
          multiplier: 1.05,
          maxSeats: 5,
        },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_MULTIPLIER' })
  })

  it('throws INVALID_MULTIPLIER when multiplier is below 1.0', async () => {
    const db = makeDb(null)

    await expect(
      createPremiumTier(
        {
          eventId: 'event-1',
          organizerId: 'org-1',
          name: 'Bad Tier',
          description: 'Bad',
          multiplier: 0.9,
          maxSeats: 5,
        },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_MULTIPLIER' })
  })
})

// ── activateTier ───────────────────────────────────────────────────────────

describe('activateTier', () => {
  it('activates a tier when organizer matches', async () => {
    const tier = makeTier({ status: 'draft', organizerId: 'org-1' })
    const db = makeDb(tier)

    const result = await activateTier('tier-1', 'org-1', { db })

    expect(db.execute).toHaveBeenCalled()
    expect(result.status).toBe('active')
  })

  it('throws ORGANIZER_NOT_AUTHORIZED when organizer does not match', async () => {
    const tier = makeTier({ organizerId: 'org-1' })
    const db = makeDb(tier)

    await expect(
      activateTier('tier-1', 'org-2', { db }),
    ).rejects.toMatchObject({ code: 'ORGANIZER_NOT_AUTHORIZED' })
  })

  it('throws TIER_NOT_FOUND when tier does not exist', async () => {
    const db = makeDb(null)

    await expect(
      activateTier('nonexistent', 'org-1', { db }),
    ).rejects.toMatchObject({ code: 'TIER_NOT_FOUND' })
  })
})

// ── pauseTier ──────────────────────────────────────────────────────────────

describe('pauseTier', () => {
  it('pauses an active tier when organizer matches', async () => {
    const tier = makeTier({ status: 'active', organizerId: 'org-1' })
    const db = makeDb(tier)

    const result = await pauseTier('tier-1', 'org-1', { db })

    expect(result.status).toBe('paused')
  })

  it('throws ORGANIZER_NOT_AUTHORIZED when organizer does not match', async () => {
    const tier = makeTier({ organizerId: 'org-1' })
    const db = makeDb(tier)

    await expect(
      pauseTier('tier-1', 'wrong-org', { db }),
    ).rejects.toMatchObject({ code: 'ORGANIZER_NOT_AUTHORIZED' })
  })
})

// ── addSeatsToTier ─────────────────────────────────────────────────────────

describe('addSeatsToTier', () => {
  it('inserts seats with correct premiumPriceCzk (rounds to nearest int)', async () => {
    const tier = makeTier({ multiplier: 1.5 })
    const db = makeDb(tier)

    const result = await addSeatsToTier(
      {
        tierId: 'tier-1',
        seats: [
          { seatId: 'seat-1', section: 'A', row: '1', number: '5', faceValueCzk: 1000 },
        ],
      },
      { db },
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.premiumPriceCzk).toBe(1500) // 1000 * 1.5
  })

  it('rounds premiumPriceCzk to nearest integer for fractional multipliers', async () => {
    const tier = makeTier({ multiplier: 1.3 })
    const db = makeDb(tier)

    const result = await addSeatsToTier(
      {
        tierId: 'tier-1',
        seats: [
          { seatId: 'seat-1', section: 'B', row: '2', number: '3', faceValueCzk: 100 },
        ],
      },
      { db },
    )

    // 100 * 1.3 = 130 exactly, or for e.g. 333 * 1.3 = 432.9 => 433
    expect(result[0]?.premiumPriceCzk).toBe(Math.round(100 * 1.3))
  })

  it('inserts multiple seats', async () => {
    const tier = makeTier({ multiplier: 2.0 })
    const db = makeDb(tier)

    const result = await addSeatsToTier(
      {
        tierId: 'tier-1',
        seats: [
          { seatId: 'seat-1', section: 'A', row: '1', number: '1', faceValueCzk: 500 },
          { seatId: 'seat-2', section: 'A', row: '1', number: '2', faceValueCzk: 600 },
        ],
      },
      { db },
    )

    expect(result).toHaveLength(2)
    expect(result[0]?.premiumPriceCzk).toBe(1000)
    expect(result[1]?.premiumPriceCzk).toBe(1200)
  })

  it('throws TIER_NOT_FOUND when tier does not exist', async () => {
    const db = makeDb(null)

    await expect(
      addSeatsToTier(
        {
          tierId: 'nonexistent',
          seats: [{ seatId: 'seat-1', section: 'A', row: '1', number: '1', faceValueCzk: 500 }],
        },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'TIER_NOT_FOUND' })
  })
})

// ── purchasePremiumSeat ────────────────────────────────────────────────────

describe('purchasePremiumSeat', () => {
  it('marks seat as purchased and sets purchasedByUserId', async () => {
    const tier = makeTier({ status: 'active' })
    const seat = makeSeat({ isPurchased: false })
    const db = makeDb(tier, [seat])

    const result = await purchasePremiumSeat(
      { tierId: 'tier-1', seatId: 'seat-abc', userId: 'user-42' },
      { db },
    )

    expect(result.isPurchased).toBe(true)
    expect(result.purchasedByUserId).toBe('user-42')
    expect(result.purchasedAt).toBeInstanceOf(Date)
  })

  it('throws SEAT_ALREADY_PURCHASED when seat is already purchased', async () => {
    const tier = makeTier({ status: 'active' })
    const seat = makeSeat({ isPurchased: true, purchasedAt: new Date(), purchasedByUserId: 'user-1' })
    const db = makeDb(tier, [seat])

    await expect(
      purchasePremiumSeat(
        { tierId: 'tier-1', seatId: 'seat-abc', userId: 'user-99' },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'SEAT_ALREADY_PURCHASED' })
  })

  it('throws TIER_NOT_ACTIVE when tier is in draft status', async () => {
    const tier = makeTier({ status: 'draft' })
    const seat = makeSeat({ isPurchased: false })
    const db = makeDb(tier, [seat])

    await expect(
      purchasePremiumSeat(
        { tierId: 'tier-1', seatId: 'seat-abc', userId: 'user-42' },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'TIER_NOT_ACTIVE' })
  })

  it('throws TIER_NOT_ACTIVE when tier is paused', async () => {
    const tier = makeTier({ status: 'paused' })
    const seat = makeSeat({ isPurchased: false })
    const db = makeDb(tier, [seat])

    await expect(
      purchasePremiumSeat(
        { tierId: 'tier-1', seatId: 'seat-abc', userId: 'user-42' },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'TIER_NOT_ACTIVE' })
  })

  it('throws SEAT_NOT_FOUND when seat does not exist in tier', async () => {
    const tier = makeTier({ status: 'active' })
    const db = makeDb(tier, []) // no seats

    await expect(
      purchasePremiumSeat(
        { tierId: 'tier-1', seatId: 'nonexistent', userId: 'user-42' },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'SEAT_NOT_FOUND' })
  })
})

// ── getAvailablePremiumSeats ───────────────────────────────────────────────

describe('getAvailablePremiumSeats', () => {
  it('returns only unpurchased seats', async () => {
    const availableSeat = makeSeat({ id: 'seat-a', isPurchased: false })
    // The db mock returns seatResults; we simulate filtering at DB level
    const db = makeDb(makeTier(), [availableSeat])

    const result = await getAvailablePremiumSeats('tier-1', { db })

    expect(result).toHaveLength(1)
    expect(result[0]?.isPurchased).toBe(false)
  })

  it('returns empty array when all seats are purchased', async () => {
    const db = makeDb(makeTier(), []) // DB returns no unpurchased seats

    const result = await getAvailablePremiumSeats('tier-1', { db })

    expect(result).toHaveLength(0)
  })
})

// ── getPremiumTierStats ────────────────────────────────────────────────────

describe('getPremiumTierStats', () => {
  it('returns correct counts and revenue with mixed purchased/available seats', async () => {
    const seats: PremiumSeat[] = [
      makeSeat({ id: 's1', isPurchased: true, premiumPriceCzk: 1500 }),
      makeSeat({ id: 's2', isPurchased: true, premiumPriceCzk: 1500 }),
      makeSeat({ id: 's3', isPurchased: false, premiumPriceCzk: 1500 }),
    ]
    const db = makeDb(makeTier(), seats)

    const stats = await getPremiumTierStats('tier-1', { db })

    expect(stats.totalSeats).toBe(3)
    expect(stats.soldSeats).toBe(2)
    expect(stats.availableSeats).toBe(1)
    expect(stats.revenue).toBe(3000)
    expect(stats.sellThroughRate).toBeCloseTo(2 / 3)
  })

  it('returns 0 sellThroughRate when there are no seats', async () => {
    const db = makeDb(makeTier(), [])

    const stats = await getPremiumTierStats('tier-1', { db })

    expect(stats.totalSeats).toBe(0)
    expect(stats.soldSeats).toBe(0)
    expect(stats.availableSeats).toBe(0)
    expect(stats.revenue).toBe(0)
    expect(stats.sellThroughRate).toBe(0)
  })

  it('returns sellThroughRate of 1 when all seats are sold', async () => {
    const seats: PremiumSeat[] = [
      makeSeat({ id: 's1', isPurchased: true, premiumPriceCzk: 2000 }),
      makeSeat({ id: 's2', isPurchased: true, premiumPriceCzk: 2000 }),
    ]
    const db = makeDb(makeTier(), seats)

    const stats = await getPremiumTierStats('tier-1', { db })

    expect(stats.sellThroughRate).toBe(1)
    expect(stats.revenue).toBe(4000)
  })
})
