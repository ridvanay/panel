import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright (qa-agent E2E) — generated report/trace artifacts, gitignored (see
    // .gitignore) but not excluded from lint by default: bundled/minified vendor JS in
    // here (e.g. playwright-report/trace/*.js) produces thousands of false-positive
    // findings (react-hooks/rules-of-hooks etc. against minified code) whenever e2e
    // tests have been run locally.
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
