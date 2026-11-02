import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";

/**
 * Paket AG İş 3 — `/{lang}/meet/*` (harici görüntülü toplantı: ev sahibi odası + misafir girişi). Randevu odası gibi
 * `telehealth` modülüne bağlıdır; kapalıysa 404. Misafir bağlantısı belirteci URL PARÇASINDA (`#mg_…`) taşındığından sunucu
 * onu hiç görmez. Sayfalar `noindex, nofollow` ve `Referrer-Policy: no-referrer` (meta) ile işaretlenir.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function MeetLayout({ children }: { children: ReactNode }) {
  const enabled = await isModuleEnabledServer("telehealth");
  if (!enabled) notFound();
  return <>{children}</>;
}
