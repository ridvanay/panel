import crypto from "node:crypto";
import { env } from "../../config/env";
import { toCustomerEmailLocale } from "../../lib/branded-email";
import { hashToken } from "../../lib/tokens";

/**
 * Paket AI (İş 3) — yönetim bağlantısı belirteci `sc_<32 bayt base64url>` (256 bit). DB'de YALNIZCA SHA-256 özeti
 * (`ServiceConsultation.manageTokenHash`); düz belirteç yalnızca e-posta bağlantısında bulunur ve log/audit/hata
 * gövdesine ASLA yazılmaz. Bağlantı `/{lang}/book-consultation/manage#sc_…` — belirteç URL PARÇASINDA.
 */
export const MANAGE_TOKEN_REGEX = /^sc_[A-Za-z0-9_-]{43}$/;

export function generateManageToken(): { token: string; hash: string } {
  const token = `sc_${crypto.randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

export function buildManageLink(token: string, locale: string): string {
  return `${env.FRONTEND_URL.replace(/\/$/, "")}/${toCustomerEmailLocale(locale)}/book-consultation/manage#${token}`;
}

/** `SVC-00012` — görüşme numarası (seq 5 hane dolgulu). */
export function formatConsultationNumber(seq: number): string {
  return `SVC-${String(seq).padStart(5, "0")}`;
}
