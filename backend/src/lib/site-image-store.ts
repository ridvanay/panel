import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { storage } from "./storage";
import { filenameForMimeType } from "./mime-detect";
import { parseVariants, processSiteImage, type ImagePurpose, type MediaVariant, type ProcessedImage } from "./image-pipeline";

/**
 * Paket AE-ek — işlenmiş site fotoğrafını kaydeder: ana sürüm `<uuid>.webp` (ikon amacında `.png`), uyumluluk
 * kopyaları aynı UUID ile `<uuid>.jpg` (+ saydam/logo ise `<uuid>.png`). Orijinal dosya SAKLANMAZ.
 * Dönen nesne doğrudan `prisma.media.create({ data })` içine verilir.
 */
export interface StoredSiteImage {
  data: Pick<Prisma.MediaUncheckedCreateInput, "path" | "url" | "filename" | "mimeType" | "sizeBytes" | "width" | "height" | "variants">;
  processed: ProcessedImage;
  /** Hata halinde geri almak için yazılan bütün yollar. */
  writtenPaths: string[];
}

export async function storeProcessedImage(processed: ProcessedImage, filename: string, baseName: string = crypto.randomUUID()): Promise<StoredSiteImage> {
  const writtenPaths: string[] = [];
  try {
    const main = await storage.save({ buffer: processed.main.buffer, filename, mimeType: processed.main.mimeType, baseName });
    writtenPaths.push(main.path);
    const variants: MediaVariant[] = [];
    for (const c of processed.compat) {
      const saved = await storage.save({ buffer: c.buffer, filename, mimeType: c.mimeType, baseName });
      writtenPaths.push(saved.path);
      variants.push({ format: c.mimeType === "image/png" ? "png" : "jpeg", path: saved.path, url: saved.url, sizeBytes: c.buffer.byteLength, width: c.width, height: c.height });
    }
    return {
      data: {
        path: main.path,
        url: main.url,
        filename: filenameForMimeType(filename, processed.main.mimeType),
        mimeType: processed.main.mimeType,
        sizeBytes: processed.main.buffer.byteLength,
        width: processed.main.width,
        height: processed.main.height,
        variants: variants as unknown as Prisma.InputJsonValue,
      },
      processed,
      writtenPaths,
    };
  } catch (err) {
    await removeStoredPaths(writtenPaths);
    throw err;
  }
}

export async function processAndStoreSiteImage(buffer: Buffer, filename: string, opts: { purpose?: ImagePurpose; isHeif?: boolean } = {}): Promise<StoredSiteImage> {
  return storeProcessedImage(await processSiteImage(buffer, opts), filename);
}

export async function removeStoredPaths(paths: string[]): Promise<void> {
  for (const p of paths) await storage.remove(p).catch(() => undefined);
}

/** Medya silinirken uyumluluk kopyalarının dosyaları da silinir. */
export function variantPaths(variants: unknown): string[] {
  return Array.isArray(variants) ? variants.map((v) => (v && typeof v === "object" ? (v as { path?: unknown }).path : null)).filter((p): p is string => typeof p === "string") : [];
}

const UPLOADS_PATH = /\/uploads\/[^?#]+/;

/**
 * Paket AE-ek — WebP'yi göstermeyen istemciler (e-posta, sosyal ağ önizlemesi) için görselin uyumluluk kopyasının
 * adresi. `url` bir site medyasına (`/uploads/...`) işaret etmiyorsa ya da kopya yoksa `url` aynen döner.
 */
export async function compatImageUrl(app: FastifyInstance, url: string | null | undefined, prefer: "png" | "jpeg" = "png"): Promise<string | null> {
  if (!url) return null;
  const match = UPLOADS_PATH.exec(url);
  if (!match) return url;
  const media = await app.prisma.media.findFirst({ where: { url: match[0] }, select: { variants: true } });
  const variants = parseVariants(media?.variants);
  const chosen = variants.find((v) => v.format === prefer) ?? variants.find((v) => v.format === "jpeg") ?? variants.find((v) => v.format === "png");
  return chosen ? url.replace(match[0], chosen.url) : url;
}
