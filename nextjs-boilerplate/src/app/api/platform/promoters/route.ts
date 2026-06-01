import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';


interface PromoterRow {
  id: string;
  name: string;
  slug: string;
  contact_email: string;
  status: 'pending' | 'active' | 'suspended';
  member_count: string;
  event_count: string;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async (_admin) => {
  const result = await db().query<PromoterRow>(`
    SELECT
      p.id, p.name, p.slug, p.contact_email, p.status,
      COALESCE(m.cnt, 0)::text AS member_count,
      COALESCE(e.cnt, 0)::text AS event_count,
      p.created_at
    FROM platform.promoters p
    LEFT JOIN (
      SELECT promoter_id, COUNT(*) cnt FROM platform.promoter_members GROUP BY promoter_id
    ) m ON m.promoter_id = p.id
    LEFT JOIN (
      SELECT promoter_id, COUNT(*) cnt FROM catalog.events GROUP BY promoter_id
    ) e ON e.promoter_id = p.id
    ORDER BY
      CASE p.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
      p.created_at DESC
    LIMIT 200
  `);

  return NextResponse.json({ promoters: result.rows });

  });
}
