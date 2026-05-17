import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Obchodní podmínky / Obchodné podmienky — Tixly',
  description: 'Pravidla pro nákup a vrácení vstupenek na platformě Tixly.',
};

interface TermsContent {
  title: string;
  updatedLabel: string;
  paragraphs: ReadonlyArray<{ heading: string; html: string }>;
  privacyLinkLabel: string;
  governingLaw: string;
  placeholder: string;
  locale: string;
  dateLocale: string;
}

function getContent(locale: string): TermsContent {
  if (locale === 'sk') {
    return {
      locale,
      dateLocale: 'sk-SK',
      title: 'Obchodné podmienky',
      updatedLabel: 'Naposledy aktualizované',
      privacyLinkLabel: 'Zásady ochrany osobných údajov',
      governingLaw:
        'Zmluva sa riadi slovenským právom (zákon č. 40/1964 Z. z., Občianský zákonník). Spotrebiteľské spory rieši primárne Slovenská obchodná inšpekcia (soi.sk).',
      placeholder:
        'Toto je predbežné znenie. Pred produkciou poverte právnika revíziou — najmä sekciu o predaji a SLA.',
      paragraphs: [
        {
          heading: '1. Zmluvný vzťah',
          html: 'Tixly je technická platforma. Kúpnu zmluvu na lístok uzatváraš <strong>priamo s organizátorom akcie</strong>. Tixly vystupuje ako technický sprostredkovateľ; provízia Tixly je súčasťou ceny.',
        },
        {
          heading: '2. Objednávka a platba',
          html: '<ul><li>Objednávka je záväzná po zaplatení.</li><li>Lístok dostaneš e-mailom do niekoľkých minút po platbe (PDF s QR kódom).</li><li>Lístok je <strong>viazaný na držiteľa</strong> (meno + e-mail). Prenos je možný cez funkciu „Transfer" v detaile objednávky.</li></ul>',
        },
        {
          heading: '3. Vrátenie a storno',
          html: 'Lístky na kultúrne podujatia sú podľa § 7 ods. 6 písm. k) zákona č. 102/2014 Z. z. <strong>vyňaté z práva na odstúpenie</strong> do 14 dní. Vrátenie teda závisí od <strong>refund policy organizátora</strong>, ktorú nájdeš v detaile akcie.<ul><li>Ak organizátor povolil <strong>self-service refund</strong>, môžeš v rámci refund okna sám zrušiť objednávku v detaile objednávky.</li><li>Ak nie, kontaktuj organizátora cez e-mail uvedený pri akcii.</li><li>Pri <strong>zrušení akcie zo strany organizátora</strong> dostaneš plnú sumu späť do 14 dní.</li></ul>',
        },
        {
          heading: '4. Resale (predaj)',
          html: 'Ak organizátor resale povolí, môžeš svoj lístok predať ďalej cez Tixly za cenu maximálne 100 % nominálnej hodnoty. Provízia Tixly z resale je 5 % z predajnej ceny.',
        },
        {
          heading: '5. Zodpovednosť',
          html: '<ul><li>Za <strong>obsah akcie</strong> (program, výkon umelca, technické zabezpečenie) zodpovedá <strong>organizátor</strong>.</li><li>Za <strong>technické fungovanie platformy</strong> (dostupnosť, doručenie lístka) zodpovedá <strong>Tixly</strong>. SLA: 99 % uptime mimo plánované servisné okná.</li></ul>',
        },
        {
          heading: '6. Skener a vstup',
          html: 'Vstup na akciu je možný iba s platným, neznehodnoteným QR kódom. Lístok je platný iba po <strong>prvý sken</strong> — duplicitné skeny budú odmietnuté. Pri strate/poškodení QR pošli ID lístka na podporu organizátora.',
        },
        {
          heading: '7. Účet a registrácia',
          html: 'Pre nákup nepotrebuješ účet (guest checkout). Pre správu objednávok a vystavenie lístka do Wallet pasu odporúčame sa registrovať.',
        },
      ],
    };
  }

  // Default: CS (Česká republika)
  return {
    locale,
    dateLocale: 'cs-CZ',
    title: 'Obchodní podmínky',
    updatedLabel: 'Naposledy aktualizováno',
    privacyLinkLabel: 'Zásady ochrany osobních údajů',
    governingLaw:
      'Smlouva se řídí českým právem. Spotřebitelské spory řeší primárně Česká obchodní inspekce (coi.cz).',
    placeholder:
      'Toto je placeholder znění. Před produkcí pověř právníka revizí (zejména sekci o resale a SLA).',
    paragraphs: [
      {
        heading: '1. Smluvní vztah',
        html: 'Tixly je technická platforma. Kupní smlouvu na vstupenku uzavíráš <strong>přímo s pořadatelem akce</strong>. Tixly vystupuje jako technický zprostředkovatel; provize Tixly je součástí ceny.',
      },
      {
        heading: '2. Objednávka a platba',
        html: '<ul><li>Objednávka je závazná po zaplacení.</li><li>Lístek dostaneš e-mailem do několika minut po platbě (PDF s QR kódem).</li><li>Lístek je <strong>vázán na držitele</strong> (jméno + e-mail). Přenos je možný přes funkci „Transfer" v detailu objednávky.</li></ul>',
      },
      {
        heading: '3. Vrácení a storno',
        html: 'Vstupenky na kulturní akce jsou podle § 1837 OZ <strong>vyňaty z práva na odstoupení od smlouvy</strong> do 14 dní. Vrácení tedy závisí na <strong>refund policy pořadatele</strong>, kterou najdeš v detailu akce.<ul><li>Pokud pořadatel povolil <strong>self-service refund</strong>, můžeš v rámci refund okna sám zrušit objednávku v detailu objednávky.</li><li>Pokud ne, kontaktuj pořadatele přes e-mail uvedený u akce.</li><li>Při <strong>zrušení akce ze strany pořadatele</strong> dostaneš plnou částku zpět do 14 dní.</li></ul>',
      },
      {
        heading: '4. Resale (přeprodej)',
        html: 'Pokud pořadatel resale povolí, můžeš svůj lístek prodat dál přes Tixly za cenu maximálně 100 % nominální hodnoty. Provize Tixly z resale je 5 % z prodejní ceny.',
      },
      {
        heading: '5. Zodpovědnost',
        html: '<ul><li>Za <strong>obsah akce</strong> (program, výkonu umělce, technické zajištění) odpovídá <strong>pořadatel</strong>.</li><li>Za <strong>technické fungování platformy</strong> (dostupnost, doručení lístku) odpovídá <strong>Tixly</strong>. SLA: 99 % uptime mimo plánované servisní okna.</li></ul>',
      },
      {
        heading: '6. Skener a vstup',
        html: 'Vstup na akci je možný pouze s platným, neznehodnoceným QR kódem. Lístek je platný pouze po <strong>první sken</strong> — duplicitní skeny budou odmítnuty. Při ztrátě/poškození QR pošli ID lístku na podporu pořadatele.',
      },
      {
        heading: '7. Účet a registrace',
        html: 'Pro nákup nepotřebuješ účet (guest checkout). Pro správu objednávek a vystavení lístku do Wallet pasu doporučujeme se registrovat.',
      },
    ],
  };
}

export default async function TermsPage({
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

      {c.paragraphs.map((p) => (
        <section key={p.heading}>
          <h2>{p.heading}</h2>
          <div dangerouslySetInnerHTML={{ __html: p.html }} />
        </section>
      ))}

      <h2>8. {locale === 'sk' ? 'Ochrana osobných údajov' : 'Ochrana osobních údajů'}</h2>
      <p>
        {locale === 'sk' ? 'Spracovanie osobných údajov upravujú ' : 'Zpracování osobních údajů upravují '}
        <Link href={`/${c.locale}/legal/privacy`}>{c.privacyLinkLabel}</Link>.
      </p>

      <h2>9. {locale === 'sk' ? 'Rozhodné právo' : 'Rozhodné právo'}</h2>
      <p>{c.governingLaw}</p>

      <p className="mt-8 text-xs text-muted-foreground">{c.placeholder}</p>
    </article>
  );
}
