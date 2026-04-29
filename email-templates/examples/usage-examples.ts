/**
 * Real-world usage examples for Tixly email templates
 */

import {
  renderEmail,
  EmailTemplate,
  OrderConfirmationVariables,
  TicketDeliveryVariables,
  Reminder48hVariables,
  OrderCancellationVariables,
  ResaleSoldVariables,
} from '../src/email-renderer';

/**
 * Example 1: Order Confirmation
 * Send after successful payment processing
 */
export async function exampleOrderConfirmation(): Promise<void> {
  const variables: OrderConfirmationVariables = {
    template: EmailTemplate.OrderConfirmation,
    unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=abc123def456',
    preheaderText: 'Objednávka č. ORD-2026-001234 byla potvrzena. Stáhněte si svoje vstupenky.',
    orderNumber: 'ORD-2026-001234',
    customerName: 'Jana Nová',
    orderDate: 'čtvrtek 2. dubna 2026',
    items: [
      {
        eventTitle: 'The Cure - Konzertní turné 2026',
        date: 'pátek 5. května 2026',
        venue: 'O2 Universum',
        quantity: 2,
        unitPrice: '850 Kč',
        totalPrice: '1 700 Kč',
        ticketType: 'Stání VIP',
      },
      {
        eventTitle: 'The Cure - Konzertní turné 2026',
        date: 'pátek 5. května 2026',
        venue: 'O2 Universum',
        quantity: 1,
        unitPrice: '600 Kč',
        totalPrice: '600 Kč',
        ticketType: 'Sedadlo normální',
      },
    ],
    subtotal: '2 300 Kč',
    fees: '100 Kč',
    total: '2 400 Kč',
    paymentMethod: 'Bankovní transfer',
    downloadUrl: 'https://tixly.cz/api/orders/ORD-2026-001234/download',
  };

  const { html, text } = renderEmail(
    EmailTemplate.OrderConfirmation,
    variables
  );

  // Send with Mailgun
  // await mailgun.messages.create('tixly.cz', {
  //   from: 'Tixly <noreply@tixly.cz>',
  //   to: ['jana.nova@example.com'],
  //   subject: 'Vaše objednávka byla potvrzena',
  //   html: html,
  //   text: text,
  // });

  console.log('Order confirmation email rendered');
  console.log(`HTML length: ${html.length} chars`);
  console.log(`Text length: ${text.length} chars`);
}

/**
 * Example 2: Ticket Delivery
 * Send with PDF attachment after ticket generation
 */
export async function exampleTicketDelivery(): Promise<void> {
  const variables: TicketDeliveryVariables = {
    template: EmailTemplate.TicketDelivery,
    unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=xyz789abc123',
    preheaderText: 'Vaše vstupenka na The Cure je připravena!',
    customerName: 'Jana Nová',
    eventTitle: 'The Cure - Konzertní turné 2026',
    eventDate: 'pátek 5. května 2026',
    eventTime: '20:00',
    venue: 'O2 Universum',
    venueAddress: 'Nový Butovický Svět 1, 150 00 Praha 5',
    ticketType: 'Stání VIP',
    seatInfo: 'Volné stání - zóna A',
    ticketId: 'TKT-2026-001234001',
    qrCodeUrl: 'https://tixly.cz/api/qr/TKT-2026-001234001.png',
    dynamicQrNote:
      'Dynamický QR kód se obnovuje každých 30 sekund z bezpečnostních důvodů.',
    appDownloadUrl: 'https://tixly.cz/app',
  };

  const { html, text } = renderEmail(EmailTemplate.TicketDelivery, variables);

  // Send with PDF attachment
  // const pdfBuffer = await generateTicketPDF(ticketId);
  // await mailgun.messages.create('tixly.cz', {
  //   from: 'Tixly <noreply@tixly.cz>',
  //   to: ['jana.nova@example.com'],
  //   subject: 'Vaše vstupenka je připravena!',
  //   html: html,
  //   text: text,
  //   attachment: {
  //     filename: 'vstupenka_TKT-2026-001234001.pdf',
  //     data: pdfBuffer,
  //   },
  // });

  console.log('Ticket delivery email rendered');
}

/**
 * Example 3: 48-hour Reminder
 * Send 48 hours before event (automated by cron job)
 */
export async function exampleReminder48h(): Promise<void> {
  const variables: Reminder48hVariables = {
    template: EmailTemplate.Reminder48h,
    unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=reminder48h',
    preheaderText: 'The Cure - Koncert již zítra! Máte vše připraveno?',
    customerName: 'Jana Nová',
    eventTitle: 'The Cure - Koncertní turné 2026',
    eventDate: 'pátek 5. května 2026',
    eventTime: '20:00',
    venue: 'O2 Universum',
    venueAddress: 'Nový Butovický Svět 1, 150 00 Praha 5',
    doorsOpen: '19:00',
    seatInfo: 'Volné stání - zóna A',
    ticketCount: 2,
    appDownloadUrl: 'https://tixly.cz/app',
    mapUrl: 'https://maps.google.com/?q=O2+Universum+Praha',
    resaleUrl: 'https://tixly.cz/resale/TKT-2026-001234001',
    weatherNote:
      'Teplota se pohybuje okolo 16°C, doporučujeme si vzít bundu nebo svetr.',
    requiresId: false,
  };

  const { html, text } = renderEmail(EmailTemplate.Reminder48h, variables);

  console.log('48-hour reminder email rendered');
  console.log('Would be sent via cron job 48 hours before event');
}

/**
 * Example 4: Order Cancellation
 * Send when customer cancels or event is cancelled
 */
export async function exampleOrderCancellation(): Promise<void> {
  const variables: OrderCancellationVariables = {
    template: EmailTemplate.OrderCancellation,
    unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=cancel123',
    preheaderText: 'Objednávka byla zrušena. Vrátíme vám peníze.',
    customerName: 'Jana Nová',
    orderNumber: 'ORD-2026-001234',
    eventTitle: 'The Cure - Koncertní turné 2026',
    cancellationReason: 'Zrušení na požadavek zákazníka',
    refundAmount: '2 400 Kč',
    refundDays: 3,
    supportUrl: 'https://tixly.cz/support?order=ORD-2026-001234',
  };

  const { html, text } = renderEmail(
    EmailTemplate.OrderCancellation,
    variables
  );

  // await sendEmail(customer.email, html, text);

  console.log('Order cancellation email rendered');
}

/**
 * Example 5: Resale Sold
 * Send to seller when their ticket is sold on marketplace
 */
export async function exampleResaleSold(): Promise<void> {
  const variables: ResaleSoldVariables = {
    template: EmailTemplate.ResaleSold,
    unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=resale123',
    preheaderText: 'Vaše vstupenka byla prodána! Výplata brzy přijde.',
    sellerName: 'David Svoboda',
    eventTitle: 'The Cure - Koncertní turné 2026',
    salePrice: '1 000 Kč',
    buyerFirstName: 'Alena',
    payoutDate: 'středa 7. května 2026',
    payoutAmount: '850 Kč', // Po odečtení komise (15%)
    dashboardUrl: 'https://tixly.cz/dashboard/resale/TKT-2026-001234001',
  };

  const { html, text } = renderEmail(EmailTemplate.ResaleSold, variables);

  console.log('Resale sold email rendered');
  console.log('Commission: 150 Kč (15%)');
}

/**
 * Example 6: Batch sending (Newsletter or Event Announcement)
 * Send same template to multiple users with different names
 */
export async function exampleBatchSending(): Promise<void> {
  const customers = [
    {
      email: 'jana.nova@example.com',
      name: 'Jana Nová',
      orderNumber: 'ORD-2026-001234',
    },
    {
      email: 'petr.kucera@example.com',
      name: 'Petr Kučera',
      orderNumber: 'ORD-2026-001235',
    },
    {
      email: 'marie.svobodova@example.com',
      name: 'Marie Svobodová',
      orderNumber: 'ORD-2026-001236',
    },
  ];

  for (const customer of customers) {
    const variables: OrderConfirmationVariables = {
      template: EmailTemplate.OrderConfirmation,
      unsubscribeUrl: `https://tixly.cz/unsubscribe?token=${customer.email}`,
      preheaderText: `Objednávka č. ${customer.orderNumber} byla potvrzena.`,
      orderNumber: customer.orderNumber,
      customerName: customer.name,
      orderDate: 'čtvrtek 2. dubna 2026',
      items: [
        {
          eventTitle: 'The Cure - Koncertní turné 2026',
          date: 'pátek 5. května 2026',
          venue: 'O2 Universum',
          quantity: 1,
          unitPrice: '850 Kč',
          totalPrice: '850 Kč',
          ticketType: 'Stání VIP',
        },
      ],
      subtotal: '850 Kč',
      fees: '50 Kč',
      total: '900 Kč',
      paymentMethod: 'Bankovní transfer',
      downloadUrl: `https://tixly.cz/api/orders/${customer.orderNumber}/download`,
    };

    const { html, text } = renderEmail(
      EmailTemplate.OrderConfirmation,
      variables
    );

    // await mailgun.messages.create('tixly.cz', {
    //   from: 'Tixly <noreply@tixly.cz>',
    //   to: [customer.email],
    //   subject: 'Vaše objednávka byla potvrzena',
    //   html: html,
    //   text: text,
    // });

    console.log(`Email rendered for ${customer.name}`);
    // Add small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`\nBatch sending completed: ${customers.length} emails`);
}

/**
 * Example 7: Error handling
 * Demonstrate error handling when rendering templates
 */
export async function exampleErrorHandling(): Promise<void> {
  try {
    // Missing required field
    const invalidVariables: Partial<OrderConfirmationVariables> = {
      template: EmailTemplate.OrderConfirmation,
      unsubscribeUrl: 'https://test.cz',
      // Missing: orderNumber, customerName, etc.
    };

    const { html, text } = renderEmail(
      EmailTemplate.OrderConfirmation,
      invalidVariables as any
    );

    // Will render but with undefined/missing values
    console.log('Rendered despite missing variables:');
    console.log(html.substring(0, 200));
  } catch (error) {
    console.error('Error rendering template:', error);
  }

  try {
    // Non-existent template
    // @ts-ignore - intentional error
    renderEmail('non-existent-template', {});
  } catch (error) {
    console.error('Error: Template not found (expected)', error);
  }
}

// Run all examples
async function runAllExamples(): Promise<void> {
  console.log('=== Tixly Email Template Examples ===\n');

  console.log('1. Order Confirmation');
  await exampleOrderConfirmation();

  console.log('\n2. Ticket Delivery');
  await exampleTicketDelivery();

  console.log('\n3. 48-Hour Reminder');
  await exampleReminder48h();

  console.log('\n4. Order Cancellation');
  await exampleOrderCancellation();

  console.log('\n5. Resale Sold');
  await exampleResaleSold();

  console.log('\n6. Batch Sending');
  await exampleBatchSending();

  console.log('\n7. Error Handling');
  await exampleErrorHandling();

  console.log('\n=== All examples completed ===');
}

// Uncomment to run:
// runAllExamples().catch(console.error);
