import { NextRequest, NextResponse } from 'next/server';
import { validateScan } from '../../../../services/barcode.service.js';
import {
  BarcodeNotFoundError,
  BarcodeAlreadyScannedError,
  TicketExpiredError,
  InvalidBarcodeFormatError,
} from '../../../../types/barcode.types.js';
import type { DbAdapter } from '../../../../types/barcode.types.js';

// ---------------------------------------------------------------------------
// Dependency injection — v produkci nahradit reálným pg adaptérem
// ---------------------------------------------------------------------------

// Stub — nahradit reálnou implementací v DI vrstvě aplikace
declare const db: DbAdapter;

// ---------------------------------------------------------------------------
// Rate limiting (100 req/min per device)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory rate limit store — v produkci nahradit Redis
const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(deviceId: string): boolean {
  const now = Date.now();
  const key = deviceId;
  const entry = rateLimitStore.get(key);

  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

// Čištění starých záznamů každých 5 minut (zabráníme memory leak)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now >= entry.resetAt) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60_000);
}

// ---------------------------------------------------------------------------
// Gate device autentizace
// ---------------------------------------------------------------------------

/**
 * Ověří gate device token z headeru X-Gate-Device-Id.
 *
 * V produkci: porovnej s HMAC-signed token nebo lookup v DB gate_devices tabulce.
 * Gate zařízení mají statické API klíče (ne JWT — turnikety nejdou snadno rotovat).
 */
function authenticateGateDevice(request: NextRequest): string | null {
  const deviceId = request.headers.get('x-gate-device-id');

  if (!deviceId || deviceId.trim().length === 0) {
    return null;
  }

  // V produkci: ověř deviceId v DB nebo proti hashovaným tokenům
  // Např: const valid = await db.isValidGateDevice(deviceId);
  return deviceId.trim();
}

// ---------------------------------------------------------------------------
// Request/Response typy
// ---------------------------------------------------------------------------

interface GateBarcodeRequest {
  code: string;
}

interface GateBarcodeResponseValid {
  valid: true;
  holderName: string;
  eventName: string;
  eventDate: string;  // ISO 8601
  seatInfo: string | null;
  zone: string | null;
  ticketId: string;
}

interface GateBarcodeResponseInvalid {
  valid: false;
  reason: 'already_scanned' | 'not_found' | 'expired' | 'invalid_format';
  scannedAt?: string;   // ISO 8601, pouze pro already_scanned
  scannedBy?: string;   // gate device ID, pouze pro already_scanned
}

type GateBarcodeResponse = GateBarcodeResponseValid | GateBarcodeResponseInvalid;

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * POST /api/gate/barcode
 *
 * Skenování čárového kódu na turniketu.
 * Vždy vrátí HTTP 200 — gate zařízení musí snadno zpracovat odpověď.
 *
 * Headers:
 *   X-Gate-Device-Id: gate-device-01  (povinný)
 *
 * Body: { "code": "TK-2026-847291-X3" }
 *
 * Response 200 (platná vstupenka):
 *   { valid: true, holderName: "Jan Novák", eventName: "...", ... }
 *
 * Response 200 (neplatná vstupenka):
 *   { valid: false, reason: "already_scanned" | "not_found" | "expired" | "invalid_format" }
 *
 * Response 401: Chybí nebo neplatný X-Gate-Device-Id header
 * Response 429: Rate limit překročen (100 req/min per device)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Autentizace gate zařízení
  const deviceId = authenticateGateDevice(request);
  if (!deviceId) {
    return NextResponse.json(
      { error: 'Neautorizovaný přístup. Chybí nebo neplatný X-Gate-Device-Id header.' },
      { status: 401 },
    );
  }

  // 2. Rate limiting
  if (!checkRateLimit(deviceId)) {
    return NextResponse.json(
      { error: 'Příliš mnoho požadavků. Limit: 100 req/min.' },
      {
        status: 429,
        headers: {
          'Retry-After': '60',
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
          'X-RateLimit-Window': '60',
        },
      },
    );
  }

  // 3. Parsování request body
  let body: GateBarcodeRequest;
  try {
    body = (await request.json()) as GateBarcodeRequest;
  } catch {
    return NextResponse.json(
      { valid: false, reason: 'invalid_format' } satisfies GateBarcodeResponseInvalid,
      { status: 200 },
    );
  }

  if (!body.code || typeof body.code !== 'string') {
    return NextResponse.json(
      { valid: false, reason: 'invalid_format' } satisfies GateBarcodeResponseInvalid,
      { status: 200 },
    );
  }

  // 4. Validace skenování
  try {
    const result = await validateScan(body.code, deviceId, db);

    const response: GateBarcodeResponseValid = {
      valid: true,
      holderName: result.holderName!,
      eventName: result.eventName!,
      eventDate: result.eventDate!.toISOString(),
      seatInfo: result.seatInfo ?? null,
      zone: result.zone ?? null,
      ticketId: result.ticketId!,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    if (err instanceof BarcodeAlreadyScannedError) {
      const response: GateBarcodeResponseInvalid = {
        valid: false,
        reason: 'already_scanned',
        scannedAt: err.scannedAt.toISOString(),
        scannedBy: err.scannedBy,
      };
      return NextResponse.json(response, { status: 200 });
    }

    if (err instanceof BarcodeNotFoundError) {
      return NextResponse.json(
        { valid: false, reason: 'not_found' } satisfies GateBarcodeResponseInvalid,
        { status: 200 },
      );
    }

    if (err instanceof TicketExpiredError) {
      return NextResponse.json(
        { valid: false, reason: 'expired' } satisfies GateBarcodeResponseInvalid,
        { status: 200 },
      );
    }

    if (err instanceof InvalidBarcodeFormatError) {
      return NextResponse.json(
        { valid: false, reason: 'invalid_format' } satisfies GateBarcodeResponseInvalid,
        { status: 200 },
      );
    }

    // Neočekávaná chyba — logujeme ale vracíme 200 ať turniket funguje
    console.error('[Gate API] Neočekávaná chyba při validaci skenování:', err);
    return NextResponse.json(
      { valid: false, reason: 'not_found' } satisfies GateBarcodeResponseInvalid,
      { status: 200 },
    );
  }
}
