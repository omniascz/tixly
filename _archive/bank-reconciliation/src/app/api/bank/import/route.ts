import { BankReconciliationError } from '../../../../lib/bank-errors.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { parseBankStatement, detectBankFormat, CSV_PRESETS, type ParsedTransaction } from '../../../../lib/bank-parsers.js';
import { matchPayment, type PaymentInput, type MatchResult } from '../../../../services/payment-matching.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function requireAdmin(req: Request): { userId: string } {
  const role = req.headers.get('x-user-role');
  const userId = req.headers.get('x-user-id');
  if ((role !== 'admin' && role !== 'platform_admin') || !userId) {
    throw new BankReconciliationError('MATCH_FAILED', { reason: 'admin required' });
  }
  return { userId };
}

/** Convert decimal amount string (e.g. "1234.56") to haléře integer */
function amountToHalire(amount: string): number {
  return Math.round(parseFloat(amount) * 100);
}

/**
 * POST /api/bank/import — Upload a bank statement file (ABO/CSV/MT940)
 *
 * Expects multipart/form-data with field "file".
 * Optional query param "preset" for CSV bank preset (fio, csob, kb, cs, rb, moneta, generic).
 */
export async function POST(req: Request): Promise<Response> {
  try {
    requireAdmin(req);

    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return Response.json(
        { error: 'INVALID_INPUT', message: 'Expected multipart/form-data with file field.' },
        { status: 400 },
      );
    }

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return Response.json(
        { error: 'INVALID_INPUT', message: 'Missing file field.' },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: 'INVALID_INPUT', message: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB).` },
        { status: 400 },
      );
    }

    const raw = await file.text();
    const url = new URL(req.url);
    const presetName = url.searchParams.get('preset') ?? undefined;
    const csvOptions = presetName && presetName in CSV_PRESETS ? CSV_PRESETS[presetName] : undefined;

    const format = detectBankFormat(raw);

    // Parse the statement
    const parseResult = parseBankStatement(raw, csvOptions);

    if (parseResult.errors.length > 0 && parseResult.transactions.length === 0) {
      return Response.json(
        { error: 'PARSE_FAILED', format, errors: parseResult.errors },
        { status: 422 },
      );
    }

    const deps = getServiceDeps();

    const results: Array<{
      externalId: string | undefined;
      bankPaymentId: string | null;
      matchResult: MatchResult | null;
      skipped: boolean;
      error?: string;
    }> = [];

    let imported = 0;
    let matched = 0;
    let skipped = 0;
    let errored = 0;

    for (const tx of parseResult.transactions) {
      try {
        const halire = amountToHalire(tx.amount);
        const externalId = tx.externalId || `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Insert into bank_payments (idempotent via fio_transaction_id UNIQUE)
        const insertRows = await deps.db.query<{ id: string }>(
          `INSERT INTO payments.bank_payments (
             fio_transaction_id, amount_halire, currency,
             variable_symbol, constant_symbol, specific_symbol,
             counter_account, counter_account_name, message,
             match_status, raw_payload, received_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (fio_transaction_id) DO NOTHING
           RETURNING id`,
          [
            externalId,
            Math.abs(halire),
            tx.currency,
            tx.variableSymbol ?? null,
            tx.constantSymbol ?? null,
            tx.specificSymbol ?? null,
            tx.counterpartyAccount ?? tx.counterpartyIban ?? null,
            tx.counterpartyName ?? null,
            tx.description ?? null,
            'unmatched',
            JSON.stringify(tx),
            tx.bookingDate ? new Date(tx.bookingDate) : new Date(),
          ],
        );

        if (insertRows.length === 0) {
          results.push({ externalId: tx.externalId, bankPaymentId: null, matchResult: null, skipped: true });
          skipped++;
          continue;
        }

        imported++;
        const bankPaymentId = insertRows[0].id;

        // Only match incoming (credit) payments
        if (tx.direction !== 'credit' || halire <= 0) {
          results.push({ externalId: tx.externalId, bankPaymentId, matchResult: null, skipped: false });
          continue;
        }

        const paymentInput: PaymentInput = {
          id: bankPaymentId,
          amountHalire: Math.abs(halire),
          currency: tx.currency,
          variableSymbol: tx.variableSymbol ?? null,
          specificSymbol: tx.specificSymbol ?? null,
          constantSymbol: tx.constantSymbol ?? null,
          counterAccount: tx.counterpartyAccount ?? tx.counterpartyIban ?? null,
          counterAccountName: tx.counterpartyName ?? null,
          message: tx.description ?? null,
          receivedAt: tx.bookingDate ? new Date(tx.bookingDate) : new Date(),
        };

        const matchResult = await matchPayment(deps.db, paymentInput);
        if (matchResult.autoMatched) matched++;

        results.push({ externalId: tx.externalId, bankPaymentId, matchResult, skipped: false });
      } catch (err) {
        errored++;
        results.push({
          externalId: tx.externalId,
          bankPaymentId: null,
          matchResult: null,
          skipped: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return Response.json({
      format,
      totalParsed: parseResult.transactions.length,
      imported,
      matched,
      skipped,
      errored,
      parseErrors: parseResult.errors,
      results,
    });
  } catch (err) {
    if (err instanceof BankReconciliationError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    console.error('[bank/import] error', err);
    return Response.json({ error: 'INTERNAL', message: 'Vnitřní chyba.' }, { status: 500 });
  }
}
