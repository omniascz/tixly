import { NextRequest, NextResponse } from 'next/server';
import {
  createProfile,
  getProfile,
  updateProfile,
  deleteProfile,
  updateNotificationPrefs,
  acceptTerms,
} from '../../../../../services/profile.service';
import { isPortalError } from '../../../../../lib/portal-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') ?? '';
    const db = getDb();
    const profile = await getProfile(userId, params.promoterId, db);
    return NextResponse.json(profile);
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  try {
    const body = await request.json();
    const { userId, ...input } = body;
    const db = getDb();
    const profile = await createProfile(userId, params.promoterId, input, db);
    return NextResponse.json(profile, { status: 201 });
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') ?? '';
    const body = await request.json();
    const db = getDb();

    if (body.action === 'acceptTerms') {
      const profile = await acceptTerms(userId, params.promoterId, db);
      return NextResponse.json(profile);
    }

    if (body.notificationEmail !== undefined || body.notificationSms !== undefined || body.notificationPush !== undefined) {
      const profile = await updateNotificationPrefs(userId, params.promoterId, body, db);
      return NextResponse.json(profile);
    }

    const profile = await updateProfile(userId, params.promoterId, body, db);
    return NextResponse.json(profile);
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') ?? '';
    const db = getDb();
    await deleteProfile(userId, params.promoterId, db);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
