/**
 * Sandbox testy platebních bran (kolo 7) — tests/sandbox/*.sandbox.test.ts, viz tests/sandbox/README.md.
 * Proti skutečnému sandboxu brány; bez sandbox klíčů se přeskočí. Krok zaplacení dělá člověk → dlouhé timeouty.
 */
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/sandbox/**/*.sandbox.test.ts'],
    exclude: ['node_modules', 'dist', '.next'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
