/**
 * Jediný zdroj pravdy pro navigaci admina.
 *
 * Do téhle chvíle byla navigace rozsypaná ve dvou komponentách (Sidebar,
 * EventDetailNav), což vedlo k tomu, že 26 hotových stránek nebylo z aplikace
 * dosažitelných vůbec a dvě položky byly v menu dvakrát.
 *
 * Odsud čerpá:
 *   - components/admin/Sidebar.tsx        (levé menu organizace)
 *   - app/admin/events/[id]/EventDetailNav.tsx (záložky akce)
 *   - app/admin/vse/page.tsx              (rozcestník všech funkcí)
 *   - components/admin/SectionHub.tsx     (obsah jednotlivých záložek akce)
 *
 * Pravidlo: nová stránka admina se přidá SEM, ne do komponenty. Jinak se stane
 * to, co se stalo minule.
 */

import type { TemplateId } from '@/lib/events/templates';

/* ------------------------------------------------------------------ *
 * Role
 * ------------------------------------------------------------------ */

/**
 * Role promotéra tak, jak ji vrací getServerRoles().promoterRole.
 * Známé hodnoty jsou 'owner' | 'manager' | 'staff'; typ je volnější, protože
 * hodnota jde z databáze a nechceme kvůli nové roli rozbít build.
 */
export type PromoterRole = string;

/** Položka viditelná i pro roli 'staff' (produkce, pokladna, dveře). */
type StaffVisible = boolean;

/* ------------------------------------------------------------------ *
 * Úroveň organizace — levé menu
 * ------------------------------------------------------------------ */

export interface OrgNavItem {
  href: string;
  label: string;
  /** Lucide ikona — jméno exportu, komponenta se dohledá v Sidebaru. */
  icon: OrgIconName;
  staffAllowed?: StaffVisible;
  /** Podpoložky se v menu nezobrazují, slouží pro zvýraznění aktivní sekce. */
  covers?: string[];
}

export type OrgIconName =
  | 'LayoutDashboard'
  | 'CalendarDays'
  | 'ShoppingCart'
  | 'Users'
  | 'Banknote'
  | 'ScanLine'
  | 'Megaphone'
  | 'HeartHandshake'
  | 'Wallet'
  | 'MapPin'
  | 'UserCog'
  | 'Settings'
  | 'LayoutGrid';

/**
 * Dvanáct položek. Původních 49 se nesmazalo — zbytek je dosažitelný
 * z příslušné sekce nebo z rozcestníku /admin/vse.
 */
export const ORG_NAV: OrgNavItem[] = [
  {
    href: '/admin',
    label: 'Přehled',
    icon: 'LayoutDashboard',
    staffAllowed: true,
    covers: ['/admin/live', '/admin/alerts'],
  },
  {
    href: '/admin/events',
    label: 'Akce',
    icon: 'CalendarDays',
    staffAllowed: true,
    covers: [
      '/admin/calendar',
      '/admin/event-groups',
      '/admin/event-templates',
      '/admin/productions',
      '/admin/season',
      '/admin/collections',
      '/admin/subscriptions',
      '/admin/season-passes',
      '/admin/subscription-plans',
    ],
  },
  {
    href: '/admin/orders',
    label: 'Objednávky',
    icon: 'ShoppingCart',
    staffAllowed: true,
    covers: [
      '/admin/refund-requests',
      '/admin/chargebacks',
      '/admin/reservations',
      '/admin/call-center',
      '/admin/school-bookings',
    ],
  },
  {
    href: '/admin/customers',
    label: 'Zákazníci',
    icon: 'Users',
    covers: ['/admin/crm', '/admin/member-groups', '/admin/b2b', '/admin/import', '/admin/gdpr'],
  },
  {
    href: '/admin/pos',
    label: 'Pokladna',
    icon: 'Banknote',
    staffAllowed: true,
  },
  {
    href: '/admin/scanner',
    label: 'Vstup',
    icon: 'ScanLine',
    staffAllowed: true,
  },
  {
    href: '/admin/marketing',
    label: 'Marketing',
    icon: 'Megaphone',
    covers: [
      '/admin/promo-codes',
      '/admin/vouchers',
      '/admin/gift-cards',
      '/admin/access-codes',
      '/admin/broadcasts',
      '/admin/sms-campaigns',
      '/admin/email-templates',
      '/admin/campaigns',
      '/admin/ads',
      '/admin/tracking-pixels',
      '/admin/facebook',
      '/admin/social-shop',
      '/admin/brand-connect',
      '/admin/ai',
    ],
  },
  {
    href: '/admin/resellers',
    label: 'Partneři',
    icon: 'HeartHandshake',
    covers: ['/admin/affiliates', '/admin/partner-applications'],
  },
  {
    href: '/admin/payouts',
    label: 'Finance',
    icon: 'Wallet',
    covers: [
      '/admin/artist-payouts',
      '/admin/invoices',
      '/admin/accounting',
      '/admin/bank-transfers',
      '/admin/reports',
    ],
  },
  {
    href: '/admin/venues',
    label: 'Sály',
    icon: 'MapPin',
  },
  {
    href: '/admin/staff',
    label: 'Tým',
    icon: 'UserCog',
    covers: ['/admin/audit-log', '/admin/notifications'],
  },
  {
    href: '/admin/settings',
    label: 'Nastavení',
    icon: 'Settings',
    covers: [
      '/admin/domains',
      '/admin/documents',
      '/admin/webhooks',
      '/admin/oauth-apps',
      '/admin/embed',
      '/admin/anti-scalping',
      '/admin/fraud-queue',
      '/admin/resale-guarantee',
    ],
  },
];

/** Poslední položka menu — rozcestník se vším. */
export const ORG_NAV_ALL: OrgNavItem = {
  href: '/admin/vse',
  label: 'Vše',
  icon: 'LayoutGrid',
  staffAllowed: true,
};

/* ------------------------------------------------------------------ *
 * Rejstřík všech stránek organizace — pro /admin/vse a hledání
 * ------------------------------------------------------------------ */

export interface RouteEntry {
  href: string;
  label: string;
  /** Krátký popis, co stránka dělá. Zobrazuje se na rozcestníku. */
  hint?: string;
  staffAllowed?: StaffVisible;
}

export interface RouteDomain {
  key: string;
  label: string;
  items: RouteEntry[];
}

/**
 * Patnáct domén pokrývajících všech 86 rout na úrovni organizace.
 * Položky dřív nedosažitelné z navigace jsou označené v komentáři.
 */
export const ORG_ROUTES: RouteDomain[] = [
  {
    key: 'prehled',
    label: 'Přehled a akce',
    items: [
      { href: '/admin', label: 'Přehled', hint: 'Domovská obrazovka', staffAllowed: true },
      { href: '/admin/live', label: 'Živý prodej', hint: 'Stream transakcí v reálném čase', staffAllowed: true },
      { href: '/admin/alerts', label: 'Upozornění', hint: 'Neobvyklý vývoj prodeje' }, // dřív bez odkazu
      { href: '/admin/events', label: 'Akce', hint: 'Seznam všech akcí', staffAllowed: true },
      { href: '/admin/events/new', label: 'Nová akce', hint: 'Založení akce podle šablony' },
      { href: '/admin/calendar', label: 'Kalendář a opce', hint: 'Držené termíny v sálech a potvrzené akce' },
      { href: '/admin/events/batch-import', label: 'Hromadný import', hint: 'Import představení z tabulky' }, // dřív bez odkazu
      { href: '/admin/event-groups', label: 'Skupiny akcí', hint: 'Seskupení souvisejících akcí' },
      { href: '/admin/event-templates', label: 'Šablony akcí', hint: 'Znovupoužitelná nastavení' },
      { href: '/admin/productions', label: 'Produkce a reprízy', hint: 'Opakovaná představení' },
      { href: '/admin/collections', label: 'Kolekce', hint: 'Kurátorské výběry akcí' },
    ],
  },
  {
    key: 'predplatne',
    label: 'Předplatné a sezóny',
    items: [
      { href: '/admin/subscriptions', label: 'Abonentky', hint: 'Divadelní předplatné' },
      { href: '/admin/season-passes', label: 'Sezónní pasy', hint: 'Vstup na celou sezónu' },
      { href: '/admin/subscription-plans', label: 'Permanentky', hint: 'Tarify předplatného' },
      { href: '/admin/season', label: 'Sezónní přehled', hint: 'Prodej napříč sezónou' },
    ],
  },
  {
    key: 'objednavky',
    label: 'Objednávky a podpora',
    items: [
      { href: '/admin/orders', label: 'Objednávky', hint: 'Všechny objednávky napříč akcemi', staffAllowed: true },
      { href: '/admin/refund-requests', label: 'Žádosti o vrácení', hint: 'Fronta ke schválení' }, // dřív bez odkazu
      { href: '/admin/chargebacks', label: 'Chargebacky', hint: 'Sporné platby' },
      { href: '/admin/reservations', label: 'Rezervace', hint: 'B2B a telefonické rezervace' }, // dřív bez odkazu
      { href: '/admin/call-center', label: 'Call centrum', hint: 'Objednávky po telefonu', staffAllowed: true },
      { href: '/admin/school-bookings', label: 'Školní objednávky', hint: 'Skupiny ze škol' }, // dřív bez odkazu
    ],
  },
  {
    key: 'zakaznici',
    label: 'Zákazníci',
    items: [
      { href: '/admin/customers', label: 'Zákazníci', hint: 'Databáze kupujících' },
      { href: '/admin/crm/rfm', label: 'RFM segmentace', hint: 'Rozdělení podle chování' },
      { href: '/admin/member-groups', label: 'Členské skupiny', hint: 'Kluby a zvýhodněné skupiny' }, // dřív bez odkazu
      { href: '/admin/b2b', label: 'Firemní účty', hint: 'B2B zákazníci' }, // dřív bez odkazu
      { href: '/admin/import', label: 'Import zákazníků', hint: 'Migrace z jiné platformy' }, // dřív bez odkazu
      { href: '/admin/gdpr', label: 'GDPR', hint: 'Výmazy a exporty osobních údajů' }, // dřív bez odkazu
    ],
  },
  {
    key: 'pokladna',
    label: 'Pokladna a vstup',
    items: [
      { href: '/admin/pos', label: 'Pokladna', hint: 'Prodej na místě', staffAllowed: true },
      { href: '/admin/pos/quick', label: 'Rychlý prodej', hint: 'Zjednodušená pokladna', staffAllowed: true }, // dřív bez odkazu
      { href: '/admin/pos/terminals', label: 'Terminály a tiskárny', hint: 'Hardware pokladny' }, // dřív bez odkazu
      { href: '/admin/scanner', label: 'Skener', hint: 'Odbavení u vstupu', staffAllowed: true },
      { href: '/admin/scanner/devices', label: 'Zařízení skeneru', hint: 'Správa čteček' }, // dřív bez odkazu
      { href: '/admin/scanner/guide', label: 'Návod pro obsluhu', hint: 'Pro personál u dveří', staffAllowed: true },
    ],
  },
  {
    key: 'marketing',
    label: 'Marketing a komunikace',
    items: [
      { href: '/admin/promo-codes', label: 'Promo kódy', hint: 'Slevové kódy' },
      { href: '/admin/vouchers', label: 'Dárkové poukazy', hint: 'Vaše poukazy, lze vázat na akci' },
      { href: '/admin/gift-cards', label: 'Tixly gift karty', hint: 'Platformové předplacené karty' }, // dřív bez odkazu
      { href: '/admin/access-codes', label: 'Přístupové kódy', hint: 'Odemknutí skrytých vstupenek' },
      { href: '/admin/broadcasts', label: 'Hromadné zprávy', hint: 'E-maily zákazníkům' },
      { href: '/admin/sms-campaigns', label: 'SMS kampaně', hint: 'Rozesílka SMS' },
      { href: '/admin/email-templates', label: 'Šablony e-mailů', hint: 'Vzhled a text zpráv' },
      { href: '/admin/campaigns', label: 'Kampaně', hint: 'Zastřešení marketingových aktivit' }, // dřív bez odkazu
      { href: '/admin/ads', label: 'Reklama v Tixly', hint: 'Propagace v marketplace' },
      { href: '/admin/tracking-pixels', label: 'Měřicí kódy', hint: 'Meta, Google, GA4' },
      { href: '/admin/facebook', label: 'Facebook', hint: 'Propojení stránky' },
      { href: '/admin/social-shop', label: 'Social Shop', hint: 'Katalogy pro sociální sítě' },
      { href: '/admin/brand-connect', label: 'Brand Connect', hint: 'Spolupráce se značkami' },
    ],
  },
  {
    key: 'ai',
    label: 'AI nástroje',
    items: [
      // Celá sekce byla dřív bez jediného odkazu.
      { href: '/admin/ai/description', label: 'Generátor popisu', hint: 'Text akce z pár údajů' },
      { href: '/admin/ai/cover-images', label: 'Generátor obrázků', hint: 'Cover pro akci' },
      { href: '/admin/ai/social-posts', label: 'Příspěvky na sítě', hint: 'Texty pro Facebook a Instagram' },
      { href: '/admin/ai/price-suggestion', label: 'Návrh ceny', hint: 'Doporučení podle podobných akcí' },
      { href: '/admin/ai/auto-tag', label: 'Automatické štítky', hint: 'Zařazení akce do kategorií' },
      { href: '/admin/ai/moderation', label: 'Kontrola obsahu', hint: 'Před zveřejněním akce' },
    ],
  },
  {
    key: 'partneri',
    label: 'Partneři a distribuce',
    items: [
      { href: '/admin/resellers', label: 'Partnerská síť', hint: 'Prodejci vašich vstupenek' },
      { href: '/admin/affiliates', label: 'Affiliate program', hint: 'Provize za doporučení' }, // dřív bez odkazu
      { href: '/admin/partner-applications', label: 'Žádosti partnerů', hint: 'Ke schválení' },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    items: [
      { href: '/admin/payouts', label: 'Výplaty', hint: 'Kdy a kolik vám přijde' },
      { href: '/admin/artist-payouts', label: 'Výplaty umělců', hint: 'Podíly účinkujících' },
      { href: '/admin/invoices', label: 'Faktury', hint: 'Vydané doklady' },
      { href: '/admin/accounting', label: 'Export do účetnictví', hint: 'Podklad pro ERP' },
      { href: '/admin/bank-transfers', label: 'Bankovní výpisy', hint: 'Párování plateb' },
      { href: '/admin/reports', label: 'Účetní reporty', hint: 'Souhrny za období' },
      { href: '/admin/reports/inhouse', label: 'Interní reporty', hint: 'Provozní přehledy' },
      { href: '/admin/reports/nipos', label: 'NIPOS', hint: 'Statistický výkaz pro kulturu' }, // dřív bez odkazu
    ],
  },
  {
    key: 'saly',
    label: 'Sály a plánky',
    items: [
      // Celá sekce chyběla v levém menu.
      { href: '/admin/venues', label: 'Sály', hint: 'Místa konání a jejich kapacity' },
    ],
  },
  {
    key: 'tym',
    label: 'Tým a dohled',
    items: [
      { href: '/admin/staff', label: 'Tým', hint: 'Členové, role a pozvánky' },
      { href: '/admin/audit-log', label: 'Audit log', hint: 'Kdo co změnil' },
      { href: '/admin/notifications', label: 'Notifikace', hint: 'Co vám systém hlásí', staffAllowed: true },
    ],
  },
  {
    key: 'ochrana',
    label: 'Ochrana a compliance',
    items: [
      { href: '/admin/anti-scalping', label: 'Ochrana proti překupníkům', hint: 'Limity a pravidla' }, // dřív bez odkazu
      { href: '/admin/fraud-queue', label: 'Podezřelé objednávky', hint: 'Ke kontrole' },
      { href: '/admin/resale-guarantee', label: 'Fan Guarantee', hint: 'Reklamace ze sekundárního trhu' }, // dřív bez odkazu
      { href: '/admin/documents', label: 'Dokumenty k podpisu', hint: 'Elektronický podpis (QES)' },
    ],
  },
  {
    key: 'nastaveni',
    label: 'Nastavení a integrace',
    items: [
      { href: '/admin/settings', label: 'Nastavení', hint: 'Základní údaje účtu' },
      { href: '/admin/settings/branding', label: 'Branding', hint: 'Logo a barvy prodejní stránky' }, // dřív bez odkazu
      { href: '/admin/settings/domains', label: 'Vlastní domény', hint: 'Prodej na vaší adrese' }, // dřív bez odkazu
      { href: '/admin/settings/kyc', label: 'Ověření účtu', hint: 'KYC pro výplaty' }, // dřív bez odkazu
      { href: '/admin/domains', label: 'White-label domény', hint: 'Domény pro partnery' },
      { href: '/admin/embed', label: 'Embed na web', hint: 'Prodej na vlastním webu' },
      { href: '/admin/webhooks', label: 'Webhooky', hint: 'Odesílání událostí ven' },
      { href: '/admin/oauth-apps', label: 'OAuth aplikace', hint: 'Přístup třetích stran' },
      { href: '/admin/onboarding', label: 'Průvodce nastavením', hint: 'První kroky' },
    ],
  },
  {
    key: 'vertikaly',
    label: 'Vertikály',
    items: [
      { href: '/admin/films', label: 'Filmový katalog', hint: 'Pro kina' },
      { href: '/admin/sport-teams', label: 'Sportovní týmy', hint: 'Pro sportovní kluby' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Úroveň akce — deset záložek
 * ------------------------------------------------------------------ */

export type EventTabSlug =
  | ''
  | 'vstupenky'
  | 'ceny'
  | 'planek'
  | 'prodej'
  | 'publikum'
  | 'provoz'
  | 'marketing'
  | 'vyuctovani'
  | 'nastaveni';

export interface EventTab {
  slug: EventTabSlug;
  label: string;
  /** Popis pod nadpisem rozcestníku záložky. */
  description: string;
  staffAllowed?: StaffVisible;
}

export const EVENT_TABS: EventTab[] = [
  { slug: '', label: 'Přehled', description: 'Jak akce prodává a co vyžaduje pozornost.', staffAllowed: true },
  { slug: 'vstupenky', label: 'Vstupenky', description: 'Typy vstupenek, kapacita a co všechno se k nim dá přidat.' },
  { slug: 'ceny', label: 'Ceny', description: 'Cenová okna, slevy a nástroje pro ladění ceny během prodeje.' },
  { slug: 'planek', label: 'Plánek', description: 'Rozložení sálu, sedadla a dostupnost míst.' },
  { slug: 'prodej', label: 'Prodej', description: 'Objednávky, vyzvednutí, čekání a prodejní kanály.', staffAllowed: true },
  { slug: 'publikum', label: 'Publikum', description: 'Hosté, akreditace a kdo na akci přijde.', staffAllowed: true },
  { slug: 'provoz', label: 'Provoz', description: 'Všechno pro den D — vstup, zóny, foyer, krizové situace.', staffAllowed: true },
  { slug: 'marketing', label: 'Marketing', description: 'Komunikace, prodej na webu a zážitky pro fanoušky.' },
  { slug: 'vyuctovani', label: 'Vyúčtování', description: 'Co akce vydělala a komu se co vyplácí.' },
  { slug: 'nastaveni', label: 'Nastavení', description: 'Údaje o akci, obsazení a změny termínu.' },
];

/**
 * Dostupnost funkce:
 *  - 'always'   — vidí se u každé akce
 *  - 'template' — zapne se automaticky podle šablony zvolené při zakládání
 *  - 'optional' — vypnuto, dokud si to pořadatel nezapne
 */
export type FeatureTier = 'always' | 'template' | 'optional';

export interface EventFeature {
  /** Poslední segment cesty pod /admin/events/[id]/. */
  slug: string;
  label: string;
  hint: string;
  tab: EventTabSlug;
  /** Nadpis skupiny uvnitř záložky. */
  section: string;
  tier: FeatureTier;
  /** Pro tier 'template' — u kterých šablon akce se zapne samo. */
  templates?: TemplateId[];
  staffAllowed?: StaffVisible;
}

/**
 * Všech 79 podstránek akce. Součet musí sedět na počet adresářů
 * v app/admin/events/[id] — kromě 'lotteries', což je stará implementace
 * losování nad catalog.event_lotteries; nová žije pod slugem 'lottery'
 * a jako jediná je napojená na checkout a zákaznické stránky.
 */
export const EVENT_FEATURES: EventFeature[] = [
  /* ---------------- Vstupenky ---------------- */
  { slug: 'ticket-types', label: 'Typy vstupenek', hint: 'Ceny, kapacita a prodejní okna', tab: 'vstupenky', section: 'Typy a kapacita', tier: 'always' },
  { slug: 'blokace', label: 'Blokace míst', hint: 'Pojmenované blokace (firma, tisk, technika), uvolnění, volné vstupenky', tab: 'vstupenky', section: 'Typy a kapacita', tier: 'always' },
  { slug: 'kategorie', label: 'Slevové kategorie', hint: 'Plné, senior, student, ZTP/P a vlastní — ceny po zónách, průkaz, limity', tab: 'vstupenky', section: 'Typy a kapacita', tier: 'always' },
  { slug: 'holds', label: 'Držená a vyřazená místa', hint: 'Rezervace pro produkci, vyřazená sedadla', tab: 'vstupenky', section: 'Typy a kapacita', tier: 'always' },
  // Pozn.: 'tickets' tu záměrně není. Adresář events/[id]/tickets obsahuje jen
  // detail historie jednoho lístku ([ticketId]/history), žádný výpis — původní
  // menu na něj přesto odkazovalo jako na „Lístky" a odkaz končil na 404.
  // Konkrétní vstupenky jsou vidět v detailu objednávky.
  { slug: 'entry-slots', label: 'Časové vstupy', hint: 'Rozdělení návštěvníků do časových oken', tab: 'vstupenky', section: 'Typy a kapacita', tier: 'template', templates: ['conference', 'workshop_series'] },
  { slug: 'access-matrix', label: 'Oprávnění vstupu', hint: 'Kdo kam smí — zóny napříč dny', tab: 'vstupenky', section: 'Typy a kapacita', tier: 'template', templates: ['multi_day_festival', 'open_air'] },
  { slug: 'custom-fields', label: 'Doplňkové otázky', hint: 'Co se zeptat kupujícího při nákupu', tab: 'vstupenky', section: 'Typy a kapacita', tier: 'optional' },
  { slug: 'addons', label: 'Doplňky', hint: 'Co si lze přikoupit ke vstupence', tab: 'vstupenky', section: 'Doplňky a balíčky', tier: 'optional' },
  { slug: 'bundles', label: 'VIP a merch balíčky', hint: 'Vstupenka spojená s dalším zbožím', tab: 'vstupenky', section: 'Doplňky a balíčky', tier: 'optional' },
  { slug: 'gifts', label: 'Dárkové vstupenky', hint: 'Vstupenka jako dárek', tab: 'vstupenky', section: 'Doplňky a balíčky', tier: 'optional' },
  { slug: 'fan-ticket', label: 'Fanouškovská vstupenka', hint: 'Vstupenka se jménem a designem', tab: 'vstupenky', section: 'Speciální vstupenky', tier: 'optional' },
  { slug: 'commemorative', label: 'Vzpomínková vstupenka', hint: 'Sběratelská podoba po akci', tab: 'vstupenky', section: 'Speciální vstupenky', tier: 'optional' },
  { slug: 'season', label: 'Sezóna a permanentka', hint: 'Zařazení akce do předplatného', tab: 'vstupenky', section: 'Speciální vstupenky', tier: 'template', templates: ['theatre_subscription', 'sport_season'] },

  /* ---------------- Ceny ---------------- */
  { slug: 'pricing-windows', label: 'Cenová okna', hint: 'Kdy platí která cena', tab: 'ceny', section: 'Cenová okna', tier: 'always' },
  { slug: 'lastminute', label: 'Last-minute sleva', hint: 'Zlevnění před akcí', tab: 'ceny', section: 'Cenová okna', tier: 'optional' },
  { slug: 'dynamic-pricing', label: 'Dynamické ceny', hint: 'Cena reaguje na poptávku', tab: 'ceny', section: 'Dynamika a poptávka', tier: 'optional' },
  { slug: 'demand-forecast', label: 'Predikce poptávky', hint: 'Odhad, jak se bude prodávat', tab: 'ceny', section: 'Dynamika a poptávka', tier: 'optional' },
  { slug: 'member-pricing', label: 'Ceny pro členy', hint: 'Zvýhodnění členských skupin', tab: 'ceny', section: 'Slevy', tier: 'optional' },
  { slug: 'volume-discounts', label: 'Množstevní slevy', hint: 'Sleva při větším počtu kusů', tab: 'ceny', section: 'Slevy', tier: 'optional' },
  { slug: 'group-discounts', label: 'Skupinové slevy', hint: 'Sleva pro organizované skupiny', tab: 'ceny', section: 'Slevy', tier: 'optional' },
  { slug: 'channel-prices', label: 'Ceny podle kanálu', hint: 'Jiná cena na webu, u partnera, na pokladně', tab: 'ceny', section: 'Slevy', tier: 'optional' },
  { slug: 'ab-price-tests', label: 'A/B testy ceny', hint: 'Porovnání dvou cenových variant', tab: 'ceny', section: 'Testy a scénáře', tier: 'optional' },
  { slug: 'price-scenarios', label: 'Cenové scénáře', hint: 'Modelování dopadu změny ceny', tab: 'ceny', section: 'Testy a scénáře', tier: 'optional' },

  /* ---------------- Plánek ---------------- */
  { slug: 'seats', label: 'Mapa sedadel', hint: 'Živý stav míst v sále', tab: 'planek', section: 'Rozložení sálu', tier: 'always', staffAllowed: true },
  { slug: 'table-seating', label: 'Stolové rozložení', hint: 'Prodej po stolech i po místech', tab: 'planek', section: 'Rozložení sálu', tier: 'optional' },
  { slug: 'social-distancing', label: 'Rozestupy', hint: 'Automatické blokování sousedních míst', tab: 'planek', section: 'Dostupnost míst', tier: 'optional' },
  { slug: 'accessible-entrances', label: 'Bezbariérové vstupy', hint: 'Přístupná místa a trasy', tab: 'planek', section: 'Dostupnost míst', tier: 'always' },
  { slug: 'view-photos', label: 'Pohled ze sedadla', hint: 'Fotky výhledu pro kupující', tab: 'planek', section: 'Dostupnost míst', tier: 'optional' },

  /* ---------------- Prodej ---------------- */
  { slug: 'will-call', label: 'Vyzvednutí na pokladně', hint: 'Objednávky k vyzvednutí na místě', tab: 'prodej', section: 'Vyzvednutí a čekání', tier: 'always', staffAllowed: true },
  { slug: 'waitlist', label: 'Čekací listina', hint: 'Zájemci o vyprodané vstupenky', tab: 'prodej', section: 'Vyzvednutí a čekání', tier: 'always' },
  { slug: 'queue', label: 'Virtuální fronta', hint: 'Řízený nápor při zahájení prodeje', tab: 'prodej', section: 'Vyzvednutí a čekání', tier: 'optional' },
  { slug: 'distribution', label: 'Distribuční síť', hint: 'Prodej přes partnery', tab: 'prodej', section: 'Prodejní kanály', tier: 'optional' },
  { slug: 'resale-marketplace', label: 'Sekundární trh', hint: 'Přeprodej mezi fanoušky', tab: 'prodej', section: 'Sekundární trh', tier: 'optional' },
  { slug: 'resale-policy', label: 'Pravidla přeprodeje', hint: 'Co je při přeprodeji povolené', tab: 'prodej', section: 'Sekundární trh', tier: 'optional' },

  /* ---------------- Publikum ---------------- */
  { slug: 'guestlist', label: 'Seznam hostů', hint: 'Volné vstupy a hosté pořadatele', tab: 'publikum', section: 'Hosté a akreditace', tier: 'always', staffAllowed: true },
  { slug: 'accreditation', label: 'Akreditace', hint: 'Vstupy pro účinkující a štáb', tab: 'publikum', section: 'Hosté a akreditace', tier: 'template', templates: ['multi_day_festival', 'conference', 'open_air'] },
  { slug: 'press', label: 'Press akreditace', hint: 'Novináři a fotografové', tab: 'publikum', section: 'Hosté a akreditace', tier: 'template', templates: ['multi_day_festival', 'conference', 'open_air'] },
  { slug: 'verified-fan', label: 'Ověření fanoušci', hint: 'Registrace před prodejem', tab: 'publikum', section: 'Registrace fanoušků', tier: 'optional' },
  { slug: 'demographics', label: 'Demografie publika', hint: 'Kdo si vstupenky kupuje', tab: 'publikum', section: 'Kdo přišel', tier: 'always' },
  { slug: 'reviews', label: 'Hodnocení', hint: 'Zpětná vazba po akci', tab: 'publikum', section: 'Kdo přišel', tier: 'always' },

  /* ---------------- Provoz ---------------- */
  { slug: 'live-ops', label: 'Průběh akce', hint: 'Živý přehled odbavení a prodeje', tab: 'provoz', section: 'Den D', tier: 'always', staffAllowed: true },
  { slug: 'hot-mode', label: 'Režim vysoké zátěže', hint: 'Nastavení pro nápor u vstupu', tab: 'provoz', section: 'Den D', tier: 'optional' },
  { slug: 'emergency', label: 'Nouzové oznámení', hint: 'Rychlá zpráva všem návštěvníkům', tab: 'provoz', section: 'Krizové situace', tier: 'always', staffAllowed: true },
  { slug: 'hospitality', label: 'Hospitality', hint: 'Firemní a VIP péče', tab: 'provoz', section: 'Den D', tier: 'template', templates: ['sport_season', 'conference'] },
  { slug: 'kiosk-display', label: 'Informační kiosek', hint: 'Obrazovka ve foyer', tab: 'provoz', section: 'Foyer a bar', tier: 'optional' },
  { slug: 'foyer-menu', label: 'Menu foyer baru', hint: 'Nabídka občerstvení', tab: 'provoz', section: 'Foyer a bar', tier: 'optional' },
  { slug: 'foyer-orders', label: 'Objednávky z baru', hint: 'Co si lidé objednali', tab: 'provoz', section: 'Foyer a bar', tier: 'optional', staffAllowed: true },
  { slug: 'rfid-zones', label: 'RFID zóny a zařízení', hint: 'Rozdělení areálu a čtečky', tab: 'provoz', section: 'RFID a náramky', tier: 'template', templates: ['multi_day_festival', 'open_air'] },
  { slug: 'rfid-live', label: 'RFID živý přehled', hint: 'Kolik lidí je v které zóně', tab: 'provoz', section: 'RFID a náramky', tier: 'template', templates: ['multi_day_festival', 'open_air'], staffAllowed: true },
  { slug: 'wristbands', label: 'Náramky', hint: 'Bezhotovostní platby na náramek', tab: 'provoz', section: 'RFID a náramky', tier: 'template', templates: ['multi_day_festival', 'open_air'] },

  /* ---------------- Marketing ---------------- */
  { slug: 'broadcast', label: 'Hromadná zpráva', hint: 'E-mail kupujícím této akce', tab: 'marketing', section: 'Komunikace', tier: 'always' },
  { slug: 'ai-description', label: 'AI popis akce', hint: 'Vygenerovaný text akce', tab: 'marketing', section: 'Komunikace', tier: 'always' },
  { slug: 'publish-facebook', label: 'Publikovat na Facebook', hint: 'Založení události na FB', tab: 'marketing', section: 'Komunikace', tier: 'optional' },
  { slug: 'marketing-qr', label: 'QR kódy pro tisk', hint: 'Plakáty a letáky s odkazem', tab: 'marketing', section: 'Komunikace', tier: 'optional' },
  { slug: 'embed', label: 'Prodej na vašem webu', hint: 'Vložení prodeje do vlastní stránky', tab: 'marketing', section: 'Prodej na webu', tier: 'always' },
  { slug: 'wallet-push', label: 'Zpráva do Wallet', hint: 'Notifikace na vstupenku v telefonu', tab: 'marketing', section: 'Prodej na webu', tier: 'optional' },
  { slug: 'wallet-modules', label: 'Obsah ve Wallet', hint: 'Co se zobrazí na vstupence v telefonu', tab: 'marketing', section: 'Prodej na webu', tier: 'optional' },
  { slug: 'superfan', label: 'Zážitky pro fanoušky', hint: 'Nadstandardní odměny', tab: 'marketing', section: 'Zážitky pro fanoušky', tier: 'optional' },
  { slug: 'fan-bonus', label: 'Fanouškovský bonus', hint: 'Odměna za opakovaný nákup', tab: 'marketing', section: 'Zážitky pro fanoušky', tier: 'optional' },
  { slug: 'backstage', label: 'Backstage moment', hint: 'Obsah ze zákulisí pro držitele vstupenek', tab: 'marketing', section: 'Zážitky pro fanoušky', tier: 'optional' },
  { slug: 'lottery', label: 'Losování', hint: 'Slosování o vstupenky nebo zážitky', tab: 'marketing', section: 'Zážitky pro fanoušky', tier: 'optional' },
  { slug: 'donation', label: 'Dobrovolný příspěvek', hint: 'Dárcovství při nákupu', tab: 'marketing', section: 'Zážitky pro fanoušky', tier: 'optional' },
  { slug: 'stream', label: 'Livestream', hint: 'Online přenos akce', tab: 'marketing', section: 'Zážitky pro fanoušky', tier: 'template', templates: ['online_stream'] },
  { slug: 'sponsors', label: 'Sponzoři', hint: 'Loga a plnění partnerů', tab: 'marketing', section: 'Partneři a doplňkové služby', tier: 'optional' },
  { slug: 'travel-links', label: 'Cestovní partneři', hint: 'Doprava a ubytování k akci', tab: 'marketing', section: 'Partneři a doplňkové služby', tier: 'optional' },
  { slug: 'transit-combo', label: 'Kombi s MHD', hint: 'Vstupenka platí i jako jízdenka', tab: 'marketing', section: 'Partneři a doplňkové služby', tier: 'optional' },
  { slug: 'parking-bundles', label: 'Parkování a ubytování', hint: 'Balíčky se službami v okolí', tab: 'marketing', section: 'Partneři a doplňkové služby', tier: 'optional' },

  /* ---------------- Vyúčtování ---------------- */
  { slug: 'sales-report', label: 'Report prodeje', hint: 'Co akce vydělala', tab: 'vyuctovani', section: 'Report prodeje', tier: 'always' },
  { slug: 'rozpocet', label: 'Rozpočet a bod zlomu', hint: 'Náklady akce a kolik vstupenek chybí do nuly', tab: 'vyuctovani', section: 'Report prodeje', tier: 'always' },
  { slug: 'advance-payout', label: 'Výplata před akcí', hint: 'Záloha z prodaných vstupenek', tab: 'vyuctovani', section: 'Výplaty', tier: 'optional' },
  { slug: 'offers', label: 'Nabídky umělcům', hint: 'Podmínky, odeslání agentovi a podpis', tab: 'vyuctovani', section: 'Výplaty', tier: 'optional' },
  { slug: 'artist-royalties', label: 'Honoráře umělců', hint: 'Podmínky, podíly a vyúčtování', tab: 'vyuctovani', section: 'Výplaty', tier: 'optional' },
  { slug: 'settlement', label: 'Vyúčtování s umělcem', hint: 'Uzavřený přehled po akci k podpisu', tab: 'vyuctovani', section: 'Výplaty', tier: 'optional' },

  /* ---------------- Nastavení ---------------- */
  { slug: 'edit', label: 'Údaje o akci', hint: 'Název, popis, datum, obrázky', tab: 'nastaveni', section: 'Základní údaje', tier: 'always' },
  { slug: 'settings', label: 'Nastavení prodeje', hint: 'Pravidla nákupu a viditelnost', tab: 'nastaveni', section: 'Základní údaje', tier: 'always' },
  { slug: 'cast', label: 'Obsazení', hint: 'Účinkující a tvůrci', tab: 'nastaveni', section: 'Základní údaje', tier: 'template', templates: ['theatre_subscription', 'single_event'] },
  { slug: 'templates', label: 'Šablony', hint: 'Uložit nastavení pro další akce', tab: 'nastaveni', section: 'Základní údaje', tier: 'optional' },
  { slug: 'postpone', label: 'Odložit akci', hint: 'Přesun na neurčito s oznámením', tab: 'nastaveni', section: 'Změna termínu', tier: 'always' },
  { slug: 'reschedule', label: 'Přesunout termín', hint: 'Nové datum a informování kupujících', tab: 'nastaveni', section: 'Změna termínu', tier: 'always' },
];

/* ------------------------------------------------------------------ *
 * Pomocné funkce
 * ------------------------------------------------------------------ */

/** Funkce spadající do dané záložky, seskupené podle sekcí, v pořadí definice. */
export function featuresForTab(tab: EventTabSlug): Array<{ section: string; items: EventFeature[] }> {
  const groups: Array<{ section: string; items: EventFeature[] }> = [];
  for (const f of EVENT_FEATURES) {
    if (f.tab !== tab) continue;
    const existing = groups.find((g) => g.section === f.section);
    if (existing) existing.items.push(f);
    else groups.push({ section: f.section, items: [f] });
  }
  return groups;
}

/**
 * Je funkce pro tuhle akci zapnutá?
 *
 * @param template  šablona, podle které akce vznikla
 * @param enabled   moduly, které si pořadatel zapnul ručně (slugy)
 */
export function isFeatureEnabled(
  feature: EventFeature,
  template: TemplateId | null | undefined,
  enabled: readonly string[] = [],
): boolean {
  if (feature.tier === 'always') return true;
  if (enabled.includes(feature.slug)) return true;
  if (feature.tier === 'template') {
    return Boolean(template && feature.templates?.includes(template));
  }
  return false;
}

/** Záložky viditelné pro danou roli. */
export function tabsForRole(role: PromoterRole | null | undefined): EventTab[] {
  if (role !== 'staff') return EVENT_TABS;
  return EVENT_TABS.filter((t) => t.staffAllowed);
}

/** Položky levého menu viditelné pro danou roli. */
export function orgNavForRole(role: PromoterRole | null | undefined): OrgNavItem[] {
  if (role !== 'staff') return ORG_NAV;
  return ORG_NAV.filter((i) => i.staffAllowed);
}

/** Ploché pole všech rout organizace — pro hledání na rozcestníku. */
export function allOrgRoutes(): RouteEntry[] {
  return ORG_ROUTES.flatMap((d) => d.items);
}

/** Je položka menu aktivní pro aktuální cestu? */
export function isOrgItemActive(item: OrgNavItem, pathname: string): boolean {
  if (item.href === '/admin') return pathname === '/admin';
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  return (item.covers ?? []).some((c) => pathname === c || pathname.startsWith(`${c}/`));
}
