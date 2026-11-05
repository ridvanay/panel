import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { cleanupContactSubmissionsByEmail } from "./support/notifications-fixtures";

// AL (İş 2) GÜNCELLEME: /contact artık ContactPageForm (POST /contact/page-submissions; İngilizce etiketler, dinamik alan kimlikleri,
// zaman damgalı honeypot). Kayıt aynı ContactSubmission tablosuna düştüğü için admin Gelen Kutusu doğrulaması değişmedi.

/**
 * Kullanıcının istediği kısa akış: public iletişim formuna gidip (honeypot alanını BOŞ bırakarak)
 * formu göndermek ve admin tarafında gönderimin (submission) Gelen Kutusu'nda göründüğünü
 * doğrulamak. backend-agent bu akışı qa-agent'a devretmişti (bkz. görev talimatı). Kaynak:
 * ARCHITECTURE.md §10.16.7-9. Public tarafta kimlik doğrulama YOK — varsayılan Playwright `page`
 * fixture'ı (çerezsiz) kullanılır; admin doğrulaması için ayrı, kimlik doğrulanmış bir sayfa açılır.
 */
test.describe.configure({ retries: 1 });

/** ContactPageForm alanlarını doldurur (tedavi seçilmediği için açık rıza gerekmez; aydınlatma onayı zorunlu). */
async function fillContactPageForm(page: Page, values: { name: string; email: string; message: string }): Promise<void> {
  const nameInput = page.locator('input[name="name"]');
  await expect(nameInput).toBeVisible({ timeout: 30_000 });
  await nameInput.fill(values.name);
  await page.locator('input[name="email"]').fill(values.email);
  await page.locator("textarea").first().fill(values.message);
  await page.locator('input[type="checkbox"][required]').first().check();
}

test("public iletişim formu gönderimi (honeypot boş) → admin Gelen Kutusu'nda görünür ve okundu işaretlenir", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const session = await getCachedAdminSession();
  const token = session.accessToken;
  const unique = Date.now();
  const name = `QA E2E Contact ${unique}`;
  const email = `qa-e2e-contact-${unique}@example.com`;
  const message = "Bu bir qa-agent e2e test mesajıdır — iletişim formu akışı.";

  await cleanupContactSubmissionsByEmail(token, email); // idempotent zemin

  try {
    // 1) Public form.
    await page.goto("/contact");
    await fillContactPageForm(page, { name, email, message });

    // Honeypot ("website") — CSS ile gizli, dokunulmaz/boş bırakılır (§10.16.9).
    await expect(page.locator('input[name="website"]')).toHaveValue("");

    await page.getByRole("button", { name: "Send message" }).click();

    // 2) Başarı — form kaybolur, başarı kutusu (role="status") görünür (form yeniden yüklenmesi için "Send another" düğmesi var).
    await expect(page.getByRole("status")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('input[name="name"]')).toHaveCount(0);

    // 3) Admin tarafı — Gelen Kutusu'nda submission NEW olarak görünür.
    const { page: adminPage, close } = await createAuthenticatedPage(browser);
    try {
      await adminPage.goto("/admin/contact/submissions");
      await expect(adminPage.getByRole("heading", { name: "Gelen Kutusu" })).toBeVisible({ timeout: 15_000 });
      await adminPage.getByLabel("Ad veya e-posta ara").fill(email);

      const row = adminPage.locator('a[href^="/admin/contact/submissions/"]', { hasText: name });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row.getByText("Yeni", { exact: true })).toBeVisible(); // status=NEW, honeypot boştu → SPAM DEĞİL
      await expect(row).toContainText(email);

      // 4) Detaya gir — mesaj içeriği + KVKK onay kaydı doğru taşınmış, GET yan etkisiz açılışın
      // ARDINDAN otomatik "Okundu" işaretlenir (§10.16.8).
      await row.click();
      // AL: detay sayfasının dev sunucuda ilk derlemesi 10 sn'yi aşabiliyor.
      await expect(adminPage.getByRole("heading", { name, level: 1 })).toBeVisible({ timeout: 45_000 });
      await expect(adminPage.getByText(message)).toBeVisible();
      await expect(adminPage.getByLabel("Durum")).toHaveValue("READ", { timeout: 10_000 });
      await expect(adminPage.getByText(/^Onaylandı:/)).toBeVisible(); // consentAt dolu

      await adminPage.goto("/admin/contact/submissions");
      await adminPage.getByLabel("Ad veya e-posta ara").fill(email);
      const rowAfterRead = adminPage.locator('a[href^="/admin/contact/submissions/"]', { hasText: name });
      await expect(rowAfterRead.getByText("Okundu", { exact: true })).toBeVisible({ timeout: 10_000 });
    } finally {
      await close();
    }
  } finally {
    await cleanupContactSubmissionsByEmail(token, email);
  }
});

test("public iletişim formu — honeypot DOLU gönderim sessizce SPAM olarak kaydedilir (bildirim GÖNDERİLMEZ)", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const session = await getCachedAdminSession();
  const token = session.accessToken;
  const unique = Date.now();
  const name = `QA E2E ContactSpam ${unique}`;
  const email = `qa-e2e-contact-spam-${unique}@example.com`;

  await cleanupContactSubmissionsByEmail(token, email);

  try {
    await page.goto("/contact");
    await fillContactPageForm(page, { name, email, message: "Bot tarafından doldurulmuş gibi davranılan mesaj." });

    // §10.16.9 — honeypot'u bilerek doldur (gerçek bir bot davranışını simüle eder).
    await page.locator('input[name="website"]').fill("https://spam-bot.example.com");

    await page.getByRole("button", { name: "Send message" }).click();

    // Sahte başarı — ziyaretçi botun "başarısız oldum" sinyali almaz (§10.16.9), 201 + başarı kutusu.
    await expect(page.getByRole("status")).toBeVisible({ timeout: 20_000 });

    const { page: adminPage, close } = await createAuthenticatedPage(browser);
    try {
      await adminPage.goto("/admin/contact/submissions");
      await expect(adminPage.getByRole("heading", { name: "Gelen Kutusu" })).toBeVisible({ timeout: 15_000 });
      await adminPage.getByLabel("Ad veya e-posta ara").fill(email);
      const row = adminPage.locator('a[href^="/admin/contact/submissions/"]', { hasText: name });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row.getByText("Spam", { exact: true })).toBeVisible();
    } finally {
      await close();
    }
  } finally {
    await cleanupContactSubmissionsByEmail(token, email);
  }
});
