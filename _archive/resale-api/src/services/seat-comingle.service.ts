/**
 * Feature #170 — Resale co-mingling on seat map
 *
 * Provides combined seat availability: primary inventory alongside active
 * resale listings, merged into a single unified view per section.
 */
import type { DbAdapter } from '../types/resale.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SeatAvailabilityType = 'primary' | 'resale';

export interface SeatAvailability {
  seatId: string;
  section: string;
  row: string;
  number: string;
  availabilityType: SeatAvailabilityType;
  primaryPriceCzk: number | null;   // face value; null when seat has no primary offer
  resalePriceCzk: number | null;    // asking price; null when seat has no resale offer
  isAvailable: boolean;
  holdExpiresAt: Date | null;       // Redis hold expiry from seat-map (not used in DB query path)
  listingId: string | null;         // resale listing id; null for primary-only seats
}

export interface CominglingSummary {
  eventId: string;
  section: string;
  totalSeats: number;
  primaryAvailable: number;
  resaleAvailable: number;
  combinedAvailable: number;
  seats: SeatAvailability[];
}

// ---------------------------------------------------------------------------
// Internal DB row shapes
// ---------------------------------------------------------------------------

interface EventSeatRow {
  seat_id: string;
  section: string;
  row: string;
  number: string;
  price_czk: string | number;
  is_available: boolean;
}

interface ResaleListingRow {
  listing_id: string;
  seat_id: string;
  section: string;
  row: string;
  seat_number: string;
  asking_price_czk: string | number;
  status: string;
}

// ---------------------------------------------------------------------------
// Internal result shapes — returned by the helper functions
// ---------------------------------------------------------------------------

export interface PrimarySeats {
  seatId: string;
  section: string;
  row: string;
  number: string;
  priceCzk: number;
  isAvailable: boolean;
}

// We intentionally use the existing ResaleListing domain type name in the
// public API spec, so we re-export a local alias that matches what the spec
// calls "ResaleListing" for the helper return value.
export interface ResaleListing {
  listingId: string;
  seatId: string;
  section: string;
  row: string;
  seatNumber: string;
  askingPriceCzk: number;
  status: string;
}

// ---------------------------------------------------------------------------
// ServiceDeps — only db is required for this service
// ---------------------------------------------------------------------------

export interface ServiceDeps {
  db: DbAdapter;
}

// ---------------------------------------------------------------------------
// Helper: fetch primary inventory for a section
// ---------------------------------------------------------------------------

export async function getPrimaryAvailability(
  eventId: string,
  section: string,
  db: DbAdapter,
): Promise<PrimarySeats[]> {
  const rows = await db.query<EventSeatRow>(
    `SELECT seat_id, section, row, number, price_czk, is_available
     FROM event_seats
     WHERE event_id=$1 AND section=$2`,
    [eventId, section],
  );

  return rows.map((r) => ({
    seatId: r.seat_id,
    section: r.section,
    row: r.row,
    number: r.number,
    priceCzk: Number(r.price_czk),
    isAvailable: r.is_available,
  }));
}

// ---------------------------------------------------------------------------
// Helper: fetch active resale listings for a section
// ---------------------------------------------------------------------------

export async function getResaleListingsForSection(
  eventId: string,
  section: string,
  db: DbAdapter,
): Promise<ResaleListing[]> {
  const rows = await db.query<ResaleListingRow>(
    `SELECT listing_id, seat_id, section, row, seat_number, asking_price_czk, status
     FROM resale_listings
     WHERE event_id=$1 AND section=$2 AND status='active'`,
    [eventId, section],
  );

  return rows.map((r) => ({
    listingId: r.listing_id,
    seatId: r.seat_id,
    section: r.section,
    row: r.row,
    seatNumber: r.seat_number,
    askingPriceCzk: Number(r.asking_price_czk),
    status: r.status,
  }));
}

// ---------------------------------------------------------------------------
// Main: merge primary + resale into a combined view
// ---------------------------------------------------------------------------

export async function getCombinedSeatAvailability(
  eventId: string,
  section: string,
  deps: ServiceDeps,
): Promise<CominglingSummary> {
  const { db } = deps;

  const [primarySeats, resaleListings] = await Promise.all([
    getPrimaryAvailability(eventId, section, db),
    getResaleListingsForSection(eventId, section, db),
  ]);

  // Index primary seats by seatId for O(1) lookup during merge
  const primaryBySeatId = new Map<string, PrimarySeats>();
  for (const seat of primarySeats) {
    primaryBySeatId.set(seat.seatId, seat);
  }

  // Index resale listings by seatId for O(1) lookup during merge
  const resaleBySeatId = new Map<string, ResaleListing>();
  for (const listing of resaleListings) {
    resaleBySeatId.set(listing.seatId, listing);
  }

  // Collect all unique seatIds across both sources
  const allSeatIds = new Set<string>([
    ...primaryBySeatId.keys(),
    ...resaleBySeatId.keys(),
  ]);

  const seats: SeatAvailability[] = [];

  for (const seatId of allSeatIds) {
    const primary = primaryBySeatId.get(seatId);
    const resale = resaleBySeatId.get(seatId);

    if (primary && primary.isAvailable) {
      // Primary available — show as primary, primary takes precedence
      seats.push({
        seatId,
        section: primary.section,
        row: primary.row,
        number: primary.number,
        availabilityType: 'primary',
        primaryPriceCzk: primary.priceCzk,
        resalePriceCzk: resale ? resale.askingPriceCzk : null,
        isAvailable: true,
        holdExpiresAt: null,
        listingId: resale ? resale.listingId : null,
      });
    } else if (resale) {
      // No available primary — show as resale (whether or not a sold primary exists)
      const row = primary ? primary.row : resale.row;
      const number = primary ? primary.number : resale.seatNumber;
      seats.push({
        seatId,
        section: resale.section,
        row,
        number,
        availabilityType: 'resale',
        primaryPriceCzk: primary ? primary.priceCzk : null,
        resalePriceCzk: resale.askingPriceCzk,
        isAvailable: true,
        holdExpiresAt: null,
        listingId: resale.listingId,
      });
    } else if (primary) {
      // Primary exists but is not available (sold/held) and no active resale
      seats.push({
        seatId,
        section: primary.section,
        row: primary.row,
        number: primary.number,
        availabilityType: 'primary',
        primaryPriceCzk: primary.priceCzk,
        resalePriceCzk: null,
        isAvailable: false,
        holdExpiresAt: null,
        listingId: null,
      });
    }
  }

  const primaryAvailable = seats.filter(
    (s) => s.availabilityType === 'primary' && s.isAvailable,
  ).length;

  const resaleAvailable = seats.filter(
    (s) => s.availabilityType === 'resale' && s.isAvailable,
  ).length;

  return {
    eventId,
    section,
    totalSeats: seats.length,
    primaryAvailable,
    resaleAvailable,
    combinedAvailable: primaryAvailable + resaleAvailable,
    seats,
  };
}
