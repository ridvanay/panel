import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { hashPassword } from "../../src/lib/password";

/**
 * §10.8.10 — `stats.test.ts` yalnızca RBAC + kaba (>=N) sayıları doğruluyordu; bu dosya
 * `/admin/stats/{summary,top-content,users,revenue,views}` uçlarının GERÇEK aggregation
 * doğruluğunu (aralık dışı satırların hariç tutulması, cursor sayfalama sırası, granularity
 * bucket'lama) ve `from`/`to`/`days` parametre kombinasyonlarının edge case'lerini kapsar.
 * `PageView`/`User`/`Subscription` satırları BİLEREK `app.prisma` ile doğrudan (belirli
 * `date`/`createdAt` değerleriyle) oluşturulur — public view endpoint'i tarihi her zaman
 * "şimdi" olarak set ettiğinden (bkz. pages.routes.ts::"/:slug/view") HTTP üzerinden farklı
 * tarihli satırlar üretmek mümkün değil (import-retention.test.ts'teki AYNI teknik).
 */
describe("stats — gerçek veri doğruluğu (§10.8.10)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken: adminToken } = await registerTestUser(app, { email: "accuracy-admin@example.com" }));
    const manager = await registerTestUser(app, { email: "accuracy-manager@example.com" });
    await app.prisma.user.update({ where: { id: manager.userId }, data: { role: "MANAGER" } });
    managerToken = manager.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  describe("/admin/stats/summary", () => {
    it("pageViews/postViews/newUsers YALNIZCA [from,to] aralığındaki satırları toplar, aralık dışı satırlar SAYILMAZ", async () => {
      const createPage = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(adminToken),
        payload: { title: "Özet Testi Sayfa", status: "PUBLISHED" },
      });
      const page = createPage.json().data;

      const createPost = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(adminToken),
        payload: { title: "Özet Testi Yazı", status: "PUBLISHED" },
      });
      const post = createPost.json().data;

      const IN_RANGE = new Date("2026-03-10T00:00:00.000Z");
      const OUT_OF_RANGE = new Date("2026-02-01T00:00:00.000Z");

      await app.prisma.pageView.createMany({
        data: [
          { pageId: page.id, date: IN_RANGE, deviceType: "DESKTOP", country: "TR", count: 5 },
          { pageId: page.id, date: OUT_OF_RANGE, deviceType: "DESKTOP", country: "TR", count: 100 },
          { postId: post.id, date: IN_RANGE, deviceType: "MOBILE", country: "US", count: 3 },
          { postId: post.id, date: OUT_OF_RANGE, deviceType: "MOBILE", country: "US", count: 200 },
        ],
      });

      await app.prisma.user.create({
        data: {
          email: "accuracy-newuser-inrange@example.com",
          passwordHash: await hashPassword("Sifre12345!"),
          name: "Aralık İçi Kullanıcı",
          createdAt: IN_RANGE,
        },
      });
      await app.prisma.user.create({
        data: {
          email: "accuracy-newuser-outrange@example.com",
          passwordHash: await hashPassword("Sifre12345!"),
          name: "Aralık Dışı Kullanıcı",
          createdAt: OUT_OF_RANGE,
        },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/stats/summary?from=2026-03-01&to=2026-03-31",
        headers: authHeader(adminToken),
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.pageViews).toBe(5);
      expect(data.postViews).toBe(3);
      expect(data.newUsers).toBe(1);
    });
  });

  describe("/admin/stats/revenue", () => {
    it("mrrCents/activeSubscriptions ANLIK (yalnızca ACTIVE) durumu yansıtır; newMrrCents/churnedCount bucket-içi hareketleri sayar", async () => {
      const owner = await app.prisma.user.create({
        data: { email: "revenue-owner@example.com", passwordHash: await hashPassword("Sifre12345!"), name: "Abonelik Sahibi" },
      });
      const plan = await app.prisma.plan.create({
        data: { name: "Pro", priceMonthlyCents: 1999, priceYearlyCents: 19990 },
      });

      const activeOrg = await app.prisma.organization.create({
        data: { name: "Aktif Org", slug: "revenue-aktif-org", ownerId: owner.id },
      });
      await app.prisma.subscription.create({
        data: {
          organizationId: activeOrg.id,
          planId: plan.id,
          status: "ACTIVE",
          currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
          createdAt: new Date("2026-03-10T00:00:00.000Z"),
        },
      });

      const churnedOrg = await app.prisma.organization.create({
        data: { name: "İptal Edilen Org", slug: "revenue-churn-org", ownerId: owner.id },
      });
      const churnedSub = await app.prisma.subscription.create({
        data: {
          organizationId: churnedOrg.id,
          planId: plan.id,
          status: "CANCELED",
          currentPeriodEnd: new Date("2026-02-01T00:00:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      // `updatedAt` `@updatedAt` olduğundan `create`te yoksayılır — churn bucket'ı `updatedAt`e
      // göre belirlendiği için (bkz. stats-query.ts::getRevenueStats) elle sonradan set edilir.
      await app.prisma.subscription.update({
        where: { id: churnedSub.id },
        data: { updatedAt: new Date("2026-03-10T00:00:00.000Z") },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/stats/revenue?from=2026-03-01&to=2026-03-31",
        headers: authHeader(adminToken),
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;

      expect(data.activeSubscriptions).toBe(1);
      expect(data.mrrCents).toBe(1999);

      const bucket = data.series.find((point: { date: string }) => point.date === "2026-03-10");
      expect(bucket).toBeDefined();
      expect(bucket.newMrrCents).toBe(1999);
      expect(bucket.churnedCount).toBe(1);
    });
  });

  describe("/admin/stats/top-content — cursor sayfalama", () => {
    it("görüntülenmeye göre AZALAN sırada döner; limit + cursor ile TAM ve TEKRARSIZ sayfalanır", async () => {
      async function createPageWithViews(title: string, views: number) {
        const create = await app.inject({
          method: "POST",
          url: "/api/v1/admin/pages",
          headers: authHeader(adminToken),
          payload: { title, status: "PUBLISHED" },
        });
        const p = create.json().data;
        await app.prisma.pageView.create({
          data: { pageId: p.id, date: new Date("2026-05-01T00:00:00.000Z"), deviceType: "DESKTOP", country: "TR", count: views },
        });
        return p;
      }

      const top = await createPageWithViews("TC En Popüler", 30);
      const mid = await createPageWithViews("TC Orta", 20);
      const low = await createPageWithViews("TC En Az", 10);

      const page1 = await app.inject({
        method: "GET",
        url: "/api/v1/admin/stats/top-content?from=2026-05-01&to=2026-05-01&limit=2",
        headers: authHeader(adminToken),
      });
      expect(page1.statusCode).toBe(200);
      const body1 = page1.json();
      expect(body1.data.map((i: { id: string }) => i.id)).toEqual([top.id, mid.id]);
      expect(body1.data[0].views).toBe(30);
      expect(body1.data[1].views).toBe(20);
      expect(body1.meta.nextCursor).toBeTruthy();

      const page2 = await app.inject({
        method: "GET",
        url: `/api/v1/admin/stats/top-content?from=2026-05-01&to=2026-05-01&limit=2&cursor=${body1.meta.nextCursor}`,
        headers: authHeader(adminToken),
      });
      expect(page2.statusCode).toBe(200);
      const body2 = page2.json();
      expect(body2.data.map((i: { id: string }) => i.id)).toEqual([low.id]);
      expect(body2.data[0].views).toBe(10);
      expect(body2.meta.nextCursor).toBeNull();
    });
  });

  describe("/admin/stats/views — granularity=week/month bucket'lama", () => {
    it("granularity=week — AYNI ISO haftasındaki günler TEK bucket'ta toplanır, farklı haftalar AYRI kalır", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(adminToken),
        payload: { title: "Haftalık Granularity Sayfası", status: "PUBLISHED" },
      });
      const page = create.json().data;

      // Bu dosyadaki DİĞER testlerin (summary: 2026-03-10, top-content: 2026-05-01 vb.)
      // eklediği satırlarla ÇAKIŞMAYAN, ayrı bir hafta/tarih aralığı BİLEREK seçilir — `/views`
      // ucu belirli bir `pageId` ile FİLTRELEMEZ, aralıktaki TÜM sayfaların toplamını döner.
      await app.prisma.pageView.createMany({
        data: [
          // Pazartesi 2026-07-06 haftası
          { pageId: page.id, date: new Date("2026-07-06T00:00:00.000Z"), deviceType: "DESKTOP", country: "TR", count: 4 },
          { pageId: page.id, date: new Date("2026-07-08T00:00:00.000Z"), deviceType: "MOBILE", country: "TR", count: 6 },
          // Sonraki hafta (Pazartesi 2026-07-13)
          { pageId: page.id, date: new Date("2026-07-13T00:00:00.000Z"), deviceType: "DESKTOP", country: "TR", count: 9 },
        ],
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/stats/views?from=2026-07-06&to=2026-07-13&granularity=week",
        headers: authHeader(managerToken),
      });
      expect(res.statusCode).toBe(200);
      const series = res.json().data;

      const week1 = series.find((p: { date: string }) => p.date === "2026-07-06");
      const week2 = series.find((p: { date: string }) => p.date === "2026-07-13");
      expect(week1?.pageViews).toBe(10);
      expect(week2?.pageViews).toBe(9);
    });

    it("granularity=month — AYNI aydaki günler TEK bucket'ta toplanır, farklı aylar AYRI kalır", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(adminToken),
        payload: { title: "Aylık Granularity Sayfası", status: "PUBLISHED" },
      });
      const page = create.json().data;

      // Yine bu dosyadaki diğer testlerle ÇAKIŞMAYAN ayrı bir aralık (bkz. yukarıdaki hafta
      // testindeki AYNI gerekçe).
      await app.prisma.pageView.createMany({
        data: [
          { pageId: page.id, date: new Date("2026-08-05T00:00:00.000Z"), deviceType: "DESKTOP", country: "TR", count: 3 },
          { pageId: page.id, date: new Date("2026-08-20T00:00:00.000Z"), deviceType: "MOBILE", country: "TR", count: 7 },
          { pageId: page.id, date: new Date("2026-09-02T00:00:00.000Z"), deviceType: "DESKTOP", country: "TR", count: 5 },
        ],
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/stats/views?from=2026-08-01&to=2026-09-02&granularity=month",
        headers: authHeader(managerToken),
      });
      expect(res.statusCode).toBe(200);
      const series = res.json().data;

      const august = series.find((p: { date: string }) => p.date === "2026-08-01");
      const september = series.find((p: { date: string }) => p.date === "2026-09-01");
      expect(august?.pageViews).toBe(10);
      expect(september?.pageViews).toBe(5);
    });
  });

  describe("from/to/days parametre edge case'leri", () => {
    it("`from` verilip `to` verilmezse 422 VALIDATION_ERROR döner", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/stats/views?from=2026-01-01",
        headers: authHeader(managerToken),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("`from`/`to` VE `days` birlikte verilirse `from`/`to` ÖNCELİKLİDİR, `days` YOK SAYILIR", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/stats/views?from=2026-03-01&to=2026-03-02&days=5",
        headers: authHeader(managerToken),
      });
      expect(res.statusCode).toBe(200);
      const series = res.json().data;
      expect(series.map((p: { date: string }) => p.date)).toEqual(["2026-03-01", "2026-03-02"]);
    });

    it("366 günü aşan bir `from`/`to` aralığı 422 VALIDATION_ERROR döner", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/stats/views?from=2020-01-01&to=2026-01-01",
        headers: authHeader(managerToken),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("geçersiz (parse edilemeyen) bir ISO tarihi 422 VALIDATION_ERROR döner", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/stats/views?from=not-a-real-date&to=2026-01-01",
        headers: authHeader(managerToken),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });
  });
});
