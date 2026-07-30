import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup/env.ts"],
    globalSetup: ["./tests/setup/global-setup.ts"],
    hookTimeout: 30000,
    testTimeout: 15000,
    fileParallelism: false,
  },
});
