import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/__tests__/**/*.test.ts"],
    // Reset module registry between test files so mocks don't bleed
    isolate: true,
    // Provide a minimal browser-like crypto global (Node 19+ has it natively)
    setupFiles: ["src/__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
