import Link from 'next/link';
import { Pool } from 'pg';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { formatCzechDate } from '@/lib/format';

interface EventRow {
  id: string;
  title: string;
  date_start: string;
  venue_name: string;
}

async function fetchEvents(): Promise<EventRow[]> {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await db.query<EventRow>(`
      SELECT e.id, e.title, e.date_start, COALESCE(v.name, 'Online') AS venue_name
      FROM catalog.events e
      LEFT JOIN catalog.venues v ON v.id = e.venue_id
      JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.date_start >= NOW()
        AND p.status = 'active'
        AND e.status = 'published'
      ORDER BY e.date_start ASC
      LIMIT 200
    `);
    return result.rows;
  } finally {
    await db.end();
  }
}

export const dynamic = 'force-dynamic';

export default async function EventsPage({
  params,
}: {
  params: { locale: string };
}) {
  const events = await fetchEvents();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Nadcházející akce</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {events.length} akcí v prodeji
        </p>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Žádné aktivní akce. Promotér musí nejprve založit a publikovat akci.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <Link key={e.id} href={`/${params.locale}/events/${e.id}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle className="text-base">{e.title}</CardTitle>
                  <CardDescription>{e.venue_name}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground">
                    {formatCzechDate(e.date_start)}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
