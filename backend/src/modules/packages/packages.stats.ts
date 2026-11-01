import type { FastifyInstance } from "fastify";
import { registerCrmRetentionStep } from "../crm/crm.rollup";

/**
 * Kullanıcı kararı (2026-11-01, eşleştirme sihirbazındaki kırmızı bayrak kararıyla aynı yaklaşım): paket ve
 * destinasyon ziyaretleri CRM'de kişi bazında kaydedilmez (yollar `CRM_ALWAYS_EXCLUDED_PATHS` içinde, bileşenler
 * `data-crm-ignore`). Yalnızca kimliksiz günlük toplam tutulur.
 */
export const PACKAGE_VIEW_KINDS = ["list", "package", "destinations"] as const;
export type PackageViewKind = (typeof PACKAGE_VIEW_KINDS)[number];
export const PACKAGE_VIEW_STAT_RETENTION_DAYS = 90;

export async function incrementPackageViewStat(app: FastifyInstance, kind: PackageViewKind, key: string, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  try {
    await app.prisma.$executeRaw`INSERT INTO "package_view_stats" ("day", "kind", "key", "count") VALUES (${day}::date, ${kind}, ${key.slice(0, 80)}, 1)
      ON CONFLICT ("day", "kind", "key") DO UPDATE SET "count" = "package_view_stats"."count" + 1`;
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, "Paket görüntülenme sayacı yazılamadı (best-effort).");
  }
}

export async function purgeOldPackageViewStats(app: FastifyInstance, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PACKAGE_VIEW_STAT_RETENTION_DAYS * 86_400_000);
  return (await app.prisma.packageViewStat.deleteMany({ where: { day: { lt: cutoff } } })).count;
}

export interface PackageViewSummary {
  days: number;
  list: number;
  destinations: number;
  /** slug → görüntülenme (paket sayfası + yan panel ayrıntısı). */
  packages: Record<string, number>;
}

/** Yönetici paneli: son 90 günün toplamları. */
export async function packageViewSummary(app: FastifyInstance, now = new Date()): Promise<PackageViewSummary> {
  const since = new Date(now.getTime() - PACKAGE_VIEW_STAT_RETENTION_DAYS * 86_400_000);
  const rows = await app.prisma.packageViewStat.groupBy({ by: ["kind", "key"], where: { day: { gte: since } }, _sum: { count: true } });
  const summary: PackageViewSummary = { days: PACKAGE_VIEW_STAT_RETENTION_DAYS, list: 0, destinations: 0, packages: {} };
  for (const row of rows) {
    const count = row._sum.count ?? 0;
    if (row.kind === "list") summary.list += count;
    else if (row.kind === "destinations") summary.destinations += count;
    else if (row.kind === "package") summary.packages[row.key] = (summary.packages[row.key] ?? 0) + count;
  }
  return summary;
}

// Tek kayıt (modül yüklenirken): CRM saatlik saklama zincirine eklenir.
registerCrmRetentionStep((app, now) => purgeOldPackageViewStats(app, now));
