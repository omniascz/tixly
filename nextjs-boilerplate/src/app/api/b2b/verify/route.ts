import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeB2BCreditUser } from '@/lib/b2b/credit-authorization';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const schema = z.object({
  accountCode: z.string().min(4).max(20),
  // Ponecháno kvůli stávajícím klientům; o oprávnění nerozhoduje (rozhoduje přihlášení).
  email: z.string().email().optional(),
});

async function POSTImpl(req: NextRequest): Promise<Response> {
  // Kolo 4: dřív stačil kód účtu (a e-mail z těla, který nic neprokazuje) ke zjištění názvu
  // firmy a ZŮSTATKU kreditu. Teď jen přihlášený člen účtu (lib/b2b/credit-authorization).
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ valid: false, error: 'LOGIN_REQUIRED' }, { status: 401 });
  }
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ valid: false, error: 'INVALID_INPUT' }, { status: 422 });
  }
  const account = await authorizeB2BCreditUser(db(), parsed.data.accountCode, userId);
  if (!account) {
    // Neexistující kód i cizí účet stejně — kód se nedá ověřit hádáním.
    return NextResponse.json({ valid: false, error: 'EMAIL_NOT_AUTHORIZED' }, { status: 403 });
  }
  return NextResponse.json({
    valid: true,
    companyName: account.companyName,
    balanceHalire: account.balanceHalire,
  });
}

// Obaleno servisnim kontextem (FINDINGS 110 / migrace 463).
// B2B identita neni app.current_user_id — autorizace jde pres verifyB2BToken
// a scoping podle session.b2bAccountId zustava v route. Servisni kontext
// drzi rozhodnuti v aplikaci, kde je videt (vzorec 94).

export async function POST(...a: Parameters<typeof POSTImpl>): Promise<Response> {
  return runWithServiceContext(() => POSTImpl(...a));
}
