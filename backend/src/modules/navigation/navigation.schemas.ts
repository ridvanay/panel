import { z } from "zod";
import { SocialPlatform } from "@prisma/client";

// Not: `\/(?!\/|\\)` yalnızca TEK bir "/" ile başlayan gerçek göreli yollara izin verir.
// Bare "/" whitelisti "//evil.com" (protokol-relative URL) veya "/\evil.com" (tarayıcılar
// WHATWG URL spesine göre "\" karakterini "/" gibi normalize eder) gibi girdilerin göreli
// yol sanılıp kabul edilmesine ve tarayıcının bunu mutlak (harici) bir yönlendirme olarak
// yorumlamasına (open-redirect/phishing) yol açardı — bu yüzden ikinci karakterin "/" veya
// "\" olması reddedilir.
const HrefSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(
    /^(https?:\/\/|\/(?!\/|\\)|#)/,
    "Geçersiz bağlantı: yalnızca http(s)://, / (protokol-relative olmayan) veya # ile başlayan yollar kabul edilir"
  );

export const NavigationItemInputSchema = z.object({
  // İstemcinin `crypto.randomUUID()` ile ürettiği id — opsiyonel (verilmezse sunucu üretir),
  // ancak başka bir öğenin `parentId`'si tarafından işaret edilen öğede fiilen zorunludur
  // (bkz. UpdateNavigationConfigRequestSchema.superRefine). Bkz. ARCHITECTURE.md §10.10.2.
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(80),
  href: HrefSchema,
  // Kardeş-kapsamlı sıra: aynı `parentId` grubu içinde 0'dan artan, global bir indeks DEĞİL.
  order: z.number().int().min(0),
  // Üst öğenin `id`'si; yok/null ise kök seviye öğe. Maksimum derinlik 2 — bkz. superRefine.
  parentId: z.string().uuid().nullable().optional(),
});

export const SocialLinkInputSchema = z.object({
  platform: z.nativeEnum(SocialPlatform),
  url: HrefSchema,
  order: z.number().int().min(0),
});

export const FooterLinkInputSchema = z.object({
  label: z.string().min(1).max(80),
  href: HrefSchema,
  order: z.number().int().min(0),
});

export const FooterColumnInputSchema = z.object({
  title: z.string().min(1).max(80),
  order: z.number().int().min(0),
  links: z.array(FooterLinkInputSchema).max(20),
});

/**
 * `navigationItems` dizi bütününe bakan çapraz-alan kuralları — bkz. ARCHITECTURE.md
 * §10.10.3. Tekil öğe şemasında (`NavigationItemInputSchema`) ifade edilemez çünkü her
 * kural birden fazla öğeyi birlikte gözetiyor: (1) payload içi `id` benzersizliği,
 * (2) `parentId` payload İÇİNDE çözülebilir olmalı (DB'deki eski bir id'ye referans
 * GEÇERSİZ — kayıt tam-replace'tir), (3) işaret edilen öğenin kendi `parentId`'si null
 * olmalı (maksimum derinlik 2), (4) kendine referans yasak.
 */
const NavigationItemsArraySchema = z
  .array(NavigationItemInputSchema)
  .max(20)
  .superRefine((items, ctx) => {
    // (1) Payload içi id benzersizliği.
    const idCounts = new Map<string, number>();
    items.forEach((item) => {
      if (item.id) idCounts.set(item.id, (idCounts.get(item.id) ?? 0) + 1);
    });
    items.forEach((item, index) => {
      if (item.id && (idCounts.get(item.id) ?? 0) > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Tekrarlanan id: '${item.id}' payload içinde birden fazla öğede kullanılıyor.`,
          path: [index, "id"],
        });
      }
    });

    const byId = new Map<string, (typeof items)[number]>();
    items.forEach((item) => {
      if (item.id) byId.set(item.id, item);
    });

    items.forEach((item, index) => {
      if (item.parentId == null) return; // kök öğe — aşağıdaki kurallar uygulanmaz.

      // (4) Kendine referans yasak.
      if (item.id != null && item.parentId === item.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Bir öğe kendi id'sini parentId olarak veremez (kendine referans).",
          path: [index, "parentId"],
        });
        return;
      }

      // (2) parentId payload içinde çözülebilir olmalı.
      const parent = byId.get(item.parentId);
      if (!parent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `parentId '${item.parentId}' payload içindeki hiçbir öğenin id'siyle eşleşmiyor.`,
          path: [index, "parentId"],
        });
        return;
      }

      // (3) Maksimum derinlik 2: işaret edilen öğe kendisi bir alt öğe olamaz.
      if (parent.parentId != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Maksimum derinlik 2: parentId yalnızca parentId'si null olan (kök) bir öğeyi işaret edebilir.",
          path: [index, "parentId"],
        });
      }
    });
  });

export const UpdateNavigationConfigRequestSchema = z.object({
  headerCtaLabel: z.string().max(60).nullable().optional(),
  headerCtaHref: HrefSchema.nullable().optional(),
  footerCopyrightText: z.string().max(200).nullable().optional(),
  navigationItems: NavigationItemsArraySchema,
  socialLinks: z.array(SocialLinkInputSchema).max(15),
  footerColumns: z.array(FooterColumnInputSchema).max(8),
});
