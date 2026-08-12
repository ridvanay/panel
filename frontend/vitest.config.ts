import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // @testing-library/react'in test'ler arası otomatik DOM temizliği (cleanup) globalThis.afterEach'i
    // arar — bu olmadan önceki render'lar bir sonraki teste sızar (bkz. tests/unit/badge.test.tsx).
    globals: true,
    // `tests/e2e/**` Playwright testleridir (`npm run test:e2e`) — vitest'in varsayılan `*.spec.ts`
    // deseni bunları da eşleştirip `test.describe`/`test.beforeAll` çağrılarında (Playwright'a özgü
    // API'ler) çökmesine yol açıyordu; qa-agent'ın e2e paketi eklenince ortaya çıkan bir boşluk.
    exclude: ["**/node_modules/**", "tests/e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
