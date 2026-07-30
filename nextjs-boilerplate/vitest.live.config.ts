/**
 * Samostatná dráha pro RUNTIME testy proti reálné databázi (`*.live.test.ts`).
 *
 * Proč vlastní config: hlavní `vitest.config.ts` běží v jsdom a natahuje
 * `tests/setup.ts` (jest-dom, React cleanup, `window` mocky) — v node prostředí
 * to spadne na `window is not defined` a pro DB testy je to stejně k ničemu.
 *
 * Tyhle testy se bez `NEON_API_KEY` samy přeskočí (`describe.skipIf`), takže je
 * bezpečné je pouštět i tam, kde klíč není.
 *
 * Spuštění:
 *   NEON_API_KEY=... npx vitest run --config vitest.live.config.ts
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.live.test.ts'],
    exclude: ['node_modules', 'dist', '.next'],
    // Ephemeral větev se zakládá a maže per soubor — sekvenčně, ať se
    // souběžné soubory nervou o stejný Neon projekt.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@lib': path.resolve(__dirname, './src/lib'),
    },
  },
});
