import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env";

/**
 * §10.8.5 Toplu İçe Aktarma — kaynak dosyaların (WXR/CSV/ZIP) depolandığı PRIVATE alan.
 * `lib/storage/*` (MediaStorage) BİLİNÇLİ OLARAK kullanılmaz: o soyutlama public bir `url`
 * döndürmek üzere tasarlanmıştır ve local sürücüsü `plugins/uploads.ts::UPLOAD_DIR`'e
 * (auth'suz `@fastify/static` ile servis edilen `/uploads/*`) yazar. Bir WXR/CSV dosyası
 * e-posta adresleri ve yayınlanmamış taslak içerik barındırabilir — asla public olamaz.
 *
 * Local sürücüde: `<cwd>/storage/imports/<uuid>` (bkz. ARCHITECTURE.md §10.8.5).
 * S3 sürücüde: aynı bucket'ta `imports/<uuid>` key'i (ACL public-read UYGULANMAZ, URL
 * ÜRETİLMEZ — yalnızca `GetObjectCommand` ile sunucu tarafında okunur).
 *
 * `ImportJob.storagePath` bu modülün döndürdüğü referansı taşır ve API yanıtlarında
 * ASLA dönmez (bkz. schemas/entities.ts ImportJobSummarySchema — storagePath alanı YOK).
 */

export const IMPORT_STORAGE_DIR = path.join(process.cwd(), "storage", "imports");

function ensureLocalDir(): void {
  fsSync.mkdirSync(IMPORT_STORAGE_DIR, { recursive: true });
}

interface ImportStorageDriver {
  save(buffer: Buffer): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  remove(storagePath: string): Promise<void>;
}

class LocalImportStorage implements ImportStorageDriver {
  constructor() {
    ensureLocalDir();
  }

  async save(buffer: Buffer): Promise<string> {
    const name = crypto.randomUUID();
    await fs.writeFile(path.join(IMPORT_STORAGE_DIR, name), buffer);
    return name;
  }

  async read(storagePath: string): Promise<Buffer> {
    return fs.readFile(path.join(IMPORT_STORAGE_DIR, storagePath));
  }

  async remove(storagePath: string): Promise<void> {
    await fs.unlink(path.join(IMPORT_STORAGE_DIR, storagePath)).catch(() => {});
  }
}

class S3ImportStorage implements ImportStorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    if (!env.S3_BUCKET) {
      throw new Error("STORAGE_DRIVER=s3 için S3_BUCKET zorunludur.");
    }
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION ?? "us-east-1",
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async save(buffer: Buffer): Promise<string> {
    // Public ACL YOK, CDN/url üretimi YOK — bilerek private tutulur (bkz. modül üstü not).
    const key = `imports/${crypto.randomUUID()}`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer }));
    return key;
  }

  async read(storagePath: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storagePath }));
    const body = result.Body;
    if (!body) throw new Error(`İçe aktarma dosyası okunamadı: ${storagePath}`);
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async remove(storagePath: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storagePath })).catch(() => {});
  }
}

function createImportStorage(): ImportStorageDriver {
  return env.STORAGE_DRIVER === "s3" ? new S3ImportStorage() : new LocalImportStorage();
}

export const importStorage: ImportStorageDriver = createImportStorage();
