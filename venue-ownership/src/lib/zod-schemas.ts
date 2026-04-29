import { z } from 'zod';

export const CreateVenueSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().min(1),
  city: z.string().min(1).max(100),
  country: z.string().length(2).default('CZ'),
  capacity: z.number().int().positive({ message: 'Capacity must be > 0' }),
  timezone: z.string().min(1).default('Europe/Prague'),
  description: z.string().optional(),
  imageUrls: z.array(z.string().url()).optional().default([]),
  website: z.string().url().optional(),
  geoLat: z.number().min(-90).max(90).optional(),
  geoLng: z.number().min(-180).max(180).optional(),
  isPublic: z.boolean().optional().default(false),
  metadata: z.record(z.unknown()).optional().default({}),
});

export const UpdateVenueSchema = CreateVenueSchema.partial();

export const ListPublicVenuesQuerySchema = z.object({
  city: z.string().optional(),
  country: z.string().length(2).optional(),
  minCapacity: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const AdminListVenuesQuerySchema = z.object({
  ownerPromoterId: z.string().uuid().optional(),
  isPublic: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const TransferVenueSchema = z.object({
  newOwnerPromoterId: z.string().uuid(),
});
