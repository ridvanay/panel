import type { Readable } from "node:stream";
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { env } from "../config/env";

/**
 * `.claude/architect-scope-telehealth-template.md` (TUR 3, bağlayıcı) — LiveKit Egress'in
 * ürettiği görüşme kaydı için ÖZEL depo. `lib/telehealth-document-storage.ts` İLE AYNI genel
 * disiplin (public ACL/CDN YOK, private) ama BİLİNÇLİ OLARAK AYRI ve BAĞIMSIZ bir dosya:
 * belge deposu `Buffer` + local/S3 karışık bir sürücü ayrımına sahiptir, bu depo ise
 * STREAM tabanlıdır ve YALNIZCA S3/S3-uyumlu (MinIO/R2) nesne depolamayı destekler — Egress
 * zaten yerel diske erişemediği için bir "local" sürücü ANLAMSIZDIR ve YAZILMADI.
 *
 * Dosya boyutu ÖNCEDEN bilinmez (şifreli akış) — bu yüzden tek parçalı `PutObject`
 * (`ContentLength` zorunlu) yerine `@aws-sdk/lib-storage`'ın `Upload` (multipart) sınıfı kullanılır.
 */

export const RECORDING_STAGING_PREFIX = "telehealth-recordings-staging/";
export const RECORDING_FINAL_PREFIX = "telehealth-recordings/";

/** `STORAGE_DRIVER=s3` + `S3_BUCKET` + S3 anahtar çifti (access key/secret) dolu mu. */
export function isRecordingStorageConfigured(): boolean {
  return (
    env.STORAGE_DRIVER === "s3" &&
    Boolean(env.S3_BUCKET) &&
    Boolean(env.S3_ACCESS_KEY_ID) &&
    Boolean(env.S3_SECRET_ACCESS_KEY)
  );
}

export function recordingStagingKey(recordingId: string): string {
  return `${RECORDING_STAGING_PREFIX}${recordingId}.mp4`;
}

export function recordingFinalKey(recordingId: string): string {
  return `${RECORDING_FINAL_PREFIX}${recordingId}.mp4.enc`;
}

export interface TelehealthRecordingStorage {
  openReadStream(key: string): Promise<Readable>;
  /** Multipart upload — boyutu önceden bilinmeyen şifreli akışlar için (bkz. dosya üstü notu). */
  uploadStream(key: string, body: Readable, contentType: string): Promise<{ sizeBytes: number }>;
  head(key: string): Promise<{ sizeBytes: number } | null>;
  remove(key: string): Promise<void>;
  /** Yetim staging nesnelerini listeler (süpürücü için) — SADECE `RECORDING_STAGING_PREFIX` altında. */
  listStaging(olderThan: Date): Promise<{ key: string }[]>;
}

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "NotFound" || name === "NoSuchKey";
}

class S3TelehealthRecordingStorage implements TelehealthRecordingStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    // BİLİNÇLİ OLARAK yapılandırma eksikliğinde THROW ETMEZ (`telehealth-document-storage.ts`'in
    // aksine): bu modülün her zaman bir local yedeği YOKTUR, uygulama açılışını KIRAMAZ.
    // Fiili kullanılabilirlik `isRecordingStorageConfigured()` ile route katmanında denetlenir
    // (`RecordingNotConfiguredError`, 503 — `LiveKitNotConfiguredError` İLE AYNI desen).
    this.bucket = env.S3_BUCKET ?? "";
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

  async openReadStream(key: string): Promise<Readable> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = result.Body;
    if (!body) throw new Error(`Görüşme kaydı okunamadı: ${key}`);
    return body as Readable;
  }

  async uploadStream(key: string, body: Readable, contentType: string): Promise<{ sizeBytes: number }> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      partSize: 8 * 1024 * 1024,
      queueSize: 2,
      leavePartsOnError: false,
    });
    await upload.done();
    const head = await this.head(key);
    return { sizeBytes: head?.sizeBytes ?? 0 };
  }

  async head(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: result.ContentLength ?? 0 };
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => {});
  }

  async listStaging(olderThan: Date): Promise<{ key: string }[]> {
    const result = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: RECORDING_STAGING_PREFIX })
    );
    return (result.Contents ?? [])
      .filter((object) => Boolean(object.Key) && object.LastModified !== undefined && object.LastModified < olderThan)
      .map((object) => ({ key: object.Key as string }));
  }
}

export const telehealthRecordingStorage: TelehealthRecordingStorage = new S3TelehealthRecordingStorage();
