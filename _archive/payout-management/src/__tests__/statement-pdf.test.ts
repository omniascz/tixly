import { describe, it, expect } from 'vitest';
import { generateStatementPdf, type StatementData } from '../services/statement-pdf.service.js';

describe('generateStatementPdf', () => {
  it('should generate a valid PDF buffer starting with %PDF magic bytes', async () => {
    // Mock StatementData with 2 payouts
    const mockData: StatementData = {
      promoterName: 'Test Promoter',
      promoterId: 'promo-123',
      period: {
        from: '2026-01-01',
        to: '2026-03-31',
      },
      generatedAt: '2026-04-08T10:30:00Z',
      payouts: [
        {
          id: 'payout-001',
          periodFrom: '2026-01-01',
          periodTo: '2026-01-31',
          grossRevenue: 50000,
          platformFees: 5000,
          refunds: 1000,
          chargebacks: 500,
          rollingReserve: 2500,
          netPayout: 40000,
          status: 'paid',
          paidAt: '2026-02-05T12:00:00Z',
        },
        {
          id: 'payout-002',
          periodFrom: '2026-02-01',
          periodTo: '2026-02-28',
          grossRevenue: 60000,
          platformFees: 6000,
          refunds: 2000,
          chargebacks: 1000,
          rollingReserve: 3000,
          netPayout: 48000,
          status: 'pending',
          paidAt: null,
        },
      ],
      totals: {
        grossRevenue: 110000,
        platformFees: 11000,
        refunds: 3000,
        chargebacks: 1500,
        rollingReserve: 5500,
        netPayout: 88000,
      },
    };

    // Generate PDF
    const pdfBuffer = await generateStatementPdf(mockData);

    // Assert buffer is not empty
    expect(pdfBuffer).toBeDefined();
    expect(pdfBuffer.length).toBeGreaterThan(0);

    // Assert PDF magic bytes (%PDF)
    const magicBytes = pdfBuffer.slice(0, 4).toString('ascii');
    expect(magicBytes).toBe('%PDF');
  });
});
