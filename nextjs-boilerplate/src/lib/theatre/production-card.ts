/** Kolo 8 / krok 1 — karta inscenace: validace vstupu a jednotný tvar výstupu (admin i veřejný web). */
import { z } from 'zod';

const url = z.string().url().max(500);

export const productionCardSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  subtitle: z.string().max(300).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
  author: z.string().max(300).nullable().optional(),
  director: z.string().max(300).nullable().optional(),
  cast: z.array(z.object({ role: z.string().max(200).default(''), name: z.string().min(1).max(200) })).max(200).optional(),
  durationMin: z.number().int().min(1).max(1440).nullable().optional(),
  intermissionMin: z.number().int().min(0).max(240).nullable().optional(),
  ageRating: z.string().max(40).nullable().optional(),
  genre: z.string().max(100).nullable().optional(),
  photos: z.array(url).max(50).optional(),
  videoUrl: url.nullable().optional(),
});
export type ProductionCardInput = z.infer<typeof productionCardSchema>;

/** sloupec DB ← pole vstupu (jen zadaná pole; PATCH mění pouze to, co přišlo). */
export function cardColumns(input: Partial<ProductionCardInput>): Array<[string, unknown]> {
  const map: Array<[keyof ProductionCardInput, string, (v: unknown) => unknown]> = [
    ['title', 'title', (v) => v],
    ['subtitle', 'subtitle', (v) => v],
    ['description', 'description', (v) => v],
    ['author', 'author', (v) => v],
    ['director', 'director', (v) => v],
    ['cast', 'cast_list', (v) => JSON.stringify(v)],
    ['durationMin', 'duration_min', (v) => v],
    ['intermissionMin', 'intermission_min', (v) => v],
    ['ageRating', 'age_rating', (v) => v],
    ['genre', 'genre', (v) => v],
    ['photos', 'photos', (v) => JSON.stringify(v)],
    ['videoUrl', 'video_url', (v) => v],
  ];
  return map.filter(([k]) => input[k] !== undefined).map(([k, col, f]) => [col, f(input[k])]);
}

export const PRODUCTION_COLUMNS = `p.id, p.title, p.slug, p.subtitle, p.description, p.author, p.director, p.cast_list, p.duration_min,
  p.intermission_min, p.age_rating, p.genre, p.photos, p.video_url`;

export interface ProductionRow {
  id: string; title: string; slug: string | null; subtitle: string | null; description: string | null; author: string | null;
  director: string | null; cast_list: Array<{ role: string; name: string }>; duration_min: number | null; intermission_min: number | null;
  age_rating: string | null; genre: string | null; photos: string[]; video_url: string | null;
}

export interface ProductionCard {
  id: string; title: string; slug: string | null; subtitle: string | null; description: string | null; author: string | null;
  director: string | null; cast: Array<{ role: string; name: string }>; durationMin: number | null; intermissionMin: number | null;
  ageRating: string | null; genre: string | null; photos: string[]; videoUrl: string | null;
}

export function toProductionCard(r: ProductionRow): ProductionCard {
  return {
    id: r.id, title: r.title, slug: r.slug, subtitle: r.subtitle, description: r.description, author: r.author, director: r.director,
    cast: r.cast_list ?? [], durationMin: r.duration_min, intermissionMin: r.intermission_min, ageRating: r.age_rating,
    genre: r.genre, photos: r.photos ?? [], videoUrl: r.video_url,
  };
}
