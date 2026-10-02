import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";

/**
 * `docs/prompts/2026-10-02-wm-health-duzeltme-1.md` madde 2 (son fıkra) — scripts/
 * update-vahit-mutlu-profile.ts için script-smoke-test: gerçek "Vahit Mutlu" prod verisi
 * YERİNE izole bir test doktoru/uzmanlıkları kullanılır (test DB'de oluşturulur, test
 * sonunda `resetDatabase` ile temizlenir). Script KENDİ `PrismaClient`'ını açtığı ve
 * modül importunda `main()`'i HEMEN çalıştırdığı için `env-demo-payments-boot-guard.test.ts`
 * İLE AYNI desen kullanılır: script AYRI bir alt process'te (`tsx` ile) çalıştırılır, test
 * yalnızca exit code + DB'deki SONUCU doğrular.
 */

const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/update-vahit-mutlu-profile.ts");
// `node_modules/.bin/tsx` platforma göre `.cmd`/`.ps1` gerektirir (Windows) — tsx'in KENDİ CLI
// giriş noktası doğrudan `node` ile çalıştırılır (platformdan bağımsız, shell GEREKMEZ, bkz.
// tests/unit/env-demo-payments-boot-guard.test.ts İLE AYNI gerekçe).
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");

function runScript(args: string[] = []) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env },
    encoding: "utf8",
  });
}

describe("scripts/update-vahit-mutlu-profile.ts — script-smoke-test (izole test doktoru)", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  /**
   * `DOCTOR_SLUG = "vahit-mutlu"` script'te SABİT — test izolasyonu bunun slug'ını
   * TEKRARLAMAK yerine `fullName` eşleşmesine (`contains "Vahit Mutlu"`) güvenir, ancak
   * yine de GERÇEK prod slug'ını ("vahit-mutlu") kullanır çünkü script bunu arar; bu test
   * DB'si `resetDatabase` ile İZOLE olduğu için prod/dev verisiyle ÇAKIŞMAZ.
   */
  async function seedDoctor(overrides: { specialtyId?: string | null; subSpecialty?: string | null } = {}) {
    const doctor = await prisma.doctorProfile.create({
      data: {
        title: "Dr.",
        fullName: "Vahit Mutlu",
        slug: "vahit-mutlu",
        bio: "Test amaçlı doktor profili.",
        languages: ["tr"],
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 30,
        sessionPriceCents: 50000,
        isActive: true,
        specialtyId: overrides.specialtyId ?? null,
        subSpecialty: overrides.subSpecialty ?? null,
      },
    });
    return doctor;
  }

  async function seedSpecialties() {
    const obesity = await prisma.specialty.create({
      data: { name: "Obesity & Metabolic Surgery", slug: `obesity-${crypto.randomUUID()}`, icon: "heart-pulse" },
    });
    const oncology = await prisma.specialty.create({
      data: { name: "Surgical Oncology", slug: `oncology-${crypto.randomUUID()}`, icon: "brain" },
    });
    return { obesity, oncology };
  }

  it("`--dry-run` hiçbir şey YAZMAZ; DB'de değişiklik OLMAZ", async () => {
    const { obesity } = await seedSpecialties();
    await seedDoctor();

    const result = runScript(["--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[dry-run]");
    expect(result.stdout).toContain("[ÖNCESİ]");

    const doctorAfter = await prisma.doctorProfile.findUniqueOrThrow({ where: { slug: "vahit-mutlu" } });
    expect(doctorAfter.specialtyId).toBeNull();
    expect(doctorAfter.title).toBe("Dr.");
    const additionalCount = await prisma.doctorAdditionalSpecialty.count();
    expect(additionalCount).toBe(0);
    void obesity;
  });

  it("specialtyId NULL iken Obesity & Metabolic Surgery'ye bağlanır, Surgical Oncology EK uzmanlık olarak eklenir; title/aboutHtml/socialLinks hedef değere güncellenir", async () => {
    const { obesity, oncology } = await seedSpecialties();
    const doctor = await seedDoctor({ subSpecialty: "Mevcut alt uzmanlık metni" });

    const result = runScript();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[fix]");

    const updated = await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctor.id } });
    expect(updated.specialtyId).toBe(obesity.id);
    expect(updated.title).toBe("Assoc. Prof. Dr.");
    // `subSpecialty`'ye ARTIK DOKUNULMAZ (düzeltme-1 madde 2) — mevcut değer KORUNUR.
    expect(updated.subSpecialty).toBe("Mevcut alt uzmanlık metni");
    expect(updated.aboutHtml).toContain("Erzincan");
    expect((updated.socialLinks as unknown[]).length).toBe(4);

    const additional = await prisma.doctorAdditionalSpecialty.findMany({ where: { doctorId: doctor.id } });
    expect(additional).toHaveLength(1);
    expect(additional[0]?.specialtyId).toBe(oncology.id);
  });

  it("specialtyId ZATEN dolu (Obesity/Oncology DIŞINDA bir uzmanlık) ise EZİLMEZ; HER İKİSİ DE ek uzmanlık olur", async () => {
    const { obesity, oncology } = await seedSpecialties();
    const thirdSpecialty = await prisma.specialty.create({
      data: { name: `Cardiology ${crypto.randomUUID()}`, slug: `cardiology-${crypto.randomUUID()}`, icon: "heart-pulse" },
    });
    const doctor = await seedDoctor({ specialtyId: thirdSpecialty.id });

    const result = runScript();
    expect(result.status).toBe(0);

    const updated = await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctor.id } });
    // `specialtyId` KOŞULSUZ EZİLMEZ — zaten dolu, OLDUĞU GİBİ kalır.
    expect(updated.specialtyId).toBe(thirdSpecialty.id);

    const additional = await prisma.doctorAdditionalSpecialty.findMany({ where: { doctorId: doctor.id } });
    const additionalIds = additional.map((a) => a.specialtyId).sort();
    expect(additionalIds).toEqual([obesity.id, oncology.id].sort());
  });

  it("idempotent — script İKİ KEZ art arda çalıştırılınca aynı hedef duruma gelir, hata VERMEZ, ek uzmanlık SATIRI TEKRARLAMAZ", async () => {
    await seedSpecialties();
    const doctor = await seedDoctor();

    const first = runScript();
    expect(first.status).toBe(0);
    const second = runScript();
    expect(second.status).toBe(0);

    const additional = await prisma.doctorAdditionalSpecialty.findMany({ where: { doctorId: doctor.id } });
    expect(additional).toHaveLength(1);

    const updated = await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctor.id } });
    expect(updated.title).toBe("Assoc. Prof. Dr.");
  });

  it("hedef doktor bulunamazsa script HATA ile çıkar (exit code != 0), sessiz no-op YAPMAZ", async () => {
    await seedSpecialties();
    // Doktor OLUŞTURULMADI.
    const result = runScript(["--dry-run"]);
    expect(result.status).not.toBe(0);
  });
});
