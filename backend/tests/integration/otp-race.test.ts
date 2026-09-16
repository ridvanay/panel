import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashOtpCode, issueVerificationCode, RESEND_COOLDOWN_MS } from "../../src/lib/otp";
import { hashPassword } from "../../src/lib/password";

/**
 * Kök neden — canlı ortam log analizi (bkz. görev raporu): aynı milisaniyede eşzamanlı iki
 * `POST /auth/resend-verification-code` isteği ikisi de `202` dönmüştü. `lib/otp.ts::
 * issueVerificationCode` eskiden cooldown OKUMASI ile eski-kodu-geçersiz-kıl + yeni-kod-YAZ
 * adımlarını AYRI adımlarda yapıyordu — iki eşzamanlı çağrı ikisi de cooldown kontrolünü
 * (henüz diğerinin yazdığını görmeden) geçip İKİ farklı "canlı" kod üretebiliyordu. Kullanıcı
 * e-postasında gördüğü (artık "en son" olmayan) kodu girince `consumeVerificationCode`
 * (HER ZAMAN `orderBy: createdAt desc` ile TEK bir satırı arar) 401 döndürüyordu.
 *
 * Bu dosya düzeltmeyi (`runSerializable` ile tek bir Serializable transaction) GERÇEK Postgres'e
 * karşı, GERÇEK eşzamanlı çağrılarla (`Promise.all`, mock'lu sahte eşzamanlılık DEĞİL) doğrular.
 */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

describe("issueVerificationCode — gerçek eşzamanlılıkta ikinci bir 'canlı' kod ÜRETİLMEZ (race-condition regresyonu)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("iki eşzamanlı issueVerificationCode çağrısı (aynı userId+purpose, hiç önceki kod yok) — en fazla BİR canlı satır kalır, ve bu satır dönen kodlardan biriyle EŞLEŞİR", async () => {
    const user = await app.prisma.user.create({
      data: { email: uniqueEmail("race-fresh"), passwordHash: await hashPassword("Sifre12345!"), name: "Race Fresh" },
    });

    const [r1, r2] = await Promise.all([
      issueVerificationCode(app, user.id, "EMAIL_VERIFICATION"),
      issueVerificationCode(app, user.id, "EMAIL_VERIFICATION"),
    ]);

    const liveRows = await app.prisma.emailVerificationCode.findMany({
      where: { userId: user.id, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    });
    // Eski (race'e açık) davranışta bu ARADA SIRADA 2 olabiliyordu — asıl regresyon iddiası budur.
    expect(liveRows).toHaveLength(1);

    const successful = [r1, r2].filter((r): r is NonNullable<typeof r> => r !== null);
    expect(successful.length).toBeGreaterThanOrEqual(1);

    // Tek canlı satırın hash'i, BAŞARILI dönen çağrılardan EN AZ BİRİNİN kodu ile eşleşmeli —
    // yani kullanıcıya (e-postayla) giden koddan biri HER ZAMAN "en son/geçerli" koddur.
    const liveHash = liveRows[0]!.codeHash;
    const matching = successful.find((r) => hashOtpCode(user.id, "EMAIL_VERIFICATION", r.code) === liveHash);
    expect(matching).toBeDefined();

    // Ve bu kod gerçekten TÜKETİLEBİLİR (401 YOK) — orijinal kullanıcı raporunun tam tersi.
    const { consumeVerificationCode } = await import("../../src/lib/otp");
    await expect(consumeVerificationCode(app, user.id, "EMAIL_VERIFICATION", matching!.code)).resolves.toBeUndefined();
  });

  it("HTTP seviyesinde — iki eşzamanlı POST /auth/resend-verification-code, cooldown'un DIŞINDaki mevcut bir kod üzerinden — en fazla BİR canlı satır kalır", async () => {
    const email = uniqueEmail("race-resend");
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email, password: "Sifre12345!", name: "Race Resend" },
    });
    expect(registerRes.statusCode).toBe(202);

    const user = await app.prisma.user.findUniqueOrThrow({ where: { email } });
    // register()'ın ÜRETTİĞİ ilk kodu cooldown DIŞINA it — iki eşzamanlı resend'in ikisinin de
    // "yeni kod üretmeye çalışabileceği" gerçekçi bir yarış durumu kurulur (görev raporundaki
    // canlı log deseniyle AYNI: art arda gelen resend-verification-code çağrıları).
    await app.prisma.emailVerificationCode.updateMany({
      where: { userId: user.id, purpose: "EMAIL_VERIFICATION", consumedAt: null },
      data: { createdAt: new Date(Date.now() - (RESEND_COOLDOWN_MS + 1000)) },
    });

    const [res1, res2] = await Promise.all([
      app.inject({ method: "POST", url: "/api/v1/auth/resend-verification-code", payload: { email } }),
      app.inject({ method: "POST", url: "/api/v1/auth/resend-verification-code", payload: { email } }),
    ]);
    // Route sözleşmesi (§3.6) — cooldown/tavana bakılmaksızın HER ZAMAN 202 (numaralandırma karşıtı).
    expect(res1.statusCode).toBe(202);
    expect(res2.statusCode).toBe(202);

    const liveRows = await app.prisma.emailVerificationCode.findMany({
      where: { userId: user.id, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    });
    expect(liveRows).toHaveLength(1);
  });
});
