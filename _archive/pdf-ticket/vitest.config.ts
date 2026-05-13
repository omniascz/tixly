import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // pdf-lib + qrcode + bwip-js generování potřebuje více času
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**', 'src/services/**'],
      exclude: ['src/**/*.test.ts', 'src/adapters/**'],
    },
  },
});
