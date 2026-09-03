import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * `POST /admin/users/{userId}/reset-password` — bkz. admin-users.routes.ts.
 * `sendMail()` (bkz. src/lib/mail.ts) `admin-users-create-success.test.ts` ile AYNI desende
 * mock'lanır — gerçek SMTP/Ethereal'a hiç dokunulmaz, `emailStatus` deterministik kontrol edilir.
 */
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "mocked-message-id" })));

vi.mock("../../src/lib/mail", () => ({
  sendMail: sendMailMock,
}));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashPassword } from "../../src/lib/password";
import { generateOpaqueToken, hashToken } from "../../src/lib/tokens";
import { signAccessToken } from "../../src/lib/jwt";

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

function tokenFor(user: { id: string; email: string }): string {
  return signAccessToken({ sub: user.id, email: user.email }).token;
}

async function seedPasswordResetTemplate(app: FastifyInstance) {
  // §10.16.3 — `sendTemplateEmail` `purpose` + `isActive=true` ile çözümlenir.
  await app.prisma.emailTemplate.create({
    data: {
      key: "PASSWORD_RESET",
      name: "Şifre Sıfırlama E-postası",
      purpose: "PASSWORD_RESET",
      editorMode: "RAW",
      isSystem: true,
      isActive: true,
      subject: "Şifre sıfırlama talebiniz",
      bodyHtml: '<p>Merhaba {{user_name}},</p><p><a href="{{reset_link}}">Şifremi Sıfırla</a></p>',
      availableVariables: ["user_name", "reset_link"],
    },
  });
}

async function createUserDirect(
  app: FastifyInstance,
  role: "ADMIN" | "EDITOR" | "USER",
  status: "ACTIVE" | "SUSPENDED" | "DELETED" = "ACTIVE"
) {
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `user-${crypto.randomUUID()}@example.com`,
      name: "Test Kullanıcı",
      passwordHash,
      role,
      status,
      deletedAt: status === "DELETED" ? new Date() : null,
    },
  });
}

/**
 * İş mantığı senaryoları (a-e) — TEK bir app instance'ı paylaşılır, TOPLAM 5 istek atılır
 * (`ADMIN_PASSWORD_RESET_RATE_LIMIT` route-level 5/dk sınırına TAM oturacak şekilde
 * bilinçli sayılmıştır) — hedef-bazlı 60sn bekleme (f) senaryosu bu bütçeyi bozmamak için
 * AYRI, kendi izole `buildTestApp()` instance'ında çalışan aşağıdaki describe bloğundadır
 * (bkz. tests/integration/rate-limits.test.ts'teki AYNI izolasyon deseni).
 */
describe("POST /admin/users/:userId/reset-password", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await seedPasswordResetTemplate(app);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("ADMIN başka bir kullanıcı için tetikler: 200, emailStatus:'sent', expiresAt döner, audit yazılır", async () => {
    sendMailMock.mockClear();
    const admin = await createUserDirect(app, "ADMIN");
    const target = await createUserDirect(app, "EDITOR");

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/reset-password`,
      headers: authHeader(tokenFor(admin)),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.emailStatus).toBe("sent");
    expect(body.user.id).toBe(target.id);
    expect(typeof body.expiresAt).toBe("string");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.payload).not.toMatch(/reset-password\?token=/);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { to: string; html: string }];
    expect(input.to).toBe(target.email);

    const auditEntry = await app.prisma.auditLog.findFirst({
      where: { action: "user.password_reset_initiated", targetId: target.id },
      orderBy: { createdAt: "desc" },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(admin.id);
    const metadata = auditEntry?.metadata as Record<string, unknown>;
    expect(metadata.emailStatus).toBe("sent");
    expect(metadata.self).toBe(false);
    expect(metadata.invalidatedTokenCount).toBe(0);
    // Metadata YALNIZCA izin verilen alanları taşımalı — ham token/hash/URL YAZILMAZ
    // (bkz. lib/audit.ts kuralı). `invalidatedTokenCount` anahtarı "token" kelimesini
    // İÇERDİĞİ için basit bir `/token/i` regex'i burada YANLIŞ POZİTİF üretirdi.
    expect(Object.keys(metadata).sort()).toEqual(["email", "emailStatus", "invalidatedTokenCount", "self"].sort());
    expect(JSON.stringify(metadata)).not.toMatch(/reset-password\?token=/);
  });

  it("DELETED kullanıcı için 404 döner", async () => {
    const admin = await createUserDirect(app, "ADMIN");
    const target = await createUserDirect(app, "EDITOR", "DELETED");

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/reset-password`,
      headers: authHeader(tokenFor(admin)),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("SUSPENDED kullanıcı için 409 döner", async () => {
    const admin = await createUserDirect(app, "ADMIN");
    const target = await createUserDirect(app, "EDITOR", "SUSPENDED");

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/reset-password`,
      headers: authHeader(tokenFor(admin)),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
    expect(res.json().error.message).toMatch(/askıya alınmış/i);
  });

  it("self-reset İZİNLİDİR: admin kendi userId'si için çağırabilir, metadata.self=true olur", async () => {
    sendMailMock.mockClear();
    const admin = await createUserDirect(app, "ADMIN");

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${admin.id}/reset-password`,
      headers: authHeader(tokenFor(admin)),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.id).toBe(admin.id);

    const auditEntry = await app.prisma.auditLog.findFirst({
      where: { action: "user.password_reset_initiated", targetId: admin.id },
      orderBy: { createdAt: "desc" },
    });
    const metadata = auditEntry?.metadata as Record<string, unknown>;
    expect(metadata.self).toBe(true);
  });

  it("eski kullanılmamış+süresi dolmamış token'lar yeni token üretimiyle AYNI transaction'da invalidate edilir", async () => {
    sendMailMock.mockClear();
    const admin = await createUserDirect(app, "ADMIN");
    const target = await createUserDirect(app, "EDITOR");

    // İki bekleyen (kullanılmamış, süresi dolmamış) eski token satırı elle ekle. `createdAt`
    // bilinçli olarak 2 dakika ÖNCEYE ayarlanır — aksi halde bu satırların KENDİSİ hedef-bazlı
    // 60sn bekleme kuralını (bkz. aşağıdaki AYRI describe bloğu) tetikleyip testi yanlışlıkla
    // 429'a düşürürdü; burada test edilen ŞEY invalidasyon, throttle DEĞİL.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    await app.prisma.passwordResetToken.createMany({
      data: [
        {
          userId: target.id,
          tokenHash: hashToken(generateOpaqueToken()),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          createdAt: twoMinutesAgo,
        },
        {
          userId: target.id,
          tokenHash: hashToken(generateOpaqueToken()),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          createdAt: twoMinutesAgo,
        },
      ],
    });

    const pendingBefore = await app.prisma.passwordResetToken.count({ where: { userId: target.id, usedAt: null } });
    expect(pendingBefore).toBe(2);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/reset-password`,
      headers: authHeader(tokenFor(admin)),
    });
    expect(res.statusCode).toBe(200);

    const pendingAfter = await app.prisma.passwordResetToken.findMany({ where: { userId: target.id, usedAt: null } });
    // Eski ikisi kapatıldı, sadece YENİ üretilen token bekleyen kalır.
    expect(pendingAfter).toHaveLength(1);

    const auditEntry = await app.prisma.auditLog.findFirst({
      where: { action: "user.password_reset_initiated", targetId: target.id },
      orderBy: { createdAt: "desc" },
    });
    const metadata = auditEntry?.metadata as Record<string, unknown>;
    expect(metadata.invalidatedTokenCount).toBe(2);
  });
});

/**
 * Hedef-bazlı 60 saniyelik bekleme (429) — KENDİ İZOLE `buildTestApp()` instance'ında çalışır
 * (yukarıdaki describe bloğuyla `ADMIN_PASSWORD_RESET_RATE_LIMIT` (5/dk, route-level, IP bazlı,
 * in-memory) bütçesini PAYLAŞMAMAK için — bkz. dosya başındaki not ve
 * tests/integration/rate-limits.test.ts'teki AYNI izolasyon deseni).
 */
describe("POST /admin/users/:userId/reset-password — hedef bazlı 60 saniyelik bekleme (429)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await seedPasswordResetTemplate(app);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("aynı hedef için 60 saniye içinde tekrar istek 429 döner", async () => {
    sendMailMock.mockClear();
    const admin = await createUserDirect(app, "ADMIN");
    const target = await createUserDirect(app, "EDITOR");

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/reset-password`,
      headers: authHeader(tokenFor(admin)),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/reset-password`,
      headers: authHeader(tokenFor(admin)),
    });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("RATE_LIMITED");
    expect(second.json().error.message).toMatch(/60 saniye/i);
  });
});
