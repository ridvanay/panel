/**
 * Depolama katmanı soyutlaması — medya dosyalarının nereye (yerel disk / S3 uyumlu nesne
 * depolama) yazılacağını implementasyona bırakır. `media.routes.ts` bu arayüz üzerinden
 * çalışır, hangi sürücünün aktif olduğunu bilmesine gerek kalmaz.
 */

export interface SaveMediaInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
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

export interface MediaStorage {
  save(input: SaveMediaInput): Promise<SaveMediaResult>;
  /** `path`, `SaveMediaResult.path` ile aynı formatta olmalı (local dosya adı ya da S3 key). */
  remove(path: string): Promise<void>;
}
