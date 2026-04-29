/**
 * POST /api/blacklist/import
 *
 * Bulk-import blacklist entries from a CSV body (Content-Type: text/csv).
 * Admin/CS only. Imported rows default to platform (shared) scope so they are
 * visible to all promoters via checkBan precedence.
 *
 * Headers:
 *   x-user-id   — authenticated caller's UUID
 *   x-user-role — 'admin' (CS role maps to admin for this endpoint)
 */
import { NextRequest, NextResponse } from 'next/server';
import { banUser } from '../../../../services/blacklist.service.js';
import type { UserRole } from '../../../../types/blacklist.types.js';
import { toHttpError } from '../../../../types/blacklist.types.js';
import { getServiceContainer } from '../../../../lib/service-container.js';
import { parseBlacklistCsv, CsvParseError } from '../../../../lib/csv-handler.js';
import { recordCsAction } from '../../../../lib/cs-audit.js';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const callerId = request.headers.get('x-user-id');
  const role = (request.headers.get('x-user-role') ?? 'buyer') as UserRole;

  if (!callerId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  let csvText: string;
  try {
    csvText = await request.text();
  } catch {
    return NextResponse.json(
      { error: 'Failed to read request body.', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  let parsed;
  try {
    parsed = parseBlacklistCsv(csvText);
  } catch (err) {
    if (err instanceof CsvParseError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    throw err;
  }

  const deps = getServiceContainer();
  const created: string[] = [];
  const failed: Array<{ identifier: string; error: string }> = [];

  for (const row of parsed) {
    try {
      const entry = await banUser(
        deps,
        {
          userId: row.identifier,
          email: row.identifier,
          scope: 'platform',
          reason: row.reason,
          bannedBy: callerId,
        },
        role,
      );
      created.push(entry.id);
    } catch (err) {
      failed.push({
        identifier: row.identifier,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    await recordCsAction(deps.db, {
      actorId: callerId,
      actorRole: role,
      action: 'entry.imported',
      payload: { total: parsed.length, created: created.length, failed: failed.length },
    });
  } catch (err) {
    console.error('[buyer-blacklist] Failed to record CS audit for import:', err);
  }

  try {
    return NextResponse.json(
      { imported: created.length, failed, total: parsed.length },
      { status: 201 },
    );
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
