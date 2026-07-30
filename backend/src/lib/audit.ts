import type { FastifyInstance } from "fastify";
import type { AuditStatus, Prisma } from "@prisma/client";

interface AuditInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  status?: AuditStatus;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

/**
 * Admin panelindeki hassas aksiyonların değişmez kaydını yazar. Hata durumunda
 * (DB'ye ulaşılamaması vb.) sessizce loglar — audit yazımı asıl isteği asla düşürmemeli.
 *
 * KURAL: `metadata`'ya asla token/URL/şifre yazma.
 */
export async function logAudit(app: FastifyInstance, input: AuditInput): Promise<void> {
  try {
    const data: Prisma.AuditLogUncheckedCreateInput = {
      ...input,
      status: input.status ?? "SUCCESS",
      // Prisma'nın nullable Json alanı için `null` yerine alanı tamamen atlıyoruz —
      // sütun zaten @default olmadan NULL'a düşer, `Prisma.JsonNull` göndermeye gerek yok.
      metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
    };
    await app.prisma.auditLog.create({ data });
  } catch (err) {
    app.log.error({ err }, "Audit log yazılamadı");
  }
}
