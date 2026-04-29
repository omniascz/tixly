import { z } from 'zod';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const futureDatetime = z
  .string()
  .datetime({ message: 'Datum musí být platný ISO datetime řetězec.' })
  .refine(
    (val) => new Date(val) > new Date(),
    { message: 'Datum musí být v budoucnosti.' },
  );

const optionalDatetime = z
  .string()
  .datetime({ message: 'Datum musí být platný ISO datetime řetězec.' })
  .nullable()
  .optional();

const optionalFutureDatetime = z
  .string()
  .datetime({ message: 'Datum musí být platný ISO datetime řetězec.' })
  .optional();

// ─── CreateTicketTypeSchema ───────────────────────────────────────────────────

export const CreateTicketTypeSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Název kategorie vstupenky musí mít alespoň 1 znak.')
      .max(200, 'Název kategorie vstupenky nesmí přesáhnout 200 znaků.'),
    description: z.string().optional(),
    priceHalire: z
      .number()
      .int('Cena musí být celé číslo (halíře).')
      .min(0, 'Cena nesmí být záporná.'),
    capacity: z
      .number()
      .int('Kapacita musí být celé číslo.')
      .min(1, 'Kapacita musí být alespoň 1.')
      .optional(),
    zone: z.string().optional(),
    sortOrder: z.number().int().min(0).optional(),
    saleStartAt: optionalFutureDatetime,
    saleEndAt: optionalFutureDatetime,
    minPerOrder: z.number().int().min(1).optional().default(1),
    maxPerOrder: z.number().int().min(1).optional().default(10),
    transferable: z.boolean().optional().default(true),
  })
  .refine(
    (data) => {
      if (data.minPerOrder !== undefined && data.maxPerOrder !== undefined) {
        return data.maxPerOrder >= data.minPerOrder;
      }
      return true;
    },
    { message: 'maxPerOrder musí být větší nebo roven minPerOrder.', path: ['maxPerOrder'] },
  );

// ─── CreateEventSchema ────────────────────────────────────────────────────────

export const CreateEventSchema = z.object({
  title: z
    .string()
    .min(1, 'Název akce musí mít alespoň 1 znak.')
    .max(200, 'Název akce nesmí přesáhnout 200 znaků.'),
  description: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  imageUrl: z.string().url('imageUrl musí být platná URL adresa.').optional(),
  venueId: z.string().uuid('venueId musí být UUID.').optional(),
  startDate: futureDatetime,
  endDate: optionalFutureDatetime,
  capacity: z
    .number()
    .int('Kapacita musí být celé číslo.')
    .min(1, 'Kapacita musí být alespoň 1.')
    .optional(),
  onSaleAt: optionalFutureDatetime,
  offSaleAt: optionalFutureDatetime,
  resaleAllowed: z.boolean().optional().default(false),
  reEntryAllowed: z.boolean().optional().default(false),
  tags: z
    .array(z.string())
    .max(20, 'Maximálně 20 tagů je povoleno.')
    .optional()
    .default([]),
  metadata: z.record(z.unknown()).optional(),
  ticketTypes: z
    .array(CreateTicketTypeSchema)
    .min(1, 'Akce musí mít alespoň jeden typ vstupenky.'),
});

// ─── UpdateEventSchema ────────────────────────────────────────────────────────

export const UpdateEventSchema = z.object({
  title: z
    .string()
    .min(1, 'Název akce musí mít alespoň 1 znak.')
    .max(200, 'Název akce nesmí přesáhnout 200 znaků.')
    .optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  imageUrl: z.string().url('imageUrl musí být platná URL adresa.').nullable().optional(),
  venueId: z.string().uuid('venueId musí být UUID.').nullable().optional(),
  startDate: optionalFutureDatetime,
  endDate: optionalFutureDatetime,
  capacity: z
    .number()
    .int('Kapacita musí být celé číslo.')
    .min(1, 'Kapacita musí být alespoň 1.')
    .nullable()
    .optional(),
  onSaleAt: optionalDatetime,
  offSaleAt: optionalDatetime,
  resaleAllowed: z.boolean().optional(),
  reEntryAllowed: z.boolean().optional(),
  tags: z
    .array(z.string())
    .max(20, 'Maximálně 20 tagů je povoleno.')
    .optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

// ─── UpdateTicketTypeSchema ───────────────────────────────────────────────────

export const UpdateTicketTypeSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Název kategorie vstupenky musí mít alespoň 1 znak.')
      .max(200, 'Název kategorie vstupenky nesmí přesáhnout 200 znaků.')
      .optional(),
    description: z.string().nullable().optional(),
    priceHalire: z
      .number()
      .int('Cena musí být celé číslo (halíře).')
      .min(0, 'Cena nesmí být záporná.')
      .optional(),
    capacity: z
      .number()
      .int('Kapacita musí být celé číslo.')
      .min(1, 'Kapacita musí být alespoň 1.')
      .nullable()
      .optional(),
    zone: z.string().nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    saleStartAt: optionalDatetime,
    saleEndAt: optionalDatetime,
    minPerOrder: z.number().int().min(1).optional(),
    maxPerOrder: z.number().int().min(1).optional(),
    isActive: z.boolean().optional(),
    transferable: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.minPerOrder !== undefined && data.maxPerOrder !== undefined) {
        return data.maxPerOrder >= data.minPerOrder;
      }
      return true;
    },
    { message: 'maxPerOrder musí být větší nebo roven minPerOrder.', path: ['maxPerOrder'] },
  );

// ─── Exported types ───────────────────────────────────────────────────────────

export type CreateEventInputParsed = z.infer<typeof CreateEventSchema>;
export type UpdateEventInputParsed = z.infer<typeof UpdateEventSchema>;
export type CreateTicketTypeInputParsed = z.infer<typeof CreateTicketTypeSchema>;
export type UpdateTicketTypeInputParsed = z.infer<typeof UpdateTicketTypeSchema>;
