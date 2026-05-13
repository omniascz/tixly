import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    alias: {
      // Mock next/server so route files can be imported in tests
      'next/server': new URL('./src/__tests__/__mocks__/next-server.ts', import.meta.url).pathname,
    },
  },
});
