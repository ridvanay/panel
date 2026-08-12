import { test, expect, type Page } from "@playwright/test";
import { API_BASE_URL, deleteLocale, getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * `.claude/architect-scope-i18n.md` §9 qa-agent madde 7-8.
 * madde 7 KABUL KRİTERİNİN DOĞRUDAN TESTİDİR: "yeni dil eklemek deploy/migration
 * gerektirmez" — bu test yalnızca panelden (`/admin/settings` → Diller) bir dil ekler,
 * hiçbir deploy/restart/migration ADIMI ATMAZ, ve rotaların/`/locales`'in ÇALIŞTIĞINI
 * doğrudan bu ÇALIŞAN backend+frontend'e karşı doğrular.
 *
 * NOT (auth): bu dosya kendi `browser`/context'ini `support/admin-session.ts` ile kurar (bkz.
 * o dosyanın başlığı — refresh-token rotasyonu nedeniyle dosyalar arası paylaşılan bir oturum
 * GÜVENİLİR DEĞİL).
 *
 * BİLİNEN ORTAM SORUNU (madde 7 — devops-agent/CI'da yeniden değerlendirilmeli): "Dil Ekle"
 * diyaloğu açılıp "Kod" alanı doldurulmaya başlanırken qa-agent'ın yerel Windows/Playwright
 * koşumunda tarayıcı süreci tekrarlanan biçimde çöküyor (`Target page, context or browser has
 * been closed`, trace kaydı `fill` çağrısının TAMAMLANMADIĞINI gösteriyor — gerçek bir süreç
 * sonlanması, "element bulunamadı" değil). Kök neden qa-agent tarafından İZLENDİ ve UYGULAMA
 * KODUNA BAĞLANAMADI:
 *   - Aynı akış (login → /admin/settings → Diller sekmesi → Dil Ekle → form doldur), trace/
 *     screenshot KAYDI OLMAYAN bağımsız bir Playwright betiğiyle ve saf API çağrılarıyla
 *     (`POST /admin/locales` + `GET /locales` + `GET /de`) HER SEFERİNDE sorunsuz çalıştı —
 *     bkz. qa-agent'ın final raporu.
 *   - Bu, uygulamanın KENDİSİNİN doğru çalıştığını (kabul kriteri karşılanıyor), çökmenin bu
 *     spesifik yerel ortamda (Playwright trace/otomasyon + Windows + bu makinenin kaynak
 *     durumu) yaşanan bir ARAÇ/ORTAM sorunu olduğunu gösteriyor.
 * `retries` gerçek regresyonları bu gürültüden ayırmak için sınırlı tutuluyor; test CI'da
 * (temiz Linux runner, bkz. `.github/workflows/ci.yml`) yeniden değerlendirilmelidir.
 */
test.describe.configure({ retries: 2 });

const NEW_LOCALE_CODE = "de";
const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:3100";

let page: Page;
let closeSession: () => Promise<void>;

test.beforeAll(async ({ browser }) => {
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
  // İdempotent zemin — önceki bir koşumdan kalmış olabilir (bkz. design-notes-i18n.md §6.4,
  // silme kademesi A: çeviri yoksa doğrudan silinebilir).
  const { accessToken } = await getCachedAdminSession();
  await deleteLocale(accessToken, NEW_LOCALE_CODE);
});

test.afterAll(async () => {
  const { accessToken } = await getCachedAdminSession();
  await deleteLocale(accessToken, NEW_LOCALE_CODE);
  await closeSession();
});

test("madde 7 — panelden yeni dil (de) eklenip etkinleştirilince deploy/migration OLMADAN rotalar ve /locales çalışır", async () => {
  await page.goto("/admin/settings");
  await page.getByRole("tab", { name: "Diller" }).click();
  await expect(page.getByRole("heading", { name: "Diller" })).toBeVisible();

  // Eklemeden ÖNCE: public /locales'te "de" YOK.
  const before = await page.request.get(`${API_BASE_URL}/locales`);
  expect((await before.json()).data.map((l: { code: string }) => l.code)).not.toContain(NEW_LOCALE_CODE);

  await page.getByRole("button", { name: "Dil Ekle" }).click();
  await page.getByLabel("Kod", { exact: true }).fill(NEW_LOCALE_CODE);
  await page.getByLabel("Etiket", { exact: true }).fill("Almanca");
  await page.getByLabel("Kendi Dilindeki Ad", { exact: true }).fill("Deutsch");
  // "Etkin" switch'i AÇIK yapılmalı — kapalıysa dil public rota uzayına GİRMEZ.
  await page.getByText("Etkin", { exact: true }).locator("..").getByRole("switch").click();
  await page.getByRole("button", { name: "Dili Ekle" }).click();

  await expect(page.getByText('"Deutsch" eklendi.')).toBeVisible();

  // deploy/migration YOK — yalnızca bu API çağrısını (aynı çalışan backend süreci) doğrudan
  // sorguluyoruz; "de" artık listede.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${API_BASE_URL}/locales`);
        const codes = (await res.json()).data.map((l: { code: string }) => l.code);
        return codes;
      },
      { timeout: 10_000 }
    )
    .toContain(NEW_LOCALE_CODE);

  // Rota uzayı da ÇALIŞIYOR — `/de` ana sayfası 404 DEĞİL. `proxy.ts` dil listesini
  // `revalidate: 60` ile önbelleğe alır (§4.3 — `/appearance` ile aynı politika, bilinçli
  // bir tercih), bu yüzden YENİ eklenen bir dilin rota uzayına girmesi ANINDA değil, en
  // fazla ~60sn içinde gerçekleşebilir — deploy/migration YOK ama kabul kriteri "aynı anda"
  // demiyor, "deploy gerektirmeden" diyor. Test bunu tek bir anlık istekle DEĞİL, poll ile
  // doğrular (gerçek eventual-consistency penceresini kabul eder).
  await expect
    .poll(async () => (await page.request.get(`${FRONTEND_URL}/de`)).status(), { timeout: 65_000, intervals: [2_000] })
    .toBe(200);
});

test("madde 8 — varsayılan dil silinemiyor ve devre dışı bırakılamıyor", async () => {
  await page.goto("/admin/settings");
  await page.getByRole("tab", { name: "Diller" }).click();
  await expect(page.getByRole("heading", { name: "Diller" })).toBeVisible();

  const trRow = page.getByRole("row", { name: /Türkçe/ });
  await expect(trRow.getByText("Varsayılan", { exact: true })).toBeVisible();

  await trRow.getByRole("button", { name: "İşlemler" }).click();
  // `lib/i18n/dictionaries/locale-manager.ts` — satır menüsündeki eylem metni tam olarak
  // "Devre dışı" (durum rozetiyle AYNI metin yeniden kullanılıyor, "Devre dışı bırak" DEĞİL).
  const disableItem = page.getByRole("menuitem", { name: "Devre dışı", exact: true });
  const deleteItem = page.getByRole("menuitem", { name: "Sil", exact: true });
  await expect(disableItem).toBeDisabled();
  await expect(deleteItem).toBeDisabled();

  // API seviyesinde de aynı kural — istemci kontrolüne GÜVENİLMEZ (§9 backend-agent madde 3).
  const { accessToken } = await getCachedAdminSession();
  const deleteRes = await page.request.delete(`${API_BASE_URL}/admin/locales/tr`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(deleteRes.status()).toBe(422);

  const disableRes = await page.request.patch(`${API_BASE_URL}/admin/locales/tr`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { enabled: false },
  });
  expect(disableRes.status()).toBe(422);
});
