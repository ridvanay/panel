import { execFileSync } from "node:child_process";

/**
 * Paket AL, Is 2 — demo sablon icerik aktarma spec'lerinin (admin-demo-template-import,
 * ecommerce-pro-template-import, telehealth-template-import) saas_e2e'deki "site kimligi" verisini
 * (menu, altbilgi, sosyal baglantilar, ayarlar, gorunum, moduller) KALICI olarak Turkce demo veriye
 * cevirmesini engeller. Importer bu tablolari yeniden yazar (`importer.ts`); sonraki ziyaretci
 * kontrolleri ("Turkce yok", AI3/AG3/AH) bu yuzden bozuluyordu.
 *
 * Kullanim: `beforeAll`da `const snap = snapshotSiteState()`, `afterAll`de `restoreSiteState(snap)`.
 * Yalnizca saas_e2e (docker exec ile db konteyneri) — baska veritabanina ASLA yazmaz.
 */
const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? "claudecodeproje-db-1";
const DB_NAME = "saas_e2e";
const TABLES = [
  "navigation_items",
  "footer_links",
  "footer_columns",
  "social_links",
  "site_settings",
  "site_appearance",
  "site_modules",
] as const;

export interface SiteStateSnapshot {
  dump: string;
}

export function snapshotSiteState(): SiteStateSnapshot {
  const args = ["exec", DB_CONTAINER, "pg_dump", "-U", "postgres", "-d", DB_NAME, "--data-only", "--column-inserts", "--no-owner"];
  for (const t of TABLES) args.push("-t", `public.${t}`);
  const dump = execFileSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { dump };
}

export function restoreSiteState(snapshot: SiteStateSnapshot): void {
  const wipe = TABLES.map((t) => `DELETE FROM public.${t};`).join("\n");
  // replica rolu: FK/tetikleyici sirasi onemsiz (superuser gerekir — yerel postgres kullanicisi).
  const sql = `BEGIN;\nSET session_replication_role = replica;\n${wipe}\n${snapshot.dump}\nCOMMIT;\n`;
  execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-q"], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Geri yuklemeden sonra frontend ISR onbellegini tum site icin gecersiz kilar (Node `localhost`'a erisir). */
export async function restoreSiteStateAndRevalidate(snapshot: SiteStateSnapshot): Promise<void> {
  restoreSiteState(snapshot);
  const base = process.env.E2E_INTERNAL_FRONTEND_URL ?? "http://localhost:3100";
  await fetch(`${base}/api/revalidate`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", "x-revalidate-secret": process.env.E2E_REVALIDATE_SECRET ?? "e2e-revalidate-secret" },
    body: JSON.stringify({ paths: ["/"], type: "layout" }),
  }).catch(() => undefined);
}
