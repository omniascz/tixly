import { NextResponse } from 'next/server';

/**
 * Fail-closed guard pro mock platební brány.
 *
 * Mock brány (mock-gopay/wero/przelewy24/bnpl) označí objednávku jako zaplacenou
 * BEZ reálné platby → v produkci by kdokoli mintoval vstupenky zdarma. Proto jsou
 * v produkci zakázané, pokud nejsou EXPLICITNĚ povolené `ALLOW_MOCK_PAYMENTS=1`
 * (řízené staging demo, ne ostrý provoz).
 */
export function mockPaymentsAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_MOCK_PAYMENTS === '1';
}

/** Pro route handlery: vrátí 403 Response když mock zakázán, jinak null. */
export function mockPaymentBlockedResponse(): NextResponse | null {
  if (mockPaymentsAllowed()) return null;
  return NextResponse.json(
    { error: 'MOCK_DISABLED', message: 'Mock payment gateway is disabled in production.' },
    { status: 403 },
  );
}

/** Pro provider/checkout: hodí, když by se v produkci spadlo do mock brány. */
export function assertMockPaymentsAllowed(): void {
  if (!mockPaymentsAllowed()) {
    throw new Error(
      'No real payment provider configured in production (refusing mock fallback). Set PAYMENT_PROVIDER + provider credentials.',
    );
  }
}
