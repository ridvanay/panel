import sharp from "sharp";

/**
 * Paket AE-ek — admin/personelin yüklediği SİTE fotoğraflarını WebP'ye çevirir (sharp).
 *
 * - Girdi türünü çağıran taraf içerikten (magic byte) belirler; burada ayrıca sharp'ın okuduğu biçim
 *   yalnızca JPEG/PNG/WebP/HEIF ise işlenir. SVG/PDF/GIF bu yola HİÇ girmez.
 * - EXIF yönüne göre döndürülür; EXIF/GPS/XMP/IPTC dahil bütün meta veri silinir, yalnızca ICC renk profili korunur.
 * - En uzun kenar 2560 px (küçükler büyütülmez), WebP kalite 82; saydamlık korunur.
 * - Uyumluluk kopyaları: her görsele JPEG (≈85, en çok 1600 px; saydam alan beyaza düzlenir), saydam görsel ya da
 *   logo için ayrıca PNG (en çok 1600 px). E-posta ve Open Graph bunları kullanır (WebP her yerde görünmüyor).
 * - Piksel bombasına karşı `limitInputPixels` (50 MP) ve görsel başına zaman aşımı.
 *
 * HASTA BELGELERİ bu modülü ASLA kullanmaz (lib/telehealth-document-storage.ts ayrı yoldur).
 */
export const MAX_INPUT_PIXELS = 50_000_000;
export const MAX_EDGE_PX = 2560;
export const COMPAT_MAX_EDGE_PX = 1600;
export const WEBP_QUALITY = 82;
/** Zaten sıkıştırılmış, çok ayrıntılı görsellerde WebP 82 girdiden büyük çıkabiliyor; o zaman bir kez 72 denenir. */
export const WEBP_FALLBACK_QUALITY = 72;
export const JPEG_QUALITY = 85;
const TIMEOUT_SECONDS = 20;
const ALLOWED_INPUT_FORMATS = new Set(["jpeg", "png", "webp", "heif"]);

export type ImagePurpose = "default" | "logo" | "icon";

export interface EncodedImage {
  buffer: Buffer;
  mimeType: "image/webp" | "image/jpeg" | "image/png";
  width: number;
  height: number;
}

/**
 * Kaynağa göre karar:
 * - `convert`: JPEG/PNG/HEIC → WebP.
 * - `keep`: kaynak zaten WebP ve meta veri yok → dosyaya HİÇ dokunulmaz (yeniden sıkıştırma yok).
 * - `keep-lossless-rewrite`: kaynak WebP ama EXIF/GPS/XMP/IPTC var → kayıpsız WebP olarak yeniden yazılır (meta veri silinir).
 * - `keep-original-format`: JPEG/PNG'den çıkan WebP orijinalden büyük → orijinal format korunur (meta veri varsa
 *   yalnızca o silinerek aynı formatta yeniden yazılır, yoksa dosyaya dokunulmaz).
 */
export type ImageDecision = "convert" | "keep" | "keep-lossless-rewrite" | "keep-original-format";

export interface ProcessedImage {
  /** Sitede kullanılan ana sürüm (çoğunlukla WebP; `icon` amacında ya da `keep-original-format`'ta PNG/JPEG). */
  main: EncodedImage;
  /** Eksik uyumluluk kopyaları: JPEG (+ saydam/logo ise PNG); ana sürümle aynı formattaki kopya yazılmaz. */
  compat: EncodedImage[];
  hadAlpha: boolean;
  decision: ImageDecision;
  /** Ana sürüm kaynak dosyanın baytlarıyla birebir aynı (hiç dokunulmadı). */
  mainUnchanged: boolean;
  /** Kaynakta EXIF/GPS/XMP/IPTC vardı. */
  hadMetadata: boolean;
}

export class ImageProcessingError extends Error {
  constructor(
    message: string,
    public readonly code: "TOO_MANY_PIXELS" | "UNSUPPORTED_FORMAT" | "HEIC_UNSUPPORTED" | "CORRUPT" | "TIMEOUT"
  ) {
    super(message);
  }
}

export const HEIC_UNSUPPORTED_MESSAGE =
  "iPhone HEIC fotoğrafı bu sunucuda dönüştürülemiyor. iPhone'da Ayarlar → Kamera → Biçimler → 'En Uyumlu' seçin ya da fotoğrafı JPEG/PNG olarak dışa aktarın.";

function mapSharpError(err: unknown, isHeif: boolean): ImageProcessingError {
  const message = err instanceof Error ? err.message : String(err);
  if (/pixel limit/i.test(message)) return new ImageProcessingError(`Görsel çok büyük (en çok ${MAX_INPUT_PIXELS / 1_000_000} megapiksel).`, "TOO_MANY_PIXELS");
  if (/timeout/i.test(message)) return new ImageProcessingError("Görsel işleme zaman aşımına uğradı.", "TIMEOUT");
  if (isHeif) return new ImageProcessingError(HEIC_UNSUPPORTED_MESSAGE, "HEIC_UNSUPPORTED");
  return new ImageProcessingError("Görsel okunamadı ya da bozuk.", "CORRUPT");
}

function pipelineFor(buffer: Buffer) {
  return sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).timeout({ seconds: TIMEOUT_SECONDS });
}

async function encode(buffer: Buffer, maxEdge: number, format: "webp" | "jpeg" | "png", webpQuality = WEBP_QUALITY): Promise<EncodedImage> {
  // `.rotate()` (argümansız) EXIF yönünü uygular; çıktıya meta veri yazılmaz (sharp varsayılanı), yalnızca ICC korunur.
  let p = pipelineFor(buffer).rotate().resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true }).keepIccProfile();
  if (format === "webp") p = p.webp({ quality: webpQuality });
  else if (format === "jpeg") p = p.flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  else p = p.png({ compressionLevel: 9, adaptiveFiltering: true });
  const { data, info } = await p.toBuffer({ resolveWithObject: true });
  const mimeType = format === "webp" ? "image/webp" : format === "jpeg" ? "image/jpeg" : "image/png";
  return { buffer: data, mimeType, width: info.width, height: info.height };
}

function asIs(buffer: Buffer, mimeType: EncodedImage["mimeType"], width: number, height: number): EncodedImage {
  return { buffer, mimeType, width, height };
}

/** Meta veriyi silerek kaynağın KENDİ formatında yeniden yazar (WebP ve PNG kayıpsız; JPEG yüksek kalite). */
async function rewriteWithoutMetadata(buffer: Buffer, format: "webp" | "jpeg" | "png"): Promise<EncodedImage> {
  let p = pipelineFor(buffer).rotate().keepIccProfile();
  if (format === "webp") p = p.webp({ lossless: true });
  else if (format === "jpeg") p = p.jpeg({ quality: 92, mozjpeg: true });
  else p = p.png({ compressionLevel: 9, adaptiveFiltering: true });
  const { data, info } = await p.toBuffer({ resolveWithObject: true });
  return { buffer: data, mimeType: format === "webp" ? "image/webp" : format === "jpeg" ? "image/jpeg" : "image/png", width: info.width, height: info.height };
}

/** Site fotoğrafını işler. Hata durumunda kullanıcıya gösterilebilir mesajlı `ImageProcessingError` fırlatır. */
export async function processSiteImage(buffer: Buffer, opts: { purpose?: ImagePurpose; isHeif?: boolean } = {}): Promise<ProcessedImage> {
  const purpose = opts.purpose ?? "default";
  const isHeif = opts.isHeif ?? false;
  try {
    // Önce YALNIZCA meta veri okunur (piksel çözülmez).
    const meta = await pipelineFor(buffer).metadata();
    if (!meta.format || !ALLOWED_INPUT_FORMATS.has(meta.format)) {
      throw new ImageProcessingError("Desteklenmeyen görsel biçimi.", "UNSUPPORTED_FORMAT");
    }
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width * height > MAX_INPUT_PIXELS) {
      throw new ImageProcessingError(`Görsel çok büyük (en çok ${MAX_INPUT_PIXELS / 1_000_000} megapiksel).`, "TOO_MANY_PIXELS");
    }
    const hadAlpha = Boolean(meta.hasAlpha);
    const hadMetadata = Boolean(meta.exif || meta.xmp || meta.iptc);
    // EXIF yönü 1 değilse görüntü döndürülmüş gösterilir; asIs'te boyutlar görüntülenen yöne göre verilir.
    const rotated = (meta.orientation ?? 1) >= 5;
    const [shownW, shownH] = rotated ? [height, width] : [width, height];

    let main: EncodedImage;
    let decision: ImageDecision = "convert";
    let mainUnchanged = false;
    if (purpose === "icon") {
      // `icon` (favicon/apple-touch-icon): tarayıcı uyumu için ana sürüm PNG kalır.
      main = await encode(buffer, MAX_EDGE_PX, "png");
    } else if (meta.format === "webp") {
      // Zaten WebP: yeniden sıkıştırılmaz. Meta veri varsa kayıpsız yeniden yazılır, yoksa dosyaya dokunulmaz.
      if (hadMetadata) {
        main = await rewriteWithoutMetadata(buffer, "webp");
        decision = "keep-lossless-rewrite";
      } else {
        main = asIs(buffer, "image/webp", shownW, shownH);
        decision = "keep";
        mainUnchanged = true;
      }
    } else {
      main = await encode(buffer, MAX_EDGE_PX, "webp");
      if (main.buffer.byteLength >= buffer.byteLength) {
        const smaller = await encode(buffer, MAX_EDGE_PX, "webp", WEBP_FALLBACK_QUALITY);
        if (smaller.buffer.byteLength < main.buffer.byteLength) main = smaller;
      }
      // WebP hâlâ orijinalden büyükse orijinal format korunur (HEIC hariç: tarayıcılar gösteremez).
      if (main.buffer.byteLength >= buffer.byteLength && (meta.format === "jpeg" || meta.format === "png")) {
        decision = "keep-original-format";
        if (hadMetadata) {
          main = await rewriteWithoutMetadata(buffer, meta.format);
        } else {
          main = asIs(buffer, meta.format === "jpeg" ? "image/jpeg" : "image/png", shownW, shownH);
          mainUnchanged = true;
        }
      }
    }

    // Eksik uyumluluk kopyaları: JPEG her zaman, saydam/logo ise PNG; ana sürümle aynı formattaki kopya yazılmaz
    // (ana dosya o formatın kendisidir).
    const wanted: ("jpeg" | "png")[] = ["jpeg"];
    if (purpose !== "icon" && (hadAlpha || purpose === "logo")) wanted.push("png");
    const compat: EncodedImage[] = [];
    for (const f of wanted) {
      if (main.mimeType === `image/${f}`) continue;
      compat.push(await encode(buffer, COMPAT_MAX_EDGE_PX, f));
    }
    return { main, compat, hadAlpha, decision, mainUnchanged, hadMetadata };
  } catch (err) {
    if (err instanceof ImageProcessingError) throw err;
    throw mapSharpError(err, isHeif);
  }
}

/** Kuru çalıştırma/admin bildirimi için kısa Türkçe karar metni. */
export function describeImageDecision(p: Pick<ProcessedImage, "decision" | "compat" | "hadMetadata">): string {
  const copies = p.compat.length ? ` + kopya (${p.compat.map((c) => (c.mimeType === "image/png" ? "PNG" : "JPEG")).join(", ")})` : "";
  switch (p.decision) {
    case "convert":
      return `dönüştür → WebP${copies}`;
    case "keep":
      return `olduğu gibi bırak${copies}`;
    case "keep-lossless-rewrite":
      return `olduğu gibi bırak (EXIF/GPS silindi, kayıpsız yeniden yazıldı)${copies}`;
    case "keep-original-format":
      return `orijinal format korunur (WebP daha büyük${p.hadMetadata ? "; meta veri silindi" : ""})${copies}`;
  }
}

export interface MediaVariant {
  format: "jpeg" | "png";
  path: string;
  url: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export function parseVariants(raw: unknown): MediaVariant[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is MediaVariant => !!v && typeof v === "object" && (v.format === "jpeg" || v.format === "png") && typeof v.url === "string" && typeof v.path === "string"
  );
}
