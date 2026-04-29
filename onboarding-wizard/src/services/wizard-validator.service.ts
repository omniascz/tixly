import type { WizardData, WizardStep } from '../lib/types.js';

// ─── Event Basics ─────────────────────────────────────────────────────────────

export function validateEventBasics(data: Partial<WizardData>): Record<string, string> {
  const errors: Record<string, string> = {};

  // eventName: required, min 3, max 200
  if (!data.eventName || data.eventName.trim().length === 0) {
    errors['eventName'] = 'Název akce je povinný.';
  } else if (data.eventName.trim().length < 3) {
    errors['eventName'] = 'Název akce musí mít alespoň 3 znaky.';
  } else if (data.eventName.trim().length > 200) {
    errors['eventName'] = 'Název akce nesmí přesáhnout 200 znaků.';
  }

  // eventDate: required, must be in the future
  if (!data.eventDate) {
    errors['eventDate'] = 'Datum akce je povinné.';
  } else {
    const date = new Date(data.eventDate);
    if (isNaN(date.getTime())) {
      errors['eventDate'] = 'Datum akce není platné.';
    } else if (date <= new Date()) {
      errors['eventDate'] = 'Datum akce musí být v budoucnosti.';
    }
  }

  // capacity: required, 1-100000
  if (data.capacity === undefined || data.capacity === null) {
    errors['capacity'] = 'Kapacita je povinná.';
  } else if (!Number.isInteger(data.capacity) || data.capacity < 1) {
    errors['capacity'] = 'Kapacita musí být alespoň 1.';
  } else if (data.capacity > 100000) {
    errors['capacity'] = 'Kapacita nesmí přesáhnout 100 000.';
  }

  // venueName: required if not online
  if (!data.isOnline && (!data.venueName || data.venueName.trim().length === 0)) {
    errors['venueName'] = 'Místo konání je povinné pro prezenční akce.';
  }

  return errors;
}

// ─── Ticket Types ─────────────────────────────────────────────────────────────

export function validateTicketTypes(data: Partial<WizardData>): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!data.ticketTypes || data.ticketTypes.length === 0) {
    errors['ticketTypes'] = 'Je potřeba alespoň jeden typ vstupenky.';
    return errors;
  }

  for (let i = 0; i < data.ticketTypes.length; i++) {
    const tt = data.ticketTypes[i]!;

    if (!tt.name || tt.name.trim().length === 0) {
      errors[`ticketTypes[${i}].name`] = 'Název vstupenky je povinný.';
    }

    if (tt.priceHalire < 0) {
      errors[`ticketTypes[${i}].priceHalire`] = 'Cena vstupenky nesmí být záporná.';
    }

    if (!Number.isInteger(tt.quantity) || tt.quantity <= 0) {
      errors[`ticketTypes[${i}].quantity`] = 'Množství vstupenek musí být alespoň 1.';
    }

    if (tt.salesStart && tt.salesEnd) {
      const start = new Date(tt.salesStart);
      const end = new Date(tt.salesEnd);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end <= start) {
        errors[`ticketTypes[${i}].salesEnd`] = 'Konec prodeje musí být po začátku prodeje.';
      }
    }
  }

  return errors;
}

// ─── Payment Setup ────────────────────────────────────────────────────────────

export function validatePaymentSetup(data: Partial<WizardData>): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!data.paymentMethods || data.paymentMethods.length === 0) {
    errors['paymentMethods'] = 'Je potřeba vybrat alespoň jednu platební metodu.';
  }

  if (data.payoutBankAccount !== undefined && data.payoutBankAccount.trim().length <= 10) {
    errors['payoutBankAccount'] = 'Číslo bankovního účtu musí mít více než 10 znaků.';
  }

  return errors;
}

// ─── Event Details ────────────────────────────────────────────────────────────

export function validateEventDetails(data: Partial<WizardData>): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!data.category || data.category.trim().length === 0) {
    errors['category'] = 'Kategorie akce je povinná.';
  }

  if (data.description !== undefined && data.description.trim().length < 10) {
    errors['description'] = 'Popis akce musí mít alespoň 10 znaků.';
  }

  return errors;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export function validateStep(
  step: WizardStep,
  data: Partial<WizardData>,
): Record<string, string> {
  switch (step) {
    case 'event_basics':
      return validateEventBasics(data);
    case 'ticket_types':
      return validateTicketTypes(data);
    case 'payment_setup':
      return validatePaymentSetup(data);
    case 'event_details':
      return validateEventDetails(data);
    case 'review_publish':
      // Review krok nemá vlastní validaci formuláře
      return {};
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}
