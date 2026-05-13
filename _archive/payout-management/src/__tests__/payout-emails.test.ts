import { describe, it, expect } from 'vitest';
import {
  payoutApprovedEmail,
  payoutPaidEmail,
  payoutFailedEmail,
} from '../lib/payout-emails.js';

describe('payoutApprovedEmail', () => {
  it('should return an HTML string', () => {
    const result = payoutApprovedEmail('Jan Novák', 12345, '10. 4. 2026');
    expect(typeof result.html).toBe('string');
    expect(result.html.toLowerCase()).toContain('<html');
    expect(result.html.toLowerCase()).toContain('</html>');
  });

  it('should contain correctly formatted amount 10050 → "100,50 Kč"', () => {
    const result = payoutApprovedEmail('Jan Novák', 10050, '10. 4. 2026');
    expect(result.html).toContain('100,50 Kč');
    expect(result.subject).toContain('100,50 Kč');
  });

  it('should contain correctly formatted amount 123450 → "1 234,50 Kč"', () => {
    const result = payoutApprovedEmail('Jan Novák', 123450, '10. 4. 2026');
    // Non-breaking space as thousands separator
    expect(result.html).toMatch(/1[\s\u00a0]234,50 Kč/);
  });

  it('should contain promoter name', () => {
    const result = payoutApprovedEmail('Petra Svobodová', 5000, '1. 5. 2026');
    expect(result.html).toContain('Petra Svobodová');
  });

  it('should contain expected date', () => {
    const result = payoutApprovedEmail('Jan Novák', 5000, '15. 6. 2026');
    expect(result.html).toContain('15. 6. 2026');
  });

  it('should contain correct subject with amount', () => {
    const result = payoutApprovedEmail('Jan Novák', 50000, '10. 4. 2026');
    expect(result.subject).toContain('schválena');
    expect(result.subject).toContain('500,00 Kč');
  });

  it('should handle zero amount → "0,00 Kč"', () => {
    const result = payoutApprovedEmail('Jan Novák', 0, '10. 4. 2026');
    expect(result.html).toContain('0,00 Kč');
  });

  it('should escape HTML special characters in promoter name', () => {
    const result = payoutApprovedEmail('<script>alert(1)</script>', 1000, '1. 1. 2026');
    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).toContain('&lt;script&gt;');
  });
});

describe('payoutPaidEmail', () => {
  it('should return an HTML string', () => {
    const result = payoutPaidEmail('Jan Novák', 50000, 'REF-12345', '5. 4. 2026');
    expect(typeof result.html).toBe('string');
    expect(result.html.toLowerCase()).toContain('<html');
  });

  it('should contain bank reference', () => {
    const result = payoutPaidEmail('Jan Novák', 50000, 'REF-XYZ-789', '5. 4. 2026');
    expect(result.html).toContain('REF-XYZ-789');
  });

  it('should contain paidAt date', () => {
    const result = payoutPaidEmail('Jan Novák', 50000, 'REF-12345', '5. 4. 2026');
    expect(result.html).toContain('5. 4. 2026');
  });

  it('should contain formatted amount in subject', () => {
    const result = payoutPaidEmail('Jan Novák', 25000, 'REF-001', '5. 4. 2026');
    expect(result.subject).toContain('250,00 Kč');
    expect(result.subject).toContain('odeslána');
  });

  it('should contain promoter name', () => {
    const result = payoutPaidEmail('Marie Horáková', 10000, 'REF-999', '1. 1. 2026');
    expect(result.html).toContain('Marie Horáková');
  });

  it('should handle zero amount → "0,00 Kč"', () => {
    const result = payoutPaidEmail('Jan Novák', 0, 'REF-000', '1. 1. 2026');
    expect(result.html).toContain('0,00 Kč');
  });

  it('should escape HTML in bank reference', () => {
    const result = payoutPaidEmail('Jan Novák', 1000, '<b>REF</b>', '1. 1. 2026');
    expect(result.html).not.toContain('<b>REF</b>');
    expect(result.html).toContain('&lt;b&gt;REF&lt;/b&gt;');
  });

  it('should contain payment confirmation wording', () => {
    const result = payoutPaidEmail('Jan Novák', 5000, 'REF-001', '5. 4. 2026');
    // Should mention the bank/account
    expect(result.html.toLowerCase()).toMatch(/ú.et|bank|odeslán/);
  });
});

describe('payoutFailedEmail', () => {
  it('should return an HTML string', () => {
    const result = payoutFailedEmail('Jan Novák', 50000, 'Neplatný IBAN');
    expect(typeof result.html).toBe('string');
    expect(result.html.toLowerCase()).toContain('<html');
  });

  it('should contain failure reason', () => {
    const result = payoutFailedEmail('Jan Novák', 50000, 'Neplatný IBAN');
    expect(result.html).toContain('Neplatný IBAN');
  });

  it('should contain support link or contact info', () => {
    const result = payoutFailedEmail('Jan Novák', 50000, 'Timeout');
    expect(result.html).toContain('support@tixly.cz');
  });

  it('should contain formatted amount', () => {
    const result = payoutFailedEmail('Jan Novák', 99900, 'Chyba banky');
    expect(result.html).toContain('999,00 Kč');
  });

  it('should contain correct subject', () => {
    const result = payoutFailedEmail('Jan Novák', 50000, 'Chyba');
    expect(result.subject).toContain('Chyba');
    expect(result.subject.toLowerCase()).toMatch(/výplat|chyb/);
  });

  it('should contain promoter name', () => {
    const result = payoutFailedEmail('Tomáš Beneš', 10000, 'Test');
    expect(result.html).toContain('Tomáš Beneš');
  });

  it('should handle zero amount → "0,00 Kč"', () => {
    const result = payoutFailedEmail('Jan Novák', 0, 'Chyba');
    expect(result.html).toContain('0,00 Kč');
  });

  it('should escape HTML in reason', () => {
    const result = payoutFailedEmail('Jan Novák', 1000, '<script>xss</script>');
    expect(result.html).not.toContain('<script>xss</script>');
    expect(result.html).toContain('&lt;script&gt;xss&lt;/script&gt;');
  });
});
