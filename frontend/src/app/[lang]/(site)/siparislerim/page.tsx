import { permanentRedirect } from "next/navigation";
import { localizePathServer } from "@/lib/api/server-locales";

/**
 * §customer-portal §4.2 — bu rota SİLİNMEZ, `/hesabim/siparislerim`'e KALICI yönlendirilir
 * (308). Gerekçe: rota canlıdır, bookmark'lanmış olabilir, `ARCHITECTURE.md` §10.21.9 onu
 * resmî bir rota olarak ilan etmiştir — sessizce 404'e düşürmek geriye dönük uyumluluğu kırar.
 * Temizlik takip kalemi: `chore/drop-legacy-siparislerim-route`.
 */
export default async function LegacyMyOrdersPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  permanentRedirect(await localizePathServer(lang, "/hesabim/siparislerim"));
}
