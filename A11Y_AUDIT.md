# Tixly — A11Y audit & roadmap (WCAG 2.1 AA)

Stav k 2026-05-14. Audit identifikuje gap oproti WCAG 2.1 AA pro buyer-facing
flow. Soustředí se na pages s nejvyšším traffic: homepage, event detail,
checkout, my-tickets, scanner.

## Methodology

- WCAG 2.1 AA criteria
- Manual review klíčových pages
- axe-core / Lighthouse plánovaný v CI
- Screen reader test: NVDA (Windows), VoiceOver (macOS), TalkBack (Android)
- Keyboard-only navigation walkthrough

## Findings — kritické (P0)

### 1. Chybí Skip Links
**Issue:** Žádná „Přeskočit na obsah" link pro keyboard users.

**Fix:** Globální `<SkipLink>` komponenta v root layout.

**File:** `src/components/a11y/SkipLink.tsx` (vytvořeno).

### 2. Form labels nepropojené s inputs
**Issue:** Některé formuláře (legacy) mají label vedle inputu bez `htmlFor`/`id`.
Screen reader nečte správně.

**Status:** Hlavní (login, register, checkout) **opraveno 2026-04-29** (memory note).
Občasně staré komponenty: search, newsletter signup.

**Fix:** Audit grep všech `<label>` bez `htmlFor` a `<Input>` bez aria-label.

### 3. Color contrast — některé secondary buttons
**Issue:** `bg-muted text-muted-foreground` má kontrast ~3.5:1, AA vyžaduje 4.5:1
pro normal text.

**Fix:** Override `--muted-foreground` v dark/light mode. Použít WebAIM contrast
checker pro každou kombinaci.

### 4. Focus indicators viditelnost
**Issue:** Tailwind default `:focus` outline odebrán globálně (`outline-none`).
Některé komponenty nemají náhradní `:focus-visible:ring-*`.

**Fix:** Global CSS `*:focus-visible { outline: 2px solid var(--ring); }` pro
fallback. Audit `outline-none` bez ring substitute.

### 5. Iframe v embed widget bez title
**Issue:** Embed iframe v promotér stránkách bez `<title>` attribute.

**Status:** **Opraveno** v Tier-1 embed.js (title="Tixly vstupenky").

## Findings — vysoké (P1)

### 6. Seat picker — keyboard navigation
**Issue:** SVG seat picker plně klikací myší, ale **bez keyboard support**.
WCAG 2.1.1 (Keyboard).

**Fix:** Tab focus na seats v row order, Space/Enter = select, Arrow keys = navigate
mezi sousedními. Aria-grid pattern.

### 7. Scanner page — beep alternative
**Issue:** Beep sound při scan success, ale není visual + haptic alternative pro
deaf users.

**Fix:** Velký zelený check icon + screen flash + vibration API (mobile).

### 8. Modal / Dialog — focus trap
**Issue:** Některé modaly (refund, transfer, claim) nemají focus trap — Tab
unikne ven.

**Fix:** Použít `react-focus-lock` (zero deps) NEBO vlastní hook + restore focus
na trigger po close.

### 9. Loading states — žádný aria-live
**Issue:** „Načítání…" text se objeví bez aria-live region. Screen reader nečte.

**Fix:** Wrap loading messages do `<div aria-live="polite">`. Plus aria-busy=true
na container.

### 10. Date pickers nejsou keyboard accessible
**Issue:** Native `<input type="datetime-local">` má varying support. Custom date
pickers (pokud existují) often inaccessible.

**Fix:** Stick s native input — má best a11y on modern browsers. Custom UI jen
s full ARIA grid pattern.

## Findings — střední (P2)

### 11. Heading hierarchy občas přeskakuje úrovně
**Issue:** Některé pages mají `<h1>` followed by `<h3>` bez `<h2>`.

**Fix:** Lint pravidlo + manual review.

### 12. Decorative images mají alt text
**Issue:** Brand logo někde `alt="Tixly logo"` (informational), někde `alt=""`
(decorative). Inconsistent.

**Fix:** Define rule: dekorativní = `alt=""`, informational = krátký popisek.

### 13. Link text "Klikni zde" / "Více"
**Issue:** Některé "Více" odkazy bez kontextu — screen reader řekne jen "Více".

**Fix:** Použít aria-label="Více o akci {title}" nebo viditelný descriptive text.

### 14. Form errors — žádné aria-invalid + aria-describedby
**Issue:** Error message pod inputem visualně OK, ale screen reader nepropojuje.

**Fix:** `aria-invalid="true"` na input + `aria-describedby="error-id"`.

### 15. Skip-link pro promotér admin
**Issue:** Sidebar nav vyžaduje 10+ Tab kliků na main content.

**Fix:** Skip link "Přeskočit nav" na admin layout.

## Findings — nízké (P3)

### 16. Language attribute na html
**Status:** OK (`<html lang="cs">`), ale embed page má `lang="cs"` hardcoded.
Pro multi-locale by mělo být dynamic.

### 17. Reduced motion preference
**Issue:** Animace (progress bar countdown TOTP, hover transitions) nerespektují
`prefers-reduced-motion`.

**Fix:** `@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01s !important; } }`.

### 18. PDF lístek a11y
**Issue:** PDF generated pomocí pdfkit nemá tagging structure pro screen reader
PDF readers (NVDA, JAWS).

**Fix:** Pro produkci přidat tagged PDF generation NEBO HTML alternative.

## Plán implementace

### Sprint A11Y-1 (P0 — týden 1)
- ✓ SkipLink komponenta
- ✓ Focus visible global fallback
- ✓ Audit `outline-none` bez ring
- ✓ Color contrast fix `muted-foreground`
- Form labels audit + fix unattached

### Sprint A11Y-2 (P1 — týden 2)
- Seat picker keyboard nav
- Modal focus trap
- aria-live pro loading states
- aria-invalid pro form errors

### Sprint A11Y-3 (P2/P3 — týden 3)
- Heading hierarchy lint
- Link text descriptive audit
- Skip-link pro admin
- Reduced motion CSS
- Tagged PDF (volitelné)

## Testing strategy

### Automated
1. `axe-core` v Playwright tests (`tests/a11y/*.spec.ts`)
2. Lighthouse CI s `accessibility >= 90` jako gate
3. ESLint `eslint-plugin-jsx-a11y` v lint config

### Manual
1. **Keyboard-only walkthrough** (Tab/Shift-Tab/Enter/Space/Arrows/Esc):
   - Homepage → event → checkout → confirmation (must be fully traversable)
2. **Screen reader smoke test**:
   - NVDA Windows (free)
   - VoiceOver macOS (built-in)
   - TalkBack Android (built-in)
   - Klíčové pages: homepage, event, checkout, my-tickets
3. **Zoom test**: 200% zoom v Chrome — content musí zůstat usable
4. **High contrast mode** (Windows) — UI musí být čitelné

## Compliance status

**Cíl:** WCAG 2.1 AA do produkčního launche.

**Current estimate:** ~70 % AA criteria splněno.

**Gaps to AA:**
- Keyboard nav v seat picker (P1)
- Color contrast na ~5 místech (P0)
- ARIA labels na ~10 % komponent (P1)
- Reduced motion (P3)

**AAA criteria:** mimo scope pro start.

## Tools & resources

- **WebAIM contrast checker**: https://webaim.org/resources/contrastchecker/
- **axe DevTools**: Chrome extension
- **Lighthouse**: Chrome DevTools → Lighthouse → Accessibility
- **NVDA**: https://www.nvaccess.org/ (free Windows screen reader)
- **WCAG 2.1 quick reference**: https://www.w3.org/WAI/WCAG21/quickref/

## Sources of truth

- WCAG 2.1: https://www.w3.org/TR/WCAG21/
- Czech accessibility law: Zákon č. 99/2019 Sb. (povinnost pro veřejnou správu;
  Tixly jako private platform není přímo vázán, ale **buyer experience musí být
  inclusive** pro 8-15 % populace s disability).
