import { defineConfig } from '../group-tickets/node_modules/vitest/dist/config.js';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'next/server': resolve(__dirname, '../group-tickets/node_modules/next/dist/server/web/exports/index.js'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
