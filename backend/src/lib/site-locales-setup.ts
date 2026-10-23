/**
 * Paket L (2026-10-23) — es/de/ar/ru `Locale` satırlarını ekler / açar. Script:
 * `scripts/add-site-locales.ts`. Rapor: `docs/prompts/2026-10-23-L-RAPOR.md`.
 *
 * Kurallar: satırlar `enabled: false` eklenir; mevcut `tr`/`en` satırlarına ve `isDefault`
 * alanına HİÇ dokunulmaz; mevcut bir yeni-dil satırının etiketleri ezilmez. Açma (`--enable`)
 * yalnızca bu dört dil için ve ayrıca onayla yapılır.
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { CACHE_TAGS, triggerTagRevalidation } from "./revalidate";

export const ADD_LOCALES_CONFIRM_KEY = "add-locales";
export const ADD_LOCALES_AUDIT_ACTION = "localization.locales_added";
export const ENABLE_LOCALES_AUDIT_ACTION = "localization.locales_enabled";

export class SiteLocalesError extends Error {}

export const NEW_SITE_LOCALES = [
  { code: "es", label: "İspanyolca", nativeLabel: "Español", hreflang: "es" },
  { code: "de", label: "Almanca", nativeLabel: "Deutsch", hreflang: "de" },
  { code: "ar", label: "Arapça", nativeLabel: "العربية", hreflang: "ar" },
  { code: "ru", label: "Rusça", nativeLabel: "Русский", hreflang: "ru" },
] as const;
export type NewSiteLocaleCode = (typeof NEW_SITE_LOCALES)[number]["code"];
const NEW_CODES = NEW_SITE_LOCALES.map((l) => l.code) as readonly string[];

type Db = Pick<PrismaClient, "locale" | "auditLog" | "$transaction">;

export interface LocalesPlan {
  toCreate: { code: string; label: string; nativeLabel: string; hreflang: string; sortOrder: number }[];
  existing: { code: string; enabled: boolean; isDefault: boolean }[];
  toEnable: string[];
}

export function parseEnableArg(raw: string | undefined): string[] {
  if (!raw) return [];
  const codes = [...new Set(raw.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean))];
  const unknown = codes.filter((c) => !NEW_CODES.includes(c));
  if (unknown.length) throw new SiteLocalesError(`--enable yalnızca ${NEW_CODES.join(", ")} kabul eder; bilinmeyen: ${unknown.join(", ")}.`);
  return codes;
}

export async function buildLocalesPlan(db: Db, enable: string[] = []): Promise<LocalesPlan> {
  const rows = await db.locale.findMany({ orderBy: { sortOrder: "asc" } });
  const maxSort = rows.reduce((max, r) => Math.max(max, r.sortOrder), -1);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  let next = maxSort + 1;
  const toCreate = NEW_SITE_LOCALES.filter((l) => !byCode.has(l.code)).map((l) => ({ ...l, sortOrder: next++ }));
  const existing = NEW_SITE_LOCALES.filter((l) => byCode.has(l.code)).map((l) => {
    const row = byCode.get(l.code)!;
    return { code: row.code, enabled: row.enabled, isDefault: row.isDefault };
  });
  const toEnable = enable.filter((code) => !byCode.get(code)?.enabled);
  return { toCreate, existing, toEnable };
}

export function formatLocalesPlan(plan: LocalesPlan): string {
  const lines: string[] = [];
  lines.push(plan.toCreate.length ? "Eklenecek diller (enabled: false):" : "Eklenecek dil yok.");
  for (const l of plan.toCreate) lines.push(`  + ${l.code} — ${l.nativeLabel} (hreflang=${l.hreflang}, sortOrder=${l.sortOrder})`);
  for (const l of plan.existing) lines.push(`  = ${l.code} zaten var (enabled=${l.enabled}); dokunulmaz.`);
  if (plan.toEnable.length) lines.push(`Açılacak diller: ${plan.toEnable.join(", ")}`);
  lines.push("tr/en satırlarına ve isDefault alanına dokunulmaz.");
  return lines.join("\n");
}

export interface OperatorInfo {
  operator: string;
  osUser: string;
  hostname: string;
}

function appLike(db: Db): FastifyInstance {
  const log = { warn: (...a: unknown[]) => console.warn(...a), info: () => {}, error: (...a: unknown[]) => console.error(...a) };
  return { prisma: db, log } as unknown as FastifyInstance;
}

export async function applyLocalesPlan(
  db: Db,
  plan: LocalesPlan,
  options: OperatorInfo & { confirm?: string; revalidate?: boolean }
): Promise<{ created: string[]; enabled: string[] }> {
  if (options.confirm !== ADD_LOCALES_CONFIRM_KEY) throw new SiteLocalesError(`Gerçek yazma için --confirm=${ADD_LOCALES_CONFIRM_KEY} gerekir.`);
  if (!options.operator || options.operator.trim().length < 3) throw new SiteLocalesError("--operator zorunlu (en az 3 karakter).");

  const result = await db.$transaction(async (tx) => {
    const created: string[] = [];
    for (const l of plan.toCreate) {
      // Eşzamanlı ekleme olduysa (plan sonrası) mevcut satıra dokunulmaz.
      const exists = await tx.locale.findUnique({ where: { code: l.code } });
      if (exists) continue;
      await tx.locale.create({
        data: { code: l.code, label: l.label, nativeLabel: l.nativeLabel, hreflang: l.hreflang, sortOrder: l.sortOrder, enabled: false, isDefault: false },
      });
      created.push(l.code);
    }
    const enabled: string[] = [];
    for (const code of plan.toEnable) {
      if (!NEW_CODES.includes(code)) continue;
      const row = await tx.locale.findUnique({ where: { code } });
      if (!row) throw new SiteLocalesError(`"${code}" satırı yok; önce ekleyin.`);
      if (row.isDefault) continue;
      await tx.locale.update({ where: { code }, data: { enabled: true } });
      enabled.push(code);
    }
    const meta = { operator: options.operator, osUser: options.osUser, hostname: options.hostname };
    if (created.length) {
      await tx.auditLog.create({
        data: { actorId: null, actorEmail: null, action: ADD_LOCALES_AUDIT_ACTION, targetType: "Locale", targetId: null, metadata: { ...meta, codes: created } },
      });
    }
    if (enabled.length) {
      await tx.auditLog.create({
        data: { actorId: null, actorEmail: null, action: ENABLE_LOCALES_AUDIT_ACTION, targetType: "Locale", targetId: null, metadata: { ...meta, codes: enabled } },
      });
    }
    return { created, enabled };
  });

  if (options.revalidate !== false && (result.created.length || result.enabled.length)) {
    await triggerTagRevalidation(appLike(db), [CACHE_TAGS.locales]);
  }
  return result;
}
