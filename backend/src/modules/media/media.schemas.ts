import { z } from "zod";
import { CursorQuerySchema } from "../../schemas/common";

export const MediaIdParamSchema = z.object({
  mediaId: z.string().uuid(),
});

// §Faz 2 içerik editörü — editör içi görsellerde alt metin zorunluluğu; boş string kabul edilmez
// (bkz. modules/media/media.routes.ts::PATCH /:mediaId). `folderId` BİLEREK YOKTUR — klasör
// değişiminin TEK yolu `POST /admin/media/move`'dur (bkz. ARCHITECTURE.md §10.11.4, openapi.yaml).
// `.strict()` — kontrat hakemlik kararı: gövdeye `folderId` (ya da başka bilinmeyen bir alan)
// eklenirse sessizce yok saymak yerine 422 döner ("tek alan güncellenebilir" kuralı korunur).
export const UpdateMediaAltTextRequestSchema = z
  .object({
    altText: z.string().min(1, "Alt metin gerekli."),
  })
  .strict("Bu uç yalnızca `altText` alanını kabul eder — klasör değişimi için `POST /admin/media/move` kullanın.");

// §10.11 Medya Kütüphanesi — Klasör Sistemi.

export const MediaFolderIdParamSchema = z.object({
  folderId: z.string().uuid(),
});

/**
 * `GET /admin/media` sorgu parametreleri — mevcut `CursorQuerySchema`'ya `folderId` filtresi
 * eklenir (openapi.yaml#/components/parameters/MediaFolderFilter). SUNUCU taraflıdır (tür/tarih/
 * dosya adı filtrelerinin aksine) çünkü sayfalamanın kapsamını değiştirir. `none` = yalnızca
 * "Kategorisiz" (`folderId IS NULL`); UUID = o klasördeki medya (ÖZYİNELEMELİ DEĞİL); alan hiç
 * gönderilmezse filtre uygulanmaz.
 */
export const MediaListQuerySchema = CursorQuerySchema.extend({
  folderId: z
    .string()
    .refine((value) => value === "none" || z.string().uuid().safeParse(value).success, {
      message: "folderId `none` sabiti ya da geçerli bir UUID olmalıdır.",
    })
    .optional(),
});

// `POST /admin/media/folders` gövdesi.
export const CreateMediaFolderRequestSchema = z.object({
  // Baştaki/sondaki boşluklar kırpılır; kırpma sonrası boş kalırsa 422 (min(1) trim SONRASI
  // değere uygulanır).
  name: z.string().trim().min(1, "Klasör adı gerekli.").max(80, "Klasör adı en fazla 80 karakter olabilir."),
  // Verilmezse/null ise kök seviye. Hedefin KENDİ `parentId`'si null OLMALIDIR (derinlik 2) —
  // bu kural DB'de zorlanamaz, route handler'da kontrol edilir (bkz. media.routes.ts).
  parentId: z.string().uuid().nullable().optional(),
});

/**
 * `PATCH /admin/media/folders/{folderId}` gövdesi — en az bir alan gönderilmelidir. Alanın HİÇ
 * gönderilmemesi (`undefined`) "değiştirme" demektir; `parentId: null` ise "köke taşı" demektir
 * — bu ikisi Zod `.optional()`/`.nullable()` kombinasyonuyla ayrıştırılabilir kalır (route
 * handler'da `"parentId" in request.body` yerine `request.body.parentId !== undefined` kontrolü
 * kullanılır).
 */
export const UpdateMediaFolderRequestSchema = z
  .object({
    name: z.string().trim().min(1, "Klasör adı gerekli.").max(80, "Klasör adı en fazla 80 karakter olabilir.").optional(),
    parentId: z.string().uuid().nullable().optional(),
  })
  .refine((data) => data.name !== undefined || data.parentId !== undefined, {
    message: "En az bir alan gönderilmelidir (name ve/veya parentId).",
  });

// `POST /admin/media/move` gövdesi — tekil taşıma tek elemanlı `mediaIds` dizisidir.
export const MoveMediaRequestSchema = z.object({
  mediaIds: z
    .array(z.string().uuid())
    .min(1, "En az bir medya id'si gerekli.")
    // `BulkContentActionRequest` ile AYNI üst sınır (100) — bkz. ARCHITECTURE.md §10.11.4.
    .max(100, "En fazla 100 medya aynı anda taşınabilir."),
  // ZORUNLU ama değeri null OLABİLİR — hiç gönderilmemesi (kazara "klasörden çıkarma"
  // olmasın diye) 422'dir.
  folderId: z.string().uuid().nullable(),
});
