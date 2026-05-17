/**
 * Webhook event types pro outbound webhooks — promotér registruje na tyto eventy
 * a Tixly mu POSTuje JSON payload do registrované URL.
 *
 * Plánované rozšíření (v2): refund.requested, payout.failed, fraud.flagged.
 */

export const WEBHOOK_EVENT_TYPES = [
  'event.published',
  'event.cancelled',
  'event.sold_out',
  'order.created',
  'order.paid',
  'order.refunded',
  'ticket.checked_in',
  'payout.settled',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const EVENT_TYPE_DESCRIPTION: Record<WebhookEventType, string> = {
  'event.published': 'Akce byla publikována (status → published)',
  'event.cancelled': 'Akce byla zrušena (status → cancelled)',
  'event.sold_out': 'Všechny lístky akce byly prodány',
  'order.created': 'Vznikla nová objednávka (před platbou)',
  'order.paid': 'Objednávka byla zaplacena (webhook od platebního providera)',
  'order.refunded': 'Objednávka byla vrácena (refund schválen)',
  'ticket.checked_in': 'Lístek byl naskenován u vstupu',
  'payout.settled': 'Týdenní výplata byla vytvořena',
};
