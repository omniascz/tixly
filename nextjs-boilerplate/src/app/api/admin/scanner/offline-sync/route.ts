/**
 * POST /api/admin/scanner/offline-sync — kolo 14 / krok 1 (C-50): odeslání offline odbavení po obnovení sítě.
 *
 * Body: { deviceId, scans: [{ clientScanId, ticketId | printToken, eventId, scannedAt, offlineResult, offlineReason? }] }
 *
 * Každý sken se zapíše do tickets.scan_logs (offline = true, scanned_at = čas na zařízení, offline_result = verdikt zařízení):
 *   - idempotence: client_scan_id je unikátní — opakované odeslání téhož skenu vrátí původní výsledek (replay), nic nezdvojí;
 *   - zařízení vpustilo + vstupenka platná  → vstupenka 'used' (used_at = čas skenu), záznam 'admitted';
 *   - zařízení vpustilo + vstupenka už použitá (jiný skener / online) → záznam 'duplicate' (počet je v reportu termínu);
 *   - zařízení vpustilo + vstupenka mezitím zrušená (starý seznam) → záznam 'denied' / revoked, vstupenka zůstává zrušená;
 *   - zařízení odmítlo → záznam 'denied' / 'already_used' s důvodem zařízení, stav vstupenky beze změny.
 * TOTP se tu znovu neověřuje (kód ze skenu už neplatí) — ověřilo ho zařízení proti offline seznamu.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { parsePrintToken, verifyPrintTokenForEvent } from '@/lib/tickets/print-token';

export const dynamic = 'force-dynamic';

const scanSchema = z.object({
  clientScanId: z.string().uuid(),
  ticketId: z.string().regex(/^[0-9a-f-]{36}$/i).optional(),
  printToken: z.string().min(8).max(80).optional(),
  eventId: z.string().uuid().optional(),
  scannedAt: z.string().datetime({ offset: true }),
  offlineResult: z.string().min(1).max(40),
  offlineReason: z.string().max(80).optional(),
}).refine((s) => s.ticketId || s.printToken, { message: 'ticketId nebo printToken je vyžadován' });

const bodySchema = z.object({
  deviceId: z.string().min(1).max(64),
  scans: z.array(scanSchema).min(1).max(200),
});

type Scan = z.infer<typeof scanSchema>;
interface Outcome { clientScanId: string; result: string; replay?: boolean }

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    const { deviceId, scans } = parsed.data;
    const results: Outcome[] = [];
    // po jednom v pořadí skenů na zařízení (každý vlastní transakce — chyba jednoho nezahodí ostatní)
    for (const scan of [...scans].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt))) {
      results.push(await syncOne(scan, deviceId, promoter.promoterId));
    }
    return NextResponse.json({ results });
  });
}

async function syncOne(scan: Scan, deviceId: string, promoterId: string): Promise<Outcome> {
  let ticketId = scan.ticketId?.toLowerCase();
  if (!ticketId && scan.printToken) {
    const pt = parsePrintToken(scan.printToken);
    if (!pt) return { clientScanId: scan.clientScanId, result: 'invalid_token' };
    ticketId = pt.ticketId;
  }
  const scannedAt = new Date(Math.min(new Date(scan.scannedAt).getTime(), Date.now()));
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // zámek vstupenky serializuje souběžné synchronizace téže vstupenky (dva skenery) i opakované odeslání téhož skenu
    const t = (await client.query<{ id: string; status: string; event_id: string; promoter_id: string }>(
      `SELECT t.id, t.status, o.event_id, e.promoter_id
         FROM tickets.tickets t JOIN orders.orders o ON o.id = t.order_id JOIN catalog.events e ON e.id = o.event_id
        WHERE t.id = $1 FOR UPDATE OF t`,
      [ticketId],
    )).rows[0];
    if (!t || t.promoter_id !== promoterId) {
      await client.query('ROLLBACK');
      return { clientScanId: scan.clientScanId, result: 'not_found' };
    }
    const prev = (await client.query<{ scan_result: string }>(
      `SELECT scan_result FROM tickets.scan_logs WHERE client_scan_id = $1`, [scan.clientScanId],
    )).rows[0];
    if (prev) {
      await client.query('ROLLBACK');
      return { clientScanId: scan.clientScanId, result: prev.scan_result, replay: true };
    }

    let result: string; let reason: string | null = null;
    const printOk = !scan.printToken || verifyPrintTokenForEvent(scan.printToken, t.event_id).ok;
    if (scan.offlineResult !== 'admitted') {
      result = scan.offlineResult === 'already_used' ? 'already_used' : 'denied';
      reason = scan.offlineReason ?? scan.offlineResult;
    } else if (!printOk) {
      result = 'denied'; reason = 'invalid_token';
    } else if (scan.eventId && scan.eventId !== t.event_id) {
      result = 'denied'; reason = 'wrong_event';
    } else if (t.status === 'valid') {
      await client.query(`UPDATE tickets.tickets SET status = 'used', used_at = $2, updated_at = NOW() WHERE id = $1`, [t.id, scannedAt]);
      result = 'admitted';
    } else if (t.status === 'used') {
      result = 'duplicate'; reason = 'offline_duplicate';
    } else if (t.status === 'revoked') {
      result = 'denied'; reason = 'revoked';
    } else {
      result = 'denied'; reason = `invalid_status:${t.status}`;
    }

    const ins = await client.query(
      `INSERT INTO tickets.scan_logs
         (ticket_id, event_id, scanned_by_device_id, device_label, scan_result, denied_reason, scanned_at, client_scan_id, offline, offline_result)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, true, $8)
       ON CONFLICT (client_scan_id) WHERE client_scan_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [t.id, t.event_id, deviceId.slice(0, 64), result, reason, scannedAt, scan.clientScanId, scan.offlineResult],
    );
    if (ins.rowCount === 0) {
      await client.query('ROLLBACK');
      return { clientScanId: scan.clientScanId, result, replay: true };
    }
    await client.query('COMMIT');
    return { clientScanId: scan.clientScanId, result };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[scanner/offline-sync]', err);
    return { clientScanId: scan.clientScanId, result: 'error' };
  } finally {
    client.release();
  }
}
