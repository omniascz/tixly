// Kolo 10: screenshot checkoutu — splátky/BNPL a benefitní karty nesmí být vidět (přepínače vypnuté).
const { chromium } = require('@playwright/test');
(async () => {
  const [url, out] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const txt = await p.locator('body').innerText();
  console.log(JSON.stringify({ twisto: /Twisto/.test(txt), skippay: /Skip Pay/.test(txt), benefit: /Benefit karty/.test(txt), splatky: /splátk/i.test(txt), gopay: /GoPay/i.test(txt) }));
  await p.screenshot({ path: out, fullPage: true });
  await b.close();
})();
