/**
 * qa-agent — Admin kullanıcı yönetimi (`/admin/users/*`) E2E fixture yardımcıları.
 * `support/api.ts`/`support/blog-fixtures.ts` ile AYNI desen: doğrudan `fetch` ile gerçek
 * backend'e (saas_e2e) konuşur, UI akışına bağımlı olmayan kurulum/temizlik sağlar.
 *
 * Bu dosya, kullanıcının (orijinal bug raporunun) açıkça istediği 3 regresyon senaryosunu
 * (a: tek admin kendini silemez/rolünü düşüremez, b: 2+ admin varken biri diğerini
 * silebilir/düzenleyebilir, c: admin olmayan bir kullanıcı silinebilir/düzenlenebilir)
 * gerçek tarayıcı + gerçek backend'e karşı doğrulayan `admin-user-management.spec.ts`
 * tarafından kullanılır — backend'in kendi `tests/integration/admin-users*.test.ts`
 * (app.inject, gerçek HTTP katmanı yok) ve frontend'in `tests/unit/a11y-admin-users.test.tsx`
 * (mock API, gerçek backend yok) dosyalarının KAPSAMADIĞI "gerçek tarayıcıda buton tıklama →
 * gerçek ağ isteği → gerçek DB → tabloya yansıma" zincirini kapatır.
 */
import { API_BASE_URL } from "./api";

function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/** GET/DELETE (gövdesiz) istekler için — bkz. `blog-fixtures.ts` başlığındaki qa-agent bulgusu:
 * `Content-Type: application/json` header'ı gövdesiz bir DELETE'te Fastify'de `400 Bad Request`
 * üretir. `authHeaders()`'ı gövdesiz isteklerde KULLANMAYIN. */
function authHeadersNoBody(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

/** `.claude/architect-scope-rbac-5-tier.md` §1 — `VIEWER` KALDIRILDI, 5 kademeli role (bağlayıcı
 * sıra: ADMIN → MANAGER → EDITOR → CUSTOMER → USER). */
export type FixtureSiteRole = "ADMIN" | "MANAGER" | "EDITOR" | "CUSTOMER" | "USER";

export interface FixtureAdminUser {
  id: string;
  email: string;
  name: string;
  role: FixtureSiteRole;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  deletedAt: string | null;
  [key: string]: unknown;
}

/**
 * `POST /auth/register` — `saas_e2e`'de qa-e2e-admin ZATEN mevcut olduğundan (`userCount !== 0`)
 * yeni kayıt her zaman varsayılan role (§7.1 — `USER`, bkz. `schema.prisma::User.role`, eski:
 * `VIEWER`) düşer — bu yüzden bu fonksiyon, admin API'sinin (rastgele/erişilemez şifre üreten
 * `POST /admin/users` aksine) BİLİNEN bir şifreyle "panel erişimi olmayan" bir kullanıcı
 * fixture'ı kurmanın tek yoludur. `/auth/register`'ın 5 istek/dk sabit limiti nedeniyle (bkz.
 * `support/api.ts` başlığı) bu fonksiyon spec dosyası başına YALNIZCA BİR-İKİ KEZ çağrılmalıdır.
 *
 * İDEMPOTENT: `email` zaten kayıtlıysa (409) SESSİZCE başarılı sayılır. qa-agent bulgusu: bu
 * ZORUNLU — `auth.service.ts::register`'ın e-posta benzersizlik kontrolü kullanıcının `status`'una
 * BAKMIYOR (`admin-users.routes.ts::POST /admin/users`'ın aksine, o `DELETED` durumu ayrıca ele
 * alıyor) — yani bir e-posta BİR KEZ (yumuşak) silinince o e-postayla BİR DAHA ASLA register
 * OLUNAMIYOR. Bu fixture'lar test akışı gereği silinebildiğinden (bkz. senaryo (b)/(c) testleri),
 * `resetFixtureUserToBaseline()` (aşağıda) her koşum SONUNDA/BAŞINDA kullanıcıyı DELETED bırakmak
 * yerine geri yükleyip USER/ACTIVE temel durumuna döndürür — bu fonksiyon o zemin üzerine
 * "yoksa oluştur" davranışını EKLER.
 */
export async function registerFixtureUser(email: string, password: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  if (res.status === 409) return; // zaten var — `resetFixtureUserToBaseline()` temiz zemine getirmiş olmalı
  await json(res);
}

export async function adminGetUserByEmail(token: string, email: string): Promise<FixtureAdminUser | undefined> {
  const res = await fetch(`${API_BASE_URL}/admin/users?limit=100&includeDeleted=true`, {
    headers: authHeadersNoBody(token),
  });
  const body = await json<{ data: FixtureAdminUser[] }>(res);
  return body.data.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export async function adminUpdateRole(
  token: string,
  userId: string,
  role: FixtureSiteRole
): Promise<{ status: number }> {
  const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/role`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ role }),
  });
  return { status: res.status };
}

export async function adminUpdateStatus(
  token: string,
  userId: string,
  status: "ACTIVE" | "SUSPENDED"
): Promise<{ status: number }> {
  const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/status`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ status }),
  });
  return { status: res.status };
}

export async function adminRestoreUser(token: string, userId: string): Promise<{ status: number }> {
  const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/restore`, {
    method: "POST",
    headers: authHeadersNoBody(token),
  });
  return { status: res.status };
}

/**
 * Idempotent temel-durum sıfırlama — `email`'e ait fixture kullanıcıyı USER/ACTIVE'e getirir
 * (§7.1 — yeni şema varsayılanı ve en düşük ayrıcalık; eski: VIEWER). Bkz.
 * `admin-user-management.spec.ts`'teki "tek admin" senaryosunun ÖN KOŞULU: qa-e2e-admin
 * DIŞINDA aktif ADMIN OLMAMALI. Kullanıcı yoksa (ilk koşum) hiçbir şey YAPMAZ —
 * `registerFixtureUser()` sıfırdan oluşturacaktır.
 *
 * KASITLI OLARAK silmiyor (önceki bir tasarım — `cleanupFixtureUserByEmail` — silip
 * bırakıyordu): bir e-posta BİR KEZ silinince `POST /auth/register`'a bir daha ASLA KABUL
 * EDİLMİYOR (bkz. `registerFixtureUser()` başlığındaki qa-agent bulgusu) — bu yüzden temizlik
 * "sil" değil "geri yükle + temel role/status'a döndür" olmalı, aksi halde bir sonraki koşum
 * `registerFixtureUser()`'da kalıcı olarak 409'a çarpar (qa-agent'ın kendi ilk taslağında
 * gözlemlendi ve düzeltildi).
 */
export async function resetFixtureUserToBaseline(token: string, email: string): Promise<void> {
  const user = await adminGetUserByEmail(token, email);
  if (!user) return;
  if (user.status === "DELETED") {
    await adminRestoreUser(token, user.id);
  } else if (user.status === "SUSPENDED") {
    await adminUpdateStatus(token, user.id, "ACTIVE");
  }
  if (user.role !== "USER") {
    await adminUpdateRole(token, user.id, "USER");
  }
}
