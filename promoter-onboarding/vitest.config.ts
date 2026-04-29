import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/__mocks__/**', 'src/app/**'],
    },
  },
  resolve: {
    alias: {
      '@tixly/jwt-auth': new URL('./src/__mocks__/jwt-auth.ts', import.meta.url).pathname,
    },
  },
});
