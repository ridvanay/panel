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
 * Giriş sonrası yönlendirme hedefi — KESİN öncelik sırasıyla:
 * 1. `next` güvenli bir site-içi yol ise onu döner (kullanıcının geldiği sayfaya dönüş).
 * 2. Doktor hesabı VE `telehealth` modülü açıksa `/doctor` (doktor portalı).
 * 3. Aksi hâlde `/dashboard` (mevcut varsayılan davranış, DEĞİŞMEZ).
 */
export function resolvePostLoginPath(input: ResolvePostLoginDestinationInput): string {
  if (isSafeInternalPath(input.next)) return input.next;
  if (input.doctorProfileId !== null && input.telehealthEnabled) return "/doctor";
  return "/dashboard";
}
