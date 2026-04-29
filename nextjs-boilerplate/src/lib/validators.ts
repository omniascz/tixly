import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Neplatná e-mailová adresa').min(1, 'E-mail je povinný'),
  password: z.string().min(6, 'Heslo musí mít alespoň 6 znaků'),
});

export const registerSchema = z
  .object({
    email: z.string().email('Neplatná e-mailová adresa').min(1, 'E-mail je povinný'),
    password: z.string().min(8, 'Heslo musí mít alespoň 8 znaků'),
    confirmPassword: z.string().min(8, 'Potvrzení hesla je povinné'),
    firstName: z.string().min(1, 'Jméno je povinné').max(50, 'Jméno je příliš dlouhé'),
    lastName: z.string().min(1, 'Příjmení je povinné').max(50, 'Příjmení je příliš dlouhé'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Hesla se neshodují',
    path: ['confirmPassword'],
  });

export const eventCreateSchema = z.object({
  title: z.string().min(1, 'Název akce je povinný').max(200, 'Název je příliš dlouhý'),
  description: z.string().min(1, 'Popis je povinný').max(2000, 'Popis je příliš dlouhý'),
  startDate: z.string().refine((date) => !isNaN(Date.parse(date)), 'Neplatný datum začátku'),
  endDate: z.string().refine((date) => !isNaN(Date.parse(date)), 'Neplatný datum konce'),
  location: z.string().min(1, 'Umístění je povinné').max(200, 'Umístění je příliš dlouhé'),
  imageUrl: z.string().url('Neplatná URL obrázku').optional().or(z.literal('')),
});

export const ticketTypeSchema = z.object({
  name: z.string().min(1, 'Název typu vstupenky je povinný').max(100),
  description: z.string().max(500).optional().or(z.literal('')),
  price: z.number().min(0, 'Cena musí být alespoň 0').max(1000000, 'Cena je příliš vysoká'),
  currency: z.enum(['CZK', 'EUR', 'USD']),
  quantity: z.number().int().min(1, 'Počet musí být alespoň 1').max(100000),
});

export const resaleListingSchema = z.object({
  ticketId: z.string().min(1, 'ID vstupenky je povinné'),
  price: z.number().min(0, 'Cena musí být alespoň 0').max(1000000),
  currency: z.enum(['CZK', 'EUR', 'USD']),
  description: z.string().max(500).optional().or(z.literal('')),
});

export const resaleListingUpdateSchema = z.object({
  price: z.number().min(0, 'Cena musí být alespoň 0').max(1000000).optional(),
  description: z.string().max(500).optional().or(z.literal('')),
});

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type TicketTypeInput = z.infer<typeof ticketTypeSchema>;
export type ResaleListingInput = z.infer<typeof resaleListingSchema>;
export type ResaleListingUpdateInput = z.infer<typeof resaleListingUpdateSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
