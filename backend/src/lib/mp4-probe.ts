import fs from "node:fs/promises";

/**
 * Paket AE — yüklenen videonun MP4 olup olmadığını ve oynatılabilirliğini ffmpeg OLMADAN, yalnızca
 * ISO-BMFF kutu (box) yapısını okuyarak denetler. Dosyanın tamamı belleğe alınmaz: üst düzey kutuların
 * yalnızca başlıkları, `moov` kutusunun ise kendisi (üst sınırlı) okunur.
 *
 * - `ftyp` ilk kutu olmalı; ana marka MP4 ailesinden olmalı (QuickTime `qt  ` ve HEIF/AVIF görselleri reddedilir).
 * - Video izinin (`hdlr` = `vide`) `stsd` girişindeki fourcc kodek olarak döner (`avc1`, `hvc1` …).
 * - `moov`, `mdat`'tan önce geliyorsa "faststart" (akışlı oynatmaya uygun).
 */
export interface Mp4ProbeResult {
  majorBrand: string;
  /** Paket AE-ek — `qt  ` ana markası (iPhone .MOV) "mov", diğerleri "mp4". */
  container: "mp4" | "mov";
  /** Video izinin kodeki; görüntü izi yoksa `null`. */
  videoCodec: string | null;
  /** `moov` kutusu `mdat`'tan önce mi. */
  faststart: boolean;
  durationSec: number | null;
}

export type Mp4ProbeError = "NOT_MP4" | "HEIF_IMAGE" | "QUICKTIME" | "NO_MOOV" | "MOOV_TOO_LARGE";

export class Mp4ProbeFailure extends Error {
  constructor(public readonly code: Mp4ProbeError) {
    super(code);
  }
}

/** MP4 ailesi ana markaları (ISO/IEC 14496-12/14, 3GPP hariç). */
const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9", "mp41", "mp42", "mp71", "avc1", "M4V ", "M4VH", "M4VP", "mmp4", "dash", "msnv", "f4v "]);
/** HEIF/HEIC/AVIF görsel markaları — iPhone fotoğrafları da `ftyp` ile başlar. */
export const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1", "avif", "avis"]);
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
/** Kabul edilen kodekler: H.264 sorunsuz, HEVC uyarıyla. */
export const H264_CODECS = new Set(["avc1", "avc3"]);
export const HEVC_CODECS = new Set(["hvc1", "hev1"]);

/** Bir tamponun başındaki `ftyp` kutusunun ana markasını döner (yoksa `null`). */
export function ftypBrand(head: Buffer): string | null {
  if (head.length < 12 || head.subarray(4, 8).toString("latin1") !== "ftyp") return null;
  return head.subarray(8, 12).toString("latin1");
}

interface Box {
  type: string;
  /** Kutu gövdesinin (başlıktan sonra) tampon içindeki başlangıcı. */
  start: number;
  end: number;
}

/** Tampon içindeki ardışık kutuları dolaşır (bozuk boyutta durur). */
function* childBoxes(buf: Buffer, from: number, to: number): Generator<Box> {
  let offset = from;
  while (offset + 8 <= to) {
    let size = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("latin1");
    let header = 8;
    if (size === 1) {
      if (offset + 16 > to) return;
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < header || offset + size > to) return;
    yield { type, start: offset + header, end: offset + size };
    offset += size;
  }
}

function findChild(buf: Buffer, parent: Box, type: string): Box | null {
  for (const box of childBoxes(buf, parent.start, parent.end)) if (box.type === type) return box;
  return null;
}

function parseDuration(moov: Buffer, root: Box): number | null {
  const mvhd = findChild(moov, root, "mvhd");
  if (!mvhd || mvhd.end - mvhd.start < 32) return null;
  const version = moov[mvhd.start];
  const timescale = version === 1 ? moov.readUInt32BE(mvhd.start + 20) : moov.readUInt32BE(mvhd.start + 12);
  const duration = version === 1 ? Number(moov.readBigUInt64BE(mvhd.start + 24)) : moov.readUInt32BE(mvhd.start + 16);
  if (!timescale || duration === 0xffffffff) return null;
  return Math.round((duration / timescale) * 10) / 10;
}

function parseVideoCodec(moov: Buffer, root: Box): string | null {
  for (const trak of childBoxes(moov, root.start, root.end)) {
    if (trak.type !== "trak") continue;
    const mdia = findChild(moov, trak, "mdia");
    if (!mdia) continue;
    const hdlr = findChild(moov, mdia, "hdlr");
    if (!hdlr || hdlr.end - hdlr.start < 12 || moov.subarray(hdlr.start + 8, hdlr.start + 12).toString("latin1") !== "vide") continue;
    const minf = findChild(moov, mdia, "minf");
    const stbl = minf && findChild(moov, minf, "stbl");
    const stsd = stbl && findChild(moov, stbl, "stsd");
    // stsd: version/flags (4) + entry_count (4) + ilk giriş (boyut 4 + fourcc 4)
    if (!stsd || stsd.end - stsd.start < 16) continue;
    return moov.subarray(stsd.start + 12, stsd.start + 16).toString("latin1");
  }
  return null;
}

/** Diskteki dosyayı denetler. MP4 değilse `Mp4ProbeFailure` fırlatır. */
export async function probeMp4File(filePath: string, opts: { allowQuickTime?: boolean } = {}): Promise<Mp4ProbeResult> {
  const handle = await fs.open(filePath, "r");
  try {
    const { size: fileSize } = await handle.stat();
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, 16, 0);
    const brand = ftypBrand(head.subarray(0, bytesRead));
    if (!brand) throw new Mp4ProbeFailure("NOT_MP4");
    if (HEIF_BRANDS.has(brand)) throw new Mp4ProbeFailure("HEIF_IMAGE");
    const isQuickTime = brand === "qt  ";
    if (isQuickTime && !opts.allowQuickTime) throw new Mp4ProbeFailure("QUICKTIME");
    if (!isQuickTime && !MP4_BRANDS.has(brand)) throw new Mp4ProbeFailure("NOT_MP4");

    // Üst düzey kutuları yalnızca başlıklarından atlayarak dolaş.
    let offset = 0;
    let moov: { offset: number; size: number; header: number } | null = null;
    let mdatSeen = false;
    let moovBeforeMdat = false;
    const header = Buffer.alloc(16);
    while (offset + 8 <= fileSize) {
      await handle.read(header, 0, 16, offset);
      let size = header.readUInt32BE(0);
      const type = header.subarray(4, 8).toString("latin1");
      let headerSize = 8;
      if (size === 1) {
        size = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (size === 0) {
        size = fileSize - offset;
      }
      if (size < headerSize) break;
      if (type === "moov" && !moov) {
        moov = { offset, size, header: headerSize };
        moovBeforeMdat = !mdatSeen;
      }
      if (type === "mdat") mdatSeen = true;
      offset += size;
    }
    if (!moov) throw new Mp4ProbeFailure("NO_MOOV");
    if (moov.size > MAX_MOOV_BYTES) throw new Mp4ProbeFailure("MOOV_TOO_LARGE");

    const buf = Buffer.alloc(Math.min(moov.size, fileSize - moov.offset));
    await handle.read(buf, 0, buf.length, moov.offset);
    const root: Box = { type: "moov", start: moov.header, end: buf.length };
    return { majorBrand: brand, container: isQuickTime ? "mov" : "mp4", videoCodec: parseVideoCodec(buf, root), faststart: moovBeforeMdat, durationSec: parseDuration(buf, root) };
  } finally {
    await handle.close();
  }
}
