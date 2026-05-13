import { z } from 'zod';

export const staffRoleSchema = z.enum([
  'security',
  'bar',
  'technics',
  'usher',
  'ticket_check',
  'cloakroom',
  'first_aid',
  'cleaning',
  'manager',
  'other',
]);

export const staffEmploymentTypeSchema = z.enum(['employee', 'contractor', 'agency', 'volunteer']);

export const staffStatusSchema = z.enum(['active', 'inactive', 'archived']);

export const staffPermissionSchema = z.enum([
  'scan_tickets',
  'will_call_pickup',
  'guest_list_check_in',
  'manage_orders',
  'view_revenue',
  'manage_staff',
]);

export const createStaffMemberSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().min(5).max(30).optional(),
  emergencyContact: z.string().min(1).max(200).optional(),
  employmentType: staffEmploymentTypeSchema,
  hourlyRateHalire: z.number().int().min(0).optional(),
  roles: z.array(staffRoleSchema).min(1),
  permissions: z.array(staffPermissionSchema).optional(),
  notes: z.string().max(2000).optional(),
});

export const shiftStatusSchema = z.enum([
  'scheduled',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
]);

export const createShiftSchema = z.object({
  staffId: z.string().uuid(),
  role: staffRoleSchema,
  zone: z.string().min(1).max(200).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  notes: z.string().max(2000).optional(),
});

export const bulkCreateShiftsSchema = z.object({
  staffIds: z.array(z.string().uuid()).min(1),
  role: staffRoleSchema,
  zone: z.string().min(1).max(200).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  notes: z.string().max(2000).optional(),
});

export const updateShiftSchema = z.object({
  role: staffRoleSchema.optional(),
  zone: z.string().min(1).max(200).nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  status: shiftStatusSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateStaffMemberSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().min(5).max(30).nullable().optional(),
  emergencyContact: z.string().min(1).max(200).nullable().optional(),
  employmentType: staffEmploymentTypeSchema.optional(),
  hourlyRateHalire: z.number().int().min(0).nullable().optional(),
  status: staffStatusSchema.optional(),
  roles: z.array(staffRoleSchema).min(1).optional(),
  permissions: z.array(staffPermissionSchema).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Availability schemas
// ---------------------------------------------------------------------------

export const availabilityReasonSchema = z.enum(['vacation', 'sick', 'personal', 'other']);

export const createAvailabilitySchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: availabilityReasonSchema,
  notes: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Swap schemas
// ---------------------------------------------------------------------------

export const createSwapRequestSchema = z.object({
  targetStaffId: z.string().uuid().optional(),
  reason: z.string().max(2000).optional(),
});

export const acceptSwapSchema = z.object({
  accepterStaffId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Open shift schemas
// ---------------------------------------------------------------------------

export const createOpenShiftSchema = z.object({
  eventId: z.string().uuid(),
  requiredRole: staffRoleSchema,
  zone: z.string().min(1).max(200).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  hourlyRateHalire: z.number().int().min(0).optional(),
  slotsTotal: z.number().int().min(1).optional(),
});

export const claimOpenShiftSchema = z.object({
  staffId: z.string().uuid(),
});
