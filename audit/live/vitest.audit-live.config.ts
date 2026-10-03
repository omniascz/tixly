/**
 * AUDIT: spouští existující live sadu (nextjs-boilerplate/tests/*.live.test.ts)
 * proti izolované DB z migrací místo klonu produkce.
 * Jediný rozdíl proti vitest.live.config.ts: alias './helpers/live-fixture' -> audit fixture.
 * Spouštět z nextjs-boilerplate/:  npx vitest run --config ../audit/live/vitest.audit-live.config.ts
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

const nb = process.env.AUDIT_NB_ROOT ?? path.resolve(__dirname, '../../nextjs-boilerplate');

export default defineConfig({
  root: nb,
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.live.test.ts'],
    exclude: ['node_modules', 'dist', '.next'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: [
      { find: /^\.\/helpers\/live-fixture$/, replacement: path.resolve(__dirname, 'live-fixture.audit.ts') },
      { find: '@', replacement: path.join(nb, 'src') },
      { find: '@lib', replacement: path.join(nb, 'src/lib') },
    ],
  },
});
