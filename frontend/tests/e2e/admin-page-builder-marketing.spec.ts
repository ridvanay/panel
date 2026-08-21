import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, createPage as createPageFixture, deletePagePermanently, patchPageBlocks } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * Faz 3 "Pazarlama & Sosyal Kanıt" — CTA Box (zenginleştirme), Sayaç/İstatistik, Müşteri
 * Yorumları, Fiyatlandırma Tablosu. `admin-page-builder-gallery.spec.ts`teki AYNI iki-katmanlı
 * desen: (1) admin editöründe kategori/menü kaydının GERÇEKTEN çalıştığını (blok eklenince
 * varsayılan içerik görünür) doğrulayan hafif bir UI testi, (2) `patchPageBlocks` (doğrudan API)
 * ile kurulup GERÇEK backend+Postgres'e karşı doğrulanmış, public URL'de render KONTROLÜ — UI
 * ÜZERİNDEN karmaşık tekrarlı-liste (add/remove/reorder) etkileşimini sürüklemek yerine, bu
 * bloklar zaten `frontend/tests/unit/a11y-content-editor.test.tsx` + component-seviyesi
 * editörlerinde dolaylı kapsanıyor; e2e'nin asıl değeri UÇTAN UCA (Zod şeması → DB → public
 * render) BOZULMADIĞINI kanıtlamak.
 */
test.describe.configure({ retries: 1 });

const PAGE_TITLE_PREFIX = "QaE2eMarketingPage";
const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:3100";

let page: Page;
let closeSession: () => Promise<void>;
let token: string;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  token = session.accessToken;
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  if (closeSession) await closeSession();
});

async function createHostPage(prefix: string, status: "PUBLISHED" | "DRAFT" = "DRAFT") {
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
  const slug = `qa-mkt-${prefix}-${unique}`;
  const created = await createPageFixture(token, {
    title: `${PAGE_TITLE_PREFIX} ${prefix} ${unique}`,
    slug,
    html: "<p>başlangıç fixture içeriği</p>",
    status,
  });
  return { pageId: created.id as string, slug: created.slug as string };
}

async function openEditorAndRemoveDefaultBlock(pageId: string) {
  await page.goto(`/admin/pages/${pageId}`);
  await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500); // bkz. `admin-page-builder-gallery.spec.ts` başlığındaki AYNI güvenlik payı notu
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2);
  await page.locator('button[aria-label="Konteyneri sil"]').first().click();
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);
}

test.describe("Pazarlama blokları — admin editörü (kategori/menü kaydı)", () => {
  test("Sayaç, Müşteri Yorumları ve Fiyatlandırma Tablosu 'Pazarlama & Sosyal Kanıt' sekmesinden eklenir ve varsayılan içerikle render olur", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("category-wiring");
    try {
      await openEditorAndRemoveDefaultBlock(pageId);
      await page.getByRole("button", { name: "Tek Sütun" }).click();
      await page.getByRole("button", { name: "Konteynere blok ekle" }).click();
      await page.getByRole("tab", { name: "Pazarlama & Sosyal Kanıt" }).click();

      await page.getByRole("menuitem", { name: "Sayaç / İstatistik", exact: true }).click();
      // "Mutlu Müşteri" bir input DEĞERİ (metin düğümü DEĞİL) — `getByText` eşleşmez, `toHaveValue` kullanılır.
      await expect(page.getByRole("textbox", { name: "Etiket" }).first()).toHaveValue("Mutlu Müşteri");

      // Konteyner artık BOŞ DEĞİL — tetikleyici "Konteynere blok ekle" (prominent, boş-durum)
      // yerine "Konteynere daha fazla blok ekle" olarak değişir (bkz. `add-content-menu.tsx`).
      await page.getByRole("button", { name: "Konteynere daha fazla blok ekle" }).click();
      await page.getByRole("tab", { name: "Pazarlama & Sosyal Kanıt" }).click();
      await page.getByRole("menuitem", { name: "Müşteri Yorumları", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Ad Soyad" }).first()).toBeVisible();

      await page.getByRole("button", { name: "Konteynere daha fazla blok ekle" }).click();
      await page.getByRole("tab", { name: "Pazarlama & Sosyal Kanıt" }).click();
      await page.getByRole("menuitem", { name: "Fiyatlandırma Tablosu", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Plan adı" }).first()).toHaveValue("Başlangıç");

      await page.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(page.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

/**
 * Public site render — `patchPageBlocks` ile doğrudan API üzerinden kurulur (bkz.
 * `admin-page-builder-gallery.spec.ts`teki AYNI gerekçe: gerçek dosya yükleme/karmaşık UI
 * etkileşimi olmadan backend şeması → DB → public render zincirini doğrular).
 */
test.describe("Pazarlama blokları — public site render (gerçek public URL, admin DIŞINDA)", () => {
  test("CTA — eski (Faz 3 ÖNCESİ) veri şekli hiçbir yeni alan OLMADAN hâlâ kabul edilir ve render olur", async () => {
    const { pageId, slug } = await createHostPage("cta-legacy-shape", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        { id: "qa-cta-legacy", type: "cta", data: { heading: "Bugün başlayın", buttonLabel: "Kayıt Ol", buttonHref: "/kayit" } },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByRole("heading", { name: "Bugün başlayın" })).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByRole("link", { name: "Kayıt Ol" })).toHaveAttribute("href", "/kayit");
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("CTA — 'solid' görünüm + açıklama + ikincil buton birlikte render olur", async () => {
    const { pageId, slug } = await createHostPage("cta-solid", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-cta-solid",
          type: "cta",
          data: {
            heading: "Planınızı yükseltin",
            description: "Tüm özelliklere sınırsız erişim.",
            buttonLabel: "Planları Gör",
            buttonHref: "/fiyatlandirma",
            secondaryButtonLabel: "Bize Ulaşın",
            secondaryButtonHref: "/iletisim",
            style: "solid",
            align: "center",
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByRole("heading", { name: "Planınızı yükseltin" })).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByText("Tüm özelliklere sınırsız erişim.")).toBeVisible();
        await expect(publicPage.getByRole("link", { name: "Planları Gör" })).toHaveAttribute("href", "/fiyatlandirma");
        await expect(publicPage.getByRole("link", { name: "Bize Ulaşın" })).toHaveAttribute("href", "/iletisim");
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Sayaç/İstatistik — önek/sonek ile birleşik sayı biçimi ve etiketler render olur", async () => {
    const { pageId, slug } = await createHostPage("counter", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-counter",
          type: "counter",
          data: {
            items: [
              { id: "c1", value: 500, suffix: "+", label: "Mutlu Müşteri" },
              { id: "c2", value: 98, prefix: "%", label: "Memnuniyet" },
            ],
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByText("500+")).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByText("Mutlu Müşteri")).toBeVisible();
        await expect(publicPage.getByText("%98")).toBeVisible();
        await expect(publicPage.getByText("Memnuniyet")).toBeVisible();
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Müşteri Yorumları — yorum/yazar/unvan render olur ve avatarsız kayıt baş harf rozetine düşer", async () => {
    const { pageId, slug } = await createHostPage("testimonial", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-testimonial",
          type: "testimonial",
          data: {
            items: [
              { id: "t1", quote: "Harika bir hizmet aldık.", authorName: "Ayşe Yılmaz", authorRole: "CEO, ACME", rating: 4 },
            ],
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByText("Harika bir hizmet aldık.")).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByText("Ayşe Yılmaz")).toBeVisible();
        await expect(publicPage.getByText("CEO, ACME")).toBeVisible();
        // `avatarUrl` YOK — baş harf rozetine (initials fallback) düşer, YENİ bir ağ isteği açmaz.
        await expect(publicPage.getByText("AY", { exact: true })).toBeVisible();
        await expect(publicPage.getByRole("img", { name: "5 üzerinden 4 yıldız" })).toBeVisible();
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Fiyatlandırma Tablosu — plan adı/fiyat/özellikler render olur, öne çıkan plan 'Popüler' rozeti taşır", async () => {
    const { pageId, slug } = await createHostPage("pricing", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-pricing",
          type: "pricing-table",
          data: {
            plans: [
              {
                id: "p1",
                name: "Başlangıç",
                price: "₺299",
                period: "/ay",
                features: ["Özellik A", "Özellik B"],
                highlighted: false,
                buttonLabel: "Satın Al",
                buttonHref: "/satin-al-baslangic",
              },
              {
                id: "p2",
                name: "Profesyonel",
                price: "₺599",
                period: "/ay",
                features: ["Özellik A", "Özellik B", "Özellik C"],
                highlighted: true,
                buttonLabel: "Satın Al",
                buttonHref: "/satin-al-pro",
              },
            ],
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByRole("heading", { name: "Başlangıç" })).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByRole("heading", { name: "Profesyonel" })).toBeVisible();
        await expect(publicPage.getByText("₺299")).toBeVisible();
        await expect(publicPage.getByText("₺599")).toBeVisible();
        await expect(publicPage.getByText("Özellik C")).toBeVisible();
        // YALNIZCA `highlighted: true` olan planda "Popüler" rozeti — diğerinde YOK.
        await expect(publicPage.getByText("Popüler")).toHaveCount(1);
        await expect(publicPage.getByRole("link", { name: "Satın Al" }).first()).toHaveAttribute(
          "href",
          "/satin-al-baslangic"
        );
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});
