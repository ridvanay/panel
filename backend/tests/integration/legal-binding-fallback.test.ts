import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket L (2026-10-23) — yasal sayfa (`isLegalDocument`) çevrilmemişse: bağlayıcı dillerde (TR/EN)
 * §5.1 fail-safe sürer (gövde boş); diğer dillerde (ör. de) kanonik metne düşülür.
 */
describe("yasal sayfa — bağlayıcı olmayan dillerde kanonik metne düşme (Paket L)", () => {
  let app: FastifyInstance;
  let originalLocales: Awaited<ReturnType<FastifyInstance["prisma"]["locale"]["findMany"]>> = [];

  beforeAll(async () => {
    app = await buildTestApp();
    originalLocales = await app.prisma.locale.findMany();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    await app.prisma.locale.deleteMany({ where: { code: { in: ["de", "ar"] } } });
    await app.prisma.locale.updateMany({ data: { isDefault: false } });
    for (const l of [
      { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0 },
      { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: false, enabled: true, sortOrder: 1 },
      { code: "de", label: "Almanca", nativeLabel: "Deutsch", isDefault: false, enabled: true, sortOrder: 2 },
    ]) {
      await app.prisma.locale.upsert({ where: { code: l.code }, create: l, update: l });
    }
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.prisma.locale.deleteMany({ where: { code: { in: ["de", "ar"] } } });
    await app.prisma.locale.updateMany({ data: { isDefault: false } });
    for (const row of originalLocales) await app.prisma.locale.upsert({ where: { code: row.code }, create: row, update: row });
    await app.close();
  });

  it("de: çeviri yoksa kanonik gövde döner; en (bağlayıcı): gövde boş kalır", async () => {
    const page = await app.prisma.page.create({
      data: {
        slug: "aydinlatma-metni",
        title: "Aydınlatma Metni",
        status: "PUBLISHED",
        isLegalDocument: true,
        blocks: [{ id: "b1", type: "text", data: { html: "<p>Türkçe hukuki metin</p>" } }],
      },
    });

    const de = await app.inject({ method: "GET", url: `/api/v1/pages/${page.slug}?locale=de` });
    expect(de.statusCode).toBe(200);
    expect(de.json().data.blocks).toHaveLength(1);
    expect(de.json().data.localizations.find((l: { locale: string }) => l.locale === "de").translated).toBe(false);

    const en = await app.inject({ method: "GET", url: `/api/v1/pages/${page.slug}?locale=en` });
    expect(en.json().data.blocks).toEqual([]);
  });
});
