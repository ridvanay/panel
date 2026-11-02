import type { Specialty } from "@/lib/api/types";
import type { RequestServiceGroup } from "./request-service-picker";

/** Üst bölümler + alt bölümler (yalnızca aktif olanlar), sıralı. `/request` ve `/book-consultation` ortak kullanır. */
export function buildServiceGroups(specialties: Specialty[]): RequestServiceGroup[] {
  const active = specialties.filter((s) => s.isActive !== false);
  const byOrder = (a: Specialty, b: Specialty) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
  const parents = active.filter((s) => s.parentId == null).sort(byOrder);
  return parents.map((parent) => ({
    slug: parent.slug,
    name: parent.name,
    icon: parent.icon,
    serviceGroup: parent.serviceGroup ?? null,
    children: active
      .filter((s) => s.parentId === parent.id)
      .sort(byOrder)
      .map((child) => ({ slug: child.slug, name: child.name })),
  }));
}
