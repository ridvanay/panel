import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Docker runtime image'ını küçültmek için: `.next/standalone` içine yalnızca
  // gerçekten kullanılan node_modules bağımlılıkları dahil edilir (bkz. Dockerfile).
  output: "standalone",
};

// `withSentryConfig` — build-time Webpack eklentisi (kaynak haritası/source map yükleme,
// otomatik hata sınırı enstrümantasyonu vb.) ekler. `SENTRY_AUTH_TOKEN` tanımsızsa (varsayılan,
// bkz. .env.local.example) source map yükleme adımı sessizce atlanır (`silent: true`) — CI/lokal
// build'ler SENTRY_AUTH_TOKEN OLMADAN da sorunsuz çalışır, sadece Sentry'deki stack trace'ler
// minify edilmiş/okunaksız kalır (isteğe bağlı iyileştirme, zorunlu değil).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  // `output: "standalone"` ile bilinen bir uyumluluk notu: Sentry'nin sunucu bileşenlerini
  // otomatik enstrümante etmesi standalone build'i etkilemez, bu ayar sadece source map
  // yükleme adımının çıktı dizinini doğru bulmasını sağlar.
  widenClientFileUpload: true,
});
