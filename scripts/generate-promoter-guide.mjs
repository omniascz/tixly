/**
 * Generates Tixly Promoter Guide PDF.
 *
 * Usage: node scripts/generate-promoter-guide.mjs
 * Output: docs/Tixly-Promoter-Guide.pdf
 *
 * Uses PDFKit + NotoSans (česká diakritika).
 * Strukturovaný průvodce po všech sekcích systému, tak jak ho pošleme
 * novému promotérovi po onboardingu.
 */
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Run from project root: node scripts/generate-promoter-guide.mjs
// Anebo z nextjs-boilerplate: node ../scripts/generate-promoter-guide.mjs
// — script si najde repo root podle existence docs/ adresáře.
import { existsSync } from 'node:fs';
function findRepoRoot(start) {
  let cur = start;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(cur, 'docs')) && existsSync(join(cur, 'nextjs-boilerplate'))) {
      return cur;
    }
    cur = join(cur, '..');
  }
  throw new Error('Could not locate repo root');
}
const ROOT = findRepoRoot(__dirname);
const FONT_DIR = join(ROOT, 'nextjs-boilerplate', 'src', 'lib', 'tickets', 'fonts');
const FONT_REG = join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD = join(FONT_DIR, 'NotoSans-Bold.ttf');
const OUTPUT = join(ROOT, 'docs', 'Tixly-Promoter-Guide.pdf');

const BRAND = '#6C47FF';
const BRAND_DARK = '#4527A0';
const TEXT = '#1a1a1a';
const MUTED = '#555';
const ACCENT = '#10b981';

// ─── Layout helpers ──────────────────────────────────────────────────────────

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  info: {
    Title: 'Tixly — Průvodce pro promotéra',
    Author: 'Tixly',
    Subject: 'Jak pracovat s Tixly systémem',
    Keywords: 'tixly, promoter, guide, ticketing, czech, slovak',
  },
});
doc.registerFont('reg', FONT_REG);
doc.registerFont('bold', FONT_BOLD);
doc.font('reg');

doc.pipe(createWriteStream(OUTPUT));

let pageNum = 0;
const toc = []; // { title, level, page }

function pageHeader() {
  if (pageNum === 0) return;
  doc.save();
  doc.fontSize(8).fillColor(MUTED).font('reg');
  doc.text('Tixly — Průvodce pro promotéra', MARGIN, 30, {
    align: 'left',
    width: CONTENT_W,
  });
  doc.text(`Strana ${pageNum}`, MARGIN, 30, {
    align: 'right',
    width: CONTENT_W,
  });
  doc.moveTo(MARGIN, 48).lineTo(PAGE_W - MARGIN, 48).strokeColor('#eee').stroke();
  doc.restore();
}

doc.on('pageAdded', () => {
  pageNum += 1;
  pageHeader();
});

function ensureSpace(needed) {
  if (doc.y + needed > PAGE_H - MARGIN - 20) {
    doc.addPage();
  }
}

function h1(title) {
  doc.addPage();
  toc.push({ title, level: 1, page: pageNum });
  doc.moveDown(0.5);
  doc.fontSize(22).fillColor(BRAND).font('bold').text(title);
  doc.moveTo(MARGIN, doc.y + 4).lineTo(MARGIN + 60, doc.y + 4).strokeColor(BRAND).lineWidth(3).stroke();
  doc.moveDown(1.2);
  doc.fontSize(11).fillColor(TEXT).font('reg');
}

function h2(title) {
  ensureSpace(50);
  toc.push({ title, level: 2, page: pageNum });
  doc.moveDown(0.8);
  doc.fontSize(15).fillColor(BRAND_DARK).font('bold').text(title);
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor(TEXT).font('reg');
}

function h3(title) {
  ensureSpace(35);
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor(TEXT).font('bold').text(title);
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor(TEXT).font('reg');
}

function p(text, opts = {}) {
  ensureSpace(20);
  doc.fontSize(11).fillColor(TEXT).font('reg').text(text, {
    align: 'justify',
    lineGap: 2,
    ...opts,
  });
  doc.moveDown(0.5);
}

function bullet(items) {
  doc.fontSize(11).fillColor(TEXT).font('reg');
  for (const item of items) {
    ensureSpace(18);
    doc.text('•  ' + item, {
      indent: 10,
      lineGap: 2,
    });
    doc.moveDown(0.2);
  }
  doc.moveDown(0.3);
}

function numberedSteps(items) {
  doc.fontSize(11).fillColor(TEXT).font('reg');
  items.forEach((item, i) => {
    ensureSpace(20);
    doc.font('bold').text(`${i + 1}. `, { continued: true, indent: 6 });
    doc.font('reg').text(item, { lineGap: 2 });
    doc.moveDown(0.3);
  });
  doc.moveDown(0.3);
}

function callout(title, text, color = ACCENT) {
  ensureSpace(60);
  const y = doc.y;
  const padding = 10;
  doc.save();
  doc.rect(MARGIN, y, CONTENT_W, 8).fillColor(color).fill();
  doc.restore();
  doc.moveDown(0.4);
  const textY = doc.y;
  doc.fontSize(10).fillColor(color).font('bold').text(title, MARGIN + padding, textY + 4);
  doc.fontSize(10).fillColor(TEXT).font('reg').text(text, MARGIN + padding, doc.y + 2, {
    width: CONTENT_W - 2 * padding,
    lineGap: 2,
  });
  doc.moveDown(0.8);
}

function tipBox(text) {
  callout('💡 TIP', text, '#0891b2');
}

function warnBox(text) {
  callout('⚠ POZOR', text, '#d97706');
}

function pathLabel(path) {
  doc.fontSize(10).fillColor('#444').font('bold');
  doc.text(`📍 ${path}`, { lineGap: 2 });
  doc.fontSize(11).fillColor(TEXT).font('reg');
  doc.moveDown(0.3);
}

// ─── Cover page ──────────────────────────────────────────────────────────────

function coverPage() {
  pageNum = 1;
  // brand band
  doc.save();
  doc.rect(0, 0, PAGE_W, 220).fillColor(BRAND).fill();
  doc.restore();

  doc.fontSize(48).fillColor('#fff').font('bold').text('Tixly', MARGIN, 80);
  doc.fontSize(18).font('reg').text('Průvodce pro promotéra', MARGIN, 140);

  doc.fontSize(11).fillColor('#e0d4ff').font('reg').text(
    'Jak pracovat se systémem od registrace po reportování',
    MARGIN,
    180,
  );

  // body
  doc.fontSize(11).fillColor(TEXT).font('reg');
  doc.text('', MARGIN, 280);

  doc.fontSize(13).fillColor(BRAND_DARK).font('bold').text('Pro koho je tato příručka?', MARGIN, 280);
  doc.fontSize(11).fillColor(TEXT).font('reg').moveDown(0.4);
  doc.text(
    'Pro každého nového promotéra, který se zaregistruje na Tixly platformě. ' +
      'Najdete tu kompletní průchod systémem — od první registrace, přes vytvoření ' +
      'akce, prodej vstupenek, check-in u dveří, až po reporty a vyúčtování.',
    { align: 'justify', lineGap: 3 },
  );

  doc.moveDown(1.5);
  doc.fontSize(13).fillColor(BRAND_DARK).font('bold').text('Co Tixly umí — krátký výčet');
  doc.fontSize(11).fillColor(TEXT).font('reg').moveDown(0.4);
  const features = [
    'Plný ticketing: GA + sedadla, multi-day akce, festivalová cross-pass loď',
    'Anti-bot ochrana: virtuální fronta, Verified Fan presale, SMS OTP, rotující QR',
    'Dynamické ceny: velocity + scarcity algoritmus s manuálními limity',
    'Promo a loyalty: kódy, slevy, věrnostní body, vouchery, gifty',
    'Anti-scalping: FanSALE marketplace s EU price cap',
    'Stornoschutz: pojistka proti zrušení zájezdu (auto-claim)',
    'Subscriptions: divadelní abonentky (Festabo + Wahl-Abo)',
    'POS, scanner s offline queue, RFID wristbands pro festivaly',
    'CZ-specific: ISDOC, Pohoda, NIPOS Kult 1-01, ARES IČO verify, DPH',
    'Marketing: emaily, SMS, push, Facebook publish, print QR kampaně',
    'AI tools: auto-tag, popis, cover image, price suggestion, moderace',
    'Reporting: real-time SSE, ML anomaly detection, custom dashboardy',
  ];
  for (const f of features) {
    doc.text('• ' + f, { indent: 10, lineGap: 2 });
    doc.moveDown(0.15);
  }

  // footer
  doc.fontSize(9).fillColor(MUTED).font('reg');
  doc.text(`Verze 1.0 • ${new Date().toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })}`, MARGIN, PAGE_H - MARGIN - 30);
  doc.text('Otázky? Napiš nám na podpora@tixly.cz', MARGIN, PAGE_H - MARGIN - 16);
}

// ─── Chapter content ─────────────────────────────────────────────────────────

function chapterOnboarding() {
  h1('1. Registrace a první kroky');

  p(
    'Než začneš prodávat vstupenky, projdeš krátkým onboardingem. Celý proces ' +
      'zabere zhruba 15–30 minut, pokud máš po ruce IČO, číslo bankovního účtu a logo.',
  );

  h2('Registrace promotéra');
  pathLabel('/cs/register-promoter');
  numberedSteps([
    'Vyplň jméno organizace, kontaktní e-mail a heslo. Z tohoto e-mailu se stane vlastník účtu (owner role).',
    'Po registraci ti pošleme verifikační e-mail. Klikni na odkaz a aktivuj účet.',
    'Přihlas se a najdeš se na /admin s onboarding checklistem.',
  ]);

  h2('Onboarding checklist');
  pathLabel('/admin/onboarding');
  p('Checklist má 5 kroků. Dokud je nedokončíš, na hlavním dashboardu vidíš zelený progress baner.');
  bullet([
    'KYC — IČO, DIČ (pokud plátce DPH), adresa, číslo bankovního účtu',
    'Branding — logo (PNG/SVG transparent), primární barva, doménové preferencie',
    'Refund policy — kolik dní před akcí, fee %, minimální fee Kč',
    'První akce — wizard tě provede',
    'Team — pozvi kolegy (admin, staff role)',
  ]);
  tipBox(
    'Checklist můžeš nechat částečně rozpracovaný a vrátit se k němu později. Tixly tě ' +
      'několikrát upomene e-mailem (kron `onboarding-reminder` jednou denně v 9:00).',
  );

  h2('KYC — ověření identity');
  pathLabel('/admin/settings/kyc');
  p(
    'Bez schváleného KYC nemůžeš vystavovat platby na reálné peníze, jen na demo ' +
      'účet. Schválení trvá obvykle 1–3 pracovní dny.',
  );
  bullet([
    'IČO — Tixly automaticky ověří přes ARES (gov.cz API)',
    'Číslo bankovního účtu — formát CZ123/4567 nebo IBAN',
    'Plátce DPH — pokud ano, vyplň DIČ a budeš účtovat DPH 21 % na servisní poplatek',
    'Doklad totožnosti vlastníka (jen pro vysoké tier promotéry: enterprise)',
  ]);
  warnBox(
    'Dokud KYC není schválené, tvůj promoter tier je „nový" (pre_review_volume_cap_halire = 100 000 Kč/měsíc). ' +
      'Po schválení automaticky přejdeš na „ověřený" a cap se zruší.',
  );

  h2('Branding');
  pathLabel('/admin/settings/branding');
  p('Tvé barvy a logo se promítnou do:');
  bullet([
    'Public stránky promotéra `/cs/p/{slug}`',
    'Hlavičky PDF vstupenek a vouchorů',
    'Email šablon (kromě interních notifikací Tixly)',
    'White-label tématu pokud máš vlastní doménu',
  ]);

  h2('Vlastní doména (white-label)');
  pathLabel('/admin/settings/domains');
  p(
    'Pokud chceš prodávat na vlastní doméně (např. `vstupenky.tvedivadlo.cz`) bez ' +
      'tixly.cz brandingu, postupuj takto:',
  );
  numberedSteps([
    'Přidej doménu → dostaneš verification token (TXT záznam)',
    'Nastav DNS: `_tixly-verify TXT "tixly-verify-xyz"` u svého DNS poskytovatele',
    'Klikni „Verify" → Tixly DNS check (max 5 min)',
    'Po verify nastav A/CNAME na naše IP nebo proxy',
    'V `/admin/settings/branding` zapni „Hide Powered by Tixly" (pro Enterprise tier)',
  ]);
  tipBox('White-label je pro Premium tier a vyšší. Nový tier má badge „Powered by Tixly" v patičce.');

  h2('Team a role');
  pathLabel('/admin/team');
  p('Můžeš pozvat členy týmu. Tixly má 4 role:');
  bullet([
    'Owner — full access, nemůžeš ho smazat (zakladatel účtu)',
    'Admin — všechno kromě KYC a billing',
    'Staff — POS, scanner, my-orders read-only',
    'Read-only — jen reporty a analytika',
  ]);
}

function chapterCreateEvent() {
  h1('2. Vytvoření akce');

  p(
    'Vytvoření akce v Tixly probíhá přes 4-stupňový wizard. Můžeš ho dokončit ' +
      'najednou nebo si akci uložit jako draft a vrátit se později.',
  );

  h2('Wizard nové akce');
  pathLabel('/admin/events/new');

  h3('Krok 1 — Základní info');
  bullet([
    'Název akce (max 200 znaků)',
    'Krátký popis (objevuje se v search results, max 300 znaků)',
    'Plný popis (markdown podporován)',
    'Kategorie a subkategorie (koncert, divadlo, sport, festival, konference, výstava…)',
    'Min věk — pokud 18+, buyer projde age gate',
    'Kover image — upload (1200×630 doporučeno) nebo AI-generated',
  ]);
  tipBox(
    'Klikni „AI Auto-Generate Cover" — Tixly vytvoří 3 varianty cover image ' +
      'podle popisu akce (DALL-E 3 / FAL.ai). Můžeš pak vybrat tu, která ti sedne.',
  );

  h3('Krok 2 — Místo a čas');
  bullet([
    'Datum a čas startu + konec',
    'Místo — vybírej z master katalogu venues nebo přidej nové (musí schválit platform admin)',
    'Pro multi-day akce zapni „Multi-day" a definuj jednotlivé dny',
    'TBD/Online — pokud místo zatím nevíš nebo je akce online',
  ]);

  h3('Krok 3 — Vstupenky (ticket types)');
  bullet([
    'Název typu (např. „Standard", „VIP", „Děti do 15 let")',
    'Cena base_price v Kč (server přidá fee + DPH dle nastavení)',
    'Kapacita — pevný počet, nebo „nepřebrat kapacitu místa"',
    'Sedadlo / GA — pokud sedadlo, vyber sektor z hall mapy',
    'Min a max počet kupců na objednávku (typicky 1–10)',
    'Personalizace — kupec musí zadat jméno na každé vstupence (anti-scalping)',
  ]);

  h3('Krok 4 — Zveřejnění');
  bullet([
    'Pendingo review — pokud máš méně než 3 published akce v posledních 90 dnech, projde tvá akce AI moderací (1–3 min)',
    'Po schválení automaticky published',
    'Můžeš nastavit „presale window" — akce viditelná, ale prodej startuje až v daný čas',
  ]);

  warnBox(
    'Po publish se akce dostane na public marketplace. Změna title nebo description ' +
      'vyvolá re-moderation (AI gate). Drobné změny (datum, kapacita) re-moderation netriggernou.',
  );

  h2('Editace akce');
  pathLabel('/admin/events/[id]/edit');
  p(
    'V detailu akce máš v levém menu **36 sub-stránek** pro různé aspekty: settings, addons, holds, ' +
      'pricing, marketing, scanner, atd. Detail rozebíráme v kapitolách dále.',
  );

  h2('Hromadný import (CSV)');
  pathLabel('/admin/events/batch-import');
  p(
    'Pokud máš dlouhý seznam akcí (typicky divadlo s repertoárem), použij CSV import. ' +
      'Stáhni template, vyplň, upload → Tixly validuje a vytvoří všechny najednou.',
  );

  h2('Šablony akcí');
  pathLabel('/admin/event-templates');
  p(
    'Vytvoř šablonu z existující akce (např. „Páteční koncert v Lucerně"). Při tvorbě další ' +
      'klikni „Aplikuj šablonu" — zkopírují se ticket types, addons, settings.',
  );

  h2('Tour / festival groups');
  pathLabel('/admin/event-groups');
  p(
    'Pokud máš tour (10 měst × 1 akce), vytvoř event group. Dostaneš:',
  );
  bullet([
    'Coordinated onsale — všechny akce startují prodej v jeden moment (TM pattern)',
    'Bulk-edit pro hromadnou změnu cen / popisu napříč skupinou',
    'Aggregated reporty (tour-wide tržby, top města)',
  ]);
}

function chapterPricing() {
  h1('3. Ceny, slevy a dynamic pricing');

  p(
    'Tixly má jednu autoritu pro cenu (`lib/pricing/resolve-price.ts`). Hierarchie ' +
      'shora dolů:',
  );
  numberedSteps([
    'Dynamic pricing (pokud zapnuto a engine spočítal cenu)',
    'All-In tier (face + fee + DPH v jedné částce)',
    'Pricing rule (early bird, regular, late, door)',
    'Base price (default)',
  ]);
  p('Server vždy resolve cenu sám — klient nikdy neposílá cenu v requestu.');

  h2('Dynamic pricing engine');
  pathLabel('/admin/events/[id]/dynamic-pricing');
  p(
    'Demand-based pricing podle velocity (orders/hour) a scarcity (remaining_qty). ' +
      'Cena se přepočítává každých 5 minut automaticky.',
  );
  bullet([
    'Min price (haléře) — cena nikdy nepůjde níž',
    'Max price (haléře) — cap (anti-Ticketmaster excess)',
    'Velocity threshold per hour — kolik objednávek/hodinu spustí uplift',
    'Max uplift % — kolik % nahoru může cena maximálně růst',
    'Scarcity threshold % — od kolika % vyprodaného začíná scarcity uplift',
    'Scarcity uplift % — kolik % přidá za scarcity',
  ]);
  tipBox(
    'Pro citlivé publikum (divadlo, kultura) doporučujeme uplift max 15-20 %. ' +
      'Pro festivaly/hudbu lze i 30-50 % s vyšším max_price cap.',
  );

  h2('Pricing windows (early bird / late)');
  pathLabel('/admin/events/[id]/pricing-windows');
  p(
    'Časově omezené ceny. Příklad: „Do 30. dubna 250 Kč, květen 350 Kč, červen 450 Kč."',
  );

  h2('Per-channel ceny');
  pathLabel('/admin/events/[id]/channel-prices');
  p('Různé ceny pro různé kanály: web / POS pokladna / affiliate / B2B partner.');

  h2('Volume + group discounts');
  bullet([
    '`/admin/events/[id]/group-discounts` — slevy pro skupiny (5+ ks = -10 %)',
    '`/admin/ticket-types/[id]/volume-discount` — quantity tiers per ticket type',
  ]);

  h2('Member pricing');
  pathLabel('/admin/events/[id]/member-pricing');
  p(
    'Pokud máš člensky uzavřenou skupinu (např. Předplatitelé Národního divadla), můžeš jim ' +
      'nabídnout zvýhodněnou cenu. Definuj člen groups v `/admin/member-groups` → přiřaď slevy.',
  );

  h2('Promo kódy');
  pathLabel('/admin/promo-codes');
  bullet([
    'Procentní nebo fixní sleva v Kč',
    'Max počet použití (per code nebo per buyer)',
    'Expiry datum',
    'Min order amount',
    'Filtr ticket types — kód platí jen na vybrané typy',
  ]);

  h2('Access codes (presale)');
  pathLabel('/admin/access-codes');
  p(
    'Skryté ticket types — kupec musí zadat access code, aby je vůbec viděl v checkoutu. ' +
      'Vhodné pro „přátele a rodina" presale nebo VIP linky.',
  );

  h2('A/B price testing');
  pathLabel('/admin/events/[id]/ab-price-tests');
  p(
    'Náhodně přiděl buyerům variantu A (např. 250 Kč) nebo variantu B (300 Kč). ' +
      'Tixly počítá konverzi + statistical significance, abys mohl rozhodnout.',
  );

  h2('Price scenarios (what-if)');
  pathLabel('/admin/events/[id]/price-scenarios');
  p(
    'Simulátor: „Co kdybych zlevnil VIP o 15 %?" — Tixly projektuje revenue a sold ' +
      'množství na základě historie podobných akcí.',
  );
}

function chapterAntiBot() {
  h1('4. Anti-bot a anti-scalper ochrana');

  p('Pro top-poptávkové akce má Tixly několik vrstev ochrany.');

  h2('Hot mode');
  pathLabel('/admin/events/[id]/hot-mode');
  p('Anti-scalper toggle. Když zapnuto:');
  bullet([
    'Max tickets per buyer (typicky 4–6)',
    'TAN (Telephone Authorization Number) — kupec musí mít ověřený telefon',
    'Phone binding — vstupenky se zaregistrují na konkrétní telefonní číslo',
    'No-gift — kupec nemůže lístek darovat (jen použít sám)',
    'Photo ID required na vstupu',
  ]);

  h2('Verified Fan presale');
  pathLabel('/admin/events/[id]/verified-fan');
  p(
    'Ticketmaster pattern. Fanoušek se registruje, ty schválíš, on dostane PSL-xxxx kód. ' +
      'Kód musí použít v checkout, jinak transakce neprojde.',
  );
  numberedSteps([
    'Zapni `verified_fan_enabled` v event settings',
    'Open registration → fanoušci posílají motivaci ve formuláři',
    'V queue (admin/events/[id]/verified-fan) označuješ approve/reject',
    'Approve → Tixly vygeneruje unikátní PSL-xxxx kód a pošle e-mailem',
    'Fan v checkoutu zadá kód → kód se označí jako použitý (one-time)',
  ]);

  h2('SMS OTP validation');
  pathLabel('/admin/events/[id]/settings → „SMS OTP ověření"');
  p(
    'Když zapnuto, kupec musí ověřit telefon SMS kódem před dokončením checkout. ' +
      'Vhodné pro IT Legge anti-bagarinaggio pattern.',
  );
  warnBox(
    'V dev/test módu se SMS reálně neposílá — kód najdeš v server logu. V produkci ' +
      'vyžaduje Twilio nebo BulkGate integraci (env keys).',
  );

  h2('Virtuální fronta');
  pathLabel('/admin/events/[id]/settings → „Queue enabled"');
  p('Pro on-sale momenty s vysokou poptávkou. Kupec projde virtuální čekárnou.');
  bullet([
    'Max concurrent buyers na pokladně (typicky 100–500)',
    'Server admituje postupně podle volných slotů',
    'Token + position + ETA polling',
    'Anti-rebound: kupec dostane unikátní `queue_token` co musí použít v checkoutu',
  ]);

  h2('Fraud ML scoring');
  p('Automaticky aktivní pro všechny checkout — žádné nastavení.');
  bullet([
    'Multi-feature scoring: velocity (kolik objednávek IP/email/fingerprint), disposable email check, high-value flag, geo-mismatch stub',
    'Decision: `allow` / `review` / `block`',
    'Block → 403 v checkout, audit log',
    'Review → order projde, ale objeví se v `/admin/fraud-queue` ke kontrole',
  ]);

  h2('Bot detection');
  p('Také automatické. Detekuje:');
  bullet([
    'Honeypot field (skrytý field co lidé nevyplní)',
    'Sub-2s form submit (lidé to nestihnou)',
    'Per-fingerprint velocity (víc než N requests/min)',
    'User agent blocklist (Selenium, Puppeteer, headless Chrome)',
  ]);
}

function chapterResale() {
  h1('5. FanSALE — resale marketplace');

  p(
    'Tixly má vestavěný resale marketplace s EU price cap (anti-scalping). ' +
      'Kupec si může lístek prodat dál za max 110 % původní ceny.',
  );

  h2('Per-event resale policy');
  pathLabel('/admin/events/[id]/resale-policy');
  bullet([
    'Resale on/off — můžeš vypnout pro VIP akce nebo divadlo',
    'Resale window — od kdy do kdy je listing povoleno (typicky až po sold-out)',
    'Fee % — Tixly bere fee z resale (default 5 %)',
    'Payout delay — kolik dní po akci dostane seller peníze (proti chargebacks)',
    'Excluded combo — nelze prodat lístky s MHD combo, charity claim, atd.',
  ]);

  h2('Buyer flow');
  numberedSteps([
    'Kupec jde na /cs/my-tickets, klikne „💰 Prodat na marketplace"',
    'Zadá cenu v Kč (server enforce max 110 % face value)',
    'Listing se objeví na `/cs/resale` (public, no login)',
    'Jiný buyer vidí listing → klikne Koupit → standardní checkout',
    'Po platbě: starý lístek revoked (nový TOTP secret), nový vystaven novému kupci',
    'Seller dostane platbu po `payout_delay` dnů (default 4)',
  ]);

  tipBox(
    'FanSALE je velký selling point oproti šedému trhu (Viagogo, Stubhub) — kupec ' +
      'má jistotu autentičnosti a fair ceny.',
  );
}

function chapterInsurance() {
  h1('6. Stornoschutz — pojistka proti zrušení');

  p(
    'Volitelný addon pro kupce. Když nemůže přijít (nemoc, úraz, práce), dostane plný ' +
      'refund minus premium. Tixly platí jako insurance „underwriter" interně.',
  );

  h2('Aktivace v event settings');
  pathLabel('/admin/events/[id]/settings');
  bullet([
    'Insurance enabled — zapnuto/vypnuto',
    'Insurance pct — % z ceny lístku (typicky 8–12 %), nebo flat amount',
  ]);
  p('Premium se počítá: `max(pct × subtotal, flat)`. Kupec vidí v checkoutu checkbox „Pojistit za 25 Kč" (live preview).');

  h2('Claim flow');
  p('Kupec sám iniciuje claim:');
  numberedSteps([
    'V /cs/my-tickets klikne „Požádat o refund" → vybere důvod (nemoc, práce, jiný)',
    'POST /api/buyer/orders/[orderId]/insurance-claim',
    'Auto-approve full premium back — peníze do 7 dnů na původní platební metodu',
    'Vstupenka revoked',
  ]);
  warnBox(
    'Tixly aktuálně pojistku underwrituje interně (žádný real insurance partner). Pro ' +
      'enterprise customers možno integrovat s Allianz/UNIQA — kontakt sales.',
  );
}

function chapterMarketing() {
  h1('7. Marketing — emaily, kódy, kampaně');

  h2('Promo kódy');
  pathLabel('/admin/promo-codes');
  p('Viz kapitola 3 — Ceny.');

  h2('Vouchery (dárkové)');
  pathLabel('/admin/vouchers');
  bullet([
    'Batch generator: vytvoř 100 unikátních kódů najednou',
    'Hodnota v Kč (nebo % discount)',
    'Expiry: typicky 3 roky (CZ standard pro dárkové)',
    'Export CSV pro tisk fyzických voucherů (např. pro firemní dárky)',
    'Public self-purchase: `/cs/p/{slug}/vouchers` — kupec si koupí sám',
  ]);
  p('Voucher PDF se vygeneruje automaticky s tvým brandingem (logo + barva + QR + hodnota).');

  h2('Email kampaně');
  pathLabel('/admin/campaigns');
  bullet([
    'Multi-channel: email / SMS / push / in-app notif',
    'Filter recipients: paid orders / waitlist / ticket type / promoter follow',
    'Smart send-time ML — Tixly spočítá best hour per user dle past opens',
    'A/B subject line testing',
    'Real-time metrics: delivered / opened / clicked / converted',
  ]);

  h2('Hromadný email pro účastníky akce');
  pathLabel('/admin/events/[id]/broadcast');
  p(
    'Specificky pro účastníky jedné akce. Vhodné pro „Změna místa," „Zrušeno," ' +
      '„Last call vouchery na další akci po koncertu" atd.',
  );

  h2('Email šablony');
  pathLabel('/admin/email-templates');
  p('Override default Tixly šablon vlastními:');
  bullet([
    'order_confirmation — po zaplacení',
    'refund_processed — po refundu',
    'event_reminder — T-7d, T-1d, T-3h',
    'waitlist_notify',
    'abandoned_cart — 30min stale',
  ]);

  h2('Print Marketing QR kampaně');
  pathLabel('/admin/events/[id]/marketing-qr');
  p('Generuj QR kódy pro plakáty, letáky, billboardy.');
  bullet([
    'Vytvoř kampaň: „Plakát na zastávce Anděl"',
    'Stáhni PNG (real `qrcode` lib, vector quality)',
    'Kupec naskenuje → cookie `qr_ref` (90 dnů)',
    'Při checkout se attribuce uloží na order → conversion increment',
    'V dashboardu vidíš: scans, conversions, conversion rate per kampaň',
  ]);

  h2('Facebook publish');
  pathLabel('/admin/facebook + /admin/events/[id]/publish-facebook');
  numberedSteps([
    'Propojí Facebook Page (OAuth)',
    'V detailu akce klikni „Publish to Facebook"',
    'Tixly vytvoří FB Event na tvé Page (datum, popis, cover, link na Tixly checkout)',
    'Synchronizuje attendees zpět (FB „going" → RSVPs)',
  ]);
  warnBox(
    'Produkční Meta App vyžaduje Meta App Review (2–4 týdny). V dev/test módu vystupuje ' +
      'mock FB SDK — vidíš UI, ale skutečně se nic na FB nezveřejní.',
  );

  h2('Tracking pixely');
  pathLabel('/admin/tracking-pixels');
  bullet([
    'Meta Pixel — FB conversion tracking + server-side CAPI',
    'Google Ads — Conversion ID + Label',
    'TikTok Pixel',
    'GA4 Measurement Protocol — server-side purchase events',
    'Per-event override nebo global pro celého promotéra',
  ]);

  h2('Affiliate / Skiddle Rep');
  pathLabel('/admin/affiliates');
  bullet([
    'Vytvoř affiliate — dostane unikátní code (např. KAREL2026)',
    'Commission %: kolik z každého paid order dostane (typicky 5–10 %)',
    'Affiliate sdílí URL `tixly.cz/r/KAREL2026?event=X`',
    'Buyer klikne → cookie aff_code 30 dnů → checkout linkne order',
    'Commission se hromadí v `orders.affiliate_commission_minor`, payout periodicky',
  ]);

  h2('AI marketing tools');
  pathLabel('/admin/ai/*');
  bullet([
    '`/admin/ai/auto-tag` — extract genre/audience/vibe z popisu',
    '`/admin/ai/description` — GPT-4o-mini napíše 3 varianty popisu (short/medium/long)',
    '`/admin/ai/cover-images` — DALL-E 3 / FAL.ai / SD generation',
    '`/admin/ai/price-suggestion` — Tixly analyzuje podobné akce a navrhne cenu',
    '`/admin/ai/social-posts` — generator FB / IG / Twitter postů',
    '`/admin/ai/moderation` — pre-check tvého popisu před publish (vyhneš se re-moderation)',
  ]);
}

function chapterSubscriptions() {
  h1('8. Abonentky a subscriptions');

  p(
    'Tixly podporuje divadelní abonmá (Theatre Abonnement) ve dvou variantách + cross-festival passes.',
  );

  h2('Festabo (fixed abonentka)');
  p(
    'Předplatitel kupuje balíček, např. „Sezóna 2026/27 — 8 představení v Národním divadle." ' +
      'Datumy jsou předem dané.',
  );
  pathLabel('/admin/subscriptions');
  numberedSteps([
    'Vytvoř package — title, popis, cena, 8 event_ids',
    'Public stránka: /cs/p/{slug}/subscriptions/{packageSlug}',
    'Kupec koupí → dostane 8 vstupenek (jeden order, 8 ticket rows)',
    'Při scanu fungují jako normální tickety',
  ]);

  h2('Wahl-Abo (choose-your-own abonentka)');
  p(
    'Předplatitel kupuje „voucher" pro 6 představení z 25 nabízených v sezóně. ' +
      'Vybírá si datumy postupně přes svůj account.',
  );
  numberedSteps([
    'Vytvoř package s `abo_type = wahl_abo` a `max_picks_for_choice = 6`',
    'Definuj portfolio 25 event_ids',
    'Kupec koupí → dostane „holder" status (žádné konkrétní vstupenky)',
    'V /cs/my-subscriptions/{holderId}/pick vybírá 6 termínů',
    'Per pick: Tixly issue ticket pro konkrétní event',
    'Pokud nevybere všech 6 do konce sezóny → Restwert credit (zbytek hodnoty)',
  ]);

  h2('Restwert credit + pro-rata refund');
  p(
    'Pokud kupec zruší zbylé picks, dostane pro-rata refund. Nebo Tixly převede ' +
      'zbytek na další sezónu jako credit.',
  );

  h2('Cross-pass (festival pass)');
  pathLabel('/admin/cross-passes');
  p(
    'Multi-event bundle, např. „Beats for Love 4-day Pass — všechny stage." ' +
      'Funguje jako jeden QR co projde N events.',
  );
  bullet([
    'Capacity remaining_qty — kolik celkem',
    'Member identity per pass (kupec se zaregistruje)',
    'Per-event scan check-in',
  ]);

  h2('Tixly Plus (loyalty premium subscription)');
  pathLabel('/admin/subscription-plans');
  p(
    'Tvůj vlastní recurring billing plan pro fanoušky. Měsíční nebo roční ' +
      'plan s perks: pre-sale access, free shipping, bonus loyalty points.',
  );
}

function chapterLoyalty() {
  h1('9. Loyalty body a věrnostní program');

  p('Tixly Points — buyer dostane body za každý paid order, může je redeem na další objednávce.');

  h2('Tier systém');
  bullet([
    'Bronze (default) — 1 bod za 10 Kč utracené',
    'Silver (po 5 000 bodů) — 1,2 bodu za 10 Kč',
    'Gold (po 20 000 bodů) — 1,5 bodu za 10 Kč',
    'Tier se počítá automaticky z lifetime points',
  ]);

  h2('Redemption');
  p('1 bod = 1 Kč sleva v checkoutu, max 50 % z subtotal.');
  bullet([
    'Kupec v checkoutu vidí balance a slider „Použít XYZ bodů"',
    'Po payment: nová tx -XYZ bodů v `marketing.loyalty_transactions`',
  ]);

  h2('Award');
  p('Po každém paid order automaticky:');
  bullet([
    'Total amount × tier multiplier → points',
    'Idempotent na order_id (re-trigger callback nezdvojí body)',
  ]);

  tipBox(
    'Můžeš implementovat partner program s O2 Family / Sazka kartou — sdílení loyalty pointů. ' +
      'Kontakt sales@tixly.cz pro custom integraci.',
  );
}

function chapterCheckIn() {
  h1('10. Check-in u dveří — scanner a POS');

  h2('QR Scanner');
  pathLabel('/admin/scanner');
  bullet([
    'Browser-based scanner (žádná instalace)',
    'Camera input + manual entry',
    'Offline queue (IndexedDB) — funguje bez Wi-Fi, sync až bude online',
    'TOTP-aware — rotující QR validuje correct 30s window',
    'Idempotent — opakovaný scan nevyhodí error, jen ukáže „already used"',
    'Multi-gate / multi-zone selector',
    'Real-time live ops dashboard pro promotéra',
  ]);

  h2('NFC tap-to-enter (SafeTix-grade)');
  p(
    'Pro vyšší zabezpečení použij NFC. Vstupenka má HMAC-SHA256 payload s 10s TTL ' +
      'co se rotuje. Skener čte přes NFC reader (Android Tap).',
  );

  h2('Cross-pass scan');
  p('Festivalová cross-pass funguje jako multi-event ticket. Scanner detekuje co je za event a oprávnění.');

  h2('Re-entry state machine');
  p('Pokud akce povoluje re-entry (festival, multi-day):');
  bullet([
    'Entry → státky `inside`',
    'Exit → `outside`',
    'Re-entry povolen → opakovaně cyklus',
    'Re-entry zakázán (po prvním entry) → druhý scan vyhodí „already entered"',
  ]);

  h2('POS box-office');
  pathLabel('/admin/pos');
  p('Walk-in pokladna. Event + ticket type + qty → cash / card terminal → print thermal receipt.');
  bullet([
    'Auto-seat-pick pokud seated event',
    'Cash drawer integration (optional)',
    'Card terminal (typicky SumUp, Sunmi, ČSOB POS)',
    'Print 80mm thermal receipt s QR',
    'Quick mode `/admin/pos/quick` — touchscreen tablet UI pro festival kasy',
  ]);

  h2('Will-call (pickup u pokladny)');
  pathLabel('/admin/events/[id]/will-call');
  p('Konfiguruj kde a kdy si lidé mohou vyzvednout fyzické vstupenky.');
  bullet([
    'Lokace pickup desk',
    'Otevírací doba',
    'Vyžadovat ID (občanský) ano/ne',
    'Email kupcům s pickup instrukcemi',
  ]);

  h2('RFID cashless wristbands (festivaly)');
  pathLabel('/admin/wristbands + /admin/events/[id]/wristbands');
  numberedSteps([
    'Při check-in: bind RFID páska UID na ticket (POST /api/admin/wristbands/bind)',
    'Initial top-up (kupec si nabije 500 Kč na pásce u brány)',
    'Na baru / stánku F&B: charge páskou (POST /api/admin/wristbands/[uid]/charge)',
    'Pokud nedostatek balance → INSUFFICIENT_BALANCE error',
    'Po festivalu: zbytek vrátit kupci přes refund',
  ]);
  warnBox(
    'RFID hardware potřebuješ sám — Tixly nabízí jen backend. Doporučení: Intellitix nebo Glownet wristbands + reader infrastruktura.',
  );
}

function chapterRefunds() {
  h1('11. Refundy a cancellations');

  h2('Per-event refund policy');
  pathLabel('/admin/events/[id]/settings');
  bullet([
    'Refund deadline days — kolik dní před akcí může kupec sám refund (typicky 7)',
    'Refund fee % — kolik si Tixly + promotér nechá (typicky 5 %)',
    'Refund fee min Kč — minimální fee (typicky 30 Kč / 1,20 EUR)',
  ]);
  p('Default platform settings: 7 dní před, 5 %, min 30 Kč.');

  h2('Buyer self-service refund');
  p('Kupec v /cs/my-tickets klikne „Požádat o refund" → pokud je v okně, jde automaticky:');
  bullet([
    'Refund processed do 7 dnů na původní platební metodu',
    'Vstupenky revoked',
    'Email confirmation',
  ]);
  p('Pokud je mimo okno → request se objeví v promoter queue.');

  h2('Promoter refund queue');
  pathLabel('/admin/refund-requests');
  bullet([
    'Approve / Reject',
    'Partial refund (např. jen 50 %)',
    'Internal note pro audit',
    'Bulk approve (5/min rate limit)',
  ]);

  h2('Chargebacks (Stripe disputes)');
  pathLabel('/admin/chargebacks');
  bullet([
    'List všech disputes',
    'Submit evidence (delivery proof, terms, communication)',
    'Holdback amount podle promoter tier',
    'Rolling reserve — % každé tržby drženo proti chargebacks',
  ]);

  h2('Postpone / cancel celé akce');
  pathLabel('/admin/events/[id]/postpone');
  numberedSteps([
    'Označ akci „Přesunuto na" + nové datum, nebo „Zrušeno"',
    'Cascading notification všem kupcům (email + push + SMS pokud zapnuté)',
    'Pokud zrušeno → automatic full refund všem',
    'Pokud přesunuto → kupec si může vybrat: ponechat ticket / refund',
  ]);
}

function chapterFinance() {
  h1('12. Finance, payouts a účetnictví');

  h2('Orders dashboard');
  pathLabel('/admin/orders');
  p('Filterable list všech objednávek s OrderFilters (status, datum, ticket type, buyer email).');

  h2('Payouts');
  pathLabel('/admin/payouts');
  bullet([
    'Týdenní auto-settle (každé pondělí 7:00 cron)',
    'Fee calc: Tixly service fee (2-3 %) + GoPay/ComGate fee',
    'Holdback dle promoter tier (nový: 20 %, ověřený: 10 %, premium: 5 %, enterprise: 0 %)',
    'Rolling reserves: % každé tržby drženo 30-90 dní (chargeback protection)',
    'Export CSV per payout',
    'Manual settle pokud potřebuješ rychleji',
  ]);

  h2('Advance payout (factoring)');
  pathLabel('/admin/events/[id]/advance-payout');
  p(
    'Pokud potřebuješ peníze před akcí (např. zaplatit kapelu), můžeš požádat o advance ' +
      'payout. Tixly poskytne až 80 % očekávaných tržeb proti % fee.',
  );

  h2('Bank reconciliation');
  pathLabel('/admin/bank-transfers');
  p(
    'Pokud kupec platí bankovním převodem, Tixly automaticky páruje příchozí platby ' +
      's orders přes variabilní symbol.',
  );
  bullet([
    'Fio Open API — periodic polling každé 2 hodiny',
    'PSD2 OAuth pro KB / ČSOB / Erste — bezpečnější produkční varianta',
    'Manual reconcile UI pro edge cases',
  ]);

  h2('Faktury');
  pathLabel('/admin/invoices');
  bullet([
    'CRUD faktur',
    'PDF download',
    'ISDOC export (CZ standard pro Pohoda / Money S3 / Helios / ABRA / FlexiBee)',
    'Bulk export pro accounting',
  ]);

  h2('NIPOS Kult 1-01 (CZ kultury statistika)');
  pathLabel('/admin/reports/nipos');
  p(
    'Povinné statistické hlášení pro divadla / kina / koncerty / galerie. Tixly automaticky ' +
      'agreguje data per quarter / year a vyexportuje CSV ve formátu NIPOS.',
  );
  bullet([
    'Počet představení',
    'Počet diváků',
    'Tržby celkem + průměr na představení',
    'Z toho děti, slevy, freebies',
  ]);

  h2('Pohoda export');
  pathLabel('/admin/reports/pohoda');
  p('XML export ve formátu Pohoda accounting (Stormware). Import do firemního účetnictví.');

  h2('DPH a VAT');
  bullet([
    'DPH 10 % pro kulturní akce (CZ)',
    'DPH 12 % pro kulturní akce (SK od 2024)',
    'DPH 15 % pro sportovní akce (CZ)',
    'DPH 21 % pro standardní (festival merch, F&B)',
    'Per-event override v event settings → VAT category',
    'Reverse-charge pro B2B EU customers (DIČ check přes VIES)',
  ]);
}

function chapterReporting() {
  h1('13. Reporty a analytika');

  h2('Hlavní dashboard');
  pathLabel('/admin');
  bullet([
    '14-day revenue sparkline',
    'KPIs: total revenue, tickets sold, conversion rate',
    'Top 5 orders dnes',
    'Pending events (čekající na moderaci)',
    'Alerts (high refund rate, anomalies)',
  ]);

  h2('Real-time live dashboard');
  pathLabel('/admin/dashboard/live');
  p('SSE (server-sent events) feed — tickets sold per minute, real-time přírůstek.');

  h2('Per-event analytics');
  pathLabel('/admin/events/[id]/analytics');
  bullet([
    'Sales over time (hourly histogram)',
    'Conversion funnel: views → cart → checkout → paid',
    'Ticket type breakdown',
    'Geographic distribution',
    'Referral sources',
    'Device breakdown (mobile vs desktop)',
  ]);

  h2('Demographics');
  pathLabel('/admin/events/[id]/demographics');
  p('Věk, gender, město (pokud máš data — opt-in).');

  h2('Channel attribution');
  pathLabel('/admin/reports');
  p('Multi-touch attribution: kde lidé objevili akci, kolik kroků udělali, jak konvertovali.');

  h2('Pricing elasticity');
  pathLabel('/admin/pricemaster');
  p('Cross-event analýza: na kterých ticket types má cena největší dopad na konverzi.');

  h2('Anomaly detection');
  pathLabel('/admin/alerts');
  p('Tixly ML hodinová cron analyzuje:');
  bullet([
    'Traffic spike (10× normal)',
    'Refund rate spike (>10 %)',
    'Fraud rate spike (>5 %)',
    'Sellout přiblížení (>80 % v posledních 24h)',
    'Low velocity (event do týdne, prodáno <30 %)',
  ]);

  h2('Custom dashboards');
  pathLabel('/admin/dashboards/[key]');
  p('React-grid layout — můžeš si poskládat vlastní widget set (revenue, tickets, refunds, top events).');
}

function chapterSpecial() {
  h1('14. Speciální features');

  h2('Loterie / raffle');
  pathLabel('/admin/events/[id]/lotteries');
  p(
    'Pro extrémně oversold akce. Místo first-come-first-served se kupci registrují, ' +
      'Tixly náhodně losuje výherce.',
  );
  numberedSteps([
    'Vytvoř lotteries: open/close datum, počet výherců, prize quantity',
    'Open enrollment — fanoušci se registrují (1× per email)',
    'Po close klikni „Draw" → Tixly náhodně vybere',
    'Email s claim linkem → /cs/lottery/redeem',
    'Winner pre-fill checkout, projde dál',
  ]);

  h2('MHD Kombi-Ticket (Transit Combo)');
  pathLabel('/admin/events/[id]/transit-combo');
  p(
    'München MVV pattern — když kupec koupí vstupenku, dostane k tomu MHD jízdenku ' +
      'platnou ten den. Konkurence to v CZ nemá — massive city moat.',
  );
  bullet([
    'Vybírej partner: DPP (Praha) nebo IDOS Brno',
    'Definuj zóny: pro Prahu typicky „P, 0, B"',
    'Validity offset: hodiny před / po akci',
    'Kupec dostane separate QR pro MHD pas + e-mail/wallet',
  ]);
  warnBox(
    'Produkce vyžaduje partnership smlouvu s dopravcem (DPP / KORDIS). Bez ní funguje v mock módu.',
  );

  h2('Tickets for Good (charity)');
  pathLabel('/admin/charity/allocations');
  p(
    'Daruj unsold vstupenky charity organizaci. Tixly to zařídí — charity dostane ' +
      'distribuovatelné claim linky a ty máš tax write-off evidenci.',
  );
  numberedSteps([
    'Vyber registrované charity partner (admin schvaluje per IČO)',
    'Vyber event + quantity (1-500)',
    'Tixly vygeneruje N claim slots s unikátními tokeny',
    'Pošleš URLs charity → ona distribuuje beneficiaries',
    'Beneficiary klikne → vyplní email → free ticket',
  ]);

  h2('Hospitality / VIP packages');
  pathLabel('/admin/events/[id]/hospitality');
  p('VIP packages pro firmy: VIP box, hospitality včetně cateringu, parking pass, parking, after-party.');
  bullet([
    'Capacity per package',
    'Inquiry-based selling (žádné instant checkout)',
    'Pro Enterprise tier promotéry',
  ]);

  h2('Accreditation (press, VIP, staff)');
  pathLabel('/admin/events/[id]/accreditation');
  p('Free tickets pro media / VIP guests / staff. Žadatel vyplní formulář, ty schvaluješ.');

  h2('Click & View seat photos');
  pathLabel('/admin/events/[id]/view-photos');
  p(
    'Reservix exclusive pattern — buyer v seat mapě klikne na sedadlo a vidí fotku „odkud koukáš." ' +
      'Velký differentiator pro premium akce.',
  );
  numberedSteps([
    'Vytvoř panorama fotky z různých sektorů venue',
    'Upload nebo paste URL pro každé sedadlo (bulk mapping)',
    'Buyer v seat picker vidí ikonu „📷" — klik → modal s fotkou',
  ]);

  h2('Wallet push notifications');
  pathLabel('/admin/events/[id]/wallet-push');
  p('Po koupení má kupec lístek v Apple/Google Wallet. Můžeš mu push poslat:');
  bullet([
    'Změna sedadla',
    'Změna brány vstupu',
    'Zrušení akce',
    'Pozvánka na after-party',
  ]);
}

function chapterIntegrations() {
  h1('15. Integrace a B2B API');

  h2('Webhooks');
  pathLabel('/admin/webhooks');
  p('Outbound notifications pro tvé systémy. 26 event types:');
  bullet([
    'order.created, order.paid, order.refunded',
    'ticket.issued, ticket.transferred, ticket.scanned',
    'event.published, event.postponed, event.cancelled',
    'payout.settled, chargeback.received',
    'subscription.created, subscription.renewed, subscription.cancelled',
    'resale.listed, resale.sold',
    'a další…',
  ]);
  bullet([
    'Retry s exponential backoff (15 attempts)',
    'Delivery log s status per attempt',
    'Send-test pro debugging',
    'HMAC signature ve hlavičce X-Tixly-Signature',
  ]);

  h2('OAuth client apps');
  pathLabel('/admin/oauth-apps');
  p(
    'Vystupuješ jako OAuth provider — třetí strany se mohou připojit k tvému Tixly účtu ' +
      'pomocí OAuth 2.0 (např. tvá mobilní app, CRM, marketing tool).',
  );

  h2('B2B REST API');
  pathLabel('/admin → API keys');
  bullet([
    'Bearer token format: `tick_test_*` (sandbox) nebo `tick_live_*` (production)',
    'Scoped per resource (events, orders, tickets read/write)',
    '1-hour sliding rate limit',
    'Versioned: v1 (simple) + v3 (Eventbrite-compatible)',
  ]);
  p('Endpointy: /api/v1/events, /api/v3/events/[id]/ticket_classes, /api/v3/inventory/status, atd.');

  h2('GraphQL (read-only)');
  p('Endpoint /api/graphql — pro analytics nebo BI tools. SDL schema na /api/graphql/schema.');

  h2('Distribution feeds');
  bullet([
    'Google Things to Do JSON-LD: /api/distribution/google-feed',
    'RSS feed events: /api/v1/feed/events.rss',
    'iCal feed: /api/v1/feed/events.ics',
  ]);

  h2('Apple PassKit Web Service');
  p('Tixly implementuje plný Apple PassKit Web Service spec — wallet updates fungují automaticky.');
}

function chapterCompliance() {
  h1('16. Compliance — GDPR, DSA, PCI');

  h2('GDPR — práva subjektů');
  bullet([
    'Right to portability — buyer v /cs/profile klikne „Stáhnout moje data" → JSON export',
    'Right to erasure — buyer klikne „Smazat účet" → 30-day grace period → anonymizace',
    'Consent log podle Art. 7 — všechny souhlasy s timestamp + IP + UA',
    '90-day retention purge konsent logu (cron consent-log-purge)',
    'Reply to data access request: 30 dnů zákonný limit',
  ]);

  h2('DSA (Digital Services Act)');
  p('Tixly je platforma podle DSA. Co to znamená:');
  bullet([
    'User-reported content queue — kdokoliv může nahlásit nelegální obsah',
    'Notice & action — Tixly review 24h SLA',
    'Transparency reports — public /api/public/reports (kolik nahlášeno, removed, accepted)',
    'Statement of reasons při odstranění akce',
  ]);

  h2('PCI compliance');
  p('Tixly NEMÁ PCI scope — karty se nikdy nedostanou na Tixly servery.');
  bullet([
    'GoPay / ComGate / Stripe — hosted checkout (Tixly Connect token)',
    'PCI DSS Level 1 covered by payment providery',
    'Žádné CC numbers v Tixly DB',
  ]);

  h2('Tax compliance');
  bullet([
    'DPH per země (CZ + SR primary)',
    'EU OSS reverse-charge pro B2B EU buyery (VIES check)',
    'ISDOC + Pohoda + NIPOS Kult 1-01 (CZ)',
    'Per-event VAT category (10 / 12 / 15 / 21 %)',
  ]);

  h2('2FA pro promotér login');
  pathLabel('/admin/settings → 2FA Setup');
  p('TOTP 6-digit (Google Authenticator / Authy / 1Password).');
  warnBox(
    'Doporučujeme zapnout všem owner a admin role userům. Pokud je promoter tier „enterprise," je 2FA povinné.',
  );
}

function chapterSupport() {
  h1('17. Pomoc a podpora');

  h2('Help center');
  pathLabel('/admin/support-faq');
  p('Searchable FAQ s odpověďmi na nejčastější otázky. AI-powered RAG search.');

  h2('Live chat');
  p('In-app chat widget vpravo dole (pro Premium tier a vyšší).');

  h2('Kontakt');
  bullet([
    'E-mail: podpora@tixly.cz',
    'Tel: +420 XXX XXX XXX (pracovní dny 9-17)',
    'Slack channel pro Enterprise customers',
    'Calendar booking: cal.tixly.cz/onboarding pro 1:1 onboarding call',
  ]);

  h2('Status page');
  pathLabel('/cs/status');
  p('Real-time uptime, incident history, scheduled maintenance.');

  h2('Audit log');
  pathLabel('/admin/audit-log');
  p('Filtrovatelný log všech změn (kdo, kdy, co změnil). Užitečné při debug nebo compliance audit.');

  h2('Sledování novinek');
  bullet([
    'Changelog: /admin → bell ikona vpravo nahoře',
    'Email newsletter promotérům — měsíčně product updates',
    'Twitter: @TixlyCZ',
  ]);
}

function chapterClosing() {
  h1('Co dál?');

  p('Po dokončení tohoto průvodce bys měl být schopen:');
  bullet([
    'Vytvořit novou akci a publikovat ji',
    'Nastavit ceny, slevy, dynamic pricing',
    'Použít anti-bot ochranu pro top akce',
    'Provést kupce přes celý buyer flow',
    'Zvládnout check-in u dveří',
    'Refundy, payouts, reporty',
  ]);

  doc.moveDown(1);
  doc.fontSize(13).fillColor(BRAND_DARK).font('bold').text('Co Tixly NABÍZÍ navíc?');
  doc.fontSize(11).fillColor(TEXT).font('reg').moveDown(0.4);

  bullet([
    'Whitelabel domain — prodávej na vlastní doméně',
    'Native mobile API — pokud chceš vlastní mobilní app',
    'Custom branding — fully white-label varianta',
    'Enterprise SLA — 99.9 % uptime, dedicated support',
    'API rate limits negotiable',
    'Custom integrace — Money S3, Pohoda, Helios, ABRA, FlexiBee',
  ]);

  doc.moveDown(1);
  doc.fontSize(13).fillColor(BRAND_DARK).font('bold').text('Zpětná vazba');
  doc.fontSize(11).fillColor(TEXT).font('reg').moveDown(0.4);
  doc.text(
    'Tixly se neustále vyvíjí. Tvoje zpětná vazba je pro nás zlato. Napiš nám co ti chybí, ' +
      'co tě štve, co bys udělal jinak. Slibujeme číst všechno na produkt@tixly.cz.',
    { align: 'justify', lineGap: 3 },
  );

  doc.moveDown(2);
  doc.save();
  doc.rect(MARGIN, doc.y, CONTENT_W, 90).fillColor('#f5f3ff').fill();
  doc.restore();

  const yBox = doc.y + 14;
  doc.fontSize(14).fillColor(BRAND).font('bold').text('Děkujeme, že prodáváš na Tixly! 🎫', MARGIN, yBox, {
    align: 'center',
    width: CONTENT_W,
  });
  doc.fontSize(10).fillColor(MUTED).font('reg').text(
    'podpora@tixly.cz   •   www.tixly.cz   •   status.tixly.cz',
    MARGIN,
    yBox + 30,
    { align: 'center', width: CONTENT_W },
  );
}

// ─── Build PDF ───────────────────────────────────────────────────────────────

coverPage();
chapterOnboarding();
chapterCreateEvent();
chapterPricing();
chapterAntiBot();
chapterResale();
chapterInsurance();
chapterMarketing();
chapterSubscriptions();
chapterLoyalty();
chapterCheckIn();
chapterRefunds();
chapterFinance();
chapterReporting();
chapterSpecial();
chapterIntegrations();
chapterCompliance();
chapterSupport();
chapterClosing();

doc.end();
console.log(`✓ PDF generated: ${OUTPUT}`);
