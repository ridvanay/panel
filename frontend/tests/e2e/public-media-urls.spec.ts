import { expect, test } from "@playwright/test";

/**
 * 2026-10-31 acil düzeltme — sunucu tarafı veriyle render edilen site sayfalarının HTML çıktısında (RSC verisi dahil)
 * iç ya da loopback medya adresi olmamalı: canlıda galeri/lightbox/video tarayıcıya `http://backend:4000/uploads/...`
 * veriyordu (ERR_NAME_NOT_RESOLVED + Mixed Content).
 *
 * Bu test CANLI BENZERİ yapılandırma ister (site ve API adresinde "localhost" geçmemeli, iç medya kökü ayrı olmalı):
 *   backend:  PUBLIC_URL=http://<makine-adı>:4001 FRONTEND_URL=http://<makine-adı>:3100 DOTENV_CONFIG_PATH=.env.e2e npx tsx src/server.ts
 *   frontend: NEXT_PUBLIC_API_URL=http://<makine-adı>:4001/api/v1 NEXT_PUBLIC_SITE_URL=http://<makine-adı>:3100
 *             INTERNAL_API_URL=http://<makine-adı>:4001/api/v1 NEXT_PUBLIC_INTERNAL_MEDIA_URL=http://backend:4000 next dev -p 3100
 *   koşu:     E2E_SKIP_WEBSERVER=1 E2E_FRONTEND_URL=http://<makine-adı>:3100 E2E_API_URL=http://<makine-adı>:4001/api/v1 \
 *             npx playwright test tests/e2e/public-media-urls.spec.ts --project=chromium --no-deps
 * Varsayılan e2e ortamında (siteadi.localhost) adreslerin kendisi "localhost" içerdiği için test atlanır.
 */
const FRONTEND = process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100";
const API = process.env.E2E_API_URL ?? "http://siteadi.localhost:4001/api/v1";
const FORBIDDEN = /backend:4000|localhost|127\.0\.0\.1/gi;
const LANG = process.env.E2E_PUBLIC_MEDIA_LANG ?? "tr";

function forbiddenSnippets(html: string): string[] {
  return [...html.matchAll(FORBIDDEN)].slice(0, 5).map((m) => html.slice(Math.max(0, m.index! - 80), m.index! + 60));
}

test.describe("sayfa HTML'inde iç/loopback medya adresi yok", () => {
  test.skip(/localhost|127\.0\.0\.1/i.test(FRONTEND + API), "Canlı benzeri yapılandırma gerekli (dosya başı açıklamasına bakın).");

  let doctorSlug: string | null = null;

  test.beforeAll(async ({ request }) => {
    // Vitrininde medya (foto/video) olan ilk herkese açık hekim — test anlamlı olsun diye.
    const list = await request.get(`${API}/doctors?limit=50`);
    expect(list.ok()).toBeTruthy();
    for (const d of ((await list.json()).data ?? []) as { slug: string }[]) {
      const showcase = await request.get(`${API}/doctors/${d.slug}/showcase`);
      if (showcase.ok() && ((await showcase.json()).data?.media?.length ?? 0) > 0) {
        doctorSlug = d.slug;
        break;
      }
    }
  });

  for (const [name, pathFor] of [
    ["anasayfa", () => `/${LANG}`],
    ["/reviews", () => `/${LANG}/reviews`],
    ["hekim profili", () => `/${LANG}/physicians/${doctorSlug}`],
  ] as const) {
    test(name, async ({ request }) => {
      if (name === "hekim profili") expect(doctorSlug, "vitrininde medya olan bir hekim gerekli").not.toBeNull();
      const res = await request.get(`${FRONTEND}${pathFor()}`);
      expect(res.status()).toBe(200);
      const html = await res.text();
      expect(forbiddenSnippets(html), "HTML'de iç/loopback adres").toEqual([]);
      if (name === "hekim profili") {
        // Galeri/video verisi gerçekten HTML'de (RSC verisi) — test boşa geçmesin; adresler genel kökten.
        const mediaOrigin = new URL(API).origin;
        expect(html).toContain(`${mediaOrigin}/uploads/`);
        expect(html).toMatch(/\.mp4/);
      }
    });
  }
});
