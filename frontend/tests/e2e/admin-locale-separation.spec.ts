import { test, expect, type Page } from "@playwright/test";
import { createPage, deletePagePermanently, getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * `.claude/architect-scope-i18n.md` §9 qa-agent madde 5-6 — panel arayüz dili (`adminLocale`)
 * ile içerik dili (`locale`) İKİ AYRI KAVRAM (§7.4). `/admin` locale prefix'i ALMAZ; panel
 * dili `localStorage`'da taşınır ve içerik düzenleme isteklerine ASLA `?locale=` olarak
 * geçirilmez.
 *
 * NOT: `#title` CSS id seçicisi KASITLI OLARAK `getByLabel("Başlık")` yerine kullanılır — bu
 * ortamda `getByLabel`'in erişilebilir-ad çözümlemesi ara sıra dolu bir input'u "bulunamadı"
 * olarak raporluyordu; ağ izini (trace) inceleyerek uygulamanın KENDİSİNİN doğru çalıştığı
 * doğrulandı (veri `GET`'i ve otomatik kayıt `POST`'u 200 dönüyor, form gerçekten dolu) — bu
 * bir Playwright/ortam zamanlama tuhaflığıydı, uygulama bug'ı DEĞİL. `#title` doğrudan DOM
 * id'sine bakar, aynı riski taşımaz.
 *
 * NOT (auth): bu dosya kendi `browser`/context'ini `support/admin-session.ts` ile kurar (bkz.
 * o dosyanın başlığı — refresh-token rotasyonu nedeniyle dosyalar arası paylaşılan bir oturum
 * GÜVENİLİR DEĞİL).
 */
const createdPageIds: string[] = [];
let page: Page;
let closeSession: () => Promise<void>;

test.beforeAll(async ({ browser }) => {
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  const { accessToken } = await getCachedAdminSession();
  for (const id of createdPageIds) await deletePagePermanently(accessToken, id);
  await closeSession();
});

// `context/i18n-context.tsx` — panel arayüz dili tercihinin `localStorage` anahtarı.
const ADMIN_LOCALE_STORAGE_KEY = "adminLocale";

test("madde 5 — /admin locale prefix ALMAZ; panel dili değişince admin URL DEĞİŞMEZ", async () => {
  await page.goto("/admin/pages");
  await expect(page).toHaveURL(/\/admin\/pages$/);
  // Sidebar TR varsayılanında "Sayfalar" gösterir.
  await expect(page.getByRole("link", { name: "Sayfalar", exact: true })).toBeVisible();

  // Panel dilini EN'e çevir (topbar — design-notes-i18n.md §1.2, aria-label "Dil").
  await page.getByRole("button", { name: "Dil" }).click();
  await page.getByRole("menuitem", { name: "EN", exact: true }).click();

  // URL DEĞİŞMEDİ — hiçbir `/en/admin/...` veya `?locale=` eklenmedi.
  await expect(page).toHaveURL(/\/admin\/pages$/);
  expect(new URL(page.url()).pathname).toBe("/admin/pages");
  expect(new URL(page.url()).searchParams.get("locale")).toBeNull();

  // Chrome metni artık İngilizce (§7.3 Faz 1 — sidebar `t()`'ye taşındı).
  await expect(page.getByRole("link", { name: "Pages", exact: true })).toBeVisible();

  // Sonraki testin bağımsız çalışabilmesi için bilinçli olarak TR'ye geri al (client-side,
  // navigasyon GEREKTİRMEZ).
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitem", { name: "TR", exact: true }).click();
});

test("madde 6 — panel dili EN iken TR içerik (yalnızca TR başlığı olan bir sayfa) normal şekilde düzenlenebiliyor", async () => {
  const { accessToken } = await getCachedAdminSession();
  const trTitle = `QA Yalnizca TR Baslik ${Date.now()}`;
  const created = await createPage(accessToken, {
    title: trTitle,
    slug: `qa-yalnizca-tr-${Date.now()}`,
    html: "<p>TR icerik.</p>",
  });
  createdPageIds.push(created.id as string);

  // `localStorage`'a yazabilmek için önce `about:blank` DIŞINDA bir origin'e gitmek gerekir.
  await page.goto("/admin/pages");
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [ADMIN_LOCALE_STORAGE_KEY, "en"]
  );

  await page.goto(`/admin/pages/${created.id}`);
  // İlk ziyaret — Next dev sunucusu (Turbopack) bu rotayı henüz derlememiş olabilir; derleme +
  // veri yüklemesi varsayılan 5s assertion timeout'unu aşabilir (uygulama davranışıyla İLGİSİZ,
  // yalnızca dev-server ilk-istek gecikmesi) — bu yüzden önce başlığın görünmesini daha uzun
  // bir sürede bekliyoruz.
  await expect(page.getByRole("heading", { name: "Sayfa Düzenleyici" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Language" })).toBeVisible();

  // adminLocale=EN olsa dahi, içerik editörü `locale` QUERY PARAMETRESİ OLARAK adminLocale'i
  // KULLANMAZ (§7.4) — düzenleme sekmesi hâlâ TR (varsayılan/kanonik) alanları gösterir ve
  // `title` alanı TR başlığı AYNEN taşır (boş/çevrilmiş DEĞİL).
  await expect(page.locator("#title")).toHaveValue(trTitle, { timeout: 15_000 });
});
