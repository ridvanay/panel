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

export interface ProcessedImage {
  /** Sitede kullanılan ana sürüm (WebP; `icon` amacında PNG). */
  main: EncodedImage;
  /** Uyumluluk kopyaları: daima JPEG, saydam/logo ise ayrıca PNG. */
  compat: EncodedImage[];
  hadAlpha: boolean;
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

/** Site fotoğrafını işler. Hata durumunda kullanıcıya gösterilebilir mesajlı `ImageProcessingError` fırlatır. */
export async function processSiteImage(buffer: Buffer, opts: { purpose?: ImagePurpose; isHeif?: boolean } = {}): Promise<ProcessedImage> {
  const purpose = opts.purpose ?? "default";
  const isHeif = opts.isHeif ?? false;
  let hadAlpha = false;
  try {
    const meta = await pipelineFor(buffer).metadata();
    if (!meta.format || !ALLOWED_INPUT_FORMATS.has(meta.format)) {
      throw new ImageProcessingError("Desteklenmeyen görsel biçimi.", "UNSUPPORTED_FORMAT");
    }
    if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_INPUT_PIXELS) {
      throw new ImageProcessingError(`Görsel çok büyük (en çok ${MAX_INPUT_PIXELS / 1_000_000} megapiksel).`, "TOO_MANY_PIXELS");
    }
    hadAlpha = Boolean(meta.hasAlpha);
    // `icon` (favicon/apple-touch-icon): tarayıcı uyumu için ana sürüm PNG kalır.
    let main = purpose === "icon" ? await encode(buffer, MAX_EDGE_PX, "png") : await encode(buffer, MAX_EDGE_PX, "webp");
    if (main.mimeType === "image/webp" && main.buffer.byteLength >= buffer.byteLength) {
      const smaller = await encode(buffer, MAX_EDGE_PX, "webp", WEBP_FALLBACK_QUALITY);
      if (smaller.buffer.byteLength < main.buffer.byteLength) main = smaller;
    }
    const compat: EncodedImage[] = [await encode(buffer, COMPAT_MAX_EDGE_PX, "jpeg")];
    if (purpose !== "icon" && (hadAlpha || purpose === "logo")) compat.push(await encode(buffer, COMPAT_MAX_EDGE_PX, "png"));
    return { main, compat, hadAlpha };
  } catch (err) {
    if (err instanceof ImageProcessingError) throw err;
    throw mapSharpError(err, isHeif);
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
