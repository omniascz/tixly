import { describe, it, expect } from 'vitest';
import {
  verificationEmail,
  welcomeEmail,
  kycSubmittedPromoterEmail,
  kycApprovedEmail,
  kycRejectedEmail,
  adminKycNotificationEmail,
  newTicketSaleEmail,
  upcomingEventReminderEmail,
} from '../lib/email-templates';

describe('verificationEmail', () => {
  const email = 'test@example.com';
  const verificationUrl = 'https://app.tixly.cz/verify-email?token=abc123';

  it('returns a non-empty string', () => {
    const { html } = verificationEmail(email, verificationUrl);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains the verificationUrl', () => {
    const { html } = verificationEmail(email, verificationUrl);
    expect(html).toContain(verificationUrl);
  });

  it('contains "24 hodin"', () => {
    const { html } = verificationEmail(email, verificationUrl);
    expect(html).toContain('24 hodin');
  });

  it('contains the <html> tag', () => {
    const { html } = verificationEmail(email, verificationUrl);
    expect(html).toContain('<html');
  });

  it('has correct subject', () => {
    const { subject } = verificationEmail(email, verificationUrl);
    expect(subject).toBe('Tixly — potvrďte svůj e-mail');
  });

  it('escapes special HTML characters in email', () => {
    const maliciousEmail = '<script>alert("xss")</script>@example.com';
    const { html } = verificationEmail(maliciousEmail, verificationUrl);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('welcomeEmail', () => {
  it('returns a non-empty string', () => {
    const { html } = welcomeEmail('Petr Novák');
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains the promoter name', () => {
    const { html } = welcomeEmail('Petr Novák');
    expect(html).toContain('Petr Novák');
  });

  it('contains <html> tag', () => {
    const { html } = welcomeEmail('Petr Novák');
    expect(html).toContain('<html');
  });

  it('has correct subject', () => {
    const { subject } = welcomeEmail('Petr Novák');
    expect(subject).toBe('Vítejte na Ticketariu — vytvořte svůj profil');
  });
});

describe('kycSubmittedPromoterEmail', () => {
  it('returns a non-empty string', () => {
    const { html } = kycSubmittedPromoterEmail('Acme Events s.r.o.');
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains processing time estimate', () => {
    const { html } = kycSubmittedPromoterEmail('Acme Events s.r.o.');
    expect(html).toContain('1–3 pracovní dny');
  });

  it('contains <html> tag', () => {
    const { html } = kycSubmittedPromoterEmail('Acme Events s.r.o.');
    expect(html).toContain('<html');
  });
});

describe('kycApprovedEmail', () => {
  const dashboardUrl = 'https://app.tixly.cz/dashboard';

  it('returns a non-empty string', () => {
    const { html } = kycApprovedEmail('Acme Events', dashboardUrl);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains the dashboardUrl', () => {
    const { html } = kycApprovedEmail('Acme Events', dashboardUrl);
    expect(html).toContain(dashboardUrl);
  });

  it('contains <html> tag', () => {
    const { html } = kycApprovedEmail('Acme Events', dashboardUrl);
    expect(html).toContain('<html');
  });

  it('has correct subject', () => {
    const { subject } = kycApprovedEmail('Acme Events', dashboardUrl);
    expect(subject).toContain('aktivován');
  });
});

describe('kycRejectedEmail', () => {
  it('returns a non-empty string', () => {
    const { html } = kycRejectedEmail('Acme Events', 'Chybí IČO potvrzení');
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains the reason', () => {
    const reason = 'Chybí IČO potvrzení';
    const { html } = kycRejectedEmail('Acme Events', reason);
    expect(html).toContain(reason);
  });

  it('contains <html> tag', () => {
    const { html } = kycRejectedEmail('Acme Events', 'reason');
    expect(html).toContain('<html');
  });

  it('escapes special characters in reason', () => {
    const dangerousReason = '<b>Nebezpečný & škodlivý obsah</b>';
    const { html } = kycRejectedEmail('Acme Events', dangerousReason);
    expect(html).not.toContain('<b>Nebezpečný');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&amp;');
  });
});

describe('adminKycNotificationEmail', () => {
  const promoterId = 'uuid-1234-5678';
  const adminUrl = 'https://admin.tixly.cz/kyc/uuid-1234-5678';

  it('returns a non-empty string', () => {
    const { html } = adminKycNotificationEmail('Acme Events', promoterId, adminUrl);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains the promoter name', () => {
    const { html } = adminKycNotificationEmail('Acme Events', promoterId, adminUrl);
    expect(html).toContain('Acme Events');
  });

  it('contains the promoter ID', () => {
    const { html } = adminKycNotificationEmail('Acme Events', promoterId, adminUrl);
    expect(html).toContain(promoterId);
  });

  it('contains <html> tag', () => {
    const { html } = adminKycNotificationEmail('Acme Events', promoterId, adminUrl);
    expect(html).toContain('<html');
  });

  it('subject contains promoterName', () => {
    const { subject } = adminKycNotificationEmail('Acme Events', promoterId, adminUrl);
    expect(subject).toContain('Acme Events');
  });
});

describe('newTicketSaleEmail', () => {
  const promoterName = 'Petr Novák';
  const eventName = 'Letní festival 2026';
  const ticketCount = 5;
  const grossAmountHalire = 50000;
  const orderId = 'ORD-12345-ABC';
  const dashboardUrl = 'https://app.tixly.cz/dashboard';

  it('returns non-empty subject and html', () => {
    const { subject, html } = newTicketSaleEmail(promoterName, eventName, ticketCount, grossAmountHalire, orderId, dashboardUrl);
    expect(subject.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
  });

  it('has correct subject format', () => {
    const { subject } = newTicketSaleEmail(promoterName, eventName, ticketCount, grossAmountHalire, orderId, dashboardUrl);
    expect(subject).toContain('Nový prodej');
    expect(subject).toContain(`${ticketCount}×`);
  });

  it('contains ticket count in html', () => {
    const { html } = newTicketSaleEmail(promoterName, eventName, ticketCount, grossAmountHalire, orderId, dashboardUrl);
    expect(html).toContain(`${ticketCount} ks`);
  });

  it('contains formatted amount in html', () => {
    const { html } = newTicketSaleEmail(promoterName, eventName, ticketCount, grossAmountHalire, orderId, dashboardUrl);
    expect(html).toContain('Kč');
    expect(html).toContain('500');
  });

  it('contains order ID in html', () => {
    const { html } = newTicketSaleEmail(promoterName, eventName, ticketCount, grossAmountHalire, orderId, dashboardUrl);
    expect(html).toContain(orderId);
  });

  it('contains dashboard URL in html', () => {
    const { html } = newTicketSaleEmail(promoterName, eventName, ticketCount, grossAmountHalire, orderId, dashboardUrl);
    expect(html).toContain(dashboardUrl);
  });

  it('contains <html> tag', () => {
    const { html } = newTicketSaleEmail(promoterName, eventName, ticketCount, grossAmountHalire, orderId, dashboardUrl);
    expect(html).toContain('<html');
  });

  it('escapes event name in subject', () => {
    const dangerousEvent = '<script>alert("xss")</script>';
    const { subject } = newTicketSaleEmail(promoterName, dangerousEvent, ticketCount, grossAmountHalire, orderId, dashboardUrl);
    expect(subject).not.toContain('<script>');
  });
});

describe('upcomingEventReminderEmail', () => {
  const promoterName = 'Acme Events';
  const eventName = 'Letní festival 2026';
  const eventDateFormatted = 'Sobota 12. dubna 2026, 20:00';
  const venueName = 'O2 Universum';
  const ticketsSold = 150;
  const totalCapacity = 300;
  const dashboardUrl = 'https://app.tixly.cz/dashboard';

  it('returns non-empty subject and html', () => {
    const { subject, html } = upcomingEventReminderEmail(promoterName, eventName, eventDateFormatted, venueName, ticketsSold, totalCapacity, dashboardUrl);
    expect(subject.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
  });

  it('has correct subject format', () => {
    const { subject } = upcomingEventReminderEmail(promoterName, eventName, eventDateFormatted, venueName, ticketsSold, totalCapacity, dashboardUrl);
    expect(subject).toContain('Připomínka');
    expect(subject).toContain(eventName);
  });

  it('contains event name in html', () => {
    const { html } = upcomingEventReminderEmail(promoterName, eventName, eventDateFormatted, venueName, ticketsSold, totalCapacity, dashboardUrl);
    expect(html).toContain(eventName);
  });

  it('contains formatted event date in html', () => {
    const { html } = upcomingEventReminderEmail(promoterName, eventName, eventDateFormatted, venueName, ticketsSold, totalCapacity, dashboardUrl);
    expect(html).toContain(eventDateFormatted);
  });

  it('contains venue name in html', () => {
    const { html } = upcomingEventReminderEmail(promoterName, eventName, eventDateFormatted, venueName, ticketsSold, totalCapacity, dashboardUrl);
    expect(html).toContain(venueName);
  });

  it('contains tickets sold / total capacity in html', () => {
    const { html } = upcomingEventReminderEmail(promoterName, eventName, eventDateFormatted, venueName, ticketsSold, totalCapacity, dashboardUrl);
    expect(html).toContain(`${ticketsSold} / ${totalCapacity}`);
    expect(html).toContain('vstupenek prodáno');
  });

  it('contains dashboard URL in html', () => {
    const { html } = upcomingEventReminderEmail(promoterName, eventName, eventDateFormatted, venueName, ticketsSold, totalCapacity, dashboardUrl);
    expect(html).toContain(dashboardUrl);
  });

  it('contains <html> tag', () => {
    const { html } = upcomingEventReminderEmail(promoterName, eventName, eventDateFormatted, venueName, ticketsSold, totalCapacity, dashboardUrl);
    expect(html).toContain('<html');
  });

  it('escapes dangerous characters in event name', () => {
    const dangerousEvent = '<b>Hacked&Event</b>';
    const { html } = upcomingEventReminderEmail(promoterName, dangerousEvent, eventDateFormatted, venueName, ticketsSold, totalCapacity, dashboardUrl);
    expect(html).not.toContain('<b>Hacked');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&amp;');
  });
});
