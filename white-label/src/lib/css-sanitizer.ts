import { WhiteLabelError } from './plan-enforcement';

const ALLOWED_PROPERTIES = new Set([
  'color', 'background-color', 'background', 'font-size', 'font-weight',
  'font-family', 'border', 'border-radius', 'border-color', 'padding',
  'margin', 'text-align', 'letter-spacing', 'line-height', 'opacity',
  'box-shadow', 'text-decoration', 'text-transform', 'cursor',
  'width', 'max-width', 'height', 'min-height', 'display', 'gap',
]);

const MAX_CSS_BYTES = 50 * 1024; // 50KB

export function sanitizeCss(css: string): string {
  if (Buffer.byteLength(css, 'utf8') > MAX_CSS_BYTES) {
    throw new WhiteLabelError('CSS_TOO_LARGE', 'Custom CSS exceeds 50KB limit', 422);
  }

  let sanitized = css;

  // 1. Blokuj @import — nahraď celé @import pravidlo (včetně URL)
  //    Replacement comment záměrně neobsahuje '@import' aby neprojde regex testem
  sanitized = sanitized.replace(/@import\b[^;]*/gi, '/* import-blocked */');

  // 2. Blokuj javascript: uvnitř url() — musí jít před obecnou url sanitizací
  //    Zachytí: url("javascript:..."), url('javascript:...'), url(javascript:...)
  sanitized = sanitized.replace(
    /url\s*\(\s*["']?\s*javascript\s*:[^)]*["']?\s*\)/gi,
    '/* js blocked */',
  );

  // 3. Blokuj javascript: mimo url() (standalone výskyt)
  sanitized = sanitized.replace(/javascript\s*:/gi, '/* js blocked */');

  // 4. Blokuj expression()
  sanitized = sanitized.replace(/expression\s*\(/gi, '/* expression blocked */(');

  // 5. Blokuj <script> tagy
  sanitized = sanitized.replace(/<\/?script[^>]*>/gi, '');

  // 6. Blokuj behavior:
  sanitized = sanitized.replace(/behavior\s*:/gi, '/* behavior blocked */');

  // 7. Blokuj unsafe url() — povolí https:// a data:image/
  //    Strategie: najdi všechny url() a zkontroluj obsah
  sanitized = sanitized.replace(
    /url\s*\(\s*["']?([^)"']*?)["']?\s*\)/gi,
    (_match: string, urlContent: string) => {
      const trimmed = urlContent.trim();
      // Povolené: https://, http://, data:image/
      if (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) {
        return _match; // zachovej původní
      }
      return '/* unsafe url blocked */';
    },
  );

  return sanitized;
}

// Export for reference — used in tests and documentation
export { ALLOWED_PROPERTIES, MAX_CSS_BYTES };
