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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
