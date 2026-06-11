/**
 * GET/POST /api/admin/oauth-apps
 *
 * Promoter (nebo platform admin) si registruje vlastní 3rd party app.
 * Client secret se vrátí JEN při create — pak už ne (jen hash v DB).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';
import { generateClientId, generateClientSecret, hashSecret } from '@/lib/oauth/flow';


const postSchema = z.object({
  appName: z.string().min(2).max(200),
  appDescription: z.string().max(2000).optional(),
  appHomepageUrl: z.string().url().optional(),
  appLogoUrl: z.string().url().optional(),
  redirectUris: z.array(z.string().url()).min(1).max(10),
  allowedScopes: z.array(z.string()).min(1).max(20),
  grantTypes: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const r = await db().query(
    `SELECT id, client_id, app_name, app_description, app_logo_url,
            redirect_uris, allowed_scopes, status, rate_limit_per_hour, created_at::text
       FROM b2b.oauth_clients
      WHERE owner_promoter_id = $1
   ORDER BY created_at DESC`,
    [promoter.promoterId],
  );

  return NextResponse.json({ apps: r.rows });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });

  const clientId = generateClientId();
  const clientSecret = generateClientSecret();
  const secretHash = hashSecret(clientSecret);

  const r = await db().query<{ id: string }>(
    `INSERT INTO b2b.oauth_clients
       (owner_promoter_id, owner_user_id, client_id, client_secret_hash,
        app_name, app_description, app_homepage_url, app_logo_url,
        redirect_uris, allowed_scopes, grant_types)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      promoter.promoterId, promoter.userId,
      clientId, secretHash,
      parsed.data.appName, parsed.data.appDescription ?? null,
      parsed.data.appHomepageUrl ?? null, parsed.data.appLogoUrl ?? null,
      parsed.data.redirectUris, parsed.data.allowedScopes,
      parsed.data.grantTypes ?? ['authorization_code', 'refresh_token'],
    ],
  );

  return NextResponse.json({
    id: r.rows[0].id,
    clientId,
    clientSecret,
    warning: 'Client secret se zobrazuje JEN teď. Ulož ho — později ho nelze získat zpět.',
  }, { status: 201 });

  });
}
