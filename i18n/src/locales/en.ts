export const en: Record<string, string> = {
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.save': 'Save',
  'common.close': 'Close',

  'ticket.title': 'TICKET',
  'ticket.orderNumber': 'Order Number',
  'ticket.event': 'Event',
  'ticket.date': 'Date',
  'ticket.venue': 'Venue',
  'ticket.seat': 'Seat',
  'ticket.gate': 'Gate',
  'ticket.validUntil': 'Valid Until',
  'ticket.barcode': 'Barcode',
  'ticket.scanInstructions': 'Present this QR code at the entrance',

  'email.orderConfirmation.subject': 'Order Confirmation #{{orderNumber}}',
  'email.orderConfirmation.greeting': 'Hello, {{name}}!',
  'email.orderConfirmation.body':
    'Your order #{{orderNumber}} has been successfully processed. Please find your tickets attached.',
  'email.orderConfirmation.ticketsAttached': 'Your tickets are attached to this email.',
  'email.refund.subject': 'Refund for Order #{{orderNumber}}',
  'email.refund.body':
    'Your payment of {{amount}} has been refunded. You will receive the funds within 3-5 business days.',
  'email.eventCancelled.subject': 'Event {{eventName}} has been cancelled',
  'email.eventCancelled.body':
    'We apologise, the event {{eventName}} has been cancelled. Your payment will be automatically refunded.',

  'error.notFound': 'The requested resource was not found.',
  'error.unauthorized': 'You must be logged in to access this resource.',
  'error.forbidden': 'You do not have permission to perform this action.',
  'error.serverError': 'Internal server error. Please try again.',
  'error.validation.required': 'This field is required.',
  'error.validation.invalidEmail': 'Please enter a valid email address.',
  'error.validation.tooShort': 'Value is too short (minimum {{min}} characters).',
  'error.checkout.soldOut': 'Tickets of this type are sold out.',
  'error.checkout.paymentFailed': 'Payment failed. Please try again.',
  'error.checkout.eventNotFound': 'Event was not found or is not available.',

  'checkout.summary': 'Order Summary',
  'checkout.total': 'Total',
  'checkout.proceedToPayment': 'Proceed to Payment',
  'checkout.orderPlaced': 'Order Placed',

  'datetime.format.date': 'MM/DD/YYYY',
  'datetime.format.datetime': 'MM/DD/YYYY h:mm A',
  'datetime.format.time': 'h:mm A',
};
