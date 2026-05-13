import { z } from 'zod';

// ---------------------------------------------------------------------------
// Registrace mikro-pořadatele
// ---------------------------------------------------------------------------
export const RegisterMicroOrganizerSchema = z.object({
  firstName: z
    .string({ required_error: 'Jméno je povinné.' })
    .min(1, 'Jméno je povinné.')
    .max(100, 'Jméno nesmí přesáhnout 100 znaků.'),

  lastName: z
    .string({ required_error: 'Příjmení je povinné.' })
    .min(1, 'Příjmení je povinné.')
    .max(100, 'Příjmení nesmí přesáhnout 100 znaků.'),

  email: z
    .string({ required_error: 'E-mail je povinný.' })
    .email('Zadejte platnou e-mailovou adresu.'),

  password: z
    .string({ required_error: 'Heslo je povinné.' })
    .min(8, 'Heslo musí mít alespoň 8 znaků.'),
});

export type RegisterMicroOrganizerInput = z.infer<typeof RegisterMicroOrganizerSchema>;

// ---------------------------------------------------------------------------
// Vytvoření mikro-akce
// ---------------------------------------------------------------------------
export const CreateMicroEventSchema = z.object({
  name: z
    .string({ required_error: 'Název akce je povinný.' })
    .min(3, 'Název akce musí mít alespoň 3 znaky.')
    .max(200, 'Název akce nesmí přesáhnout 200 znaků.'),

  dateTime: z
    .string({ required_error: 'Datum a čas akce jsou povinné.' })
    .datetime({ message: 'Datum a čas musí být ve formátu ISO 8601 (např. 2026-06-01T18:00:00Z).' }),

  venueName: z
    .string({ required_error: 'Název místa konání je povinný.' })
    .min(1, 'Název místa konání je povinný.')
    .max(200, 'Název místa konání nesmí přesáhnout 200 znaků.'),

  city: z
    .string({ required_error: 'Město je povinné.' })
    .min(1, 'Město je povinné.')
    .max(100, 'Město nesmí přesáhnout 100 znaků.'),

  capacityTotal: z
    .number({ required_error: 'Kapacita je povinná.' })
    .int('Kapacita musí být celé číslo.')
    .min(1, 'Kapacita musí být alespoň 1.')
    .max(10000, 'Kapacita nesmí přesáhnout 10 000.'),

  // Cena v halířích (0 = volný vstup). 1 Kč = 100 halířů.
  ticketPriceHalire: z
    .number({ required_error: 'Cena vstupenky je povinná.' })
    .int('Cena musí být celé číslo v halířích.')
    .min(0, 'Cena nesmí být záporná.'),
});

export type CreateMicroEventInput = z.infer<typeof CreateMicroEventSchema>;
