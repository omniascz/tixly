import { Pool } from 'pg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Counts {
  pending: number;
  active: number;
  suspended: number;
  total_events: number;
  pending_review: number;
}

async function fetchCounts(): Promise<Counts> {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await db.query<Counts>(`
      SELECT
        COUNT(*) FILTER (WHERE p.status='pending')::int    AS pending,
        COUNT(*) FILTER (WHERE p.status='active')::int     AS active,
        COUNT(*) FILTER (WHERE p.status='suspended')::int  AS suspended,
        (SELECT COUNT(*)::int FROM catalog.events) AS total_events,
        (SELECT COUNT(*)::int FROM catalog.events WHERE status IN ('pending_review','flagged')) AS pending_review
      FROM platform.promoters p
    `);
    return r.rows[0]!;
  } finally {
    await db.end();
  }
}

export const dynamic = 'force-dynamic';

export default async function PlatformDashboard() {
  const c = await fetchCounts();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Platform overview</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">{c.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600">{c.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Suspended</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-rose-600">{c.suspended}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Akcí celkem</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{c.total_events}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Ke schválení</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">{c.pending_review}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
