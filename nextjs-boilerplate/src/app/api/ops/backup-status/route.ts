/**
 * POST /api/ops/backup-status — kolo 14 / krok 3: výsledek zálohy DB z GitHub Actions (.github/workflows/db-backup.yml).
 *
 * Body: { status: 'success' | 'failure', runUrl?: string, detail?: string }. Auth: Bearer CRON_SECRET.
 *   success → heartbeat 'db-backup' (kontrolní job pak hlásí zálohu, která neproběhla déle než 2 týdny);
 *   failure → heartbeat se stavem chyby + e-mail na PLATFORM_ADMIN_EMAIL (nejvýš 1 za 30 min).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { alertOps } from '@/lib/ops/alerts';
import { recordCronRun } from '@/lib/ops/heartbeat';
import { isCronAuthorized } from '@/lib/security/cron-auth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  status: z.enum(['success', 'failure']),
  runUrl: z.string().url().max(500).optional(),
  detail: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  const { status, runUrl, detail } = parsed.data;
  if (status === 'success') {
    await recordCronRun('db-backup', true, 200);
    return NextResponse.json({ ok: true });
  }
  await recordCronRun('db-backup', false, 500, detail ?? 'záloha selhala');
  await alertOps({
    kind: 'backup_failed', key: 'backup_failed',
    subject: 'Selhala záloha databáze',
    text: `Týdenní záloha databáze (GitHub Actions, db-backup) selhala.${detail ? `\n${detail}` : ''}${runUrl ? `\nBěh: ${runUrl}` : ''}\n\n`
      + 'Spusťte zálohu ručně (Actions → db-backup → Run workflow) a zkontrolujte tajemství DATABASE_URL / AWS_* / BACKUP_ENCRYPTION_KEY.',
  });
  return NextResponse.json({ ok: true, alerted: true });
}
