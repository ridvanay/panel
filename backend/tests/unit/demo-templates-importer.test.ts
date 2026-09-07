import crypto from "node:crypto";
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

describe("demo-templates importer — bugfix: BAŞKA bir entity tipinin (çöp kutusundaki) ContentSlug'ı slug'ı kilitlerse 409 DEĞİL, otomatik benzersizleştirme (§6.5)", () => {
  let app: FastifyInstance;
  let actorId: string;
  let actorEmail: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "demo-template-cross-entity-slug-admin@example.com" });
    actorId = admin.userId;
    actorEmail = "demo-template-cross-entity-slug-admin@example.com";
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("`ContentSlug(locale=tr, slug=anasayfa)` bir BlogPost'a (kendi tablosu Page DEĞİL) aitken şablon uygulaması 409 ile patlamaz, sayfa `anasayfa-2` olarak oluşturulur", async () => {
    const { importDemoTemplate } = await import("../../src/modules/demo-templates/importer");

    // `ContentSlug`'ın `entityId`'sine FK YOKTUR (polimorfik) — çöp kutusundaki bir BlogPost'un
    // slug'ı SONSUZA DEK tutması (bkz. `lib/localization.ts::deleteContentSlugsForEntity`
    // yorumu: "Soft-delete BUNU ÇAĞIRMAZ") gerçek bir Page satırı OLMADAN da simüle edilebilir.
    await app.prisma.contentSlug.create({
      data: { entityType: "BLOG_POST", entityId: crypto.randomUUID(), locale: "tr", slug: "anasayfa" },
    });

    const result = await importDemoTemplate(app, {
      templateKey: "modern-architecture",
      body: { confirm: true, force: false, setAsHomePage: true },
      actorId,
      actorEmail,
    });

    expect(result.pageSlug).toBe("anasayfa-2");
    expect(result.warnings.some((w) => w.includes("anasayfa-2"))).toBe(true);

    const createdPage = await app.prisma.page.findUnique({ where: { id: result.pageId } });
    expect(createdPage?.slug).toBe("anasayfa-2");
    expect(await app.prisma.contentSlug.count({ where: { locale: "tr", slug: "anasayfa-2" } })).toBe(1);
  });

  /**
   * qa-agent — koordinatör talebinin madde 4'ü ("force:true ile ikinci kopya + aynı anda
   * cross-entity çakışma birlikte test edilmiş mi"). Yukarıdaki test zaten `anasayfa`yı bir
   * BlogPost'un `ContentSlug`'ına KİLİTLEDİ ve İLK importu `anasayfa-2`'ye çözdü — bu test AYNI
   * `app` durumunun (bilinçli olarak `beforeAll`de SIFIRLANMAZ, testler sırayla ÇALIŞIR) ÜZERİNE
   * `force:true` ile İKİNCİ bir kopya uygular. Beklenen: `resolveSlugPlan` HEM cross-entity
   * `ContentSlug` satırını (`anasayfa`) HEM DE önceki gerçek `Page.slug`'ı (`anasayfa-2`) TARAR ve
   * `anasayfa-3`'e atlar — 409/P2002 YOK, önceki (`anasayfa-2`) sayfa SİLİNMEZ (§6.4 additive kural).
   */
  it("aynı anda hem cross-entity ContentSlug ('anasayfa') hem de önceki gerçek Page.slug ('anasayfa-2') doluyken force:true → 201, `anasayfa-3`", async () => {
    const { importDemoTemplate } = await import("../../src/modules/demo-templates/importer");

    const previousPage = await app.prisma.page.findFirst({ where: { slug: "anasayfa-2" } });
    expect(previousPage).not.toBeNull();

    const result = await importDemoTemplate(app, {
      templateKey: "modern-architecture",
      body: { confirm: true, force: true, setAsHomePage: true },
      actorId,
      actorEmail,
    });

    expect(result.pageSlug).toBe("anasayfa-3");
    expect(result.warnings.some((w) => w.includes("anasayfa-3"))).toBe(true);
    expect(result.warnings).toContain(
      "Şablon daha önce uygulanmıştı; `force` ile ikinci bir kopya oluşturuldu. Önceki içerik SİLİNMEDİ."
    );

    const createdPage = await app.prisma.page.findUnique({ where: { id: result.pageId } });
    expect(createdPage?.slug).toBe("anasayfa-3");
    expect(await app.prisma.contentSlug.count({ where: { locale: "tr", slug: "anasayfa-3" } })).toBe(1);

    // §6.4 — önceki (madde 4'ün ürettiği) sayfa hâlâ var, SİLİNMEDİ.
    const stillThere = await app.prisma.page.findUnique({ where: { id: previousPage!.id } });
    expect(stillThere?.deletedAt ?? null).toBeNull();
    expect(stillThere?.slug).toBe("anasayfa-2");

    // Orijinal cross-entity `ContentSlug` (BLOG_POST, "anasayfa") HİÇ dokunulmadı — polimorfik
    // tablo, importer'ın YAZMA yetkisi olmayan bir satırı.
    expect(
      await app.prisma.contentSlug.count({ where: { locale: "tr", slug: "anasayfa", entityType: "BLOG_POST" } })
    ).toBe(1);
  });
});

/**
 * qa-agent — regresyon: `ecommerce-pro` anasayfasındaki "Öne Çıkan Kategoriler" bloğunun
 * "Keşfet" butonu (`buildCategoryCard`, `templates/ecommerce-pro.ts`), şablon `force: true` ile
 * İKİNCİ kez uygulandığında (`resolveSlugPlan` kategori slug çakışmasını `depolama` →
 * `depolama-2` gibi otomatik benzersizleştirdiğinde) YANLIŞ/eski kategoriye işaret edip 0 ürün
 * döndürüyordu — kök neden href'in HAM `input.slug`'ı taşıması, backend-agent'ın düzeltmesi
 * `ref:product-category-slug:<templateSlug>` token ailesi (`lib/asset-tokens.ts`). Bu blok o
 * düzeltmeyi DEĞİL, gerçek DB import akışı üzerinden SONUCUNU doğrular (dokunma: `asset-tokens.ts`,
 * `importer.ts`, `templates/ecommerce-pro.ts` backend-agent'ın kapsamındadır).
 */
describe("demo-templates importer — bugfix: ecommerce-pro force-reapply sonrası 'Keşfet' butonu GERÇEK/ürünlü kategoriye işaret eder", () => {
  let app: FastifyInstance;
  let actorId: string;
  let actorEmail: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "ecommerce-pro-reapply-admin@example.com" });
    actorId = admin.userId;
    actorEmail = "ecommerce-pro-reapply-admin@example.com";
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  /**
   * `page.blocks` ağacında (container/button/... herhangi bir tip, herhangi bir derinlik) verilen
   * `id`'ye sahip İLK düğümü bulur — `lib/asset-tokens.ts::resolvePageBlockTokens`in dolaşım
   * disiplinini TAKLİT ETMEZ (bilerek basit tutulur, bu test yalnızca sonucu okur): sadece
   * `children` alanını izler — `buildCategoryCard`'ın ürettiği ağaç şekli bunu yeterli kılar.
   */
  function findBlockById(blocks: unknown, id: string): Record<string, unknown> | null {
    const stack: unknown[] = [blocks];
    while (stack.length > 0) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        for (const item of node) stack.push(item);
        continue;
      }
      if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (obj.id === id) return obj;
        if (Array.isArray(obj.children)) stack.push(obj.children);
      }
    }
    return null;
  }

  it("1. import → force:true ile 2. import → 'Depolama' Keşfet butonu İKİNCİ importun KENDİ (ürünlü) kategorisine işaret eder, eskinin (ürünsüz kalacak) 'depolama'sına DEĞİL", async () => {
    const { importDemoTemplate } = await import("../../src/modules/demo-templates/importer");

    const first = await importDemoTemplate(app, {
      templateKey: "ecommerce-pro",
      body: { confirm: true, force: false, setAsHomePage: false },
      actorId,
      actorEmail,
    });

    const second = await importDemoTemplate(app, {
      templateKey: "ecommerce-pro",
      body: { confirm: true, force: true, setAsHomePage: false },
      actorId,
      actorEmail,
    });

    expect(second.pageId).not.toBe(first.pageId);

    // §4.4 benzersizleştirme — iki "Depolama" kategorisi oluşmuş olmalı: `depolama` (1. import)
    // ve `depolama-2` (2., force-reapply).
    const depolamaCategories = await app.prisma.productCategory.findMany({
      where: { slug: { startsWith: "depolama" } },
      orderBy: { createdAt: "asc" },
    });
    expect(depolamaCategories.map((c) => c.slug)).toEqual(["depolama", "depolama-2"]);
    const [staleFirstCategory, freshSecondCategory] = depolamaCategories;

    const secondPage = await app.prisma.page.findUnique({ where: { id: second.pageId } });
    expect(secondPage).not.toBeNull();

    const button = findBlockById(secondPage!.blocks, "ep-category-depolama-button");
    expect(button).not.toBeNull();
    const data = button!.data as Record<string, unknown>;
    const href = data.href as string;

    // Bug'ın eski hali: href her zaman `/products?category=depolama` (ilk/HAM slug) idi — 2.
    // importta bu ARTIK yanlış kategoridir (o kategorinin ürünleri 1. importa ait, 2. importun
    // KENDİ ürünlerine değil). Doğrusu: `/products?category=depolama-2`.
    expect(href).toBe(`/products?category=${freshSecondCategory!.slug}`);

    const match = href.match(/^\/products\?category=(.+)$/);
    expect(match).not.toBeNull();
    const linkedSlug = match![1]!;

    // `resolveCategoryIds`/ürün listeleme uç noktasıyla AYNI sorgu şekli — href'teki slug'a göre
    // DB'de gerçekten sorgulanan kategori.
    const linkedCategory = await app.prisma.productCategory.findUnique({ where: { slug: linkedSlug } });
    expect(linkedCategory).not.toBeNull();
    expect(linkedCategory!.id).not.toBe(staleFirstCategory!.id);

    const linkedProductCount = await app.prisma.product.count({ where: { categoryId: linkedCategory!.id } });
    expect(linkedProductCount).toBeGreaterThan(0);
  });
});
