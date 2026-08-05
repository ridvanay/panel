import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regresyon — bkz. docs/architecture/ARCHITECTURE.md §10.8.9 "doğrulamada gerçek bir hata
 * bulundu": `admin/users/page.tsx`'in Dışa Aktar akışı eskiden `listAdminUsers()`'ı (tek
 * sayfa, `limit: 100`) cursor döngüsü OLMADAN bir kez çağırıyordu → 100'den fazla kullanıcı
 * olduğunda dışa aktarma SESSİZCE ilk 100'ü döndürüyordu. Düzeltme `listAllAdminUsers()`
 * (`src/lib/api/users-admin.ts`) — bu test, `nextCursor` zincirini SONUNA KADAR takip edip
 * TÜM sayfaları topladığını doğrular (qa-agent).
 */
describe("listAllAdminUsers — 100 kayıt truncation regresyonu", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeUser(index: number) {
    return {
      id: `user-${index}`,
      email: `user${index}@example.com`,
      name: `User ${index}`,
      avatarUrl: null,
      emailVerifiedAt: null,
      role: "EDITOR",
      createdAt: new Date(2024, 0, 1).toISOString(),
      status: "ACTIVE",
      lastLoginAt: null,
    };
  }

  it("100'den fazla kullanıcı varken TÜM sayfaları toplar (tek sayfada SESSİZCE kesilmez)", async () => {
    // 3 sayfa: 100 + 100 + 30 = 230 kullanıcı — tek `limit: 100` çağrısı yalnızca ilk 100'ü döndürürdü.
    const page1 = Array.from({ length: 100 }, (_, i) => makeUser(i));
    const page2 = Array.from({ length: 100 }, (_, i) => makeUser(100 + i));
    const page3 = Array.from({ length: 30 }, (_, i) => makeUser(200 + i));

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: page1, meta: { nextCursor: "cursor-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: page2, meta: { nextCursor: "cursor-2" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: page3, meta: { nextCursor: null } }), { status: 200 }));

    const { listAllAdminUsers } = await import("@/lib/api/users-admin");
    const all = await listAllAdminUsers();

    expect(all).toHaveLength(230);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Son sayfa `nextCursor: null` döndüğünde döngü DURMALI (4. bir istek ATILMAMALI).
    expect(all[0]!.id).toBe("user-0");
    expect(all[229]!.id).toBe("user-229");
  });

  it("tek sayfa (<= limit) durumunda gereksiz ekstra istek ATMAZ", async () => {
    const onlyPage = Array.from({ length: 42 }, (_, i) => makeUser(i));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: onlyPage, meta: { nextCursor: null } }), { status: 200 }));

    const { listAllAdminUsers } = await import("@/lib/api/users-admin");
    const all = await listAllAdminUsers();

    expect(all).toHaveLength(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
