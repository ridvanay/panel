import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env";

/**
 * §10.8.10 Analitik Rapor Dışa Aktarma (Export) — üretilen CSV/PDF raporlarının depolandığı
 * PRIVATE alan. `lib/import-storage.ts` İLE BİREBİR AYNI DESEN (bkz. o dosyadaki üst not) —
 * `lib/storage/*` (MediaStorage) BİLİNÇLİ OLARAK KULLANILMAZ: export raporları (özellikle
 * USERS/REVENUE türleri) e-posta gibi kişisel veri barındırabilir, asla public olamaz; ACL
 * public-read UYGULANMAZ, URL ÜRETİLMEZ.
 *
 * Local sürücüde: `<cwd>/storage/exports/<uuid>`.
 * S3 sürücüde: aynı bucket'ta `exports/<uuid>` key'i (yalnızca `GetObjectCommand` ile
 * sunucu tarafında okunur).
 *
 * `ExportJob.storagePath` bu modülün döndürdüğü referansı taşır ve API yanıtlarında ASLA
 * dönmez (bkz. schemas/entities.ts::ExportJobSchema — storagePath alanı YOK).
 */

export const EXPORT_STORAGE_DIR = path.join(process.cwd(), "storage", "exports");

function ensureLocalDir(): void {
  fsSync.mkdirSync(EXPORT_STORAGE_DIR, { recursive: true });
}

interface ExportStorageDriver {
  save(buffer: Buffer): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  remove(storagePath: string): Promise<void>;
}

class LocalExportStorage implements ExportStorageDriver {
  constructor() {
    ensureLocalDir();
  }

  async save(buffer: Buffer): Promise<string> {
    const name = crypto.randomUUID();
    await fs.writeFile(path.join(EXPORT_STORAGE_DIR, name), buffer);
    return name;
  }

  async read(storagePath: string): Promise<Buffer> {
    return fs.readFile(path.join(EXPORT_STORAGE_DIR, storagePath));
  }

  async remove(storagePath: string): Promise<void> {
    await fs.unlink(path.join(EXPORT_STORAGE_DIR, storagePath)).catch(() => {});
  }
}

class S3ExportStorage implements ExportStorageDriver {
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
    const key = `exports/${crypto.randomUUID()}`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer }));
    return key;
  }

  async read(storagePath: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storagePath }));
    const body = result.Body;
    if (!body) throw new Error(`Dışa aktarma dosyası okunamadı: ${storagePath}`);
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

function createExportStorage(): ExportStorageDriver {
  return env.STORAGE_DRIVER === "s3" ? new S3ExportStorage() : new LocalExportStorage();
}

export const exportStorage: ExportStorageDriver = createExportStorage();
