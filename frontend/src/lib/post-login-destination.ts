import { isSafeInternalPath } from "@/lib/safe-redirect";

export interface ResolvePostLoginDestinationInput {
  /** `?next=` sorgu parametresi — güvenli değilse (bkz. `isSafeInternalPath`) yoksayılır. */
  next: string | null;
  /** `User.doctorProfileId` — `null` = bu hesap bir doktor profiline bağlı değil. */
  doctorProfileId: string | null;
  /** `telehealth` modülünün açık olup olmadığı — SADECE doktor kullanıcılar için sorgulanır (bkz. çağıran taraf). */
  telehealthEnabled: boolean;
}

/**
 * `/doctor` veya `/doctor/...` — `doctor-portal-route-guard.tsx`'teki path kontrolüyle AYNI
 * örüntü. Dışa aktarılır: `login/page.tsx::goToDestination`'ın "telehealth modülünü SADECE
 * gerektiğinde sorgula" optimizasyonu da AYNI kontrolü kullanır (bkz. o dosyadaki yorum).
 */
export function isDoctorPortalPath(path: string): boolean {
  return path === "/doctor" || path.startsWith("/doctor/");
}

/**
 * Giriş sonrası yönlendirme hedefi — KESİN öncelik sırasıyla:
 * 1. Doktor hesabı VE `telehealth` modülü açıksa: `next` güvenli VE zaten `/doctor` altında ise
 *    onu kullan, AKSİ HÂLDE `/doctor`'a git (bkz. `doctor-portal-route-guard.tsx` — doktor
 *    hesapları `/doctor/**` DIŞINDA bir sayfada gezinemez, giriş anında bu kuralla ÇELİŞMEMELİ).
 * 2. Doktor hesabı DEĞİLSE (veya `telehealth` kapalıysa): `next` güvenli bir site-içi yol ise onu
 *    döner (kullanıcının geldiği sayfaya dönüş).
 * 3. Aksi hâlde `/dashboard` (mevcut varsayılan davranış, DEĞİŞMEZ).
 */
export function resolvePostLoginPath(input: ResolvePostLoginDestinationInput): string {
  if (input.doctorProfileId !== null && input.telehealthEnabled) {
    if (isSafeInternalPath(input.next) && isDoctorPortalPath(input.next)) return input.next;
    return "/doctor";
  }
  if (isSafeInternalPath(input.next)) return input.next;
  return "/dashboard";
}
