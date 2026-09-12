import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env";
import { extensionForMimeType } from "./mime-detect";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.5 KARAR J (ENGELLEYİCİ) +
 * `.claude/compliance-notes-telehealth.md` "TUR 2" KRİTİK ŞART — sağlık verisi belgesi
 * (şikâyet notu eki, reçete/tahlil/radyoloji) için ÖZEL depo.
 *
 * `lib/storage/*` (MediaStorage) BİLİNÇLİ OLARAK KULLANILMAZ — o soyutlama public bir `url`
 * üretmek üzere tasarlanmıştır ve local sürücüsü `plugins/uploads.ts::UPLOAD_DIR`'e
 * (`@fastify/static` ile kimlik doğrulamasız servis edilen `/uploads/*`) yazar. Sağlık belgesi
 * ASLA bir `Media` satırı OLAMAZ ve ASLA bu kökün altına yazılamaz (§9.7.5 madde 4/5).
 *
 * `lib/import-storage.ts` İLE AYNI desen (local/s3 sürücü ayrımı) — TEK fark: kök dizin
 * `env.PRIVATE_UPLOAD_DIR`'dan okunur (devops-agent tarafından `/app/storage/private-uploads`
 * olarak hazırlandı, bkz. INFRA.md/docker-compose.yml). `AppointmentDocument.storagePath` bu
 * modülün döndürdüğü opak referansı taşır ve API yanıtlarında ASLA dönmez.
 *
 * Dosya, TEK servis yolu olan `GET /appointments/documents/{documentId}/content` üzerinden,
 * yetkilendirme + `logAudit` sonrası akıtılır — `@fastify/static`'e HİÇBİR ZAMAN kaydedilmez.
 */

export const PRIVATE_UPLOAD_DIR = path.resolve(process.cwd(), env.PRIVATE_UPLOAD_DIR);

function ensureLocalDir(): void {
  fsSync.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });
}

interface TelehealthDocumentStorageDriver {
  save(buffer: Buffer, mimeType: string): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  remove(storagePath: string): Promise<void>;
}

class LocalTelehealthDocumentStorage implements TelehealthDocumentStorageDriver {
  constructor() {
    ensureLocalDir();
  }

  async save(buffer: Buffer, mimeType: string): Promise<string> {
    // Diskteki dosya adı KULLANICININ beyan ettiği orijinal dosya adından DEĞİL, tespit edilen
    // gerçek MIME türünden türetilir — `lib/storage/local.storage.ts` İLE AYNI disiplin.
    const storedName = `${crypto.randomUUID()}${extensionForMimeType(mimeType)}`;
    await fs.writeFile(path.join(PRIVATE_UPLOAD_DIR, storedName), buffer);
    return storedName;
  }

  async read(storagePath: string): Promise<Buffer> {
    return fs.readFile(path.join(PRIVATE_UPLOAD_DIR, storagePath));
  }

  async remove(storagePath: string): Promise<void> {
    await fs.unlink(path.join(PRIVATE_UPLOAD_DIR, storagePath)).catch(() => {});
  }
}

class S3TelehealthDocumentStorage implements TelehealthDocumentStorageDriver {
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

  async save(buffer: Buffer, mimeType: string): Promise<string> {
    // Public ACL YOK, CDN/url üretimi YOK — sağlık verisi bilerek private tutulur.
    const key = `telehealth-documents/${crypto.randomUUID()}${extensionForMimeType(mimeType)}`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType }));
    return key;
  }

  async read(storagePath: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storagePath }));
    const body = result.Body;
    if (!body) throw new Error(`Sağlık belgesi okunamadı: ${storagePath}`);
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

function createTelehealthDocumentStorage(): TelehealthDocumentStorageDriver {
  return env.STORAGE_DRIVER === "s3" ? new S3TelehealthDocumentStorage() : new LocalTelehealthDocumentStorage();
}

export const telehealthDocumentStorage: TelehealthDocumentStorageDriver = createTelehealthDocumentStorage();
