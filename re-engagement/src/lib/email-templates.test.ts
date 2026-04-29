import { describe, it, expect } from 'vitest';
import {
  dormantCustomerEmailDay0,
  dormantCustomerEmailDay3,
  dormantCustomerEmailDay7,
  getEmailTemplate,
} from './email-templates.js';
import type { EmailTemplateInput } from './email-templates.js';

describe('email-templates', () => {
  const baseInput: EmailTemplateInput = {
    name: 'Petr Svoboda',
    lastPurchaseDate: new Date('2026-01-15'),
    discountCode: 'WELCOME15',
    dormancyLevel: 'dormant',
    stepIndex: 0,
    churnScore: 0.75,
  };

  describe('dormantCustomerEmailDay0', () => {
    it('should generate subject with discount code', () => {
      const template = dormantCustomerEmailDay0(baseInput);
      expect(template.subject).toContain('Petr Svoboda');
      expect(template.subject).toContain('15%');
    });

    it('should include discount code in HTML', () => {
      const template = dormantCustomerEmailDay0(baseInput);
      expect(template.html).toContain('WELCOME15');
    });

    it('should include formatted date (Czech format)', () => {
      const template = dormantCustomerEmailDay0(baseInput);
      expect(template.html).toContain('15.01.2026');
    });

    it('should include event recommendations table', () => {
      const template = dormantCustomerEmailDay0(baseInput);
      expect(template.html).toContain('Rock Koncert');
      expect(template.html).toContain('Stand-up Comedy');
      expect(template.html).toContain('Kino premiéra');
    });

    it('should use -20% for churned users', () => {
      const churnedInput = { ...baseInput, dormancyLevel: 'churned' as const };
      const template = dormantCustomerEmailDay0(churnedInput);
      expect(template.subject).toContain('20%');
      expect(template.subject).toContain('Vrátíme se k tobě');
    });

    it('should use -15% for dormant users', () => {
      const dormantInput = { ...baseInput, dormancyLevel: 'dormant' as const };
      const template = dormantCustomerEmailDay0(dormantInput);
      expect(template.subject).toContain('15%');
    });

    it('should include CTA button link', () => {
      const template = dormantCustomerEmailDay0(baseInput);
      expect(template.html).toContain('https://tixly.com/events');
      expect(template.html).toContain('WELCOME15');
    });

    it('should include unsubscribe link', () => {
      const template = dormantCustomerEmailDay0(baseInput);
      expect(template.html).toContain('unsubscribe');
    });

    it('should not include discount section if discountCode is missing', () => {
      const noCodeInput = { ...baseInput, discountCode: undefined };
      const template = dormantCustomerEmailDay0(noCodeInput);
      expect(template.html).not.toContain('TVŮJ KÓDU SLEVA');
    });
  });

  describe('dormantCustomerEmailDay3', () => {
    it('should generate subject for day 3 reminder', () => {
      const template = dormantCustomerEmailDay3(baseInput);
      expect(template.subject).toContain('Petr Svoboda');
      expect(template.subject).toContain('poslední šance');
      expect(template.subject).toMatch(/⏰/);
    });

    it('should use -20% for churned users', () => {
      const churnedInput = { ...baseInput, dormancyLevel: 'churned' as const };
      const template = dormantCustomerEmailDay3(churnedInput);
      expect(template.subject).toContain('20%');
    });

    it('should include urgency messaging', () => {
      const template = dormantCustomerEmailDay3(baseInput);
      expect(template.html).toContain('Poslední připomenutí');
      expect(template.html).toContain('vyprší za 4 dny');
    });

    it('should include CTA button', () => {
      const template = dormantCustomerEmailDay3(baseInput);
      expect(template.html).toContain('Koupit teď');
    });
  });

  describe('dormantCustomerEmailDay7', () => {
    it('should generate subject for final day email', () => {
      const template = dormantCustomerEmailDay7(baseInput);
      expect(template.subject).toContain('POSLEDNÍ ŠANCE');
      expect(template.subject).toContain('zmizí zítra');
    });

    it('should include bonus offer', () => {
      const template = dormantCustomerEmailDay7(baseInput);
      expect(template.html).toContain('BONUS');
      expect(template.html).toContain('-10% na další nákup');
    });

    it('should include discount code', () => {
      const template = dormantCustomerEmailDay7(baseInput);
      expect(template.html).toContain('WELCOME15');
    });

    it('should emphasize expiration urgency', () => {
      const template = dormantCustomerEmailDay7(baseInput);
      expect(template.html).toContain('samizí zítra o půlnoci');
      expect(template.html).toContain('POSLEDNÍ ŠANCE');
    });
  });

  describe('getEmailTemplate', () => {
    it('should return day 0 template for stepIndex 0', () => {
      const template = getEmailTemplate({ ...baseInput, stepIndex: 0 });
      expect(template.html).toContain('Vrátíme se k tobě');
    });

    it('should return day 3 template for stepIndex 1', () => {
      const template = getEmailTemplate({ ...baseInput, stepIndex: 1 });
      expect(template.html).toContain('Poslední připomenutí');
    });

    it('should return day 7 template for stepIndex 2', () => {
      const template = getEmailTemplate({ ...baseInput, stepIndex: 2 });
      expect(template.html).toContain('POSLEDNÍ ŠANCE');
    });

    it('should fallback to day 0 for unknown stepIndex', () => {
      const template = getEmailTemplate({ ...baseInput, stepIndex: 99 });
      expect(template.html).toContain('Vrátíme se k tobě');
    });
  });

  describe('HTML structure', () => {
    it('should have valid HTML structure', () => {
      const template = dormantCustomerEmailDay0(baseInput);
      expect(template.html).toContain('<!DOCTYPE html>');
      expect(template.html).toContain('</html>');
      expect(template.html).toContain('<table');
      expect(template.html).toContain('</table>');
    });

    it('should include responsive meta viewport tag', () => {
      const template = dormantCustomerEmailDay0(baseInput);
      expect(template.html).toContain('viewport');
      expect(template.html).toContain('initial-scale=1.0');
    });

    it('should use inline CSS for email compatibility', () => {
      const template = dormantCustomerEmailDay0(baseInput);
      expect(template.html).toContain('style=');
    });
  });

  describe('Czech localization', () => {
    it('should use Czech date format (DD.MM.YYYY)', () => {
      const input = {
        ...baseInput,
        lastPurchaseDate: new Date('2026-03-05'),
      };
      const template = dormantCustomerEmailDay0(input);
      expect(template.html).toContain('05.03.2026');
    });

    it('should include Czech text and greetings', () => {
      const template = dormantCustomerEmailDay0(baseInput);
      expect(template.html).toContain('Ahoj');
      expect(template.html).toContain('Tixly');
      expect(template.html).toContain('Koupit vstupenky');
    });

    it('should include Czech unsubscribe link', () => {
      const template = dormantCustomerEmailDay0(baseInput);
      expect(template.html).toContain('Odhlásit se');
    });
  });
});
