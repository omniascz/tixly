export const cs: Record<string, string> = {
  'common.yes': 'Ano',
  'common.no': 'Ne',
  'common.cancel': 'Zrušit',
  'common.confirm': 'Potvrdit',
  'common.save': 'Uložit',
  'common.close': 'Zavřít',

  'ticket.title': 'VSTUPENKA',
  'ticket.orderNumber': 'Číslo objednávky',
  'ticket.event': 'Akce',
  'ticket.date': 'Datum',
  'ticket.venue': 'Místo konání',
  'ticket.seat': 'Sedadlo',
  'ticket.gate': 'Vstup',
  'ticket.validUntil': 'Platná do',
  'ticket.barcode': 'Čárový kód',
  'ticket.scanInstructions': 'Předložte tento QR kód při vstupu',

  'email.orderConfirmation.subject': 'Potvrzení objednávky #{{orderNumber}}',
  'email.orderConfirmation.greeting': 'Dobrý den, {{name}}!',
  'email.orderConfirmation.body':
    'Vaše objednávka č. {{orderNumber}} byla úspěšně zpracována. V příloze naleznete své vstupenky.',
  'email.orderConfirmation.ticketsAttached': 'Vstupenky jsou přiloženy k tomuto emailu.',
  'email.refund.subject': 'Vrácení platby #{{orderNumber}}',
  'email.refund.body':
    'Vaše platba ve výši {{amount}} byla vrácena. Peníze obdržíte do 3-5 pracovních dní.',
  'email.eventCancelled.subject': 'Akce {{eventName}} byla zrušena',
  'email.eventCancelled.body':
    'Omlouváme se, akce {{eventName}} byla zrušena. Vaše platba bude automaticky vrácena.',

  'error.notFound': 'Požadovaný zdroj nebyl nalezen.',
  'error.unauthorized': 'Pro přístup k tomuto zdroji musíte být přihlášeni.',
  'error.forbidden': 'Nemáte oprávnění k provedení této akce.',
  'error.serverError': 'Interní chyba serveru. Zkuste to prosím znovu.',
  'error.validation.required': 'Toto pole je povinné.',
  'error.validation.invalidEmail': 'Zadejte platnou emailovou adresu.',
  'error.validation.tooShort': 'Hodnota je příliš krátká (minimum {{min}} znaků).',
  'error.checkout.soldOut': 'Vstupenky tohoto typu jsou vyprodány.',
  'error.checkout.paymentFailed': 'Platba se nezdařila. Zkuste to prosím znovu.',
  'error.checkout.eventNotFound': 'Akce nebyla nalezena nebo není dostupná.',

  'checkout.summary': 'Shrnutí objednávky',
  'checkout.total': 'Celkem',
  'checkout.proceedToPayment': 'Přejít k platbě',
  'checkout.orderPlaced': 'Objednávka byla přijata',

  'datetime.format.date': 'D. M. YYYY',
  'datetime.format.datetime': 'D. M. YYYY HH:mm',
  'datetime.format.time': 'HH:mm',
};
