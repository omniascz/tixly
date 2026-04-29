export interface VenuePublic {
  id: string;
  name: string;
  slug: string | null;
  address: string;
  city: string;
  country: string;
  capacity: number;
  timezone: string;
  description: string | null;
  imageUrls: string[];
  website: string | null;
  geoLat: number | null;
  geoLng: number | null;
  isPublic: boolean;
  metadata: Record<string, unknown>;
}

export interface VenueWithOwnership extends VenuePublic {
  ownerPromoterId: string | null; // null = platform-owned (public)
  createdAt: string;
  updatedAt: string;
}

export interface CreateVenueInput {
  name: string; // max 200
  address: string;
  city: string;
  country?: string; // default 'CZ'
  capacity: number; // > 0
  timezone?: string; // default 'Europe/Prague'
  description?: string;
  imageUrls?: string[];
  website?: string;
  geoLat?: number;
  geoLng?: number;
  isPublic?: boolean; // default false (private promoter venue)
  metadata?: Record<string, unknown>;
}

export interface UpdateVenueInput extends Partial<CreateVenueInput> {}
