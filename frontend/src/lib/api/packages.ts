import { apiFetch } from "./client";
import type { PackageDetailData, PackageInquiryBody, PackageInquiryResult } from "./types";

/** Paket X — istemci tarafı: panel ayrıntı sheet'i ve "Plan my package" talebi. */
export function getPackage(slug: string, locale: string): Promise<PackageDetailData> {
  return apiFetch<PackageDetailData>(`/packages/${encodeURIComponent(slug)}`, { query: { locale } });
}

/** `stored=false`: iletişim izni yok → hiçbir şey kaydedilmedi. Kişisel veri YALNIZCA iletişim izniyle gönderilir. */
export function submitPackageInquiry(slug: string, body: PackageInquiryBody): Promise<PackageInquiryResult> {
  return apiFetch<PackageInquiryResult>(`/packages/${encodeURIComponent(slug)}/inquiries`, { method: "POST", body });
}

/**
 * Anonim görüntülenme sayacı (kullanıcı kararı 2026-11-01): paket/destinasyon ziyaretleri CRM'de kişi bazında
 * kaydedilmez; yalnızca kimliksiz günlük toplam artar. Hata sessizce yutulur.
 */
export function reportPackageView(kind: "list" | "package" | "destinations", slug?: string): void {
  apiFetch<void>("/packages/views", { method: "POST", body: slug ? { kind, slug } : { kind } }).catch(() => {});
}
