import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { z } from 'zod';

const createSchema = z.object({ name: z.string().min(2).max(200) });

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const r = await db().query<{
      id: string;
      name: string;
      client_id: string;
      scopes: string[];
      active: boolean;
      last_used_at: string | null;
      created_at: string;
    }>(
      `SELECT id, name, client_id, scopes, active, last_used_at, created_at
       FROM platform.distribution_partners
       ORDER BY created_at DESC`,
    );
    return NextResponse.json({ partners: r.rows });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, { status: 422 });
    }

    const clientSecret = randomBytes(32).toString('hex');
    const secretHash = await bcrypt.hash(clientSecret, 10);

    const r = await db().query<{ id: string; client_id: string }>(
      `INSERT INTO platform.distribution_partners (name, client_secret_hash)
       VALUES ($1, $2)
       RETURNING id, client_id`,
      [parsed.data.name, secretHash],
    );

    return NextResponse.json({
      ok: true,
      id: r.rows[0].id,
      client_id: r.rows[0].client_id,
      client_secret: clientSecret,
      warning: 'client_secret se zobrazí jen jednou. Uschovej ho bezpečně.',
    }, { status: 201 });
  });
}
