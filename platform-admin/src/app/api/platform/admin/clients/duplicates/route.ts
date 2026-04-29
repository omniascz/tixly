import { NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';

// GET /api/platform/admin/clients/duplicates?field=email|phone
//
// Returns groups of identity.clients that share the same email or phone.
// Admin-only. Useful for post-migration data hygiene.

interface DupGroup {
  value: string;
  count: number;
  clients: Array<{
    id: string;
    email: string | null;
    phone: string | null;
    first_name: string | null;
    last_name: string | null;
    created_at: Date;
  }>;
}

let _pool: Pool | undefined;
function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

export async function GET(req: NextRequest) {
  const role = req.headers.get('x-user-role');
  if (role !== 'admin' && role !== 'promoter_admin' && role !== 'platform_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const field = new URL(req.url).searchParams.get('field') ?? 'email';
  if (field !== 'email' && field !== 'phone') {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'field must be "email" or "phone"' },
      { status: 422 },
    );
  }

  const { rows: dupValues } = await pool().query<{ val: string; cnt: string }>(
    `SELECT LOWER(${field}) AS val, COUNT(*)::text AS cnt
       FROM identity.clients
      WHERE ${field} IS NOT NULL AND ${field} != ''
      GROUP BY LOWER(${field})
     HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 100`,
  );

  if (dupValues.length === 0) {
    return NextResponse.json({ duplicates: [], total: 0 });
  }

  const vals = dupValues.map((r) => r.val);
  const { rows: clients } = await pool().query(
    `SELECT id, email, phone, first_name, last_name, created_at
       FROM identity.clients
      WHERE LOWER(${field}) = ANY($1::text[])
      ORDER BY LOWER(${field}), created_at ASC`,
    [vals],
  );

  // Group
  const groups: DupGroup[] = [];
  const byVal = new Map<string, DupGroup>();
  for (const dv of dupValues) {
    const g: DupGroup = { value: dv.val, count: Number(dv.cnt), clients: [] };
    byVal.set(dv.val, g);
    groups.push(g);
  }
  for (const c of clients) {
    const key = (c[field] as string)?.toLowerCase();
    if (key && byVal.has(key)) {
      byVal.get(key)!.clients.push(c as DupGroup['clients'][0]);
    }
  }

  return NextResponse.json({ duplicates: groups, total: groups.length });
}
