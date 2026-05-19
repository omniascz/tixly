/**
 * X.509 PDF signing (PAdES / CAdES) — graceful integration.
 *
 * Real digitální podpis pro PDF vstupenky vyžaduje:
 *   1. `npm install @signpdf/signpdf @signpdf/signer-p12` (nebo node-signpdf)
 *   2. PKCS#12 (.p12 / .pfx) keystore s X.509 certifikátem
 *   3. Env: PDF_SIGNING_P12_BASE64 + PDF_SIGNING_P12_PASSWORD
 *
 * Implementace následuje PAdES Baseline-B (PKCS#7 detached signature embedded
 * v PDF /Sig dictionary). Adobe Reader zobrazí jako platný digitální podpis,
 * který lze ověřit oproti certifikačnímu řetězci.
 *
 * Bez signpdf package nebo bez env config → vrací original PDF bez podpisu.
 * Nezpůsobuje failure orderu — promotér si může přidat signing později.
 *
 * Pro produkci doporučeno:
 *   - Qualified certificate (kvalifikovaný certifikát) z PostSignum / I.CA / eIdentity
 *   - Long-term validation (LTV) attach po podpisu (CRL + OCSP responses)
 *
 * Akademické info:
 *   - PAdES = PDF Advanced Electronic Signatures (EN 319 142)
 *   - eIDAS regulation umožňuje legal-binding signature v EU
 */

interface SignedResult {
  buffer: Buffer;
  signed: boolean;
  reason?: string;
}

interface SignPdfModule {
  default: {
    sign: (pdfBuffer: Buffer, p12Buffer: Buffer, options?: { passphrase?: string }) => Buffer;
  };
}

/**
 * Pokud `signpdf` package a env certifikát existují, podepíše PDF.
 * Jinak vrací original bez podpisu.
 *
 * PDF buffer musí mít připravený /ByteRange placeholder (provede signpdf v init kroku).
 */
export async function signPdfIfConfigured(pdfBuffer: Buffer): Promise<SignedResult> {
  const p12B64 = process.env.PDF_SIGNING_P12_BASE64;
  const p12Password = process.env.PDF_SIGNING_P12_PASSWORD;

  if (!p12B64) {
    return { buffer: pdfBuffer, signed: false, reason: 'no_certificate_env' };
  }

  let signpdf: SignPdfModule | null = null;
  try {
    // Dynamic import skrytý před webpack module resolution — package je optional.
    const moduleName = 'node-signpdf';
    signpdf = (await import(/* webpackIgnore: true */ moduleName)) as SignPdfModule;
  } catch {
    return { buffer: pdfBuffer, signed: false, reason: 'signpdf_package_missing' };
  }

  try {
    const p12Buffer = Buffer.from(p12B64, 'base64');
    const signed = signpdf.default.sign(pdfBuffer, p12Buffer, {
      passphrase: p12Password,
    });
    return { buffer: signed, signed: true };
  } catch (err) {
    console.error('[pdf-sign] signing failed:', err);
    return {
      buffer: pdfBuffer,
      signed: false,
      reason: err instanceof Error ? err.message : 'unknown',
    };
  }
}
