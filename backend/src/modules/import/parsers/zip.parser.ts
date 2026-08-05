import path from "node:path";
import yauzl from "yauzl";
import { ValidationError } from "../../../lib/errors";
import { detectImageMimeType } from "../../../lib/mime-detect";
import { ZIP_BOMB_LIMITS } from "../import.constants";

export interface ZipMediaEntry {
  /** Arşiv içindeki tam giriş adı — DİSKE YAZARKEN ASLA kullanılmaz (bkz. lib/storage — kendi UUID adımız). */
  name: string;
  buffer: Buffer;
  sizeBytes: number;
  /** Magic bytes'tan türetilir; tanınmıyorsa `null` → `UNSUPPORTED_MIME`. */
  mimeType: string | null;
  isSvg: boolean;
  /** `..`/mutlak yol/sürücü harfi içeren güvensiz giriş adı — içerik OKUNMAZ, satır hatası olarak raporlanır. */
  pathUnsafe: boolean;
}

export interface ZipParseResult {
  entries: ZipMediaEntry[];
}

// `detectImageMimeType` `../../../lib/mime-detect`'e taşındı — `media.routes.ts` (tekil yükleme)
// ile AYNI kod yolunu paylaşır, burada kopyası TUTULMAZ.

function isUnsafeEntryName(name: string): boolean {
  return name.includes("..") || path.isAbsolute(name) || /^[a-zA-Z]:/.test(name);
}

/**
 * §10.8.7 MEDIA (ZIP) — `yauzl` merkezi dizini okur, girişleri STREAMING açar (bkz.
 * ARCHITECTURE.md §10.8.3). Zip bombası limitleri (`ZIP_BOMB_LIMITS`) merkezi dizin
 * METADATA'sından (`entry.uncompressedSize`/`compressedSize`) kontrol edilir — ihlal eden bir
 * girişin içeriği HİÇ decompress edilmeden tüm arşiv reddedilir (herhangi biri ihlal → 422,
 * iş oluşturulmaz). Zip-slip: güvensiz adlı girişler içerik OKUNMADAN satır hatası olarak
 * işaretlenir, arşivin geri kalanı işlenmeye devam eder. Dizin girişleri, `__MACOSX/` ve
 * nokta ile başlayan dosyalar SESSİZCE atlanır (entries listesine hiç girmez).
 */
export function parseMediaZip(buffer: Buffer): Promise<ZipParseResult> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(new ValidationError("ZIP arşivi açılamadı veya bozuk.", { file: [err?.message ?? "Bilinmeyen hata."] }));
        return;
      }

      const entries: ZipMediaEntry[] = [];
      let entryCount = 0;
      let totalUncompressed = 0;
      let settled = false;

      function abort(message: string) {
        if (settled) return;
        settled = true;
        zipfile.close();
        reject(new ValidationError(message, { file: [message] }));
      }

      zipfile.on("error", (zErr: Error) => {
        if (settled) return;
        settled = true;
        // `yauzl` her girişin merkezi dizin adını KENDİSİ doğrular (bkz. node_modules/yauzl/
        // index.js::validateFileName) ve `..`/mutlak yol/sürücü harfi içeren TEK BİR giriş
        // bulsa bile TÜM arşivi bu event ile reddeder (tek tek girişleri atlamaz) — bu yüzden
        // zip-slip koruması pratikte "arşivin tamamı reddedilir" olarak gerçekleşir; aşağıdaki
        // `isUnsafeEntryName` kontrolü (per-entry) `yauzl` sürümü/davranışı değişirse diye
        // bırakılan ek bir savunma katmanıdır.
        const isPathSafetyError = /absolute path|invalid relative path|invalid characters in fileName/i.test(zErr.message);
        reject(
          new ValidationError(
            isPathSafetyError ? "ZIP arşivi güvensiz bir dosya yolu içeriyor (zip-slip şüphesi)." : "ZIP arşivi okunurken hata oluştu.",
            { file: [zErr.message] }
          )
        );
      });

      zipfile.on("entry", (entry: yauzl.Entry) => {
        if (settled) return;

        entryCount += 1;
        if (entryCount > ZIP_BOMB_LIMITS.maxEntries) {
          abort(`ZIP arşivi en fazla ${ZIP_BOMB_LIMITS.maxEntries} giriş içerebilir (zip bombası şüphesi).`);
          return;
        }

        const name = entry.fileName;
        const isDirectory = /\/$/.test(name);
        const baseName = name.split("/").pop() ?? name;
        const isMacosx = name.startsWith("__MACOSX/");
        const isDotfile = baseName.startsWith(".");

        if (isDirectory || isMacosx || isDotfile) {
          zipfile.readEntry();
          return;
        }

        if (isUnsafeEntryName(name)) {
          entries.push({ name, buffer: Buffer.alloc(0), sizeBytes: 0, mimeType: null, isSvg: false, pathUnsafe: true });
          zipfile.readEntry();
          return;
        }

        if (entry.uncompressedSize > ZIP_BOMB_LIMITS.maxSingleEntryBytes) {
          abort(`"${name}" açıldığında ${ZIP_BOMB_LIMITS.maxSingleEntryBytes} bayt sınırını aşıyor (zip bombası şüphesi).`);
          return;
        }
        const ratio = entry.compressedSize > 0 ? entry.uncompressedSize / entry.compressedSize : 1;
        if (ratio > ZIP_BOMB_LIMITS.maxCompressionRatio) {
          abort(`"${name}" sıkıştırma oranı güvenlik sınırını aşıyor (zip bombası şüphesi).`);
          return;
        }
        totalUncompressed += entry.uncompressedSize;
        if (totalUncompressed > ZIP_BOMB_LIMITS.maxTotalUncompressedBytes) {
          abort(`ZIP arşivinin toplam açılmış boyutu ${ZIP_BOMB_LIMITS.maxTotalUncompressedBytes} bayt sınırını aşıyor (zip bombası şüphesi).`);
          return;
        }

        zipfile.openReadStream(entry, (openErr, stream) => {
          if (settled) return;
          if (openErr || !stream) {
            abort(`"${name}" açılamadı.`);
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            if (settled) return;
            const content = Buffer.concat(chunks);
            const detected = detectImageMimeType(content);
            entries.push({
              name,
              buffer: content,
              sizeBytes: content.byteLength,
              mimeType: detected.mimeType,
              isSvg: detected.isSvg,
              pathUnsafe: false,
            });
            zipfile.readEntry();
          });
          stream.on("error", () => abort(`"${name}" okunurken hata oluştu.`));
        });
      });

      zipfile.on("end", () => {
        if (!settled) {
          settled = true;
          resolve({ entries });
        }
      });

      zipfile.readEntry();
    });
  });
}
