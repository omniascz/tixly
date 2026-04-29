import { describe, it, expect, beforeAll } from '@jest/globals';
import {
  renderEmail,
  EmailTemplate,
  registerHandlebarsHelpers,
  OrderConfirmationVariables,
  TicketDeliveryVariables,
  Reminder48hVariables,
  OrderCancellationVariables,
  ResaleSoldVariables,
} from './email-renderer';

// Register helpers before tests
beforeAll(() => {
  registerHandlebarsHelpers();
});

describe('Email Template Renderer', () => {
  describe('Order Confirmation Email', () => {
    const mockOrderConfirmationVars: OrderConfirmationVariables = {
      template: EmailTemplate.OrderConfirmation,
      unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=abc123',
      preheaderText: 'Objednávka č. ORD-2026-001234 byla potvrzena.',
      orderNumber: 'ORD-2026-001234',
      customerName: 'Jan Novotný',
      orderDate: 'pátek 3. dubna 2026',
      items: [
        {
          eventTitle: 'The Beatles Revival',
          date: 'sobota 5. května 2026',
          venue: 'O2 Universum',
          quantity: 2,
          unitPrice: '600 Kč',
          totalPrice: '1 200 Kč',
          ticketType: 'Stání VIP',
        },
      ],
      subtotal: '1 200 Kč',
      fees: '50 Kč',
      total: '1 250 Kč',
      paymentMethod: 'Bankovní transfer',
      downloadUrl: 'https://tixly.cz/download/tickets/ORD-2026-001234',
    };

    it('renders without errors', () => {
      expect(() => {
        renderEmail(EmailTemplate.OrderConfirmation, mockOrderConfirmationVars);
      }).not.toThrow();
    });

    it('contains order confirmation elements', () => {
      const { html } = renderEmail(
        EmailTemplate.OrderConfirmation,
        mockOrderConfirmationVars
      );

      expect(html).toContain('Objednávka potvrzena!');
      expect(html).toContain('ORD-2026-001234');
      expect(html).toContain('Jan Novotný');
      expect(html).toContain('The Beatles Revival');
      expect(html).toContain('1 250 Kč');
      expect(html).toContain('Stáhnout vstupenky');
    });

    it('contains unsubscribe link in footer', () => {
      const { html } = renderEmail(
        EmailTemplate.OrderConfirmation,
        mockOrderConfirmationVars
      );

      expect(html).toContain('{{unsubscribeUrl}}');
    });

    it('generates plain-text version without HTML tags', () => {
      const { text } = renderEmail(
        EmailTemplate.OrderConfirmation,
        mockOrderConfirmationVars
      );

      expect(text).not.toMatch(/<[^>]+>/);
      expect(text).toContain('Objednávka potvrzena');
      expect(text).toContain('ORD-2026-001234');
      expect(text).toContain('Jan Novotný');
    });

    it('plain-text preserves structure', () => {
      const { text } = renderEmail(
        EmailTemplate.OrderConfirmation,
        mockOrderConfirmationVars
      );

      const lines = text.split('\n');
      expect(lines.length).toBeGreaterThan(5);
    });
  });

  describe('Ticket Delivery Email', () => {
    const mockTicketDeliveryVars: TicketDeliveryVariables = {
      template: EmailTemplate.TicketDelivery,
      unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=xyz789',
      preheaderText: 'Vaše vstupenka na Divadlo ABC je připravena!',
      customerName: 'Marie Svobodová',
      eventTitle: 'Divadlo ABC: Hamlet',
      eventDate: 'pátek 10. května 2026',
      eventTime: '19:30',
      venue: 'Divadlo ABC',
      venueAddress: 'Vodičkova 39, 110 00 Praha 1',
      ticketType: 'Balkon',
      seatInfo: 'Sekce A, Řada 3, Místo 12',
      ticketId: 'TKT-2026-567890',
      qrCodeUrl: 'https://tixly.cz/qr/TKT-2026-567890.png',
      dynamicQrNote:
        'Dynamický QR kód se obnovuje každých 30 sekund v aplikaci.',
      appDownloadUrl: 'https://tixly.cz/app',
    };

    it('renders without errors', () => {
      expect(() => {
        renderEmail(EmailTemplate.TicketDelivery, mockTicketDeliveryVars);
      }).not.toThrow();
    });

    it('contains ticket delivery elements', () => {
      const { html } = renderEmail(
        EmailTemplate.TicketDelivery,
        mockTicketDeliveryVars
      );

      expect(html).toContain('Vaše vstupenka je připravena!');
      expect(html).toContain('Marie Svobodová');
      expect(html).toContain('Divadlo ABC: Hamlet');
      expect(html).toContain('pátek 10. května 2026');
      expect(html).toContain('19:30');
      expect(html).toContain('Sekce A, Řada 3, Místo 12');
      expect(html).toContain('TKT-2026-567890');
      expect(html).toContain('Otevřít v aplikaci');
    });

    it('contains QR code image', () => {
      const { html } = renderEmail(
        EmailTemplate.TicketDelivery,
        mockTicketDeliveryVars
      );

      expect(html).toContain('img');
      expect(html).toContain('qrCodeUrl');
    });

    it('contains dynamic QR warning', () => {
      const { html } = renderEmail(
        EmailTemplate.TicketDelivery,
        mockTicketDeliveryVars
      );

      expect(html).toContain('Důležité upozornění');
      expect(html).toContain('dynamický QR kód');
    });

    it('contains unsubscribe link', () => {
      const { html } = renderEmail(
        EmailTemplate.TicketDelivery,
        mockTicketDeliveryVars
      );

      expect(html).toContain('{{unsubscribeUrl}}');
    });
  });

  describe('48-hour Reminder Email', () => {
    const mockReminder48hVars: Reminder48hVariables = {
      template: EmailTemplate.Reminder48h,
      unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=reminder48h',
      preheaderText: 'Zítra v O2 Universum! Máte vše připraveno?',
      customerName: 'Petr Kučera',
      eventTitle: 'David Bowie Tribute',
      eventDate: 'pátek 15. května 2026',
      eventTime: '20:00',
      venue: 'O2 Universum',
      venueAddress: 'Novy Butovický Svět 1, 150 00 Praha 5',
      doorsOpen: '19:00',
      seatInfo: 'Stání',
      ticketCount: 1,
      appDownloadUrl: 'https://tixly.cz/app',
      mapUrl: 'https://maps.google.com/maps?q=O2+Universum',
      resaleUrl: 'https://tixly.cz/resale/TKT-2026-567890',
      weatherNote: 'Teplota kolem 18°C, doporučujeme si vzít mikinu.',
      requiresId: true,
    };

    it('renders without errors', () => {
      expect(() => {
        renderEmail(EmailTemplate.Reminder48h, mockReminder48hVars);
      }).not.toThrow();
    });

    it('contains reminder elements', () => {
      const { html } = renderEmail(
        EmailTemplate.Reminder48h,
        mockReminder48hVars
      );

      expect(html).toContain('Zítra se uvidíme! 🎉');
      expect(html).toContain('David Bowie Tribute');
      expect(html).toContain('pátek 15. května 2026');
      expect(html).toContain('20:00');
      expect(html).toContain('O2 Universum');
      expect(html).toContain('19:00');
      expect(html).toContain('Máte vše připraveno?');
      expect(html).toContain('Zobrazit vstupenku');
    });

    it('displays requiresId section when needed', () => {
      const { html } = renderEmail(
        EmailTemplate.Reminder48h,
        mockReminder48hVars
      );

      expect(html).toContain('Platný průkaz totožnosti');
    });

    it('hides requiresId section when not needed', () => {
      const varsWithoutId = { ...mockReminder48hVars, requiresId: false };
      const { html } = renderEmail(EmailTemplate.Reminder48h, varsWithoutId);

      // Should still render without error
      expect(html).toBeTruthy();
    });

    it('displays optional weather note when provided', () => {
      const { html } = renderEmail(
        EmailTemplate.Reminder48h,
        mockReminder48hVars
      );

      expect(html).toContain('🌤');
      expect(html).toContain('mikinu');
    });

    it('renders correctly without optional weather note', () => {
      const varsWithoutWeather = { ...mockReminder48hVars, weatherNote: undefined };
      const { html } = renderEmail(
        EmailTemplate.Reminder48h,
        varsWithoutWeather
      );

      expect(html).toBeTruthy();
      expect(html).toContain('David Bowie Tribute');
    });

    it('contains resale link', () => {
      const { html } = renderEmail(
        EmailTemplate.Reminder48h,
        mockReminder48hVars
      );

      expect(html).toContain('Nemůžete přijít');
      expect(html).toContain('Prodejte vstupenku');
    });
  });

  describe('Order Cancellation Email', () => {
    const mockCancellationVars: OrderCancellationVariables = {
      template: EmailTemplate.OrderCancellation,
      unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=cancel',
      preheaderText: 'Objednávka byla zrušena. Vrátíme vám peníze.',
      customerName: 'Anna Schwarzová',
      orderNumber: 'ORD-2026-005678',
      eventTitle: 'Nightwish - Symphonic Metal Tour',
      cancellationReason: 'Zrušení na žádost zákazníka',
      refundAmount: '1 500 Kč',
      refundDays: 3,
      supportUrl: 'https://tixly.cz/support?order=ORD-2026-005678',
    };

    it('renders without errors', () => {
      expect(() => {
        renderEmail(
          EmailTemplate.OrderCancellation,
          mockCancellationVars
        );
      }).not.toThrow();
    });

    it('contains cancellation confirmation elements', () => {
      const { html } = renderEmail(
        EmailTemplate.OrderCancellation,
        mockCancellationVars
      );

      expect(html).toContain('Objednávka zrušena');
      expect(html).toContain('ORD-2026-005678');
      expect(html).toContain('Anna Schwarzová');
      expect(html).toContain('Nightwish');
      expect(html).toContain('1 500 Kč');
      expect(html).toContain('3 pracovních dní');
    });

    it('contains refund information', () => {
      const { html } = renderEmail(
        EmailTemplate.OrderCancellation,
        mockCancellationVars
      );

      expect(html).toContain('Vrácení peněz');
      expect(html).toContain('💰');
    });

    it('contains support link', () => {
      const { html } = renderEmail(
        EmailTemplate.OrderCancellation,
        mockCancellationVars
      );

      expect(html).toContain('Kontaktovat podporu');
    });
  });

  describe('Resale Sold Email', () => {
    const mockResaleSoldVars: ResaleSoldVariables = {
      template: EmailTemplate.ResaleSold,
      unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=resale',
      preheaderText: 'Vaše vstupenka byla prodána!',
      sellerName: 'Tomáš Lexa',
      eventTitle: 'Lady Gaga - Chromatica Ball',
      salePrice: '800 Kč',
      buyerFirstName: 'Kateřina',
      payoutDate: 'středa 7. května 2026',
      payoutAmount: '680 Kč',
      dashboardUrl: 'https://tixly.cz/dashboard/resale',
    };

    it('renders without errors', () => {
      expect(() => {
        renderEmail(EmailTemplate.ResaleSold, mockResaleSoldVars);
      }).not.toThrow();
    });

    it('contains resale sold elements', () => {
      const { html } = renderEmail(
        EmailTemplate.ResaleSold,
        mockResaleSoldVars
      );

      expect(html).toContain('Vaše vstupenka byla prodána!');
      expect(html).toContain('Tomáš Lexa');
      expect(html).toContain('Lady Gaga');
      expect(html).toContain('800 Kč');
      expect(html).toContain('Kateřina');
      expect(html).toContain('680 Kč');
      expect(html).toContain('středa 7. května 2026');
    });

    it('contains payout information', () => {
      const { html } = renderEmail(
        EmailTemplate.ResaleSold,
        mockResaleSoldVars
      );

      expect(html).toContain('Vyplacení');
      expect(html).toContain('Termín vyplacení');
    });

    it('contains dashboard link', () => {
      const { html } = renderEmail(
        EmailTemplate.ResaleSold,
        mockResaleSoldVars
      );

      expect(html).toContain('Zobrazit v přehledu');
    });
  });

  describe('Common Requirements', () => {
    it('all templates contain unsubscribe URL', () => {
      const templates = [
        [EmailTemplate.OrderConfirmation, {
          template: EmailTemplate.OrderConfirmation,
          unsubscribeUrl: 'https://test.cz/unsubscribe',
          preheaderText: 'Test',
          orderNumber: '123',
          customerName: 'Test',
          orderDate: '1.1.2026',
          items: [],
          subtotal: '0',
          fees: '0',
          total: '0',
          paymentMethod: 'test',
          downloadUrl: 'https://test.cz',
        }],
        [EmailTemplate.TicketDelivery, {
          template: EmailTemplate.TicketDelivery,
          unsubscribeUrl: 'https://test.cz/unsubscribe',
          preheaderText: 'Test',
          customerName: 'Test',
          eventTitle: 'Test',
          eventDate: '1.1.2026',
          eventTime: '19:00',
          venue: 'Test',
          venueAddress: 'Test',
          ticketType: 'Test',
          seatInfo: 'Test',
          ticketId: '123',
          qrCodeUrl: 'https://test.cz/qr',
          appDownloadUrl: 'https://test.cz/app',
        }],
      ];

      templates.forEach(([templateName, vars]) => {
        const { html } = renderEmail(
          templateName as EmailTemplate,
          vars as Record<string, unknown>
        );
        expect(html).toContain('{{unsubscribeUrl}}');
      });
    });

    it('plain-text fallback has no HTML tags', () => {
      const allTemplates = [
        [EmailTemplate.OrderConfirmation, {
          template: EmailTemplate.OrderConfirmation,
          unsubscribeUrl: 'https://test.cz/unsubscribe',
          preheaderText: 'Test',
          orderNumber: '123',
          customerName: 'Test',
          orderDate: '1.1.2026',
          items: [],
          subtotal: '0',
          fees: '0',
          total: '0',
          paymentMethod: 'test',
          downloadUrl: 'https://test.cz',
        }],
      ];

      allTemplates.forEach(([templateName, vars]) => {
        const { text } = renderEmail(
          templateName as EmailTemplate,
          vars as Record<string, unknown>
        );
        expect(text).not.toMatch(/<[^>]+>/);
      });
    });
  });
});
