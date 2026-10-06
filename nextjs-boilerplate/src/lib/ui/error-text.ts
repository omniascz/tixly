/**
 * Kolo 12 — chyby API česky: co se stalo a co udělat (dřív se v administraci ukazovaly kódy jako INVALID_BODY, HTTP 422
 * nebo celé JSON). Serverová `message` (už česky) má přednost; jinak překlad kódu; jinak obecná věta s radou.
 */
const CODES: Record<string, string> = {
  INVALID_BODY: 'Některé údaje ve formuláři chybí nebo nejsou ve správném tvaru. Zkontrolujte vyplněná pole a uložte znovu.',
  'Validation failed': 'Některé údaje ve formuláři chybí nebo nejsou ve správném tvaru. Zkontrolujte vyplněná pole a uložte znovu.',
  BAD_ID: 'Záznam se nenašel. Obnovte stránku a zkuste to znovu.',
  NOT_FOUND: 'Záznam se nenašel — možná ho mezitím někdo smazal. Obnovte stránku.',
  FORBIDDEN: 'K této akci nemáte oprávnění. Požádejte vlastníka účtu.',
  UNAUTHORIZED: 'Přihlášení vypršelo. Přihlaste se znovu.',
  TOKEN_MISSING: 'Přihlášení vypršelo. Přihlaste se znovu.',
  TOKEN_INVALID: 'Přihlášení vypršelo. Přihlaste se znovu.',
  CODE_ALREADY_EXISTS: 'Kód už existuje. Zvolte jiný název kódu.',
  NAME_TAKEN: 'Tento název už je použitý. Zvolte jiný.',
  DUPLICATE_SEAT: 'Některé místo je vybrané dvakrát. Zrušte výběr a vyberte místa znovu.',
  SEAT_NOT_AVAILABLE: 'Některé místo mezitím někdo prodal nebo zablokoval. Obnovte stránku a vyberte jiná místa.',
  VAT_NOT_CONFIGURED: 'Termín nelze zveřejnit — chybí sazba DPH. V Nastavení → Fakturace doplňte DPH a založte termín znovu.',
  SALES_END_AFTER_EVENT_END: 'Konec prodeje je až po skončení představení. Zvolte dřívější konec prodeje.',
  NO_TICKET_TYPES: 'Termín nemá ceník. Vyberte termín, ze kterého se ceník převezme, nebo zadejte ceny zón.',
  NO_SELLABLE_SEATS: 'Sál nemá žádná místa přiřazená do cenových zón. V editoru plánku vyberte místa a přiřaďte je zóně.',
  RATE_LIMITED: 'Příliš mnoho pokusů za krátkou dobu. Počkejte chvíli a zkuste to znovu.',
};

export function errorText(j: { message?: unknown; error?: unknown } | null | undefined, status?: number): string {
  const msg = typeof j?.message === 'string' && j.message.trim() ? j.message.trim() : '';
  // serverová zpráva je česky, jen pokud nejde o anglickou hlášku validace
  if (msg && !/^[A-Za-z][A-Za-z ,.'-]+$/.test(msg)) return msg;
  const e = j?.error;
  const code = typeof e === 'string' ? e : e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code && CODES[code]) return CODES[code];
  if (status === 401) return CODES.UNAUTHORIZED;
  if (status === 403) return CODES.FORBIDDEN;
  if (status === 404) return CODES.NOT_FOUND;
  if (status === 429) return CODES.RATE_LIMITED;
  if (status && status >= 500) return 'Na serveru se něco pokazilo. Zkuste to za chvíli znovu; pokud to přetrvá, kontaktujte podporu Tixly.';
  return 'Akci se nepodařilo dokončit. Zkontrolujte údaje a zkuste to znovu.';
}
