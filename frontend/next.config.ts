import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * `next/image` `remotePatterns` — `.claude/architect-scope-products-catalog.md` §6.1 (frontend-agent'a
 * DAR yetkilendirme, yalnızca bu anahtar). Medya URL'leri ortama göre değişir (yerel sürücüde
 * `PUBLIC_URL`, S3/CDN'de tamamen farklı bir host) — sabit bir host YAZILMAZ, iki çalışma zamanı
 * değişkeninden (`NEXT_PUBLIC_API_URL` her zaman tanımlı, opsiyonel `NEXT_PUBLIC_MEDIA_URL`)
 * türetilir. `src/lib/image-hosts.ts::isOptimizableImageUrl` AYNI iki anahtara bakar — component'ler
 * next/image kullanmadan önce görselin host'unun bu listede olup olmadığını AYRICA doğrular
 * (`remotePatterns` dışı bir host'a `next/image` verilirse ÇALIŞMA ZAMANINDA hata fırlatır);
 * çözümlenemeyen bir URL burada sessizce ATLANIR (build KIRILMAZ, o host için `<img>`'e düşülür).
 */
function buildImageRemotePatterns(): NonNullable<NextConfig["images"]>["remotePatterns"] {
  const patterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [];
  const seenHosts = new Set<string>();
  for (const raw of [process.env.NEXT_PUBLIC_API_URL, process.env.NEXT_PUBLIC_MEDIA_URL]) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (seenHosts.has(url.hostname)) continue;
      // GÜVENLİK DEĞİŞMEZİ (security-agent) — aşağıdaki `dangerouslyAllowLocalIP: true` bayrağı
      // yalnızca bu allowlist'in DAİMA (a) sabit kod/wildcard DEĞİL, güvenilir sunucu env'inden
      // türetildiği ve (b) hiçbir zaman `*`/boş hostname İÇERMEDİĞİ sürece güvenlidir. Bu iki
      // koşuldan biri bozulursa (ör. ileride kullanıcı girdisinden/DB'den host eklenmesi veya
      // wildcard hostname), `dangerouslyAllowLocalIP` ÖNCE KALDIRILMALIDIR — aksi halde bu bir
      // açık SSRF proxy'sine dönüşür. Bu assert o driftı build-time'da yakalar.
      if (!url.hostname || url.hostname.includes("*")) {
        throw new Error(
          `next.config.ts: image remotePatterns hostname geçersiz ("${url.hostname}"). ` +
            `dangerouslyAllowLocalIP AÇIKKEN wildcard/boş hostname'e izin verilmez (SSRF riski).`
        );
      }
      seenHosts.add(url.hostname);
      patterns.push({
        protocol: url.protocol.replace(":", "") as "http" | "https",
        hostname: url.hostname,
        port: url.port || "",
        pathname: "/**",
      });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("next.config.ts:")) throw err;
      // Çözümlenemeyen URL — bu host'u ATLA (build KIRILMAZ).
    }
  }
  return patterns;
}

const nextConfig: NextConfig = {
  // Docker runtime image'ını küçültmek için: `.next/standalone` içine yalnızca
  // gerçekten kullanılan node_modules bağımlılıkları dahil edilir (bkz. Dockerfile).
  output: "standalone",
  images: {
    remotePatterns: buildImageRemotePatterns(),
    // `docker-compose.yml`'de `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1` — bu projenin
    // KENDİ self-hosted dağıtım deseni, tarayıcıya giden medya URL'lerinin host'u `localhost`
    // olabiliyor (backend AYNI makinede). next/image'in SSRF korumasi private/loopback IP'lere
    // giden optimizasyon isteklerini VARSAYILAN olarak reddeder (`"upstream image ... resolved
    // to private ip"`) — `remotePatterns` zaten host'u YALNIZCA `NEXT_PUBLIC_API_URL`/
    // `NEXT_PUBLIC_MEDIA_URL` ile SINIRLADIĞI için (rastgele bir host DEĞİL, mağaza sahibinin
    // KENDİ backend'i), bu bayrak o daraltılmış kümede güvenlidir. Gerçek bir uzak host
    // (S3/CDN/genel domain) kullanan kurulumlarda bu bayrağın hiçbir etkisi YOKTUR (yalnızca
    // çözümlenen IP private/loopback OLDUĞUNDA devreye girer).
    dangerouslyAllowLocalIP: true,
  },
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
