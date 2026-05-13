import { NextRequest, NextResponse } from 'next/server';
import { addTag, removeTag, getTags } from '../../../../../../services/screening-tag.service';
import { isCinemaProgramError } from '../../../../../../lib/cinema-program-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { screeningId: string } },
) {
  try {
    const db = getDb();
    const tags = await getTags(params.screeningId, db);
    return NextResponse.json({ tags });
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { screeningId: string } },
) {
  try {
    const body = await request.json() as { tag: string };
    const db = getDb();
    await addTag(params.screeningId, body.tag, db);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { screeningId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const tag = searchParams.get('tag');
    if (!tag) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'tag is required' }, { status: 400 });
    }
    const db = getDb();
    await removeTag(params.screeningId, tag, db);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
