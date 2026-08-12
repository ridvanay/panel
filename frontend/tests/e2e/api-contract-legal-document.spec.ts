import { test, expect } from "@playwright/test";
import { API_BASE_URL, createPage, deletePagePermanently, getCachedAdminSession } from "./support/api";

/**
 * `.claude/architect-scope-i18n.md` §9 qa-agent madde 11-12.
 * Playwright'ın `request` context'i (tarayıcısız, saf HTTP) kullanılır — bunlar API kontrat
 * doğrulamalarıdır, DOM/tarayıcı gerektirmez (bkz. proje kökü CLAUDE.md kural #1: kontrata
 * uymayan davranış bug olarak raporlanır). backend'in kendi `tests/integration/localization.test.ts`
 * dosyası AYNI davranışı `app.inject` ile doğruluyor — burada GERÇEK, çalışan bir HTTP sunucusuna
 * karşı (wiring/CORS/route-mount hatalarını da yakalayacak şekilde) tekrar doğrulanıyor.
 */
const createdPageIds: string[] = [];

test.afterAll(async () => {
  const { accessToken } = await getCachedAdminSession();
  for (const id of createdPageIds) await deletePagePermanently(accessToken, id);
});

test.describe("madde 11 — API sözleşmesi: slug çakışması ve geçersiz locale", () => {
  test("aynı locale'de çakışan çeviri slug'ı 409 CONFLICT döner (422 DEĞİL)", async ({ request }) => {
    const { accessToken } = await getCachedAdminSession();
    const auth = { Authorization: `Bearer ${accessToken}` };
    const sharedEnSlug = `qa-shared-slug-${Date.now()}`;

    const first = await request.post(`${API_BASE_URL}/admin/pages`, {
      headers: auth,
      data: {
        title: "QA Slug A",
        slug: `qa-slug-a-${Date.now()}`,
        status: "PUBLISHED",
        blocks: [],
        translations: { en: { title: "QA Slug A EN", slug: sharedEnSlug } },
      },
    });
    expect(first.status()).toBe(201);
    createdPageIds.push((await first.json()).data.id);

    const second = await request.post(`${API_BASE_URL}/admin/pages`, {
      headers: auth,
      data: {
        title: "QA Slug B",
        slug: `qa-slug-b-${Date.now()}`,
        status: "PUBLISHED",
        blocks: [],
        translations: { en: { title: "QA Slug B EN", slug: sharedEnSlug } },
      },
    });
    expect(second.status()).toBe(409);
  });

  test("geçersiz/bilinmeyen locale query'si 400 DEĞİL — sessizce varsayılan dile düşer", async ({ request }) => {
    const { accessToken } = await getCachedAdminSession();
    const created = await createPage(accessToken, {
      title: "QA Invalid Locale Query",
      slug: `qa-invalid-locale-query-${Date.now()}`,
      html: "<p>TR icerik.</p>",
    });
    createdPageIds.push(created.id as string);

    const res = await request.get(`${API_BASE_URL}/pages/${created.slug}?locale=xx-not-a-real-locale`);
    expect(res.status()).toBe(200);
    const body = (await res.json()).data;
    expect(body.title).toBe("QA Invalid Locale Query");
  });
});

test.describe("madde 12 — isLegalDocument istisnası (§5.1, uyumluluk kritikliğinde geçiş şartı)", () => {
  test("12a — EN çevirisi olmayan hukuki belgede GET /pages/{slug}?locale=en blocks BOŞ döner (title korunur)", async ({
    request,
  }) => {
    const { accessToken } = await getCachedAdminSession();
    const created = await createPage(accessToken, {
      title: "QA Gizlilik Politikasi",
      slug: `qa-gizlilik-${Date.now()}`,
      html: "<p>Turkce hukuki metin.</p>",
      isLegalDocument: true,
    });
    createdPageIds.push(created.id as string);

    const res = await request.get(`${API_BASE_URL}/pages/${created.slug}?locale=en`);
    expect(res.status()).toBe(200);
    const body = (await res.json()).data;
    expect(body.blocks).toEqual([]);
    expect(body.title).toBe("QA Gizlilik Politikasi");
  });

  test("12b — aynı sayfa TR (varsayılan dil) altında normal gövdeyle açılır (istisna yalnızca çevrilmemiş dili etkiler)", async ({
    request,
  }) => {
    const { accessToken } = await getCachedAdminSession();
    const created = await createPage(accessToken, {
      title: "QA Gizlilik Politikasi TR OK",
      slug: `qa-gizlilik-tr-ok-${Date.now()}`,
      html: "<p>Turkce hukuki metin burada.</p>",
      isLegalDocument: true,
    });
    createdPageIds.push(created.id as string);

    const res = await request.get(`${API_BASE_URL}/pages/${created.slug}`);
    const body = (await res.json()).data;
    expect(body.blocks.length).toBeGreaterThan(0);
  });

  test("12c — EN'e çevrildikten sonra normal şekilde EN gövdesiyle açılır (istisna yalnızca ÇEVRİLMEMİŞ olduğunda uygulanır)", async ({
    request,
  }) => {
    const { accessToken } = await getCachedAdminSession();
    const created = await createPage(accessToken, {
      title: "QA Gizlilik Cevrildi",
      slug: `qa-gizlilik-cevrildi-${Date.now()}`,
      html: "<p>TR hukuki metin.</p>",
      isLegalDocument: true,
      translations: { en: { title: "QA Privacy Translated", slug: `qa-privacy-translated-${Date.now()}`, html: "<p>EN legal text.</p>" } },
    });
    createdPageIds.push(created.id as string);

    const res = await request.get(`${API_BASE_URL}/pages/${created.slug}?locale=en`);
    const body = (await res.json()).data;
    expect(body.blocks.length).toBeGreaterThan(0);
    expect(body.title).toBe("QA Privacy Translated");
  });

  test("12d — isLegalDocument: false bir sayfa AYNI koşulda normal sessiz fallback yapar (istisna sızmaz)", async ({
    request,
  }) => {
    const { accessToken } = await getCachedAdminSession();
    const created = await createPage(accessToken, {
      title: "QA Normal Sayfa Fallback",
      slug: `qa-normal-fallback-${Date.now()}`,
      html: "<p>TR icerik, EN cevirisi yok.</p>",
      isLegalDocument: false,
    });
    createdPageIds.push(created.id as string);

    const res = await request.get(`${API_BASE_URL}/pages/${created.slug}?locale=en`);
    const body = (await res.json()).data;
    // §5 genel kural — blocks BOŞ DEĞİL, TR içerik sessizce fallback olarak gösterilir.
    expect(body.blocks.length).toBeGreaterThan(0);
  });

  // NOT — 12e ("EDITOR isLegalDocument göndermeye çalışırsa 403; ADMIN başarır ve audit kaydı
  // oluşur") burada YİNELENMEZ: bir EDITOR token'ı üretmek (rol yükseltme) yalnızca doğrudan
  // Prisma erişimiyle mümkün — backend'in kendi `tests/integration/localization.test.ts`
  // dosyası (satır ~299, "EDITOR gets 403 ... ADMIN succeeds and an audit entry is created")
  // bunu TAM OLARAK bu şekilde, doğru katmanda zaten kapsıyor ve geçiyor (16/16). qa-agent
  // burada aynı testi kırılgan bir workaround'la yeniden üretmek yerine bu kapsamı DOĞRULAR
  // (`npm test -- localization` — bkz. qa-agent raporu).
});
