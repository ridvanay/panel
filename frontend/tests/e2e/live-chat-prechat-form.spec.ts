import { test, expect } from "@playwright/test";
import { getCachedAdminSession, getAdminSettings, patchSiteSettings } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — `.claude/architect-scope-support-desk-and-reminders.md` §7 (EK KARAR 2026-09-16) —
 * ön görüşme (pre-chat) formu. `live-chat-widget.spec.ts`/`admin-support-desk.spec.ts` İLE AYNI
 * "paylaşımlı demo ortamı" disiplini: `beforeAll` başlangıç değerlerini yakalar, `afterAll`
 * bunları AYNEN geri yazar (bu dosyanın SONUCU sonraki dosyaları ETKİLEMEZ).
 *
 * Kapsam (görev talimatı, bağlayıcı):
 * 1. Admin panelinden `liveChatPreChatEnabled` + `liveChatRequireName`/`liveChatRequirePhone`
 *    açılır, `PATCH /admin/settings` ile anlık kaydedildiği doğrulanır.
 * 2. Misafir ziyaretçi zorunlu alanları BOŞ bırakıp gönderemez — `POST /support/sessions`
 *    ÇAĞRILMAZ (istemci taraflı doğrulama engeli).
 * 3. Form doğru doldurulunca `POST /support/sessions` çağrılır, `visitorName`/`visitorPhone`
 *    gövdeye dahildir, sohbet ekranına geçilir.
 * 4. Giriş yapmış kullanıcı formu ATLAR — `liveChatPreChatEnabled` açık olsa bile.
 * 5. Admin destek masasında ziyaretçi beyanı (ad/telefon/e-posta veya "belirtilmedi") görünür.
 * 6. `liveChatPreChatEnabled=false` → form HİÇ gösterilmez (regresyon).
 * 7. Üç `require*` de `false` iken form yine gösterilir ama boş gönderim KABUL edilir.
 */
test.describe.configure({ mode: "serial" });

let adminToken: string;
let initialSettings: {
  liveChatEnabled: boolean;
  liveChatProvider: string;
  liveChatPreChatEnabled: boolean;
  liveChatRequireName: boolean;
  liveChatRequirePhone: boolean;
  liveChatRequireEmail: boolean;
};

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  // Bu dosya `/consultation/*` senaryosu İÇERMEZ (`live-chat-widget.spec.ts`'in aksine) —
  // `telehealth` modülüne HİÇ dokunulmaz.
  const settings = await getAdminSettings(adminToken);
  initialSettings = {
    liveChatEnabled: Boolean(settings.liveChatEnabled),
    liveChatProvider: typeof settings.liveChatProvider === "string" ? settings.liveChatProvider : "internal",
    liveChatPreChatEnabled: Boolean(settings.liveChatPreChatEnabled),
    liveChatRequireName: settings.liveChatRequireName !== false,
    liveChatRequirePhone: settings.liveChatRequirePhone !== false,
    liveChatRequireEmail: Boolean(settings.liveChatRequireEmail),
  };

  // Deterministik başlangıç — `live-chat-widget.spec.ts`/`admin-support-desk.spec.ts` İLE AYNI
  // gerekçe (paylaşımlı demo ortamı, önceki bir koşum farklı bir durum bırakmış olabilir).
  await patchSiteSettings(adminToken, { liveChatEnabled: false, liveChatProvider: "internal" });
});

test.afterAll(async ({ browser }) => {
  await patchSiteSettings(adminToken, {
    liveChatEnabled: initialSettings.liveChatEnabled,
    liveChatProvider: initialSettings.liveChatProvider as "internal" | "crisp" | "tawkto",
    liveChatPreChatEnabled: initialSettings.liveChatPreChatEnabled,
    liveChatRequireName: initialSettings.liveChatRequireName,
    liveChatRequirePhone: initialSettings.liveChatRequirePhone,
    liveChatRequireEmail: initialSettings.liveChatRequireEmail,
  }).catch(() => undefined);

  // qa-agent bulgusu (bu turda düzeltildi) — bu dosyanın son testleri (madde 6/7) `liveChatEnabled:
  // true` ile `/` sayfasını TEKRAR TEKRAR fetch'leyip 60sn'lik SSR önbelleğini "sıcak" bırakır.
  // Dosya bittiğinde yukarıdaki `PATCH` DB'yi ANINDA `false`'a çeker ama önbellek henüz TAZELENMEMİŞ
  // olabilir — bu dosyadan HEMEN SONRA çalışan bir sonraki dosya (ör. `live-chat-widget.spec.ts`
  // madde 1, kendi `toPass` payı yalnızca 45sn) bu bayat önbelleği görüp YANLIŞLIKLA widget'ı
  // GÖRÜNÜR bulabilir — dosyalar arası paylaşımlı `saas_e2e` + paylaşımlı SSR önbelleği YÜZÜNDEN
  // bir sıra bağımlılığı (proje belleği: 60sn eventual-consistency, reaktif DÜZELTİLMEZ — ama bu
  // dosyanın KENDİ afterAll'ı bir SONRAKİ dosyayı beklemeye zorlamadan, kendi ürettiği önbellek
  // sıcaklığını kendi temizleyebilir). Bu yüzden `afterAll` DB yazımıyla YETİNMEZ, önbelleğin
  // GERÇEKTEN `false`'u yansıttığını (`toPass`+reload, `live-chat-widget.spec.ts::madde 4` İLE
  // AYNI desen) doğrulayıp SONRA biter — sıradaki dosyaya TEMİZ bir önbellek bırakır.
  if (!initialSettings.liveChatEnabled) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await expect(async () => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("button", { name: "Canlı destek sohbetini aç" })).toHaveCount(0);
      }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
    } catch {
      // Sessiz geç — bu yalnızca bir SONRAKİ dosyanın kendi toleransını KOLAYLAŞTIRMA denemesidir,
      // bu dosyanın KENDİ test sonucunu ETKİLEMEZ (afterAll zaten ana `PATCH`i yukarıda yaptı).
    } finally {
      await context.close();
    }
  }
});

// =============================================================================
// 1) Admin panelinden aç — toggle + iki zorunluluk kutusu, `PATCH /admin/settings` ile kaydedilir.
// =============================================================================
test("madde 1: admin panelinden 'Görüşme Öncesi Bilgi Topla' AÇILIR, İsim/Telefon zorunlu işaretlenir, PATCH /admin/settings ile anlık kaydedilir", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/admin/settings");

    // Canlı Destek Widget'ı önce AÇILMALI — Ön Bilgi Formu kartı `liveChatEnabled`den bağımsız
    // render edilir ama widget'ın KENDİSİ görünür olmadan bu formun bir anlamı yok; bu testin
    // amacı yalnızca `PATCH` davranışını doğrulamak, widget'ı sonraki testler için de açık bırakır.
    const liveChatToggle = page.getByRole("switch", { name: "Canlı Destek Widget'ı" });
    await expect(liveChatToggle).toBeVisible({ timeout: 15_000 });
    await expect(liveChatToggle).toHaveAttribute("aria-checked", "false");
    await liveChatToggle.click();
    await expect(liveChatToggle).toHaveAttribute("aria-checked", "true");

    const preChatToggle = page.getByRole("switch", { name: "Görüşme Öncesi Bilgi Topla" });
    await expect(preChatToggle).toBeVisible({ timeout: 10_000 });
    await expect(preChatToggle).toHaveAttribute("aria-checked", "false");
    await preChatToggle.click();
    await expect(preChatToggle).toHaveAttribute("aria-checked", "true");

    // Varsayılan olarak İsim/Telefon zaten işaretli (Prisma default `true`) — testin kendisi
    // AÇIKÇA doğrular, koşullu olarak tıklamaz (yanlışlıkla KAPATMASIN).
    const requireNameCheckbox = page.getByRole("checkbox", { name: "İsim Zorunlu" });
    const requirePhoneCheckbox = page.getByRole("checkbox", { name: "Telefon Numarası Zorunlu" });
    const requireEmailCheckbox = page.getByRole("checkbox", { name: "E-posta Zorunlu" });
    await expect(requireNameCheckbox).toBeVisible({ timeout: 10_000 });
    await expect(requireNameCheckbox).toBeChecked();
    await expect(requirePhoneCheckbox).toBeChecked();
    await expect(requireEmailCheckbox).not.toBeChecked();

    const [patchResponse] = await Promise.all([
      page.waitForResponse((res) => /\/admin\/settings$/.test(res.url()) && res.request().method() === "PATCH"),
      page.getByRole("button", { name: "Kaydet" }).click(),
    ]);
    expect(patchResponse.status(), "qa-agent: PATCH /admin/settings 200 dönmeli.").toBe(200);
    const patchBody = (await patchResponse.json()) as { data: Record<string, unknown> };
    expect(patchBody.data.liveChatPreChatEnabled).toBe(true);
    expect(patchBody.data.liveChatRequireName).toBe(true);
    expect(patchBody.data.liveChatRequirePhone).toBe(true);
    expect(patchBody.data.liveChatRequireEmail).toBe(false);

    await expect(page.getByLabel("Notifications alt+T").getByText("Ayarlar kaydedildi.")).toBeVisible({ timeout: 10_000 });
  } finally {
    await close();
  }

  // Sunucu taze okuma — cache'siz.
  const after = await getAdminSettings(adminToken);
  expect(after.liveChatEnabled).toBe(true);
  expect(after.liveChatProvider).toBe("internal");
  expect(after.liveChatPreChatEnabled).toBe(true);
  expect(after.liveChatRequireName).toBe(true);
  expect(after.liveChatRequirePhone).toBe(true);
  expect(after.liveChatRequireEmail).toBe(false);
});

// =============================================================================
// 2) Misafir — zorunlu alanlar BOŞ bırakılırsa engellenir, `POST /support/sessions` ÇAĞRILMAZ.
// =============================================================================
test("madde 2: misafir ziyaretçi İsim/Telefon BOŞ bırakıp gönderemez — istemci doğrulaması engeller, POST /support/sessions ÇAĞRILMAZ", async ({
  browser,
}) => {
  // 60sn önbellek + `toPass` reload döngüsü (75sn) — madde 6/7 İLE AYNI pay/gerekçe: madde 1'in
  // `PATCH` çağrısı bu testin `liveChatPreChatEnabled=true` varsayımını besler, ama SSR
  // `fetchSiteSettingsServer()` bunu ANINDA yansıtmayabilir.
  test.setTimeout(150_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Not: `getByLabel("Mesajınız")` (substring) `Mesajınızı yazın` (sohbet kutusu sr-only
    // etiketi) İLE de eşleşir (`Mesajınız` iki metnin de ORTAK ÖN EKİDİR) — bu yüzden pre-chat
    // metin alanı `exact: true` ile TAM etiketiyle (`Mesajınız *`, mesaj HER ZAMAN zorunlu)
    // hedeflenir (qa-agent bulgusu — bu turda düzeltildi).
    const trigger = page.getByRole("button", { name: "Canlı destek sohbetini aç" });
    let dialog = page.getByRole("dialog");
    let messageField = dialog.getByLabel("Mesajınız *", { exact: true });
    await expect(async () => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(trigger).toBeVisible({ timeout: 5_000 });
      await trigger.click();
      dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      messageField = dialog.getByLabel("Mesajınız *", { exact: true });
      // Pre-chat form gösteriliyor — mesajlaşma ekranı (Mesajınızı yazın) DEĞİL.
      await expect(messageField).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByLabel("Mesajınızı yazın")).toHaveCount(0);
      // KRİTİK — yalnızca formun GÖRÜNÜRLÜĞÜ değil, `requireName`/`requirePhone`in DE bu ÖZEL
      // fetch'te TAZE olduğu doğrulanır (zorunluluk yıldızı `*`): önbellekli bir ÖNCEKİ koşumun
      // (ör. madde 7'nin `require*=false` durumu) `liveChatPreChatEnabled=true` ile ÇAKIŞAN ama
      // `requireName/Phone=false` olan bir ARA STATE'İ döndürmesi mümkündür — form YİNE görünür
      // olurdu (yanlışlıkla "taze" sanılırdı) ama zorunluluk yıldızı EKSİK kalırdı. qa-agent
      // bulgusu (bu turda düzeltildi) — yıldız da AYNI `toPass` döngüsünde doğrulanır.
      await expect(dialog.getByText("Adınız Soyadınız *")).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByText("Telefon Numaranız *")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });

    let sessionsRequestFired = false;
    const listener = (req: import("@playwright/test").Request) => {
      if (/\/support\/sessions$/.test(req.url()) && req.method() === "POST") sessionsRequestFired = true;
    };
    page.on("request", listener);

    // Yalnızca mesajı doldur, İsim/Telefon'u BOŞ bırak — zorunlu.
    await messageField.fill("Randevumu değiştirmek istiyorum ama bilgilerimi vermek istemiyorum.");
    await dialog.getByRole("button", { name: "Görüşmeyi Başlat" }).click();

    await expect(dialog.getByText("Ad soyad zorunludur.")).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText("Telefon numarası zorunludur.")).toBeVisible({ timeout: 5_000 });

    // Kısa bir bekleme payı — RHF senkron doğrulama zaten submit'i engeller, bu yalnızca
    // "hiç ağa çıkmadı" iddiasını sağlamlaştırır.
    await page.waitForTimeout(1_000);
    expect(sessionsRequestFired, "qa-agent: zorunlu alanlar boşken POST /support/sessions ASLA çağrılmamalı.").toBe(false);
    page.off("request", listener);

    // Form hâlâ ekranda — sohbete GEÇİLMEDİ.
    await expect(messageField).toBeVisible();
  } finally {
    await context.close();
  }
});

// =============================================================================
// 3) Misafir — form doğru doldurulunca `POST /support/sessions` çağrılır, sohbete geçilir.
// =============================================================================
const VISITOR_NAME = `QA Pre-Chat Ziyaretçi ${Date.now().toString(36)}`;
const VISITOR_PHONE = "+90 555 123 45 67";
let visitorTestMessage: string;

test("madde 3: form doğru doldurulunca POST /support/sessions çağrılır (visitorName/visitorPhone gövdede), sohbet ekranına geçilir", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const trigger = page.getByRole("button", { name: "Canlı destek sohbetini aç" });
    let dialog = page.getByRole("dialog");
    await expect(async () => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(trigger).toBeVisible({ timeout: 5_000 });
      await trigger.click();
      dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByLabel("Adınız Soyadınız")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });

    visitorTestMessage = `QA e2e pre-chat mesajı — ${Date.now().toString(36)}`;
    await dialog.getByLabel("Adınız Soyadınız").fill(VISITOR_NAME);
    await dialog.getByLabel("Telefon Numaranız").fill(VISITOR_PHONE);
    // E-posta zorunlu DEĞİL (madde 1'de `liveChatRequireEmail=false` kaydedildi) — BİLEREK boş
    // bırakılır (madde 5'in "E-posta belirtilmedi" iddiasını besler).
    // `exact: true` — `Mesajınız` `Mesajınızı yazın` (sohbet kutusu) İLE substring ÇAKIŞIR (madde 2 notu).
    await dialog.getByLabel("Mesajınız *", { exact: true }).fill(visitorTestMessage);

    const [createSessionResponse] = await Promise.all([
      page.waitForResponse((res) => /\/support\/sessions$/.test(res.url()) && res.request().method() === "POST"),
      dialog.getByRole("button", { name: "Görüşmeyi Başlat" }).click(),
    ]);
    expect(createSessionResponse.status()).toBe(201);
    const requestBody = createSessionResponse.request().postDataJSON() as Record<string, unknown>;
    expect(requestBody.visitorName).toBe(VISITOR_NAME);
    expect(requestBody.visitorPhone).toBe(VISITOR_PHONE);
    expect(requestBody.message).toBe(visitorTestMessage);

    // Sohbet ekranına geçildi — form artık YOK, mesaj kabarcığı görünür.
    await expect(dialog.getByLabel("Adınız Soyadınız")).toHaveCount(0);
    await expect(dialog.getByText(visitorTestMessage)).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByLabel("Mesajınızı yazın")).toBeVisible();
  } finally {
    await context.close();
  }
});

// =============================================================================
// 4) Giriş yapmış kullanıcı — pre-chat form ATLANIR, doğrudan sohbet ekranı gelir.
// =============================================================================
test("madde 4: giriş yapmış kullanıcıda pre-chat form GÖSTERİLMEZ — liveChatPreChatEnabled açık olsa bile doğrudan sohbet ekranı gelir", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  // Görev talimatı ADMIN hesabıyla test edilmesine izin verir — `authenticated` kontrolü
  // `auth?.status === "authenticated"` rol-bağımsızdır (misafir mi DEĞİL mi ayrımı yapar).
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const trigger = page.getByRole("button", { name: "Canlı destek sohbetini aç" });
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Form alanları HİÇ render edilmedi.
    await expect(dialog.getByLabel("Adınız Soyadınız")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Görüşmeyi Başlat" })).toHaveCount(0);
    // Doğrudan sohbet ekranı — selamlama mesajı + mesaj kutusu.
    await expect(dialog.getByText("Merhaba! Randevu veya teknik konularda size nasıl yardımcı olabiliriz?")).toBeVisible();
    await expect(dialog.getByLabel("Mesajınızı yazın")).toBeVisible();
  } finally {
    await close();
  }
});

// =============================================================================
// 5) Admin destek masası — ziyaretçi beyanı (ad/telefon/e-posta) görünür.
// =============================================================================
test("madde 5: admin destek masasında madde 3'teki ziyaretçinin Ad/Telefon beyanı görünür, E-posta 'belirtilmedi' placeholder'ı gösterilir", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/admin/support");
    await page.getByRole("tab", { name: /Bekleyen/ }).click();

    const sessionButton = page.getByRole("button", { name: new RegExp(visitorTestMessage.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(sessionButton).toBeVisible({ timeout: 20_000 });
    await sessionButton.click();

    await expect(page.getByText(VISITOR_NAME)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(VISITOR_PHONE)).toBeVisible();
    await expect(page.getByText("E-posta belirtilmedi")).toBeVisible();
  } finally {
    await close();
  }
});

// =============================================================================
// 6) Regresyon — `liveChatPreChatEnabled=false` iken form HİÇ gösterilmez.
// =============================================================================
test("madde 6 (regresyon): liveChatPreChatEnabled=false iken form gösterilmeden doğrudan sohbet ekranı gelir", async ({ browser }) => {
  // 60sn önbellek + `toPass` reload döngüsü (75sn) — `live-chat-widget.spec.ts::madde 2` İLE AYNI pay.
  test.setTimeout(150_000);
  await patchSiteSettings(adminToken, { liveChatPreChatEnabled: false });

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // `fetchSiteSettingsServer()` `next: { revalidate: 60 }` önbellekli — proje belleği: 60sn
    // eventual-consistency, PATCH hemen sonrası tek bir `goto` bayat önbelleği görebilir (yalnızca
    // `liveChatEnabled`/trigger görünürlüğü DEĞİL, `liveChatPreChatEnabled`in KENDİSİ de aynı
    // önbellekli DTO'nun bir parçası) — bu yüzden asıl iddia (form YOK) da `toPass`+reload ile
    // YOKLANIR, yalnızca tetikleyici görünürlüğü DEĞİL.
    const trigger = page.getByRole("button", { name: "Canlı destek sohbetini aç" });
    await expect(async () => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(trigger).toBeVisible({ timeout: 5_000 });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByLabel("Adınız Soyadınız")).toHaveCount(0);
    }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Merhaba! Randevu veya teknik konularda size nasıl yardımcı olabiliriz?")).toBeVisible();
    await expect(dialog.getByLabel("Mesajınızı yazın")).toBeVisible();
  } finally {
    await context.close();
  }
});

// =============================================================================
// 7) Üç `require*` de false — form yine gösterilir ama boş gönderim KABUL edilir.
// =============================================================================
test("madde 7: üç require* de false iken form gösterilir, hiçbir alan zorunlu değildir, boş gönderim KABUL edilir", async ({
  browser,
}) => {
  // 60sn önbellek + `toPass` reload döngüsü (75sn) — madde 6 İLE AYNI pay.
  test.setTimeout(150_000);
  await patchSiteSettings(adminToken, {
    liveChatPreChatEnabled: true,
    liveChatRequireName: false,
    liveChatRequirePhone: false,
    liveChatRequireEmail: false,
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Madde 6 İLE AYNI gerekçe (60sn önbellek) — bu turda `liveChatPreChatEnabled` false→true VE
    // `liveChatRequireName/Phone` true→false değişti; asıl iddia (form VAR, yıldız YOK) `toPass`
    // içinde yoklanır.
    const trigger = page.getByRole("button", { name: "Canlı destek sohbetini aç" });
    await expect(async () => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(trigger).toBeVisible({ timeout: 5_000 });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      // `exact: true` — `Mesajınız` (mesaj HER ZAMAN zorunlu, yıldız koşulsuz) `Mesajınızı yazın`
      // (sohbet kutusu) İLE substring ÇAKIŞIR (madde 2 notu).
      await expect(dialog.getByLabel("Mesajınız *", { exact: true })).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByText("Adınız Soyadınız *")).toHaveCount(0);
      await expect(dialog.getByText("Telefon Numaranız *")).toHaveCount(0);
    }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });

    const dialog = page.getByRole("dialog");
    const messageField = dialog.getByLabel("Mesajınız *", { exact: true });

    const emptyFormMessage = `QA e2e boş-form mesajı ${Date.now().toString(36)}`;
    await messageField.fill(emptyFormMessage);
    // İsim/Telefon/E-posta BİLEREK boş bırakılır.
    const [createSessionResponse] = await Promise.all([
      page.waitForResponse((res) => /\/support\/sessions$/.test(res.url()) && res.request().method() === "POST"),
      dialog.getByRole("button", { name: "Görüşmeyi Başlat" }).click(),
    ]);
    expect(createSessionResponse.status(), "qa-agent: üç require* de false iken boş isim/telefon/e-posta 201 kabul edilmeli.").toBe(
      201
    );
    const requestBody = createSessionResponse.request().postDataJSON() as Record<string, unknown>;
    expect(requestBody.visitorName).toBeUndefined();
    expect(requestBody.visitorPhone).toBeUndefined();
    expect(requestBody.visitorEmail).toBeUndefined();

    await expect(dialog.getByText(emptyFormMessage)).toBeVisible({ timeout: 10_000 });
  } finally {
    await context.close();
  }
});
