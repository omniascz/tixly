// @vitest-environment node
/**
 * Kolo 16 / krok 3 — nahrávání do Vercel Blob (titulní obrázek akce, artwork fanouškovské vstupenky, fotky výhledu)
 * musí po upgradu @vercel/blob 0.27 → 2.x fungovat stejně.
 *
 * Falešné Blob API (VERCEL_BLOB_API_URL) napodobuje server Vercel podle hlavičky x-api-version: klient 0.27 posílá
 * verzi 9 (výchozí: náhodná přípona ANO, přepsání ANO), klient ≥ 1.0 verzi 11 (výchozí: přípona NE, přepsání NE —
 * changelog @vercel/blob 1.0.0). Explicitní hlavičky x-add-random-suffix / x-allow-overwrite mají přednost.
 * Ověřuje se výsledné chování: přípona u titulního obrázku a fotek výhledu, opakované nahrání artworku projde.
 */
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLiveClone, hasLiveDb, makeSeed, type LiveClone } from './helpers/live-fixture';

const d = hasLiveDb ? describe : describe.skip;
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'); // hlavička PNG
type Req = { pathname: string; stored: string; apiVersion: number; suffix?: string; overwrite?: string; status: number };

d('Vercel Blob — nahrávání se po upgradu chová stejně', () => {
  let clone: LiveClone; let server: Server; let base = '';
  const store = new Set<string>(); const reqs: Req[] = [];
  let chain: Awaited<ReturnType<ReturnType<typeof makeSeed>['chain']>>;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const pathname = u.searchParams.get('pathname') ?? '';
        const v = Number(req.headers['x-api-version'] ?? 0);
        const suffixH = req.headers['x-add-random-suffix'] as string | undefined;
        const overH = req.headers['x-allow-overwrite'] as string | undefined;
        const random = suffixH !== undefined ? suffixH === '1' : v < 10;
        const overwrite = overH !== undefined ? overH === '1' : v < 10;
        const stored = random ? pathname.replace(/(\.[a-z0-9]+)?$/i, (ext) => `-R4nd0mSuff1x${ext}`) : pathname;
        const r: Req = { pathname, stored, apiVersion: v, suffix: suffixH, overwrite: overH, status: 200 };
        if (store.has(stored) && !overwrite) {
          r.status = 400; reqs.push(r);
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'store_blob_already_exists', message: 'This blob already exists' } }));
          return;
        }
        store.add(stored); reqs.push(r);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ url: `https://fake.blob/${stored}`, downloadUrl: `https://fake.blob/${stored}?download=1`, pathname: stored, contentType: req.headers['x-content-type'] ?? 'application/octet-stream', contentDisposition: 'inline', size: Buffer.concat(chunks).length }));
      });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    clone = await createLiveClone('blob-upload');
    process.env.VERCEL_BLOB_API_URL = base;
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_fakestore_r16test';
    chain = await makeSeed(clone.pool).chain();
    await clone.pool.query('UPDATE identity.users SET is_platform_admin = true WHERE id = $1', [chain.adminUserId]);
  }, 240_000);

  afterAll(async () => {
    await clone?.cleanup();
    await new Promise<void>((ok) => server?.close(() => ok()));
  }, 120_000);

  const upload = async (url: string, field: string, name: string) => {
    const fd = new FormData();
    fd.append(field, new File([PNG], name, { type: 'image/png' }));
    // fotky výhledu ověřují platform admina přístupovým tokenem (Bearer), ostatní routy x-user-id z middleware
    const { signAccessToken } = await import('@/lib/auth');
    const token = await signAccessToken({ id: chain.adminUserId, email: 'admin@blob.test', name: 'Admin' }, { isPlatformAdmin: true, promoterMemberships: [] });
    return new NextRequest(`http://localhost:3000${url}`, { method: 'POST', headers: { 'x-user-id': chain.adminUserId, authorization: `Bearer ${token}` }, body: fd });
  };

  it('titulní obrázek akce: nahrání projde, uložený název má náhodnou příponu (jako v 0.27)', async () => {
    const { POST } = await import('@/app/api/admin/uploads/cover-image/route');
    const res = await POST(await upload('/api/admin/uploads/cover-image', 'file', 'cover.png'));
    expect(res.status, await res.clone().text()).toBe(200);
    const r = reqs.at(-1)!;
    expect(r.pathname).toMatch(/^events\//);
    expect(r.stored, 'náhodná přípona').toMatch(/-R4nd0mSuff1x\.png$/);
  });

  it('fotka výhledu z místa: nahrání projde, náhodná přípona', async () => {
    const { POST } = await import('@/app/api/platform/venues/[id]/seat-view-photos/upload/route');
    const res = await POST(await upload(`/api/platform/venues/${chain.venueId}/seat-view-photos/upload`, 'file', 'vyhled.png'), { params: Promise.resolve({ id: chain.venueId }) });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(reqs.at(-1)!.stored).toMatch(/^seat-view\/.*-R4nd0mSuff1x\.png$/);
  });

  it('artwork fanouškovské vstupenky: pevný název, opakované nahrání přepíše (jako v 0.27)', async () => {
    const { POST } = await import('@/app/api/admin/events/[id]/fan-ticket/artwork/route');
    const call = async () => POST(await upload(`/api/admin/events/${chain.eventId}/fan-ticket/artwork`, 'artwork', 'art.png'), { params: Promise.resolve({ id: chain.eventId }) });
    const first = await call();
    expect(first.status, await first.clone().text()).toBe(200);
    const second = await call();
    expect(second.status, await second.clone().text()).toBe(200);
    const arts = reqs.filter((x) => x.pathname.startsWith('fan-ticket/'));
    expect(arts.map((x) => x.stored)).toEqual([`fan-ticket/${chain.eventId}/artwork.png`, `fan-ticket/${chain.eventId}/artwork.png`]);
    expect(arts.every((x) => x.status === 200)).toBe(true);
  });
});
