/**
 * POST /api/internal/cron/onboarding-reminder
 *
 * Najde promotéry kteří se zaregistrovali ≥7 dní zpět ale nedokončili onboarding,
 * pošle mail s neslazenými body checklistu.
 *
 * Nedokončený onboarding = jeden z:
 *   - kyc_status != 'approved'
 *   - bank_account IS NULL
 *   - žádné published event
 *
 * Anti-spam: posíláme max 1× za 7 dní per promotér (kontrola přes audit log).
 *
 * Bezpečnost: x-internal-token header musí odpovídat INTERNAL_SERVICE_TOKEN.
 * Doporučené spouštění: 1× denně přes Vercel cron nebo external scheduler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';
import nodemailer from 'nodemailer';
import { escapeHtml } from '@/lib/html-escape/escape';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface OnboardingRow {
  promoter_id: string;
  promoter_name: string;
  owner_email: string;
  owner_name: string | null;
  brand_color_hex: string | null;
  kyc_status: string;
  has_bank: boolean;
  has_branding: boolean;
  published_events: number;
  days_since_registration: number;
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  // Promotéry s nedokončeným onboardingem, registrace 7+ dní zpět,
  // bez reminder mailu v posledních 7 dnech
  const r = await db().query<OnboardingRow>(
    `SELECT p.id AS promoter_id,
            p.name AS promoter_name,
            p.brand_color_hex,
            u.email AS owner_email,
            u.name AS owner_name,
            p.kyc_status,
            (p.bank_account IS NOT NULL AND length(p.bank_account) > 5) AS has_bank,
            (EXISTS (SELECT 1 FROM platform.promoter_branding pb
                     WHERE pb.promoter_id = p.id
                       AND (pb.logo_url IS NOT NULL OR pb.primary_color IS NOT NULL))) AS has_branding,
            (SELECT COUNT(*)::int FROM catalog.events
             WHERE promoter_id = p.id AND status = 'published') AS published_events,
            EXTRACT(DAY FROM now() - p.created_at)::int AS days_since_registration
     FROM platform.promoters p
     JOIN platform.promoter_members pm ON pm.promoter_id = p.id AND pm.role = 'owner'
     JOIN identity.users u ON u.id = pm.user_id
     WHERE p.status = 'active'
       AND p.created_at < now() - interval '7 days'
       AND (
         p.kyc_status != 'approved'
         OR p.bank_account IS NULL
         OR NOT EXISTS (SELECT 1 FROM catalog.events
                        WHERE promoter_id = p.id AND status = 'published')
       )
       AND NOT EXISTS (
         SELECT 1 FROM audit.audit_log al
         WHERE al.record_id = p.id::text
           AND al.table_name = 'promoters'
           AND al.action = 'UPDATE'
           AND al.new_values->>'kind' = 'onboarding_reminder'
           AND al.created_at > now() - interval '7 days'
       )
     LIMIT 200`,
  );

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? '1025'),
    secure: false,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  let sent = 0;
  let failed = 0;

  for (const row of r.rows) {
    const todo: string[] = [];
    if (row.kyc_status !== 'approved') todo.push('Dokončit KYC ověření');
    if (!row.has_bank) todo.push('Doplnit bankovní účet pro výplaty');
    if (!row.has_branding) todo.push('Nastavit branding (logo + barva)');
    if (row.published_events === 0) todo.push('Vytvořit první akci');

    const brandColor =
      row.brand_color_hex && /^#[0-9a-f]{6}$/i.test(row.brand_color_hex)
        ? row.brand_color_hex
        : '#10b981';

    const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:0;color:#111">
  <div style="background:${brandColor};color:#fff;padding:24px;text-align:center">
    <h1 style="margin:0;font-size:22px">Onboarding čeká</h1>
    <p style="margin:6px 0 0;opacity:0.9;font-size:13px">Tixly přátelská připomínka</p>
  </div>
  <div style="padding:24px;line-height:1.6">
    <p>Ahoj ${escapeHtml(row.owner_name ?? row.promoter_name)},</p>
    <p>Před ${row.days_since_registration} dny ses zaregistroval na Tixly jako pořadatel
       <strong>${escapeHtml(row.promoter_name)}</strong>. Pár věcí ti chybí
       k tomu, abys mohl pustit prodej:</p>
    <ul style="padding-left:20px">
      ${todo.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
    </ul>
    <p style="margin-top:24px">
      <a href="${baseUrl}/admin/onboarding"
         style="display:inline-block;background:${brandColor};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
        Dokončit onboarding
      </a>
    </p>
    <p style="margin-top:32px;color:#666;font-size:12px">
      Tato zpráva jde 1× týdně, dokud onboarding nedotáhneš.
      Pokud Tixly nepotřebuješ, ozvi se na podpora@tixly.cz a my účet zavřeme.
    </p>
  </div>
</body></html>`;

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM ?? 'vstupenky@tixly.local',
        to: row.owner_email,
        subject: `Tixly: Dokonči onboarding (${todo.length} ${todo.length === 1 ? 'krok' : 'kroky'} chybí)`,
        html,
        text: `Ahoj, dokonči onboarding na Tixly: ${baseUrl}/admin/onboarding\n\nChybí: ${todo.join(', ')}`,
      });
      sent += 1;

      // Audit log s kind='onboarding_reminder' aby se neopakovalo do 7 dní
      await db().query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_type, new_values)
         VALUES ('platform', 'promoters', $1, 'UPDATE', 'system', $2::jsonb)`,
        [row.promoter_id, JSON.stringify({ kind: 'onboarding_reminder', todo })],
      );
    } catch (err) {
      console.error('[onboarding-reminder]', row.owner_email, err);
      failed += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: r.rows.length,
    sent,
    failed,
  });
}
