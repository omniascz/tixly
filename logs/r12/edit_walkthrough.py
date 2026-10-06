# Kolo 12: průchod — realistický výběr míst rámečkem (jako uživatel), hlášky i z chybového pruhu, cesta pokladny přes POS.
p = 'e2e/tests/golden-path-r12-ux-walkthrough.spec.ts'
s = open(p, encoding='utf8').read()


def rep(a, b):
    global s
    assert s.count(a) == 1, (a[:80], s.count(a))
    s = s.replace(a, b)


rep("""async function msgOf(page: Page, testId: string): Promise<string> {
  const l = page.getByTestId(testId);
  await l.waitFor({ timeout: 15_000 }).catch(() => {});
  return ((await l.textContent().catch(() => '')) ?? '').trim();
}""", """/** Hláška po akci: úspěch (data-testid) nebo chybový pruh (role=alert / červený rámeček). */
async function msgOf(page: Page, testId: string): Promise<string> {
  const ok = page.getByTestId(testId);
  const bad = page.locator('[role="alert"], p.bg-rose-50, div.bg-rose-50').first();
  await Promise.race([ok.waitFor({ timeout: 15_000 }), bad.waitFor({ timeout: 15_000 })]).catch(() => {});
  if (await ok.isVisible().catch(() => false)) return ((await ok.textContent().catch(() => '')) ?? '').trim();
  if (await bad.isVisible().catch(() => false)) return `CHYBA: ${((await bad.textContent().catch(() => '')) ?? '').trim()}`;
  return '';
}
/** Výběr rámečkem v editoru plánku (tah myší přes sedadla sekce) — jako uživatel; počítá se 1 akce. */
async function marqueeSelect(page: Page, sectorPrefix: string): Promise<void> {
  await page.keyboard.press('Escape');
  const box = await page.evaluate((prefix) => {
    const rs = [...document.querySelectorAll('svg[aria-label="Seating chart editor canvas"] circle')]
      .filter((c) => (c.querySelector('title')?.textContent ?? '').startsWith(prefix)).map((c) => c.getBoundingClientRect());
    return { x0: Math.min(...rs.map((r) => r.left)), y0: Math.min(...rs.map((r) => r.top)), x1: Math.max(...rs.map((r) => r.right)), y1: Math.max(...rs.map((r) => r.bottom)) };
  }, sectorPrefix);
  await page.mouse.move(box.x0 - 6, box.y0 - 6);
  await page.mouse.down();
  await page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { steps: 4 });
  await page.mouse.move(box.x1 + 6, box.y1 + 6, { steps: 4 });
  await page.mouse.up();
}""")

rep("""    await page.keyboard.press('Control+a').catch(() => {});
    await meter.click(page.getByTestId('zone-assign-Zóna A'));""", """    // výběr všech sedadel přízemí tažením rámečku (nástroj Výběr = klávesa 1), pak přiřazení zóny
    await page.keyboard.press('1');
    await marqueeSelect(page, 'Přízemí ·');
    meter.stats[meter.stats.length - 1].clicks++;
    await meter.click(page.getByTestId('zone-assign-Zóna A'));""")

# pokladna: rezervace přes POS (výběr představení → odkaz), jinak stará cesta přes Akce
rep("""    if (await menu(page, /^Pokladna$/)) {
      const resLink = page.getByRole('link', { name: /Rezervace/ }).first();
      if (await resLink.isVisible().catch(() => false)) await meter.click(resLink);
      else {""", """    if (await menu(page, /^Pokladna$/)) {
      const posSel = page.locator('#pos-event');
      await posSel.waitFor({ timeout: 15_000 }).catch(() => {});
      const opts0 = (await posSel.locator('option').allTextContents()).filter((o) => o.includes('Racek'));
      const brno0 = opts0.find((o) => o.includes('Brno'));
      if (brno0) await pickOption(posSel, new RegExp(brno0.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')));
      const resLink = page.getByRole('link', { name: /Rezervace k vyzvednutí/ }).first();
      if (await resLink.isVisible().catch(() => false)) await meter.click(resLink);
      else {""")

rep("""      meter.note('result', `tisk: ${popup ? `nové okno ${new URL(popup.url()).pathname}` : 'window.print'}`);""",
    """      const href = await printBtn.getAttribute('href').catch(() => null);
      meter.note('result', `tisk: ${href ? `odkaz ${href.replace(/[0-9a-f-]{36}/, ':order')}` : popup ? 'nové okno' : 'window.print (bez QR)'}`);""")
open(p, 'w', encoding='utf8').write(s)
print('ok')
