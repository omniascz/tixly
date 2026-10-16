/**
 * /[locale]/legal/cookie-settings — uživatel může změnit nebo odvolat
 * consent kdykoli (GDPR Art. 7 odst. 3 — withdraw consent).
 *
 * Server component shell; client component níže.
 */
import { CookieSettingsClient } from './CookieSettingsClient';

export default async function CookieSettingsPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;
  const locale = params.locale as 'cs' | 'sk' | 'en';
  const t = STRINGS[locale] ?? STRINGS.cs;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">{t.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t.intro}</p>
      <div className="mt-6 rounded-lg border bg-card p-6">
        <CookieSettingsClient locale={locale} />
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        {t.legalNote}{' '}
        <a href={`/${locale}/legal/privacy`} className="underline">
          {t.privacyLink}
        </a>
        .
      </p>
    </div>
  );
}

const STRINGS = {
  cs: {
    title: 'Nastavení cookies',
    intro:
      'Tady můžeš kdykoli změnit nebo odvolat svůj souhlas s ukládáním cookies. Tvoje předchozí volby zůstávají v platnosti dokud je nepřepíšeš.',
    legalNote: 'Více info v',
    privacyLink: 'Zásadách ochrany osobních údajů',
  },
  sk: {
    title: 'Nastavenie cookies',
    intro:
      'Tu môžeš kedykoľvek zmeniť alebo odvolať súhlas s ukladaním cookies. Tvoje predchádzajúce voľby zostávajú v platnosti, kým ich neprepíšeš.',
    legalNote: 'Viac info v',
    privacyLink: 'Zásadách ochrany osobných údajov',
  },
  en: {
    title: 'Cookie settings',
    intro:
      'You can change or withdraw your cookie consent at any time. Your previous choices remain in effect until overridden.',
    legalNote: 'More info in our',
    privacyLink: 'Privacy Policy',
  },
} as const;
