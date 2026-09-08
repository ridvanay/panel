import { test, expect } from "@playwright/test";
import { getCachedAdminSession, API_BASE_URL } from "./support/api";
import { listEmailTemplates } from "./support/notifications-fixtures";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — regresyon testi: `GET /admin/notifications/templates` (ve admin panel sayfası)
 * `EmailTemplatePurpose` enum'ına `ORDER_SHIPPED`/`ORDER_ADMIN_NOTIFICATION` eklendikten sonra
 * `PrismaClientUnknownRequestError` ile 500 dönüyordu — kök neden: backend süreci (Docker
 * container VEYA bu suite'in kullandığı ayrı `saas_e2e` tsx süreci) migration/seed sonrasında
 * YENİDEN BAŞLATILMADIĞI için eski (yeni enum değerlerini tanımayan) bir Prisma Client
 * bellekte kalıyordu. Düzeltme doğrulandı: backend Docker container `--build` ile yeniden
 * oluşturuldu; bu e2e ortamındaki AYRI backend süreci de qa-agent tarafından bu turda
 * yeniden başlatıldı (bkz. QA raporu). Bu dosya regresyonun gelecekte SESSİZCE geri
 * DÖNMEMESİNİ garanti eder.
 *
 * `frontend/src/app/admin/notifications/templates/page.tsx`'e bu turda eklenen
 * `console.error(...)` (catch bloğu) davranışsal olarak GÖRÜNMEZ (yalnızca dev-tools konsoluna
 * yazar) — burada AYRICA doğrulanmaz, yalnızca 500/hata YOKLUĞU ve sistem şablonlarının
 * listelendiği doğrulanır.
 */
test.describe.configure({ mode: "serial" });

test("GET /admin/notifications/templates 200 döner ve TÜM sistem şablonları (ORDER_SHIPPED, ORDER_ADMIN_NOTIFICATION dahil) mevcut", async () => {
  const session = await getCachedAdminSession();
  const templates = await listEmailTemplates(session.accessToken);

  const purposes = templates.map((t) => t.purpose);
  for (const expectedPurpose of [
    "WELCOME",
    "PASSWORD_RESET",
    "SYSTEM_ANNOUNCEMENT",
    "ORDER_CONFIRMATION",
    "ORDER_CANCELLATION",
    "ORDER_SHIPPED",
    "ORDER_ADMIN_NOTIFICATION",
    "ORG_INVITATION",
    "CONTACT_FORM_NOTIFICATION",
  ]) {
    expect(purposes).toContain(expectedPurpose);
  }

  const shippedTemplate = templates.find((t) => t.purpose === "ORDER_SHIPPED");
  expect(shippedTemplate?.isSystem).toBe(true);
  const adminNotifyTemplate = templates.find((t) => t.purpose === "ORDER_ADMIN_NOTIFICATION");
  expect(adminNotifyTemplate?.isSystem).toBe(true);
});

test("Admin panelde /admin/notifications/templates gerçek tarayıcıda 500/hata GÖSTERMEDEN sistem şablonlarını listeler", async ({
  browser,
}) => {
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    const responses: number[] = [];
    page.on("response", (response) => {
      if (response.url().includes(`${API_BASE_URL}/admin/notifications/templates`) && response.request().method() === "GET") {
        responses.push(response.status());
      }
    });

    await page.goto("/admin/notifications/templates");

    // Kompakt hata `Alert`i (role="alert") HİÇ görünmemeli. Next.js'in KENDİ route-announcer'ı
    // (`#__next-route-announcer__`) de `role="alert"` taşıdığı için (a11y canlı bölge, sayfa
    // içeriğiyle İLGİSİZ) arama `<main>` ile daraltılır — aksi halde her zaman "visible" bir
    // eşleşme bulunup test yanlış-pozitif verir.
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);

    // "Kargo Bildirimi" (ORDER_SHIPPED) ve "Yeni Sipariş Bildirimi" (ORDER_ADMIN_NOTIFICATION)
    // Türkçe etiketleriyle (bkz. `purpose-labels.ts`) tabloda görünür olmalı.
    await expect(page.getByRole("cell", { name: "Kargo Bildirimi" }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("cell", { name: "Yeni Sipariş Bildirimi" }).first()).toBeVisible();
    // Zaten var olan (bu tur ÖNCESİNDEN de çalışan) sistem şablonları da regresyona uğramamalı.
    await expect(page.getByRole("link", { name: /Sipariş Onay E-postası/ })).toBeVisible();

    expect(responses.length).toBeGreaterThan(0);
    for (const status of responses) expect(status).toBe(200);
  } finally {
    await close();
  }
});
