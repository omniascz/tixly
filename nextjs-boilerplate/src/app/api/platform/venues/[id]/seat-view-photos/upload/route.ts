/**
 * POST /api/platform/venues/[id]/seat-view-photos/upload
 *
 * Multipart upload fotky pro View-from-seat. Stejný pattern jako cover-image:
 * lazy import @vercel/blob, graceful fallback na URL paste pokud není token.
 *
 * Platform admin only. Max 10 MB, image/jpeg|png|webp.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/platform-auth';

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
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'Blob storage není nakonfigurované. Použij URL paste.' },
      { status: 503 },
    );
  }

  const blob = await getBlob();
  if (!blob) {
    return NextResponse.json(
      { error: '@vercel/blob není nainstalovaný. Použij URL paste.' },
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
    return NextResponse.json({ error: 'Allowed: image/jpeg, image/png, image/webp' }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Max 10 MB.' }, { status: 413 });
  }

  const extMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const ext = extMap[file.type] ?? 'bin';
  const rand = Math.random().toString(36).slice(2, 10);
  const pathname = `seat-view/${params.id}/${Date.now()}-${rand}.${ext}`;

  try {
    const result = await blob.put(pathname, file, {
      access: 'public',
      contentType: file.type,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return NextResponse.json({ url: result.url, size: result.size });
  } catch (err) {
    console.error('[POST seat-view-photos/upload]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
