export type Locale = 'cs' | 'en' | 'sk' | 'de';

export type TranslationKey =
  // Common
  | 'common.yes' | 'common.no' | 'common.cancel' | 'common.confirm' | 'common.save' | 'common.close'
  // Tickets
  | 'ticket.title' | 'ticket.orderNumber' | 'ticket.event' | 'ticket.date' | 'ticket.venue'
  | 'ticket.seat' | 'ticket.gate' | 'ticket.validUntil' | 'ticket.barcode' | 'ticket.scanInstructions'
  // Emails
  | 'email.orderConfirmation.subject' | 'email.orderConfirmation.greeting'
  | 'email.orderConfirmation.body' | 'email.orderConfirmation.ticketsAttached'
  | 'email.refund.subject' | 'email.refund.body'
  | 'email.eventCancelled.subject' | 'email.eventCancelled.body'
  // API Errors
  | 'error.notFound' | 'error.unauthorized' | 'error.forbidden' | 'error.serverError'
  | 'error.validation.required' | 'error.validation.invalidEmail' | 'error.validation.tooShort'
  | 'error.checkout.soldOut' | 'error.checkout.paymentFailed' | 'error.checkout.eventNotFound'
  // Checkout
  | 'checkout.summary' | 'checkout.total' | 'checkout.proceedToPayment' | 'checkout.orderPlaced'
  // Datetime
  | 'datetime.format.date' | 'datetime.format.datetime' | 'datetime.format.time';

export interface TranslationMap {
  [key: string]: string;
}

export interface InterpolationParams {
  [key: string]: string | number;
}
