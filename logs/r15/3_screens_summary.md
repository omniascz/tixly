# Kolo 15 — pixelové porovnání před (Next 14.2.35, f2af248a) a po (Next 15.5.27)

28 obrazovek (`e2e/tests/golden-path-r15-screens.spec.ts`), čerstvé r15demo před každou sadou, přesné porovnání bez tolerance
(`e2e/r15-compare.mjs`). Reference: build Next 14 v čistém klonu se staženými fonty (první reference byla poškozená —
při buildu selhalo stažení jednoho souboru Google Fonts, ETIMEDOUT).

1. První porovnání: 0/28 shodných — rozdíly v textu všech obrazovek.
   Příčina (CDP CSS.getPlatformFontsForNode): Next 14 vykresloval text systémovým písmem (isCustomFont false) — CSS
   aplikace má doslovně `Inter` a @font-face z next/font měl hashovaný název `__Inter_65423c`. Next 15.5 název nehashuje
   (@font-face `Inter`) → text nově webfontem (isCustomFont true) = jiný vzhled (u uživatelů bez Interu: Segoe UI / SF
   → Inter). Oprava: z layoutu odstraněn nepoužitý next/font Inter (proměnnou --font-inter nic nepoužívalo).
2. Po opravě: 25/28 shodných; zbytek 1–46 px s odchylkou ≤ 6/255 na antialiasovaných hranách (kruh avataru, zaoblené rohy).
   Determinismus: Next 14 3 běhy — 28/28, 28/28, 27/28 (13-saly 46 px, stejný typ šumu); Next 15 4 běhy — měnící se
   sada (02/07/09, 07/09, 07/09/13, 07/09 se zdržením 3 s). Stabilně jen 07-firemni (19–28 px) a 09-reporty (5–35 px).
   Ověřeno: HTML a geometrie hlavičky shodné na 3 desetinná místa, CSS po sjednocení zápisu barev významově totožné
   (rozdíl jen rgba ↔ rgb, hsla ↔ rgb, transparent/black/white) → rozdíl vzniká při rastrování v prohlížeči, ne v aplikaci.
3. Dynamický obsah: žádný (datum termínů je relativní k vytvoření demo dat; všechny sady pořízeny týž den).
