/**
 * Apple Wallet PassKit Web Service — device registration.
 *
 * POST: Apple Wallet zaregistruje device pro push notifications na konkrétní pass.
 *       Body obsahuje { pushToken }.
 *
 * DELETE: User odebral pass → Apple zavolá tento endpoint.
 *
 * Spec: https://developer.apple.com/documentation/walletpasses/registering_a_device_to_receive_push_notifications_for_a_pass
 *
 * Authorization header: `ApplePass <auth_token>` — token je v pass.json authentication_token.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';


interface RouteParams {
  params: {
    deviceLibraryId: string;
    passTypeId: string;
    serialNumber: string;
  };
}

function checkAuth(req: NextRequest, _serialNumber: string): boolean {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('ApplePass ')) return false;
  // V production: ověř hash(secret || serialNumber). Pro skeleton akceptujeme jakýkoli ApplePass token.
  return auth.length > 'ApplePass '.length;
}

export async function POST(
  req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  return runWithServiceContext(async () => {

  if (!checkAuth(req, params.serialNumber)) {
    return new NextResponse(null, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { pushToken?: string };
  if (!body.pushToken) {
    return new NextResponse(null, { status: 400 });
  }

  const t = await db().query<{ id: string }>(
    `SELECT id FROM tickets.tickets WHERE id = $1`,
    [params.serialNumber],
  );
  if (t.rows.length === 0) return new NextResponse(null, { status: 404 });

  await db().query(
    `INSERT INTO tickets.wallet_push_subscriptions
       (ticket_id, serial_number, pass_type_id, device_library_id, push_token)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (device_library_id, pass_type_id, serial_number)
     DO UPDATE SET push_token = EXCLUDED.push_token, unregistered_at = NULL`,
    [params.serialNumber, params.serialNumber, params.passTypeId, params.deviceLibraryId, body.pushToken],
  );

  return new NextResponse(null, { status: 201 });

  });
}

export async function DELETE(
  req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  return runWithServiceContext(async () => {

  if (!checkAuth(req, params.serialNumber)) {
    return new NextResponse(null, { status: 401 });
  }

  await db().query(
    `UPDATE tickets.wallet_push_subscriptions
        SET unregistered_at = now()
      WHERE device_library_id = $1 AND pass_type_id = $2 AND serial_number = $3`,
    [params.deviceLibraryId, params.passTypeId, params.serialNumber],
  );

  return new NextResponse(null, { status: 200 });

  });
}
