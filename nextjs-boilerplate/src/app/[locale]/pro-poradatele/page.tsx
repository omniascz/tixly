/**
 * /cs/pro-poradatele — B2B prodejní stránka pro pořadatele.
 *
 * Marketingová landing: hodnota, kompletní výčet funkcí (Tixly má jich víc než
 * česká konkurence), jak začít, ceník a CTA na registraci /register-promoter.
 * Statická CS varianta — primární trh CZ/SK. Pozn.: funkce vyžadující produkční
 * klíče (platby, FB, Benefit) jsou reálně v systému, část čeká na ostré API.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Pro pořadatele — prodávejte vstupenky s Tixly',
  description:
    'Kompletní systém na prodej vstupenek: sedačkové mapy, scanner, marketing, dynamické ceny, abonmá, výplaty. Nízká provize, platíte jen když prodáte.',
};

function Section({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`mx-auto w-full max-w-5xl ${className}`}>{children}</section>;
}

const FEATURE_GROUPS: { icon: string; title: string; items: string[] }[] = [
  {
    icon: '🎟️',
    title: 'Prodej & vstupenky',
    items: [
      'Libovolné typy vstupenek a cenové úrovně',
      'Interaktivní sedačkové mapy (i velké sály a tribuny)',
      'Stání, sezení, zóny, časové sloty',
      'Slevy, skupinové slevy, množstevní slevy, promo kódy',
      'Kapacity, limity na objednávku, čekací listina',
    ],
  },
  {
    icon: '💳',
    title: 'Platby & výplaty',
    items: [
      'Platební karty, Apple Pay, Google Pay',
      'Benefitní karty (Pluxee, Edenred, Benefit Plus)',
      'Splátky / odložená platba',
      'Rychlé výplaty na účet',
      'Faktury a daňové doklady vč. DPH (ISDOC, POHODA, NIPOS export)',
    ],
  },
  {
    icon: '📲',
    title: 'Vstup na akci',
    items: [
      'Skenovací aplikace — funguje i offline',
      'Rotující QR / TOTP proti podvodům a screenshotům',
      'RFID náramky a cashless platby na festivalu',
      'Napojení na turnikety, pokladna (POS) u dveří',
      'Modulární vstup na vícedenní festivaly',
    ],
  },
  {
    icon: '📣',
    title: 'Marketing & dosah',
    items: [
      'Vlastní veřejná stránka pořadatele (tixly.cz/p/vase-divadlo)',
      'Publikace akce na Facebook jedním klikem',
      'Tištěné QR plakáty s měřením konverzí',
      'Affiliate / ambasadorský program',
      'White-label — prodej na vlastní doméně s vaším brandingem',
      'E-mailové a SMS kampaně, data o návštěvnících',
    ],
  },
  {
    icon: '🚀',
    title: 'Pokročilé (co konkurence nemá)',
    items: [
      'Dynamické ceny podle poptávky',
      'Abonmá / permanentky a předplatné',
      'Dárkové poukazy se 3letou platností',
      'Pojištění storna pro návštěvníky',
      'Bezpečný přeprodej (resale marketplace) bez šmelin',
      'Virtuální fronta na velké onsale',
      'MHD kombi-ticket (vstupenka = jízdenka)',
    ],
  },
  {
    icon: '📊',
    title: 'Analytika & správa',
    items: [
      'Prodej naživo v reálném čase',
      'Reporty tržeb, návštěvnosti, kanálů',
      'Tým a role (pokladna, skenování, akreditace)',
      'Účetní exporty a přehled výplat',
      'Vlastní pole a sběr dat od návštěvníků',
    ],
  },
];

const STEPS: { n: string; title: string; text: string }[] = [
  { n: '1', title: 'Registrace zdarma', text: 'Vyplníte základní údaje o sobě a firmě. Bez vstupního poplatku.' },
  { n: '2', title: 'Vytvoříte akci', text: 'Průvodce vás provede od názvu po typy vstupenek a sedačky. Hotovo za pár minut.' },
  { n: '3', title: 'Prodáváte online i offline', text: 'Na Tixly, na vlastním webu, na Facebooku i u dveří přes pokladnu.' },
  { n: '4', title: 'Výplata na účet', text: 'Sledujete prodej naživo, peníze chodí na váš účet, daňové doklady jsou hotové.' },
];

export default async function ProPoradatelePage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = params.locale || 'cs';
  const reg = `/${locale}/register-promoter`;

  return (
    <div className="space-y-16">
      {/* HERO */}
      <Section className="rounded-2xl bg-gradient-to-br from-primary/15 via-background to-background px-6 py-14 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Pro pořadatele</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-bold leading-tight lg:text-5xl">
          Prodávejte vstupenky chytře. Bez vstupních poplatků.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          Tixly je kompletní český systém na prodej vstupenek — od sedačkových map a skeneru
          po marketing, dynamické ceny a rychlé výplaty. Platíte jen z prodaných vstupenek.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href={reg}
            className="inline-flex h-12 items-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Začít zdarma
          </Link>
          <Link
            href={`/${locale}/contact`}
            className="inline-flex h-12 items-center rounded-md border px-8 text-sm font-medium hover:bg-muted/40"
          >
            Domluvit ukázku
          </Link>
        </div>
      </Section>

      {/* VALUE PROPS */}
      <Section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: '💸', h: 'Nízká provize', p: 'Žádné měsíční ani vstupní poplatky. Platíte jen když prodáte.' },
          { icon: '⚡', h: 'Rychlé výplaty', p: 'Peníze za prodané vstupenky míří na váš účet, ne aby ležely u nás.' },
          { icon: '🧩', h: 'Vše na jednom místě', p: 'Prodej, vstup, marketing, výplaty i účetní doklady v jednom systému.' },
          { icon: '🇨🇿', h: 'Český & slovenský trh', p: 'DPH na kulturu, benefitní karty, POHODA/NIPOS, čeština i slovenština.' },
        ].map((v) => (
          <div key={v.h} className="rounded-xl border bg-card p-5">
            <div className="text-2xl">{v.icon}</div>
            <h3 className="mt-2 font-semibold">{v.h}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{v.p}</p>
          </div>
        ))}
      </Section>

      {/* FEATURES */}
      <Section>
        <div className="mb-6 text-center">
          <h2 className="text-3xl font-bold">Co všechno Tixly umí</h2>
          <p className="mt-2 text-muted-foreground">
            Jeden systém pokryje celou akci — od prvního prodeje po poslední sken u vchodu.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURE_GROUPS.map((g) => (
            <div key={g.title} className="rounded-xl border bg-card p-6">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{g.icon}</span>
                <h3 className="text-lg font-semibold">{g.title}</h3>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {g.items.map((it) => (
                  <li key={it} className="flex gap-2">
                    <span className="text-primary">✓</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* HOW IT WORKS */}
      <Section className="rounded-2xl bg-muted/30 px-6 py-12">
        <h2 className="text-center text-3xl font-bold">Jak začít</h2>
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="relative rounded-xl border bg-card p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {s.n}
              </div>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* WHY TIXLY */}
      <Section className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-bold">Proč Tixly místo zavedené konkurence</h2>
          <ul className="mt-5 space-y-3 text-sm">
            {[
              ['Nejširší funkce na trhu', 'Sedačkové mapy, dynamické ceny, abonmá, resale marketplace, white-label, MHD kombi — věci, které jinde nenajdete pohromadě.'],
              ['Vy vlastníte svého zákazníka', 'Data o návštěvnících jsou vaše, pro vaše kampaně. Žádné držení dat jako rukojmí.'],
              ['Žádné šmelinaření', 'Bezpečný přeprodej za férovou cenu chrání vaše fanoušky i vaši značku.'],
              ['Postaveno pro CZ/SK', 'DPH na kulturu, benefitní karty, účetní exporty, čeština a slovenština od základu.'],
            ].map(([h, p]) => (
              <li key={h} className="rounded-lg border bg-card p-4">
                <p className="font-semibold">✓ {h}</p>
                <p className="mt-1 text-muted-foreground">{p}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border bg-gradient-to-br from-primary/10 to-transparent p-8">
          <h3 className="text-xl font-semibold">Férový ceník</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Žádné měsíční paušály. Žádné vstupní poplatky. Platíte jen procentní provizi
            z prodaných vstupenek — a při refundu se provize vrací poměrně.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex gap-2"><span className="text-primary">✓</span> Bez vstupního poplatku</li>
            <li className="flex gap-2"><span className="text-primary">✓</span> Bez měsíčního paušálu</li>
            <li className="flex gap-2"><span className="text-primary">✓</span> Platíte jen z prodeje</li>
            <li className="flex gap-2"><span className="text-primary">✓</span> Individuální tier pro velké pořadatele</li>
          </ul>
          <Link
            href={`/${locale}/pricing`}
            className="mt-5 inline-flex h-10 items-center rounded-md border px-5 text-sm font-medium hover:bg-muted/40"
          >
            Zobrazit ceník →
          </Link>
        </div>
      </Section>

      {/* FINAL CTA */}
      <Section className="rounded-2xl bg-primary px-6 py-12 text-center text-primary-foreground">
        <h2 className="text-3xl font-bold">Vytvořte první akci ještě dnes</h2>
        <p className="mx-auto mt-3 max-w-xl text-primary-foreground/90">
          Registrace je zdarma a první akci vytvoříte za pár minut. Bez závazků.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href={reg}
            className="inline-flex h-12 items-center rounded-md bg-background px-8 text-sm font-medium text-foreground hover:bg-background/90"
          >
            Registrovat se zdarma
          </Link>
          <Link
            href={`/${locale}/contact`}
            className="inline-flex h-12 items-center rounded-md border border-primary-foreground/40 px-8 text-sm font-medium hover:bg-primary-foreground/10"
          >
            Mám dotaz
          </Link>
        </div>
      </Section>
    </div>
  );
}
