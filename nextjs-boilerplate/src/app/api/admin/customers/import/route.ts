/**
 * POST /api/admin/customers/import
 *
 * Bulk import customers into platform.promoter_contacts.
 * Accepts JSON body OR multipart/form-data CSV.
 *
 * JSON body:
 * {
 *   contacts: [{
 *     email: string          -- required
 *     name?: string
 *     phone?: string
 *     historical_purchases?: number   -- počet historických nákupů
 *     historical_spend_czk?: number   -- historická útrata v celých Kč (převedeme na haléře)
 *     tags?: string[]
 *     gdpr_consent: boolean  -- MUSÍ být true, jinak řádek přeskočíme
 *   }]
 *   import_source?: string   -- e.g. 'mailchimp', 'smsticker', 'excel'
 * }
 *
 * CSV (multipart, field name "file"):
 * email,name,phone,historical_purchases,historical_spend_czk,gdpr_consent
 *
 * Returns: { imported, skipped, errors: [{row, reason}] }
 *
 * Auth: promoter (active) — zapisuje se pod promoter_id z RLS kontextu.
 * GDPR: řádky s gdpr_consent != true jsou vždy přeskočeny a zalogované.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const contactSchema = z.object({
  email:                  z.string().email(),
  name:                   z.string().max(200).optional(),
  phone:                  z.string().max(30).optional(),
  historical_purchases:   z.number().int().nonnegative().optional(),
  historical_spend_czk:   z.number().nonnegative().optional(),
  gdpr_consent:           z.boolean(),
  tags:                   z.array(z.string()).optional(),
});

type ContactInput = z.infer<typeof contactSchema>;

const MAX_BATCH = 5000;

function parseCsv(text: string): ContactInput[] {
  const lines  = text.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const results: ContactInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    header.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });

    results.push({
      email:                row['email'] ?? '',
      name:                 row['name'] || undefined,
      phone:                row['phone'] || undefined,
      historical_purchases: row['historical_purchases'] ? parseInt(row['historical_purchases']) : undefined,
      historical_spend_czk: row['historical_spend_czk'] ? parseFloat(row['historical_spend_czk']) : undefined,
      gdpr_consent:         row['gdpr_consent']?.toLowerCase() === 'true' || row['gdpr_consent'] === '1',
      tags:                 row['tags'] ? row['tags'].split(';').filter(Boolean) : undefined,
    });
  }

  return results;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    let contacts: ContactInput[];
    let importSource = 'manual';

    const ct = req.headers.get('content-type') ?? '';

    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'MISSING_FILE' }, { status: 422 });
      }
      importSource = (form.get('source') as string) || 'csv_upload';
      const text = await file.text();
      contacts = parseCsv(text);
    } else {
      let body: unknown;
      try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }); }
      const parsed = z.object({
        contacts:      z.array(z.unknown()).max(MAX_BATCH),
        import_source: z.string().optional(),
      }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: 'VALIDATION_FAILED', detail: parsed.error.issues }, { status: 422 });
      importSource = parsed.data.import_source ?? 'api';
      contacts     = parsed.data.contacts as ContactInput[];
    }

    if (contacts.length > MAX_BATCH) {
      return NextResponse.json(
        { error: 'TOO_MANY_ROWS', max: MAX_BATCH },
        { status: 422 },
      );
    }

    let imported = 0;
    let skipped  = 0;
    const errors: { row: number; reason: string }[] = [];

    // Process in chunks of 500
    const chunkSize = 500;
    for (let start = 0; start < contacts.length; start += chunkSize) {
      const chunk = contacts.slice(start, start + chunkSize);

      for (let i = 0; i < chunk.length; i++) {
        const rowIndex = start + i + 2; // 1-based, +1 for header
        const raw = chunk[i];

        const parsed = contactSchema.safeParse(raw);
        if (!parsed.success) {
          errors.push({ row: rowIndex, reason: parsed.error.issues[0].message });
          skipped++;
          continue;
        }
        const c = parsed.data;

        if (!c.gdpr_consent) {
          skipped++;
          errors.push({ row: rowIndex, reason: 'gdpr_consent is false — skipped per GDPR Art. 6' });
          continue;
        }

        try {
          await db().query(
            `INSERT INTO platform.promoter_contacts
               (promoter_id, email, name, phone,
                historical_purchases, historical_spend_halire,
                import_source, opted_out)
             VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
             ON CONFLICT (promoter_id, email) DO UPDATE SET
               name                  = COALESCE(EXCLUDED.name, platform.promoter_contacts.name),
               phone                 = COALESCE(EXCLUDED.phone, platform.promoter_contacts.phone),
               historical_purchases  = GREATEST(EXCLUDED.historical_purchases, COALESCE(platform.promoter_contacts.historical_purchases, 0)),
               historical_spend_halire = GREATEST(EXCLUDED.historical_spend_halire, COALESCE(platform.promoter_contacts.historical_spend_halire, 0)),
               import_source         = EXCLUDED.import_source`,
            [
              promoter.promoterId,
              c.email.toLowerCase(),
              c.name ?? null,
              c.phone ?? null,
              c.historical_purchases ?? 0,
              c.historical_spend_czk != null ? Math.round(c.historical_spend_czk * 100) : 0,
              importSource,
            ],
          );
          imported++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'DB error';
          errors.push({ row: rowIndex, reason: msg });
          skipped++;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      imported,
      skipped,
      total: contacts.length,
      errors: errors.slice(0, 50), // cap error list in response
    });
  });
}
