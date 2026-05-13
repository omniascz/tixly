import { defineConfig } from '../group-tickets/node_modules/vitest/dist/config.js';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
