export const sk: Record<string, string> = {
  'common.yes': 'Áno',
  'common.no': 'Nie',
  'common.cancel': 'Zrušiť',
  'common.confirm': 'Potvrdiť',
  'common.save': 'Uložiť',
  'common.close': 'Zavrieť',

  'ticket.title': 'VSTUPENKA',
  'ticket.orderNumber': 'Číslo objednávky',
  'ticket.event': 'Akcia',
  'ticket.date': 'Dátum',
  'ticket.venue': 'Miesto konania',
  'ticket.seat': 'Sedadlo',
  'ticket.gate': 'Vstup',
  'ticket.validUntil': 'Platná do',
  'ticket.barcode': 'Čiarový kód',
  'ticket.scanInstructions': 'Predložte tento QR kód pri vstupe',

  'email.orderConfirmation.subject': 'Potvrdenie objednávky #{{orderNumber}}',
  'email.orderConfirmation.greeting': 'Dobrý deň, {{name}}!',
  'email.orderConfirmation.body':
    'Vaša objednávka č. {{orderNumber}} bola úspešne spracovaná. V prílohe nájdete svoje vstupenky.',
  'email.orderConfirmation.ticketsAttached': 'Vstupenky sú priložené k tomuto e-mailu.',
  'email.refund.subject': 'Vrátenie platby #{{orderNumber}}',
  'email.refund.body':
    'Vaša platba vo výške {{amount}} bola vrátená. Peniaze obdržíte do 3-5 pracovných dní.',
  'email.eventCancelled.subject': 'Akcia {{eventName}} bola zrušená',
  'email.eventCancelled.body':
    'Ospravedlňujeme sa, akcia {{eventName}} bola zrušená. Vaša platba bude automaticky vrátená.',

  'error.notFound': 'Požadovaný zdroj nebol nájdený.',
  'error.unauthorized': 'Pre prístup k tomuto zdroju musíte byť prihlásení.',
  'error.forbidden': 'Nemáte oprávnenie na vykonanie tejto akcie.',
  'error.serverError': 'Interná chyba servera. Skúste to prosím znova.',
  'error.validation.required': 'Toto pole je povinné.',
  'error.validation.invalidEmail': 'Zadajte platnú e-mailovú adresu.',
  'error.validation.tooShort': 'Hodnota je príliš krátka (minimum {{min}} znakov).',
  'error.checkout.soldOut': 'Vstupenky tohto typu sú vypredané.',
  'error.checkout.paymentFailed': 'Platba sa nepodarila. Skúste to prosím znova.',
  'error.checkout.eventNotFound': 'Akcia nebola nájdená alebo nie je dostupná.',

  'checkout.summary': 'Prehľad objednávky',
  'checkout.total': 'Celkom',
  'checkout.proceedToPayment': 'Prejsť k platbe',
  'checkout.orderPlaced': 'Objednávka bola prijatá',

  'datetime.format.date': 'D. M. YYYY',
  'datetime.format.datetime': 'D. M. YYYY HH:mm',
  'datetime.format.time': 'HH:mm',
};
