import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { UPLOAD_DIR } from "../../plugins/uploads";
import type { MediaStorage, SaveMediaInput, SaveMediaResult } from "./types";

/**
 * Yerel disk depolama sürücüsü — `uploads.ts` plugin'inin oluşturduğu UPLOAD_DIR'e yazar.
 * Davranış, soyutlama öncesindeki mevcut implementasyonla birebir aynıdır (geriye dönük uyum).
 */
export class LocalStorage implements MediaStorage {
  async save({ buffer, filename }: SaveMediaInput): Promise<SaveMediaResult> {
    const ext = path.extname(filename);
    const storedName = `${crypto.randomUUID()}${ext}`;
    await fs.writeFile(path.join(UPLOAD_DIR, storedName), buffer);

    return { path: storedName, url: `/uploads/${storedName}` };
  }

  async remove(storedPath: string): Promise<void> {
    await fs.unlink(path.join(UPLOAD_DIR, storedPath));
  }
}
