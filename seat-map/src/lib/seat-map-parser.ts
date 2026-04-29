import type { Seat, SeatMap, SeatStatus, Zone, Section } from '../types/seat-map';

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function parseZone(raw: unknown): Zone {
  if (!isRecord(raw)) throw new Error('Invalid zone object');
  if (typeof raw.id !== 'string') throw new Error('Zone.id must be a string');
  if (typeof raw.name !== 'string') throw new Error('Zone.name must be a string');
  if (typeof raw.color !== 'string') throw new Error('Zone.color must be a string');
  if (typeof raw.price !== 'number') throw new Error('Zone.price must be a number');
  if (typeof raw.description !== 'string') throw new Error('Zone.description must be a string');

  return {
    id: raw.id,
    name: raw.name,
    color: raw.color,
    price: raw.price,
    description: raw.description,
  };
}

const VALID_STATUSES = new Set<string>(['available', 'locked', 'sold', 'blocked', 'selected']);

function parseSeat(raw: unknown): Seat {
  if (!isRecord(raw)) throw new Error('Invalid seat object');
  if (typeof raw.id !== 'string') throw new Error('Seat.id must be a string');
  if (typeof raw.section !== 'string') throw new Error('Seat.section must be a string');
  if (typeof raw.row !== 'string') throw new Error('Seat.row must be a string');
  if (typeof raw.seatNumber !== 'string') throw new Error('Seat.seatNumber must be a string');
  if (typeof raw.x !== 'number') throw new Error('Seat.x must be a number');
  if (typeof raw.y !== 'number') throw new Error('Seat.y must be a number');
  if (typeof raw.width !== 'number') throw new Error('Seat.width must be a number');
  if (typeof raw.height !== 'number') throw new Error('Seat.height must be a number');

  const status = typeof raw.status === 'string' && VALID_STATUSES.has(raw.status)
    ? (raw.status as SeatStatus)
    : 'available';

  return {
    id: raw.id,
    section: raw.section,
    row: raw.row,
    seatNumber: raw.seatNumber,
    zone: parseZone(raw.zone),
    status,
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
  };
}

function parseSection(raw: unknown): Section {
  if (!isRecord(raw)) throw new Error('Invalid section object');
  if (typeof raw.id !== 'string') throw new Error('Section.id must be a string');
  if (typeof raw.name !== 'string') throw new Error('Section.name must be a string');
  if (!Array.isArray(raw.seats)) throw new Error('Section.seats must be an array');

  return {
    id: raw.id,
    name: raw.name,
    seats: raw.seats.map(parseSeat),
    transform: typeof raw.transform === 'string' ? raw.transform : undefined,
  };
}

export function parseSeatMapJSON(json: unknown): SeatMap {
  if (!isRecord(json)) throw new Error('SeatMap must be an object');
  if (typeof json.venueId !== 'string') throw new Error('SeatMap.venueId must be a string');
  if (typeof json.venueName !== 'string') throw new Error('SeatMap.venueName must be a string');
  if (typeof json.viewBox !== 'string') throw new Error('SeatMap.viewBox must be a string');
  if (!Array.isArray(json.sections)) throw new Error('SeatMap.sections must be an array');

  return {
    venueId: json.venueId,
    venueName: json.venueName,
    viewBox: json.viewBox,
    sections: json.sections.map(parseSection),
  };
}

export function mergeSeatStatuses(
  seatMap: SeatMap,
  statuses: Record<string, SeatStatus>,
): SeatMap {
  return {
    ...seatMap,
    sections: seatMap.sections.map((section) => ({
      ...section,
      seats: section.seats.map((seat) => {
        const incoming = statuses[seat.id];
        if (!incoming) return seat;
        // Never overwrite client-side 'selected' with server 'available'
        // But do overwrite if server says locked/sold/blocked
        if (seat.status === 'selected' && incoming === 'available') return seat;
        return { ...seat, status: incoming };
      }),
    })),
  };
}

export function getSeatColor(seat: Seat): string {
  switch (seat.status) {
    case 'available':
      return seat.zone.color;
    case 'selected':
      return '#3b82f6'; // blue-500
    case 'locked':
      return '#94a3b8'; // slate-400
    case 'sold':
      return '#64748b'; // slate-500
    case 'blocked':
      return '#334155'; // slate-700
    default: {
      const _exhaustive: never = seat.status;
      return _exhaustive;
    }
  }
}
