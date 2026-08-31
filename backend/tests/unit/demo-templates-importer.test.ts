import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { ApiError } from "../../src/lib/errors";
import { storage } from "../../src/lib/storage";

/**
 * `.claude/architect-scope-demo-template-import.md` §12 madde 4-5 — `importer.ts`'in
 * telafi/rollback disiplinini doğrular. Bir sonraki `describe` (madde 4), registry'yi
 * `vi.mock` ile GEÇİCİ olarak bozuk bir şablonla değiştirir; bu yüzden `getDemoTemplate`i
 * kullanan `importDemoTemplate` importu, mock KURULDUKTAN SONRA (dosyanın en üstünde,
 * `vi.mock` hoisting sayesinde) çözülür.
 */
const { BROKEN_TEMPLATE_KEY, BROKEN_TEMPLATE } = vi.hoisted(() => {
  const key = "broken-template";
  return {
    BROKEN_TEMPLATE_KEY: key,
    BROKEN_TEMPLATE: {
      key,
      version: "1.0.0",
      name: "Bozuk Test Şablonu",
      description: "Yalnızca birim testi amaçlı.",
      previewImageUrl: "/demo-templates/broken/preview.svg",
      tags: [],
      // `assets[]` yalnızca "known-asset" tanımlar — aşağıdaki blok BİLEREK "does-not-exist"
      // anahtarına referans verir (§3.4 madde 3 — çözülemeyen token FATAL'dır).
      assets: [{ key: "known-asset", file: "known-asset.png", altText: "test" }],
      appearance: {},
      settings: { siteName: "Test", tagline: null, headerCtaLabel: null, headerCtaHref: null, footerCopyrightText: null },
      navigation: [],
      footer: { columns: [] },
      socialLinks: [],
      portfolio: { categories: [], items: [] },
      slider: null,
      page: {
        title: "Bozuk Sayfa",
        slug: "bozuk-test-sayfasi",
        seoTitle: null,
        seoDescription: null,
        blocks: [{ id: "b1", type: "image", data: { url: "asset:does-not-exist", alt: "x" } }],
        setAsHomePage: false,
      },
    },
  };
});

vi.mock("../../src/modules/demo-templates/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/demo-templates/registry")>();
  return {
    ...actual,
    getDemoTemplate: (key: string) => (key === BROKEN_TEMPLATE_KEY ? (BROKEN_TEMPLATE as never) : actual.getDemoTemplate(key)),
  };
});

describe("demo-templates importer — §12 madde 4: çözülemeyen token → 422, DB'ye HİÇBİR yazma yapılmaz", () => {
  let app: FastifyInstance;
  let actorId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "demo-template-broken-admin@example.com" });
    actorId = admin.userId;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("bozuk şablon (tanımsız asset key referansı) 422 VALIDATION_ERROR fırlatır ve unresolvedTokens listeler", async () => {
    const { importDemoTemplate } = await import("../../src/modules/demo-templates/importer");

    let caught: unknown;
    try {
      await importDemoTemplate(app, {
        templateKey: BROKEN_TEMPLATE_KEY,
        body: { confirm: true, force: false, setAsHomePage: true },
        actorId,
        actorEmail: "demo-template-broken-admin@example.com",
      });
      expect.fail("beklenen hata fırlatılmadı");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const apiErr = caught as ApiError;
    expect(apiErr.statusCode).toBe(422);
    expect(apiErr.code).toBe("VALIDATION_ERROR");
    expect(apiErr.details?.unresolvedTokens).toContain("asset:does-not-exist");
  });

  it("DB'ye HİÇBİR yazma yapılmamıştır (Page/Media/DemoTemplateImport hepsi boş)", async () => {
    expect(await app.prisma.page.count()).toBe(0);
    expect(await app.prisma.media.count()).toBe(0);
    expect(await app.prisma.demoTemplateImport.count()).toBe(0);
    expect(await app.prisma.slider.count()).toBe(0);
    expect(await app.prisma.portfolioItem.count()).toBe(0);
  });
});

describe("demo-templates importer — §12 madde 5: Faz 2 hata enjeksiyonu → dosyalar telafi edilir", () => {
  let app: FastifyInstance;
  let actorId: string;
  let actorEmail: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "demo-template-rollback-admin@example.com" });
    actorId = admin.userId;
    actorEmail = "demo-template-rollback-admin@example.com";
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("Faz 2 ($transaction) hata enjekte edildiğinde: Media satırı YOK ve storage.remove HER Faz 1 dosyası için çağrılmış", async () => {
    const { importDemoTemplate } = await import("../../src/modules/demo-templates/importer");
    const { MODERN_ARCHITECTURE_TEMPLATE } = await import("../../src/modules/demo-templates/templates/modern-architecture");

    const removeSpy = vi.spyOn(storage, "remove");
    const injectedError = new Error("Faz 2 enjekte edilmiş test hatası");
    const transactionSpy = vi.spyOn(app.prisma, "$transaction").mockRejectedValueOnce(injectedError);

    let caught: unknown;
    try {
      await importDemoTemplate(app, {
        templateKey: "modern-architecture",
        body: { confirm: true, force: false, setAsHomePage: true },
        actorId,
        actorEmail,
      });
      expect.fail("beklenen hata fırlatılmadı");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(injectedError);

    // Faz 1 gerçekten dosya yazmıştı (6 varlık) — telafi TAM OLARAK bu kadar `storage.remove`
    // çağrısı üretmelidir.
    expect(removeSpy).toHaveBeenCalledTimes(MODERN_ARCHITECTURE_TEMPLATE.assets.length);

    // Transaction rollback edildiği (aslında hiç gerçek transaction'a girilmediği, mock hemen
    // reddettiği) için hiçbir Media satırı KALICI olmamalıdır.
    expect(await app.prisma.media.count()).toBe(0);
    expect(await app.prisma.page.count()).toBe(0);
    expect(await app.prisma.demoTemplateImport.count()).toBe(0);

    // Audit: FAILURE durumu loglanmış olmalı (§6.7 — başarısız denemeler de loglanır).
    const failureLog = await app.prisma.auditLog.findFirst({
      where: { action: "demo_template.import", status: "FAILURE" },
      orderBy: { createdAt: "desc" },
    });
    expect(failureLog).not.toBeNull();

    transactionSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
