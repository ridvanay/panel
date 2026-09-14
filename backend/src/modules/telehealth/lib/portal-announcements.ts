import type { DoctorPortalAnnouncement } from "../../../schemas/entities";

/**
 * `GET /doctor/portal-feed` — "Duyurular" bileşeni. Bu tur (§9.7.7 KARAR K civarı) db-agent
 * devrede DEĞİL, bu yüzden BİLİNÇLİ OLARAK kod-seviyeli/statik bir listedir (yeni bir Prisma
 * modeli/migration AÇILMADI). Admin tarafından dinamik yönetim (oluştur/düzenle/yayından kaldır)
 * gerekirse ileride ayrı bir DB modeli gerekir — bu db-agent'ın kapsamına girer, şimdilik
 * bilinçli bir kapsam kararıdır.
 */
export const DOCTOR_PORTAL_ANNOUNCEMENTS: DoctorPortalAnnouncement[] = [
  {
    id: "announcement-2026-09-01-maintenance",
    title: "Sistem Bakımı",
    body: "Platform, 14 Eylül 2026 gecesi 02:00-04:00 (TSİ) arasında planlı bakım nedeniyle kısa süreliğine erişilemez olabilir.",
    severity: "INFO",
    publishedAt: "2026-09-01T09:00:00.000Z",
  },
  {
    id: "announcement-2026-09-05-sgk-mevzuat",
    title: "Yeni SGK/Konsültasyon Mevzuatı",
    body: "Uzaktan sağlık hizmetlerine ilişkin güncellenen SGK/konsültasyon mevzuatı yürürlüğe girmiştir; lütfen ilgili duyuru metnini inceleyiniz.",
    severity: "IMPORTANT",
    publishedAt: "2026-09-05T08:30:00.000Z",
  },
  {
    id: "announcement-2026-09-10-platform-update",
    title: "Platform Güncellemesi",
    body: "Doktor konsoluna yeni özellikler eklendi: portal akışı besleme alanı ve gelişmiş bildirim görünümü.",
    severity: "SYSTEM",
    publishedAt: "2026-09-10T12:00:00.000Z",
  },
];
