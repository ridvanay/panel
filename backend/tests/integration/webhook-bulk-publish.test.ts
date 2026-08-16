import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * §10.13.8 — bulk-publish webhook emisyonu regresyon testi (backend-agent'ın raporunda
 * flagladığı nokta: `pages.routes.ts` / `blog.routes.ts` / `portfolio.routes.ts`'teki `"/bulk"`
 * uçlarında `runBulkContentAction` (paylaşılan altyapı, `lib/bulk-content-actions.ts`) üzerine
 * route seviyesinde eklenen pre/post-transition ID diffing — "ikinci bir göz" istendi).
 *
 * `runBulkContentAction` "publish" aksiyonunda ZATEN yayında olan öğeleri de "applicable"
 * sayar (yalnızca çöpe atılmış/bulunamayan id'leri `skippedIds`'e koyar — bkz. o dosyadaki
 * `applicable` mantığı). Bu yüzden `*_PUBLISHED` webhook'unun YALNIZCA gerçek DRAFT→PUBLISHED
 * geçişi yapan öğeler için tetiklendiğini (zaten yayındaki öğeler için TEKRAR tetiklenmediğini)
 * doğrulamak, route seviyesindeki `publishCandidateIds`/`transitionedIds` diffing'inin doğru
 * çalıştığını kanıtlayan TEK yoldur — `webhook-emission.test.ts` bunu yalnızca TEKİL (bulk
 * olmayan) PATCH akışı için kapsar, `/bulk` YOLU için ayrı bir test YOKTU (bu dosya o boşluğu
 * kapatır).
 */
describe("bulk-publish webhook emisyonu — yalnızca gerçekten geçiş yapan öğeler için tetiklenir", () => {
  let app: FastifyInstance;
  let accessToken: string;

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken } = await registerTestUser(app, { email: "bulk-publish-webhook-admin@example.com" }));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  /** Blog/Page/Portfolio'nun üçü için BİREBİR aynı senaryoyu koşan ortak yardımcı. */
  async function runScenario(entity: {
    label: string;
    createUrl: string;
    bulkUrl: string;
    event: string;
    prismaDelegate: "blogPost" | "page" | "portfolioItem";
  }) {
    // 1) iki taslak (yayın adayı), 2) zaten yayında bir öğe, 3) çöpe atılmış bir öğe, 4) var
    // olmayan bir id — beşi de AYNI `/bulk` çağrısına "publish" aksiyonuyla verilir.
    const draft1 = await app.inject({ method: "POST", url: entity.createUrl, headers: authHeader(), payload: { title: `${entity.label} Taslak 1` } });
    const draft2 = await app.inject({ method: "POST", url: entity.createUrl, headers: authHeader(), payload: { title: `${entity.label} Taslak 2` } });
    const alreadyPublishedCreate = await app.inject({
      method: "POST",
      url: entity.createUrl,
      headers: authHeader(),
      payload: { title: `${entity.label} Zaten Yayında`, status: "PUBLISHED" },
    });
    const toTrash = await app.inject({ method: "POST", url: entity.createUrl, headers: authHeader(), payload: { title: `${entity.label} Çöpe Gidecek` } });

    const draft1Id = draft1.json().data.id;
    const draft2Id = draft2.json().data.id;
    const alreadyPublishedId = alreadyPublishedCreate.json().data.id;
    const trashedId = toTrash.json().data.id;
    const missingId = "00000000-0000-0000-0000-00000000ffff";

    await app.inject({ method: "DELETE", url: `${entity.createUrl}/${trashedId}`, headers: authHeader() });

    // Webhook, abone olunan `*_PUBLISHED` olayına ÖZEL — her entity için taze bir webhook.
    const webhookRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(),
      payload: { name: `${entity.label} Bulk Hook`, url: `https://example.com/hooks/${entity.prismaDelegate}`, events: [entity.event] },
    });
    expect(webhookRes.statusCode).toBe(201);
    const webhookId = webhookRes.json().data.webhook.id;

    const bulkRes = await app.inject({
      method: "POST",
      url: entity.bulkUrl,
      headers: authHeader(),
      payload: { ids: [draft1Id, draft2Id, alreadyPublishedId, trashedId, missingId], action: "publish" },
    });
    expect(bulkRes.statusCode).toBe(200);
    const result = bulkRes.json().data;

    // `runBulkContentAction` çöpe atılmış + bulunamayan id'leri atlar; zaten yayında olan öğe
    // "applicable" sayılır (trashed DEĞİL) — affectedCount = 3 (draft1, draft2, alreadyPublished).
    expect(result.affectedCount).toBe(3);
    expect(result.skippedIds.sort()).toEqual([missingId, trashedId].sort());

    // KRİTİK doğrulama: webhook YALNIZCA GERÇEKTEN geçiş yapan iki taslak için tetiklenmeli —
    // zaten yayında olan öğe `affectedCount`'a dahil olmasına RAĞMEN webhook'u TEKRAR
    // TETİKLEMEMELİDİR (bu diffing'in korumaya çalıştığı asıl regresyon).
    const deliveries = await app.prisma.webhookDelivery.findMany({ where: { webhookId }, orderBy: { seq: "asc" } });
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.event === entity.event)).toBe(true);

    const deliveredIds = deliveries.map((d) => (d.payload as { data: { id: string } }).data.id).sort();
    expect(deliveredIds).toEqual([draft1Id, draft2Id].sort());

    // Yayın durumları da DB'de doğrulanır (webhook'un yalnızca "iddia" değil gerçek geçişi yansıttığını kanıtlar).
    const rows = await (app.prisma[entity.prismaDelegate] as any).findMany({
      where: { id: { in: [draft1Id, draft2Id, alreadyPublishedId] } },
      select: { id: true, status: true, publishedAt: true },
    });
    for (const row of rows) {
      expect(row.status).toBe("PUBLISHED");
      expect(row.publishedAt).not.toBeNull();
    }
  }

  it("blog — bulk publish sonrası BLOG_POST_PUBLISHED yalnızca gerçek taslak→yayın geçişleri için tetiklenir", async () => {
    await runScenario({
      label: "Blog",
      createUrl: "/api/v1/admin/blog",
      bulkUrl: "/api/v1/admin/blog/bulk",
      event: "BLOG_POST_PUBLISHED",
      prismaDelegate: "blogPost",
    });
  });

  it("pages — bulk publish sonrası PAGE_PUBLISHED yalnızca gerçek taslak→yayın geçişleri için tetiklenir", async () => {
    await runScenario({
      label: "Sayfa",
      createUrl: "/api/v1/admin/pages",
      bulkUrl: "/api/v1/admin/pages/bulk",
      event: "PAGE_PUBLISHED",
      prismaDelegate: "page",
    });
  });

  it("portfolio — bulk publish sonrası PORTFOLIO_ITEM_PUBLISHED yalnızca gerçek taslak→yayın geçişleri için tetiklenir", async () => {
    await runScenario({
      label: "Portfolyo",
      createUrl: "/api/v1/admin/portfolio",
      bulkUrl: "/api/v1/admin/portfolio/bulk",
      event: "PORTFOLIO_ITEM_PUBLISHED",
      prismaDelegate: "portfolioItem",
    });
  });
});
