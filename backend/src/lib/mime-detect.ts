/**
 * Görsel dosyaların GERÇEK MIME türünü buffer'ın ilk baytlarından (magic byte) tespit eder.
 * İstemcinin beyan ettiği `Content-Type`/multipart alan adı ASLA güvenilir bir kaynak değildir
 * (bkz. media.routes.ts'teki güvenlik bulgusu — `image/png` beyan edilip içeriği `<script>`
 * olan bir dosya yüklenebiliyordu). Hem `modules/media/media.routes.ts` (tekil yükleme) hem de
 * `modules/import/parsers/zip.parser.ts` (ZIP içinden toplu yükleme, §10.8.7) BU tek fonksiyonu
 * kullanır — iki modülün de aynı kod yolundan geçmesi, aralarında sürüklenme (drift) olmamasını
 * garanti eder.
 *
 * SVG kasıtlı olarak "tanınan ama reddedilen" bir tür olarak modellenir: metin tabanlıdır, sabit
 * bir magic byte imzası yoktur ve içine `<script>` gömülebildiği için depolanmış XSS riski taşır.
 * `isSvg: true` dönen bir giriş çağıran taraf tarafından KESİN reddedilmelidir.
 */
export interface DetectedMimeType {
  /** Tanınan bir görsel imzasıyla eşleşmiyorsa `null`. */
  mimeType: string | null;
  /** `true` ise `mimeType` "image/svg+xml" olsa da bu tür daima reddedilmelidir. */
  isSvg: boolean;
}

export function detectImageMimeType(buffer: Buffer): DetectedMimeType {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", isSvg: false };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", isSvg: false };
  }
  if (buffer.length >= 6) {
    const sig = buffer.subarray(0, 6).toString("ascii");
    if (sig === "GIF87a" || sig === "GIF89a") return { mimeType: "image/gif", isSvg: false };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp", isSvg: false };
  }
  // SVG metin tabanlıdır, magic byte'ı yok — ilk 1 KB'da <svg imzasını arıyoruz. §10.8.7:
  // MIME uzantıdan DEĞİL içerikten belirlenir VE SVG kesin REDDEDİLİR (depolanmış XSS riski).
  const head = buffer.subarray(0, 1024).toString("utf8").toLowerCase();
  if (head.includes("<svg") || (head.includes("<?xml") && head.includes("<svg"))) {
    return { mimeType: "image/svg+xml", isSvg: true };
  }
  return { mimeType: null, isSvg: false };
}

// §2.2 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — PDF magic byte'ı
// (`%PDF-`, ilk 5 bayt). Görsel tespiti (`detectImageMimeType`) ile AYNI dosyada, AYNI desende:
// içerikten tespit, beyandan DEĞİL. `detectImageMimeType`'ın adı/sözleşmesi DEĞİŞMEDİ — PDF
// desteği aşağıdaki `detectUploadMimeType()` sarmalayıcısıyla eklendi.
const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

export function detectPdfMimeType(buffer: Buffer): DetectedMimeType {
  if (buffer.length >= PDF_MAGIC_BYTES.length && buffer.subarray(0, PDF_MAGIC_BYTES.length).equals(PDF_MAGIC_BYTES)) {
    return { mimeType: "application/pdf", isSvg: false };
  }
  return { mimeType: null, isSvg: false };
}

/**
 * Görsel + PDF ikisini birden tespit eden TEK sarmalayıcı — `POST /admin/media` gibi hem görsel
 * hem döküman kabul eden uçlar bunu çağırır. `detectImageMimeType`'ın kendisi ve mevcut
 * çağıranları (ör. `import.worker.ts`, yalnızca görsel bekler) DEĞİŞMEDEN kalır — ikinci bir
 * tespit modülü YAZILMADI, aynı dosyadan geçen tek kod yolu korunur (bkz. dosya başı açıklaması).
 */
export function detectUploadMimeType(buffer: Buffer): DetectedMimeType {
  const image = detectImageMimeType(buffer);
  if (image.mimeType) return image;
  return detectPdfMimeType(buffer);
}

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

/**
 * Diskteki/nesne depolamadaki dosya adının uzantısını KULLANICININ beyan ettiği orijinal dosya
 * adından DEĞİL, `detectImageMimeType` ile tespit edilen gerçek içerik türünden türetmek için
 * kullanılır — böylece `evil.html` adlı ama `image/png` beyan edilen bir dosya diske `.html`
 * uzantısıyla yazılıp statik sunucu tarafından `text/html` olarak servis edilemez.
 * Tanınmayan/desteklenmeyen bir tür verilirse uzantısız döner (çağıran taraf bu türü zaten
 * kabul etmeden önce reddetmiş olmalıdır).
 */
export function extensionForMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] ?? "";
}

/** Bir uzantının (`extensionForMimeType`'tan gelen, ör. `.jpg`) GÖRSEL bir türe mi ait olduğunu
 * söyler — `plugins/uploads.ts`'in görsel OLMAYAN türlerde (şu an yalnızca `.pdf`) `Content-
 * Disposition: attachment`/`X-Content-Type-Options: nosniff` başlıklarını eklemesi için kullanılır. */
export const IMAGE_EXTENSIONS = new Set([".jpg", ".png", ".gif", ".webp"]);

/** `Media.mimeType`nin görsel öneki (`image/`) taşıyıp taşımadığını söyler — görsel bekleyen FK
 * slotlarının (ör. `Product.coverMediaId`, `ProductImage.mediaId`) tür karışması kapısı. */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
