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
