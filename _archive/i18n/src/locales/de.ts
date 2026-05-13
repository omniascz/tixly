export const de: Record<string, string> = {
  'common.yes': 'Ja',
  'common.no': 'Nein',
  'common.cancel': 'Abbrechen',
  'common.confirm': 'Bestätigen',
  'common.save': 'Speichern',
  'common.close': 'Schließen',

  'ticket.title': 'EINTRITTSKARTE',
  'ticket.orderNumber': 'Bestellnummer',
  'ticket.event': 'Veranstaltung',
  'ticket.date': 'Datum',
  'ticket.venue': 'Veranstaltungsort',
  'ticket.seat': 'Sitzplatz',
  'ticket.gate': 'Eingang',
  'ticket.validUntil': 'Gültig bis',
  'ticket.barcode': 'Barcode',
  'ticket.scanInstructions': 'Zeigen Sie diesen QR-Code am Eingang vor',

  'email.orderConfirmation.subject': 'Bestellbestätigung #{{orderNumber}}',
  'email.orderConfirmation.greeting': 'Guten Tag, {{name}}!',
  'email.orderConfirmation.body':
    'Ihre Bestellung Nr. {{orderNumber}} wurde erfolgreich bearbeitet. Im Anhang finden Sie Ihre Eintrittskarten.',
  'email.orderConfirmation.ticketsAttached': 'Ihre Eintrittskarten sind dieser E-Mail beigefügt.',
  'email.refund.subject': 'Rückerstattung für Bestellung #{{orderNumber}}',
  'email.refund.body':
    'Ihre Zahlung in Höhe von {{amount}} wurde erstattet. Sie erhalten das Geld innerhalb von 3-5 Werktagen.',
  'email.eventCancelled.subject': 'Veranstaltung {{eventName}} wurde abgesagt',
  'email.eventCancelled.body':
    'Wir entschuldigen uns, die Veranstaltung {{eventName}} wurde abgesagt. Ihre Zahlung wird automatisch erstattet.',

  'error.notFound': 'Die angeforderte Ressource wurde nicht gefunden.',
  'error.unauthorized': 'Sie müssen angemeldet sein, um auf diese Ressource zuzugreifen.',
  'error.forbidden': 'Sie haben keine Berechtigung, diese Aktion auszuführen.',
  'error.serverError': 'Interner Serverfehler. Bitte versuchen Sie es erneut.',
  'error.validation.required': 'Dieses Feld ist erforderlich.',
  'error.validation.invalidEmail': 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
  'error.validation.tooShort': 'Der Wert ist zu kurz (Minimum {{min}} Zeichen).',
  'error.checkout.soldOut': 'Eintrittskarten dieses Typs sind ausverkauft.',
  'error.checkout.paymentFailed': 'Zahlung fehlgeschlagen. Bitte versuchen Sie es erneut.',
  'error.checkout.eventNotFound': 'Die Veranstaltung wurde nicht gefunden oder ist nicht verfügbar.',

  'checkout.summary': 'Bestellübersicht',
  'checkout.total': 'Gesamt',
  'checkout.proceedToPayment': 'Zur Zahlung',
  'checkout.orderPlaced': 'Bestellung aufgegeben',

  'datetime.format.date': 'DD.MM.YYYY',
  'datetime.format.datetime': 'DD.MM.YYYY HH:mm',
  'datetime.format.time': 'HH:mm',
};
