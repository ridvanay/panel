/**
 * Paket AE — admin video yükleme yardımcıları: istemci ön kontrolü ve tarayıcıda poster karesi yakalama.
 * Sunucu yine son karar verir (içerik `ftyp` ile doğrulanır, boyut ayardan denetlenir).
 */

export const DEFAULT_MAX_VIDEO_MB = 100;
export const MIN_MAX_VIDEO_MB = 1;
export const MAX_MAX_VIDEO_MB = 500;
export const MAX_CAPTIONS_BYTES = 512 * 1024;

export const HEVC_CODECS = ["hvc1", "hev1"] as const;

export const HEVC_WARNING_MESSAGE =
  "Bu video iPhone'un HEVC biçiminde. Bazı tarayıcılarda (Windows Chrome/Firefox) oynatılamayabilir. iPhone'da Ayarlar → Kamera → Biçimler → 'En Uyumlu' seçip yeniden çekin ya da H.264'e dönüştürün.";
export const MOOV_WARNING_MESSAGE = "Video akışlı oynatma için optimize değil, yüklenmesi yavaş olabilir.";

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Ayar alanı doğrulaması: 1–500 arası tam sayı. Hata yoksa `null`. */
export function validateMaxVideoMb(value: number): string | null {
  if (!Number.isInteger(value)) return "Azami video boyutu tam sayı olmalıdır.";
  if (value < MIN_MAX_VIDEO_MB || value > MAX_MAX_VIDEO_MB) return `Azami video boyutu ${MIN_MAX_VIDEO_MB} ile ${MAX_MAX_VIDEO_MB} MB arasında olmalıdır.`;
  return null;
}

/** Yalnızca .mp4 / video/mp4 ve ayardaki azami boyut. Hata yoksa `null`. */
export function validateVideoFile(file: Pick<File, "name" | "type" | "size">, maxMb: number): string | null {
  const isMp4Name = /\.mp4$/i.test(file.name);
  const isMp4Type = file.type === "video/mp4";
  if (!isMp4Name && !isMp4Type) return "Yalnızca MP4 video yükleyebilirsiniz.";
  if (file.type && file.type !== "video/mp4") return "Yalnızca MP4 video yükleyebilirsiniz.";
  if (file.size > maxMb * 1024 * 1024) return `Video en fazla ${maxMb} MB olabilir (seçilen dosya ${formatMegabytes(file.size)}).`;
  return null;
}

export function validateCaptionsFile(file: Pick<File, "name" | "size">): string | null {
  if (!/\.vtt$/i.test(file.name)) return "Yalnızca .vtt altyazı dosyası yükleyebilirsiniz.";
  if (file.size > MAX_CAPTIONS_BYTES) return "Altyazı dosyası en fazla 512 KB olabilir.";
  return null;
}

/** Sunucu uyarısı gelmeyen (kayıtlı) öğelerde rozet/uyarı için codec'ten türetilir. */
export function warningsFromVideoInfo(info: { codec: string | null; faststart: boolean } | null): { code: "HEVC_CODEC" | "MOOV_AT_END"; message: string }[] {
  if (!info) return [];
  const out: { code: "HEVC_CODEC" | "MOOV_AT_END"; message: string }[] = [];
  if (info.codec && (HEVC_CODECS as readonly string[]).includes(info.codec)) out.push({ code: "HEVC_CODEC", message: HEVC_WARNING_MESSAGE });
  if (!info.faststart) out.push({ code: "MOOV_AT_END", message: MOOV_WARNING_MESSAGE });
  return out;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export class FrameCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameCaptureError";
  }
}

export const FRAME_CAPTURE_FAILED_MESSAGE =
  "Tarayıcınız bu videodan kare yakalayamadı (video biçimi, ör. HEVC, bu tarayıcıda çözülemiyor olabilir). Lütfen kapak görselini kendiniz yükleyin ya da kütüphaneden seçin.";

export interface CapturedFrame {
  blob: Blob;
  /** Gerçekten yakalanan saniye (video süresine göre kısıtlanmış). */
  seconds: number;
  /** Videonun toplam süresi (sn). */
  duration: number;
}

/**
 * Yerel video dosyasından `seconds`. saniyedeki kareyi JPEG (kalite 0.85) olarak yakalar.
 * `<video>` + `seeked` olayı + `<canvas>`; tarayıcı videoyu çözemezse `FrameCaptureError` fırlatır.
 */
export function captureVideoFrame(file: Blob, seconds = 1, timeoutMs = 15000): Promise<CapturedFrame> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load?.();
      URL.revokeObjectURL(url);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new FrameCaptureError(FRAME_CAPTURE_FAILED_MESSAGE));
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = fail;
    const timer = setTimeout(fail, timeoutMs);

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      // Süre sınırının hemen altı: tam sona seek bazı tarayıcılarda kare vermez.
      const target = Math.max(0.001, Math.min(seconds, Math.max(0, duration - 0.05)));
      video.onseeked = () => {
        if (settled) return;
        try {
          const width = video.videoWidth;
          const height = video.videoHeight;
          if (!width || !height) return fail();
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return fail();
          ctx.drawImage(video, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (settled) return;
              if (!blob) return fail();
              settled = true;
              cleanup();
              resolve({ blob, seconds: target, duration });
            },
            "image/jpeg",
            0.85,
          );
        } catch {
          fail();
        }
      };
      video.currentTime = target;
    };

    video.src = url;
  });
}
