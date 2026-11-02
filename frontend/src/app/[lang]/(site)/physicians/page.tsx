import { permanentRedirect } from "next/navigation";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { withLocalePrefix } from "@/lib/i18n/site-path";

/** Paket AH — hekim listesi ziyaretçiye kapalı: kalıcı yönlendirme → Health Tourism Services (`/specialties`). */
export default async function PhysiciansIndexRedirect({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const locales = await fetchLocalesServer();
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  permanentRedirect(withLocalePrefix("/specialties", lang, defaultLocaleCode));
}
