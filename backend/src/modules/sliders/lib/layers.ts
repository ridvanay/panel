import { z } from "zod";
import { SafeHrefSchema } from "../../../schemas/common";
import { ValidationError, PayloadTooLargeError } from "../../../lib/errors";
import { MAX_SLIDE_LAYERS, MAX_SLIDE_LAYERS_BYTES } from "./constants";

/**
 * Katman doğrulama — `.claude/architect-scope-advanced-slider.md` §3.2'nin BİREBİR
 * uygulaması (tek sapma: byte-tavanı kontrolü, aşağıdaki `parseSlideLayers` yorumunda
 * açıklanan gerekçeyle Zod zincirinin İÇİNDEN çıkarılıp İMPERATİF olarak yapılır).
 */

const HEX6 = /^#[0-9a-fA-F]{6}$/;

const LayerOriginSchema = z.enum([
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
]);

const LayerPositionSchema = z.object({
  xPercent: z.number().min(0).max(100),
  yPercent: z.number().min(0).max(100),
  origin: LayerOriginSchema,
  offsetX: z.number().int().min(-400).max(400).default(0),
  offsetY: z.number().int().min(-400).max(400).default(0),
  widthPercent: z.number().min(1).max(100).optional(),
  zIndex: z.number().int().min(0).max(99).optional(),
});

// HAM CSS KABUL EDİLMEZ — her alan kapalı bir küme veya sınırlı sayısal aralıktır.
const LayerStyleSchema = z.object({
  color: z.string().regex(HEX6).optional(),
  backgroundColor: z.string().regex(HEX6).optional(),
  backgroundOpacity: z.number().int().min(0).max(100).optional(),
  fontFamily: z.enum(["inherit", "heading", "body"]).optional(),
  fontSize: z.number().int().min(8).max(200).optional(),
  fontWeight: z
    .union([z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800), z.literal(900)])
    .optional(),
  lineHeight: z.number().min(0.8).max(3).optional(),
  letterSpacing: z.number().min(-5).max(20).optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  textTransform: z.enum(["none", "uppercase"]).optional(),
  padding: z
    .object({
      top: z.number().int().min(0).max(200),
      right: z.number().int().min(0).max(200),
      bottom: z.number().int().min(0).max(200),
      left: z.number().int().min(0).max(200),
    })
    .optional(),
  borderRadius: z.number().int().min(0).max(200).optional(),
  opacity: z.number().int().min(0).max(100).optional(),
  shadow: z.enum(["none", "sm", "md", "lg"]).optional(),
  maxWidthPx: z.number().int().min(40).max(1600).optional(),
});

const LayerAnimationSchema = z.object({
  inEffect: z.enum(["none", "fade", "fade-up", "fade-down", "slide-in-left", "slide-in-right", "zoom-in", "flip-up"]),
  delayMs: z.number().int().min(0).max(10_000).multipleOf(50),
  durationMs: z.number().int().min(100).max(3000).multipleOf(50),
  easing: z.enum(["linear", "ease-out", "ease-in-out", "spring"]).optional(),
});

/**
 * `content` override BİLİNÇLİ olarak YOK (§2.4) — ve şema `.strict()` (bilinmeyen anahtar
 * SESSİZCE DÜŞÜRÜLMEZ, REDDEDİLİR). Diğer sayfa-blok şemalarının aksine (bkz.
 * `pages.schemas.ts::ContainerSettingsSchema` yorumu — orada "bilinmeyen anahtar sessizce
 * düşürülür" tercih edilir) burada BİLEREK daha katı davranılır: bir istemci `responsive.
 * mobile.content` göndermeye çalışırsa bu, "v1 sınırı"nı es geçmeye çalışan bir istek
 * olabilir — sessizce yutmak yerine 422 ile AÇIKÇA reddedilir (bkz. birim testi).
 */
const LayerOverrideSchema = z
  .object({
    hidden: z.boolean().optional(),
    position: LayerPositionSchema.partial().optional(),
    style: LayerStyleSchema.optional(),
    animation: LayerAnimationSchema.partial().optional(),
  })
  .strict();

const LayerBase = {
  id: z.string().min(1).max(64),
  position: LayerPositionSchema,
  style: LayerStyleSchema.default({}),
  animation: LayerAnimationSchema,
  responsive: z
    .object({
      tablet: LayerOverrideSchema.optional(),
      mobile: LayerOverrideSchema.optional(),
    })
    .optional(),
};

export const SliderLayerSchema = z.discriminatedUnion("type", [
  z.object({
    ...LayerBase,
    type: z.literal("heading"),
    content: z.object({
      text: z.string().min(1).max(200),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    }),
  }),
  z.object({
    ...LayerBase,
    type: z.literal("text"),
    // Düz metin — HTML DEĞİL (AccordionQAItem.answer ile AYNI gerekçe: yeni bir
    // sanitizasyon yolu açılmaz). Satır sonları render'da <p>'ye çevrilir.
    content: z.object({ text: z.string().min(1).max(600) }),
  }),
  z.object({
    ...LayerBase,
    type: z.literal("button"),
    content: z.object({
      label: z.string().min(1).max(60),
      href: SafeHrefSchema,
      variant: z.enum(["solid", "outline", "ghost"]).default("solid"),
      size: z.enum(["sm", "md", "lg"]).default("md"),
      icon: z.string().min(1).max(60).optional(),
    }),
  }),
  z.object({
    ...LayerBase,
    type: z.literal("image"),
    // alt ZORUNLU — katman görselleri dekoratif değil içeriktir (a11y).
    content: z.object({ url: z.string().min(1).max(2048), alt: z.string().min(1).max(200) }),
  }),
  z.object({
    ...LayerBase,
    type: z.literal("badge"),
    content: z.object({ text: z.string().min(1).max(60) }),
  }),
]);

export type SliderLayer = z.infer<typeof SliderLayerSchema>;

/**
 * `layers` için Zod giriş noktası — mimarın §3.2 iskeletiyle BİREBİR aynı zincir (adet
 * tavanı → byte tavanı → katman-başına ayrık birlik → yinelenen id kontrolü). Doğrudan
 * `.safeParse()` ile kullanılabilir (bkz. birim testleri) — YALNIZCA HTTP katmanında
 * (route handler) BUNUN YERİNE `parseSlideLayers` kullanılır (aşağıdaki yoruma bakınız).
 */
export const SlideLayersSchema = z
  .array(z.unknown())
  .max(MAX_SLIDE_LAYERS)
  .superRefine((arr, ctx) => {
    if (Buffer.byteLength(JSON.stringify(arr), "utf8") > MAX_SLIDE_LAYERS_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Katman verisi 64 KB sınırını aşıyor." });
    }
  })
  .pipe(z.array(SliderLayerSchema))
  // Katman id'leri slayt İÇİNDE benzersiz olmalıdır (React key + animasyon eşleşmesi).
  .superRefine((layers, ctx) => {
    const ids = new Set<string>();
    for (const l of layers) {
      if (ids.has(l.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Yinelenen katman id: ${l.id}` });
      ids.add(l.id);
    }
  });

const SlideLayersShapeSchema = z
  .array(SliderLayerSchema)
  .max(MAX_SLIDE_LAYERS)
  .superRefine((layers, ctx) => {
    const ids = new Set<string>();
    for (const l of layers) {
      if (ids.has(l.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Yinelenen katman id: ${l.id}` });
      ids.add(l.id);
    }
  });

function flattenZodIssues(issues: z.ZodIssue[]): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_";
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

/**
 * `layers` için TEK giriş noktası — route handler'lar (`POST .../slides`,
 * `PATCH .../slides/{slideId}`, `POST .../slides/{slideId}/duplicate`) BUNU kullanır,
 * Fastify'nin OTOMATİK body-şeması doğrulamasını DEĞİL.
 *
 * GEREKÇE (mimarın §3.2/§4.2 açıklamasıyla BİREBİR): 64 KB üstü `layers` `413
 * PAYLOAD_TOO_LARGE` dönmelidir, `422 VALIDATION_ERROR` DEĞİL (bkz. openapi.yaml
 * `PATCH /admin/sliders/{sliderId}/slides/{slideId}` 413 açıklaması). Merkezi hata
 * işleyici (`plugins/error-handler.ts::isZodError`) HER `ZodError`'ı KOŞULSUZ 422'ye
 * çevirir — bu yüzden Fastify'nin `schema.body`'sine `SlideLayersSchema`'yı (byte
 * kontrolü Zod `superRefine` İÇİNDE) doğrudan bağlamak, byte ihlalini de 422 yapardı.
 * Çözüm: byte kontrolü BURADA, Zod'dan ÖNCE, imperatif olarak yapılır ve
 * `PayloadTooLargeError` (413) fırlatılır; ancak byte altındaysa geri kalan doğrulama
 * (adet/şekil/yinelenen id) yine Zod ile yapılır (`422`).
 *
 * Doğrulama sırası (bağlayıcı, openapi.yaml ile BİREBİR): (1) adet tavanı → 422
 * (2) byte tavanı → 413 (3) katman-başına Zod ayrık birliği + yinelenen id → 422.
 */
export function parseSlideLayers(raw: unknown): SliderLayer[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError("layers bir dizi olmalıdır.", { layers: ["layers bir dizi olmalıdır."] });
  }
  if (raw.length > MAX_SLIDE_LAYERS) {
    throw new ValidationError(`layers en fazla ${MAX_SLIDE_LAYERS} öğe içerebilir.`, {
      layers: [`En fazla ${MAX_SLIDE_LAYERS} katman olabilir.`],
    });
  }

  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
  } catch {
    throw new PayloadTooLargeError("Katman verisi işlenemedi.");
  }
  if (bytes > MAX_SLIDE_LAYERS_BYTES) {
    throw new PayloadTooLargeError(`layers verisi ${MAX_SLIDE_LAYERS_BYTES / 1024} KB sınırını aşıyor.`);
  }

  const parsed = SlideLayersShapeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Katman verisi doğrulama hatası.", flattenZodIssues(parsed.error.issues));
  }
  return parsed.data;
}
