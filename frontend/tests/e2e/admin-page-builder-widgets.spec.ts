import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, createPage as createPageFixture, deletePagePermanently, patchPageBlocks } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * Görsel widget'lar (Öncesi/Sonrası, Logo Bandı, İlerleme Çubuğu, Ekip Üyesi Kartı) + Konteyner
 * arka plan geliştirmeleri (Gradient/Animasyonlu/Overlay). `admin-page-builder-marketing.spec.ts`
 * ile AYNI iki-katmanlı desen: (1) admin editöründe kategori/menü kaydının çalıştığını doğrulayan
 * hafif bir UI testi, (2) `patchPageBlocks` ile kurulup GERÇEK backend+Postgres'e karşı public
 * URL'de render kontrolü.
 */
test.describe.configure({ retries: 1 });

const PAGE_TITLE_PREFIX = "QaE2eWidgetsPage";
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
  const slug = `qa-wgt-${prefix}-${unique}`;
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

/** Boş bir konteynerin AYNI ayarlarıyla, farklı `background`li bir kök düğüm üretir. */
function containerWith(id: string, background: unknown, children: unknown[] = []) {
  return {
    id,
    type: "container",
    settings: {
      layout: "boxed",
      direction: "column",
      justifyContent: "start",
      alignItems: "stretch",
      gap: 16,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      background,
    },
    children,
  };
}

test.describe("Görsel widget'lar — admin editörü (kategori/menü kaydı)", () => {
  test("Öncesi/Sonrası, Logo Bandı, İlerleme Çubuğu ve Ekip Üyesi Kartı doğru kategoriden eklenir ve varsayılan içerikle render olur", async () => {
    test.setTimeout(60_000);
    const { pageId } = await createHostPage("category-wiring");
    try {
      await openEditorAndRemoveDefaultBlock(pageId);
      // Sabit "DÜZEN" paneli kaldırıldı (`.claude/design-notes-page-builder-dynamic-container-
      // insertion.md`) — sayfa TAMAMEN boşken tetikleyici artık boş-durum hero'sunun İÇİNDEKİ
      // "Yeni Konteyner Ekle" düğmesi, popover'ı açar; karo tıklaması aynen kalır.
      await page.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
      await page.getByRole("button", { name: "Tek Sütun" }).click();
      await page.getByRole("button", { name: "Konteynere blok ekle" }).click();
      await page.getByRole("tab", { name: "Medya & İnteraktif" }).click();
      await page.getByRole("menuitem", { name: "Öncesi / Sonrası", exact: true }).click();
      await expect(page.getByText("Önce görseli")).toBeVisible();
      await expect(page.getByText("Sonra görseli")).toBeVisible();

      await page.getByRole("button", { name: "Konteynere daha fazla blok ekle" }).click();
      await page.getByRole("tab", { name: "Pazarlama & Sosyal Kanıt" }).click();
      await page.getByRole("menuitem", { name: "Logo Bandı", exact: true }).click();
      await expect(page.getByRole("spinbutton").last()).toHaveValue("30");

      await page.getByRole("button", { name: "Konteynere daha fazla blok ekle" }).click();
      await page.getByRole("tab", { name: "Pazarlama & Sosyal Kanıt" }).click();
      await page.getByRole("menuitem", { name: "İlerleme Çubuğu & Yetenekler", exact: true }).click();
      // "Yüzde" bu sayfada BENZERSİZ bir alan adı (skill-bar'a özgü) — "Başlık"ın aksine sayfanın
      // kendi başlık alanıyla ÇAKIŞMAZ.
      await expect(page.getByRole("spinbutton", { name: "Yüzde" }).first()).toHaveValue("80");

      await page.getByRole("button", { name: "Konteynere daha fazla blok ekle" }).click();
      await page.getByRole("tab", { name: "Pazarlama & Sosyal Kanıt" }).click();
      await page.getByRole("menuitem", { name: "Ekip Üyesi Kartı", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Ad Soyad" }).last()).toHaveValue("Ad Soyad");

      // KAYDETME ADIMI YOK — `before-after-slider`in varsayılanı `beforeUrl`/`afterUrl` BOŞ
      // bırakır (`ImageBlock.url` ile AYNI, ÖNCEDEN VAR OLAN gerekçe: bir görsel alanının
      // "gerçekçi" bir varsayılanı OLAMAZ, kaydetmeden ÖNCE yüklenmesi GEREKİR) — burada asıl
      // doğrulanan kategori/menü KAYDI, alanların GÖRÜNÜRLÜĞÜyle zaten kanıtlandı. Geçerli
      // veriyle uçtan uca KAYDETME/RENDER, aşağıdaki `patchPageBlocks` testlerinde ayrıca
      // doğrulanıyor.
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});

test.describe("Görsel widget'lar — public site render (gerçek public URL, admin DIŞINDA)", () => {
  test("Öncesi/Sonrası — iki görsel + etiketler + tutamaç doğru yönde render olur", async () => {
    const { pageId, slug } = await createHostPage("before-after", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-ba",
          type: "before-after-slider",
          data: {
            beforeUrl: "https://example.com/qa-before.png",
            afterUrl: "https://example.com/qa-after.png",
            beforeLabel: "Eski Hâli",
            afterLabel: "Yeni Hâli",
            orientation: "vertical",
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByText("Eski Hâli")).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByText("Yeni Hâli")).toBeVisible();
        await expect(publicPage.locator('img[src="https://example.com/qa-before.png"]')).toHaveCount(1);
        await expect(publicPage.locator('img[src="https://example.com/qa-after.png"]')).toHaveCount(1);
        await expect(publicPage.getByRole("slider")).toHaveAttribute("aria-orientation", "vertical");
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Logo Bandı — kesintisiz döngü için içerik İKİ KEZ render olur, ikinci kopya aria-hidden", async () => {
    const { pageId, slug } = await createHostPage("logo-marquee", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-marquee",
          type: "logo-marquee",
          data: {
            items: [
              { id: "l1", url: "https://example.com/qa-logo-a.png", alt: "Logo A" },
              { id: "l2", url: "https://example.com/qa-logo-b.png", alt: "Logo B" },
            ],
            speedSeconds: 20,
            pauseOnHover: true,
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        // 2 logo × 2 kopya (dikişsiz döngü) = 4 `<img>`.
        await expect(publicPage.locator('img[src="https://example.com/qa-logo-a.png"]')).toHaveCount(2, { timeout: 15_000 });
        await expect(publicPage.locator('img[src="https://example.com/qa-logo-b.png"]')).toHaveCount(2);
        await expect(publicPage.locator('[aria-hidden="true"] img[src="https://example.com/qa-logo-a.png"]')).toHaveCount(1);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("İlerleme Çubuğu — yüzde değeri hem metin hem ARIA progressbar olarak doğru render olur", async () => {
    const { pageId, slug } = await createHostPage("skill-bar", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        { id: "qa-skill", type: "skill-bar", data: { items: [{ id: "s1", label: "TypeScript", percent: 87 }] } },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByText("TypeScript")).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByText("%87")).toBeVisible();
        await expect(publicPage.getByRole("progressbar", { name: "TypeScript" })).toHaveAttribute("aria-valuenow", "87");
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Ekip Üyesi Kartı — ad/unvan/biyografi + sosyal bağlantı ikonu doğru render olur", async () => {
    const { pageId, slug } = await createHostPage("team", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        {
          id: "qa-team",
          type: "team",
          data: {
            members: [
              {
                id: "m1",
                name: "Ayşe Yılmaz",
                role: "Kurucu Ortak",
                bio: "10 yıllık deneyim.",
                socialLinks: [{ id: "sl1", platform: "LINKEDIN", url: "https://linkedin.com/in/qa-ayse" }],
              },
            ],
          },
        },
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.getByText("Ayşe Yılmaz")).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.getByText("Kurucu Ortak")).toBeVisible();
        await expect(publicPage.getByText("10 yıllık deneyim.")).toBeVisible();
        // Fotoğraf YOK — baş harf rozetine düşer (`testimonial` ile AYNI desen).
        await expect(publicPage.getByText("AY", { exact: true })).toBeVisible();
        const link = publicPage.getByRole("link", { name: "LinkedIn" });
        await expect(link).toHaveAttribute("href", "https://linkedin.com/in/qa-ayse");
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });

  test("Konteyner arka planı — gradient/animasyonlu/overlay stilleri doğru inline style üretir", async () => {
    const { pageId, slug } = await createHostPage("container-bg", "PUBLISHED");
    try {
      await patchPageBlocks(token, pageId, [
        containerWith("qa-bg-gradient", {
          type: "gradient",
          gradientType: "linear",
          colorFrom: "#111827",
          colorTo: "#1e40af",
          direction: "custom-angle",
          angle: 135,
        }),
        containerWith("qa-bg-dots", { type: "animated", variant: "dots", patternColor: "#94a3b8" }),
        containerWith("qa-bg-wave", { type: "animated", variant: "gradient-wave", colorFrom: "#4f46e5", colorTo: "#0ea5e9" }),
        containerWith("qa-bg-overlay", {
          type: "image",
          value: "https://example.com/qa-bg.png",
          position: "center",
          size: "cover",
          repeat: "no-repeat",
          overlay: { color: "#000000", opacity: 40 },
        }),
      ]);

      const publicContext = await page.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${slug}`);
        await expect(publicPage.locator('div[style*="135deg"]')).toHaveCount(1, { timeout: 15_000 });
        await expect(publicPage.locator('div[style*="135deg"]')).toHaveAttribute("style", /#111827/);
        await expect(publicPage.locator('div[style*="135deg"]')).toHaveAttribute("style", /#1e40af/);

        await expect(publicPage.locator('div[style*="radial-gradient"]')).toHaveCount(1);

        await expect(publicPage.locator(".pb-bg-gradient-wave")).toHaveCount(1);
        await expect(publicPage.locator(".pb-bg-gradient-wave")).toHaveAttribute("style", /linear-gradient\(120deg/);

        const overlayDiv = publicPage.locator('div[style*="qa-bg.png"]');
        await expect(overlayDiv).toHaveCount(1);
        await expect(overlayDiv).toHaveAttribute("style", /rgba\(0, 0, 0, 0\.4\)/);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(token, pageId);
    }
  });
});
