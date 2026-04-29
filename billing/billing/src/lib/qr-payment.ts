/**
 * QR Payment — Czech SPD*1.0 standard for QR payment codes.
 *
 * Ported from @acc/accounting qr-payment.ts.
 * Adapted: Decimal.js → integer haléře.
 *
 * Format: SPD*1.0*ACC:{IBAN}*AM:{amount}*CC:{currency}*X-VS:{vs}*MSG:{note}*DT:{date}
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QrPaymentInput {
  /** Czech IBAN (24 characters, starts with CZ) */
  iban: string;
  /** Amount in haléře (integer) */
  amountHalire: number;
  /** Currency code, default 'CZK' */
  currency?: string;
  /** Variable symbol — typically invoice number (1-10 digits) */
  variableSymbol?: string;
  /** Specific symbol (max 10 digits) */
  specificSymbol?: string;
  /** Constant symbol (1-4 digits, e.g. '0308') */
  constantSymbol?: string;
  /** Recipient name */
  recipientName?: string;
  /** Payment note / purpose */
  note?: string;
  /** Due date (ISO string YYYY-MM-DD) */
  dueDate?: string;
}

export interface QrPaymentCode {
  rawData: string;
  base64: string;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate Czech IBAN: CZ + 22 digits = 24 chars total, mod-97 checksum.
 */
export function validateCzechIban(iban: string): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];

  if (!iban.startsWith('CZ')) {
    errors.push('IBAN must start with CZ');
  }

  if (iban.length !== 24) {
    errors.push(`IBAN must be 24 characters long, got ${iban.length}`);
  }

  if (!iban.slice(2).match(/^\d{22}$/)) {
    errors.push('IBAN must contain only digits after CZ prefix');
  }

  // Validate mod-97 checksum
  if (errors.length === 0) {
    const checkDigits = iban.slice(2, 4);
    const bankAndAccount = iban.slice(4);
    // Move CZ and checksum to end, convert letters: C=12, Z=35
    const rearranged = bankAndAccount + '1235' + checkDigits;
    let remainder = 0;
    for (const char of rearranged) {
      remainder = (remainder * 10 + parseInt(char, 10)) % 97;
    }
    if (remainder !== 1) {
      errors.push('IBAN checksum validation failed');
    }
  }

  return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
}

/** Validate variable symbol: 1-10 digits */
export function validateVariableSymbol(vs: string): boolean {
  return /^\d{1,10}$/.test(vs);
}

/** Validate specific symbol: max 10 digits */
export function validateSpecificSymbol(ss: string): boolean {
  return /^\d{1,10}$/.test(ss);
}

/** Validate constant symbol: 1-4 digits */
export function validateConstantSymbol(cs: string): boolean {
  return /^\d{1,4}$/.test(cs);
}

/**
 * Validate all QR payment data fields.
 */
export function validateQrPaymentData(data: QrPaymentInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const ibanResult = validateCzechIban(data.iban);
  if (!ibanResult.valid) {
    errors.push(`Invalid IBAN: ${ibanResult.errors?.join(', ')}`);
  }

  if (!Number.isInteger(data.amountHalire) || data.amountHalire <= 0) {
    errors.push('Amount must be a positive integer (haléře)');
  }

  if (data.currency && data.currency.length !== 3) {
    errors.push('Currency code must be 3 characters');
  }

  if (data.variableSymbol && !validateVariableSymbol(data.variableSymbol)) {
    errors.push('Invalid variable symbol format (1-10 digits required)');
  }

  if (data.specificSymbol && !validateSpecificSymbol(data.specificSymbol)) {
    errors.push('Invalid specific symbol format (max 10 digits)');
  }

  if (data.constantSymbol && !validateConstantSymbol(data.constantSymbol)) {
    errors.push('Invalid constant symbol format (1-4 digits)');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Convert haléře to CZK string with 2 decimal places.
 * 12345 → "123.45"
 */
function halireToCzk(halire: number): string {
  const czk = halire / 100;
  return czk.toFixed(2);
}

/**
 * Generate QR payment data string in Czech SPD*1.0 format.
 */
export function generateQrPaymentData(data: QrPaymentInput): string {
  const parts: string[] = ['SPD*1.0'];

  parts.push(`ACC:${data.iban}`);
  parts.push(`AM:${halireToCzk(data.amountHalire)}`);
  parts.push(`CC:${data.currency || 'CZK'}`);

  if (data.variableSymbol) parts.push(`X-VS:${data.variableSymbol}`);
  if (data.specificSymbol) parts.push(`X-SS:${data.specificSymbol}`);
  if (data.constantSymbol) parts.push(`X-KS:${data.constantSymbol}`);
  if (data.recipientName) parts.push(`RN:${data.recipientName}`);
  if (data.note) parts.push(`MSG:${data.note}`);
  if (data.dueDate) parts.push(`DT:${data.dueDate}`);

  return parts.join('*');
}

/**
 * Generate QR code PNG image from payment data.
 * Requires `qrcode` library (optional peer dependency).
 */
export async function generateQrCodeImage(
  data: QrPaymentInput,
  options?: { size?: number; errorCorrection?: 'L' | 'M' | 'Q' | 'H'; margin?: number },
): Promise<Buffer> {
  let qrcode: any;
  try {
    qrcode = await import('qrcode');
  } catch {
    throw new Error('qrcode library not installed. Install with: npm install qrcode');
  }

  const qrData = generateQrPaymentData(data);
  const pngBuffer = await qrcode.toBuffer(qrData, {
    type: 'image/png',
    width: options?.size || 200,
    errorCorrectionLevel: options?.errorCorrection || 'M',
    margin: options?.margin || 2,
  });

  return pngBuffer;
}

/**
 * Generate both raw data string and base64 PNG image.
 */
export async function generateQrPaymentCode(data: QrPaymentInput): Promise<QrPaymentCode> {
  const rawData = generateQrPaymentData(data);
  const imageBuffer = await generateQrCodeImage(data);
  return {
    rawData,
    base64: imageBuffer.toString('base64'),
    mimeType: 'image/png',
  };
}
