import { permanentRedirect } from "next/navigation";
import { fetchDoctorBySlugServer, fetchSpecialtyBySlugServer } from "@/lib/api/server-telehealth";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { withLocalePrefix } from "@/lib/i18n/site-path";

/**
 * Paket AH — hekim profili ziyaretçiye kapalı. Hekimin birincil uzmanlığı aktifse
 * `/specialties/{uzmanlık}`, değilse `/specialties` adresine kalıcı yönlendirme. Hekim bilgisi
 * yanıta/sayfaya HİÇ yazılmaz; yalnızca uzmanlık slug'ı yönlendirme hedefinde kullanılır.
 */
export default async function PhysicianRedirect({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  const [locales, doctor] = await Promise.all([fetchLocalesServer(), fetchDoctorBySlugServer(slug, lang)]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  let target = withLocalePrefix("/specialties", lang, defaultLocaleCode);
  const specialtySlug = doctor?.specialty?.slug;
  if (specialtySlug) {
    const specialty = await fetchSpecialtyBySlugServer(specialtySlug, lang);
    if (specialty && specialty.isActive !== false) target = withLocalePrefix(`/specialties/${specialty.slug}`, lang, defaultLocaleCode);
  }
  permanentRedirect(target);
}
