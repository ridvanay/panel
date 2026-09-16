import { describe, expect, it } from "vitest";
import type { EmailVerificationPurpose } from "@prisma/client";
import {
  DAILY_ISSUE_CAP,
  MAX_VERIFICATION_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  consumeVerificationCode,
  generateOtpCode,
  hashOtpCode,
  issueVerificationCode,
} from "../../src/lib/otp";
import { VerificationCodeInvalidError } from "../../src/lib/errors";

/**
 * `.claude/architect-scope-guest-account-otp.md` §3/§9 backend-agent madde 8 + `.claude/security-
 * review-guest-account-otp.md` "Backend-agent'a iletilecek uygulama kontrol listesi" — bu dosya
 * `lib/otp.ts`'in kritik davranışlarını DB'ye dokunmadan (hafif, bellek-içi bir sahte Prisma
 * istemcisiyle) doğrular. Gerçek Postgres'e karşı uçtan uca akış için bkz.
 * tests/integration/auth.test.ts + tests/helpers/auth.ts::registerTestUser.
 */

interface FakeCodeRow {
  id: string;
  userId: string;
  purpose: EmailVerificationPurpose;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
  createdAt: Date;
}

function makeFakeApp() {
  const rows: FakeCodeRow[] = [];
  let idCounter = 0;

  function matchesWhere(row: FakeCodeRow, where: Record<string, unknown>): boolean {
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.purpose !== undefined && row.purpose !== where.purpose) return false;
    if (where.consumedAt !== undefined && where.consumedAt === null && row.consumedAt !== null) return false;
    if (where.createdAt && typeof where.createdAt === "object" && "gte" in (where.createdAt as object)) {
      const gte = (where.createdAt as { gte: Date }).gte;
      if (row.createdAt.getTime() < gte.getTime()) return false;
    }
    return true;
  }

  const prisma = {
    emailVerificationCode: {
      findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt: "asc" | "desc" } }) => {
        let result = rows.filter((r) => matchesWhere(r, where));
        if (orderBy?.createdAt === "desc") result = [...result].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return result;
      },
      findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt: "asc" | "desc" } }) => {
        let result = rows.filter((r) => matchesWhere(r, where));
        if (orderBy?.createdAt === "desc") result = [...result].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return result[0] ?? null;
      },
      create: async ({ data }: { data: Omit<FakeCodeRow, "id" | "consumedAt" | "attemptCount" | "createdAt"> }) => {
        const row: FakeCodeRow = { id: `row-${idCounter++}`, consumedAt: null, attemptCount: 0, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<FakeCodeRow> }) => {
        let count = 0;
        for (const row of rows) {
          if (matchesWhere(row, where)) {
            Object.assign(row, data);
            count++;
          }
        }
        return { count };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error("row not found");
        if (data.attemptCount && typeof data.attemptCount === "object" && "increment" in (data.attemptCount as object)) {
          row.attemptCount += (data.attemptCount as { increment: number }).increment;
        } else if (data.attemptCount !== undefined) {
          row.attemptCount = data.attemptCount as number;
        }
        if (data.consumedAt !== undefined) row.consumedAt = data.consumedAt as Date | null;
        return row;
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  return { app: { prisma } as unknown as import("fastify").FastifyInstance, rows };
}

describe("generateOtpCode", () => {
  it("always produces a 6-digit numeric string, leading zeros preserved", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe("hashOtpCode", () => {
  it("throws VerificationCodeInvalidError for non-6-digit input (format guard before HMAC)", () => {
    expect(() => hashOtpCode("user-1", "EMAIL_VERIFICATION", "12345")).toThrow(VerificationCodeInvalidError);
    expect(() => hashOtpCode("user-1", "EMAIL_VERIFICATION", "abcdef")).toThrow(VerificationCodeInvalidError);
  });

  it("is deterministic for the same (userId, purpose, code)", () => {
    const a = hashOtpCode("user-1", "EMAIL_VERIFICATION", "048213");
    const b = hashOtpCode("user-1", "EMAIL_VERIFICATION", "048213");
    expect(a).toBe(b);
  });

  it("produces a different hash for a different userId (cross-user collision impossible)", () => {
    const a = hashOtpCode("user-1", "EMAIL_VERIFICATION", "048213");
    const b = hashOtpCode("user-2", "EMAIL_VERIFICATION", "048213");
    expect(a).not.toBe(b);
  });

  it("produces a different hash for a different purpose (purpose binding at the hash level)", () => {
    const a = hashOtpCode("user-1", "EMAIL_VERIFICATION", "048213");
    const b = hashOtpCode("user-1", "ACCOUNT_ACTIVATION", "048213");
    expect(a).not.toBe(b);
  });
});

describe("issueVerificationCode + consumeVerificationCode — integration over a fake DB", () => {
  it("issues a code and successfully consumes it", async () => {
    const { app } = makeFakeApp();
    const issued = await issueVerificationCode(app, "user-1", "EMAIL_VERIFICATION");
    expect(issued).not.toBeNull();
    expect(issued!.code).toMatch(/^\d{6}$/);

    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", issued!.code)).resolves.toBeUndefined();
  });

  it("rejects a wrong code with VerificationCodeInvalidError", async () => {
    const { app } = makeFakeApp();
    const issued = await issueVerificationCode(app, "user-1", "EMAIL_VERIFICATION");
    const wrongCode = issued!.code === "000000" ? "111111" : "000000";

    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", wrongCode)).rejects.toBeInstanceOf(VerificationCodeInvalidError);
  });

  it("dies after MAX_VERIFICATION_ATTEMPTS (5) wrong attempts — even the correct code stops working", async () => {
    const { app } = makeFakeApp();
    const issued = await issueVerificationCode(app, "user-1", "EMAIL_VERIFICATION");
    const wrongCode = issued!.code === "000000" ? "111111" : "000000";

    for (let i = 0; i < MAX_VERIFICATION_ATTEMPTS; i++) {
      await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", wrongCode)).rejects.toBeInstanceOf(VerificationCodeInvalidError);
    }

    // attemptCount artık 5 — kod ÖLÜ, DOĞRU kod bile artık kabul edilmez.
    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", issued!.code)).rejects.toBeInstanceOf(VerificationCodeInvalidError);
  });

  it("a newly issued code invalidates the previous live code (only one live code at a time)", async () => {
    const { app, rows } = makeFakeApp();
    const first = await issueVerificationCode(app, "user-1", "EMAIL_VERIFICATION");
    expect(first).not.toBeNull();

    // İkinci `issueVerificationCode` çağrısı normalde 60 sn cooldown'a takılır — burada YALNIZCA
    // "eski kod geçersiz kılınır mı" davranışını izole test etmek için ilk satırın `createdAt`'ini
    // doğrudan geçmişe alıyoruz (cooldown/tavan kontrolünün KENDİSİ ayrı testlerde zaten kapsanıyor).
    rows[0]!.createdAt = new Date(Date.now() - (RESEND_COOLDOWN_MS + 1000));

    const second = await issueVerificationCode(app, "user-1", "EMAIL_VERIFICATION");
    expect(second).not.toBeNull();
    expect(second!.code).not.toBeNull();

    // Eski kod artık ÖLÜ (consumedAt SET edildi) — DOĞRU olsa bile kabul edilmez.
    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", first!.code)).rejects.toBeInstanceOf(VerificationCodeInvalidError);
    // Yeni kod ÇALIŞIR.
    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", second!.code)).resolves.toBeUndefined();
  });

  it("purpose binding: a code issued for EMAIL_VERIFICATION cannot be consumed as ACCOUNT_ACTIVATION and vice versa", async () => {
    const { app } = makeFakeApp();
    const emailCode = await issueVerificationCode(app, "user-1", "EMAIL_VERIFICATION");
    const activationCode = await issueVerificationCode(app, "user-1", "ACCOUNT_ACTIVATION");

    await expect(consumeVerificationCode(app, "user-1", "ACCOUNT_ACTIVATION", emailCode!.code)).rejects.toBeInstanceOf(VerificationCodeInvalidError);
    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", activationCode!.code)).rejects.toBeInstanceOf(VerificationCodeInvalidError);

    // Doğru amaçla hâlâ çalışır.
    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", emailCode!.code)).resolves.toBeUndefined();
  });

  it("consumeVerificationCode with userId=null always fails, but performs a real HMAC+DB lookup (no early return / timing oracle)", async () => {
    const { app } = makeFakeApp();
    await expect(consumeVerificationCode(app, null, "EMAIL_VERIFICATION", "123456")).rejects.toBeInstanceOf(VerificationCodeInvalidError);
  });

  it("rejects a malformed code (wrong length/letters) with the SAME error, and still increments attemptCount on the live row (security-review checklist 7c)", async () => {
    const { app, rows } = makeFakeApp();
    const issued = await issueVerificationCode(app, "user-1", "EMAIL_VERIFICATION");

    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", "12")).rejects.toBeInstanceOf(VerificationCodeInvalidError);
    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", "abcdef")).rejects.toBeInstanceOf(VerificationCodeInvalidError);
    expect(rows.find((r) => r.userId === "user-1")!.attemptCount).toBe(2);

    // Bir sonraki (doğru) deneme hâlâ çalışmalı (henüz 5 denemeye ulaşılmadı).
    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", issued!.code)).resolves.toBeUndefined();
  });

  it("timingSafeEqual length mismatch degrades to a normal 401 (VerificationCodeInvalidError), never a 500/thrown TypeError (security-review checklist 7a)", async () => {
    const { app, rows } = makeFakeApp();
    // Gerçekte imkânsız bir durumu simüle eder (DB'de bozuk/farklı uzunlukta bir hash) —
    // `crypto.timingSafeEqual`'in uzunluk uyuşmazlığında fırlattığı hatanın `lib/otp.ts` içinde
    // YUTULUP sessizce `false`'a düştüğünü (401 döndüğünü, ASLA yukarı sızmadığını) kanıtlar.
    rows.push({
      id: "mismatched-length-1",
      userId: "user-1",
      purpose: "EMAIL_VERIFICATION",
      codeHash: "deadbeef", // 64 hex karakter DEĞİL — timingSafeEqual normalde burada throw eder.
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      consumedAt: null,
      attemptCount: 0,
      createdAt: new Date(),
    });

    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", "123456")).rejects.toBeInstanceOf(VerificationCodeInvalidError);
  });

  it("issueVerificationCode returns null (no code produced) when called again within the 60s cooldown", async () => {
    const { app } = makeFakeApp();
    await issueVerificationCode(app, "user-1", "EMAIL_VERIFICATION");
    const second = await issueVerificationCode(app, "user-1", "EMAIL_VERIFICATION");
    expect(second).toBeNull();
  });

  it("issueVerificationCode returns null once the daily cap is reached", async () => {
    const { app, rows } = makeFakeApp();
    // DAILY_ISSUE_CAP kadar satırı doğrudan geçmişte (cooldown dışında) oluşturuyoruz.
    const now = Date.now();
    for (let i = 0; i < DAILY_ISSUE_CAP; i++) {
      rows.push({
        id: `preset-${i}`,
        userId: "user-1",
        purpose: "EMAIL_VERIFICATION",
        codeHash: "x",
        expiresAt: new Date(now + 10 * 60 * 1000),
        consumedAt: new Date(now - (i + 1) * (RESEND_COOLDOWN_MS + 1000)),
        attemptCount: 0,
        createdAt: new Date(now - (i + 1) * (RESEND_COOLDOWN_MS + 1000)),
      });
    }

    const result = await issueVerificationCode(app, "user-1", "EMAIL_VERIFICATION");
    expect(result).toBeNull();
  });

  it("an EXPIRED live code is rejected the same way as a wrong code (no distinguishing error)", async () => {
    const { app, rows } = makeFakeApp();
    rows.push({
      id: "expired-1",
      userId: "user-1",
      purpose: "EMAIL_VERIFICATION",
      codeHash: hashOtpCode("user-1", "EMAIL_VERIFICATION", "555555"),
      expiresAt: new Date(Date.now() - 1000), // zaten süresi dolmuş
      consumedAt: null,
      attemptCount: 0,
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
    });

    await expect(consumeVerificationCode(app, "user-1", "EMAIL_VERIFICATION", "555555")).rejects.toBeInstanceOf(VerificationCodeInvalidError);
  });
});
