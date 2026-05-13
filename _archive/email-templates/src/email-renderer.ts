import Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Email template names - enum for type-safe template references
 */
export enum EmailTemplate {
  OrderConfirmation = 'order-confirmation',
  TicketDelivery = 'ticket-delivery',
  Reminder48h = 'reminder-48h',
  OrderCancellation = 'order-cancellation',
  ResaleSold = 'resale-sold',
}

/**
 * Shared variables for all email templates
 */
interface SharedEmailVariables {
  unsubscribeUrl: string;
  preheaderText: string;
}

/**
 * Order confirmation email variables
 */
export interface OrderConfirmationVariables extends SharedEmailVariables {
  template: EmailTemplate.OrderConfirmation;
  orderNumber: string;
  customerName: string;
  orderDate: string;
  items: Array<{
    eventTitle: string;
    date: string;
    venue: string;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
    ticketType: string;
  }>;
  subtotal: string;
  fees: string;
  total: string;
  paymentMethod: string;
  downloadUrl: string;
}

/**
 * Ticket delivery email variables
 */
export interface TicketDeliveryVariables extends SharedEmailVariables {
  template: EmailTemplate.TicketDelivery;
  customerName: string;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  venue: string;
  venueAddress: string;
  ticketType: string;
  seatInfo: string | null;
  ticketId: string;
  qrCodeUrl: string;
  dynamicQrNote?: string;
  appDownloadUrl: string;
}

/**
 * 48-hour reminder email variables
 */
export interface Reminder48hVariables extends SharedEmailVariables {
  template: EmailTemplate.Reminder48h;
  customerName: string;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  venue: string;
  venueAddress: string;
  doorsOpen: string;
  seatInfo: string;
  ticketCount: number;
  appDownloadUrl: string;
  mapUrl: string;
  resaleUrl: string;
  weatherNote?: string;
  requiresId?: boolean;
}

/**
 * Order cancellation email variables
 */
export interface OrderCancellationVariables extends SharedEmailVariables {
  template: EmailTemplate.OrderCancellation;
  customerName: string;
  orderNumber: string;
  eventTitle: string;
  cancellationReason: string;
  refundAmount: string;
  refundDays: number;
  supportUrl: string;
}

/**
 * Resale sold email variables
 */
export interface ResaleSoldVariables extends SharedEmailVariables {
  template: EmailTemplate.ResaleSold;
  sellerName: string;
  eventTitle: string;
  salePrice: string;
  buyerFirstName: string;
  payoutDate: string;
  payoutAmount: string;
  dashboardUrl: string;
}

/**
 * Union type for all email template variables
 */
export type EmailVariables =
  | OrderConfirmationVariables
  | TicketDeliveryVariables
  | Reminder48hVariables
  | OrderCancellationVariables
  | ResaleSoldVariables;

/**
 * Email render result with both HTML and plain-text versions
 */
export interface EmailRenderResult {
  html: string;
  text: string;
}

/**
 * Render email template with variables using Handlebars
 * @param templateName - Name of the template (use EmailTemplate enum)
 * @param variables - Variables to render into template
 * @returns Object with html and text properties
 * @throws Error if template file not found or rendering fails
 */
export function renderEmail(
  templateName: EmailTemplate | string,
  variables: Record<string, unknown>
): EmailRenderResult {
  // Load template file
  const templatePath = path.join(
    __dirname,
    '..',
    `${templateName}.html`
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Email template not found: ${templateName}`);
  }

  const templateContent = fs.readFileSync(templatePath, 'utf-8');

  // Compile and render with Handlebars
  const template = Handlebars.compile(templateContent);
  const html = template(variables);

  // Generate plain-text version by stripping HTML
  const text = htmlToPlainText(html);

  return { html, text };
}

/**
 * Convert HTML to plain text by:
 * - Stripping HTML tags
 * - Preserving structure with line breaks
 * - Decoding HTML entities
 * @param html - HTML string
 * @returns Plain text string
 */
function htmlToPlainText(html: string): string {
  let text = html;

  // Remove script and style elements and their content
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Replace closing tags with line breaks
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<\/td>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));

  // Remove leading/trailing whitespace and collapse multiple blank lines
  text = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');

  return text;
}

/**
 * Register custom Handlebars helpers
 */
export function registerHandlebarsHelpers(): void {
  // Helper for equality checks in conditionals
  Handlebars.registerHelper('if', function (condition, options) {
    return condition ? options.fn(this) : options.inverse(this);
  });

  // Helper for pluralization
  Handlebars.registerHelper('plural', function (count, singular, plural) {
    return count === 1 ? singular : plural;
  });

  // Helper for date formatting (Czech locale)
  Handlebars.registerHelper('formatDate', function (dateString) {
    try {
      const date = new Date(dateString);
      const formatter = new Intl.DateTimeFormat('cs-CZ', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      return formatter.format(date);
    } catch {
      return dateString;
    }
  });

  // Helper for price formatting (Czech currency)
  Handlebars.registerHelper('formatPrice', function (amount) {
    if (typeof amount === 'number') {
      return new Intl.NumberFormat('cs-CZ', {
        style: 'currency',
        currency: 'CZK',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(amount);
    }
    return amount;
  });
}

// Initialize Handlebars helpers on module load
registerHandlebarsHelpers();
