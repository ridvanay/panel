/**
 * Paket AE-ek — mevcut site fotoğraflarını WebP'ye çevirir (bkz. src/cli/convert-existing-media.ts).
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/convert-existing-media.ts                                       (kuru çalışma)
 *   npx tsx scripts/convert-existing-media.ts --confirm=convert-media --operator=<ad>
 *   npx tsx scripts/convert-existing-media.ts --restore=<runId> --confirm=convert-media --operator=<ad>
 * Canlıda (imajda tsx yok): docker compose exec backend node dist/cli/convert-existing-media.js …
 */
import { main } from "../src/cli/convert-existing-media";

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
);
