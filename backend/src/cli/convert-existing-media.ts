import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { CONFIRM_TOKEN, convertExistingMedia, restoreConvertedMedia } from "../lib/media-conversion/convert-existing";

/**
 * Paket AE-ek — mevcut site fotoğraflarını WebP'ye çevirme (derlenmiş giriş noktası: canlıda imajda `tsx` yoktur).
 *
 *   node dist/cli/convert-existing-media.js                                   # kuru çalışma (yazmaz)
 *   node dist/cli/convert-existing-media.js --confirm=convert-media --operator=<ad>
 *   node dist/cli/convert-existing-media.js --restore=<runId> --confirm=convert-media --operator=<ad>
 *   Seçenekler: --backup-dir=<klasör> (varsayılan storage/media-backup), --limit=<n>
 *
 * Geliştirmede: `npx tsx scripts/convert-existing-media.ts …` (aynı kod).
 */
function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit?.includes("=") ? hit.slice(hit.indexOf("=") + 1) : hit ? "" : undefined;
}

function mb(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export async function main(): Promise<number> {
  if ((process.env.STORAGE_DRIVER ?? "local") !== "local") {
    console.error("Yalnızca yerel depolama (STORAGE_DRIVER=local) destekleniyor.");
    return 2;
  }
  const confirmed = arg("confirm") === CONFIRM_TOKEN;
  const operator = arg("operator");
  const restore = arg("restore");
  const limitRaw = arg("limit");
  const backupRoot = path.resolve(arg("backup-dir") || path.join(process.cwd(), "storage", "media-backup"));
  const prisma = new PrismaClient();
  try {
    if (restore !== undefined) {
      if (!confirmed || !operator) {
        console.error(`Geri alma için --confirm=${CONFIRM_TOKEN} --operator=<ad> gerekli.`);
        return 2;
      }
      const res = await restoreConvertedMedia(prisma, { runId: restore, backupRoot, log: (l) => console.log(l) });
      console.log(JSON.stringify({ restored: res.restored, missingBackups: res.missingBackups, operator }, null, 1));
      return res.missingBackups.length ? 1 : 0;
    }
    if (arg("confirm") !== undefined && !confirmed) {
      console.error(`--confirm değeri "${CONFIRM_TOKEN}" olmalı.`);
      return 2;
    }
    const summary = await convertExistingMedia(prisma, {
      apply: confirmed,
      operator,
      backupRoot,
      limit: limitRaw ? Math.max(1, Number.parseInt(limitRaw, 10) || 0) : undefined,
      log: (l) => console.log(l),
    });
    console.log(`\nMod: ${summary.mode === "apply" ? "GERÇEK" : "KURU (hiçbir şey yazılmadı)"}${summary.runId ? `  runId: ${summary.runId}` : ""}`);
    console.log(`Aday: ${summary.candidates}  Dönüştürülen: ${summary.converted}  Atlanan: ${summary.skipped.length}`);
    console.log(`Toplam boyut: önce ${mb(summary.bytesBefore)} → sonra ${mb(summary.bytesAfter)} (WebP + uyumluluk kopyaları)`);
    if (summary.backupDir) console.log(`Yedek: ${summary.backupDir}  (geri almak için: --restore=${summary.runId})`);
    console.log(JSON.stringify({ skipped: summary.skipped, referenceUpdates: summary.referenceUpdates, unlistedColumnsWithUploads: summary.unlistedColumnsWithUploads }, null, 1));
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
