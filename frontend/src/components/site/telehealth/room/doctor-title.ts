/**
 * Paket AF (kullanıcı kararı) — doktor unvanı izleyicinin dilinde. Kaynak: doktor profilindeki mevcut dil bazlı
 * unvan çevirileri (`translations.<dil>.title`), randevu yanıtında `doctor.titleTranslations` olarak gelir.
 * Sıra: tam dil kodu ("sr-latn") → ana dil ("sr") → mevcut unvan. Yeni tablo/alan yok.
 */
export function localizedDoctorTitle(doctor: { title?: string | null; titleTranslations?: Record<string, string> | null } | null | undefined, lang: string): string {
  if (!doctor) return "";
  const map = doctor.titleTranslations ?? {};
  const code = (lang || "").toLowerCase();
  const picked = map[code] ?? map[code.split("-")[0] ?? ""];
  return (picked?.trim() || doctor.title || "").trim();
}
