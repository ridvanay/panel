import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import {
  LEGAL_PAGE_MAP,
  LegalPublishError,
  PUBLISH_AUDIT_ACTION,
  RESTORE_AUDIT_ACTION,
  buildPublishPlan,
  publishLegalPages,
  readBackup,
  restoreLegalPages,
  type PlaceholderValues,
} from "../../src/lib/legal-pages-publisher";

/**
 * Paket J — yasal sayfa yükleyicisi gerçek DB'ye karşı: kuru çalışma yazmaz, eksik yer tutucu
 * gerçek yüklemeyi engeller, yedek + tek transaction + audit, korunan alanlar, eşzamanlı değişiklikte
 * geri alma ve yedekten birebir geri dönüş.
 */

const LEGAL_DIR = path.resolve(__dirname, "../../../docs/legal");
const FULL_VALUES: PlaceholderValues = {
  SIRKET_UNVANI: { tr: "Örnek Sağlık A.Ş.", en: "Example Health Inc." },
  ADRES: { tr: "Örnek Mah. 1, İstanbul", en: "Ornek St. 1, Istanbul" },
  TELEFON: { tr: "+90 212 000 00 00", en: "+90 212 000 00 00" },
  SUNUCU_KONUMU: { tr: "Almanya (Hetzner)", en: "Germany (Hetzner)" },
};
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host" };

describe("legal-pages-publisher (Paket J)", () => {
  let app: FastifyInstance;
  let backupDir: string;

  async function seed() {
    // `resetDatabase` dil kayıtlarını silmez — upsert ile TR varsayılan, EN etkin.
    for (const l of [
      { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0 },
      { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: false, enabled: true, sortOrder: 1 },
    ]) {
      await app.prisma.locale.upsert({ where: { code: l.code }, create: l, update: l });
    }
    for (const [i, { slug }] of LEGAL_PAGE_MAP.entries()) {
      await app.prisma.page.create({
        data: {
          slug,
          title: `Eski başlık ${i}`,
          status: i === 3 ? "DRAFT" : "PUBLISHED",
          isLegalDocument: true,
          seoTitle: `SEO ${i}`,
          blocks: [{ id: "old", type: "text", data: { html: "<p>Bu metin bir yer tutucudur</p>" } }],
          // Son sayfa yalnızca İngilizce bir çeviriye ve özel EN slug'ına sahip (distance-service-agreement gibi).
          translations: i === 3 ? { en: { title: "Old EN", slug: "distance-service-agreement-en", blocks: [] } } : {},
        },
      });
    }
  }

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    await seed();
    backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "legal-backup-"));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kuru çalışma (plan) hiçbir şey yazmaz; boş values.json eksik anahtarları listeler", async () => {
    const before = await app.prisma.page.findMany({ orderBy: { slug: "asc" } });
    const plan = await buildPublishPlan(app.prisma, LEGAL_DIR, {});
    expect(plan.defaultLocale).toBe("tr");
    expect(plan.pages).toHaveLength(4);
    expect(plan.missing.length).toBe(8);
    expect(plan.pages[0]!.current.translationExists).toBe(false);
    expect(plan.pages[3]!.current.translationExists).toBe(true);
    expect(await app.prisma.page.findMany({ orderBy: { slug: "asc" } })).toEqual(before);
  });

  it("eksik yer tutucu varken gerçek yükleme reddedilir; onay ve operatör zorunlu", async () => {
    const incomplete = await buildPublishPlan(app.prisma, LEGAL_DIR, { ...FULL_VALUES, TELEFON: { tr: "", en: "" } });
    await expect(publishLegalPages(app.prisma, incomplete, { ...OP, confirm: "publish-legal", backupDir })).rejects.toThrow(/Eksik yer tutucular/);

    const plan = await buildPublishPlan(app.prisma, LEGAL_DIR, FULL_VALUES);
    await expect(publishLegalPages(app.prisma, plan, { ...OP, confirm: "evet", backupDir })).rejects.toThrow(/--confirm=publish-legal/);
    await expect(publishLegalPages(app.prisma, plan, { ...OP, operator: "", confirm: "publish-legal", backupDir })).rejects.toThrow(/--operator/);
    expect(await fs.readdir(backupDir)).toEqual([]);
    expect((await app.prisma.page.findUniqueOrThrow({ where: { slug: "kvkk-aydinlatma-metni-2" } })).title).toBe("Eski başlık 0");
  });

  it("slug bulunamazsa hata verir, yeni sayfa açmaz", async () => {
    await app.prisma.page.update({ where: { slug: "acik-riza-metni-2" }, data: { deletedAt: new Date() } });
    await expect(buildPublishPlan(app.prisma, LEGAL_DIR, FULL_VALUES)).rejects.toBeInstanceOf(LegalPublishError);
    expect(await app.prisma.page.count()).toBe(4);
  });

  it("gerçek yükleme: yedek → tek transaction → TR kanonik, EN çeviri; korunan alanlar değişmez; audit", async () => {
    const plan = await buildPublishPlan(app.prisma, LEGAL_DIR, FULL_VALUES);
    const result = await publishLegalPages(app.prisma, plan, { ...OP, confirm: "publish-legal", backupDir, revalidate: false });

    const backup = await readBackup(result.backupFile);
    expect(backup.pages.map((p) => p.title).sort()).toEqual(["Eski başlık 0", "Eski başlık 1", "Eski başlık 2", "Eski başlık 3"]);

    const kvkk = await app.prisma.page.findUniqueOrThrow({ where: { slug: "kvkk-aydinlatma-metni-2" } });
    expect(kvkk.title).toBe("KVKK Aydınlatma Metni");
    expect(JSON.stringify(kvkk.blocks)).toContain("Örnek Sağlık A.Ş.");
    expect(kvkk).toMatchObject({ slug: "kvkk-aydinlatma-metni-2", isLegalDocument: true, status: "PUBLISHED", seoTitle: "SEO 0" });
    const kvkkEn = (kvkk.translations as Record<string, { title: string; blocks: unknown }>).en!;
    expect(JSON.stringify(kvkkEn.blocks)).toContain("Example Health Inc.");
    expect(await app.prisma.contentSlug.findFirst({ where: { entityId: kvkk.id, locale: "en" } })).toMatchObject({ slug: "kvkk-aydinlatma-metni-2" });

    // Mevcut EN çevirisinin diğer alanları (özel slug) korunur; DRAFT durumu korunur.
    const dsa = await app.prisma.page.findUniqueOrThrow({ where: { slug: "distance-service-agreement" } });
    expect(dsa.status).toBe("DRAFT");
    expect((dsa.translations as Record<string, Record<string, unknown>>).en).toMatchObject({ slug: "distance-service-agreement-en" });
    expect(JSON.stringify(dsa.blocks)).not.toContain("{{");

    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: PUBLISH_AUDIT_ACTION } });
    expect(audit.metadata).toMatchObject({ operator: "Test Operatör", hostname: "test-host", backupFile: path.basename(result.backupFile) });
    expect((audit.metadata as { slugs: string[] }).slugs).toHaveLength(4);
  });

  it("plan sonrası bir sayfa değiştiyse HİÇBİR sayfa yazılmaz (tek transaction)", async () => {
    const plan = await buildPublishPlan(app.prisma, LEGAL_DIR, FULL_VALUES);
    await new Promise((r) => setTimeout(r, 5));
    await app.prisma.page.update({ where: { slug: "distance-service-agreement" }, data: { seoTitle: "başkası düzenledi" } });
    await expect(publishLegalPages(app.prisma, plan, { ...OP, confirm: "publish-legal", backupDir, revalidate: false })).rejects.toThrow(/değişmiş/);
    const titles = (await app.prisma.page.findMany()).map((p) => p.title).sort();
    expect(titles).toEqual(["Eski başlık 0", "Eski başlık 1", "Eski başlık 2", "Eski başlık 3"]);
    expect(await app.prisma.auditLog.count({ where: { action: PUBLISH_AUDIT_ACTION } })).toBe(0);
  });

  it("geri dönüş yedekteki hâli birebir yazar, önce mevcut hâlin yedeğini alır; onay zorunlu", async () => {
    const original = await app.prisma.page.findMany({ orderBy: { slug: "asc" }, select: { slug: true, title: true, blocks: true, translations: true } });
    const plan = await buildPublishPlan(app.prisma, LEGAL_DIR, FULL_VALUES);
    const { backupFile } = await publishLegalPages(app.prisma, plan, { ...OP, confirm: "publish-legal", backupDir, revalidate: false });

    await expect(restoreLegalPages(app.prisma, backupFile, { ...OP, confirm: "publish-legal", backupDir })).rejects.toThrow(/--confirm=restore-legal/);

    const result = await restoreLegalPages(app.prisma, backupFile, { ...OP, confirm: "restore-legal", backupDir, revalidate: false });
    const restored = await app.prisma.page.findMany({ orderBy: { slug: "asc" }, select: { slug: true, title: true, blocks: true, translations: true } });
    expect(restored).toEqual(original);
    expect((await readBackup(result.preRestoreBackup)).pages.find((p) => p.slug === "kvkk-aydinlatma-metni-2")!.title).toBe("KVKK Aydınlatma Metni");
    expect(await app.prisma.auditLog.count({ where: { action: RESTORE_AUDIT_ACTION } })).toBe(1);
  });
});
