import path from "node:path";
import fs from "node:fs/promises";
import { imageSize } from "image-size";
import { storage } from "../../../lib/storage";
import { detectImageMimeType } from "../../../lib/mime-detect";
import { ValidationError } from "../../../lib/errors";
import { MAX_TEMPLATE_ASSET_BYTES, type DemoTemplateAsset } from "../types";

/**
 * §4.2 — paketlenmiş şablon varlıklarını GERÇEK `Media` satırına dönüştürmenin İLK yarısı
 * (materyalizasyon; `Media.create` çağrısı BİLEREK BURADA DEĞİL — bkz. `importer.ts` Faz 2).
 *
 * `assets/<templateKey>/*.png` altındaki dosyalar `fs.readFile` ile Buffer'a alınır →
 * `detectImageMimeType(buffer)` (paketlenmiş varlık da AYNI kapıdan geçer, istisna YOK) →
 * `storage.save()` → `imageSize(buffer)`. Dosya doğrudan `UPLOAD_DIR`'e KOPYALANMAZ
 * (`fs.copyFile` YASAK, §4.2) — `storage` soyutlaması S3 sürücüsünde de doğru çalışsın diye.
 */

export interface SavedTemplateAsset {
  key: string;
  /** Paketteki orijinal dosya adı (ör. "portfolio-cover-1.png") — `Media.filename` alanına yazılır. */
  filename: string;
  path: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string;
}

/** `src/modules/demo-templates/assets/<templateKey>/` — dev'de (tsx, `src/`) VE prod'da (devops'un `dist/`e kopyaladığı ayna) AYNI göreli yapı. */
function templateAssetsDir(templateKey: string): string {
  return path.join(__dirname, "..", "assets", templateKey);
}

function resolveAssetFilePath(templateKey: string, asset: DemoTemplateAsset): string {
  // `asset.file` zaten kayıt-anında (§3.3/`assertDemoTemplateCaps`) yol ayracı içermediği
  // doğrulanmıştır — burada AYRICA savunma derinliği: `path.basename` ile normalize edilir.
  return path.join(templateAssetsDir(templateKey), path.basename(asset.file));
}

/**
 * Faz 0 ön-kontrolü (yazma YOK) — paket varlık dosyalarının GERÇEKTEN var olduğunu ve
 * `MAX_TEMPLATE_ASSET_BYTES` tavanını aşmadığını doğrular. Bu bir registry bütünlük
 * kontrolüdür (commit edilen dosyalar her zaman geçmelidir); yine de bir dosya eksikse/aşırı
 * büyükse kullanıcıya `500` yerine anlamlı bir `422` döndürmek için burada yakalanır.
 */
export async function assertTemplateAssetFilesReadable(templateKey: string, assets: DemoTemplateAsset[]): Promise<void> {
  for (const asset of assets) {
    const filePath = resolveAssetFilePath(templateKey, asset);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(filePath);
    } catch {
      throw new ValidationError(`Şablon varlığı bulunamadı: "${asset.file}".`, { assets: [`"${asset.key}" için paketlenmiş dosya eksik.`] });
    }
    if (stat.size > MAX_TEMPLATE_ASSET_BYTES) {
      throw new ValidationError(`Şablon varlığı çok büyük: "${asset.file}".`, {
        assets: [`"${asset.key}" dosyası ${MAX_TEMPLATE_ASSET_BYTES / 1024} KB sınırını aşıyor.`],
      });
    }
  }
}

/**
 * Faz 1 — TRANSACTION DIŞINDA, DB yazma YOK. Her varlık için `storage.save()` çağrılır (yerel
 * diske veya S3'e gerçek dosya yazılır); bu fazda HİÇBİR `Media` satırı yaratılmaz.
 *
 * Döngü İÇİNDE bir varlık başarısız olursa (readFile/format/storage hatası), o ana kadar
 * BAŞARIYLA kaydedilmiş dosyalar best-effort silinir (aynı telafi disiplini §5.2'nin Faz 2
 * telafisiyle AYNIDIR — yalnızca burada tetikleyici Faz 1'in KENDİ içindeki bir hatadır, henüz
 * Faz 2'ye hiç girilmemiştir) ve hata OLDUĞU GİBİ yeniden fırlatılır.
 */
export async function materializeTemplateAssets(templateKey: string, assets: DemoTemplateAsset[]): Promise<SavedTemplateAsset[]> {
  const saved: SavedTemplateAsset[] = [];

  try {
    for (const asset of assets) {
      const filePath = resolveAssetFilePath(templateKey, asset);
      const buffer = await fs.readFile(filePath);

      if (buffer.byteLength > MAX_TEMPLATE_ASSET_BYTES) {
        throw new ValidationError(`Şablon varlığı çok büyük: "${asset.file}".`, {
          assets: [`"${asset.key}" dosyası ${MAX_TEMPLATE_ASSET_BYTES / 1024} KB sınırını aşıyor.`],
        });
      }

      // SVG dahil tanınmayan/güvensiz içerik KESİN reddedilir — paketlenmiş varlık da AYNI
      // kapıdan geçer, istisna YOK (§4.1/§4.2).
      const detected = detectImageMimeType(buffer);
      if (!detected.mimeType || detected.isSvg) {
        throw new ValidationError(`Şablon varlığı geçerli bir görsel değil: "${asset.file}".`, {
          assets: [`"${asset.key}" tanınan bir görsel biçimiyle (JPEG/PNG/WEBP/GIF) eşleşmiyor.`],
        });
      }

      const { path: storedPath, url } = await storage.save({ buffer, filename: asset.file, mimeType: detected.mimeType });

      let width: number | null = null;
      let height: number | null = null;
      try {
        const dimensions = imageSize(buffer);
        width = dimensions.width;
        height = dimensions.height;
      } catch {
        width = null;
        height = null;
      }

      saved.push({
        key: asset.key,
        filename: asset.file,
        path: storedPath,
        url,
        mimeType: detected.mimeType,
        sizeBytes: buffer.byteLength,
        width,
        height,
        altText: asset.altText,
      });
    }
  } catch (err) {
    await removeSavedTemplateAssets(saved);
    throw err;
  }

  return saved;
}

/** Best-effort telafi — hem Faz 1 iç hatasında hem Faz 2 rollback'inde kullanılır (§5.2). Silinemeyen dosya yalnızca `warn` loglanır, hata YUTULUR (çağıranın asıl hatasını gölgelemez). */
export async function removeSavedTemplateAssets(
  saved: SavedTemplateAsset[],
  onWarn?: (paths: string[]) => void
): Promise<void> {
  const failed: string[] = [];
  for (const asset of saved) {
    try {
      await storage.remove(asset.path);
    } catch {
      failed.push(asset.path);
    }
  }
  if (failed.length > 0) onWarn?.(failed);
}
