import type { BlogFaqItem, BlogPost, BlogReference, BlogReviewWriteFields } from "@/lib/api/types";
import { cleanFaq, cleanTakeaways } from "./admin-fields";

/** Paket Z1 (admin) — editör formundaki Z1 alanlarının durumu (yeni + düzenleme ekranları ortak kullanır). */
export interface BlogReviewState {
  specialtyId: string;
  careTopicIds: string[];
  reviewerDoctorId: string;
  /** "" = değiştirme. Yalnızca "pending" | "not_required" yazılabilir ("approved" yalnızca hekim kuyruğundan gelir). */
  statusWrite: "" | "pending" | "not_required";
  isFeatured: boolean;
  keyTakeaways: string[];
  faq: BlogFaqItem[];
  references: BlogReference[];
}

export const EMPTY_REVIEW_STATE: BlogReviewState = {
  specialtyId: "",
  careTopicIds: [],
  reviewerDoctorId: "",
  statusWrite: "",
  isFeatured: false,
  keyTakeaways: [],
  faq: [],
  references: [],
};

/** Eski kayıtlarda/testlerde alanlar eksik olabilir — hepsi güvenli varsayılana düşer. */
export function reviewStateFromPost(post: BlogPost): BlogReviewState {
  return {
    specialtyId: post.specialtyId ?? "",
    careTopicIds: post.careTopicIds ?? [],
    reviewerDoctorId: post.reviewerDoctorId ?? "",
    statusWrite: "",
    isFeatured: post.isFeatured ?? false,
    keyTakeaways: post.keyTakeaways ?? [],
    faq: post.faq ?? [],
    references: post.references ?? [],
  };
}

/** Dirty kontrolü için kararlı anahtar (dizilerin sırası anlamlıdır, careTopicIds hariç: küme). */
export function reviewStateKey(state: BlogReviewState): string {
  return JSON.stringify({ ...state, careTopicIds: [...state.careTopicIds].sort() });
}

export function cleanReferences(list: BlogReference[]): BlogReference[] {
  return list
    .map((r) => ({ title: r.title.trim(), publisher: r.publisher.trim(), url: r.url.trim(), accessedAt: r.accessedAt.trim() }))
    .filter((r) => r.title || r.url);
}

/** Yazma gövdesine eklenecek Z1 alanları. `statusWrite` boşsa `medicalReviewStatus` GÖNDERİLMEZ. */
export function reviewStateToPayload(state: BlogReviewState, baseline: BlogReviewState = EMPTY_REVIEW_STATE): BlogReviewWriteFields {
  return {
    // Değişmeyen uzmanlık/hekim gövdeye HİÇ konmaz: yanlışlıkla null yazıp atanmış hekimi silmek ciddi bir hatadır.
    ...(state.specialtyId !== baseline.specialtyId ? { specialtyId: state.specialtyId || null } : {}),
    careTopicIds: state.careTopicIds,
    ...(state.reviewerDoctorId !== baseline.reviewerDoctorId ? { reviewerDoctorId: state.reviewerDoctorId || null } : {}),
    ...(state.statusWrite ? { medicalReviewStatus: state.statusWrite } : {}),
    isFeatured: state.isFeatured,
    keyTakeaways: cleanTakeaways(state.keyTakeaways),
    faq: cleanFaq(state.faq),
    references: cleanReferences(state.references),
  };
}
