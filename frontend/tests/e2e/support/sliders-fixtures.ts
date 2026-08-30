/**
 * qa-agent — Gelişmiş Slider / Hero Studio (`/admin/sliders*`) E2E fixture yardımcıları.
 * `support/api.ts`/`support/blog-fixtures.ts` ile AYNI desen: doğrudan `fetch` ile gerçek
 * backend'e (saas_e2e) konuşur, UI akışına bağımlı olmayan kurulum/temizlik sağlar.
 *
 * Kaynak kontrat: `.claude/architect-scope-advanced-slider.md` §3-4 + `docs/architecture/
 * openapi.yaml` `Sliders` tag'i. `admin-slider-studio.spec.ts`/`advanced-slider-public.spec.ts`
 * tarafından kullanılır.
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

export interface AdminSlide {
  id: string;
  sliderId?: string;
  order: number;
  isActive: boolean;
  label: string | null;
  bgType: string;
  layers: Array<Record<string, unknown>>;
  durationMs: number | null;
  [key: string]: unknown;
}

export interface AdminSlider {
  id: string;
  name: string;
  slug: string;
  deletedAt: string | null;
  slides: AdminSlide[];
  [key: string]: unknown;
}

export interface RawApiResult<T> {
  status: number;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

/** `POST /admin/sliders` — testin ihtiyaç duyduğu minimal alanlarla bir `Slider` oluşturur. */
export async function createSlider(token: string, input: { name: string; slug?: string }): Promise<AdminSlider> {
  const res = await fetch(`${API_BASE_URL}/admin/sliders`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  return json<{ data: AdminSlider }>(res).then((b) => b.data);
}

export async function getSlider(token: string, sliderId: string): Promise<AdminSlider> {
  const res = await fetch(`${API_BASE_URL}/admin/sliders/${sliderId}`, { headers: authHeadersNoBody(token) });
  return json<{ data: AdminSlider }>(res).then((b) => b.data);
}

export async function updateSlider(token: string, sliderId: string, patch: Record<string, unknown>): Promise<AdminSlider> {
  const res = await fetch(`${API_BASE_URL}/admin/sliders/${sliderId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  return json<{ data: AdminSlider }>(res).then((b) => b.data);
}

/** Ham durum kodunu FIRLATMADAN döner — 403/409 iddiaları için (`patchPageDirect` deseni). */
export async function updateSliderRaw(token: string, sliderId: string, patch: Record<string, unknown>): Promise<RawApiResult<AdminSlider>> {
  const res = await fetch(`${API_BASE_URL}/admin/sliders/${sliderId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  const body = (await res.json()) as { data?: AdminSlider; error?: { code: string; message: string; details?: unknown } };
  return { status: res.status, data: body.data, error: body.error };
}

/** Ham durum kodunu FIRLATMADAN döner — 403 iddiaları için. */
export async function createSliderRaw(token: string, input: { name: string; slug?: string }): Promise<RawApiResult<AdminSlider>> {
  const res = await fetch(`${API_BASE_URL}/admin/sliders`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as { data?: AdminSlider; error?: { code: string; message: string; details?: unknown } };
  return { status: res.status, data: body.data, error: body.error };
}

/** Soft-delete (çöpe taşı) — kullanımda ise `force` olmadan `409` döner (`SliderInUseError`). */
export async function deleteSliderRaw(token: string, sliderId: string, force = false): Promise<RawApiResult<void>> {
  const url = new URL(`${API_BASE_URL}/admin/sliders/${sliderId}`);
  if (force) url.searchParams.set("force", "true");
  const res = await fetch(url, { method: "DELETE", headers: authHeadersNoBody(token) });
  if (res.status === 204) return { status: 204 };
  const body = (await res.json()) as { error?: { code: string; message: string; details?: unknown } };
  return { status: res.status, error: body.error };
}

export async function permanentDeleteSlider(token: string, sliderId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/admin/sliders/${sliderId}`, { method: "DELETE", headers: authHeadersNoBody(token) });
  await fetch(`${API_BASE_URL}/admin/sliders/${sliderId}/permanent`, { method: "DELETE", headers: authHeadersNoBody(token) });
}

/** Test sonu temizliği — zaten çöpte olsa da (idempotent) `force` ile geçip kalıcı siler. */
export async function cleanupSlider(token: string, sliderId: string): Promise<void> {
  await deleteSliderRaw(token, sliderId, true).catch(() => undefined);
  await fetch(`${API_BASE_URL}/admin/sliders/${sliderId}/permanent`, { method: "DELETE", headers: authHeadersNoBody(token) }).catch(
    () => undefined
  );
}

export async function duplicateSlider(token: string, sliderId: string): Promise<AdminSlider> {
  const res = await fetch(`${API_BASE_URL}/admin/sliders/${sliderId}/duplicate`, {
    method: "POST",
    headers: authHeadersNoBody(token),
  });
  return json<{ data: AdminSlider }>(res).then((b) => b.data);
}

export interface SliderUsageEntry {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  blockId: string;
  isHomePage: boolean;
  pageDeletedAt: string | null;
  /** §9.2.7 architect eklentisi — `advanced-slider` bloğu ("block") mi yoksa bir `text`/
   *  `custom-html` bloğu içindeki `[slider id="…"]` kısa kodu ("shortcode") mu referans verdiği. */
  usageType: "block" | "shortcode";
}

export async function getSliderUsage(token: string, sliderId: string): Promise<SliderUsageEntry[]> {
  const res = await fetch(`${API_BASE_URL}/admin/sliders/${sliderId}/usage`, { headers: authHeadersNoBody(token) });
  return json<{ data: SliderUsageEntry[] }>(res).then((b) => b.data);
}

export async function createSlide(token: string, sliderId: string, input: Record<string, unknown> = {}): Promise<AdminSlide> {
  const res = await fetch(`${API_BASE_URL}/admin/sliders/${sliderId}/slides`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  return json<{ data: AdminSlide }>(res).then((b) => b.data);
}

export async function updateSlide(token: string, sliderId: string, slideId: string, patch: Record<string, unknown>): Promise<AdminSlide> {
  const res = await fetch(`${API_BASE_URL}/admin/sliders/${sliderId}/slides/${slideId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  return json<{ data: AdminSlide }>(res).then((b) => b.data);
}

export async function reorderSlides(token: string, sliderId: string, slideIds: string[]): Promise<AdminSlide[]> {
  const res = await fetch(`${API_BASE_URL}/admin/sliders/${sliderId}/slides/order`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ slideIds }),
  });
  return json<{ data: AdminSlide[] }>(res).then((b) => b.data);
}

/**
 * §9.2.1 architect eklentisi — kanonik kısa kod biçiminin TEST tarafındaki tek üretim noktası.
 * Kaynak doğrulama `frontend/src/lib/sliders/shortcode.ts::buildSliderShortcode`'dur (frontend
 * birim testleri o dosyayı doğrudan import eder); e2e testleri modül çözümleme/`@/` takma ad
 * karmaşasından kaçınmak için burada BİREBİR AYNI biçimi (`[slider id="<uuid>"]`) yeniden üretir
 * — biçim değişirse İKİ yer (kaynak + burası) birlikte güncellenmelidir.
 */
export function buildSliderShortcode(id: string): string {
  return `[slider id="${id}"]`;
}
