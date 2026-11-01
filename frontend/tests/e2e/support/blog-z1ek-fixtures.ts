/**
 * qa-agent — Paket Z1-ek (guven sayfalari, CMS gorunumu, blog ana sayfasi, yazi cilasi) e2e fixture yardimcilari.
 * `blog-z1-fixtures.ts` desenini yeniden kullanir; tum kayitlar `qa-z1ek-` onekli slug tasir.
 */
import { API_BASE_URL, listAllAdminMedia, getFixtureUserToken } from "./api";

export const Z1EK_PREFIX = "qa-z1ek-";

function jsonHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function expectOk<T>(res: Response, context: string, okStatuses: number[] = [200, 201]): Promise<T> {
  const text = await res.text();
  if (!okStatuses.includes(res.status)) throw new Error(`${context}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** `/auth/login|register` sabit 5 istek/dk kotalidir; 429'da kota penceresi dolana kadar bekleyip yeniden dener. */
export async function fixtureUserTokenWithRetry(email: string, password: string, name: string): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getFixtureUserToken(email, password, name);
    } catch (err) {
      if (attempt >= 3 || !/429|Too Many|cok fazla|çok fazla/i.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, 65_000));
    }
  }
}

export interface Z1ekSpecialty {
  id: string;
  slug: string;
  name: string;
}

export async function createSpecialtyI18n(
  token: string,
  input: { slug: string; tr: string; en: string; ar: string; icon?: string }
): Promise<Z1ekSpecialty> {
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/specialties`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      name: input.tr,
      slug: input.slug,
      icon: input.icon ?? "heart-pulse",
      translations: { en: { name: input.en }, ar: { name: input.ar } },
    }),
  });
  return (await expectOk<{ data: Z1ekSpecialty }>(res, "uzmanlik olusturulamadi")).data;
}

export interface Z1ekDoctor {
  id: string;
  slug: string;
  fullName: string;
}

export async function createDoctorWithAvatar(
  token: string,
  input: { title: string; fullName: string; slug: string; specialtyId: string; avatarMediaId: string | null }
): Promise<Z1ekDoctor> {
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/doctors`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      title: input.title,
      fullName: input.fullName,
      slug: input.slug,
      bio: "QA Z1-ek fixture doktoru — gercek kisi degildir.",
      languages: ["tr", "en"],
      timeZone: "Europe/Istanbul",
      sessionDurationMin: 30,
      sessionPriceCents: 1000,
      currency: "USD",
      isVerified: true,
      isActive: true,
      specialtyId: input.specialtyId,
      ...(input.avatarMediaId ? { avatarMediaId: input.avatarMediaId } : {}),
    }),
  });
  return (await expectOk<{ data: Z1ekDoctor }>(res, "fixture doktor olusturulamadi")).data;
}

/** Repoda/yerel DB'de mevcut medya kayitlarindan dosya adina gore ilkini bulur (yeni dosya yuklenmez). */
export async function findMediaIdByFilename(token: string, filename: string): Promise<{ id: string; url: string } | null> {
  const all = await listAllAdminMedia(token);
  const hit = all.find((m) => m.filename === filename);
  return hit ? { id: hit.id, url: hit.url } : null;
}

export async function publicReviewers(locale: string): Promise<{ slug: string; name: string; approvedCount: number }[]> {
  const res = await fetch(`${API_BASE_URL}/blog/reviewers?locale=${locale}`);
  const body = await expectOk<{ data: { items: { slug: string; name: string; approvedCount: number }[] } }>(res, "herkese acik hekim listesi");
  return body.data.items;
}

// ---------------------------------------------------------------------------------------------------------------------
// CMS sayfalari
// ---------------------------------------------------------------------------------------------------------------------

export interface Z1ekPageInput {
  title: string;
  slug: string;
  blocks: unknown[];
  status?: "PUBLISHED" | "DRAFT";
  isLegalDocument?: boolean;
  translations?: Record<string, { title?: string; slug?: string; blocks?: unknown[] }>;
}

export async function createCmsPage(token: string, input: Z1ekPageInput): Promise<{ id: string; slug: string }> {
  const res = await fetch(`${API_BASE_URL}/admin/pages`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      title: input.title,
      slug: input.slug,
      status: input.status ?? "PUBLISHED",
      blocks: input.blocks,
      ...(input.isLegalDocument !== undefined ? { isLegalDocument: input.isLegalDocument } : {}),
      ...(input.translations ? { translations: input.translations } : {}),
    }),
  });
  return (await expectOk<{ data: { id: string; slug: string } }>(res, `sayfa olusturulamadi (${input.slug})`)).data;
}

export async function deleteCmsPage(token: string, id: string): Promise<void> {
  for (const url of [`${API_BASE_URL}/admin/pages/${id}`, `${API_BASE_URL}/admin/pages/${id}/permanent`]) {
    const res = await fetch(url, { method: "DELETE", headers: bearer(token) });
    if (![200, 204, 404].includes(res.status)) throw new Error(`sayfa silinemedi (${id}): ${res.status}`);
  }
}

/** Slug'a gore yonetici sayfa listesinden id bulur (imlec sayfalama; guven sayfalari CMS kayitlari icin). */
export async function findAdminPageIdBySlug(token: string, slug: string): Promise<string | null> {
  let cursor: string | undefined;
  for (let i = 0; i < 50; i += 1) {
    const url = new URL(`${API_BASE_URL}/admin/pages`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: bearer(token) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: { id: string; slug: string }[]; meta?: { nextCursor?: string | null } };
    const hit = body.data.find((r) => r.slug === slug);
    if (hit) return hit.id;
    if (!body.meta?.nextCursor) return null;
    cursor = body.meta.nextCursor;
  }
  return null;
}

export async function setPageStatus(token: string, id: string, status: "PUBLISHED" | "DRAFT"): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/pages/${id}`, { method: "PATCH", headers: jsonHeaders(token), body: JSON.stringify({ status }) });
  await expectOk(res, `sayfa durumu degistirilemedi (${id})`);
}
