import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Zásady ochrany osobních údajů / osobných údajov — Tixly',
  description: 'Jak Tixly zpracovává osobní údaje kupců a pořadatelů.',
};

interface PrivacyContent {
  locale: string;
  dateLocale: string;
  title: string;
  updatedLabel: string;
  sections: ReadonlyArray<{ heading: string; html: string }>;
  contactEmail: string;
  contactLine: string;
  placeholder: string;
  supervisoryAuthority: string;
}

function getContent(locale: string): PrivacyContent {
  if (locale === 'sk') {
    return {
      locale,
      dateLocale: 'sk-SK',
      title: 'Zásady ochrany osobných údajov',
      updatedLabel: 'Naposledy aktualizované',
      contactEmail: 'gdpr@tixly.cz',
      contactLine: 'Otázky k spracovaniu osobných údajov:',
      supervisoryAuthority: 'Úrad na ochranu osobných údajov SR (uoou.sk)',
      placeholder:
        'Toto je predbežné znenie. Pred produkčným nasadením doplňte konkrétneho správcu (názov subjektu, IČO, adresu) a poverte právnika revíziou.',
      sections: [
        {
          heading: '1. Kto sme',
          html: 'Tixly je technická platforma na predaj lístkov. <strong>Organizátor akcie</strong> (napr. divadlo, organizátor koncertu) je <strong>správca</strong> tvojich osobných údajov; <strong>Tixly</strong> pôsobí ako <strong>spracovateľ</strong> na základe zmluvy o spracovaní osobných údajov (DPA).',
        },
        {
          heading: '2. Aké údaje spracovávame',
          html: '<ul><li><strong>Identifikácia:</strong> e-mail, meno a priezvisko, voliteľne telefón</li><li><strong>Objednávky:</strong> typ a počet lístkov, cena, dátum a spôsob platby</li><li><strong>Technické:</strong> IP adresa, prehliadač, čas prihlásenia (audit a bezpečnosť)</li><li><strong>Marketing</strong> (iba s tvojím súhlasom): preferencie akcií, otvorenie newsletterov</li></ul>',
        },
        {
          heading: '3. Na čo údaje používame (právny základ)',
          html: '<ul><li><strong>Plnenie zmluvy</strong> (čl. 6 ods. 1 b GDPR) — vystavenie a doručenie lístka, fakturácia, podpora</li><li><strong>Právna povinnosť</strong> (čl. 6 ods. 1 c GDPR) — daňová evidencia, DPH záznamy (10 rokov)</li><li><strong>Oprávnený záujem</strong> (čl. 6 ods. 1 f GDPR) — prevencia podvodov, bot detection</li><li><strong>Súhlas</strong> (čl. 6 ods. 1 a GDPR) — marketing, analytické cookies</li></ul>',
        },
        {
          heading: '4. Komu údaje odovzdávame',
          html: '<ul><li>Organizátor akcie (meno + e-mail + obsah objednávky — pre vstup, podporu)</li><li>Platobná brána (meno + e-mail + suma — pre platbu)</li><li>Účtovník (zaplatené objednávky — pre daňové priznanie)</li><li>Prípadne štátne orgány (na základe zákonnej povinnosti)</li></ul><p><strong>Mimo EÚ/EHP žiadne údaje neodovzdávame</strong>, ak na to nemáme adekvátny právny rámec.</p>',
        },
        {
          heading: '5. Ako dlho údaje uchovávame',
          html: '<ul><li>Účet a kontakty: kým trvá registrácia + 1 rok po zrušení účtu</li><li>Objednávky a faktúry: <strong>10 rokov</strong> (zákonná lehota DPH)</li><li>Marketing súhlas: do odvolania</li><li>Technické logy: 90 dní</li></ul>',
        },
        {
          heading: '6. Tvoje práva',
          html: '<ul><li><strong>Prístup</strong> — stiahnuť všetky svoje dáta ako JSON v profile</li><li><strong>Oprava</strong> — upraviť meno/telefón priamo v profile</li><li><strong>Vymazanie</strong> — žiadosť o vymazanie v profile (30denná lehota; lístky a faktúry zostávajú pre účtovníctvo)</li><li><strong>Obmedzenie spracovania</strong> — kontaktuj nás na e-maile nižšie</li><li><strong>Sťažnosť</strong> — Úrad na ochranu osobných údajov SR (uoou.sk)</li></ul>',
        },
        {
          heading: '7. Cookies a tracking',
          html: 'Pri prvej návšteve sa ti zobrazí cookie banner s troma kategóriami (nevyhnutné, analytické, marketingové). Bez súhlasu spúšťame iba nevyhnutné cookies. Súhlas môžeš kedykoľvek zmeniť alebo odvolať na stránke <a href="/sk/legal/cookie-settings" class="underline">nastavenie cookies</a>.',
        },
      ],
    };
  }

  // Default: CS
  return {
    locale,
    dateLocale: 'cs-CZ',
    title: 'Zásady ochrany osobních údajů',
    updatedLabel: 'Naposledy aktualizováno',
    contactEmail: 'gdpr@tixly.cz',
    contactLine: 'Otázky ke zpracování osobních údajů:',
    supervisoryAuthority: 'Úřad pro ochranu osobních údajů (uoou.cz)',
    placeholder:
      'Toto je placeholder znění. Před produkčním nasazením doplň konkrétního správce (název subjektu, IČO, adresu) a pověř právníka revizí.',
    sections: [
      {
        heading: '1. Kdo jsme',
        html: 'Tixly je technická platforma pro prodej vstupenek. <strong>Pořadatel akce</strong> (např. divadlo, pořadatel koncertu) je <strong>správce</strong> tvých osobních údajů; <strong>Tixly</strong> působí jako <strong>zpracovatel</strong> na základě smlouvy o zpracování osobních údajů (DPA) uzavřené s pořadatelem.',
      },
      {
        heading: '2. Jaké údaje zpracováváme',
        html: '<ul><li><strong>Identifikace:</strong> e-mail, jméno a příjmení, volitelně telefon</li><li><strong>Objednávky:</strong> typ a počet lístků, cena, datum a způsob platby</li><li><strong>Technické:</strong> IP adresa, prohlížeč, čas přihlášení (pro audit a bezpečnostní účely)</li><li><strong>Marketing</strong> (jen s tvým souhlasem): preference akcí, otevření newsletterů</li></ul>',
      },
      {
        heading: '3. K čemu údaje používáme (právní základ)',
        html: '<ul><li><strong>Plnění smlouvy</strong> (čl. 6 odst. 1 b GDPR) — vystavení a doručení lístku, fakturace, podpora</li><li><strong>Právní povinnost</strong> (čl. 6 odst. 1 c GDPR) — daňová evidence, DPH záznamy (10 let)</li><li><strong>Oprávněný zájem</strong> (čl. 6 odst. 1 f GDPR) — prevence podvodů, bot detection</li><li><strong>Souhlas</strong> (čl. 6 odst. 1 a GDPR) — marketing, analytické cookies</li></ul>',
      },
      {
        heading: '4. Komu údaje předáváme',
        html: '<ul><li>Pořadatel akce (jméno + e-mail + obsah objednávky — pro vstup, podporu)</li><li>Platební brána (jméno + e-mail + částka — pro platbu)</li><li>Účetní (zaplacené objednávky — pro daňové přiznání)</li><li>Případně státní orgány (na základě zákonné povinnosti)</li></ul><p><strong>Mimo EU/EHP žádné údaje nepředáváme</strong>, pokud k tomu nemáme adekvátní právní rámec.</p>',
      },
      {
        heading: '5. Jak dlouho údaje uchováváme',
        html: '<ul><li>Účet a kontakty: dokud trvá registrace + 1 rok po smazání účtu</li><li>Objednávky a faktury: <strong>10 let</strong> (zákonná lhůta DPH)</li><li>Marketing souhlas: do odvolání</li><li>Technické logy: 90 dní</li></ul>',
      },
      {
        heading: '6. Tvá práva',
        html: '<ul><li><strong>Přístup</strong> — stáhnout všechna svá data jako JSON v profilu</li><li><strong>Oprava</strong> — upravit jméno/telefon přímo v profilu</li><li><strong>Smazání</strong> — žádost o smazání v profilu (30denní lhůta, lístky a faktury zůstávají pro účetní)</li><li><strong>Omezení zpracování</strong> — kontaktuj nás na e-mailu níže</li><li><strong>Stížnost</strong> — Úřad pro ochranu osobních údajů (uoou.cz)</li></ul>',
      },
      {
        heading: '7. Cookies a tracking',
        html: 'Při první návštěvě se ti zobrazí cookie banner se třemi kategoriemi (nezbytné, analytické, marketingové). Bez souhlasu spouštíme pouze nezbytné cookies. Souhlas můžeš kdykoliv změnit nebo odvolat na stránce <a href="/cs/legal/cookie-settings" class="underline">nastavení cookies</a>.',
      },
    ],
  };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const c = getContent(locale);

  return (
    <article className="prose prose-sm mx-auto max-w-3xl py-8">
      <h1>{c.title}</h1>
      <p className="text-xs text-muted-foreground">
        {c.updatedLabel}: {new Date().toLocaleDateString(c.dateLocale)}
      </p>

      {c.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          <div dangerouslySetInnerHTML={{ __html: s.html }} />
        </section>
      ))}

      <h2>8. {locale === 'sk' ? 'Kontakt' : 'Kontakt'}</h2>
      <p>
        {c.contactLine}{' '}
        <a href={`mailto:${c.contactEmail}`}>{c.contactEmail}</a>
        {' · '}
        <Link href={`/${c.locale}/contact`}>
          {locale === 'sk' ? 'kontaktný formulár' : 'kontaktní formulář'}
        </Link>
      </p>

      <p className="mt-8 text-xs text-muted-foreground">{c.placeholder}</p>
    </article>
  );
}
