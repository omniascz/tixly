export type SeatStatus = 'available' | 'locked' | 'sold' | 'blocked' | 'selected';

export interface Zone {
  id: string;
  name: string;
  color: string;
  price: number;
  description: string;
}

export interface Seat {
  id: string;
  section: string;
  row: string;
  seatNumber: string;
  zone: Zone;
  status: SeatStatus;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Section {
  id: string;
  name: string;
  seats: Seat[];
  transform?: string;
}

export interface SeatMap {
  venueId: string;
  venueName: string;
  sections: Section[];
  viewBox: string;
}

export interface SeatSelection {
  seatId: string;
  ticketTypeId: string;
  price: number;
}
