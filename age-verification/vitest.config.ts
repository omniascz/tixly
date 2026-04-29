import { defineConfig } from '../group-tickets/node_modules/vitest/dist/config.js';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
