import type { FastifyInstance } from "fastify";
import type { ApiKey, User } from "@prisma/client";
import { generateApiKey, invalidateApiKeyCache } from "../../lib/api-key";
import { logAudit } from "../../lib/audit";
import { ConflictError, NotFoundError } from "../../lib/errors";
import type { CreateApiKeyRequestDto, UpdateApiKeyRequestDto } from "./api-keys.schemas";

export type ApiKeyWithCreator = ApiKey & { createdBy: User | null };

const WITH_CREATOR = { createdBy: true } as const;

interface Actor {
  id: string;
  email: string;
  ip?: string;
}

/**
 * §10.13.3 — anahtar üretimi burada değil `lib/api-key.ts::generateApiKey`'de (kripto/format
 * mantığı tek yerde). Bu servis yalnızca kalıcılaştırma + audit + cache invalidasyonunu yönetir.
 */
export async function createApiKey(
  app: FastifyInstance,
  input: CreateApiKeyRequestDto,
  actor: Actor
): Promise<{ apiKey: ApiKeyWithCreator; plainKey: string }> {
  const generated = generateApiKey();

  const row = await app.prisma.apiKey.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      last4: generated.last4,
      scope: input.scope ?? "READ",
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdById: actor.id,
    },
    include: WITH_CREATOR,
  });

  await logAudit(app, {
    actorId: actor.id,
    actorEmail: actor.email,
    action: "api_key.create",
    targetType: "ApiKey",
    targetId: row.id,
    // `plainKey`/`keyHash` ASLA metadata'ya yazılmaz (bkz. lib/audit.ts kuralı, §10.13.10).
    metadata: { name: row.name, scope: row.scope },
    ipAddress: actor.ip,
  });

  return { apiKey: row, plainKey: generated.plainKey };
}

/** §10.13.10 — `seq desc` (en yeni anahtar önce, openapi.yaml `GET /admin/settings/api-keys` açıklaması). */
export async function listApiKeys(
  app: FastifyInstance,
  query: { cursorSeq?: number; limit: number; status?: "ACTIVE" | "REVOKED" }
): Promise<ApiKeyWithCreator[]> {
  return app.prisma.apiKey.findMany({
    where: {
      ...(query.cursorSeq ? { seq: { lt: query.cursorSeq } } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
    orderBy: { seq: "desc" },
    take: query.limit,
    include: WITH_CREATOR,
  });
}

async function findApiKeyOrThrow(app: FastifyInstance, keyId: string): Promise<ApiKeyWithCreator> {
  const row = await app.prisma.apiKey.findUnique({ where: { id: keyId }, include: WITH_CREATOR });
  if (!row) throw new NotFoundError("API anahtarı bulunamadı.");
  return row;
}

export async function updateApiKey(
  app: FastifyInstance,
  keyId: string,
  input: UpdateApiKeyRequestDto,
  actor: Actor
): Promise<ApiKeyWithCreator> {
  const existing = await findApiKeyOrThrow(app, keyId);

  const row = await app.prisma.apiKey.update({
    where: { id: keyId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } : {}),
    },
    include: WITH_CREATOR,
  });

  // §10.13.4 — güncelleme doğrulama cache'ini ANINDA temizler (scope/expiresAt değişmiş olabilir).
  invalidateApiKeyCache(existing.keyPrefix);

  await logAudit(app, {
    actorId: actor.id,
    actorEmail: actor.email,
    action: "api_key.update",
    targetType: "ApiKey",
    targetId: row.id,
    metadata: { fields: Object.keys(input) },
    ipAddress: actor.ip,
  });

  return row;
}

export async function revokeApiKey(app: FastifyInstance, keyId: string, actor: Actor): Promise<ApiKeyWithCreator> {
  const existing = await findApiKeyOrThrow(app, keyId);
  if (existing.status === "REVOKED") {
    throw new ConflictError("API anahtarı zaten iptal edilmiş.");
  }

  const row = await app.prisma.apiKey.update({
    where: { id: keyId },
    data: { status: "REVOKED", revokedAt: new Date(), revokedById: actor.id },
    include: WITH_CREATOR,
  });

  invalidateApiKeyCache(existing.keyPrefix);

  await logAudit(app, {
    actorId: actor.id,
    actorEmail: actor.email,
    action: "api_key.revoke",
    targetType: "ApiKey",
    targetId: row.id,
    ipAddress: actor.ip,
  });

  return row;
}

export async function deleteApiKey(app: FastifyInstance, keyId: string, actor: Actor): Promise<void> {
  const existing = await findApiKeyOrThrow(app, keyId);

  await app.prisma.apiKey.delete({ where: { id: keyId } });
  invalidateApiKeyCache(existing.keyPrefix);

  await logAudit(app, {
    actorId: actor.id,
    actorEmail: actor.email,
    action: "api_key.delete",
    targetType: "ApiKey",
    targetId: keyId,
    ipAddress: actor.ip,
  });
}
