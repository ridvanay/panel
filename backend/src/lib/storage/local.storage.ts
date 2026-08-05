import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { UPLOAD_DIR } from "../../plugins/uploads";
import { extensionForMimeType } from "../mime-detect";
import type { MediaStorage, SaveMediaInput, SaveMediaResult } from "./types";

/**
 * Yerel disk depolama sürücüsü — `uploads.ts` plugin'inin oluşturduğu UPLOAD_DIR'e yazar.
 *
 * GÜVENLİK: Diskteki dosya adının uzantısı KULLANICININ beyan ettiği orijinal dosya adından
 * DEĞİL, çağıranın (media.routes.ts / import.worker.ts) magic-byte ile doğruladığı `mimeType`
 * parametresinden türetilir (bkz. lib/mime-detect.ts::extensionForMimeType). Aksi halde
 * `image/png` beyan edilip içeriği `<script>` olan bir `evil.html` diske `.html` uzantısıyla
 * yazılır ve `@fastify/static` bunu `text/html` olarak servis eder (stored-XSS).
 */
export class LocalStorage implements MediaStorage {
  async save({ buffer, mimeType }: SaveMediaInput): Promise<SaveMediaResult> {
    const ext = extensionForMimeType(mimeType);
    const storedName = `${crypto.randomUUID()}${ext}`;
    await fs.writeFile(path.join(UPLOAD_DIR, storedName), buffer);

    return { path: storedName, url: `/uploads/${storedName}` };
  }

  async remove(storedPath: string): Promise<void> {
    await fs.unlink(path.join(UPLOAD_DIR, storedPath));
  }
}
