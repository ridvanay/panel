/**
 * Tek seferlik veri operasyonu (KOD DEĞİŞİKLİĞİ DEĞİL) — 2026-09-19 kullanıcı talebi: canlı ortamda
 * (wmhealthistanbul.com) doktor avatarları/arka plan görselleri hâlâ `http://localhost:4000/...`
 * olarak basılıyor. Kök neden `mappers/index.ts::absolutizeMediaUrl`in DÜZELTEMEYECEĞİ bir sınıf:
 * o fonksiyon yalnızca İLİŞKİSEL `Media.url` referanslarını READ-TIME mutlaklaştırır (ve `Media.url`
 * DB'de HER ZAMAN göreceli saklanır — `lib/storage/local.storage.ts::LocalStorage.save` doğrulandı).
 * Burada sorun TERSİ: admin panelinin MediaPicker'ı (görsel SEÇİLDİĞİ ANDAKİ `PUBLIC_URL`ye göre
 * mutlaklaştırılmış bir URL döner) bazı İÇERİK alanlarına (blog/ürün/portföy/sayfa builder
 * blokları/doktor biyografisi/e-posta şablonu vb.) bu MUTLAK URL'yi DOĞRUDAN, DONMUŞ metin olarak
 * yazar — `PUBLIC_URL` sunucuda SONRADAN düzeltilse bile bu satırlar KENDİLİĞİNDEN düzelmez (hiçbir
 * read-time dönüşüm zaten-mutlak bir string'e dokunmaz, `absolutizeMediaUrl`in `/^https?:\/\//`
 * kısa-devresi tam olarak bunu atlar).
 *
 * `env.ts::isLoopbackHostname` İLE AYNI üç host sınıfı hedeflenir (çıplak `localhost`/`127.0.0.1`
 * VE RFC 6761 `*.localhost` alt-alan-adları — bu reponun KENDİ `.env.example` dev placeholder'ı
 * `siteadi.localhost` deseniyle DOLU, bu yüzden ikinci sınıf ÖZELLİKLE olası). Eşleşen host+port
 * ÖNEKİ SİLİNİR (boş string ile REPLACE) — mutlak URL'yi kök-göreceli bir yola (`/uploads/...`)
 * çevirir, sabit bir domain'e DEĞİL: tarayıcı kök-göreceli bir yolu HER ZAMAN mevcut sayfa
 * origin'ine göre çözer (`Media.url`'in KENDİSİYLE AYNI, zaten var olan kalıp) — bu yüzden site
 * domain'i ilerde değişse bile script'in TEKRAR çalıştırılmasına GEREK KALMAZ; aksine sabit bir
 * `https://wmhealthistanbul.com` gömmek YENİ bir "donmuş URL" riski YARATIRDI (`PUBLIC_URL`
 * mantığıyla AYNI, kasıtlı olarak KAÇINILAN hata — bkz. `config/env.ts` başındaki qa-agent notu).
 *
 * GÜVENLİK: YALNIZCA aşağıdaki sabit (tablo, kolon) beyaz listesinde çalışır — hiçbir dinamik/
 * kullanıcıdan gelen tablo/kolon adı KULLANILMAZ (SQL injection riski YOKTUR, sabitler koda
 * GÖMÜLÜDÜR); yalnızca `~* $1` (regex parametre) kullanıcı girdisi İÇERMEYEN sabit bir desendir.
 * Varsayılan mod SAYAR, YAZMAZ (`--apply` AÇIKÇA verilmeden hiçbir UPDATE çalışmaz).
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/fix-hardcoded-localhost-media-urls.ts              (dry-run — yalnızca sayar)
 *   npx tsx scripts/fix-hardcoded-localhost-media-urls.ts --apply      (gerçekten düzeltir)
 */

import { PrismaClient } from "@prisma/client";
import { LOOPBACK_URL_PREFIX_PATTERN } from "../src/lib/sanitize-localhost-urls";

const prisma = new PrismaClient();

// `lib/sanitize-localhost-urls.ts::LOOPBACK_URL_PREFIX_PATTERN` İLE AYNI kaynak (runtime `onSend`
// savunma katmanıyla, `plugins/sanitize-localhost-media-urls.ts`, SAPMASIN diye) — SQL `~*`/
// `regexp_replace` PCRE benzeri sözdizimi beklediği için `.source`'u (JS bayraklarını ATARAK) alır.
const BAD_HOST_PATTERN = LOOPBACK_URL_PREFIX_PATTERN.source;

interface Target {
  table: string;
  column: string;
  isJson: boolean;
}

/**
 * Kapsam gerekçesi — `Doctor, Media, CMS/LandingPage tabloları ve JSON alanları` (kullanıcı talebi):
 * şema taranarak (`prisma/schema.prisma`) medya/görsel URL'si TAŞIYABİLECEK HER `String`/`Json`
 * kolonu (rich-text `*Html`, `*ImageUrl`/`logoUrl`, sayfa builder `blocks`, lokalize `translations`,
 * slider `layers`, doktor `bio`/`aboutHtml`/`cvEntries`/`publications`, e-posta şablonu `bodyHtml`/
 * `blocks`) dahil edildi. `Media.url` da BİLİNÇLİ OLARAK listede — beklenen sonuç NO-OP (defansif
 * tamlık, dosya başı yorumundaki "her zaman göreceli" iddiasını bu script'in KENDİSİ de doğrular).
 */
const TARGETS: Target[] = [
  { table: "media", column: "url", isJson: false },
  { table: "pages", column: "blocks", isJson: true },
  { table: "pages", column: "translations", isJson: true },
  { table: "pages", column: "ogImageUrl", isJson: false },
  { table: "blog_posts", column: "contentHtml", isJson: false },
  { table: "blog_posts", column: "coverImageUrl", isJson: false },
  { table: "blog_posts", column: "ogImageUrl", isJson: false },
  { table: "blog_posts", column: "translations", isJson: true },
  { table: "products", column: "descriptionHtml", isJson: false },
  { table: "products", column: "ogImageUrl", isJson: false },
  { table: "products", column: "translations", isJson: true },
  { table: "portfolio_items", column: "contentHtml", isJson: false },
  { table: "portfolio_items", column: "ogImageUrl", isJson: false },
  { table: "portfolio_items", column: "translations", isJson: true },
  { table: "doctor_profiles", column: "bio", isJson: false },
  { table: "doctor_profiles", column: "aboutHtml", isJson: false },
  { table: "doctor_profiles", column: "cvEntries", isJson: true },
  { table: "doctor_profiles", column: "publications", isJson: true },
  { table: "slides", column: "layers", isJson: true },
  { table: "site_settings", column: "logoUrl", isJson: false },
  { table: "email_templates", column: "bodyHtml", isJson: false },
  { table: "email_templates", column: "blocks", isJson: true },
];

function parseArgs(argv: string[]) {
  return { apply: argv.includes("--apply") };
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  console.log(`[fix-hardcoded-localhost-media-urls] mod=${apply ? "APPLY (yazılacak)" : "DRY-RUN (yalnızca sayılacak)"}`);

  let totalAffected = 0;
  for (const { table, column, isJson } of TARGETS) {
    const textExpr = isJson ? `"${column}"::text` : `"${column}"`;
    const countRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "${table}" WHERE ${textExpr} ~* $1`,
      BAD_HOST_PATTERN
    );
    const affected = Number(countRows[0]?.count ?? 0);
    if (affected === 0) continue;
    totalAffected += affected;
    console.log(`[bulundu] "${table}"."${column}" — ${affected} satır kötü host (localhost/127.0.0.1/*.localhost) içeriyor.`);

    if (!apply) continue;

    const setExpr = isJson
      ? `regexp_replace("${column}"::text, $1, '', 'gi')::jsonb`
      : `regexp_replace("${column}", $1, '', 'gi')`;
    const updated = await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "${column}" = ${setExpr} WHERE ${textExpr} ~* $1`, BAD_HOST_PATTERN);
    console.log(`[düzeltildi] "${table}"."${column}" — ${updated} satır güncellendi (mutlak URL → kök-göreceli yol).`);
  }

  if (totalAffected === 0) {
    console.log("[ok] Taranan hiçbir kolonda kötü host'lu (localhost/127.0.0.1/*.localhost) URL bulunamadı.");
  } else if (!apply) {
    console.log(`[dry-run] Toplam ${totalAffected} satır etkilenecekti — gerçekten düzeltmek için --apply ile tekrar çalıştırın.`);
  } else {
    console.log(`[bitti] Toplam ${totalAffected} satır düzeltildi.`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
