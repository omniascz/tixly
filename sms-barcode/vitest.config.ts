import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // bwip-js potřebuje trochu více času pro generování obrázků
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**', 'src/services/**'],
      exclude: ['src/**/*.test.ts', 'src/adapters/**', 'src/jobs/**'],
    },
  },
});
