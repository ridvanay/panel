import { apiFetch, apiFetchPage } from "./client";
import type { TrashedFilter } from "./types";
import type {
  CreateSlideRequest,
  CreateSliderRequest,
  ReorderSlidesRequest,
  Slide,
  Slider,
  SliderListMeta,
  SliderSummary,
  SliderUsage,
  UpdateSlideRequest,
  UpdateSliderRequest,
} from "../sliders/types";

export interface ListSlidersParams {
  cursor?: string;
  /** Varsayılan: "exclude" (backend varsayılanı). */
  trashed?: TrashedFilter;
  limit?: number;
  /** `name`/`slug` üzerinde büyük/küçük harf duyarsız arama. */
  search?: string;
}

export interface SliderListResult {
  items: SliderSummary[];
  meta: SliderListMeta;
}

/** `GET /admin/sliders` — `SliderListMeta.counts` (`active`/`trashed`) `ContentCounts`ten FARKLI
 *  bir şekil taşır, bu yüzden `apiFetchPage`in genel `PageMeta` tipini burada yeniden ETİKETLERİZ. */
export async function listSliders(params: ListSlidersParams = {}): Promise<SliderListResult> {
  const page = await apiFetchPage<SliderSummary>("/admin/sliders", {
    query: { cursor: params.cursor, limit: params.limit ?? 100, trashed: params.trashed, search: params.search },
  });
  return { items: page.items, meta: page.meta as unknown as SliderListMeta };
}

export function createSlider(input: CreateSliderRequest) {
  return apiFetch<Slider>("/admin/sliders", { method: "POST", body: input });
}

export function getSlider(sliderId: string) {
  return apiFetch<Slider>(`/admin/sliders/${sliderId}`);
}

export function updateSlider(sliderId: string, input: UpdateSliderRequest) {
  return apiFetch<Slider>(`/admin/sliders/${sliderId}`, { method: "PATCH", body: input });
}

/** Soft-delete (çöpe taşı) + referans koruması — kullanımda ise `force` olmadan `409` döner. */
export function deleteSlider(sliderId: string, force = false) {
  return apiFetch<void>(`/admin/sliders/${sliderId}`, { method: "DELETE", query: force ? { force: true } : undefined });
}

export function restoreSlider(sliderId: string) {
  return apiFetch<Slider>(`/admin/sliders/${sliderId}/restore`, { method: "POST" });
}

export function permanentDeleteSlider(sliderId: string) {
  return apiFetch<void>(`/admin/sliders/${sliderId}/permanent`, { method: "DELETE" });
}

/** DERİN kopya — slaytlar + katmanlar dahil, katman id'leri YENİDEN ÜRETİLİR (sunucu tarafında). */
export function duplicateSlider(sliderId: string) {
  return apiFetch<Slider>(`/admin/sliders/${sliderId}/duplicate`, { method: "POST" });
}

export function getSliderUsage(sliderId: string) {
  return apiFetch<SliderUsage[]>(`/admin/sliders/${sliderId}/usage`);
}

export function createSlide(sliderId: string, input: CreateSlideRequest = {}) {
  return apiFetch<Slide>(`/admin/sliders/${sliderId}/slides`, { method: "POST", body: input });
}

/** `Navigation` PUT'uyla AYNI "tam durum gönder" deseni — bu slider'ın TÜM slayt id'lerini içermeli. */
export function reorderSlides(sliderId: string, input: ReorderSlidesRequest) {
  return apiFetch<Slide[]>(`/admin/sliders/${sliderId}/slides/order`, { method: "PUT", body: input });
}

/** Katman editörünün ANA yazma ucu — `layers` gönderilirse dizi TAMAMEN DEĞİŞTİRİLİR. */
export function updateSlide(sliderId: string, slideId: string, input: UpdateSlideRequest) {
  return apiFetch<Slide>(`/admin/sliders/${sliderId}/slides/${slideId}`, { method: "PATCH", body: input });
}

export function deleteSlide(sliderId: string, slideId: string) {
  return apiFetch<void>(`/admin/sliders/${sliderId}/slides/${slideId}`, { method: "DELETE" });
}

export function duplicateSlide(sliderId: string, slideId: string) {
  return apiFetch<Slide>(`/admin/sliders/${sliderId}/slides/${slideId}/duplicate`, { method: "POST" });
}
