import { defineConfig } from '../group-tickets/node_modules/vitest/dist/config.js';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/app/**'],
    },
  },
  resolve: {
    alias: {
      '@tixly': path.resolve(__dirname, '../../shared'),
    },
  },
});
