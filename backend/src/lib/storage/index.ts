import { env } from "../../config/env";
import { LocalStorage } from "./local.storage";
import { S3Storage } from "./s3.storage";
import type { MediaStorage } from "./types";

export type { MediaStorage, SaveMediaInput, SaveMediaResult } from "./types";

function createStorage(): MediaStorage {
  return env.STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage();
}

/** Aktif depolama sürücüsü — `env.STORAGE_DRIVER`'a göre seçilir (varsayılan: local). */
export const storage: MediaStorage = createStorage();
