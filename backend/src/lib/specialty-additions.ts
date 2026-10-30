/**
 * Paket V (2026-10-30) — iki yeni uzmanlık: Göğüs Cerrahisi ve Beyin ve Sinir Cerrahisi
 * (`scripts/add-specialties.ts`). Ad ve açıklama EN kanonik; 8 dilin çevirisi mevcut export/import
 * akışıyla yapılır (`export-translatable-content.ts` → çeviri → `import-translations.ts`).
 *
 * İdempotent: slug zaten varsa o uzmanlık atlanır; mevcut uzmanlıklara hiç dokunulmaz. Yeni kayıtlar
 * mevcut sıranın sonuna eklenir. Kuru çalışma varsayılan; yazma `--confirm=add-specialties
 * --operator=...`, tek transaction, audit kaydı.
 *
 * İkon adları uzmanlık kartının ikon sözlüğündedir (`frontend/src/lib/page-builder/icon-options.ts`).
 * Doktoru olmayan uzmanlık sayfası yayında kalır ama `noindex` olur ve sitemap'e girmez (frontend).
 */
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { CACHE_TAGS, triggerTagRevalidation } from "./revalidate";

export const ADD_SPECIALTIES_CONFIRM_KEY = "add-specialties";
export const ADD_SPECIALTIES_AUDIT_ACTION = "specialty.added_by_script";

export interface NewSpecialty {
  slug: string;
  name: string;
  icon: string;
  description: string;
}

export const NEW_SPECIALTIES: readonly NewSpecialty[] = [
  {
    slug: "thoracic-surgery",
    name: "Thoracic Surgery",
    icon: "Wind",
    description:
      "Surgical diagnosis and treatment of diseases of the lungs, airways, chest wall and mediastinum, including minimally invasive (VATS) procedures. Start with an online consultation for assessment and a second opinion.",
  },
  {
    slug: "neurosurgery",
    name: "Neurosurgery",
    icon: "Brain",
    description:
      "Surgical care for conditions of the brain, spine and peripheral nerves, such as herniated discs, spinal stenosis and brain tumours. Start with an online consultation for assessment and a second opinion.",
  },
];

export class AddSpecialtiesError extends Error {}

type Db = Pick<PrismaClient, "specialty" | "auditLog" | "$transaction">;

export interface AddSpecialtiesPlan {
  toCreate: (NewSpecialty & { order: number })[];
  skipped: string[];
}

export async function buildAddSpecialtiesPlan(db: Db, specialties: readonly NewSpecialty[] = NEW_SPECIALTIES): Promise<AddSpecialtiesPlan> {
  const existing = await db.specialty.findMany({ where: { slug: { in: specialties.map((s) => s.slug) } }, select: { slug: true } });
  const existingSlugs = new Set(existing.map((s) => s.slug));
  const last = await db.specialty.findFirst({ orderBy: { order: "desc" }, select: { order: true } });
  let order = (last?.order ?? -1) + 1;
  const toCreate = specialties.filter((s) => !existingSlugs.has(s.slug)).map((s) => ({ ...s, order: order++ }));
  return { toCreate, skipped: specialties.filter((s) => existingSlugs.has(s.slug)).map((s) => s.slug) };
}

export function formatAddSpecialtiesPlan(plan: AddSpecialtiesPlan): string {
  const lines = plan.toCreate.map((s) => `[ekle] ${s.slug}: "${s.name}" ikon=${s.icon} sıra=${s.order}`);
  for (const slug of plan.skipped) lines.push(`[atla] ${slug}: zaten var, dokunulmadı.`);
  if (plan.toCreate.length === 0) lines.push("Eklenecek uzmanlık yok.");
  return lines.join("\n");
}

function appLike(db: unknown): FastifyInstance {
  const log = { warn: (...a: unknown[]) => console.warn(...a), info: () => {}, error: (...a: unknown[]) => console.error(...a) };
  return { prisma: db, log } as unknown as FastifyInstance;
}

export async function applyAddSpecialtiesPlan(
  db: Db,
  plan: AddSpecialtiesPlan,
  options: { confirm?: string; operator: string; osUser: string; hostname: string; revalidate?: boolean }
): Promise<{ created: string[] }> {
  if (options.confirm !== ADD_SPECIALTIES_CONFIRM_KEY) throw new AddSpecialtiesError(`Gerçek yazma için --confirm=${ADD_SPECIALTIES_CONFIRM_KEY} gerekir.`);
  if (!options.operator.trim()) throw new AddSpecialtiesError('--operator="Ad Soyad" zorunludur.');
  if (plan.toCreate.length === 0) return { created: [] };

  await db.$transaction(async (tx) => {
    for (const s of plan.toCreate) {
      // Plan ile yazma arasında aynı slug eklenmişse benzersizlik kısıtı transaction'ı geri alır.
      await tx.specialty.create({ data: { slug: s.slug, name: s.name, icon: s.icon, description: s.description, order: s.order, isActive: true } });
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: ADD_SPECIALTIES_AUDIT_ACTION,
        targetType: "Specialty",
        targetId: null,
        metadata: { operator: options.operator, osUser: options.osUser, hostname: options.hostname, created: plan.toCreate.map((s) => s.slug) },
      },
    });
  });
  if (options.revalidate !== false) await triggerTagRevalidation(appLike(db), [CACHE_TAGS.specialties]);
  return { created: plan.toCreate.map((s) => s.slug) };
}
