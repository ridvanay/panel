import type { SiteRole } from "@prisma/client";
import { ROLES_PANEL } from "./site-roles";

/**
 * Paket AG (İş 3) — "harici toplantı oluşturabilir" yetkisinin TEK türetme noktası (`canUseAdvancedBuilder` deseni).
 * Saf/senkron; DB'ye erişmez. Mapper (`canHostMeetings`), admin yetki ucu ve `/meetings/*` ev sahibi kapısı bunu kullanır.
 *
 * Uygunluk: panel rolleri (ADMIN/MANAGER/EDITOR) VEYA bir `DoctorProfile`'a bağlı kullanıcı.
 * CUSTOMER, USER (doktor değilse) ve INTERPRETER için yetki verilemez.
 */
export interface MeetingHostSubject {
  role: SiteRole;
  meetingHostGrantedAt: Date | null;
  doctorProfile?: { id: string } | null;
}

export function isMeetingHostEligible(user: { role: SiteRole; doctorProfile?: { id: string } | null }): boolean {
  return (ROLES_PANEL as readonly SiteRole[]).includes(user.role) || Boolean(user.doctorProfile);
}

/** ADMIN her zaman yetkilidir; diğerleri için yetki zaman damgası VE uygunluk gerekir (rolü düşürülmüş kullanıcıda yetki işlemez). */
export function canHostMeetings(user: MeetingHostSubject): boolean {
  if (user.role === "ADMIN") return true;
  return user.meetingHostGrantedAt !== null && isMeetingHostEligible(user);
}
