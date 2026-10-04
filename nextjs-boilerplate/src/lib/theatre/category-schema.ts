/** Kolo 8 / krok 4 — validace vstupu slevové kategorie (admin termínu i šablona). */
import { z } from 'zod';

export const categorySchema = z.object({
  code: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['full', 'senior', 'student', 'ztp', 'ztpp', 'ztpp_companion', 'child', 'custom']).default('custom'),
  priceMode: z.enum(['percent', 'fixed']),
  priceValue: z.number().int().min(0),
  requiresProof: z.boolean().optional(),
  proofLabel: z.string().max(100).nullable().optional(),
  limitPerEvent: z.number().int().min(0).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
}).refine((c) => c.priceMode !== 'percent' || c.priceValue <= 10000, { message: 'procento nejvýš 100 %', path: ['priceValue'] });
