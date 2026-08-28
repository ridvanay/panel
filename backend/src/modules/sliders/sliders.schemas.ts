import { z } from "zod";
import {
  SliderTransitionEffectSchema,
  SliderHeightModeSchema,
  SlideBackgroundTypeSchema,
  SliderNavigationThemeSchema,
} from "../../schemas/entities";
import { CursorQuerySchema, TrashedFilterSchema, SafeHrefSchema } from "../../schemas/common";
import { MAX_SLIDES_PER_SLIDER } from "./lib/constants";

export const SliderIdParamSchema = z.object({
  sliderId: z.string().uuid(),
});

export const SlideIdParamSchema = z.object({
  sliderId: z.string().uuid(),
  slideId: z.string().uuid(),
});

/**
 * `GET /admin/sliders` — `Portfolio`/`Products` liste uçlarıyla BİREBİR AYNI cursor
 * sayfalama semantiği (bkz. `.claude/architect-scope-advanced-slider.md` §4, openapi.yaml
 * `Sliders` tag'i). `status` alanı YOKTUR — `Slider` bir "içerik" değildir (§1.1).
 */
export const ListSlidersQuerySchema = CursorQuerySchema.extend({
  trashed: TrashedFilterSchema,
  // `name`/`slug` üzerinde büyük/küçük harf duyarsız arama.
  search: z.string().min(1).optional(),
});

/**
 * `DELETE /admin/sliders/{sliderId}` — Fastify querystring HER ZAMAN string olarak gelir;
 * `z.coerce.boolean()` BİLİNÇLİ OLARAK KULLANILMAZ (`admin-users.schemas.ts::
 * ListAdminUsersQuerySchema` ile AYNI gerekçe — boş olmayan HER string, ör. `"false"`, `true`
 * yapardı).
 */
export const DeleteSliderQuerySchema = z.object({
  force: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

/**
 * `POST /admin/sliders` — ayar alanlarının HEPSİ opsiyoneldir çünkü CreateSliderRequest bu
 * alanları HİÇ KABUL ETMEZ (bkz. openapi.yaml `CreateSliderRequest`, `additionalProperties:
 * false`) — slider ayarları Prisma `@default()` değerleriyle dolar; slider slaytsız
 * oluşturulur (ilk slayt `POST .../slides` ile eklenir).
 */
export const CreateSliderRequestSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(140).optional(),
});

/**
 * `PATCH /admin/sliders/{sliderId}` — `CreateSliderRequest` + TÜM `SliderSettings`
 * alanları, hepsi opsiyonel (PATCH semantiği, bkz. openapi.yaml `UpdateSliderRequest`).
 * `slides` BURADA KABUL EDİLMEZ — yazma yolu `.../slides*` uçlarıdır.
 */
export const UpdateSliderRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().min(1).max(140).optional(),
  autoplay: z.boolean().optional(),
  intervalMs: z.number().int().min(1000).max(60000).optional(),
  loop: z.boolean().optional(),
  pauseOnHover: z.boolean().optional(),
  transitionEffect: SliderTransitionEffectSchema.optional(),
  transitionDurationMs: z.number().int().min(100).max(3000).optional(),
  heightMode: SliderHeightModeSchema.optional(),
  heightPx: z.number().int().min(120).max(2000).nullable().optional(),
  aspectRatioWidth: z.number().int().min(1).max(64).optional(),
  aspectRatioHeight: z.number().int().min(1).max(64).optional(),
  // `null` = masaüstüyle AYNI (bkz. openapi.yaml `SliderSettings.mobileHeightMode` açıklaması).
  mobileHeightMode: SliderHeightModeSchema.nullable().optional(),
  mobileHeightPx: z.number().int().min(120).max(2000).nullable().optional(),
  mobileAspectRatioWidth: z.number().int().min(1).max(64).nullable().optional(),
  mobileAspectRatioHeight: z.number().int().min(1).max(64).nullable().optional(),
  showArrows: z.boolean().optional(),
  showBullets: z.boolean().optional(),
  showProgressBar: z.boolean().optional(),
  navigationTheme: SliderNavigationThemeSchema.optional(),
});

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * `layers` alanı BURADA BİLİNÇLİ OLARAK GEVŞEK (`z.array(z.unknown())`) bırakılır — asıl
 * doğrulama (adet/byte/şekil/yinelenen id) route handler'da `lib/layers.ts::parseSlideLayers`
 * ile İMPERATİF olarak yapılır (413 vs 422 ayrımı için ZORUNLU, bkz. o dosyanın yorumu).
 * Fastify'nin otomatik body-şema doğrulaması burada yalnızca "dizi mi" kontrolü yapar.
 */
export const UpdateSlideRequestSchema = z.object({
  isActive: z.boolean().optional(),
  label: z.string().max(120).nullable().optional(),
  bgType: SlideBackgroundTypeSchema.optional(),
  bgMediaId: z.string().uuid().nullable().optional(),
  bgVideoUrl: SafeHrefSchema.nullable().optional(),
  bgVideoPosterMediaId: z.string().uuid().nullable().optional(),
  bgPositionX: z.number().int().min(0).max(100).optional(),
  bgPositionY: z.number().int().min(0).max(100).optional(),
  bgOverlayColor: z.string().regex(HEX6, "Geçersiz renk değeri.").nullable().optional(),
  bgOverlayOpacity: z.number().int().min(0).max(100).optional(),
  bgGradientFrom: z.string().regex(HEX6, "Geçersiz renk değeri.").nullable().optional(),
  bgGradientTo: z.string().regex(HEX6, "Geçersiz renk değeri.").nullable().optional(),
  bgGradientAngle: z.number().int().min(0).max(360).optional(),
  bgKenBurns: z.boolean().optional(),
  durationMs: z.number().int().min(1000).max(60000).nullable().optional(),
  linkHref: SafeHrefSchema.nullable().optional(),
  linkNewTab: z.boolean().optional(),
  layers: z.array(z.unknown()).optional(),
});

/**
 * `POST /admin/sliders/{sliderId}/slides` — tüm alanlar opsiyoneldir ("boş slayt"
 * oluşturmak geçerli bir akıştır). `order` verilmezse mevcut en yüksek `order + 1` atanır
 * (sona eklenir). `MAX_SLIDES_PER_SLIDER` ({@link MAX_SLIDES_PER_SLIDER}) aşılırsa route
 * handler `422` döner.
 */
export const CreateSlideRequestSchema = UpdateSlideRequestSchema.extend({
  order: z.number().int().min(0).optional(),
});

/**
 * `PUT /admin/sliders/{sliderId}/slides/order` — `Navigation` PUT'u ile AYNI "tam durum
 * gönder" deseni. `slideIds` bu slider'ın TÜM slaytlarını, istenen sırada, EKSİKSİZ
 * içermelidir — eksik/fazla/yabancı id route handler'da `422` üretir.
 */
export const ReorderSlidesRequestSchema = z.object({
  slideIds: z.array(z.string().uuid()).min(1).max(MAX_SLIDES_PER_SLIDER),
});
