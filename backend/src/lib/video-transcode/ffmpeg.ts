import { spawn } from "node:child_process";

/**
 * Paket AE-ek — ffmpeg çağrıları. GÜVENLİK:
 * - `spawn` argüman dizisiyle çalışır, KABUK YOK; girdi/çıktı yolları yalnızca sunucunun ürettiği yollardır
 *   (kullanıcının dosya adı hiçbir argümana girmez).
 * - Her çağrı `-nostdin -y -protocol_whitelist file,pipe` ile; girdi yalnızca MOV/MP4 demuxer'ıyla açılır
 *   (`-f mov`) — HLS/playlist/concat gibi başka dosya ya da ağ adresi açabilen biçimler devreye giremez.
 * - Canlı görüşmeleri korumak için Linux'ta `nice -n 19`, kodlayıcıda `-threads 2`; iş başına 10 dk sınır,
 *   aşılırsa süreç SIGKILL ile öldürülür.
 * - Konum (GPS) ve cihaz bilgisi taşıyan meta veri çıktıya yazılmaz (`-map_metadata -1`).
 */
export const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
export const FFMPEG_THREADS = "2";
const STDERR_TAIL_BYTES = 4000;

/** En çok 1080p: kısa kenar 1080'i aşıyorsa küçültülür (dikey videolar dahil); boyutlar çift sayıya yuvarlanır. */
export const SCALE_FILTER = "scale='if(gt(iw,ih),-2,min(iw,1080))':'if(gt(iw,ih),min(ih,1080),-2)',scale=trunc(iw/2)*2:trunc(ih/2)*2";

const SAFE_INPUT_FLAGS = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file,pipe"];

export function buildTranscodeArgs(input: string, output: string): string[] {
  return [
    ...SAFE_INPUT_FLAGS,
    "-f",
    "mov",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-vf",
    SCALE_FILTER,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-threads",
    FFMPEG_THREADS,
    "-f",
    "mp4",
    output,
  ];
}

/** Kapak: dönüştürülmüş MP4'ten `atSec` saniyesindeki tek kare (PNG; sonra sharp ile WebP + JPEG). */
export function buildPosterArgs(input: string, output: string, atSec: number): string[] {
  return [...SAFE_INPUT_FLAGS, "-f", "mov", "-ss", atSec.toFixed(2), "-i", input, "-frames:v", "1", "-threads", FFMPEG_THREADS, "-f", "image2", "-c:v", "png", output];
}

/** Linux'ta `nice -n 19 ffmpeg …`; `FFMPEG_PATH` ile ikili değiştirilebilir (yalnızca ortam değişkeni, kullanıcı girdisi değil). */
export function ffmpegCommand(args: string[], platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  const bin = process.env.FFMPEG_PATH || "ffmpeg";
  return platform === "win32" ? { command: bin, args } : { command: "nice", args: ["-n", "19", bin, ...args] };
}

export class ProcessTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Süreç ${Math.round(timeoutMs / 1000)} sn içinde bitmedi ve durduruldu.`);
  }
}

export class ProcessFailedError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderrTail: string,
    public readonly notFound = false
  ) {
    super(message);
  }
}

/** Kabuksuz süreç çalıştırır; zaman aşımında SIGKILL ile öldürür. stdout yok sayılır, stderr'in son kısmı tutulur. */
export function runProcess(command: string, args: string[], opts: { timeoutMs: number; onSpawn?: (pid: number | undefined) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    opts.onSpawn?.(child.pid);
    let stderr = "";
    let timedOut = false;
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new ProcessFailedError(err.code === "ENOENT" ? `${command} bulunamadı.` : err.message, null, stderr, err.code === "ENOENT"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new ProcessTimeoutError(opts.timeoutMs));
      else if (code === 0) resolve();
      else reject(new ProcessFailedError(`Süreç ${code} koduyla bitti.`, code, stderr));
    });
  });
}

export async function runFfmpeg(args: string[], timeoutMs = FFMPEG_TIMEOUT_MS): Promise<void> {
  const { command, args: full } = ffmpegCommand(args);
  await runProcess(command, full, { timeoutMs });
}
