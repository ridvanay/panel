/**
 * qa-agent — Blog E2E fixture yardımcıları. `support/api.ts`'teki desenin (doğrudan `fetch`,
 * gerçek backend'e karşı) blog'a özgü genişlemesi: toplu yazı/kategori/etiket oluşturma ve
 * temizleme. Amaç, madde 3 (pagination) regresyonunu GERÇEK VERİYLE (bkz. ARCHITECTURE.md
 * §10.7.1 tablosu — 229 öğe örneği) doğrulayabilmek ve §10.14 (Tag) testlerinin ihtiyaç
 * duyduğu kategori/etiket/yazı fixture'larını UI'ye bağımlı olmadan hızlıca kurabilmek.
 */
import type { AdminSession } from "./api";
import { API_BASE_URL } from "./api";

function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/**
 * GET/DELETE (gövdesiz) istekler için — qa-agent bulgusu (bkz. bu dosyanın başlığı): Fastify,
 * `Content-Type: application/json` header'ı GÖVDESİZ bir DELETE isteğinde de görürse gövdeyi
 * ayrıştırmaya çalışır ve boş gövdeyi geçersiz JSON sayıp `400 Bad Request` döner (GET/HEAD bu
 * ayrıştırmadan Fastify'nin varsayılan davranışıyla muaf — bu yüzden yalnızca DELETE'lerde
 * gözlemlendi). `authHeaders()`'ı gövdesiz isteklerde KULLANMAYIN — bu, sessizce yutulan 400'ler
 * yüzünden TÜM fixture temizliğinin (`cleanup*ByPrefix`) çalışmadığı, veri biriktiren KRİTİK bir
 * flaky-test kaynağıydı.
 */
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

export interface AdminBlogPost {
  id: string;
  title: string;
  slug: string;
  status: string;
  deletedAt: string | null;
  category: { id: string; name: string } | null;
  tags: { id: string; name: string; slug: string }[];
  [key: string]: unknown;
}

export interface CreateBlogPostFixtureInput {
  title: string;
  slug?: string;
  status?: "PUBLISHED" | "DRAFT";
  categoryId?: string | null;
  tagIds?: string[];
}

/** `POST /admin/blog` — minimal alanlarla bir yazı oluşturur. */
export async function createBlogPost(token: string, input: CreateBlogPostFixtureInput): Promise<AdminBlogPost> {
  const res = await fetch(`${API_BASE_URL}/admin/blog`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      title: input.title,
      slug: input.slug,
      status: input.status ?? "PUBLISHED",
      contentHtml: `<p>${input.title} — qa-e2e fixture içeriği.</p>`,
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.tagIds !== undefined ? { tagIds: input.tagIds } : {}),
    }),
  });
  return json<{ data: AdminBlogPost }>(res).then((b) => b.data);
}

/**
 * `count` adet yazıyı `titlePrefix` + sıra numarasıyla oluşturur — §10.7.1 pagination
 * regresyonu için gerçek veri hacmi üretir (ör. 229). Concurrency SINIRLI (20) — backend'i
 * boğmadan makul sürede tamamlanır; sıralı 229 istek yerel ortamda gereksiz yavaş olurdu.
 */
export async function createManyBlogPosts(
  token: string,
  count: number,
  titlePrefix: string
): Promise<AdminBlogPost[]> {
  const CONCURRENCY = 20;
  const results: AdminBlogPost[] = [];
  for (let start = 0; start < count; start += CONCURRENCY) {
    const chunkSize = Math.min(CONCURRENCY, count - start);
    const chunk = await Promise.all(
      Array.from({ length: chunkSize }, (_, i) => {
        const n = start + i + 1;
        // `padStart` — slug/title sıralamasının sözlüksel değil sayısal göründüğü, aramada
        // benzersiz kaldığı bir sabit genişlik.
        const label = String(n).padStart(4, "0");
        return createBlogPost(token, {
          title: `${titlePrefix} ${label}`,
          slug: `${titlePrefix.toLowerCase().replace(/\s+/g, "-")}-${label}`,
          status: "PUBLISHED",
        });
      })
    );
    results.push(...chunk);
  }
  return results;
}

/** `GET /admin/blog` — cursor döngüsüyle TAM listeyi çeker (`trashed=include`, UI'nin yaptığı gibi). */
export async function listAllAdminBlogPosts(token: string): Promise<AdminBlogPost[]> {
  const collected: AdminBlogPost[] = [];
  let cursor: string | undefined;
  while (true) {
    const url = new URL(`${API_BASE_URL}/admin/blog`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("trashed", "include");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: authHeadersNoBody(token) });
    const body = await json<{ data: AdminBlogPost[]; meta: { nextCursor?: string | null } }>(res);
    collected.push(...body.data);
    if (!body.meta.nextCursor) break;
    cursor = body.meta.nextCursor;
  }
  return collected;
}

/** Bir DELETE isteğinin sonucunu doğrular — 2xx/404 (idempotent) dışında SESSİZCE YUTULMAZ,
 * fırlatılır. Eski davranış (durumu hiç kontrol etmemek) `Content-Type` 400 bug'ının (bkz. dosya
 * başlığı) haftalarca fark edilmeden veri biriktirmesine izin vermişti. */
async function assertDeleteOk(res: Response, context: string): Promise<void> {
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fixture cleanup DELETE başarısız — ${context}: ${res.status} ${body}`);
  }
}

/** Soft-delete + kalıcı sil — fixture temizliği. Idempotent (zaten yoksa 404'ler yutulur). */
export async function deleteBlogPostPermanently(token: string, postId: string): Promise<void> {
  const res1 = await fetch(`${API_BASE_URL}/admin/blog/${postId}`, {
    method: "DELETE",
    headers: authHeadersNoBody(token),
  });
  await assertDeleteOk(res1, `blog post ${postId} (soft-delete)`);
  const res2 = await fetch(`${API_BASE_URL}/admin/blog/${postId}/permanent`, {
    method: "DELETE",
    headers: authHeadersNoBody(token),
  });
  await assertDeleteOk(res2, `blog post ${postId} (permanent)`);
}

/** `titlePrefix` ile başlayan TÜM yazıları bulup kalıcı siler — test öncesi/sonrası idempotent zemin. */
export async function cleanupBlogPostsByPrefix(token: string, titlePrefix: string): Promise<void> {
  const all = await listAllAdminBlogPosts(token);
  const matching = all.filter((p) => p.title.startsWith(titlePrefix));
  const CONCURRENCY = 20;
  for (let start = 0; start < matching.length; start += CONCURRENCY) {
    const chunk = matching.slice(start, start + CONCURRENCY);
    await Promise.all(chunk.map((p) => deleteBlogPostPermanently(token, p.id)));
  }
}

export interface AdminBlogCategory {
  id: string;
  name: string;
  slug: string;
}

export async function createBlogCategory(token: string, name: string, slug?: string): Promise<AdminBlogCategory> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/categories`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name, ...(slug ? { slug } : {}) }),
  });
  return json<{ data: AdminBlogCategory }>(res).then((b) => b.data);
}

export async function deleteBlogCategory(token: string, categoryId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/categories/${categoryId}`, {
    method: "DELETE",
    headers: authHeadersNoBody(token),
  });
  await assertDeleteOk(res, `blog category ${categoryId}`);
}

export interface AdminBlogTag {
  id: string;
  name: string;
  slug: string;
  postCount?: number;
}

export async function listBlogTags(token: string): Promise<AdminBlogTag[]> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/tags`, { headers: authHeadersNoBody(token) });
  return json<{ data: AdminBlogTag[] }>(res).then((b) => b.data);
}

export async function createBlogTag(token: string, name: string, slug?: string): Promise<AdminBlogTag> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/tags`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name, ...(slug ? { slug } : {}) }),
  });
  return json<{ data: AdminBlogTag }>(res).then((b) => b.data);
}

/** Yalnızca ADMIN. */
export async function deleteBlogTag(token: string, tagId: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/admin/blog/tags/${tagId}`, { method: "DELETE", headers: authHeadersNoBody(token) });
}

export async function cleanupBlogTagsByPrefix(token: string, namePrefix: string): Promise<void> {
  const all = await listBlogTags(token);
  const matching = all.filter((t) => t.name.startsWith(namePrefix));
  await Promise.all(
    matching.map(async (t) => {
      const res = await deleteBlogTag(token, t.id);
      await assertDeleteOk(res, `blog tag ${t.id}`);
    })
  );
}

export async function cleanupBlogCategoriesByPrefix(token: string, namePrefix: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/categories`, { headers: authHeadersNoBody(token) });
  const categories = await json<{ data: AdminBlogCategory[] }>(res).then((b) => b.data);
  const matching = categories.filter((c) => c.name.startsWith(namePrefix));
  await Promise.all(matching.map((c) => deleteBlogCategory(token, c.id)));
}

export type { AdminSession };
