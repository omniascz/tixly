/**
 * Kolo 8 / krok 2 — jediné schéma plánku sálu (venue_seating_charts.layout) pro platformní i promotérskou
 * ukládací routu. Dřív měla promotérská routa jiný tvar ({id,label}) než editor ({name, rows, seats[num]}),
 * takže plánek pořadatele nešel uložit. Navíc: typ místa, poznámka, cenová zóna, legenda zón, podklad
 * (průhlednost, měřítko, posun) a odmítnutí duplicitního označení místa (sekce + řada + místo).
 */
import { z } from 'zod';
import { duplicateSeatLabels } from './generator';

export const SEAT_TYPES = ['standard', 'wheelchair', 'companion', 'unsellable', 'restricted'] as const;

const seatSchema = z.object({
  num: z.string().min(1).max(10),
  x: z.number(),
  y: z.number(),
  accessibility: z.boolean().optional(),
  blocked: z.boolean().optional(),
  type: z.enum(SEAT_TYPES).optional(),
  note: z.string().max(200).optional(),
  zone: z.string().min(1).max(40).optional(),
});

const rowSchema = z.object({
  // Prázdné označení řady je OK (jednořadý sloupec).
  label: z.string().max(10),
  seats: z.array(seatSchema).min(1).max(500),
});

const sectorSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  rows: z.array(rowSchema).min(1).max(500),
  labelPosition: z.object({ x: z.number(), y: z.number() }).optional(),
});

const stageSchema = z.object({
  position: z.enum(['top', 'bottom', 'left', 'right']),
  label: z.string().min(1).max(50),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  rotation: z.number().optional(),
});

const overlaySchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(['football_pitch', 'tennis_court', 'bar', 'stage_icon', 'entrance', 'stairs']),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  label: z.string().max(100).optional(),
});

const builderSchema = z.object({
  stage: z.enum(['top', 'bottom', 'none']),
  sectors: z.array(z.object({
    name: z.string().min(1).max(100),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    groups: z.array(z.object({
      from: z.number().int().min(1).max(500),
      to: z.number().int().min(1).max(500),
      seats: z.number().int().min(1).max(200),
      aisleAfter: z.number().int().min(0).max(200).optional(),
    })).min(1).max(100),
    rowLabelFormat: z.enum(['number', 'letter']).optional(),
    placement: z.enum(['front', 'left', 'right']).optional(),
  })).min(1).max(50),
});

export const zoneSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const layoutSchema = z.object({
  viewBox: z.string().regex(/^[\d\s.-]+$/).default('0 0 1000 800'),
  sectors: z.array(sectorSchema).min(1).max(200),
  stage: stageSchema.optional(),
  builder: builderSchema.optional(),
  overlays: z.array(overlaySchema).max(200).optional(),
  // Podkladový plánek — URL nebo zmenšený obrázek/první strana PDF jako data URL.
  floorPlanUrl: z.string().max(3_000_000).optional(),
  underlay: z.object({
    opacity: z.number().min(0).max(1).default(0.3),
    scale: z.number().min(0.05).max(20).default(1),
    x: z.number().default(0),
    y: z.number().default(0),
  }).optional(),
  zones: z.array(zoneSchema).max(50).optional(),
}).superRefine((layout, ctx) => {
  const dups = duplicateSeatLabels(layout.sectors);
  if (dups.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sectors'], message: `DUPLICATE_SEAT: ${dups.slice(0, 20).join('; ')}` });
  }
  const zoneIds = new Set((layout.zones ?? []).map((z0) => z0.id));
  if ((layout.zones ?? []).length !== zoneIds.size) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['zones'], message: 'DUPLICATE_ZONE' });
  }
  const unknown = new Set<string>();
  for (const s of layout.sectors) for (const r of s.rows) for (const seat of r.seats) {
    if (seat.zone && !zoneIds.has(seat.zone)) unknown.add(seat.zone);
  }
  if (unknown.size > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['zones'], message: `UNKNOWN_ZONE: ${[...unknown].join(', ')}` });
  }
});

export type ChartLayout = z.infer<typeof layoutSchema>;

/** Česká hláška pro pořadatele z chyb schématu (duplicitní místa, neznámá zóna). */
export function layoutErrorMessage(issues: z.ZodIssue[]): string {
  const dup = issues.find((i) => i.message.startsWith('DUPLICATE_SEAT'));
  if (dup) return `Plánek obsahuje duplicitní označení míst: ${dup.message.replace('DUPLICATE_SEAT: ', '')}`;
  const zone = issues.find((i) => i.message.startsWith('UNKNOWN_ZONE'));
  if (zone) return `Místa odkazují na neexistující cenovou zónu: ${zone.message.replace('UNKNOWN_ZONE: ', '')}`;
  return 'Plánek není platný.';
}
