/**
 * Paket AI - hizmet grubu anahtarlari (`Specialty.serviceGroup`). Grup adlari ve sirasi frontend sozlugundedir;
 * `null` = "Other". Izinli liste API'de zorlanir (DB'de enum degil: yeni grup eklemek migration gerektirmesin).
 */
export const SERVICE_GROUP_KEYS = ["surgery-oncology", "digestive-interventional", "aesthetic-dental-hair", "fertility"] as const;
export type ServiceGroupKey = (typeof SERVICE_GROUP_KEYS)[number];
export const SHORT_DESCRIPTION_MAX = 120;
