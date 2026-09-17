import { isSafeInternalPath } from "@/lib/safe-redirect";
import type { SiteRole } from "@/lib/api/types";

/** `admin-shell.tsx::ROLES_PANEL` İLE AYNI küme — panel erişimi olan roller. Buradan `admin-shell.tsx`'i
 * (bir bileşen dosyası) import ETMEMEK için (döngüsel import riskinden kaçınmak amacıyla `lib/` →
 * `components/` yönünde bağımlılık kurulmaz, tersi güvenlidir) KASITLI olarak burada KENDİ küçük
 * kopyası tanımlanır — iki dosya da §10.21 §7.4'teki backend `requirePanelAccess()` kümesiyle AYNI
 * kalmalıdır, değiştirilirse İKİSİ BİRDEN güncellenmelidir. */
const ROLES_PANEL = new Set<SiteRole>(["ADMIN", "MANAGER", "EDITOR"]);

export interface ResolvePostLoginDestinationInput {
  /** `?next=` sorgu parametresi — güvenli değilse (bkz. `isSafeInternalPath`) yoksayılır. */
  next: string | null;
  /** `User.doctorProfileId` — `null` = bu hesap bir doktor profiline bağlı değil. */
  doctorProfileId: string | null;
  /** `telehealth` modülünün açık olup olmadığı — SADECE doktor kullanıcılar için sorgulanır (bkz. çağıran taraf). */
  telehealthEnabled: boolean;
  /** `User.role` — doktor dalı geçerli değilse panel (`ADMIN`/`MANAGER`/`EDITOR`) ile hasta/müşteri
   * (`CUSTOMER`/`USER`) hedefleri arasında ayrım yapmak için kullanılır. */
  role: SiteRole;
}

/**
 * `/doctor` veya `/doctor/...` — `doctor-portal-route-guard.tsx`'teki path kontrolüyle AYNI
 * örüntü. Dışa aktarılır: `login/page.tsx::goToDestination`'ın "telehealth modülünü SADECE
 * gerektiğinde sorgula" optimizasyonu da AYNI kontrolü kullanır (bkz. o dosyadaki yorum).
 */
export function isDoctorPortalPath(path: string): boolean {
  return path === "/doctor" || path.startsWith("/doctor/");
}

/** `isDoctorPortalPath` İLE BİREBİR AYNI desen, `/admin` panel yolları için. */
export function isAdminPortalPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/");
}

/** `/dashboard` veya `/dashboard/...` — bu sayfa artık post-login hedefi olarak EMEKLİYE AYRILDI
 * (bkz. `app/dashboard/layout.tsx`); `next` bilerek buraya işaret etse bile YOK SAYILIR. */
function isDashboardPath(path: string): boolean {
  return path === "/dashboard" || path.startsWith("/dashboard/");
}

/** CUSTOMER/USER (hasta/müşteri) için varsayılan iniş sayfası. */
const PATIENT_DEFAULT_PATH = "/patient/appointments";

/**
 * Giriş sonrası yönlendirme hedefi — KESİN öncelik sırasıyla:
 * 1. Doktor hesabı VE `telehealth` modülü açıksa: `next` güvenli VE zaten `/doctor` altında ise
 *    onu kullan, AKSİ HÂLDE `/doctor`'a git (bkz. `doctor-portal-route-guard.tsx` — doktor
 *    hesapları `/doctor/**` DIŞINDA bir sayfada gezinemez, giriş anında bu kuralla ÇELİŞMEMELİ).
 * 2. Panel rolü (`ADMIN`/`MANAGER`/`EDITOR`): `next` güvenli VE zaten `/admin` altında ise onu
 *    kullan, AKSİ HÂLDE `/admin`'e git (`admin-shell.tsx::ROLES_PANEL` ile AYNI küme).
 * 3. Aksi hâlde (CUSTOMER/USER — hasta/müşteri): `next` güvenli VE `/dashboard` altında DEĞİLSE
 *    onu kullan (ör. checkout/ürün sayfasına dönüş), aksi hâlde (yok/güvensiz/`/dashboard` altında)
 *    `/patient/appointments`'a git. `/dashboard` artık HİÇBİR dalda hedef DEĞİLDİR — o sayfa
 *    post-login iniş noktası olarak emekliye ayrıldı (bkz. `app/dashboard/layout.tsx`).
 */
export function resolvePostLoginPath(input: ResolvePostLoginDestinationInput): string {
  if (input.doctorProfileId !== null && input.telehealthEnabled) {
    if (isSafeInternalPath(input.next) && isDoctorPortalPath(input.next)) return input.next;
    return "/doctor";
  }

  if (ROLES_PANEL.has(input.role)) {
    if (isSafeInternalPath(input.next) && isAdminPortalPath(input.next)) return input.next;
    return "/admin";
  }

  if (isSafeInternalPath(input.next) && !isDashboardPath(input.next)) return input.next;
  return PATIENT_DEFAULT_PATH;
}
