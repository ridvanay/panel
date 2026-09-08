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

  function basePayload(navigationItems: unknown[]): Record<string, unknown> {
    return {
      navigationItems,
      socialLinks: [],
      footerColumns: [],
    };
  }

  async function putNavigation(payload: Record<string, unknown>, token = adminToken) {
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

  it("4 seviyeli geçerli bir ağaç (NAVIGATION_MAX_DEPTH = 3) kabul edilir", async () => {
    const level0 = crypto.randomUUID();
    const level1 = crypto.randomUUID();
    const level2 = crypto.randomUUID();
    const level3 = crypto.randomUUID();

    const res = await putNavigation(
      basePayload([
        { id: level0, label: "Ana Menü", href: "/ana-menu", order: 0, parentId: null },
        { id: level1, label: "Kategori", href: "/ana-menu/kategori", order: 0, parentId: level0 },
        { id: level2, label: "Alt Kategori", href: "/ana-menu/kategori/alt", order: 0, parentId: level1 },
        { id: level3, label: "Ürün Grubu", href: "/ana-menu/kategori/alt/grup", order: 0, parentId: level2 },
      ])
    );

    expect(res.statusCode).toBe(200);
    expect(res.json().data.navigationItems).toHaveLength(4);
  });

  it("derinlik ihlali — 5 seviyeli bir ağaç (ata sayısı NAVIGATION_MAX_DEPTH'i aşıyor) 422 döner ve mesaj 'derinlik' içerir", async () => {
    const level0 = crypto.randomUUID();
    const level1 = crypto.randomUUID();
    const level2 = crypto.randomUUID();
    const level3 = crypto.randomUUID();
    const level4 = crypto.randomUUID();

    const res = await putNavigation(
      basePayload([
        { id: level0, label: "Ana Menü", href: "/ana-menu", order: 0, parentId: null },
        { id: level1, label: "Kategori", href: "/ana-menu/kategori", order: 0, parentId: level0 },
        { id: level2, label: "Alt Kategori", href: "/ana-menu/kategori/alt", order: 0, parentId: level1 },
        { id: level3, label: "Ürün Grubu", href: "/ana-menu/kategori/alt/grup", order: 0, parentId: level2 },
        { id: level4, label: "Çok Derin", href: "/ana-menu/kategori/alt/grup/derin", order: 0, parentId: level3 },
      ])
    );

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.json().error)).toContain("derinlik");
  });

  it("2 düğümlü döngü (A -> B -> A) 422 döner ve mesaj 'döngü' içerir, 'derinlik' içermez", async () => {
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();

    const res = await putNavigation(
      basePayload([
        { id: idA, label: "A", href: "/a", order: 0, parentId: idB },
        { id: idB, label: "B", href: "/b", order: 0, parentId: idA },
      ])
    );

    expect(res.statusCode).toBe(422);
    const errorStr = JSON.stringify(res.json().error).toLowerCase();
    expect(errorStr).toContain("döngü");
    expect(errorStr).not.toContain("derinlik");
  });

  it("3 düğümlü döngü (A -> B -> C -> A) 422 döner ve mesaj 'döngü' içerir", async () => {
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    const idC = crypto.randomUUID();

    const res = await putNavigation(
      basePayload([
        { id: idA, label: "A", href: "/a", order: 0, parentId: idC },
        { id: idB, label: "B", href: "/b", order: 0, parentId: idA },
        { id: idC, label: "C", href: "/c", order: 0, parentId: idB },
      ])
    );

    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json().error).toLowerCase()).toContain("döngü");
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

  it("101 öğe limiti aşarsa (NAVIGATION_MAX_ITEMS = 100) 422 döner", async () => {
    const items: Array<{ id: string; label: string; href: string; order: number; parentId: string | null }> = [];
    for (let i = 0; i < 101; i++) {
      items.push({ id: crypto.randomUUID(), label: `Kök ${i}`, href: `/kok-${i}`, order: i, parentId: null });
    }
    expect(items).toHaveLength(101);

    const res = await putNavigation(basePayload(items));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("tam 100 öğe (4 seviye karışık) sınırda kabul edilir", async () => {
    const rootId = crypto.randomUUID();
    const level1Id = crypto.randomUUID();
    const level2Id = crypto.randomUUID();
    const items: Array<{ id: string; label: string; href: string; order: number; parentId: string | null }> = [
      { id: rootId, label: "Kök", href: "/kok", order: 0, parentId: null },
      { id: level1Id, label: "Kategori", href: "/kok/kategori", order: 0, parentId: rootId },
      { id: level2Id, label: "Alt Kategori", href: "/kok/kategori/alt", order: 0, parentId: level1Id },
    ];
    // 3 + 97 = 100.
    for (let i = 0; i < 97; i++) {
      items.push({ id: crypto.randomUUID(), label: `Ürün Grubu ${i}`, href: `/urun-grubu-${i}`, order: i, parentId: level2Id });
    }
    expect(items).toHaveLength(100);

    const res = await putNavigation(basePayload(items));
    expect(res.statusCode).toBe(200);
    expect(res.json().data.navigationItems).toHaveLength(100);
  });

  it("payload içinde çözülemeyen (orphan) parentId olan derin bir ağaç 422 döner", async () => {
    const rootId = crypto.randomUUID();
    const childId = crypto.randomUUID();
    const bogusParentId = crypto.randomUUID();

    const res = await putNavigation(
      basePayload([
        { id: rootId, label: "Kök", href: "/kok", order: 0, parentId: null },
        { id: childId, label: "Alt", href: "/kok/alt", order: 0, parentId: rootId },
        { id: crypto.randomUUID(), label: "Orphan", href: "/orphan", order: 0, parentId: bogusParentId },
      ])
    );

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("4 seviyeli + karışık sıralı bir dizi (ebeveynden önce çocuk geliyor) FK ihlali üretmeden kaydedilir", async () => {
    const level0 = crypto.randomUUID();
    const level1 = crypto.randomUUID();
    const level2 = crypto.randomUUID();
    const level3 = crypto.randomUUID();

    // Kasıtlı olarak en derin öğeyi dizinin başına, kökü sonuna koyuyoruz — sunucu tarafında
    // seviye-sıralı topolojik sıralama yapılmazsa FK ihlali alınırdı.
    const items = [
      { id: level3, label: "Ürün Grubu", href: "/ana-menu/kategori/alt/grup", order: 0, parentId: level2 },
      { id: level1, label: "Kategori", href: "/ana-menu/kategori", order: 0, parentId: level0 },
      { id: level2, label: "Alt Kategori", href: "/ana-menu/kategori/alt", order: 0, parentId: level1 },
      { id: level0, label: "Ana Menü", href: "/ana-menu", order: 0, parentId: null },
    ];

    const res = await putNavigation(basePayload(items));
    expect(res.statusCode).toBe(200);
    expect(res.json().data.navigationItems).toHaveLength(4);

    const row = await app.prisma.navigationItem.findUnique({ where: { id: level3 } });
    expect(row?.parentId).toBe(level2);
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
