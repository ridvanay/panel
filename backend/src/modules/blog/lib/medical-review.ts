import type { FastifyInstance } from "fastify";
import type { PageStatus, SiteRole } from "@prisma/client";
import { ForbiddenError, ValidationError } from "../../../lib/errors";
import { PUBLIC_DOCTOR_WHERE } from "../../telehealth/lib/archive-filters";

/**
 * Paket Z1 — blog tıbbi inceleme kuralları (TEK YER). Admin create/update, toplu yayın, autosave,
 * revizyon geri yükleme ve zamanlanmış yayın sweeper'ı buradaki fonksiyonları kullanır.
 */

export const READING_WORDS_PER_MINUTE = 200;

/** HTML'den metin çıkarır, 200 kelime/dk ile süre hesaplar (en az 1 dakika). */
export function computeReadingMinutes(html: string | null | undefined): number {
  if (!html) return 1;
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ");
  const words = text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  return Math.max(1, Math.ceil(words / READING_WORDS_PER_MINUTE));
}

export interface ReviewState {
  medicalReviewStatus: string | null;
  reviewerDoctorId: string | null;
}

/** `null` durum eski kayıtlarda "pending" sayılır. */
export function normalizeReviewStatus(status: string | null | undefined): string {
  return status ?? "pending";
}

/**
 * Yayın kuralı (saf fonksiyon): approved + reviewer dolu, YA DA not_required + kategori tıbbi değil.
 * Kategori yoksa (null) tıbbi sayılır (güvenli taraf).
 */
export function isReviewSatisfied(state: ReviewState, category: { isMedical: boolean } | null): boolean {
  if (state.medicalReviewStatus === "approved") return Boolean(state.reviewerDoctorId);
  if (state.medicalReviewStatus === "not_required") return category !== null && category.isMedical === false;
  return false;
}

const LIVE_STATUSES: PageStatus[] = ["PUBLISHED", "SCHEDULED"];

export interface ReviewRuleInput {
  /** İşlem sonrası geçerli olacak değerler. */
  effective: {
    status: PageStatus;
    medicalReviewStatus: string | null;
    reviewerDoctorId: string | null;
    categoryId: string | null;
  };
  /** Yeni kayıtta null. */
  previousStatus: PageStatus | null;
  /** Bu istek `medicalReviewStatus`'u "not_required" olarak YAZIYOR mu? (rol kontrolü yalnızca o zaman) */
  settingNotRequired: boolean;
  /** Bu istek not_required/kategori ilişkisini değiştiriyor mu? (tıbbi kategori kontrolü yalnızca o zaman) */
  touchesReviewOrCategory: boolean;
  actorRole: SiteRole;
}

/**
 * 1) `not_required` yalnızca ADMIN yazabilir (403) ve kategori tıbbi değilse (422).
 * 2) DRAFT→PUBLISHED/SCHEDULED (veya SCHEDULED→PUBLISHED) durum GEÇİŞİNDE inceleme koşulu aranır (422).
 *    Mevcut PUBLISHED kayıtlar geriye dönük düşürülmez; kural yalnızca geçişte çalışır.
 */
export async function assertBlogReviewRules(app: FastifyInstance, input: ReviewRuleInput): Promise<void> {
  const { effective, previousStatus } = input;
  const category = effective.categoryId
    ? await app.prisma.blogCategory.findUnique({ where: { id: effective.categoryId }, select: { isMedical: true } })
    : null;

  if (effective.medicalReviewStatus === "not_required") {
    if (input.settingNotRequired && input.actorRole !== "ADMIN") {
      throw new ForbiddenError("\"Hekim onayı gerekmez\" yalnızca yönetici tarafından seçilebilir.");
    }
    if ((input.settingNotRequired || input.touchesReviewOrCategory) && !(category && category.isMedical === false)) {
      throw new ValidationError("Hekim onayı gerekmez seçeneği yalnızca tıbbi olmayan bir kategoride kullanılabilir.", {
        medicalReviewStatus: ["Tıbbi kategoride (veya kategorisiz yazıda) hekim onayı zorunludur."],
      });
    }
  }

  const transitioning = LIVE_STATUSES.includes(effective.status) && previousStatus !== effective.status;
  if (transitioning && !isReviewSatisfied(effective, category)) {
    throw new ValidationError("Yazı hekim onayı olmadan yayınlanamaz veya zamanlanamaz.", {
      medicalReviewStatus: [
        "Yayın için tıbbi inceleme durumu \"approved\" ve gözden geçiren hekim dolu olmalı (ya da tıbbi olmayan kategoride \"not_required\").",
      ],
    });
  }
}

/** Atanacak hekim aktif ve arşivli olmayan bir profil olmalı. */
export async function assertReviewerAssignable(app: FastifyInstance, reviewerDoctorId: string | null | undefined): Promise<void> {
  if (!reviewerDoctorId) return;
  const doctor = await app.prisma.doctorProfile.findFirst({ where: { id: reviewerDoctorId, ...PUBLIC_DOCTOR_WHERE }, select: { id: true } });
  if (!doctor) {
    throw new ValidationError("Gözden geçiren hekim bulunamadı veya aktif değil.", { reviewerDoctorId: ["Geçersiz hekim."] });
  }
}

export async function assertSpecialtyAndTopics(
  app: FastifyInstance,
  specialtyId: string | null | undefined,
  careTopicIds: string[] | undefined
): Promise<void> {
  if (specialtyId) {
    const specialty = await app.prisma.specialty.findUnique({ where: { id: specialtyId }, select: { id: true } });
    if (!specialty) throw new ValidationError("Uzmanlık bulunamadı.", { specialtyId: ["Geçersiz uzmanlık."] });
  }
  if (careTopicIds && careTopicIds.length > 0) {
    const unique = Array.from(new Set(careTopicIds));
    const found = await app.prisma.careTopic.findMany({ where: { id: { in: unique } }, select: { id: true } });
    if (found.length !== unique.length) {
      throw new ValidationError("Geçersiz konu (care topic) id'leri.", { careTopicIds: ["Bilinmeyen konu."] });
    }
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export interface ReviewedContent {
  title: string;
  contentHtml: string;
  keyTakeaways: unknown;
  faq: unknown;
  references: unknown;
  reviewerDoctorId: string | null;
}

/**
 * Onaylı (approved) yazıda içerik ya da gözden geçiren değişirse durum "pending"e döner (yeniden onay
 * gerekir). `lastReviewedAt` KORUNUR; yayındaki yazı yayında kalır. Çeviriler (translations) hekim onayından
 * SONRA üretildiği için bu kontrole DAHİL DEĞİLDİR.
 */
export function reviewedContentChanged(before: ReviewedContent, after: ReviewedContent): boolean {
  return (
    before.title !== after.title ||
    before.contentHtml !== after.contentHtml ||
    before.reviewerDoctorId !== after.reviewerDoctorId ||
    !jsonEqual(before.keyTakeaways, after.keyTakeaways) ||
    !jsonEqual(before.faq, after.faq) ||
    !jsonEqual(before.references, after.references)
  );
}

/** Onaylı yazıda inceleme kapsamındaki içerik değiştiyse veri yaması döner (aksi halde boş nesne). */
export function demotionPatch(
  existing: ReviewedContent & { medicalReviewStatus: string | null },
  next: ReviewedContent
): { medicalReviewStatus?: "pending" } {
  if (existing.medicalReviewStatus === "approved" && reviewedContentChanged(existing, next)) {
    return { medicalReviewStatus: "pending" };
  }
  return {};
}
