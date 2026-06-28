/**
 * POST /api/rfid/scan
 *
 * Endpoint pro RFID čtecí zařízení (turnikety, NFC čtečky) — TM Presence style.
 * Auth: X-Device-Key: tixly_rfid_<hex>
 *
 * Body: { uid: string }   — RFID UID náramku (hex, 8-28 chars)
 *
 * Response: { result, color, message, zone?, occupancy?, holderName? }
 *   color: "green" | "amber" | "red"  (pro LED displeje na turniketech)
 *
 * Zároveň fungující záruky:
 *   - Anti-passback: atomický INSERT ... ON CONFLICT DO NOTHING (=deny pokud už je uvnitř)
 *   - Kapacita zóny: COUNT(presence) < zone.capacity
 *   - Autorizace ticket type: allowed_ticket_type_ids NULL = vše, jinak whitelist
 *   - Zápis do rfid_access_log pro kompletní audit trail
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

const schema = z.object({
  uid: z.string().min(4).max(28).regex(/^[0-9a-fA-F]+$/),
});

type ScanResult =
  | 'admitted'
  | 'denied_not_authorized'
  | 'denied_anti_passback'
  | 'denied_zone_full'
  | 'denied_no_wristband'
  | 'denied_inactive';

function color(result: ScanResult): 'green' | 'amber' | 'red' {
  if (result === 'admitted') return 'green';
  if (result === 'denied_anti_passback') return 'amber';
  return 'red';
}

function message(result: ScanResult, zoneName: string, direction: string): string {
  const dir = direction === 'out' ? 'Výstup' : 'Vstup';
  switch (result) {
    case 'admitted':            return `${dir} povolen · ${zoneName}`;
    case 'denied_anti_passback': return `Náramek již uvnitř — ${zoneName}`;
    case 'denied_zone_full':    return `Kapacita zóny ${zoneName} plná`;
    case 'denied_not_authorized': return `Náramek nemá přístup do ${zoneName}`;
    case 'denied_no_wristband': return 'Náramek nenalezen — přistup odepřen';
    case 'denied_inactive':     return 'Náramek deaktivován';
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const deviceKey =
    req.headers.get('x-device-key') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!deviceKey || !deviceKey.startsWith('tixly_rfid_')) {
    return NextResponse.json(
      { result: 'denied_inactive', color: 'red', message: 'Chybí nebo neplatný RFID device klíč.' },
      { status: 401 },
    );
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { result: 'denied_inactive', color: 'red', message: 'Neplatný UID formát.' },
      { status: 422 },
    );
  }

  const uid = parsed.data.uid.toUpperCase();

  return runWithServiceContext(async () => {
    // 1. Ověřit device klíč
    const devRes = await db().query<{
      id: string; event_id: string; zone_id: string | null;
      direction: string; active: boolean;
    }>(
      `SELECT id, event_id, zone_id, direction, active
       FROM catalog.rfid_devices WHERE api_key = $1 LIMIT 1`,
      [deviceKey],
    );
    if (devRes.rows.length === 0) {
      return NextResponse.json({ result: 'denied_inactive', color: 'red', message: 'Neznámý device klíč.' }, { status: 401 });
    }
    const device = devRes.rows[0];
    if (!device.active) {
      return NextResponse.json({ result: 'denied_inactive', color: 'red', message: 'Zařízení deaktivováno.' }, { status: 403 });
    }
    if (!device.zone_id) {
      return NextResponse.json({ result: 'denied_inactive', color: 'red', message: 'Zařízení nemá přiřazenou zónu.' }, { status: 400 });
    }

    void db().query(
      `UPDATE catalog.rfid_devices SET last_seen_at = NOW() WHERE id = $1`,
      [device.id],
    ).catch(() => {});

    // 2. Načíst zónu
    const zoneRes = await db().query<{
      id: string; name: string; capacity: number | null;
      anti_passback: boolean; allowed_ticket_type_ids: string[] | null;
    }>(
      `SELECT id, name, capacity, anti_passback, allowed_ticket_type_ids
       FROM catalog.rfid_zones WHERE id = $1 LIMIT 1`,
      [device.zone_id],
    );
    const zone = zoneRes.rows[0];
    if (!zone) {
      return NextResponse.json({ result: 'denied_inactive', color: 'red', message: 'Zóna nenalezena.' }, { status: 400 });
    }

    // Efektivní direction (device může být 'in', 'out' nebo 'both'; 'both' → podle přítomnosti)
    let direction: 'in' | 'out' = device.direction === 'out' ? 'out' : 'in';

    // 3. Načíst náramek + ticket type
    const wbRes = await db().query<{
      ticket_id: string | null; active: boolean;
      holder_name: string | null; ticket_type_id: string | null;
    }>(
      `SELECT w.ticket_id, w.active,
              u.name AS holder_name,
              tt.id AS ticket_type_id
       FROM tickets.wristbands w
       LEFT JOIN tickets.tickets t ON t.id = w.ticket_id
       LEFT JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       LEFT JOIN identity.users u ON u.id = t.owner_id
       WHERE w.uid = $1 LIMIT 1`,
      [uid],
    );

    let result: ScanResult;
    let holderName: string | null = null;

    if (wbRes.rows.length === 0) {
      result = 'denied_no_wristband';
    } else {
      const wb = wbRes.rows[0];
      holderName = wb.holder_name;

      if (!wb.active) {
        result = 'denied_inactive';
      } else if (
        // Pokud direction=both, smart: in pokud mimo, out pokud uvnitř
        device.direction === 'both'
      ) {
        const presRes = await db().query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM catalog.rfid_presence
           WHERE wristband_uid = $1 AND zone_id = $2`,
          [uid, zone.id],
        );
        const inside = parseInt(presRes.rows[0]?.count ?? '0', 10) > 0;
        direction = inside ? 'out' : 'in';
        result = await processAccess(uid, device.event_id, zone, direction, wb.ticket_type_id, device.id);
      } else {
        result = await processAccess(uid, device.event_id, zone, direction, wb.ticket_type_id, device.id);
      }
    }

    // 4. Logovat
    await db().query(
      `INSERT INTO catalog.rfid_access_log
         (event_id, wristband_uid, zone_id, device_id, direction, result)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [device.event_id, uid, zone.id, device.id, direction, result],
    ).catch((err) => console.error('[rfid/scan] log failed:', err));

    // 5. Vrátit výsledek s aktuální obsazeností
    const occRes = await db().query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM catalog.rfid_presence WHERE zone_id = $1`,
      [zone.id],
    );
    const occupancy = parseInt(occRes.rows[0]?.count ?? '0', 10);

    return NextResponse.json({
      result,
      color: color(result),
      message: message(result, zone.name, direction),
      zone: zone.name,
      direction,
      occupancy,
      capacity: zone.capacity,
      holderName,
    });
  });
}

async function processAccess(
  uid: string,
  eventId: string,
  zone: { id: string; capacity: number | null; anti_passback: boolean; allowed_ticket_type_ids: string[] | null },
  direction: 'in' | 'out',
  ticketTypeId: string | null,
  _deviceId: string,
): Promise<ScanResult> {
  // Autorizace ticket type
  if (zone.allowed_ticket_type_ids && zone.allowed_ticket_type_ids.length > 0) {
    if (!ticketTypeId || !zone.allowed_ticket_type_ids.includes(ticketTypeId)) {
      return 'denied_not_authorized';
    }
  }

  if (direction === 'in') {
    // Anti-passback: pokud je náramek already in → deny
    if (zone.anti_passback) {
      const presRes = await db().query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM catalog.rfid_presence
         WHERE wristband_uid = $1 AND zone_id = $2`,
        [uid, zone.id],
      );
      if (parseInt(presRes.rows[0]?.count ?? '0', 10) > 0) {
        return 'denied_anti_passback';
      }
    }

    // Kapacita
    if (zone.capacity !== null) {
      const capRes = await db().query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM catalog.rfid_presence WHERE zone_id = $1`,
        [zone.id],
      );
      if (parseInt(capRes.rows[0]?.count ?? '0', 10) >= zone.capacity) {
        return 'denied_zone_full';
      }
    }

    // Zaznamenat přítomnost (ON CONFLICT DO NOTHING = bezpečné při race condition)
    await db().query(
      `INSERT INTO catalog.rfid_presence (wristband_uid, event_id, zone_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (wristband_uid, event_id, zone_id) DO NOTHING`,
      [uid, eventId, zone.id],
    );
  } else {
    // Výstup: smaž přítomnost
    await db().query(
      `DELETE FROM catalog.rfid_presence
       WHERE wristband_uid = $1 AND event_id = $2 AND zone_id = $3`,
      [uid, eventId, zone.id],
    );
  }

  return 'admitted';
}

/** Generuj unikátní RFID device API klíč */
export function generateRfidDeviceKey(): string {
  return `tixly_rfid_${randomBytes(24).toString('hex')}`;
}
