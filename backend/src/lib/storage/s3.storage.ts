import crypto from "node:crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../../config/env";
import { extensionForMimeType } from "../mime-detect";
import type { MediaStorage, SaveMediaInput, SaveMediaResult } from "./types";

/**
 * S3 (veya MinIO/Cloudflare R2 gibi S3-uyumlu) depolama sürücüsü.
 * `S3_ENDPOINT` tanımlıysa özel uç nokta + path-style adresleme kullanılır (MinIO/R2 için gerekli).
 * URL üretimi:
 *   - `S3_PUBLIC_URL` (CDN/CloudFront) tanımlıysa: `${S3_PUBLIC_URL}/${key}`
 *   - tanımlı değilse: virtual-hosted-style `https://{bucket}.s3.{region}.amazonaws.com/{key}`
 */
export class S3Storage implements MediaStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor() {
    if (!env.S3_BUCKET) {
      throw new Error("STORAGE_DRIVER=s3 için S3_BUCKET zorunludur.");
    }

    this.bucket = env.S3_BUCKET;
    this.region = env.S3_REGION ?? "us-east-1";

    this.client = new S3Client({
      region: this.region,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async save({ buffer, mimeType }: SaveMediaInput): Promise<SaveMediaResult> {
    // GÜVENLİK: key uzantısı orijinal dosya adından DEĞİL, doğrulanmış `mimeType`'tan türetilir
    // (bkz. local.storage.ts'teki aynı gerekçe / lib/mime-detect.ts::extensionForMimeType).
    const ext = extensionForMimeType(mimeType);
    const key = `${crypto.randomUUID()}${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    return { path: key, url: this.buildUrl(key) };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  private buildUrl(key: string): string {
    if (env.S3_PUBLIC_URL) {
      return `${env.S3_PUBLIC_URL.replace(/\/+$/, "")}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
