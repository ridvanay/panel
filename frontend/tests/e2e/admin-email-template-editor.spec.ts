import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { cleanupEmailTemplatesByPrefix } from "./support/notifications-fixtures";

/**
 * Kullanıcının açıkça istediği birinci odak: E-posta şablonu oluşturma → blok ekleme/sıralama →
 * değişken ekleme (hem sistem hem özel) → canlı önizleme → test e-postası gönderimi → aktifleştirme
 * akışı. Kaynak: ARCHITECTURE.md §10.16, `.claude/design-notes-email-editor-and-grid.md` Bölüm A.
 * Gerçek backend + Postgres'e (`saas_e2e`) karşı; test gönderimi backend'in dev-fallback Ethereal
 * SMTP hesabına gider (bkz. `backend/src/lib/mail.ts`) — GERÇEK bir posta kutusuna gitmez.
 *
 * `purpose = CUSTOM` bilinçli olarak seçildi (dialogdaki varsayılan) — WELCOME/PASSWORD_RESET gibi
 * sistem amaçlarını aktifleştirmek prod'daki gerçek gönderim akışlarını (kayıt/şifre sıfırlama)
 * etkileyebilirdi; CUSTOM'da "amaç başına tek aktif" kuralı UYGULANMAZ (§10.16.3), yani bu testin
 * aktifleştirmesi başka hiçbir şablonu etkilemez/pasifleştirmez.
 */
test.describe.configure({ retries: 1 });

const TEMPLATE_NAME_PREFIX = "QaE2eEmailTpl";

/**
 * Bir blok kartını SEÇMEK için kullanılır (sağ paneli o bloğun ayarlarına döndürür). Kartın
 * `onSelect` tetikleyicisi dış `div`'e bağlıdır (`email-canvas.tsx::EmailBlockCard`), ama sürükle
 * tutamacı butonu KASITLI olarak `stopPropagation()` çağırır (sürükleme başlatma tıklamayla
 * karışmasın diye) — bu yüzden tutamaca DEĞİL, tutamacın en yakın kart atasına (`cursor-pointer`
 * class'ı — hem seçili hem seçili-olmayan durumda sabit) tıklanır.
 */
function emailBlockCard(pg: Page, label: string) {
  return pg
    .locator(`button[aria-label="Sürükle: ${label}"]`)
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " cursor-pointer ")][1]');
}

/**
 * qa-agent bulgusu — `getByLabel(...)` bu ortamda gerçek `<label htmlFor>` (`Field` bileşeni)
 * eşleşmelerinde tekrarlanan biçimde 90s'de bile çözümlenmeden asılı kalıyor (BİREBİR
 * `admin-blog-tags.spec.ts::openEditPage`'teki belgelenmiş kategori) — `aria-label` tabanlı
 * eşleşmeler (`Şablon adı` gibi) ETKİLENMİYOR, yalnızca `<label for>` eşlemesi sorunlu. Blok
 * ayarları panelindeki alan id'leri `${block.id}-alan-adı` şeklinde DİNAMİK (`block.id` uuid),
 * bu yüzden düz `#id` yerine SABİT SONEK (suffix) ile eşleşen bir CSS seçici kullanılır — sağ
 * panelde HER ZAMAN yalnızca seçili bloğun alanları render edildiği için tekil kalır.
 */
function byIdSuffix(pg: Page, suffix: string) {
  return pg.locator(`[id$="${suffix}"]`);
}

let page: Page;
let closeSession: () => Promise<void>;
let token: string;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  token = session.accessToken;
  await cleanupEmailTemplatesByPrefix(token, TEMPLATE_NAME_PREFIX); // önceki başarısız koşumdan kalıntı olabilir
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  // NOT: bu testin aktifleştirdiği CUSTOM şablon büyük ihtimalle 409 ile SİLİNEMEYECEK — bkz.
  // notifications-fixtures.ts dosya başlığı (bilinen backend sınırlaması, backend-agent'a raporlandı).
  await cleanupEmailTemplatesByPrefix(token, TEMPLATE_NAME_PREFIX);
  if (closeSession) await closeSession();
});

test("e-posta şablonu oluşturma → blok ekleme → değişken ekleme (sistem+özel) → önizleme → test gönderimi → aktifleştirme", async () => {
  test.setTimeout(90_000);
  const unique = Date.now();
  const templateName = `${TEMPLATE_NAME_PREFIX} ${unique}`;

  // 1) Liste sayfasından yeni şablon oluştur (amaç: varsayılan "Özel"/CUSTOM).
  await page.goto("/admin/notifications/templates");
  await expect(page.getByRole("heading", { name: "Bildirimler" })).toBeVisible();
  await page.getByRole("button", { name: "Yeni Şablon" }).click();
  await expect(page.getByRole("heading", { name: "Yeni Şablon" })).toBeVisible();
  // NOT (qa-agent bulgusu) — `getByLabel(...)` bu dialogda `admin-blog-tags.spec.ts`'teki
  // BİREBİR AYNI kategori bir sorunla (bkz. o dosyanın `openEditPage` yorumu) tekrarlanan biçimde
  // "element(s) not found" ile 90s'de bile hiç çözümlenmedi — ekran görüntüsü elemanın GERÇEKTEN
  // DOM'da olduğunu gösteriyordu. Aynı kanıtlanmış düzeltme uygulandı: kararlı DOM id'sine geçildi.
  // "Kullanıldığı yer" varsayılanı zaten "Özel"/CUSTOM (dialog state'i) — dokunmaya GEREK YOK.
  await expect(page.locator("#new-template-purpose")).toHaveValue("CUSTOM");
  await page.locator("#new-template-name").fill(templateName);
  await page.getByRole("button", { name: "Oluştur", exact: true }).click();

  // 2) Editöre yönlendirildi.
  await page.waitForURL(/\/admin\/notifications\/templates\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(page.getByLabel("Şablon adı")).toHaveValue(templateName, { timeout: 15_000 });

  // qa-agent BULGUSU (frontend-agent'a raporlandı, TEST_COVERAGE.md'ye yazıldı) — sayfa ilk
  // açıldığında `GET .../templates/{id}` isteği BİRDEN FAZLA KEZ (gerçek koşumda 4 kez gözlendi,
  // `network` trace'i doğrulandı) tetikleniyor; bu isteklerden GEÇ dönen bir yanıt
  // `useEmailTemplateEditor::applyLoaded()` ile TÜM editör state'ini (name/subject/blocks/
  // customVariables) sessizce sıfırlıyor — istek iptali/AbortController veya "yalnızca en son
  // isteğin yanıtı kazanır" koruması YOK. Sonuç: kullanıcı sayfa açılır açılmaz (ilk ~1sn içinde)
  // bir alanı doldurursa düzenlemesi SESSİZCE kaybolabilir (gerçek veri kaybı). Bu bekleme o dar
  // yarış penceresini aşmak için EKLENDİ — testin kendisi bulguyu MASKELEMEZ, aşağıdaki adımlar
  // hâlâ gerçek kullanıcı etkileşimleridir, yalnızca bilinen geç-yanıt penceresinden SONRA başlar.
  await page.waitForTimeout(1000);

  // Yeni CUSTOM şablon, kullanıcıya başlangıç noktası vermek için 3 varsayılan blokla gelir
  // (`logo-header` + `heading` + `text` — API'den doğrulandı, ARCHITECTURE.md'de ayrıca
  // belgelenmemiş ama kasıtlı bir UX kolaylığı, bug DEĞİL). Testin kendi blok sırasını net/
  // tekil etiketli tutmak için önce temizlenir.
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole("button", { name: "Bloğu sil" }).first().click();
  }
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);

  // 3) Konuya bir sistem değişkeni ekle (site_name — CUSTOM amacında `site_name`/`site_url`
  // GLOBAL olarak her zaman geçerlidir, bkz. §10.16.5).
  const subjectInput = page.locator("#template-subject");
  await subjectInput.fill("QA E2E Şablonu — ");
  await subjectInput.click(); // hedefi (VariableTarget) yeniden kaydet — fill() focus/blur tetikleyebilir
  await page.getByRole("button", { name: /Site Adı/ }).first().click();
  await expect(subjectInput).toHaveValue("QA E2E Şablonu — {{site_name}}");

  // 4) Blokları sırayla ekle: Başlık, Metin, Buton / CTA, Görsel, Ayırıcı, Footer.
  // Palette'te tıklama = tuvalin SONUNA ekle + otomatik seç (design-notes §A.1).
  await page.getByRole("button", { name: "Başlık", exact: true }).click();
  await page.getByRole("button", { name: "Metin", exact: true }).click();
  await page.getByRole("button", { name: "Buton / CTA", exact: true }).click();
  await page.getByRole("button", { name: "Görsel", exact: true }).click();
  await page.getByRole("button", { name: "Ayırıcı", exact: true }).click();
  await page.getByRole("button", { name: "Footer", exact: true }).click();

  // Tuvalde 6 blok kartı olmalı (drag handle sayısı üzerinden say).
  await expect(page.locator('button[aria-label^="Sürükle: "]')).toHaveCount(6);

  // 5) Başlık bloğunu seç, metnine bir SİSTEM değişkeni ekle.
  await emailBlockCard(page, "Başlık").click({ position: { x: 8, y: 8 } });
  const headingInput = byIdSuffix(page, "-heading-text");
  await headingInput.fill("Merhaba ");
  await headingInput.click();
  await page.getByRole("button", { name: /Site Adı/ }).first().click();
  await expect(headingInput).toHaveValue("Merhaba {{site_name}}");

  // 6) Metin bloğunu seç (TipTap zengin metin editörü) — mevcut metnin sonuna ekle (ProseMirror'ın
  // kendi state yönetimini bozmamak için `fill()` yerine gerçek klavye girişi kullanılır).
  await emailBlockCard(page, "Metin").click({ position: { x: 8, y: 8 } });
  const richText = page.locator(".ProseMirror");
  await richText.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" QA e2e metin testi.");
  await expect(richText).toContainText("QA e2e metin testi.");

  // 7) Buton bloğunu seç: bağlantıyı düzenle, ÖZEL bir değişken TANIMLA (panelden — design-notes
  // §A.7).
  await emailBlockCard(page, "Buton / CTA").click({ position: { x: 8, y: 8 } });
  const buttonHref = byIdSuffix(page, "-button-href");
  await buttonHref.fill("https://example.com/iletisim");

  await page.getByRole("button", { name: "Özel Değişken Ekle" }).click();
  await page.locator("#custom-var-label").fill("Telefon Numarası");
  await expect(page.getByText("Anahtar: {{telefon_numarasi}}")).toBeVisible();
  await page.locator("#custom-var-sample").fill("0555 000 00 00");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  // Form kapanır (`resetForm()` çalıştı) — `handleAdd()` guard'ı geçti, `customVariables`
  // state'ine eklendi.
  await expect(page.locator("#custom-var-label")).toHaveCount(0, { timeout: 5_000 });

  // DÜZELTİLDİ (frontend-agent) — eskiden `variable-panel.tsx::groupVariables()` yalnızca
  // `variables` PROP'unu (sunucudan EN SON YÜKLEMEDE gelen, kaydedilmiş liste) okuyordu; bellek
  // içi `customVariables` state'i (henüz KAYDEDİLMEMİŞ yeni tanım) render edilen listeye HİÇ
  // katılmıyordu — design-notes §A.7'nin "Eklenen değişken ANINDA 'Özel Değişkenler' grubunun
  // listesine düşer" kuralının TAM TERSİYDİ. Düzeltme: panel artık `variables` ile bellek içi
  // `customVariables`'ı birleştirip (`mergeCustomVariables()`) gruplama/arama/çakışma kontrolünü
  // BİRLEŞİK listeden yapıyor. Yeni değişken artık KAYDETMEDEN de panelde ANINDA görünür.
  await expect(page.getByText("Telefon Numarası", { exact: true })).toBeVisible({ timeout: 5_000 });

  // 8) Görsel bloğunu seç: URL (manuel giriş — dosya yüklemeye gerek yok) + zorunlu alt metin.
  await emailBlockCard(page, "Görsel").click({ position: { x: 8, y: 8 } });
  await byIdSuffix(page, "-image-url").fill("https://example.com/qa-e2e-test-image.png");
  await byIdSuffix(page, "-image-alt").fill("QA e2e test görseli");

  // 9) İlk Kaydet — "gerçek kayıt çalışıyor mu" akışını erken doğrulamak için.
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Şablon kaydedildi.")).toBeVisible({ timeout: 10_000 });

  // 10) Kaydetme + sayfanın (örtük) yeniden veri çekmesi SONRASI da "Telefon Numarası" özel
  // değişkeni panelde KALICI olarak görünmeye devam eder (artık sunucudan `variables`
  // içinde geliyor) — Buton bloğuna dön, etiketine ekle (design-notes §A.7'nin kaydetme
  // SONRASI da geçerli olduğunu ayrıca doğrular — bellek içi ile sunucu sürümü ÇİFTE
  // GÖRÜNMEZ, bkz. `mergeCustomVariables()`).
  await emailBlockCard(page, "Buton / CTA").click({ position: { x: 8, y: 8 } });
  await expect(page.getByText("Telefon Numarası", { exact: true })).toBeVisible({ timeout: 10_000 });
  const buttonLabel = byIdSuffix(page, "-button-label");
  await buttonLabel.fill("Ara: ");
  await buttonLabel.click();
  await page.getByRole("button", { name: /Telefon Numarası/ }).first().click();
  await expect(buttonLabel).toHaveValue("Ara: {{telefon_numarasi}}");

  // 11) Canlı önizleme — değişkenlerin örnek verilerle DOLU göründüğünü doğrula (§10.16.11,
  // sunucu tarafı stateless render, 500ms debounce). NOT (qa-agent gözlemi): `site_name`/
  // `site_url` GLOBAL değişkenleri önizlemede registry'nin `sampleValue`'su ("Örnek Site")
  // YERİNE gerçek `SiteSettings.siteName` değeriyle dolduruluyor (bu ortamda "Site") — bu iki
  // değişken her zaman gerçekten çözümlenebilir olduğu için render pipeline'ının BİLİNÇLİ bir
  // tercihi gibi görünüyor, bug değil; test bu yüzden site adının KENDİSİNİ hardcode ETMEZ,
  // yalnızca ham `{{site_name}}` kalıbının KALMADIĞINI + "Merhaba " önekinin render edildiğini
  // doğrular (asıl kabul kriteri: değişken ÇÖZÜMLENDİ, ham kalıp sızmadı).
  const previewFrame = page.frameLocator('iframe[title="E-posta önizlemesi"]');
  await expect(previewFrame.getByText("Merhaba", { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect(previewFrame.locator("body")).not.toContainText("{{site_name}}");
  await expect(previewFrame.getByText("Ara: 0555 000 00 00")).toBeVisible();
  await expect(page.getByText(/^Konu: QA E2E Şablonu — /)).toBeVisible(); // önizleme üst çubuğu "Konu: {renderedSubject}"

  // 12) Son Kaydet (buton etiketindeki değişken eklemesini kalıcı yapar). `.last()` — ilk
  // Kaydet'in (madde 9) `sonner` toast'ı bu noktada hâlâ ekranda kalmış olabilir, ikisi de aynı
  // metni taşır (strict-mode ihlali).
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Şablon kaydedildi.").last()).toBeVisible({ timeout: 10_000 });

  // 13) Test e-postası gönder (kaydedilmiş satır üzerinden, dev-fallback Ethereal SMTP'ye gider).
  const testSendButton = page.getByRole("button", { name: "Test E-postası Gönder" });
  await expect(testSendButton).toBeEnabled();
  await testSendButton.click();
  await expect(page.getByText(`Test e-postası ${ADMIN_EMAIL} adresine gönderildi.`)).toBeVisible({ timeout: 15_000 });

  // 14) Aktif Yap.
  await page.getByRole("button", { name: "Aktif Yap" }).click();
  await expect(page.getByText("Şablon aktif edildi.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Aktif Yap" })).toHaveCount(0); // artık zaten aktif, buton kaybolur

  // 15) Listede "aktif" durumunu ve "kullanıldığı yer" bilgisini doğrula.
  await page.goto("/admin/notifications/templates");
  const row = page.locator("tr", { hasText: templateName });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText("Özel", { exact: true })).toBeVisible();
  await expect(row.getByText("Aktif", { exact: true })).toBeVisible();
});
