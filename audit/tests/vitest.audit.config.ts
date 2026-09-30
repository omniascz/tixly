// AUDIT testy (audit/tests/*.test.ts) — node prostředí, '@' -> nextjs-boilerplate/src.
import { defineConfig } from 'vitest/config';
import path from 'path';

const nb = path.resolve(__dirname, '../../nextjs-boilerplate');
export default defineConfig({
  root: path.resolve(__dirname, '..'),
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.join(nb, 'src') },
      { find: '@lib', replacement: path.join(nb, 'src/lib') },
    ],
  },
});
