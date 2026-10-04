import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    // `*.live.test.ts` končí na `.test.ts`, takže by je `include` výše natáhl sem —
    // ale ty soubory deklarují `// @vitest-environment node` a tenhle config jim
    // i tak aplikuje `setupFiles: ./tests/setup.ts`, které sahá na `window`
    // → ReferenceError už při collectu. Mají vlastní dráhu: vitest.live.config.ts.
    // Kolo 7: sandbox testy bran mají vlastní dráhu (vitest.sandbox.config.ts).
    exclude: ['node_modules', 'dist', '.next', 'tests/**/*.live.test.ts', 'tests/sandbox/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData.ts',
        'dist/',
        '.next/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@types': path.resolve(__dirname, './src/types'),
      '@store': path.resolve(__dirname, './src/store'),
      // Workspace packages not installed in nextjs-boilerplate/node_modules —
      // resolved to stubs so Vite can transform the route files.
      // Tests that call these modules use vi.mock() to replace them entirely.
      '@tixly/crypto': path.resolve(
        __dirname,
        './tests/stubs/tixly-crypto.ts',
      ),
      '@tixly/pdf-ticket/services/ticket-email.service.js': path.resolve(
        __dirname,
        './tests/stubs/tixly-pdf-ticket.ts',
      ),
      'gopay-payments/services/gopay-payment.service.js': path.resolve(
        __dirname,
        './tests/stubs/gopay-payment-service.ts',
      ),
      'gopay-payments/lib/service-container.js': path.resolve(
        __dirname,
        './tests/stubs/gopay-service-container.ts',
      ),
      // Stripe — workspace package not installed locally
      '../../../stripe-payments/src/services/stripe-payment.service.js': path.resolve(
        __dirname,
        './tests/stubs/stripe-payment-service.ts',
      ),
    },
  },
});
