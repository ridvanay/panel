import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * §10.10 Navigasyon Menü Düzenleyicisi — düz dizi + `parentId` hiyerarşisi.
 * Kurallar: ARCHITECTURE.md §10.10.1-10.10.3, openapi.yaml `NavigationItem`/
 * `UpdateNavigationConfigRequest` şemaları.
 */
describe("navigation — /admin/navigation (parentId hiyerarşisi)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  function basePayload(navigationItems: unknown[]) {
    return {
      navigationItems,
      socialLinks: [],
      footerColumns: [],
    };
  }

  async function putNavigation(payload: unknown, token = adminToken) {
    return app.inject({
      method: "PUT",
      url: "/api/v1/admin/navigation",
      headers: authHeader(token),
      payload,
    });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // İlk register boş bir DB'de otomatik ADMIN olur (bkz. auth.service.ts).
    const admin = await registerTestUser(app, { email: "navigation-admin@example.com" });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("geçerli bir kök+alt öğe ağacı kaydedilir ve GET ile hiyerarşi korunur", async () => {
    const rootId = crypto.randomUUID();
    const childId = crypto.randomUUID();
    const secondRootId = crypto.randomUUID();

    const res = await putNavigation(
      basePayload([
        { id: rootId, label: "Ürünler", href: "/urunler", order: 0, parentId: null },
        { id: childId, label: "Yazılım", href: "/urunler/yazilim", order: 0, parentId: rootId },
        { id: secondRootId, label: "Hakkımızda", href: "/hakkimizda", order: 1 },
      ])
    );

    expect(res.statusCode).toBe(200);
    const putBody = res.json();
    expect(putBody.data.navigationItems).toHaveLength(3);

    const getRes = await app.inject({ method: "GET", url: "/api/v1/admin/navigation", headers: authHeader(adminToken) });
    expect(getRes.statusCode).toBe(200);
    const items = getRes.json().data.navigationItems as Array<{ id: string; parentId: string | null; order: number }>;
    expect(items).toHaveLength(3);

    const root = items.find((i) => i.id === rootId);
    const child = items.find((i) => i.id === childId);
    const secondRoot = items.find((i) => i.id === secondRootId);
    expect(root?.parentId).toBeNull();
    expect(secondRoot?.parentId).toBeNull();
    expect(child?.parentId).toBe(rootId);

    // Kök öğeler alt öğelerden önce döner (parentId NULLS FIRST, order asc).
    const rootIndex = items.findIndex((i) => i.id === rootId);
    const childIndex = items.findIndex((i) => i.id === childId);
    expect(rootIndex).toBeLessThan(childIndex);
  });

  it("derinlik ihlali — bir alt öğenin parentId'si başka bir alt öğeyi işaret ederse (3. seviye) 422 döner", async () => {
    const rootId = crypto.randomUUID();
    const childId = crypto.randomUUID();
    const grandchildId = crypto.randomUUID();

    const res = await putNavigation(
      basePayload([
        { id: rootId, label: "Ürünler", href: "/urunler", order: 0, parentId: null },
        { id: childId, label: "Yazılım", href: "/urunler/yazilim", order: 0, parentId: rootId },
        { id: grandchildId, label: "Mobil", href: "/urunler/yazilim/mobil", order: 0, parentId: childId },
      ])
    );

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("payload içinde çözülemeyen parentId (var olmayan bir id'yi işaret ediyor) 422 döner", async () => {
    const rootId = crypto.randomUUID();
    const bogusParentId = crypto.randomUUID();

    const res = await putNavigation(
      basePayload([
        { id: rootId, label: "Ürünler", href: "/urunler", order: 0, parentId: null },
        { id: crypto.randomUUID(), label: "Yazılım", href: "/urunler/yazilim", order: 0, parentId: bogusParentId },
      ])
    );

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("kendine referans (id === parentId) 422 döner", async () => {
    const selfId = crypto.randomUUID();

    const res = await putNavigation(basePayload([{ id: selfId, label: "Döngü", href: "/dongu", order: 0, parentId: selfId }]));

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("tekrarlanan id 422 döner", async () => {
    const duplicateId = crypto.randomUUID();

    const res = await putNavigation(
      basePayload([
        { id: duplicateId, label: "Ürünler", href: "/urunler", order: 0 },
        { id: duplicateId, label: "Hizmetler", href: "/hizmetler", order: 1 },
      ])
    );

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("20 öğe limiti tüm seviyelerin toplamına uygulanır (regresyon)", async () => {
    const rootId = crypto.randomUUID();
    const items = [{ id: rootId, label: "Kök", href: "/kok", order: 0, parentId: null }];
    // 20 kök + 1 alt öğe = 21 > limit.
    for (let i = 1; i < 20; i++) {
      items.push({ id: crypto.randomUUID(), label: `Kök ${i}`, href: `/kok-${i}`, order: i, parentId: null });
    }
    items.push({ id: crypto.randomUUID(), label: "Fazla alt öğe", href: "/fazla", order: 0, parentId: rootId });
    expect(items).toHaveLength(21);

    const res = await putNavigation(basePayload(items));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("tam 20 öğe (kök+alt karışık) sınırda kabul edilir", async () => {
    const rootId = crypto.randomUUID();
    const items: Array<{ id: string; label: string; href: string; order: number; parentId: string | null }> = [
      { id: rootId, label: "Kök", href: "/kok", order: 0, parentId: null },
    ];
    for (let i = 1; i < 15; i++) {
      items.push({ id: crypto.randomUUID(), label: `Kök ${i}`, href: `/kok-${i}`, order: i, parentId: null });
    }
    for (let i = 0; i < 5; i++) {
      items.push({ id: crypto.randomUUID(), label: `Alt ${i}`, href: `/alt-${i}`, order: i, parentId: rootId });
    }
    expect(items).toHaveLength(20);

    const res = await putNavigation(basePayload(items));
    expect(res.statusCode).toBe(200);
    expect(res.json().data.navigationItems).toHaveLength(20);
  });

  it("roots-first insert sıralaması: payload'da alt öğe kendi kök ebeveyninden ÖNCE gelse bile hatasız kaydedilir", async () => {
    const rootId = crypto.randomUUID();
    const childId = crypto.randomUUID();
    const anotherRootId = crypto.randomUUID();
    const anotherChildId = crypto.randomUUID();

    // Kasıtlı olarak alt öğeleri dizinin başına, kök öğeleri sonuna koyuyoruz — sunucu
    // tarafında roots-first yeniden sıralama yapılmazsa FK ihlali (kök henüz DB'de yokken
    // alt öğe insert edilmeye çalışılır) alınırdı.
    const items = [
      { id: childId, label: "Alt A", href: "/alt-a", order: 0, parentId: rootId },
      { id: anotherChildId, label: "Alt B", href: "/alt-b", order: 0, parentId: anotherRootId },
      { id: rootId, label: "Kök A", href: "/kok-a", order: 0, parentId: null },
      { id: anotherRootId, label: "Kök B", href: "/kok-b", order: 1, parentId: null },
    ];

    const res = await putNavigation(basePayload(items));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.navigationItems).toHaveLength(4);

    const row = await app.prisma.navigationItem.findUnique({ where: { id: childId } });
    expect(row?.parentId).toBe(rootId);
  });

  it("kimliksiz istek 401 döner", async () => {
    const noAuthRes = await app.inject({ method: "PUT", url: "/api/v1/admin/navigation", payload: basePayload([]) });
    expect(noAuthRes.statusCode).toBe(401);
  });
});
