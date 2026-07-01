/**
 * Klientské (browser-only) převody plánu sálu na obrázek.
 *
 * - pdfFirstPageToPngDataUrl: vyrenderuje 1. stránku PDF na PNG data URL (plné rozlišení)
 *   pro co nejpřesnější čtení přes Vision import.
 * - fileToUnderlayDataUrl: připraví zmenšený JPEG data URL (image i PDF) jako podklad
 *   k ručnímu obkreslení ve vizuálním editoru — drží velikost rozumně malou pro uložení.
 *
 * pdfjs-dist se načítá dynamicky až při volání → žádné vyhodnocení při SSR.
 */

/** Vyrenderuje 1. stránku PDF na PNG data URL. maxDim omezuje delší stranu (px). */
export async function pdfFirstPageToPngDataUrl(file: File, maxDim = 2200): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  // Worker přes bundlovanou URL (webpack/Next emit jako asset).
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(maxDim / base.width, maxDim / base.height);
    const viewport = page.getViewport({ scale: Math.max(scale, 1) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D kontext není dostupný.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally {
    void doc.destroy();
  }
}

/** Načte obrázkový soubor do HTMLImageElement. */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Nepodařilo se načíst obrázek.'));
    img.src = dataUrl;
  });
}

/** Zmenší data URL na JPEG s delší stranou ≤ maxDim (px), na bílém pozadí. */
async function downscaleToJpeg(dataUrl: string, maxDim: number, quality: number): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D kontext není dostupný.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** Přečte soubor (image/*) na data URL. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Nepodařilo se načíst soubor.'));
    fr.readAsDataURL(file);
  });
}

/**
 * Připraví podkladový obrázek (image nebo PDF) jako zmenšený JPEG data URL k obkreslení.
 * Výsledek je typicky < 500 kB, aby šel bez problémů uložit s layoutem.
 */
export async function fileToUnderlayDataUrl(file: File, maxDim = 1600, quality = 0.82): Promise<string> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const src = isPdf ? await pdfFirstPageToPngDataUrl(file, maxDim) : await fileToDataUrl(file);
  return downscaleToJpeg(src, maxDim, quality);
}
