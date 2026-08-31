// backend için minimal ESLint flat config — CI'da bir "lint" adımı çalıştırabilmek amacıyla
// devops-agent tarafından eklendi (backend'de daha önce hiç lint kurulumu yoktu).
// Kural seti kasıtlı olarak gevşek tutuldu: tip güvenliğini denetleyen ağır
// (type-checked) kurallar yerine sadece `recommended` seviyesi kullanıldı ki mevcut
// kod tabanını yeniden yazmaya zorlamasın. Kural setinin sıkılaştırılması/stil
// tercihleri code-quality-agent'ın sorumluluğundadır — bu dosya sadece bir başlangıç noktasıdır.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "prisma/migrations/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Fastify handler'larında kullanılmayan `_request`/`_reply` gibi parametreler yaygın.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // `scripts/**/*.js` — build-time/CI yardımcı script'leri, düz Node.js CommonJS
    // (bkz. scripts/copy-static-assets.js). TS derleme kapsamı dışında oldukları için
    // `require`/`__dirname`/`console` gibi Node globalleri burada açıkça tanımlanmalı.
    files: ["scripts/**/*.js"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // `package.json`'daki `"type": "commonjs"` gereği bu script'ler `require()` kullanır
      // (ESM `import` değil) — bu kural yalnızca TS/ESM kaynak koduna yöneliktir.
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
