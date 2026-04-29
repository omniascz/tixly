/**
 * email-templates.ts
 *
 * Re-engagement email templates in Czech with discount codes and event recommendations.
 * Returns { subject, html } for each dormancy level and campaign step.
 */

import type { DormancyLevel } from '../types/re-engagement.types.js';

export interface EmailTemplateInput {
  name: string;
  lastPurchaseDate: Date;
  discountCode?: string;
  dormancyLevel: DormancyLevel;
  stepIndex: number;
  churnScore: number;
}

export interface EmailTemplate {
  subject: string;
  html: string;
}

/**
 * Formats a date as DD.MM.YYYY (Czech convention)
 */
function formatCzechDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Generates HTML table row for event recommendation
 */
function eventRowHtml(eventName: string, eventDate: string, discount: string): string {
  return `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 12px; font-size: 14px; color: #333;">
        <strong>${eventName}</strong><br/>
        <span style="color: #666; font-size: 12px;">${eventDate}</span>
      </td>
      <td style="padding: 12px; text-align: center;">
        <span style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">${discount}</span>
      </td>
    </tr>
  `;
}

/**
 * Day 0: Initial re-engagement email with discount code and event recommendations
 */
export function dormantCustomerEmailDay0(input: EmailTemplateInput): EmailTemplate {
  const lastPurchaseFormatted = formatCzechDate(input.lastPurchaseDate);
  const daysSince = Math.floor(
    (new Date().getTime() - input.lastPurchaseDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const subject =
    input.dormancyLevel === 'churned'
      ? `${input.name}, vrátíme se k tobě! 🎉 Speciální sleva -20%`
      : `${input.name}, už na tebe čekáme! 🎫 Sleva -15%`;

  const discountSection = input.discountCode
    ? `
      <tr>
        <td style="padding: 20px; text-align: center; background: #f9f9f9;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px; color: white;">
            <p style="margin: 0 0 8px 0; font-size: 12px; color: rgba(255,255,255,0.8);">TVŮJ KÓDU SLEVA:</p>
            <p style="margin: 0; font-size: 24px; font-weight: bold; letter-spacing: 2px;">${input.discountCode}</p>
            <p style="margin: 8px 0 0 0; font-size: 12px; color: rgba(255,255,255,0.8);">Platný 30 dní</p>
          </div>
        </td>
      </tr>
    `
    : '';

  const html = `
    <!DOCTYPE html>
    <html lang="cs">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; line-height: 1.6; }
        a { color: #667eea; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .container { max-width: 600px; margin: 0 auto; }
      </style>
    </head>
    <body>
      <div class="container">
        <table cellpadding="0" cellspacing="0" width="100%" style="background: white; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
          <!-- Header -->
          <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
            <td style="padding: 30px; color: white; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Vrátíme se k tobě! 🎉</h1>
              <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Poslední nákup: ${lastPurchaseFormatted} (${daysSince} dní zpět)</p>
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 16px 0; font-size: 16px;">Ahoj ${input.name},</p>

              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.8; color: #555;">
                Už je to ${daysSince} dní, co jsi u nás nakupoval. Chybíš nám a chceme ti nabídnout speciální vrácení.
                ${
                  input.dormancyLevel === 'churned'
                    ? 'Jako naší dlouhodobému zákazníkovi ti dáme extra slevu <strong>-20%</strong> na všechny vstupenky!'
                    : 'Připravili jsme pro tebe slevu <strong>-15%</strong> na příští nákup.'
                }
              </p>

              ${discountSection}

              <!-- Events table -->
              <tr>
                <td style="padding: 20px 0;">
                  <h3 style="margin: 0 0 16px 0; font-size: 16px; color: #333;">Nové akce, které by se ti mohly líbit:</h3>
                  <table cellpadding="0" cellspacing="0" width="100%" style="border: 1px solid #eee; border-radius: 6px; overflow: hidden;">
                    <thead>
                      <tr style="background: #f5f5f5; border-bottom: 2px solid #eee;">
                        <th style="padding: 12px; text-align: left; font-size: 13px; font-weight: bold; color: #666;">Akce</th>
                        <th style="padding: 12px; text-align: center; font-size: 13px; font-weight: bold; color: #666;">Sleva</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${eventRowHtml('Rock Koncert — The Clash Revival', '15.5.2026', '-15%')}
                      ${eventRowHtml('Stand-up Comedy — Zdeněk Svoboda', '22.5.2026', '-15%')}
                      ${eventRowHtml('Kino premiéra — Avatar Saga', '28.5.2026', 'ZDARMA popcorn')}
                    </tbody>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding: 20px 0;">
                  <a href="https://tixly.com/events?promo=${input.discountCode || 'WELCOME'}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 32px; border-radius: 6px; font-weight: bold; text-decoration: none; font-size: 14px;">
                    Koupit vstupenky
                  </a>
                </td>
              </tr>

              <p style="margin: 24px 0 0 0; font-size: 13px; color: #999; border-top: 1px solid #eee; padding-top: 16px;">
                Máš nějaké otázky? <a href="https://tixly.com/support">Kontaktuj nás</a><br/>
                <a href="https://tixly.com/unsubscribe?token=${Buffer.from(input.name).toString('base64')}">Odhlásit se z re-engagement emailů</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr style="background: #f9f9f9; border-top: 1px solid #eee;">
            <td style="padding: 16px; text-align: center; font-size: 12px; color: #999;">
              <p style="margin: 0;">© 2026 Tixly. Všechna práva vyhrazena.</p>
            </td>
          </tr>
        </table>
      </div>
    </body>
    </html>
  `;

  return { subject, html };
}

/**
 * Day 3: Push reminder (text only for push notification)
 */
export function dormantCustomerEmailDay3(input: EmailTemplateInput): EmailTemplate {
  const subject =
    input.dormancyLevel === 'churned'
      ? `${input.name}, poslední šance na slevu -20%! ⏰`
      : `${input.name}, sleva vypršení za 4 dny! ⏰`;

  const html = `
    <!DOCTYPE html>
    <html lang="cs">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; margin: 0; padding: 0;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <table cellpadding="0" cellspacing="0" width="100%" style="background: white; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
          <tr style="background: #ff6b6b;">
            <td style="padding: 20px; color: white; text-align: center;">
              <h2 style="margin: 0; font-size: 22px;">Poslední připomenutí! ⏰</h2>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px;">
              <p style="margin: 0 0 16px 0; font-size: 16px;">Ahoj ${input.name},</p>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.8;">
                Tvá speciální sleva ${input.dormancyLevel === 'churned' ? '<strong>-20%</strong>' : '<strong>-15%</strong>'} vyprší za 4 dny!
                Nenech si ujít tuto příležitost.
              </p>
              <div style="text-align: center; margin: 24px 0;">
                <a href="https://tixly.com/events?promo=${input.discountCode || 'WELCOME'}" style="display: inline-block; background: #ff6b6b; color: white; padding: 14px 36px; border-radius: 6px; font-weight: bold; text-decoration: none; font-size: 14px;">
                  Koupit teď
                </a>
              </div>
            </td>
          </tr>
        </table>
      </div>
    </body>
    </html>
  `;

  return { subject, html };
}

/**
 * Day 7: Final incentive email (last chance with additional bonus)
 */
export function dormantCustomerEmailDay7(input: EmailTemplateInput): EmailTemplate {
  const subject = `${input.name}, poslední šance! Tvá sleva zmizí zítra. 😢`;

  const html = `
    <!DOCTYPE html>
    <html lang="cs">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; margin: 0; padding: 0;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <table cellpadding="0" cellspacing="0" width="100%" style="background: white; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
          <tr style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
            <td style="padding: 30px; color: white; text-align: center;">
              <h2 style="margin: 0; font-size: 24px; font-weight: bold;">POSLEDNÍ ŠANCE! 😢</h2>
              <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Tvá speciální sleva zmizí zítra ráno</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; font-weight: bold;">${input.name},</p>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.8; color: #555;">
                Tvůj kód slevo <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-family: monospace;">${input.discountCode || 'WELCOME'}</code>
                <strong>samizí zítra o půlnoci</strong>.
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; color: #666;">
                Pokud máš v oblíbených nějaké vstupenky, teď je ten správný čas koupit!
              </p>

              <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 16px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; font-size: 13px; color: #856404;">
                  <strong>BONUS:</strong> Pokud nakoupíš dnes, dostaneš navíc <strong>slevu -10% na další nákup</strong>! 🎁
                </p>
              </div>

              <div style="text-align: center; margin: 24px 0;">
                <a href="https://tixly.com/events?promo=${input.discountCode || 'WELCOME'}" style="display: inline-block; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 14px 40px; border-radius: 6px; font-weight: bold; text-decoration: none; font-size: 15px;">
                  Koupit vstupenky teď
                </a>
              </div>

              <p style="margin: 24px 0 0 0; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 16px;">
                <a href="https://tixly.com/unsubscribe?token=${Buffer.from(input.name).toString('base64')}">Odhlásit se z emailů</a>
              </p>
            </td>
          </tr>
        </table>
      </div>
    </body>
    </html>
  `;

  return { subject, html };
}

/**
 * Main entry point: returns email template based on step index and dormancy level
 */
export function getEmailTemplate(input: EmailTemplateInput): EmailTemplate {
  switch (input.stepIndex) {
    case 0:
      return dormantCustomerEmailDay0(input);
    case 1:
      return dormantCustomerEmailDay3(input);
    case 2:
      return dormantCustomerEmailDay7(input);
    default:
      return dormantCustomerEmailDay0(input); // fallback
  }
}
