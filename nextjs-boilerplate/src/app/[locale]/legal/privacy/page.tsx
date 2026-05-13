import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Zásady ochrany osobních údajů — Tixly',
  description: 'Jak Tixly zpracovává osobní údaje kupců a pořadatelů.',
};

export default function PrivacyPage({ params }: { params: { locale: string } }) {
  return (
    <article className="prose prose-sm mx-auto max-w-3xl py-8">
      <h1>Zásady ochrany osobních údajů</h1>
      <p className="text-xs text-muted-foreground">
        Naposledy aktualizováno: {new Date().toLocaleDateString('cs-CZ')}
      </p>

      <h2>1. Kdo jsme</h2>
      <p>
        Tixly je technická platforma pro prodej vstupenek. <strong>Pořadatel akce</strong>{' '}
        (např. divadlo, pořadatel koncertu) je <strong>správce</strong> tvých
        osobních údajů; <strong>Tixly</strong> působí jako <strong>zpracovatel</strong>{' '}
        na základě smlouvy o zpracování osobních údajů (DPA) uzavřené s pořadatelem.
      </p>

      <h2>2. Jaké údaje zpracováváme</h2>
      <ul>
        <li>
          <strong>Identifikace:</strong> e-mail, jméno a příjmení, volitelně telefon
        </li>
        <li>
          <strong>Objednávky:</strong> typ a počet lístků, cena, datum a způsob platby
        </li>
        <li>
          <strong>Technické:</strong> IP adresa, prohlížeč, čas přihlášení (pro audit
          a bezpečnostní účely)
        </li>
        <li>
          <strong>Marketing</strong> (jen s tvým souhlasem): preference akcí, otevření
          newsletterů
        </li>
      </ul>

      <h2>3. K čemu údaje používáme (právní základ)</h2>
      <ul>
        <li>
          <strong>Plnění smlouvy</strong> (čl. 6 odst. 1 b GDPR) — vystavení a doručení
          lístku, fakturace, podpora
        </li>
        <li>
          <strong>Právní povinnost</strong> (čl. 6 odst. 1 c GDPR) — daňová evidence,
          DPH záznamy (10 let)
        </li>
        <li>
          <strong>Oprávněný zájem</strong> (čl. 6 odst. 1 f GDPR) — prevence podvodů,
          bot detection
        </li>
        <li>
          <strong>Souhlas</strong> (čl. 6 odst. 1 a GDPR) — marketing, analytické cookies
        </li>
      </ul>

      <h2>4. Komu údaje předáváme</h2>
      <ul>
        <li>Pořadatel akce (jméno + e-mail + obsah objednávky — pro vstup, podporu)</li>
        <li>Platební brána (jméno + e-mail + částka — pro platbu)</li>
        <li>Účetní (zaplacené objednávky — pro daňové přiznání)</li>
        <li>Případně státní orgány (na základě zákonné povinnosti)</li>
      </ul>
      <p>
        <strong>Mimo EU/EHP žádné údaje nepředáváme</strong>, pokud k tomu nemáme
        adekvátní právní rámec.
      </p>

      <h2>5. Jak dlouho údaje uchováváme</h2>
      <ul>
        <li>Účet a kontakty: dokud trvá registrace + 1 rok po smazání účtu</li>
        <li>Objednávky a faktury: <strong>10 let</strong> (zákonná lhůta DPH)</li>
        <li>Marketing souhlas: do odvolání</li>
        <li>Technické logy: 90 dní</li>
      </ul>

      <h2>6. Tvá práva</h2>
      <ul>
        <li>
          <strong>Přístup</strong> — stáhnout všechna svá data jako JSON v profilu →{' '}
          <Link href={`/${params.locale}/profile`}>Soukromí (GDPR)</Link>
        </li>
        <li>
          <strong>Oprava</strong> — upravit jméno/telefon přímo v profilu
        </li>
        <li>
          <strong>Smazání</strong> — žádost o smazání v profilu (30denní lhůta, lístky
          a faktury zůstávají pro účetní)
        </li>
        <li>
          <strong>Omezení zpracování</strong> — kontaktuj nás na e-mailu níže
        </li>
        <li>
          <strong>Stížnost</strong> — Úřad pro ochranu osobních údajů (uoou.cz)
        </li>
      </ul>

      <h2>7. Cookies a tracking</h2>
      <p>
        Při první návštěvě se ti zobrazí cookie banner se třemi kategoriemi (nezbytné,
        analytické, marketingové). Bez souhlasu spouštíme pouze nezbytné cookies.
        Souhlas můžeš kdykoliv změnit smazáním cookie <code>tixly_cookie_consent</code> v prohlížeči.
      </p>

      <h2>8. Kontakt</h2>
      <p>
        Otázky ke zpracování osobních údajů:{' '}
        <a href="mailto:gdpr@tixly.cz">gdpr@tixly.cz</a> nebo přes{' '}
        <Link href={`/${params.locale}/contact`}>kontaktní formulář</Link>.
      </p>

      <p className="mt-8 text-xs text-muted-foreground">
        Toto je placeholder znění. Před produkčním nasazením doplň konkrétního
        správce (název subjektu, IČO, adresu) a poveř právníka revizí.
      </p>
    </article>
  );
}
