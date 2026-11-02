import type { ServicesStrings } from "@/lib/i18n/site-dictionaries/types";

/**
 * Paket AI — hizmet (uzmanlık) grupları. Anahtarlar backend'deki izinli listeyle aynıdır; grup SIRASI ve
 * grup ADLARI kodda (sözlük) tutulur. Anahtarı olmayan/bilinmeyen uzmanlıklar "other" grubuna düşer.
 */
export const SERVICE_GROUP_KEYS = ["surgery-oncology", "digestive-interventional", "aesthetic-dental-hair", "fertility"] as const;
export type ServiceGroupKey = (typeof SERVICE_GROUP_KEYS)[number];
export type ServiceGroupId = ServiceGroupKey | "other";

/** Sabit grup sırası; "other" her zaman sonda. */
export const SERVICE_GROUP_ORDER: readonly ServiceGroupId[] = [...SERVICE_GROUP_KEYS, "other"];

const GROUP_TITLE_KEY: Record<ServiceGroupId, keyof ServicesStrings> = {
  "surgery-oncology": "groupSurgeryOncology",
  "digestive-interventional": "groupDigestiveInterventional",
  "aesthetic-dental-hair": "groupAestheticDentalHair",
  fertility: "groupFertility",
  other: "groupOther",
};

export function serviceGroupTitle(id: ServiceGroupId, strings: ServicesStrings): string {
  return strings[GROUP_TITLE_KEY[id]];
}

export function resolveServiceGroup(serviceGroup: string | null | undefined): ServiceGroupId {
  return (SERVICE_GROUP_KEYS as readonly string[]).includes(serviceGroup ?? "") ? (serviceGroup as ServiceGroupKey) : "other";
}

export interface GroupableService {
  slug: string;
  serviceGroup?: string | null;
  parentSlug?: string | null;
}

export type ServiceWithChildren<T extends GroupableService> = T & { children: T[] };
export interface ServiceGroup<T extends GroupableService> {
  id: ServiceGroupId;
  items: ServiceWithChildren<T>[];
}

/**
 * Hizmetleri gruplara böler. Alt uzmanlıklar (üst uzmanlığı listede olanlar) üst öğenin `children` çipi olur
 * ve grubunu üstten miras alır; üst uzmanlığı listede olmayan alt uzmanlık kendi başına öğe kalır. Boş grup
 * döndürülmez. Grup içi sıra giriş sırasıdır (API `order` ile sıralı verir).
 */
export function groupServices<T extends GroupableService>(services: T[]): ServiceGroup<T>[] {
  const slugs = new Set(services.map((s) => s.slug));
  const childrenOf = new Map<string, T[]>();
  const tops: T[] = [];
  for (const service of services) {
    if (service.parentSlug && slugs.has(service.parentSlug)) {
      const list = childrenOf.get(service.parentSlug) ?? [];
      list.push(service);
      childrenOf.set(service.parentSlug, list);
    } else {
      tops.push(service);
    }
  }
  const buckets = new Map<ServiceGroupId, ServiceWithChildren<T>[]>();
  for (const top of tops) {
    const id = resolveServiceGroup(top.serviceGroup);
    const bucket = buckets.get(id) ?? [];
    bucket.push({ ...top, children: childrenOf.get(top.slug) ?? [] });
    buckets.set(id, bucket);
  }
  return SERVICE_GROUP_ORDER.flatMap((id) => {
    const items = buckets.get(id);
    return items && items.length > 0 ? [{ id, items }] : [];
  });
}
