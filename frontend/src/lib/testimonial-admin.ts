import type { AdminTestimonial } from "@/lib/api/testimonials";

/** Yalnızca onaylı (ve anonimleştirilmemiş) yorum anasayfada öne çıkarılabilir. */
export function canFeatureOnHome(t: Pick<AdminTestimonial, "status" | "anonymizedAt">): boolean {
  return t.status === "approved" && !t.anonymizedAt;
}
