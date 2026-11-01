/**
 * qa-agent — Paket Z1 (blog altyapisi) e2e fixture yardimcilari. Gercek backend'e (`saas_e2e`) dogrudan `fetch`;
 * UI akisindan bagimsiz kurulum/temizlik. Tum kayitlar `qa-z1-` onekli slug tasir.
 */
import { API_BASE_URL } from "./api";

export const Z1_PREFIX = "qa-z1-";

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

export interface Z1Specialty {
  id: string;
  slug: string;
  name: string;
}

export async function createSpecialty(token: string, input: { name: string; slug: string; enName: string; icon?: string }): Promise<Z1Specialty> {
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/specialties`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      name: input.name,
      slug: input.slug,
      icon: input.icon ?? "heart-pulse",
      translations: { en: { name: input.enName }, ar: { name: input.enName } },
    }),
  });
  return (await expectOk<{ data: Z1Specialty }>(res, "uzmanlik olusturulamadi")).data;
}

export async function deleteSpecialty(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/specialties/${id}`, { method: "DELETE", headers: bearer(token) });
  if (![200, 204, 404].includes(res.status)) throw new Error(`uzmanlik silinemedi: ${res.status}`);
}

export interface Z1Category {
  id: string;
  name: string;
  slug: string;
  isMedical?: boolean;
}

export async function createCategory(token: string, input: { name: string; slug: string; isMedical: boolean; translations?: unknown }): Promise<Z1Category> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/categories`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify(input) });
  return (await expectOk<{ data: Z1Category }>(res, "kategori olusturulamadi")).data;
}

export async function deleteCategory(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/categories/${id}`, { method: "DELETE", headers: bearer(token) });
  if (![200, 204, 404].includes(res.status)) throw new Error(`kategori silinemedi: ${res.status}`);
}

export interface Z1Doctor {
  id: string;
  slug: string;
  fullName: string;
}

export async function createReviewerDoctor(token: string, input: { fullName: string; specialtyId: string; slug: string }): Promise<Z1Doctor> {
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/doctors`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      title: "Prof. Dr.",
      fullName: input.fullName,
      slug: input.slug,
      bio: "QA Z1 fixture doktoru — gercek kisi degildir.",
      languages: ["tr", "en"],
      timeZone: "Europe/Istanbul",
      sessionDurationMin: 30,
      sessionPriceCents: 1000,
      currency: "USD",
      isVerified: true,
      isActive: true,
      specialtyId: input.specialtyId,
    }),
  });
  return (await expectOk<{ data: Z1Doctor }>(res, "fixture doktor olusturulamadi")).data;
}

export interface Z1PostInput {
  title: string;
  slug: string;
  excerpt?: string;
  contentHtml: string;
  categoryId: string;
  specialtyId?: string | null;
  reviewerDoctorId?: string | null;
  status?: "DRAFT" | "PUBLISHED";
  medicalReviewStatus?: "pending" | "not_required";
  isFeatured?: boolean;
  keyTakeaways?: string[];
  faq?: { question: string; answer: string }[];
  references?: { title: string; publisher: string; url: string; accessedAt: string }[];
  translations?: Record<string, Record<string, unknown>>;
}

export interface Z1Post {
  id: string;
  slug: string;
  title: string;
  status: string;
  medicalReviewStatus?: string | null;
}

export async function createPost(token: string, input: Z1PostInput): Promise<Z1Post> {
  const res = await fetch(`${API_BASE_URL}/admin/blog`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ status: "DRAFT", medicalReviewStatus: "pending", ...input }),
  });
  return (await expectOk<{ data: Z1Post }>(res, `yazi olusturulamadi (${input.slug})`)).data;
}

export async function patchPost(token: string, id: string, body: Record<string, unknown>): Promise<Z1Post> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/${id}`, { method: "PATCH", headers: jsonHeaders(token), body: JSON.stringify(body) });
  return (await expectOk<{ data: Z1Post }>(res, `yazi guncellenemedi (${id})`)).data;
}

export async function patchPostRaw(token: string, id: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/${id}`, { method: "PATCH", headers: jsonHeaders(token), body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export async function getAdminPost(token: string, id: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/${id}`, { headers: bearer(token) });
  return (await expectOk<{ data: Record<string, unknown> }>(res, `yazi okunamadi (${id})`)).data;
}

/** Hekim kuyrugundan onay (doktor Bearer'i). */
export async function doctorApprove(doctorToken: string, postId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/doctor/blog-reviews/${postId}/approve`, { method: "POST", headers: bearer(doctorToken) });
  await expectOk(res, `hekim onayi basarisiz (${postId})`, [200, 201, 204]);
}

export async function deletePostPermanently(token: string, id: string): Promise<void> {
  for (const url of [`${API_BASE_URL}/admin/blog/${id}`, `${API_BASE_URL}/admin/blog/${id}/permanent`]) {
    const res = await fetch(url, { method: "DELETE", headers: bearer(token) });
    if (![200, 204, 404].includes(res.status)) throw new Error(`yazi silinemedi (${id}): ${res.status} ${await res.text().catch(() => "")}`);
  }
}

/** Herkese acik liste (dil basina) — beklenen sayilari UI'den bagimsiz dogrulamak icin. */
export async function publicPosts(locale: string, query: Record<string, string> = {}): Promise<{ total: number; items: { slug: string; title: string; reviewer: { name: string } | null }[] }> {
  const qs = new URLSearchParams({ locale, pageSize: "50", ...query });
  const res = await fetch(`${API_BASE_URL}/blog/posts?${qs}`);
  return (await expectOk<{ data: { total: number; items: { slug: string; title: string; reviewer: { name: string } | null }[] } }>(res, "herkese acik liste")).data;
}

export async function publicPostDetail(locale: string, slug: string): Promise<{ reviewer: { name: string } | null; lastReviewedAt: string | null } | null> {
  const res = await fetch(`${API_BASE_URL}/blog/posts/${encodeURIComponent(slug)}?locale=${locale}`);
  if (res.status === 404) return null;
  return (await expectOk<{ data: { reviewer: { name: string } | null; lastReviewedAt: string | null } }>(res, "herkese acik detay")).data;
}

export async function listActivePackagesCount(): Promise<number> {
  const res = await fetch(`${API_BASE_URL}/packages?locale=en`);
  if (!res.ok) return 0;
  const body = (await res.json()) as { data?: { items?: unknown[] } };
  return body.data?.items?.length ?? 0;
}

/** Kullanici siliniz (best effort) — admin kullanici silme ucu varsa. */
export async function tryDeleteUser(token: string, userId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/admin/users/${userId}`, { method: "DELETE", headers: bearer(token) }).catch(() => undefined);
}
