import { readFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { LandingPageError } from './landing-errors.js';

/**
 * Safely read a static HTML file from /public/landings/.
 * Path traversal protected: only allows files within the configured base dir.
 *
 * TRUST MODEL: Static HTML files are developer-controlled, source-controlled
 * assets — NOT user content. They are intentionally NOT sanitized. Never
 * expose this loader to user-supplied paths outside the configured baseDir.
 */
export async function loadStaticHtml(staticHtmlPath: string): Promise<string> {
  const baseDir = resolve(
    process.env.LANDING_STATIC_DIR ?? join(process.cwd(), 'public/landings'),
  );

  const resolved = resolve(normalize(join(baseDir, staticHtmlPath)));

  // Ensure resolved path starts with baseDir (prevent `..` traversal)
  if (resolved !== baseDir && !resolved.startsWith(baseDir + sep)) {
    throw new LandingPageError('STATIC_FILE_NOT_FOUND');
  }

  try {
    return await readFile(resolved, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') {
      throw new LandingPageError('STATIC_FILE_NOT_FOUND');
    }
    throw err;
  }
}
