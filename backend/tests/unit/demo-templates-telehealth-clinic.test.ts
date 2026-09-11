import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TELEHEALTH_CLINIC_TEMPLATE } from "../../src/modules/demo-templates/templates/telehealth-clinic";
import { PageBlockListSchema } from "../../src/modules/pages/pages.schemas";
import { SlideLayersSchema } from "../../src/modules/sliders/lib/layers";
import { resolvePageBlockTokens } from "../../src/modules/demo-templates/lib/asset-tokens";
import {
  assertDemoTemplateCaps,
  MAX_TEMPLATE_DOCTOR_AVAILABILITY,
  MAX_TEMPLATE_DOCTORS,
  MAX_TEMPLATE_SPECIALTIES,
  REQUIRED_DEMO_DOCTOR_BIO_SENTENCE,
  type DemoTemplateDefinition,
} from "../../src/modules/demo-templates/types";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * `.claude/architect-scope-telehealth-template.md` §6/§9.6 kabul kriterleri — `demo-templates-
 * ecommerce-pro.test.ts` ile AYNI disiplin, `telehealth-clinic`'e uygulanır + §3.6/§2.5'in
 * ("örnek randevu YOK", "hiçbir User satırı YOK") kodda fiilen doğru olduğu doğrulanır.
 */
describe("telehealth-clinic demo şablonu — şema uygunluğu", () => {
  const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";

  function resolveWithPlaceholders() {
    const assetMap = new Map(TELEHEALTH_CLINIC_TEMPLATE.assets.map((asset) => [asset.key, `/uploads/${asset.key}.png`]));
    const specialtySlugMap = new Map((TELEHEALTH_CLINIC_TEMPLATE.telehealth?.specialties ?? []).map((s) => [s.slug, "placeholder-slug"]));
    return resolvePageBlockTokens(
      TELEHEALTH_CLINIC_TEMPLATE.page.blocks as unknown[],
      assetMap,
      TELEHEALTH_CLINIC_TEMPLATE.slider ? PLACEHOLDER_UUID : null,
      null,
      null,
      specialtySlugMap
    );
  }

  it("page.blocks PageBlockListSchema'dan geçer (asset/ref/ref:specialty-slug token'ları çözülmüş hâliyle)", () => {
    const resolved = resolveWithPlaceholders();
    expect(resolved.unresolvedTokens).toEqual([]);

    const result = PageBlockListSchema.safeParse(resolved.blocks);
    if (!result.success) {
      expect(result.error.issues).toEqual([]);
    }
    expect(result.success).toBe(true);
  });

  it("slider.slides[].layers her biri SlideLayersSchema'dan geçer", () => {
    const slider = TELEHEALTH_CLINIC_TEMPLATE.slider;
    expect(slider).not.toBeNull();
    expect(slider!.slides.length).toBeGreaterThan(0);
    for (const slide of slider!.slides) {
      const result = SlideLayersSchema.safeParse(slide.layers);
      if (!result.success) {
        expect(result.error.issues).toEqual([]);
      }
      expect(result.success).toBe(true);
    }
  });

  it("hero slaydı bgType: gradient taşır ve varlık gerektirmez (§6.3 madde 2)", () => {
    const slide = TELEHEALTH_CLINIC_TEMPLATE.slider!.slides[0]!;
    expect(slide.bgType).toBe("gradient");
    expect(slide.bgAssetKey).toBeNull();
    expect(slide.bgGradientFrom).toBe("#0F766E");
    expect(slide.bgGradientTo).toBe("#0369A1");
  });

  it("extraPages[].blocks her biri PageBlockListSchema'dan geçer (4 yasal yer tutucu sayfa)", () => {
    expect(TELEHEALTH_CLINIC_TEMPLATE.extraPages.length).toBe(4);
    for (const extraPage of TELEHEALTH_CLINIC_TEMPLATE.extraPages) {
      expect(extraPage.isLegalDocument).toBe(true);
      const result = PageBlockListSchema.safeParse(extraPage.blocks);
      if (!result.success) {
        expect(result.error.issues).toEqual([]);
      }
      expect(result.success).toBe(true);
    }
  });

  it("assets[].key benzersizdir ve assets[].file yol ayracı içermez", () => {
    const keys = TELEHEALTH_CLINIC_TEMPLATE.assets.map((asset) => asset.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const asset of TELEHEALTH_CLINIC_TEMPLATE.assets) {
      expect(asset.file).not.toMatch(/[\\/]/);
    }
  });

  it("HER asset:/ref:slider/ref:specialty-slug token'ı çözülebilir", () => {
    const resolved = resolveWithPlaceholders();
    expect(resolved.unresolvedTokens).toEqual([]);
  });

  it("doktorların avatarAssetKey referansları assets[]'te tanımlı", () => {
    const definedKeys = new Set(TELEHEALTH_CLINIC_TEMPLATE.assets.map((asset) => asset.key));
    for (const doctor of TELEHEALTH_CLINIC_TEMPLATE.telehealth?.doctors ?? []) {
      if (doctor.avatarAssetKey) expect(definedKeys.has(doctor.avatarAssetKey)).toBe(true);
    }
  });

  it("doktorların specialtySlug'ı telehealth.specialties'te tanımlı", () => {
    const specialtySlugs = new Set((TELEHEALTH_CLINIC_TEMPLATE.telehealth?.specialties ?? []).map((s) => s.slug));
    for (const doctor of TELEHEALTH_CLINIC_TEMPLATE.telehealth?.doctors ?? []) {
      if (doctor.specialtySlug) expect(specialtySlugs.has(doctor.specialtySlug)).toBe(true);
    }
  });

  it("§6.1/§9.6 tavanları: uzmanlık ≤ 12, doktor ≤ 8, doktor başına müsaitlik ≤ 21", () => {
    const specialties = TELEHEALTH_CLINIC_TEMPLATE.telehealth?.specialties ?? [];
    const doctors = TELEHEALTH_CLINIC_TEMPLATE.telehealth?.doctors ?? [];
    expect(specialties.length).toBeLessThanOrEqual(MAX_TEMPLATE_SPECIALTIES);
    expect(doctors.length).toBeLessThanOrEqual(MAX_TEMPLATE_DOCTORS);
    for (const doctor of doctors) {
      expect(doctor.availability.length).toBeLessThanOrEqual(MAX_TEMPLATE_DOCTOR_AVAILABILITY);
    }
  });

  it("§7.2 madde 1 — TÜM demo doktorlar isVerified: false (tip düzeyinde literal)", () => {
    for (const doctor of TELEHEALTH_CLINIC_TEMPLATE.telehealth?.doctors ?? []) {
      expect(doctor.isVerified).toBe(false);
    }
  });

  it("§7.2 madde 3 — HER doktorun bio'sunun İLK CÜMLESİ zorunlu demo uyarısıdır", () => {
    for (const doctor of TELEHEALTH_CLINIC_TEMPLATE.telehealth?.doctors ?? []) {
      expect(doctor.bio.startsWith(REQUIRED_DEMO_DOCTOR_BIO_SENTENCE)).toBe(true);
    }
  });

  it("§7.2 madde 5 — doktorlar FARKLI saat dilimlerindedir (çeşitlilik denetimi)", () => {
    const timeZones = new Set((TELEHEALTH_CLINIC_TEMPLATE.telehealth?.doctors ?? []).map((d) => d.timeZone));
    expect(timeZones.size).toBe(TELEHEALTH_CLINIC_TEMPLATE.telehealth?.doctors.length);
  });

  it("requiredModules: telehealth İÇERİR (§2.6)", () => {
    expect(TELEHEALTH_CLINIC_TEMPLATE.requiredModules).toEqual(["telehealth"]);
  });

  it("socialLinks boş dizi ([DTI] §9.5 — gerçek hesaba link YOK)", () => {
    expect(TELEHEALTH_CLINIC_TEMPLATE.socialLinks).toEqual([]);
  });

  it("portfolio boş (bu şablon portföy üretmiyor)", () => {
    expect(TELEHEALTH_CLINIC_TEMPLATE.portfolio).toEqual({ categories: [], items: [] });
  });

  it("commerce: null (bu şablon ticaret verisi getirmiyor)", () => {
    expect(TELEHEALTH_CLINIC_TEMPLATE.commerce).toBeNull();
  });

  it("acil durum uyarı cümlesi ana sayfada ve HER yasal sayfada geçer (§6.6/§7.4)", () => {
    const emergencySentence = "Bu platform acil tıbbi durumlar için KULLANILAMAZ. Acil durumda 112'yi arayın.";
    const homeSerialized = JSON.stringify(TELEHEALTH_CLINIC_TEMPLATE.page.blocks);
    expect(homeSerialized).toContain(emergencySentence);
    for (const extraPage of TELEHEALTH_CLINIC_TEMPLATE.extraPages) {
      expect(JSON.stringify(extraPage.blocks)).toContain(emergencySentence);
    }
  });

  it("yasal sayfalar [EPT] §4.3 ZORUNLU ilk cümleyi taşır", () => {
    const legalNotice = "Bu metin bir";
    for (const extraPage of TELEHEALTH_CLINIC_TEMPLATE.extraPages) {
      expect(JSON.stringify(extraPage.blocks)).toContain(legalNotice);
    }
  });

  it("§3.6/§2.5 — appointments alanı tanımlanamaz, hiçbir user/appointment verisi TAŞINMAMIŞ (statik veri denetimi)", () => {
    expect((TELEHEALTH_CLINIC_TEMPLATE as unknown as { appointments?: unknown }).appointments).toBeUndefined();
    const serialized = JSON.stringify(TELEHEALTH_CLINIC_TEMPLATE);
    expect(serialized).not.toMatch(/"patientName"/);
    expect(serialized).not.toMatch(/"patientEmail"/);
  });

  it("assertDemoTemplateCaps — tavan/bio ihlali olan bozuk bir kopya reddedilir (çalışma zamanı zorlaması)", () => {
    const tooManyDoctors: DemoTemplateDefinition = {
      ...TELEHEALTH_CLINIC_TEMPLATE,
      telehealth: {
        specialties: TELEHEALTH_CLINIC_TEMPLATE.telehealth!.specialties,
        doctors: Array.from({ length: MAX_TEMPLATE_DOCTORS + 1 }, (_, i) => ({
          ...TELEHEALTH_CLINIC_TEMPLATE.telehealth!.doctors[0]!,
          slug: `doctor-${i}`,
        })),
      },
    };
    expect(() => assertDemoTemplateCaps(tooManyDoctors)).toThrow();

    const badBio: DemoTemplateDefinition = {
      ...TELEHEALTH_CLINIC_TEMPLATE,
      telehealth: {
        specialties: TELEHEALTH_CLINIC_TEMPLATE.telehealth!.specialties,
        doctors: [{ ...TELEHEALTH_CLINIC_TEMPLATE.telehealth!.doctors[0]!, bio: "Gerçek bir hekim gibi yazılmış bio." }],
      },
    };
    expect(() => assertDemoTemplateCaps(badBio)).toThrow(/İLK CÜMLESİ/);
  });
});

/**
 * Gerçek import — §3.6/§2.5/§2.6 kabul kriteri: 6 uzmanlık + 4 doktor + müsaitlik oluşur,
 * `appointments` tablosu BOŞ kalır, hiçbir `User` satırı YARATILMAZ, modül kapalıyken `201` +
 * `warnings[]`, `enableRequiredModules: true` ile modül GERÇEKTEN açılır.
 */
describe("telehealth-clinic demo şablonu — gerçek import (§3.6/§2.5/§2.6 kabul kriteri)", () => {
  let app: FastifyInstance;
  let actorId: string;
  let actorEmail: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "telehealth-clinic-import-admin@example.com" });
    actorId = admin.userId;
    actorEmail = "telehealth-clinic-import-admin@example.com";
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("ADMIN olarak `enableRequiredModules: false` ile uygula → 201, 6 uzmanlık + 4 doktor + 20 müsaitlik oluşur, modül kapalı uyarısı döner, appointments/User BOŞ kalır", async () => {
    const { importDemoTemplate } = await import("../../src/modules/demo-templates/importer");

    const result = await importDemoTemplate(app, {
      templateKey: "telehealth-clinic",
      body: { confirm: true, force: false, setAsHomePage: true, enableRequiredModules: false },
      actorId,
      actorEmail,
    });

    expect(result.templateKey).toBe("telehealth-clinic");
    expect(result.counts.specialties).toBe(6);
    expect(result.counts.doctors).toBe(4);
    expect(result.counts.availabilityWindows).toBe(20); // 4 doktor × 5 gün (Pzt-Cuma)
    expect(result.enabledModules).toEqual([]);

    // §2.6 madde 3 — modül kapalıyken import yine 201 döner + BİREBİR bu uyarı.
    expect(result.warnings).toContain(
      "Tele-Sağlık modülü kapalı olduğu için doktorlar ve randevu sayfaları sitede görünmeyecek. /admin/modules üzerinden açabilirsiniz."
    );
    // §7.2 madde 4 — demo doktor/uzmanlık açıklama uyarısı.
    expect(result.warnings).toContain("4 örnek doktor profili ve 6 uzmanlık oluşturuldu; yayına almadan önce gerçek bilgilerinizle değiştirin veya silin.");
    // §4.3 — 4 yasal yer tutucu sayfa uyarısı.
    expect(result.warnings).toContain("4 yasal sayfa YER TUTUCU olarak oluşturuldu; yayına almadan önce içeriklerini doldurun.");

    const specialtyCount = await app.prisma.specialty.count();
    const doctorCount = await app.prisma.doctorProfile.count();
    const availabilityCount = await app.prisma.doctorAvailability.count();
    const legalPageCount = await app.prisma.page.count({ where: { isLegalDocument: true } });

    expect(specialtyCount).toBe(6);
    expect(doctorCount).toBe(4);
    expect(availabilityCount).toBe(20);
    expect(legalPageCount).toBe(4);

    // §3.6 — bilinçli KAPSAM DIŞI/yapısal garanti: örnek randevu YOK.
    expect(await app.prisma.appointment.count()).toBe(0);

    // §2.5 — şablon hiçbir `User` satırı YAZMAZ; import öncesi kayıtlı ADMIN dışında yeni User YOK.
    expect(await app.prisma.user.count()).toBe(1);
    for (const doctor of await app.prisma.doctorProfile.findMany()) {
      expect(doctor.userId).toBeNull();
      expect(doctor.isVerified).toBe(false);
    }

    // Modül GERÇEKTEN kapalı kalmıştır (enableRequiredModules: false).
    const moduleRow = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
    expect(moduleRow).toBeNull();
  });

  it("importer.ts kaynak kodunda appointment/user yazan hiçbir Prisma çağrısı yok (statik denetim, §3.6/§2.5)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.join(__dirname, "../../src/modules/demo-templates/importer.ts"), "utf8");
    expect(source).not.toMatch(/tx\.appointment\.(create|createMany|upsert)/);
    expect(source).not.toMatch(/tx\.user\.(create|createMany|upsert)/);
  });
});

describe("telehealth-clinic demo şablonu — `enableRequiredModules: true` ile modül AÇIK opt-in (§2.6)", () => {
  let app: FastifyInstance;
  let actorId: string;
  let actorEmail: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "telehealth-clinic-enable-admin@example.com" });
    actorId = admin.userId;
    actorEmail = "telehealth-clinic-enable-admin@example.com";
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("`enableRequiredModules: true` ile uygula → `telehealth` SiteModule GERÇEKTEN açılır, uyarı GÖRÜNMEZ", async () => {
    const { importDemoTemplate } = await import("../../src/modules/demo-templates/importer");

    const result = await importDemoTemplate(app, {
      templateKey: "telehealth-clinic",
      body: { confirm: true, force: false, setAsHomePage: true, enableRequiredModules: true },
      actorId,
      actorEmail,
    });

    expect(result.enabledModules).toEqual(["telehealth"]);
    expect(result.warnings).not.toContain(
      "Tele-Sağlık modülü kapalı olduğu için doktorlar ve randevu sayfaları sitede görünmeyecek. /admin/modules üzerinden açabilirsiniz."
    );

    const moduleRow = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
    expect(moduleRow?.enabled).toBe(true);
    expect(moduleRow?.updatedById).toBe(actorId);
  });
});
