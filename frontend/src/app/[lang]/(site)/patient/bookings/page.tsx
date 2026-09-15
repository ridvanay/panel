import { permanentRedirect } from "next/navigation";
import { localizePathServer } from "@/lib/api/server-locales";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.8.3 KARAR N — bu rota `/{lang}/patient/appointments`e
 * KALICI YÖNLENDİRİLİR (308, gövde `appointments/page.tsx`e TAŞINDI — `siparislerim/page.tsx` İLE
 * AYNI desen). `/{lang}/patient/bookings/{bookingId}` (ve `.../invoice`) BU KURALIN DIŞINDADIR ve
 * TAŞINMAZ — bkz. o rotaların kendi dosyaları, backend'de ÜRETİLMİŞ URL'lerin (Stripe dönüşü,
 * magic-link e-postası) hedefidir.
 */
export default async function LegacyPatientBookingsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  permanentRedirect(await localizePathServer(lang, "/patient/appointments"));
}
