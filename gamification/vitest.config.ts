import { defineConfig } from '../group-tickets/node_modules/vitest/dist/config.js';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/**/*.test.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@tixly/rls-multitenancy': path.resolve(__dirname, '../rls-multitenancy/src/index.ts'),
    },
  },
});
