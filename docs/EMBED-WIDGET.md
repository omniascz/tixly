# Tixly Embed Widget

Vlož ticketing přímo na svůj web bez programování. Dva typy: jednotlivá akce,
nebo celá agenda promotéra.

## Single event

Vloží kartu konkrétní akce. Klik na "Koupit" otevře checkout na tixly.cz.

```html
<div data-tixly-event="EVENT_UUID" data-variant="card" data-theme="light"></div>
<script async src="https://app.tixly.cz/embed.js"></script>
```

**Atributy:**
- `data-tixly-event` (povinný) — UUID akce z admina (`/admin/events/[id]`)
- `data-variant` — `card` (default, plná karta s obrázkem) nebo `button` (jen CTA)
- `data-theme` — `light` (default) nebo `dark`

## Promoter agenda

Vloží list všech nadcházejících publikovaných akcí promotéra.

```html
<div data-tixly-promoter="divadlo-v-celetne" data-limit="8"></div>
<script async src="https://app.tixly.cz/embed.js"></script>
```

**Atributy:**
- `data-tixly-promoter` (povinný) — promoter slug (najdeš v `/admin/settings/brand`)
- `data-limit` — počet akcí (default 12, max 50)
- `data-theme` — `light` nebo `dark`

## Jak to funguje

- Widget vytvoří `<iframe>` ze stránky `https://app.tixly.cz/embed/...`
- iframe posílá `postMessage` event `tixly:resize` rodiči — auto-výška
- Branding (logo + barva) z `platform.promoters.brand_*` se aplikuje automaticky
- Klik na akci otevře tixly.cz v **rodičovském okně** (`target="_top"`), ne v iframe

## Bezpečnost

- iframe je sandboxed (default browser sandboxing)
- referrer policy: `no-referrer-when-downgrade`
- `meta robots noindex` — Google neindexuje embed stránku
- CSP-friendly: žádný inline JS u rodiče, jen načte `embed.js`

## Testování

1. Lokálně: nahraj HTML na disk, otevři v prohlížeči — `embed.js` z dev serveru
   (`http://localhost:3000/embed.js`) tě přesměruje na ten samý origin.
2. Prod: deploy a vlož script tag s `https://app.tixly.cz/embed.js`.

## Příklad — WordPress

V Block Editoru přidej "Custom HTML" blok s libovolným z výše uvedených snippetů.
Pro Elementor / Wix / Squarespace stejně — všechny mají "embed HTML" widget.

## Troubleshooting

- **Widget se nezobrazuje** → otevři DevTools console, hledej `Tixly`. Network
  tab: 200 na `/embed.js` a `/embed/event/...`.
- **iframe je moc nízký** → `ResizeObserver` zatím nezachytil obsah. Po dokončení
  loadu se výška doplní automaticky. Pro statickou výšku přidej `style="height:600px"`.
- **Branding chybí** → ověř, že v `/admin/settings/brand` máš nahrané logo + brand color.
- **CORS error** → nemůže, iframe je same-origin (tixly.cz uvnitř iframe i.e.
  není cross-origin fetch).
