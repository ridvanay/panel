import { z } from "zod";
import { SocialPlatform } from "@prisma/client";
import { NAVIGATION_MAX_DEPTH, NAVIGATION_MAX_ITEMS } from "./navigation.constants";

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
  // Üst öğenin `id`'si; yok/null ise kök seviye öğe. Maksimum derinlik `NAVIGATION_MAX_DEPTH`
  // (0-tabanlı ata sayısı) — bkz. superRefine.
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
 * §10.10.3 / §10.10.3.1. Tekil öğe şemasında (`NavigationItemInputSchema`) ifade
 * edilemez çünkü her kural birden fazla öğeyi birlikte gözetiyor. Sıra BAĞLAYICIDIR —
 * yanlış sırada döngülü bir payload "derinlik aşıldı" hatası alır, doğru mesajı almaz:
 *   (1) payload içi `id` benzersizliği
 *   (2) kendine referans yasağı (item.parentId === item.id)
 *   (3) `parentId` payload İÇİNDE çözülebilir olmalı (DB'deki eski bir id'ye referans
 *       GEÇERSİZ — kayıt tam-replace'tir)
 *   (4) döngü (cycle) tespiti — 3 renkli iteratif DFS, O(n)
 *   (5) derinlik limiti — memoize edilmiş ata sayısı, `NAVIGATION_MAX_DEPTH`'i aşamaz
 */
const NavigationItemsArraySchema = z
  .array(NavigationItemInputSchema)
  .max(NAVIGATION_MAX_ITEMS)
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

    // Cycle/depth geçişleri yalnızca (2) ve (3)'ten TEMİZ geçen düğümler için anlamlıdır —
    // bu Set, ilgili düğümleri sonraki geçişlerden dışlamak için kullanılır.
    const skip = new Set<number>();

    items.forEach((item, index) => {
      if (item.parentId == null) return; // kök öğe — aşağıdaki kurallar uygulanmaz.

      // (2) Kendine referans yasak.
      if (item.id != null && item.parentId === item.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Bir öğe kendi id'sini parentId olarak veremez (kendine referans).",
          path: [index, "parentId"],
        });
        skip.add(index);
        return;
      }

      // (3) parentId payload içinde çözülebilir olmalı.
      if (!byId.has(item.parentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `parentId '${item.parentId}' payload içindeki hiçbir öğenin id'siyle eşleşmiyor.`,
          path: [index, "parentId"],
        });
        skip.add(index);
      }
    });

    // (4) Cycle pass — 3 renkli iteratif DFS. Her düğümün en fazla bir çıkan kenarı
    // (parentId) vardır (fonksiyonel graf), dolayısıyla toplam iş O(n). Bir düğüm bir
    // döngünün parçası olarak bulunursa gri (1) bırakılır — bu, aynı döngüye başka bir
    // düğümden ulaşan sonraki taramaların anında (O(1)) tekrar döngü tespit etmesini
    // sağlar; döngünün kendisi asla yeniden gezilmez, dolayısıyla toplam iş yine O(n)'dir.
    const state = new Map<string, 0 | 1 | 2>(); // 0/yok=beyaz, 1=gri(yolda), 2=siyah(temiz)
    const inCycle = new Set<string>();

    items.forEach((start, startIndex) => {
      if (skip.has(startIndex) || start.id == null) return;
      if (state.get(start.id) === 2) return;

      const path: string[] = [];
      let cursor: typeof start | undefined = start;
      while (cursor && cursor.id != null && state.get(cursor.id) !== 2) {
        if (state.get(cursor.id) === 1) {
          // Gri bir düğüme geri döndük => döngü. `path`'teki ilgili öğelere hata ekle.
          for (const id of path) inCycle.add(id);
          break;
        }
        state.set(cursor.id, 1);
        path.push(cursor.id);
        cursor = cursor.parentId != null ? byId.get(cursor.parentId) : undefined;
      }
      if (!path.some((id) => inCycle.has(id))) {
        for (const id of path) state.set(id, 2); // döngü bulunmadı — tüm yol siyaha boyanır.
      }
    });

    items.forEach((item, index) => {
      if (item.id != null && inCycle.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Döngü tespit edildi: bu öğe parentId zinciri üzerinden kendine geri dönüyor.",
          path: [index, "parentId"],
        });
        skip.add(index);
      }
    });

    // (5) Depth pass — memoize edilmiş ata sayısı. Yalnızca cycle'dan TEMİZ düğümler için
    // çağrılır, dolayısıyla sonsuz özyineleme imkânsızdır.
    const depthMemo = new Map<string, number>();
    function depthOf(item: (typeof items)[number]): number {
      if (item.id != null && depthMemo.has(item.id)) return depthMemo.get(item.id)!;
      const d = item.parentId == null || !byId.has(item.parentId) ? 0 : depthOf(byId.get(item.parentId)!) + 1;
      if (item.id != null) depthMemo.set(item.id, d);
      return d;
    }

    items.forEach((item, index) => {
      if (skip.has(index) || item.parentId == null) return;
      if (depthOf(item) > NAVIGATION_MAX_DEPTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Maksimum derinlik aşıldı: bir öğe en fazla ${NAVIGATION_MAX_DEPTH} ata seviyesine sahip olabilir.`,
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
