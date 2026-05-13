// =============================================================================
// Cross-Platform Scanner Service
// Feature #183: Validate tickets from other platforms (Ticketportal, GoOut, Eventim)
//
// Flow:
//   1. Promoter imports CSV from external platform → stored as guest list
//   2. Scanner app downloads guest list (offline-capable)
//   3. At gate: QR scanned → looked up locally → result: valid / duplicate / not_found
//   4. Scan logged back to server when connectivity restored
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export type SourcePlatform = 'ticketportal' | 'goout' | 'eventim' | 'manual' | 'other';

export interface GuestList {
  id: string;
  eventId: string;
  promoterId: string;
  sourcePlatform: SourcePlatform;
  fileName: string;
  ticketCount: number;
  importedBy: string;
  importedAt: string;
  notes: string | null;
}

export interface ImportedTicket {
  id: string;
  guestListId: string;
  externalTicketId: string;
  qrCode: string;
  holderName: string | null;
  seatInfo: string | null;
  ticketType: string | null;
  scannedAt: string | null;
  scannedByStaffId: string | null;
  scanResult: 'valid' | 'duplicate' | 'not_found' | null;
}

export interface ScanValidationResult {
  result: 'valid' | 'duplicate' | 'not_found';
  ticket: ImportedTicket | null;
}

/** One row in the imported CSV */
export interface CsvTicketRow {
  externalTicketId: string;
  qrCode: string;
  holderName?: string;
  seatInfo?: string;
  ticketType?: string;
}

interface GuestListRow {
  id: string;
  event_id: string;
  promoter_id: string;
  source_platform: string;
  file_name: string;
  ticket_count: number;
  imported_by: string;
  imported_at: string;
  notes: string | null;
}

interface ImportedTicketRow {
  id: string;
  guest_list_id: string;
  external_ticket_id: string;
  qr_code: string;
  holder_name: string | null;
  seat_info: string | null;
  ticket_type: string | null;
  scanned_at: string | null;
  scanned_by_staff_id: string | null;
  scan_result: string | null;
}

function mapGuestList(r: GuestListRow): GuestList {
  return {
    id: r.id,
    eventId: r.event_id,
    promoterId: r.promoter_id,
    sourcePlatform: r.source_platform as SourcePlatform,
    fileName: r.file_name,
    ticketCount: r.ticket_count,
    importedBy: r.imported_by,
    importedAt: r.imported_at,
    notes: r.notes,
  };
}

function mapImportedTicket(r: ImportedTicketRow): ImportedTicket {
  return {
    id: r.id,
    guestListId: r.guest_list_id,
    externalTicketId: r.external_ticket_id,
    qrCode: r.qr_code,
    holderName: r.holder_name,
    seatInfo: r.seat_info,
    ticketType: r.ticket_type,
    scannedAt: r.scanned_at,
    scannedByStaffId: r.scanned_by_staff_id,
    scanResult: r.scan_result as ImportedTicket['scanResult'],
  };
}

/**
 * Parse a CSV string into structured ticket rows.
 * Expected columns: external_ticket_id, qr_code, holder_name, seat_info, ticket_type
 * First row is treated as header (case-insensitive column names).
 */
export function parseCsv(csvContent: string): CsvTicketRow[] {
  const lines = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) throw new Error('CSV_PARSE_ERROR: no data rows found');

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z_]/g, '_'));

  const idxExtId = headers.indexOf('external_ticket_id');
  const idxQr = headers.indexOf('qr_code');
  if (idxExtId === -1) throw new Error('CSV_PARSE_ERROR: missing column external_ticket_id');
  if (idxQr === -1) throw new Error('CSV_PARSE_ERROR: missing column qr_code');

  const idxName = headers.indexOf('holder_name');
  const idxSeat = headers.indexOf('seat_info');
  const idxType = headers.indexOf('ticket_type');

  const results: CsvTicketRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV split — handles quoted fields with commas
    const fields = splitCsvLine(line);

    const externalTicketId = fields[idxExtId]?.trim() ?? '';
    const qrCode = fields[idxQr]?.trim() ?? '';

    if (!externalTicketId || !qrCode) continue; // skip empty rows

    results.push({
      externalTicketId,
      qrCode,
      holderName: idxName !== -1 ? (fields[idxName]?.trim() || undefined) : undefined,
      seatInfo: idxSeat !== -1 ? (fields[idxSeat]?.trim() || undefined) : undefined,
      ticketType: idxType !== -1 ? (fields[idxType]?.trim() || undefined) : undefined,
    });
  }

  return results;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Import a guest list from CSV content.
 * Creates the guest list record and bulk-inserts all tickets.
 * Duplicate QR codes within the file are skipped silently.
 */
export async function importGuestList(
  input: {
    eventId: string;
    promoterId: string;
    sourcePlatform: SourcePlatform;
    fileName: string;
    importedBy: string;
    notes?: string;
  },
  csvContent: string,
  db: DbAdapter,
): Promise<{ guestList: GuestList; imported: number; skipped: number }> {
  const rows = parseCsv(csvContent);
  if (rows.length === 0) throw new Error('VALIDATION_ERROR: CSV contains no valid ticket rows');

  // Create guest list record
  const listRows = await db.query<GuestListRow>(
    `INSERT INTO cross_scanner.guest_lists
       (event_id, promoter_id, source_platform, file_name, ticket_count, imported_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.eventId,
      input.promoterId,
      input.sourcePlatform,
      input.fileName,
      rows.length,
      input.importedBy,
      input.notes ?? null,
    ],
  );

  const guestList = listRows[0];
  let imported = 0;
  let skipped = 0;

  // Insert tickets, skipping duplicates
  for (const row of rows) {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO cross_scanner.imported_tickets
         (guest_list_id, external_ticket_id, qr_code, holder_name, seat_info, ticket_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (qr_code) DO NOTHING
       RETURNING id`,
      [
        guestList.id,
        row.externalTicketId,
        row.qrCode,
        row.holderName ?? null,
        row.seatInfo ?? null,
        row.ticketType ?? null,
      ],
    );
    if (inserted.length > 0) {
      imported++;
    } else {
      skipped++;
    }
  }

  // Update actual imported count
  await db.execute(
    `UPDATE cross_scanner.guest_lists SET ticket_count = $2 WHERE id = $1`,
    [guestList.id, imported],
  );

  return { guestList: mapGuestList(guestList), imported, skipped };
}

/**
 * Validate an external ticket QR at the gate.
 * Marks it as scanned; returns 'duplicate' if already scanned.
 */
export async function validateExternalTicket(
  qrCode: string,
  staffId: string | null,
  db: DbAdapter,
): Promise<ScanValidationResult> {
  const tickets = await db.query<ImportedTicketRow>(
    `SELECT * FROM cross_scanner.imported_tickets WHERE qr_code = $1`,
    [qrCode],
  );

  if (!tickets[0]) {
    return { result: 'not_found', ticket: null };
  }

  const ticket = tickets[0];

  if (ticket.scanned_at !== null) {
    // Already scanned — duplicate attempt
    return { result: 'duplicate', ticket: mapImportedTicket(ticket) };
  }

  // Mark as scanned atomically
  const updated = await db.query<ImportedTicketRow>(
    `UPDATE cross_scanner.imported_tickets
     SET scanned_at = NOW(), scanned_by_staff_id = $2, scan_result = 'valid'
     WHERE id = $1 AND scanned_at IS NULL
     RETURNING *`,
    [ticket.id, staffId],
  );

  if (!updated[0]) {
    // Race condition: someone else scanned it between our SELECT and UPDATE
    return { result: 'duplicate', ticket: mapImportedTicket(ticket) };
  }

  return { result: 'valid', ticket: mapImportedTicket(updated[0]) };
}

/**
 * Get scan statistics for an event's guest lists.
 */
export async function getScanStats(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<{
  totalTickets: number;
  scanned: number;
  notScanned: number;
  byPlatform: Array<{ sourcePlatform: string; total: number; scanned: number }>;
}> {
  const totalsRows = await db.query<{
    total: string;
    scanned: string;
  }>(
    `SELECT
       COUNT(t.id) AS total,
       COUNT(t.scanned_at) AS scanned
     FROM cross_scanner.imported_tickets t
     JOIN cross_scanner.guest_lists gl ON gl.id = t.guest_list_id
     WHERE gl.event_id = $1 AND gl.promoter_id = $2`,
    [eventId, promoterId],
  );

  const byPlatformRows = await db.query<{
    source_platform: string;
    total: string;
    scanned: string;
  }>(
    `SELECT
       gl.source_platform,
       COUNT(t.id) AS total,
       COUNT(t.scanned_at) AS scanned
     FROM cross_scanner.imported_tickets t
     JOIN cross_scanner.guest_lists gl ON gl.id = t.guest_list_id
     WHERE gl.event_id = $1 AND gl.promoter_id = $2
     GROUP BY gl.source_platform`,
    [eventId, promoterId],
  );

  const total = Number(totalsRows[0]?.total ?? 0);
  const scanned = Number(totalsRows[0]?.scanned ?? 0);

  return {
    totalTickets: total,
    scanned,
    notScanned: total - scanned,
    byPlatform: byPlatformRows.map((r) => ({
      sourcePlatform: r.source_platform,
      total: Number(r.total),
      scanned: Number(r.scanned),
    })),
  };
}

/**
 * List guest lists for an event.
 */
export async function listGuestLists(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<GuestList[]> {
  const rows = await db.query<GuestListRow>(
    `SELECT * FROM cross_scanner.guest_lists
     WHERE event_id = $1 AND promoter_id = $2
     ORDER BY imported_at DESC`,
    [eventId, promoterId],
  );
  return rows.map(mapGuestList);
}
