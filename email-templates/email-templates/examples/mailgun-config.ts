/**
 * Mailgun configuration for Tixly email sending
 *
 * Environment variables required:
 * - MAILGUN_API_KEY: Your Mailgun API key
 * - MAILGUN_DOMAIN: Your Mailgun domain (e.g. tixly.cz)
 */

import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import {
  renderEmail,
  EmailTemplate,
  EmailVariables,
  OrderConfirmationVariables,
} from '../src/email-renderer';

const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY || '',
});

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'tixly.cz';
const FROM_EMAIL = `Tixly <noreply@${MAILGUN_DOMAIN}>`;

/**
 * Send email using Mailgun
 */
export async function sendEmail(
  recipientEmail: string,
  template: EmailTemplate,
  variables: EmailVariables,
  attachments?: Array<{ filename: string; data: Buffer }>
): Promise<void> {
  // Render template
  const { html, text } = renderEmail(template, variables);

  // Prepare message object
  const messageData: Record<string, unknown> = {
    from: FROM_EMAIL,
    to: recipientEmail,
    html: html,
    text: text,
    'v:template': template,
    'o:tracking': 'yes',
    'o:tracking-opens': 'yes',
    'o:tracking-clicks': 'html',
  };

  // Add custom variables for tracking
  if ('customerName' in variables) {
    messageData['v:customer_name'] = (variables as { customerName: string }).customerName;
  }
  if ('orderNumber' in variables) {
    messageData['v:order_number'] = (variables as { orderNumber: string }).orderNumber;
  }

  // Add subject line based on template
  const subjectLines: Record<EmailTemplate, string> = {
    [EmailTemplate.OrderConfirmation]: 'Vaše objednávka byla potvrzena',
    [EmailTemplate.TicketDelivery]: 'Vaše vstupenka je připravena!',
    [EmailTemplate.Reminder48h]: 'Připomínka: akce zítra!',
    [EmailTemplate.OrderCancellation]: 'Objednávka byla zrušena',
    [EmailTemplate.ResaleSold]: 'Vaše vstupenka byla prodána!',
  };

  messageData.subject = subjectLines[template];

  // Add category for filtering in Mailgun
  messageData['o:tag'] = [template, 'production'];

  // Add attachments if provided
  if (attachments && attachments.length > 0) {
    messageData.attachment = attachments.map((att) => ({
      filename: att.filename,
      data: att.data,
    }));
  }

  // Send message
  try {
    const response = await mg.messages.create(MAILGUN_DOMAIN, messageData);
    console.log(`Email sent: ${response.id}`);
  } catch (error) {
    console.error(`Failed to send email to ${recipientEmail}:`, error);
    throw error;
  }
}

/**
 * Send order confirmation email
 */
export async function sendOrderConfirmation(
  recipientEmail: string,
  variables: Omit<OrderConfirmationVariables, 'template'>
): Promise<void> {
  await sendEmail(recipientEmail, EmailTemplate.OrderConfirmation, {
    template: EmailTemplate.OrderConfirmation,
    ...variables,
  });
}

/**
 * Batch send emails (useful for newsletters or bulk notifications)
 */
export async function sendBatchEmails(
  recipients: string[],
  template: EmailTemplate,
  variables: EmailVariables,
  delayMs: number = 100
): Promise<void> {
  for (const recipient of recipients) {
    await sendEmail(recipient, template, variables);
    // Add delay between sends to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  console.log(`Batch send completed: ${recipients.length} emails`);
}

/**
 * Webhook handler for Mailgun events
 * Integrate with your Express/Fastify server
 *
 * Example (Express):
 * app.post('/webhooks/mailgun', express.json(), handleMailgunWebhook);
 */
export async function handleMailgunWebhook(
  body: Record<string, unknown>,
  signature: Record<string, unknown>
): Promise<boolean> {
  // Verify webhook signature (Mailgun uses HMAC-SHA256)
  const crypto = await import('crypto');
  const apiKey = process.env.MAILGUN_API_KEY || '';

  const timestamp = (signature.timestamp as string) || '';
  const token = (signature.token as string) || '';
  const expectedSignature = crypto
    .createHmac('sha256', apiKey)
    .update(`${timestamp}${token}`)
    .digest('hex');

  const isValid = expectedSignature === (signature.signature as string);

  if (!isValid) {
    console.warn('Invalid Mailgun webhook signature');
    return false;
  }

  // Process webhook events
  const eventData = body['event-data'] as Record<string, unknown>;
  const event = eventData?.event as string;
  const recipient = eventData?.recipient as string;

  switch (event) {
    case 'delivered':
      console.log(`Email delivered to ${recipient}`);
      // Update database: email_status = 'delivered'
      break;
    case 'opened':
      console.log(`Email opened by ${recipient}`);
      // Update database: email_opened = true
      break;
    case 'clicked':
      console.log(`Email link clicked by ${recipient}`);
      // Update database: email_clicked = true
      break;
    case 'failed':
      console.log(`Email failed for ${recipient}:`, eventData.reason);
      // Update database: email_status = 'failed', reason = ...
      break;
    case 'unsubscribed':
      console.log(`User unsubscribed: ${recipient}`);
      // Update database: opted_out = true
      break;
  }

  return true;
}

/**
 * Test email sending
 */
export async function sendTestEmail(): Promise<void> {
  const testVariables: OrderConfirmationVariables = {
    template: EmailTemplate.OrderConfirmation,
    unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=test',
    preheaderText: 'Test email',
    orderNumber: 'TEST-001',
    customerName: 'Test User',
    orderDate: 'čtvrtek 2. dubna 2026',
    items: [
      {
        eventTitle: 'Test Event',
        date: 'pátek 10. května 2026',
        venue: 'Test Venue',
        quantity: 1,
        unitPrice: '500 Kč',
        totalPrice: '500 Kč',
        ticketType: 'Stání',
      },
    ],
    subtotal: '500 Kč',
    fees: '0 Kč',
    total: '500 Kč',
    paymentMethod: 'Test Payment',
    downloadUrl: 'https://tixly.cz/download/test',
  };

  await sendEmail('test@example.com', EmailTemplate.OrderConfirmation, testVariables);
  console.log('Test email sent');
}
