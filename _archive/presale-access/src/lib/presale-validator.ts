import { createHmac, timingSafeEqual } from 'crypto';
import type { PresaleConfig, PresaleAccessStatus, PresaleValidationResult } from '../types/presale.types.js';
import {
  PresaleInvalidCodeError,
  PresaleExpiredError,
  PresaleNotStartedError,
  PresaleSoldOutError,
} from '../types/presale.types.js';

// ---------------------------------------------------------------------------
// hashPresaleCode
//
// Normalises the code (uppercase + trim) before hashing so that codes are
// case-insensitive and whitespace-tolerant from the user's perspective.
// The same normalisation MUST be applied both at setup and at validation time.
// ---------------------------------------------------------------------------

export function hashPresaleCode(code: string, secret: string): string {
  const normalised = code.toUpperCase().trim();
  return createHmac('sha256', secret).update(normalised).digest('hex');
}

// ---------------------------------------------------------------------------
// verifyPresaleCode
//
// Timing-safe comparison — uses Node's crypto.timingSafeEqual so that the
// comparison time does not leak information about where strings diverge.
// Both buffers must be the same length; HMAC-SHA256 always produces 64 hex
// chars, so stored hash and computed hash will always match in length.
// ---------------------------------------------------------------------------

export function verifyPresaleCode(
  code: string,
  storedHash: string,
  secret: string,
): boolean {
  const computed = hashPresaleCode(code, secret);

  // Both are SHA-256 hex strings (64 chars); lengths are guaranteed equal.
  // timingSafeEqual will throw if they differ in byte length — guard anyway.
  if (storedHash.length !== computed.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(storedHash, 'utf8'),
    Buffer.from(computed, 'utf8'),
  );
}

// ---------------------------------------------------------------------------
// getPresaleStatus
//
// Pure function — determines the current access status based on timing windows
// and capacity. Does NOT verify the code; that is the responsibility of
// validatePresaleAccess.
// ---------------------------------------------------------------------------

export function getPresaleStatus(
  config: PresaleConfig,
  ticketType: { sale_start: Date; sale_end: Date },
  now: Date,
): PresaleAccessStatus {
  const presaleStarted = now >= config.presale_start;
  const presaleEnded = now > config.presale_end;
  const publicSaleStarted = now >= ticketType.sale_start;
  const publicSaleEnded = now > ticketType.sale_end;

  // Presale capacity exhausted (only applies when capacity is explicitly set)
  const capacitySoldOut =
    config.presale_capacity !== null &&
    config.presale_sold_count >= config.presale_capacity;

  if (capacitySoldOut && !presaleEnded) {
    return 'presale_sold_out';
  }

  if (!presaleStarted) {
    // Presale hasn't started yet — check if public sale is somehow active
    if (publicSaleStarted && !publicSaleEnded) {
      return 'public_sale_active';
    }
    return 'presale_not_started';
  }

  if (!presaleEnded) {
    return 'presale_active';
  }

  // Presale has ended
  if (publicSaleStarted && !publicSaleEnded) {
    return 'public_sale_active';
  }

  if (!publicSaleStarted) {
    // Between presale end and public sale start
    return 'not_on_sale';
  }

  // Public sale also ended
  return 'not_on_sale';
}

// ---------------------------------------------------------------------------
// canAccessWithoutCode
//
// Returns true when the public sale window is active and no code is required.
// ---------------------------------------------------------------------------

export function canAccessWithoutCode(
  ticketType: { sale_start: Date; sale_end: Date },
  now: Date,
): boolean {
  return now >= ticketType.sale_start && now <= ticketType.sale_end;
}

// ---------------------------------------------------------------------------
// validatePresaleAccess
//
// Combines code verification with status determination.
// Throws typed errors for clear failure modes; returns PresaleValidationResult
// on success (both presale access and public-sale-active paths).
// ---------------------------------------------------------------------------

export function validatePresaleAccess(
  code: string,
  config: PresaleConfig,
  ticketType: { sale_start: Date; sale_end: Date },
  now: Date,
  secret: string,
): PresaleValidationResult {
  const status = getPresaleStatus(config, ticketType, now);

  const presaleActive = status === 'presale_active';
  const publicSaleActive = status === 'public_sale_active';

  // If public sale is currently active, grant access without a code check
  if (publicSaleActive) {
    return {
      status,
      access_granted: true,
      presale_active: false,
      public_sale_active: true,
      message: 'Veřejný prodej je aktivní.',
    };
  }

  // Outside all sale windows
  if (status === 'not_on_sale') {
    return {
      status,
      access_granted: false,
      presale_active: false,
      public_sale_active: false,
      message: 'Prodej vstupenek v tuto chvíli neprobíhá.',
    };
  }

  // Presale hasn't started
  if (status === 'presale_not_started') {
    throw new PresaleNotStartedError(config.presale_start);
  }

  // Presale ended and public sale not yet active
  if (status === 'presale_ended') {
    throw new PresaleExpiredError();
  }

  // Presale capacity sold out
  if (status === 'presale_sold_out') {
    throw new PresaleSoldOutError();
  }

  // Presale is active — verify the code
  const codeValid = verifyPresaleCode(code, config.presale_code_hash, secret);

  if (!codeValid) {
    throw new PresaleInvalidCodeError();
  }

  return {
    status: 'presale_active',
    access_granted: true,
    presale_active: true,
    public_sale_active: false,
    message: 'Presale přístup povolen.',
  };
}
