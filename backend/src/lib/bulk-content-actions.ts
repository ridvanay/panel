import type { FastifyInstance } from "fastify";
import type { ContentEntityType, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { ForbiddenError } from "./errors";
import { logAudit } from "./audit";
import type { BulkContentAction, BulkContentActionResultDto } from "../schemas/entities";

/** `runBulkContentAction`'ın Prisma client'tan (dış transaction YOKKEN) veya bir `tx`'ten
 * (transaction İÇİNDEYKEN) delegate alabilmesi için ortak alt tip. */
export type ContentModelClient = PrismaClient | Prisma.TransactionClient;

/**
 * `Page`/`BlogPost`/`Product`/`PortfolioItem` toplu işlem uçlarının (bkz. ARCHITECTURE.md
 * §10.1 karar 1A) ortak ihtiyaç duyduğu Prisma delegate yüzeyi — dördü de `id`/`deletedAt`/
 * `status`/`publishedAt` kolonlarını taşır (§10.7 çöp kutusu paritesi), bu yüzden tek bir
 * generic imza yeterlidir. `where`/`data` kasıtlı olarak gevşek tiplenir (`Record<string,
 * unknown>`) — her modelin Prisma'nın ürettiği kendi `WhereInput`/`UpdateManyMutationInput`
 * tipleri farklıdır, ortak bir üst tip yoktur; tekil route'lardaki gerçek `client.page` /
 * `client.blogPost` vb. atamaları `as unknown as BulkContentDelegate` ile daraltılır.
 */
export interface BulkContentDelegate {
  findMany(args: {
    where: { id: { in: string[] } };
    select: { id: true; deletedAt: true };
  }): Promise<{ id: string; deletedAt: Date | null }[]>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
}

export interface RunBulkContentActionConfig {
  /** `app.prisma` (dış transaction yok) veya bir `tx` verildiğinde o modelin delegate'ini döner. */
  getDelegate: (client: ContentModelClient) => BulkContentDelegate;
  /** `ContentRevision.entityType` filtresi (`permanent-delete` dalındaki elle temizlik için). */
  entityType: ContentEntityType;
  /** `AuditLog.targetType` (ör. `"Page"`, `"BlogPost"`, `"Product"`, `"PortfolioItem"`). */
  targetType: string;
  /** `AuditLog.action` öneki — sonuna `bulk_<action>` eklenir (ör. `"page."` → `"page.bulk_trash"`). */
  auditActionPrefix: string;
  /**
   * `trash` dalında AYNI transaction içinde çalıştırılacak entity'ye özgü yan etki — yalnızca
   * `Page` bunu kullanır (`SiteSettings.homePageId` temizliği, bkz. ARCHITECTURE.md §10.7).
   * Verilmezse `trash` tek bir `updateMany` ile (transaction'sız) uygulanır — mevcut blog/
   * product/portfolio davranışıyla BİREBİR aynı.
   */
  onTrash?: (tx: Prisma.TransactionClient, applicableIds: string[]) => Promise<void>;
}

export interface RunBulkContentActionInput {
  ids: string[];
  action: BulkContentAction;
  actor: { id: string; email: string; role: string };
  ip?: string | undefined;
}

/**
 * `POST /admin/{pages|blog|products|portfolio}/bulk` ortak iş mantığı (bkz. ARCHITECTURE.md
 * §10.1 karar 1A, §10.7). Dört route da BUNU çağırır — davranış (dedupe, atlama kuralları,
 * `permanent-delete`'in ADMIN-only eşiği, kısmi başarı → 200 + `skippedIds`, `ContentRevision`
 * elle temizliği, tek `AuditLog` kaydı) birebir aynıdır; farklı olan yalnızca `config` (Prisma
 * delegate, `entityType`, audit öneki, `onTrash` hook'u).
 */
export async function runBulkContentAction(
  app: FastifyInstance,
  config: RunBulkContentActionConfig,
  input: RunBulkContentActionInput
): Promise<BulkContentActionResultDto> {
  const { getDelegate, entityType, targetType, auditActionPrefix, onTrash } = config;
  const { action, actor, ip } = input;
  const ids = Array.from(new Set(input.ids));

  if (action === "permanent-delete" && actor.role !== "ADMIN") {
    throw new ForbiddenError("Kalıcı silme yalnızca ADMIN'e açıktır.");
  }

  const delegate = getDelegate(app.prisma);
  const rows = await delegate.findMany({ where: { id: { in: ids } }, select: { id: true, deletedAt: true } });
  const rowById = new Map(rows.map((row) => [row.id, row]));

  const applicableIds: string[] = [];
  const skippedIds: string[] = [];

  for (const id of ids) {
    const row = rowById.get(id);
    if (!row) {
      skippedIds.push(id);
      continue;
    }

    const isTrashed = row.deletedAt !== null;
    const applicable =
      (action === "trash" && !isTrashed) ||
      (action === "restore" && isTrashed) ||
      ((action === "publish" || action === "draft") && !isTrashed) ||
      (action === "permanent-delete" && isTrashed);

    if (applicable) {
      applicableIds.push(id);
    } else {
      skippedIds.push(id);
    }
  }

  if (applicableIds.length > 0) {
    switch (action) {
      case "trash": {
        if (onTrash) {
          await app.prisma.$transaction(async (tx) => {
            await getDelegate(tx).updateMany({ where: { id: { in: applicableIds } }, data: { deletedAt: new Date() } });
            await onTrash(tx, applicableIds);
          });
        } else {
          await delegate.updateMany({ where: { id: { in: applicableIds } }, data: { deletedAt: new Date() } });
        }
        break;
      }
      case "restore": {
        await delegate.updateMany({ where: { id: { in: applicableIds } }, data: { deletedAt: null } });
        break;
      }
      case "publish": {
        await app.prisma.$transaction(async (tx) => {
          const txDelegate = getDelegate(tx);
          await txDelegate.updateMany({
            where: { id: { in: applicableIds }, publishedAt: null },
            data: { status: "PUBLISHED", publishedAt: new Date() },
          });
          await txDelegate.updateMany({
            where: { id: { in: applicableIds }, publishedAt: { not: null } },
            data: { status: "PUBLISHED" },
          });
        });
        break;
      }
      case "draft": {
        // Taslağa alma `publishedAt`'i TEMİZLEMEZ (ilk yayın tarihi kalıcıdır).
        await delegate.updateMany({ where: { id: { in: applicableIds } }, data: { status: "DRAFT" } });
        break;
      }
      case "permanent-delete": {
        // Polymorphic `ContentRevision` (FK YOK) aynı transaction'da elle silinir.
        await app.prisma.$transaction(async (tx) => {
          await tx.contentRevision.deleteMany({ where: { entityType, entityId: { in: applicableIds } } });
          await getDelegate(tx).deleteMany({ where: { id: { in: applicableIds } } });
        });
        break;
      }
    }

    await logAudit(app, {
      actorId: actor.id,
      actorEmail: actor.email,
      action: `${auditActionPrefix}bulk_${action}`,
      targetType,
      metadata: { ids: applicableIds, skippedIds },
      ipAddress: ip,
    });
  }

  return {
    action,
    requestedCount: ids.length,
    affectedCount: applicableIds.length,
    skippedIds,
  };
}
