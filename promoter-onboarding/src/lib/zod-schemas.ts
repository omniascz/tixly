import { z } from 'zod';
import { validateIco, validateCzIban, validatePassword } from './validators';

export const RegisterUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .refine(validatePassword, 'Password must be at least 8 characters and contain at least one digit'),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
});

export const VerifyEmailSchema = z.object({
  token: z.string().length(64, 'Token must be exactly 64 characters'),
});

export const ResendVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const CreatePromoterProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters'),
  legalName: z.string().max(200).optional(),
  ico: z.string().refine(validateIco, 'IČO must be exactly 8 digits'),
  dic: z.string().optional(),
  phone: z.string().min(1, 'Phone is required').max(50),
  website: z.string().url('Invalid URL').optional().or(z.literal('')),
  defaultCurrency: z.string().length(3).optional(),
  timezone: z.string().max(100).optional(),
});

export const SubmitKycSchema = z.object({
  bankAccountIban: z
    .string()
    .refine(validateCzIban, 'Invalid Czech IBAN format. Expected: CZ followed by 22 digits'),
  bankAccountSwift: z.string().min(8).max(11),
  documents: z
    .array(
      z.object({
        documentType: z.enum([
          'business_registration',
          'bank_statement',
          'id_document',
          'tax_certificate',
          'other',
        ]),
        fileName: z.string().min(1).max(255),
        fileSize: z.number().int().positive('File size must be positive'),
        storageKey: z.string().min(1),
        mimeType: z.string().min(1).max(100),
      }),
    )
    .min(1, 'At least one document is required'),
});

export const AdminKycReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'request_more_info']),
  notes: z.string().max(5000).optional(),
});

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Wizard schemas ────────────────────────────────────────────────────────────

export const WizardTemplateSchema = z.enum([
  'concert',
  'club_night',
  'festival',
  'conference',
  'sports',
  'theatre',
  'other',
]);

const TicketTypeSchema = z.object({
  name: z.string().min(1, 'Ticket type name is required').max(200),
  priceHalire: z
    .number()
    .int('Price must be an integer number of halíře')
    .nonnegative('Price must be zero or positive'),
  capacity: z.number().int().positive('Capacity must be a positive integer'),
});

export const WizardProgressSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  date: z.string().datetime({ message: 'Date must be an ISO 8601 datetime string' }).optional(),
  venueName: z.string().max(300).optional(),
  city: z.string().max(200).optional(),
  capacity: z.number().int().positive().optional(),
  ticketTypes: z.array(TicketTypeSchema).optional(),
});

export const WizardCompleteSchema = z.object({
  wizardId: z.string().min(1, 'wizardId is required'),
  name: z.string().min(1, 'Event name is required').max(300),
  description: z.string().max(5000).optional(),
  date: z.string().datetime({ message: 'Date must be an ISO 8601 datetime string' }),
  venueName: z.string().min(1, 'Venue name is required').max(300),
  city: z.string().min(1, 'City is required').max(200),
  capacity: z.number().int().positive('Capacity must be a positive integer'),
  ticketTypes: z
    .array(TicketTypeSchema)
    .min(1, 'At least one ticket type is required'),
});
