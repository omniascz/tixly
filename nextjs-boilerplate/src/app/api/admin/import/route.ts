import { NextRequest, NextResponse } from 'next/server';
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function detectDelimiter(sample: string): string {
  const counts = {
    ',': (sample.match(/,/g) ?? []).length,
    ';': (sample.match(/;/g) ?? []).length,
    '\t': (sample.match(/\t/g) ?? []).length,
  };
  const max = Math.max(...Object.values(counts));
  for (const [d, c] of Object.entries(counts)) {
    if (c === max && max > 0) return d;
  }
  return ',';
}

function parseCsv(text: string, delimiter: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const cols: string[] = [];
      let cur = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuote = !inQuote;
        } else if (ch === delimiter && !inQuote) {
          cols.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      cols.push(cur.trim());
      return cols;
    });
}

interface ColumnMapping {
  email: string;
  name: string;
  phone?: string;
  purchases?: string;
  spend?: string;
  firstPurchase?: string;
  lastPurchase?: string;
}

function colValue(row: string[], headers: string[], key: string | undefined): string | undefined {
  if (!key) return undefined;
  const idx = headers.findIndex((h) => h === key || h.toLowerCase() === key.toLowerCase());
  if (idx === -1) {
    const numIdx = parseInt(key, 10);
    if (!isNaN(numIdx) && numIdx >= 0 && numIdx < row.length) return row[numIdx] || undefined;
    return undefined;
  }
  return row[idx] || undefined;
}

/**
 * Kolo 3: uživatel kontaktu. Globální identita (identity.users) není pořadatelova — pořadatel ji pod
 * RLS nesmí měnit ani číst cizí účty (dřív `ON CONFLICT … DO UPDATE SET name … RETURNING` →
 * 42501 pod tixly_app, a navíc by import přepsal jméno existujícího uživatele platformy).
 * Systémový krok (asSystemInTx): založ placeholder bez hesla, existující účet jen najdi.
 */
async function resolveContactUser(email: string, name: string | null): Promise<string> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const id = await asSystemInTx(client, async () => {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
         VALUES ($1, $2, '!import-no-password', NOW())
         ON CONFLICT (email) WHERE anonymized_at IS NULL DO NOTHING
         RETURNING id`,
        [email, name],
      );
      if (ins.rows[0]) return ins.rows[0].id;
      const ex = await client.query<{ id: string }>(
        `SELECT id FROM identity.users WHERE email = $1 AND anonymized_at IS NULL LIMIT 1`,
        [email],
      );
      return ex.rows[0]?.id;
    });
    await client.query('COMMIT');
    if (!id) throw new Error('USER_RESOLVE_FAILED');
    return id;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const result = await db().query(
      `SELECT id, source, filename, status, imported_users, skipped_rows, error_rows, errors, completed_at, created_at
       FROM platform.import_jobs
       WHERE promoter_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [promoter.promoterId],
    );
    return NextResponse.json({ jobs: result.rows });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const form = await req.formData();
    const file = form.get('file');
    const source = (form.get('source') as string) ?? 'csv';
    const columnMappingRaw = form.get('columnMapping') as string | null;

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Soubor chybí' }, { status: 400 });
    }
    if (!columnMappingRaw) {
      return NextResponse.json({ error: 'columnMapping chybí' }, { status: 400 });
    }

    let mapping: ColumnMapping;
    try {
      mapping = JSON.parse(columnMappingRaw) as ColumnMapping;
    } catch {
      return NextResponse.json({ error: 'columnMapping není validní JSON' }, { status: 400 });
    }

    if (!mapping.email) {
      return NextResponse.json({ error: 'Mapování musí obsahovat sloupec email' }, { status: 400 });
    }

    const text = await (file as File).text();
    const filename = (file as File).name ?? 'import.csv';

    if (text.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Soubor je příliš velký (max 10 MB)' }, { status: 400 });
    }

    const delimiter = detectDelimiter(text.slice(0, 2000));
    const allRows = parseCsv(text, delimiter);
    if (allRows.length < 2) {
      return NextResponse.json({ error: 'CSV nemá žádná data' }, { status: 400 });
    }

    const headers = allRows[0];
    const dataRows = allRows.slice(1);

    const jobRes = await db().query(
      `INSERT INTO platform.import_jobs (promoter_id, source, filename, status)
       VALUES ($1, $2, $3, 'processing')
       RETURNING id`,
      [promoter.promoterId, source, filename],
    );
    const jobId: string = jobRes.rows[0].id;

    let importedUsers = 0;
    let skippedRows = 0;
    let errorRows = 0;
    const errors: Array<{ row: number; reason: string }> = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;

      const email = colValue(row, headers, mapping.email);
      if (!email || !EMAIL_RE.test(email)) {
        errorRows++;
        if (errors.length < 10) {
          errors.push({ row: rowNum, reason: `Neplatný e-mail: ${email ?? '(prázdný)'}` });
        }
        continue;
      }

      const name = colValue(row, headers, mapping.name) ?? null;
      const phone = colValue(row, headers, mapping.phone) ?? null;

      const purchasesRaw = colValue(row, headers, mapping.purchases);
      const historical_purchases = purchasesRaw ? parseInt(purchasesRaw.replace(/\s/g, ''), 10) || null : null;

      const spendRaw = colValue(row, headers, mapping.spend);
      let historical_spend_halire: number | null = null;
      if (spendRaw) {
        const cleaned = spendRaw.replace(/[^\d.,]/g, '').replace(',', '.');
        const val = parseFloat(cleaned);
        if (!isNaN(val)) historical_spend_halire = Math.round(val * 100);
      }

      const firstPurchaseRaw = colValue(row, headers, mapping.firstPurchase);
      const lastPurchaseRaw = colValue(row, headers, mapping.lastPurchase);
      const first_purchase_at = firstPurchaseRaw ? new Date(firstPurchaseRaw) : null;
      const last_purchase_at = lastPurchaseRaw ? new Date(lastPurchaseRaw) : null;

      let userId: string;
      let upsertRes;
      try {
      userId = await resolveContactUser(email, name);

      // Kontakt pořadatele: kontext pořadatele (RLS promoter_contacts.promoter_id = pořadatel).
      upsertRes = await db().query(
        `INSERT INTO platform.promoter_contacts
           (promoter_id, user_id, email, name, phone,
            historical_purchases, historical_spend_halire,
            first_purchase_at, last_purchase_at,
            import_job_id, import_source)
         -- Kolo 3: name / historical_* jsou NOT NULL (default 0) — nenamapovaný sloupec CSV
         -- dřív posílal NULL → 23502 na každém řádku.
         VALUES ($1,$2,$3,COALESCE($4, ''),$5,COALESCE($6, 0),COALESCE($7, 0),$8,$9,$10,$11)
         ON CONFLICT (promoter_id, email) DO UPDATE
           SET name                    = EXCLUDED.name,
               phone                   = EXCLUDED.phone,
               historical_purchases    = EXCLUDED.historical_purchases,
               historical_spend_halire = EXCLUDED.historical_spend_halire,
               first_purchase_at       = EXCLUDED.first_purchase_at,
               last_purchase_at        = EXCLUDED.last_purchase_at,
               import_job_id           = EXCLUDED.import_job_id,
               import_source           = EXCLUDED.import_source
         RETURNING (xmax = 0) AS inserted`,
        [
          promoter.promoterId,
          userId,
          email,
          name,
          phone,
          historical_purchases,
          historical_spend_halire,
          first_purchase_at && !isNaN(first_purchase_at.getTime()) ? first_purchase_at : null,
          last_purchase_at && !isNaN(last_purchase_at.getTime()) ? last_purchase_at : null,
          jobId,
          source,
        ],
      );
      } catch (rowErr) {
        // Kolo 3: chyba jednoho řádku nesmí shodit celý import (job by zůstal „processing").
        errorRows++;
        if (errors.length < 10) errors.push({ row: rowNum, reason: 'Řádek se nepodařilo uložit.' });
        console.error('[admin/import] row', rowNum, rowErr);
        continue;
      }

      if (upsertRes.rows[0].inserted) {
        importedUsers++;
      } else {
        skippedRows++;
      }
    }

    await db().query(
      `UPDATE platform.import_jobs
       SET status='completed', completed_at=NOW(),
           imported_users=$1, skipped_rows=$2, error_rows=$3, errors=$4
       WHERE id=$5`,
      [importedUsers, skippedRows, errorRows, JSON.stringify(errors), jobId],
    );

    return NextResponse.json({
      jobId,
      importedUsers,
      skippedRows,
      errorRows,
      errors: errors.slice(0, 10),
    });
  });
}
