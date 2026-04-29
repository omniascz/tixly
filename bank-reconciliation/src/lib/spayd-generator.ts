import QRCode from 'qrcode';
import { BankReconciliationError } from './bank-errors.js';
import type { SpaydQrInput, SpaydQrResult } from '../types/bank.js';

export interface SpaydConfig {
  iban: string;
  bic: string;
  studioName: string;
  isConfigured: boolean;
}

const DEV_PLACEHOLDER_IBAN = 'CZ0000000000000000000000';
const DEV_PLACEHOLDER_BIC = 'FIOBCZPP';

// ISO 3166-1 alpha-2 country code + 2 check digits + up to 30 BBAN chars
const IBAN_REGEX = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const CZ_IBAN_REGEX = /^CZ\d{22}$/;
const VS_REGEX = /^\d{1,10}$/;

let devWarningShown = false;

export function loadSpaydConfig(): SpaydConfig {
  const iban = process.env.STUDIO_IBAN?.trim() || '';
  const bic = process.env.STUDIO_BIC?.trim() || '';
  const studioName = process.env.STUDIO_NAME?.trim() || 'Tixly';
  const isConfigured = Boolean(iban && bic);

  if (!isConfigured && !devWarningShown) {
    console.warn(
      '[bank-reconciliation] STUDIO_IBAN/STUDIO_BIC not configured — using dev placeholder IBAN. QR codes will NOT be valid for real payments.',
    );
    devWarningShown = true;
  }

  return {
    iban: iban || DEV_PLACEHOLDER_IBAN,
    bic: bic || DEV_PLACEHOLDER_BIC,
    studioName,
    isConfigured,
  };
}

/** Format halíře as "490.00" (2 decimals, dot separator — SPAYD spec). */
export function formatAmountForSpayd(amountHalire: number): string {
  if (!Number.isInteger(amountHalire) || amountHalire < 0) {
    throw new BankReconciliationError('MATCH_FAILED', {
      reason: 'amountHalire must be a non-negative integer',
      amountHalire,
    });
  }
  const kc = amountHalire / 100;
  return kc.toFixed(2);
}

function validateIban(iban: string): void {
  if (!IBAN_REGEX.test(iban)) {
    throw new BankReconciliationError('IBAN_NOT_CONFIGURED', { iban });
  }
  if (iban.startsWith('CZ') && !CZ_IBAN_REGEX.test(iban)) {
    throw new BankReconciliationError('IBAN_NOT_CONFIGURED', { iban });
  }
}

function validateVariableSymbol(vs: string): void {
  if (!VS_REGEX.test(vs)) {
    throw new BankReconciliationError('INVALID_VARIABLE_SYMBOL', { vs });
  }
}

function sanitizeSpaydField(value: string): string {
  // SPAYD uses `*` as field separator, so strip them + control chars + trim
  return value.replace(/[*\r\n\t]/g, ' ').trim();
}

export function buildSpaydString(config: SpaydConfig, input: SpaydQrInput): string {
  if (!config.isConfigured) {
    throw new BankReconciliationError('IBAN_NOT_CONFIGURED');
  }

  validateIban(config.iban);
  validateVariableSymbol(input.variableSymbol);

  const amount = formatAmountForSpayd(input.amountHalire);
  const currency = 'CZK';

  const fields: string[] = [
    'SPD',
    '1.0',
    `ACC:${config.iban}+${config.bic}`,
    `AM:${amount}`,
    `CC:${currency}`,
    `X-VS:${input.variableSymbol}`,
  ];

  if (input.message) {
    const msg = sanitizeSpaydField(input.message).slice(0, 60);
    if (msg) fields.push(`MSG:${msg}`);
  }

  if (input.dueDate) {
    // SPAYD DT expects YYYYMMDD
    const dt = input.dueDate.replace(/-/g, '').slice(0, 8);
    if (/^\d{8}$/.test(dt)) fields.push(`DT:${dt}`);
  }

  if (config.studioName) {
    const rn = sanitizeSpaydField(config.studioName).slice(0, 35);
    if (rn) fields.push(`RN:${rn}`);
  }

  return fields.join('*');
}

export async function generateSpaydQr(
  config: SpaydConfig,
  input: SpaydQrInput,
): Promise<SpaydQrResult> {
  const spayd = buildSpaydString(config, input);
  const qrPngDataUrl = await QRCode.toDataURL(spayd, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 300,
  });
  return { spayd, qrPngDataUrl };
}
