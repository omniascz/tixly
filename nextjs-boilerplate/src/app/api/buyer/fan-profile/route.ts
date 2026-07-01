/**
 * GET /api/buyer/fan-profile  — fanoušek čte svůj přenosný profil
 * PUT /api/buyer/fan-profile  — fanoušek edituje/vytváří svůj profil
 *
 * Fan-owned data napříč pořadateli (portable). Fanoušek ovládá, co sdílí.
 * Migračně bezpečné: bez tabulky (mig 448) GET vrací default, PUT 503.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsUser } from '@/lib/auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

interface FanProfile {
  displayName: string | null;
  favoriteGenres: string[];
  accessibilityPrefs: Record<string, boolean>;
  marketingConsent: Record<string, boolean>;
  portable: boolean;
}

const DEFAULT_PROFILE: FanProfile = {
  displayName: null,
  favoriteGenres: [],
  accessibilityPrefs: {},
  marketingConsent: {},
  portable: true,
};

const putSchema = z.object({
  displayName: z.string().max(100).nullable().optional(),
  favoriteGenres: z.array(z.string().max(40)).max(30).optional(),
  accessibilityPrefs: z.record(z.boolean()).optional(),
  marketingConsent: z.record(z.boolean()).optional(),
  portable: z.boolean().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) =>
    runWithServiceContext(async () => {
      try {
        const r = await db().query<{
          display_name: string | null;
          favorite_genres: string[];
          accessibility_prefs: Record<string, boolean>;
          marketing_consent: Record<string, boolean>;
          portable: boolean;
        }>(
          `SELECT display_name, favorite_genres, accessibility_prefs, marketing_consent, portable
             FROM identity.fan_profiles WHERE user_id = $1`,
          [userId],
        );
        if (r.rows.length === 0) return NextResponse.json({ profile: DEFAULT_PROFILE, exists: false });
        const p = r.rows[0];
        return NextResponse.json({
          profile: {
            displayName: p.display_name,
            favoriteGenres: p.favorite_genres,
            accessibilityPrefs: p.accessibility_prefs,
            marketingConsent: p.marketing_consent,
            portable: p.portable,
          },
          exists: true,
        });
      } catch {
        // Tabulka ještě neexistuje (před migrací 448) — vrať default.
        return NextResponse.json({ profile: DEFAULT_PROFILE, exists: false });
      }
    }),
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const p = parsed.data;

    return runWithServiceContext(async () => {
      try {
        await db().query(
          `INSERT INTO identity.fan_profiles
             (user_id, display_name, favorite_genres, accessibility_prefs, marketing_consent, portable, updated_at)
           VALUES ($1, $2, COALESCE($3::jsonb,'[]'::jsonb), COALESCE($4::jsonb,'{}'::jsonb),
                   COALESCE($5::jsonb,'{}'::jsonb), COALESCE($6, true), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             display_name       = COALESCE(EXCLUDED.display_name, identity.fan_profiles.display_name),
             favorite_genres    = COALESCE($3::jsonb, identity.fan_profiles.favorite_genres),
             accessibility_prefs= COALESCE($4::jsonb, identity.fan_profiles.accessibility_prefs),
             marketing_consent  = COALESCE($5::jsonb, identity.fan_profiles.marketing_consent),
             portable           = COALESCE($6, identity.fan_profiles.portable),
             updated_at         = NOW()`,
          [
            userId,
            p.displayName ?? null,
            p.favoriteGenres ? JSON.stringify(p.favoriteGenres) : null,
            p.accessibilityPrefs ? JSON.stringify(p.accessibilityPrefs) : null,
            p.marketingConsent ? JSON.stringify(p.marketingConsent) : null,
            p.portable ?? null,
          ],
        );
        return NextResponse.json({ ok: true });
      } catch {
        return NextResponse.json(
          { error: 'PROFILE_UNAVAILABLE', message: 'Profil bude dostupný po nasazení (migrace 448).' },
          { status: 503 },
        );
      }
    });
  });
}
