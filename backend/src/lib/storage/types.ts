import crypto from "node:crypto";

/**
 * Depolama katmanı soyutlaması — medya dosyalarının nereye (yerel disk / S3 uyumlu nesne
 * depolama) yazılacağını implementasyona bırakır. `media.routes.ts` bu arayüz üzerinden
 * çalışır, hangi sürücünün aktif olduğunu bilmesine gerek kalmaz.
 */

export interface SaveMediaInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  /**
   * Paket AE-ek — verilirse dosya adı `${baseName}${uzantı}` olur (aynı görselin `.webp`/`.jpg`/`.png` sürümleri aynı
   * UUID'yi paylaşır; Open Graph `.webp` → `.jpg` eşlemesi buna dayanır). Yalnızca sunucunun ürettiği UUID verilir.
   */
  baseName?: string;
}

export interface SaveMediaResult {
  /**
   * Local sürücüde: diskteki dosya adı (UPLOAD_DIR'e göre relative).
   * S3 sürücüde: object key (bucket içindeki tam yol).
   * `Media.path` alanında saklanır ve silme işleminde geri verilir.
   */
  path: string;
  /**
   * Local sürücüde: relative URL (örn. `/uploads/xxx.png`) — `toMediaDto` bunu PUBLIC_URL ile mutlaklaştırır.
   * S3 sürücüde: tam/absolute URL (CDN veya S3 sağlayıcı URL'i) — olduğu gibi kullanılır.
   */
  url: string;
}

/** Paket AE — büyük dosya (video): bellek yerine diskteki geçici dosyadan kaydedilir; kaynak dosya taşınır/silinir. */
export interface SaveMediaFileInput {
  /** UPLOAD_DIR içindeki geçici dosyanın mutlak yolu. */
  sourcePath: string;
  sizeBytes: number;
  mimeType: string;
}

export interface MediaStorage {
  save(input: SaveMediaInput): Promise<SaveMediaResult>;
  saveFile(input: SaveMediaFileInput): Promise<SaveMediaResult>;
  /** `path`, `SaveMediaResult.path` ile aynı formatta olmalı (local dosya adı ya da S3 key). */
  remove(path: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `baseName` yalnızca UUID olabilir (yol/uzantı enjeksiyonu yok); verilmezse yeni UUID üretilir. */
export function safeBaseName(baseName: string | undefined): string {
  if (baseName === undefined) return crypto.randomUUID();
  if (!UUID.test(baseName)) throw new Error("Geçersiz depolama adı.");
  return baseName.toLowerCase();
}
