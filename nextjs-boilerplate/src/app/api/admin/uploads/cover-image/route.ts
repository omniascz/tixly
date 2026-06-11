/**
 * POST /api/admin/uploads/cover-image
 *
 * Multipart upload pro cover image akcí. Lazy import @vercel/blob —
 * pokud package není nainstalovaný NEBO BLOB_READ_WRITE_TOKEN chybí,
 * vrací 503 s instrukcí. Promotér může mezitím použít URL paste.
 *
 * Validace: image/jpeg|png|webp, max 5 MB, naming
 * events/{promoterId}/cover-{rand}.{ext}.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePromoter } from '@/lib/admin-auth';

interface BlobLib {
  put: (
    pathname: string,
    body: ArrayBuffer | Blob,
    opts: { access: 'public'; contentType?: string; token?: string },
  ) => Promise<{ url: string; pathname: string; contentType: string; size: number }>;
}

let blobModule: BlobLib | null | undefined;

async function getBlob(): Promise<BlobLib | null> {
  if (blobModule !== undefined) return blobModule;
  try {
    const mod = (await import('@vercel/blob' as string)) as unknown as BlobLib;
    blobModule = mod;
    return mod;
  } catch {
    blobModule = null;
    return null;
  }
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) {
    return NextResponse.json({ error: 'Not a promoter member' }, { status: 403 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          'Blob storage není nakonfigurované. Nastav BLOB_READ_WRITE_TOKEN env var nebo použij URL paste.',
      },
      { status: 503 },
    );
  }

  const blob = await getBlob();
  if (!blob) {
    return NextResponse.json(
      {
        error:
          '@vercel/blob package není nainstalovaný. Spusť `npm install @vercel/blob` a re-deploy.',
      },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Multipart parse failed' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'Allowed: image/jpeg, image/png, image/webp' },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'File too large. Max 5 MB.' },
      { status: 413 },
    );
  }

  const ext = EXT_BY_TYPE[file.type] ?? 'bin';
  const rand = Math.random().toString(36).slice(2, 10);
  const pathname = `events/${promoter.promoterId}/cover-${Date.now()}-${rand}.${ext}`;

  try {
    const result = await blob.put(pathname, file, {
      access: 'public',
      contentType: file.type,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return NextResponse.json({
      url: result.url,
      pathname: result.pathname,
      size: result.size,
      contentType: result.contentType,
    });
  } catch (err) {
    console.error('[POST /api/admin/uploads/cover-image]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
