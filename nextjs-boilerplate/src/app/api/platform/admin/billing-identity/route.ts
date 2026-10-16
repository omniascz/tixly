/**
 * Fakturační údaje platformy jako dodavatele (kolo 7, C-54) — platform.billing_identity (jeden řádek).
 *   GET  aktuální údaje (null = nevyplněno → faktury provize nejde vystavit)
 *   PUT  uloží údaje (plátce DPH musí mít DIČ)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { isValidCzDic } from '@/lib/tax/vat';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const r = await db().query(`SELECT * FROM platform.billing_identity WHERE id = 1`);
    return NextResponse.json({ billingIdentity: r.rows[0] ?? null });
  });
}

const schema = z.object({
  legalName: z.string().min(2).max(200),
  ico: z.string().regex(/^[0-9]{8}$/),
  dic: z.string().max(14).nullable().optional(),
  vatPayer: z.boolean(),
  street: z.string().min(2).max(200),
  city: z.string().min(1).max(100),
  zip: z.string().min(3).max(10),
  country: z.string().length(2).default('CZ'),
  bankAccount: z.string().max(60).nullable().optional(),
  email: z.string().email().nullable().optional(),
});

export async function PUT(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    const b = parsed.data;
    if (b.vatPayer && !isValidCzDic(b.dic)) {
      return NextResponse.json(
        { error: 'DIC_REQUIRED', message: 'Plátce DPH musí mít platné DIČ (CZ + 8–10 číslic).' },
        { status: 422 },
      );
    }
    await db().query(
      `INSERT INTO platform.billing_identity (id, legal_name, ico, dic, vat_payer, street, city, zip, country, bank_account, email, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (id) DO UPDATE SET legal_name = EXCLUDED.legal_name, ico = EXCLUDED.ico, dic = EXCLUDED.dic,
         vat_payer = EXCLUDED.vat_payer, street = EXCLUDED.street, city = EXCLUDED.city, zip = EXCLUDED.zip,
         country = EXCLUDED.country, bank_account = EXCLUDED.bank_account, email = EXCLUDED.email, updated_at = now()`,
      [b.legalName, b.ico, b.vatPayer ? b.dic : null, b.vatPayer, b.street, b.city, b.zip, b.country.toUpperCase(), b.bankAccount ?? null, b.email ?? null],
    );
    return NextResponse.json({ ok: true });
  });
}
