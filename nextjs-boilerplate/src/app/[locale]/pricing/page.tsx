import type { JSX } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';


export const metadata: Metadata = {
  title: 'Ceník — Tixly',
  description:
    'Transparentní ceny pro pořadatele. Žádná měsíční předplatné, žádné minimum. Platíš jen za prodané vstupenky.',
};

interface Tier {
  id: 'starter' | 'pro' | 'enterprise';
  name: string;
  fee: string;
  feeDetail: string;
  best: boolean;
  features: string[];
  cta: string;
  ctaHref: string;
}

const STRINGS = {
  cs: {
    title: 'Transparentní ceník pro pořadatele',
    subtitle: 'Žádná měsíční předplatné. Žádné minimum. Platíš jen za prodané vstupenky.',
    perTicket: 'za prodanou vstupenku',
    fairNote:
      'Žádné skryté poplatky. Refund vrátí promotérovi i jeho podíl provize, žádný „loser fee".',
    table: 'Co je v ceně',
    rows: {
      gateway: 'GoPay + ComGate platby (CZK + EUR)',
      wallet: 'Apple/Google Wallet',
      seating: 'Seating editor s presety + Click&View foto',
      resale: 'Resale s anti-scalping face-value cap',
      insurance: 'Stornoschutz pojištění (cross-sell)',
      abo: 'Theatre Abonnement (Festabo + Wahl-Abo + Restwert)',
      voucher: 'Dárkové poukazy s 3-year validity',
      qr: 'Rotující QR + offline scanner',
      mhd: 'MHD Kombi-Ticket (DPP/IDOS)',
      benefit: 'Benefit Pay (Pluxee/Sodexo/Benefit Plus/Edenred)',
      whitelabel: 'Vlastní doména + brand colors',
      api: 'Public API + webhooks',
      pwa: 'PWA + push notifikace',
      spotify: 'Spotify discovery (doporučení podle umělců)',
      social: '„X přátel jde" Social FOMO',
      fb: 'Facebook Event 1-click publish',
      printqr: 'Print QR kampaně s attribution',
      pos: 'POS modul + offline scanner',
      reporting: 'NIPOS reporting (CZ kulturní statistiky)',
      support: 'Email support (Pro: priority, Enterprise: telefon)',
    },
    faqTitle: 'Často kladené otázky',
    faqs: [
      {
        q: 'Co když event nevyjde a musím refundovat?',
        a: 'Vrátíme ti i naši provizi proporcionálně. Žádný „loser fee".',
      },
      {
        q: 'Můžu si nastavit vlastní fee tier?',
        a: 'Enterprise tier dohodneme individuálně — typicky 200+ akcí ročně.',
      },
      {
        q: 'Kolik trvá onboarding?',
        a: 'Self-service signup do 5 minut. KYC ověření 1-2 pracovní dny.',
      },
      {
        q: 'Co potřebuju pro launch?',
        a: 'Bankovní účet, IČO, kontakt na admina. Pro Stripe payouts navíc verify dokumenty.',
      },
    ],
    comparison: 'Srovnání s konkurencí',
    competitorNote:
      'Pro srovnání: Eventim Light cca 3,5 % + 0,49–0,99 €/lístek, GoOut 5–8 %, Smsticket 5 %. ' +
      'Tixly je transparentní a vrací podíl při refundu.',
  },
  sk: {
    title: 'Transparentný cenník pre usporiadateľov',
    subtitle: 'Žiadne mesačné predplatné. Žiadne minimum. Platíš len za predané vstupenky.',
    perTicket: 'za predanú vstupenku',
    fairNote:
      'Žiadne skryté poplatky. Refund vráti usporiadateľovi aj jeho podiel provízie, žiadny „loser fee".',
    table: 'Čo je v cene',
    rows: {
      gateway: 'GoPay + ComGate platby (EUR + CZK)',
      wallet: 'Apple/Google Wallet',
      seating: 'Seating editor s presetmi + Click&View foto',
      resale: 'Resale s anti-scalping face-value cap',
      insurance: 'Stornoschutz poistenie (cross-sell)',
      abo: 'Theatre Abonnement (Festabo + Wahl-Abo + Restwert)',
      voucher: 'Darčekové poukazy s 3-ročnou platnosťou',
      qr: 'Rotujúci QR + offline skener',
      mhd: 'MHD Kombi-Ticket (DPP/IDOS)',
      benefit: 'Benefit Pay (Pluxee/Sodexo/Benefit Plus/Edenred)',
      whitelabel: 'Vlastná doména + brand colors',
      api: 'Public API + webhooky',
      pwa: 'PWA + push notifikácie',
      spotify: 'Spotify discovery',
      social: '„X priateľov ide" Social FOMO',
      fb: 'Facebook Event 1-click publish',
      printqr: 'Print QR kampane s attribution',
      pos: 'POS modul + offline skener',
      reporting: 'NIPOS reporting (kultúrne štatistiky)',
      support: 'Email support (Pro: priority, Enterprise: telefón)',
    },
    faqTitle: 'Často kladené otázky',
    faqs: [
      { q: 'Čo ak event nevyjde a musím refundovať?', a: 'Vrátime ti aj našu províziu proporcionálne.' },
      { q: 'Môžem si nastaviť vlastný fee tier?', a: 'Enterprise tier dohodneme individuálne.' },
      { q: 'Koľko trvá onboarding?', a: 'Self-service signup do 5 minút. KYC overenie 1-2 dni.' },
      { q: 'Čo potrebujem pre launch?', a: 'Bankový účet, IČO, kontakt na admina.' },
    ],
    comparison: 'Porovnanie s konkurenciou',
    competitorNote: 'Tixly je transparentný a vracia podiel pri refunde.',
  },
  en: {
    title: 'Transparent pricing for promoters',
    subtitle: 'No monthly fees. No minimum. You pay only for tickets sold.',
    perTicket: 'per ticket sold',
    fairNote: 'No hidden fees. Refunds return our commission proportionally — no "loser fee".',
    table: 'What is included',
    rows: {
      gateway: 'GoPay + ComGate payments (CZK + EUR)',
      wallet: 'Apple/Google Wallet',
      seating: 'Seating editor with presets + Click&View photo',
      resale: 'Resale with anti-scalping face-value cap',
      insurance: 'Stornoschutz insurance (cross-sell)',
      abo: 'Theatre Abonnement (Festabo + Wahl-Abo + Restwert)',
      voucher: 'Gift vouchers with 3-year validity',
      qr: 'Rotating QR + offline scanner',
      mhd: 'Public transit combo ticket (DPP/IDOS)',
      benefit: 'Employee benefit pay (Pluxee/Sodexo/Benefit Plus/Edenred)',
      whitelabel: 'Custom domain + brand colors',
      api: 'Public API + webhooks',
      pwa: 'PWA + push notifications',
      spotify: 'Spotify discovery (artist-based recommendations)',
      social: '"X friends going" Social FOMO',
      fb: 'Facebook Event 1-click publish',
      printqr: 'Print QR campaigns with attribution',
      pos: 'POS module + offline scanner',
      reporting: 'NIPOS reporting (CZ cultural statistics)',
      support: 'Email support (Pro: priority, Enterprise: phone)',
    },
    faqTitle: 'Frequently asked questions',
    faqs: [
      { q: 'What if the event is cancelled and I need to refund?', a: 'We refund our commission proportionally too. No "loser fee".' },
      { q: 'Can I set a custom fee tier?', a: 'Enterprise tier is negotiated individually — typically 200+ events per year.' },
      { q: 'How long does onboarding take?', a: 'Self-service signup in 5 minutes. KYC verification 1-2 business days.' },
      { q: 'What do I need for launch?', a: 'Bank account, business ID, admin contact. For Stripe payouts also verification documents.' },
    ],
    comparison: 'Compared to competition',
    competitorNote:
      'For reference: Eventim Light ~3.5% + €0.49–0.99/ticket, GoOut 5–8%, Smsticket 5%. ' +
      'Tixly is transparent and refunds the commission on cancellation.',
  },
} as const;

function getTiers(locale: 'cs' | 'sk' | 'en'): Tier[] {
  if (locale === 'en') {
    return [
      {
        id: 'starter',
        name: 'Starter',
        fee: '5%',
        feeDetail: '+ CZK 5 fixed per ticket sold',
        best: false,
        features: ['gateway', 'wallet', 'seating', 'qr', 'pos', 'api'],
        cta: 'Start free',
        ctaHref: `/${locale}/register-promoter`,
      },
      {
        id: 'pro',
        name: 'Pro',
        fee: '7%',
        feeDetail: 'all features + Stornoschutz + Theatre Abo + white-label',
        best: true,
        features: ['gateway', 'wallet', 'seating', 'resale', 'insurance', 'abo', 'voucher', 'qr', 'whitelabel', 'api', 'pwa', 'social', 'fb', 'printqr', 'pos', 'reporting'],
        cta: 'Try Pro 30 days',
        ctaHref: `/${locale}/register-promoter?plan=pro`,
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        fee: 'On request',
        feeDetail: 'Custom fee + dedicated support + SLA',
        best: false,
        features: ['gateway', 'wallet', 'seating', 'resale', 'insurance', 'abo', 'voucher', 'qr', 'mhd', 'benefit', 'whitelabel', 'api', 'pwa', 'spotify', 'social', 'fb', 'printqr', 'pos', 'reporting', 'support'],
        cta: 'Contact sales',
        ctaHref: 'mailto:sales@tixly.cz',
      },
    ];
  }
  return [
    {
      id: 'starter',
      name: 'Starter',
      fee: '5 %',
      feeDetail: locale === 'sk' ? '+ 0,20 € fix za predanú vstupenku' : '+ 5 Kč fix za prodanou vstupenku',
      best: false,
      features: ['gateway', 'wallet', 'seating', 'qr', 'pos', 'api'],
      cta: locale === 'sk' ? 'Začať zdarma' : 'Začít zdarma',
      ctaHref: `/${locale}/register-promoter`,
    },
    {
      id: 'pro',
      name: 'Pro',
      fee: '7 %',
      feeDetail: locale === 'sk' ? 'všetky features + Stornoschutz + Abo + white-label' : 'všechny features + Stornoschutz + Abo + white-label',
      best: true,
      features: ['gateway', 'wallet', 'seating', 'resale', 'insurance', 'abo', 'voucher', 'qr', 'whitelabel', 'api', 'pwa', 'social', 'fb', 'printqr', 'pos', 'reporting'],
      cta: locale === 'sk' ? 'Vyskúšať Pro 30 dní' : 'Vyzkoušet Pro 30 dní',
      ctaHref: `/${locale}/register-promoter?plan=pro`,
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      fee: locale === 'sk' ? 'Na požiadanie' : 'Na vyžádání',
      feeDetail: locale === 'sk' ? 'Vlastný fee + dedikovaný support + SLA' : 'Vlastní fee + dedikovaný support + SLA',
      best: false,
      features: ['gateway', 'wallet', 'seating', 'resale', 'insurance', 'abo', 'voucher', 'qr', 'mhd', 'benefit', 'whitelabel', 'api', 'pwa', 'spotify', 'social', 'fb', 'printqr', 'pos', 'reporting', 'support'],
      cta: locale === 'sk' ? 'Kontaktovať sales' : 'Kontaktovat sales',
      ctaHref: 'mailto:sales@tixly.cz',
    },
  ];
}

export default async function PricingPage(props: { params: Promise<{ locale: string }> }): Promise<JSX.Element> {
  const params = await props.params;
  const locale: 'cs' | 'sk' | 'en' =
    params.locale === 'sk' || params.locale === 'en' ? params.locale : 'cs';
  const t = STRINGS[locale];
  const tiers = getTiers(locale);

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-10">
      <section className="text-center">
        <h1 className="text-4xl font-bold">{t.title}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{t.subtitle}</p>
      </section>

      <section className="grid gap-4 md:grid-cols-3" data-testid="pricing-tiers">
        {tiers.map((tier) => (
          <div
            key={tier.id}
            className={`rounded-lg border p-6 ${
              tier.best ? 'border-primary bg-primary/5 ring-1 ring-primary' : ''
            }`}
            data-testid={`tier-${tier.id}`}
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold">{tier.name}</h2>
              {tier.best ? (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                  {locale === 'en' ? 'Most popular' : locale === 'sk' ? 'Najobľúbenejšie' : 'Nejoblíbenější'}
                </span>
              ) : null}
            </div>
            <div className="mt-4">
              <div className="text-3xl font-bold tabular-nums">{tier.fee}</div>
              <div className="text-xs text-muted-foreground">{t.perTicket}</div>
              <div className="mt-1 text-xs text-muted-foreground">{tier.feeDetail}</div>
            </div>
            <ul className="mt-5 space-y-1.5 text-sm">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <span className="mt-0.5 text-emerald-600" aria-hidden>
                    ✓
                  </span>
                  <span>{t.rows[f as keyof typeof t.rows]}</span>
                </li>
              ))}
            </ul>
            <Link
              href={tier.ctaHref}
              className={`mt-6 block rounded-md px-4 py-2 text-center text-sm font-medium ${
                tier.best
                  ? 'bg-primary text-primary-foreground hover:opacity-90'
                  : 'border hover:bg-muted/50'
              }`}
            >
              {tier.cta}
            </Link>
          </div>
        ))}
      </section>

      <section className="rounded-md border bg-muted/30 p-5 text-sm">
        <p>
          <strong>{locale === 'en' ? 'Fair refund' : 'Fair refund'}:</strong> {t.fairNote}
        </p>
      </section>

      <section className="rounded-md border p-5">
        <h2 className="mb-2 font-semibold">{t.comparison}</h2>
        <p className="text-sm text-muted-foreground">{t.competitorNote}</p>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold">{t.faqTitle}</h2>
        <dl className="space-y-3">
          {t.faqs.map((faq) => (
            <details key={faq.q} className="rounded-md border bg-card p-4">
              <summary className="cursor-pointer font-medium">{faq.q}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{faq.a}</p>
            </details>
          ))}
        </dl>
      </section>
    </div>
  );
}
