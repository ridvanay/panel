/**
 * copy-static-assets.js — `src/` altındaki statik görsel varlıkları `dist/`e kopyalar.
 *
 * NEDEN: `tsc` yalnızca `.ts` dosyalarını derler; `src/**` altına commit edilmiş PNG/JPG/vb.
 * varlıklar (örn. `src/modules/demo-templates/assets/modern-architecture/*.png`) derleme
 * çıktısına dahil edilmez. Çalışma zamanı kodu (örn. `lib/assets.ts::templateAssetsDir()`)
 * `__dirname` (derlenmiş `dist/` konumu) üzerinden bu dosyaları arar — bu yüzden `dist/`
 * altında da aynı göreli yapının mevcut olması ZORUNLUDUR.
 *
 * Düz Node.js (CommonJS), YENİ bağımlılık YOK — yalnızca yerleşik `fs`/`path` modülleri.
 * Genel tutulmuştur: yalnızca demo-templates'e özel değil, `src/` altında herhangi bir
 * modül görsel uzantılı statik dosya eklerse otomatik olarak `dist/`e kopyalanır.
 *
 * ÇALIŞTIRMA: `npm run build` script'inin bir parçası olarak `tsc` derlemesinden SONRA
 * otomatik çalışır (bkz. package.json "build" script'i). Elle de çalıştırılabilir:
 *   node scripts/copy-static-assets.js
 */

const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "src");
const DIST_DIR = path.join(__dirname, "..", "dist");

const STATIC_ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** @param {string} dir */
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(srcPath);
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!STATIC_ASSET_EXTENSIONS.has(ext)) continue;

    const relativePath = path.relative(SRC_DIR, srcPath);
    const destPath = path.join(DIST_DIR, relativePath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    copiedCount += 1;
    console.log(`✓ ${relativePath}`);
  }
}

let copiedCount = 0;

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    throw new Error(`copy-static-assets: src dizini bulunamadı: ${SRC_DIR}`);
  }
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error(
      `copy-static-assets: dist dizini bulunamadı (${DIST_DIR}) — önce "tsc" derlemesi çalışmalı.`
    );
  }

  walk(SRC_DIR);
  console.log(`copy-static-assets: ${copiedCount} statik varlık dist/'e kopyalandı.`);
}

main();
