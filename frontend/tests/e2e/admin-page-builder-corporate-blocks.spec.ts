import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, createPage as createPageFixture, deletePagePermanently, patchPageBlocks, API_BASE_URL } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — `google-map` (YENİ blok) + 5 genişletilmiş kurumsal blok
 * (`accordion`/`before-after-slider`/`pricing-table`/`logo-marquee`/`video`) e2e kapsamı.
 * Kaynak: `.claude/architect-scope-google-map-corporate-blocks.md` §7.6 (bağlayıcı görev listesi)
 * + `.claude/security-review-google-map-corporate-blocks.md` §2 (negatif test matrisinin bir
 * örneği — tam matris backend Vitest'te zaten kapsanıyor, burada YALNIZCA API-seviyesi smoke).
 *
 * `admin-page-builder-widgets.spec.ts`/`admin-page-builder-marketing.spec.ts` ile AYNI iki katmanlı
 * desen: (1) admin editöründe kategori/menü/arama kaydının GERÇEKTEN çalıştığını doğrulayan hafif
 * bir UI testi, (2) `patchPageBlocks` (doğrudan API) ile kurulup GERÇEK backend+Postgres'e karşı
 * doğrulanmış — hem admin editör round-trip'i (yeni alanlar kaybolmuyor mu) hem public URL render
 * kontrolü.
 */
test.describe.configure({ retries: 1 });

const PAGE_TITLE_PREFIX = "QaE2eCorpBlocksPage";
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
  const slug = `qa-corp-${prefix}-${unique}`;
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
  await page.waitForTimeout(500); // bkz. `admin-page-builder-widgets.spec.ts` başlığındaki AYNI güvenlik payı notu
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2);
  await page.locator('button[aria-label="Konteyneri sil"]').first().click();
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);
}

async function openEditor(pageId: string) {
  await page.goto(`/admin/pages/${pageId}`);
  await expect(page.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// Katman 1 — admin editörü: kategori kaydı + arama anahtar kelimeleri (mimar §4.1/§4.2)
// ---------------------------------------------------------------------------
test.describe("Kurumsal bloklar — admin editörü (kategori/menü kaydı + arama)", () => {
  test("google-map 'Medya & İnteraktif' kategorisinden eklenir; palet araması map/harita/faq/fiyat/video sorgularını doğru bloğa eşler", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("category-search");
    try {
      await openEditorAndRemoveDefaultBlock(pageId);
      await page.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
      await page.getByRole("button", { name: "Tek Sütun" }).click();
      await page.getByRole("button", { name: "Konteynere blok ekle" }).click();
      await page.getByRole("tab", { name: "Medya & İnteraktif" }).click();
      await page.getByRole("menuitem", { name: "Google Harita", exact: true }).click();
      // Mod B (Adres) varsayılan ilk sekme (`ui-designer §1.4/1`) — "Adres" alanı hemen görünür.
      await expect(page.getByRole("textbox", { name: "Adres", exact: true })).toBeVisible();

      // Arama anahtar kelimeleri (mimar §4.2, `add-content-menu.tsx::keywords`) — popover'ı yeniden
      // aç, kategori sekmeleri yerine serbest metin aramasını kullan.
      await page.getByRole("button", { name: "Konteynere daha fazla blok ekle" }).click();
      const searchInput = page.getByRole("textbox", { name: "Blok ara" });
      const queriesToBlocks: [string, string][] = [
        ["map", "Google Harita"],
        ["harita", "Google Harita"],
        ["faq", "Akordiyon / SSS"],
        ["fiyat", "Fiyatlandırma Tablosu"],
        ["video", "Video Oynatıcı"],
      ];
      for (const [query, expectedLabel] of queriesToBlocks) {
        await searchInput.fill(query);
        await expect(page.getByRole("menuitem", { name: expectedLabel, exact: true })).toBeVisible();
        await searchInput.fill("");
      }
      await page.keyboard.press("Escape");
      // KAYDETME ADIMI YOK — bu test yalnızca kategori/arama KAYDINI doğrular (`admin-page-builder-
      // widgets.spec.ts`teki AYNI gerekçe); geçerli veriyle uçtan uca kaydetme/render, aşağıdaki
      // `patchPageBlocks` testlerinde ayrıca doğrulanıyor.
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

// ---------------------------------------------------------------------------
// Katman 2a — round-trip: `patchPageBlocks` → editörü yeniden yükle → yeni alanlar KAYBOLMAMALI
// (mimar §7.6/2 — REGRESYON-KRİTİK: `reveal`/`topDivider` geçmişte bu şekilde sessizce kaybolmuştu).
// ---------------------------------------------------------------------------
test.describe("Round-trip — yeni alanlar admin editöründe kaybolmuyor (regresyon-kritik)", () => {
  test("google-map (Mod B) + accordion + before-after-slider + pricing-table + logo-marquee + video — TÜM yeni alanlar yeniden yüklemede korunur", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("roundtrip-all");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-rt-map",
          type: "google-map",
          data: {
            address: "İstanbul, Beşiktaş",
            zoom: 12,
            height: { value: 350, unit: "px" },
            mapStyle: "dark",
            markerTitle: "Merkez Ofis",
          },
        },
        {
          id: "qa-rt-accordion",
          type: "accordion",
          data: {
            items: [{ id: "qa-rt-acc-i1", question: "Kargo süresi nedir?", answer: "2-3 iş günü.", isOpenDefault: true }],
            allowMultipleOpen: false,
            layoutStyle: "card",
          },
        },
        {
          id: "qa-rt-ba",
          type: "before-after-slider",
          data: {
            beforeUrl: "https://example.com/qa-rt-before.png",
            afterUrl: "https://example.com/qa-rt-after.png",
            beforeLabel: "Öncesi",
            afterLabel: "Sonrası",
            orientation: "horizontal",
            initialSliderPosition: 30,
          },
        },
        {
          id: "qa-rt-pricing",
          type: "pricing-table",
          data: {
            plans: [
              {
                id: "qa-rt-plan-1",
                name: "Başlangıç",
                price: "₺299",
                period: "/ay",
                features: ["Özellik A"],
                highlighted: false,
                buttonLabel: "Satın Al",
                buttonHref: "/satin-al",
              },
            ],
            billingInterval: "yearly",
          },
        },
        {
          id: "qa-rt-logo",
          type: "logo-marquee",
          data: {
            items: [{ id: "qa-rt-logo-i1", url: "https://example.com/qa-rt-logo.png", alt: "QA Logo" }],
            speedSeconds: 25,
            pauseOnHover: true,
            displayMode: "grid",
            grayscale: false,
          },
        },
        {
          id: "qa-rt-video",
          type: "video",
          data: {
            provider: "youtube",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            autoplay: false,
            muted: true,
            loop: true,
            playStyle: "lightbox",
            coverUrl: "https://example.com/qa-rt-cover.png",
          },
        },
      ]);

      // --- Editörü YENİDEN yükle (kalıcılık kanıtı) — `wrapBareRootBlocks` her çıplak kök bloğu
      // KENDİ konteynerine sarar, hepsi tek sayfada 6 ayrı kart olarak görünür.
      await openEditor(pageId);

      // google-map — Mod B alanları.
      await expect(page.getByRole("textbox", { name: "Adres", exact: true })).toHaveValue("İstanbul, Beşiktaş");
      await expect(page.getByRole("spinbutton", { name: "Yakınlaştırma (zoom)" })).toHaveValue("12");
      await expect(page.getByRole("spinbutton", { name: "Yükseklik değeri" })).toHaveValue("350");
      await expect(page.getByRole("button", { name: "px", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Koyu", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("textbox", { name: "Harita başlığı (opsiyonel)" })).toHaveValue("Merkez Ofis");

      // accordion — layoutStyle + isOpenDefault.
      await expect(page.getByRole("button", { name: "Kart", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("textbox", { name: "Soru", exact: true })).toHaveValue("Kargo süresi nedir?");
      await expect(page.getByRole("switch", { name: "Varsayılan olarak açık" })).toHaveAttribute("aria-checked", "true");

      // before-after-slider — initialSliderPosition.
      await expect(page.getByText("Başlangıç pozisyonu: %30", { exact: true })).toBeVisible();
      await expect(page.locator("#qa-rt-ba-initial-position")).toHaveValue("30");

      // pricing-table — billingInterval.
      await expect(page.getByRole("button", { name: "Yıllık", exact: true })).toHaveAttribute("aria-pressed", "true");

      // logo-marquee — displayMode + grayscale.
      await expect(page.getByRole("button", { name: "Izgara", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("switch", { name: "Siyah-beyaz göster" })).toHaveAttribute("aria-checked", "false");
      // `displayMode: "grid"` iken hız/üzerine-gelince-durdur alanları UI'da GİZLENİR (mimar §2.5).
      await expect(page.getByText("Hız (bir tam döngü, saniye)")).toHaveCount(0);

      // video — loop + playStyle + coverUrl.
      await expect(page.getByRole("switch", { name: "Döngüde oynat" })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByRole("button", { name: "Kapak + tam ekran", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("textbox", { name: "Kapak görseli" })).toHaveValue("https://example.com/qa-rt-cover.png");
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("google-map (Mod A — Yerleştirme Kodu/embedUrl) — kaynak sekmesi ve embedUrl metni yeniden yüklemede korunur", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("roundtrip-map-embed");
    try {
      const embedUrl = "https://www.google.com/maps/embed?pb=qa-e2e-test-pb-string";
      await patchPageBlocks(token, pageId, [{ id: "qa-rt-map-embed", type: "google-map", data: { embedUrl } }]);

      await openEditor(pageId);

      // Mod, `embedUrl` doluluğundan çıkarılır (mimar §2.1 yorumu) — "Yerleştirme Kodu" sekmesi
      // otomatik AKTİF gelmeli.
      await expect(page.getByRole("button", { name: "Yerleştirme Kodu", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("textbox", { name: "Google Haritayı Yerleştir kodu" })).toHaveValue(embedUrl);
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("google-map (Mod A) — 'Yerleştirme Kodu' alanına TAM iframe HTML snippet'i yapıştırılınca alan anında temizlenmiş çıplak URL'i gösterir ve bu hâliyle kaydedilip yeniden yüklemede korunur", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("iframe-paste");
    try {
      await openEditorAndRemoveDefaultBlock(pageId);
      await page.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
      await page.getByRole("button", { name: "Tek Sütun" }).click();
      await page.getByRole("button", { name: "Konteynere blok ekle" }).click();
      await page.getByRole("tab", { name: "Medya & İnteraktif" }).click();
      await page.getByRole("menuitem", { name: "Google Harita", exact: true }).click();

      await page.getByRole("button", { name: "Yerleştirme Kodu", exact: true }).click();
      const embedTextbox = page.getByRole("textbox", { name: "Google Haritayı Yerleştir kodu" });
      const iframeSnippet =
        '<iframe src="https://www.google.com/maps/embed?pb=!1m18!2m0" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>';
      await embedTextbox.fill(iframeSnippet);
      // Bileşenin `onChange`'i (`google-map-block.tsx` ~L160) yapıştırılan değeri ANINDA
      // `extractGoogleMapEmbedUrlFromInput` ile temizler — textarea ham HTML'i DEĞİL, çıkarılmış
      // çıplak URL'i göstermeli (kullanıcı geri bildirimi, mimar §2.1 yorumu).
      await expect(embedTextbox).toHaveValue("https://www.google.com/maps/embed?pb=!1m18!2m0");

      // Açıkça "Kaydet" (bu editör autosave DEĞİL — `admin-page-builder-containers.spec.ts::
      // saveAndExpectSuccess` ile AYNI desen), sonra sayfayı yeniden yükle (kalıcılık kanıtı).
      await page.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(page.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
      await openEditor(pageId);
      await expect(page.getByRole("button", { name: "Yerleştirme Kodu", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("textbox", { name: "Google Haritayı Yerleştir kodu" })).toHaveValue(
        "https://www.google.com/maps/embed?pb=!1m18!2m0"
      );
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

// ---------------------------------------------------------------------------
// Katman 2b — public site render (gerçek public URL, admin DIŞINDA)
// ---------------------------------------------------------------------------
test.describe("Public render — google-map + kurumsal bloklar (CLS=0, JSON-LD, konsol hatası yok)", () => {
  test("Google Harita — iframe doğru src + rezerve yükseklik (CLS=0) + sandbox/referrerPolicy/title ile render olur, beklenmeyen istek/JS hatası oluşmaz", async () => {
    const { pageId, slug } = await createHostPage("map-render", "PUBLISHED");
    try {
      const address = "İstanbul, Beşiktaş";
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-map-render",
          type: "google-map",
          data: {
            address,
            zoom: 12,
            height: { value: 350, unit: "px" },
            mapStyle: "dark",
            markerTitle: "Merkez Ofis",
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      const pageErrors: Error[] = [];
      publicPage.on("pageerror", (err) => pageErrors.push(err));
      // qa-agent bulgusu (bu turda tespit edildi, google-map/kurumsal bloklarla İLGİSİZ — kök
      // layout'un anonim ziyaretçilerde bile sessizce denediği `POST /auth/refresh` çağrısı,
      // refresh-token çerezi yokken 401 döner; bu HER public sayfada — google-map olsun olmasın —
      // tekrarlanan, önceden var olan bir davranış, `frontend-agent`'a AYRICA raporlanacak). Bu
      // BİLİNEN 401'i, "beklenmeyen başarısız istek" denetiminden hariç tut — aksi halde bu test
      // kendi bloğuyla İLGİSİZ, sitedeki HER sayfada oluşan bir durumdan dolayı yanlışlıkla
      // kararsız (flaky) görünürdü (bkz. proje kuralı #3).
      const unexpectedFailedRequests: string[] = [];
      publicPage.on("response", (res) => {
        if (res.status() >= 400 && !res.url().endsWith("/auth/refresh")) {
          unexpectedFailedRequests.push(`${res.status()} ${res.url()}`);
        }
      });
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);

        // `getMapEmbedUrl` (Mod B, `map-embed.ts`) — SABİT şablon, `encodeURIComponent(address)`,
        // `locale` bu render yolunda geçilmiyor → kapalı listenin varsayılanı `hl=tr`ye düşer.
        const expectedSrc = `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=12&hl=tr&output=embed`;
        const iframe = publicPage.locator(`iframe[src="${expectedSrc}"]`);
        await expect(iframe).toHaveCount(1, { timeout: 15_000 });
        await expect(iframe).toHaveAttribute("title", "Merkez Ofis");
        // security-review §4.1/§4.2 BAĞLAYICI nitelikleri — TEK kaynak `map-embed.ts::MAP_IFRAME_SANDBOX`.
        await expect(iframe).toHaveAttribute(
          "sandbox",
          "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
        );
        await expect(iframe).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        await expect(iframe).toHaveAttribute("loading", "lazy");
        // `mapStyle: "dark"` — sabit CSS `filter` tablosu (security-review §4.3, ASLA string
        // enterpolasyonu DEĞİL, yalnızca anahtar-değer look-up).
        await expect(iframe).toHaveAttribute("style", /invert\(90%\)/);

        // CLS=0 — sarmalayıcı `style={{ height }}` ile ÖNCEDEN rezerve edilir (mimar §7.6/3).
        const wrapper = publicPage.locator('div[style*="350px"]').filter({ has: iframe });
        await expect(wrapper).toHaveCount(1);

        expect(unexpectedFailedRequests, `Beklenmeyen başarısız istekler: ${unexpectedFailedRequests.join(" | ")}`).toEqual([]);
        expect(pageErrors, `Sayfa hataları: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([]);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("2+ Akordiyon bloğu — sayfada TEK FAQPage JSON-LD script'i basılır, tüm soru/cevaplar mainEntity'de birleşir", async () => {
    const { pageId, slug } = await createHostPage("faq-jsonld", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-faq-a",
          type: "accordion",
          data: { items: [{ id: "qa-faq-a1", question: "Kargo ücreti ne kadar?", answer: "50 TL." }], allowMultipleOpen: false },
        },
        {
          id: "qa-faq-b",
          type: "accordion",
          data: {
            items: [{ id: "qa-faq-b1", question: "İade süresi kaç gün?", answer: "14 gün.", isOpenDefault: true }],
            allowMultipleOpen: false,
            layoutStyle: "minimal",
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByText("Kargo ücreti ne kadar?")).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByText("İade süresi kaç gün?")).toBeVisible();

        // Boşluk 1 (seo-agent, `structured-data.ts::buildFaqPageJsonLd`) — SAYFA BAŞINA TEK script,
        // her accordion KENDİ script'ini basmaz.
        const scripts = publicPage.locator('script[type="application/ld+json"]');
        await expect(scripts).toHaveCount(1);
        const raw = await scripts.first().textContent();
        expect(raw).toBeTruthy();
        const json = JSON.parse(raw as string) as { "@type": string; mainEntity: { name: string }[] };
        expect(json["@type"]).toBe("FAQPage");
        expect(json.mainEntity).toHaveLength(2);
        expect(json.mainEntity.map((q) => q.name).sort()).toEqual(["Kargo ücreti ne kadar?", "İade süresi kaç gün?"].sort());
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Fiyatlandırma Tablosu — billingInterval ('Yıllık') rozeti render olur", async () => {
    const { pageId, slug } = await createHostPage("pricing-billing", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-pricing-billing",
          type: "pricing-table",
          data: {
            plans: [
              {
                id: "qa-pb-plan-1",
                name: "Kurumsal",
                price: "₺2999",
                features: ["Öncelikli destek"],
                buttonLabel: "İletişime Geç",
                buttonHref: "/iletisim",
              },
            ],
            billingInterval: "yearly",
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByRole("heading", { name: "Kurumsal" })).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByText("Yıllık", { exact: true })).toBeVisible();
        await expect(publicPage.getByText("Aylık", { exact: true })).toHaveCount(0);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Logo Bandı — 'grid' modu TEKİL render olur (marquee kopyası YOK) ve grayscale:false opasite sınıfı kullanır", async () => {
    const { pageId, slug } = await createHostPage("logo-grid", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-logo-grid",
          type: "logo-marquee",
          data: {
            items: [{ id: "qa-logo-grid-i1", url: "https://example.com/qa-grid-logo.png", alt: "Grid Logo" }],
            speedSeconds: 30,
            pauseOnHover: true,
            displayMode: "grid",
            grayscale: false,
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        const img = publicPage.locator('img[src="https://example.com/qa-grid-logo.png"]');
        // Grid modu — kesintisiz döngü kopyası YOK (marquee'nin AKSİNE), TEK `<img>`.
        await expect(img).toHaveCount(1, { timeout: 15_000 });
        await expect(img).not.toHaveClass(/grayscale/);
        await expect(img).toHaveClass(/opacity-90/);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Öncesi/Sonrası — initialSliderPosition public render'da başlangıç ARIA değeri olarak yansır", async () => {
    const { pageId, slug } = await createHostPage("ba-initial-position", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-ba-pos",
          type: "before-after-slider",
          data: {
            beforeUrl: "https://example.com/qa-pos-before.png",
            afterUrl: "https://example.com/qa-pos-after.png",
            beforeLabel: "Öncesi",
            afterLabel: "Sonrası",
            orientation: "horizontal",
            initialSliderPosition: 72,
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByRole("slider")).toHaveAttribute("aria-valuenow", "72", { timeout: 15_000 });
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Video — playStyle:'lightbox' kapak+oynat tetikleyicisi render olur, tıklanınca loop parametreli embed açılır", async () => {
    const { pageId, slug } = await createHostPage("video-lightbox-loop", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-video-lightbox",
          type: "video",
          data: {
            provider: "youtube",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            autoplay: false,
            muted: true,
            loop: true,
            playStyle: "lightbox",
            coverUrl: "https://example.com/qa-video-cover.png",
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        const trigger = publicPage.getByRole("button", { name: "Videoyu oynat" });
        await expect(trigger).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.locator('img[src="https://example.com/qa-video-cover.png"]')).toBeVisible();
        // Tıklanmadan ÖNCE embed iframe DOM'da YOK (lightbox tetikleyicisi salt kapak+rozet).
        await expect(publicPage.locator('iframe[src*="youtube-nocookie.com"]')).toHaveCount(0);

        await trigger.click();
        // `video-embed.ts::getVideoEmbedUrl` — YouTube `loop=1` TEK BAŞINA yetersiz, `playlist=<id>`
        // İLE BİRLİKTE gönderilir (mimar §2.6/R5).
        const embedIframe = publicPage.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]');
        await expect(embedIframe).toBeVisible();
        await expect(embedIframe).toHaveAttribute("src", /loop=1/);
        await expect(embedIframe).toHaveAttribute("src", /playlist=dQw4w9WgXcQ/);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

// ---------------------------------------------------------------------------
// Geriye dönük uyumluluk (ZORUNLU, mimar §7.6/4 + §1.2 + R1) — yeni alanların HİÇBİRİNİ içermeyen
// eski şekilli bloklar bugünküyle AYNI render edilmeli. `logo-marquee` için ÖZELLİKLE: `grayscale`
// alanı OLMAYAN bir kayıt hâlâ grayscale görünmeli (`?? true` — R1 riski).
// ---------------------------------------------------------------------------
test.describe("Geriye dönük uyumluluk — eski veri şekli (yeni alanlar YOK)", () => {
  test("accordion/before-after-slider/pricing-table/logo-marquee/video — eski (Faz-öncesi) veri şekli hiçbir YENİ alan OLMADAN kabul edilir ve BUGÜNKÜ davranışla render olur", async () => {
    const { pageId, slug } = await createHostPage("legacy-shape", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        // `layoutStyle`/`items[].isOpenDefault` YOK.
        {
          id: "qa-legacy-accordion",
          type: "accordion",
          data: { items: [{ id: "qa-legacy-acc-i1", question: "Eski soru", answer: "Eski cevap" }], allowMultipleOpen: false },
        },
        // `initialSliderPosition` YOK — %50 varsayılanı.
        {
          id: "qa-legacy-ba",
          type: "before-after-slider",
          data: {
            beforeUrl: "https://example.com/qa-legacy-before.png",
            afterUrl: "https://example.com/qa-legacy-after.png",
            beforeLabel: "Önce",
            afterLabel: "Sonra",
            orientation: "horizontal",
          },
        },
        // `billingInterval` YOK — hiçbir rozet render EDİLMEZ.
        {
          id: "qa-legacy-pricing",
          type: "pricing-table",
          data: {
            plans: [
              {
                id: "qa-legacy-plan-1",
                name: "Eski Plan",
                price: "₺199",
                features: ["Eski özellik"],
                buttonLabel: "Satın Al",
                buttonHref: "/eski-satin-al",
              },
            ],
          },
        },
        // `displayMode`/`grayscale` YOK — R1: grayscale HÂLÂ true (hard-code'un aynısı) olmalı.
        {
          id: "qa-legacy-logo",
          type: "logo-marquee",
          data: {
            items: [{ id: "qa-legacy-logo-i1", url: "https://example.com/qa-legacy-logo.png", alt: "Eski Logo" }],
            speedSeconds: 20,
            pauseOnHover: true,
          },
        },
        // `coverUrl`/`playStyle`/`loop` YOK — inline (bugünkü) davranış.
        {
          id: "qa-legacy-video",
          type: "video",
          data: { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", autoplay: false, muted: true },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);

        // accordion — bugünkü ("bordered") görünüm, işlevsel olarak değişmedi.
        await expect(publicPage.getByText("Eski soru")).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByRole("button", { name: "Eski soru" })).toHaveAttribute("aria-expanded", "false");

        // before-after-slider — initialSliderPosition YOK → %50.
        await expect(publicPage.getByRole("slider")).toHaveAttribute("aria-valuenow", "50");

        // pricing-table — billingInterval YOK → "Aylık"/"Yıllık" rozeti HİÇ render EDİLMEZ.
        await expect(publicPage.getByRole("heading", { name: "Eski Plan" })).toBeVisible();
        await expect(publicPage.getByText("Aylık", { exact: true })).toHaveCount(0);
        await expect(publicPage.getByText("Yıllık", { exact: true })).toHaveCount(0);

        // logo-marquee — R1: `grayscale` alanı YOK → hâlâ grayscale (marquee modu, 2 kopya).
        const legacyLogoImg = publicPage.locator('img[src="https://example.com/qa-legacy-logo.png"]');
        await expect(legacyLogoImg).toHaveCount(2);
        await expect(legacyLogoImg.first()).toHaveClass(/grayscale/);

        // video — playStyle YOK → inline (bugünkü) davranış: "Videoyu oynat" tetikleyicisi YOK,
        // iframe doğrudan gömülü ve `loop` parametresi YOK.
        await expect(publicPage.getByRole("button", { name: "Videoyu oynat" })).toHaveCount(0);
        const legacyVideoIframe = publicPage.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]');
        await expect(legacyVideoIframe).toBeVisible();
        await expect(legacyVideoIframe).not.toHaveAttribute("src", /loop=1/);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

// ---------------------------------------------------------------------------
// Güvenlik (negatif, API seviyesinde) — mimar §7.6/5 + security-review §2 negatif matrisinin BİR
// ÖRNEĞİ. Tam matris (userinfo-trick/port enjeksiyonu/case-bypass/enum-prefix bypass vb.) backend
// `pages.schemas.test.ts`te (Vitest) ZATEN kapsanıyor — burada YALNIZCA e2e-seviye smoke.
// ---------------------------------------------------------------------------
test.describe("Güvenlik (negatif) — google-map embedUrl beyaz liste smoke testi", () => {
  test("evil.com / http:// / maps.google.com (bölgesel alt-domain) / javascript: embedUrl değerleri 422 ile reddedilir", async () => {
    const { pageId } = await createHostPage("security-negative");
    try {
      const maliciousUrls = [
        "https://evil.com/maps/embed?x=1",
        "http://www.google.com/maps/embed?x=1",
        "https://maps.google.com/maps/embed?x=1",
        "javascript:alert(1)",
      ];
      for (const embedUrl of maliciousUrls) {
        const res = await fetch(`${API_BASE_URL}/admin/pages/${pageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ blocks: [{ id: "qa-sec-map", type: "google-map", data: { embedUrl } }] }),
        });
        expect(res.status, `embedUrl="${embedUrl}" 422 dönmeli, gerçek: ${res.status}`).toBe(422);
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});
