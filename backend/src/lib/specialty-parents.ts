/**
 * Paket AG (İş 1) — alt uzmanlık bağlama (`scripts/set-specialty-parents.ts`): canlıdaki `esd`, `ercp`, `poem`
 * uzmanlıklarını `gastroenterology` altına bağlar (`Specialty.parentId`).
 *
 * Güvenlik: kuru çalışma varsayılan; yazma `--confirm=set-specialty-parent --operator=...`; yazmadan önce
 * etkilenen satırların önceki `parentId` değerleri JSON yedeğe alınır, `--restore=<dosya>` ile geri yüklenir.
 * İdempotent (zaten bağlıysa "atla"); slug bulunamazsa uyarı (hata kodu YOK); hiçbir kayıt SİLİNMEZ,
 * slug/URL değişmez. Tek seviye kuralı API'deki ile aynıdır (üst uzmanlığın üstü olamaz, çocuklu uzmanlık taşınmaz).
 */
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { CACHE_TAGS, triggerTagRevalidation } from "./revalidate";

export const SET_SPECIALTY_PARENTS_CONFIRM_KEY = "set-specialty-parent";
export const SET_SPECIALTY_PARENTS_AUDIT_ACTION = "specialty.parent_set";
export const SET_SPECIALTY_PARENTS_RESTORE_AUDIT_ACTION = "specialty.parent_restored";

export const DEFAULT_SPECIALTY_PARENT_MAP: readonly SpecialtyParentPair[] = [
  { child: "esd", parent: "gastroenterology" },
  { child: "ercp", parent: "gastroenterology" },
  { child: "poem", parent: "gastroenterology" },
];

export interface SpecialtyParentPair {
  child: string;
  parent: string;
}

export class SetSpecialtyParentsError extends Error {}

type Db = Pick<PrismaClient, "specialty" | "auditLog" | "$transaction">;

export interface SpecialtyParentPlanEntry {
  child: string;
  parent: string;
  action: "set" | "skip" | "warn";
  reason?: string;
  childId?: string;
  parentId?: string;
  previousParentId?: string | null;
}

export interface SpecialtyParentPlan {
  entries: SpecialtyParentPlanEntry[];
}

/** `esd:gastroenterology,ercp:gastroenterology` biçimini çözer. */
export function parseSpecialtyParentMap(raw: string | undefined): SpecialtyParentPair[] {
  if (raw === undefined) return [...DEFAULT_SPECIALTY_PARENT_MAP];
  const pairs = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [child, parent, ...extra] = part.split(":").map((p) => p.trim());
      if (!child || !parent || extra.length > 0) throw new SetSpecialtyParentsError(`Geçersiz --map öğesi: "${part}" (beklenen: alt:üst).`);
      return { child, parent };
    });
  if (pairs.length === 0) throw new SetSpecialtyParentsError("--map boş olamaz.");
  return pairs;
}

export async function buildSpecialtyParentPlan(db: Db, pairs: readonly SpecialtyParentPair[] = DEFAULT_SPECIALTY_PARENT_MAP): Promise<SpecialtyParentPlan> {
  const slugs = Array.from(new Set(pairs.flatMap((p) => [p.child, p.parent])));
  const rows = await db.specialty.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true, parentId: true, _count: { select: { children: true } } },
  });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  // Aynı çalıştırmada bağlanacak üstler: bir uzmanlık aynı anda hem üst hem alt olamaz.
  const childSlugs = new Set(pairs.map((p) => p.child));

  const entries: SpecialtyParentPlanEntry[] = pairs.map(({ child, parent }) => {
    const base = { child, parent };
    const c = bySlug.get(child);
    const p = bySlug.get(parent);
    if (!c) return { ...base, action: "warn", reason: `"${child}" bulunamadı` };
    if (!p) return { ...base, action: "warn", reason: `"${parent}" bulunamadı` };
    const ids = { childId: c.id, parentId: p.id, previousParentId: c.parentId };
    if (c.id === p.id) return { ...base, ...ids, action: "warn", reason: "uzmanlık kendisinin altına bağlanamaz" };
    if (c.parentId === p.id) return { ...base, ...ids, action: "skip", reason: "zaten bağlı" };
    if (p.parentId || childSlugs.has(parent)) return { ...base, ...ids, action: "warn", reason: `"${parent}" zaten bir alt uzmanlık (yalnızca tek seviye)` };
    if (c._count.children > 0) return { ...base, ...ids, action: "warn", reason: `"${child}" kendi alt uzmanlıklarına sahip (taşınamaz)` };
    return { ...base, ...ids, action: "set" };
  });
  return { entries };
}

export function formatSpecialtyParentPlan(plan: SpecialtyParentPlan): string {
  const lines = plan.entries.map((e) => {
    if (e.action === "set") return `[bagla] ${e.child} -> ${e.parent}${e.previousParentId ? " (önceki üst uzmanlık değiştirilecek)" : ""}`;
    if (e.action === "skip") return `[atla] ${e.child} -> ${e.parent}: ${e.reason}.`;
    return `[uyari] ${e.child} -> ${e.parent}: ${e.reason}; atlandı.`;
  });
  if (!plan.entries.some((e) => e.action === "set")) lines.push("Bağlanacak uzmanlık yok.");
  return lines.join("\n");
}

export interface SpecialtyParentBackup {
  version: 1;
  createdAt: string;
  entries: { slug: string; id: string; previousParentId: string | null }[];
}

export function buildSpecialtyParentBackup(plan: SpecialtyParentPlan, now = new Date()): SpecialtyParentBackup {
  return {
    version: 1,
    createdAt: now.toISOString(),
    entries: plan.entries.filter((e) => e.action === "set").map((e) => ({ slug: e.child, id: e.childId!, previousParentId: e.previousParentId ?? null })),
  };
}

function appLike(db: unknown): FastifyInstance {
  const log = { warn: (...a: unknown[]) => console.warn(...a), info: () => {}, error: (...a: unknown[]) => console.error(...a) };
  return { prisma: db, log } as unknown as FastifyInstance;
}

interface ApplyOptions {
  confirm?: string | undefined;
  operator: string;
  osUser: string;
  hostname: string;
  revalidate?: boolean;
}

function assertConfirmed(options: ApplyOptions): void {
  if (options.confirm !== SET_SPECIALTY_PARENTS_CONFIRM_KEY) throw new SetSpecialtyParentsError(`Gerçek yazma için --confirm=${SET_SPECIALTY_PARENTS_CONFIRM_KEY} gerekir.`);
  if (!options.operator.trim()) throw new SetSpecialtyParentsError('--operator="Ad Soyad" zorunludur.');
}

export async function applySpecialtyParentPlan(db: Db, plan: SpecialtyParentPlan, options: ApplyOptions): Promise<{ updated: string[] }> {
  assertConfirmed(options);
  const toSet = plan.entries.filter((e) => e.action === "set");
  if (toSet.length === 0) return { updated: [] };

  await db.$transaction(async (tx) => {
    for (const e of toSet) await tx.specialty.update({ where: { id: e.childId! }, data: { parentId: e.parentId! } });
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: `script:${options.operator}`,
        action: SET_SPECIALTY_PARENTS_AUDIT_ACTION,
        targetType: "Specialty",
        targetId: null,
        metadata: {
          operator: options.operator,
          osUser: options.osUser,
          hostname: options.hostname,
          pairs: toSet.map((e) => ({ child: e.child, parent: e.parent, previousParentId: e.previousParentId ?? null })),
        },
      },
    });
  });
  if (options.revalidate !== false) await triggerTagRevalidation(appLike(db), [CACHE_TAGS.specialties, CACHE_TAGS.doctors, CACHE_TAGS.blog]);
  return { updated: toSet.map((e) => e.child) };
}

export function parseSpecialtyParentBackup(raw: string): SpecialtyParentBackup {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new SetSpecialtyParentsError("Yedek dosyası geçerli JSON değil.");
  }
  const b = data as Partial<SpecialtyParentBackup> | null;
  if (!b || b.version !== 1 || !Array.isArray(b.entries) || b.entries.some((e) => typeof e?.id !== "string" || typeof e?.slug !== "string")) {
    throw new SetSpecialtyParentsError("Geçersiz yedek dosyası biçimi.");
  }
  return b as SpecialtyParentBackup;
}

/** Yedekteki her uzmanlığın `parentId` değerini yedekteki önceki değere döndürür; bulunamayanlar atlanır, hiçbiri silinmez. */
export async function restoreSpecialtyParents(db: Db, backup: SpecialtyParentBackup, options: ApplyOptions): Promise<{ restored: string[]; missing: string[] }> {
  assertConfirmed(options);
  const restored: string[] = [];
  const missing: string[] = [];
  await db.$transaction(async (tx) => {
    for (const e of backup.entries) {
      const exists = await tx.specialty.findUnique({ where: { id: e.id }, select: { id: true } });
      if (!exists) {
        missing.push(e.slug);
        continue;
      }
      await tx.specialty.update({ where: { id: e.id }, data: { parentId: e.previousParentId } });
      restored.push(e.slug);
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: `script:${options.operator}`,
        action: SET_SPECIALTY_PARENTS_RESTORE_AUDIT_ACTION,
        targetType: "Specialty",
        targetId: null,
        metadata: { operator: options.operator, osUser: options.osUser, hostname: options.hostname, restored, missing },
      },
    });
  });
  if (options.revalidate !== false) await triggerTagRevalidation(appLike(db), [CACHE_TAGS.specialties, CACHE_TAGS.doctors, CACHE_TAGS.blog]);
  return { restored, missing };
}
