/**
 * §4.3 — `modern-architecture` şablonunun placeholder PNG'lerini üretir. YALNIZCA `node:zlib`
 * kullanır (bağımlılık YOK — `sharp`/`resvg` bu depoda yok ve eklenmez, code-quality-agent
 * bağımlılık politikası). Bildirimsel gradient/geometri tanımları
 * `assets/modern-architecture/DESIGN-NOTES.md` §7 tablosundan BİREBİR alınmıştır; `_source/*.svg`
 * dosyaları yalnızca İNSAN referansıdır, bu script ONLARI OKUMAZ/parse ETMEZ.
 *
 * ÇALIŞTIRMA (elle, bir kez — palet değişirse tekrar): `backend/` dizininden
 *   npx tsx scripts/build-template-assets.ts
 *
 * CI'da ÇALIŞMAZ, çalışma zamanında (`importer.ts`) ASLA çağrılmaz — yalnızca depoya COMMIT
 * edilecek `assets/modern-architecture/*.png` dosyalarını üretmek için tek seferlik bir
 * geliştirici aracıdır (`lib/appearance-presets.ts`'in elle güncellenmesiyle AYNI sınıf iş, §4.3).
 *
 * KABUL KRİTERİ (§4.3, bağlayıcı): çıktı `image-size` paketinin `imageSize()` fonksiyonuyla
 * PARSE EDİLEBİLİR olmalıdır — bu script'in sonunda her dosya için bunu doğrular.
 */

import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
import { imageSize } from "image-size";

/* ---------------------------------------------------------------------------------------------
 * PNG kodlayıcı — yalnızca node:zlib (deflate) ile, bağımlılıksız
 * ------------------------------------------------------------------------------------------- */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

/** `rgb`: `width*height*3` uzunluğunda düz RGB baytı (satır satır, filtre baytı YOK — burada eklenir). */
function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type 2 = truecolor (RGB, alfa YOK)
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0 (none) — basitlik için, gradient veri zaten yüksek sıkışır
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }

  const idatData = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idatData), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------------------------------------------------------------------------------------------
 * Çizim yardımcıları — bildirimsel gradient/geometri primitifleri
 * ------------------------------------------------------------------------------------------- */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
  }

  private index(x: number, y: number): number {
    return (y * this.width + x) * 3;
  }

  setPixel(x: number, y: number, color: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = this.index(x, y);
    this.data[i] = Math.round(color.r);
    this.data[i + 1] = Math.round(color.g);
    this.data[i + 2] = Math.round(color.b);
  }

  getPixel(x: number, y: number): Rgb {
    const i = this.index(x, y);
    return { r: this.data[i]!, g: this.data[i + 1]!, b: this.data[i + 2]! };
  }

  /** `opacityPercent` (0-100) — DESIGN-NOTES.md'nin "ince çizgi, %55 opaklık" gibi ifadeleriyle BİREBİR. */
  blendPixel(x: number, y: number, color: Rgb, opacityPercent: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const t = Math.min(100, Math.max(0, opacityPercent)) / 100;
    const current = this.getPixel(x, y);
    this.setPixel(x, y, lerpRgb(current, color, t));
  }

  /** Tüm tuvali bir fonksiyonla doldurur — gradient arka planlar için. */
  fill(colorAt: (x: number, y: number) => Rgb): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.setPixel(x, y, colorAt(x, y));
      }
    }
  }

  drawVLine(x: number, y0: number, y1: number, color: Rgb, opacityPercent: number, thickness = 2): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let t = 0; t < thickness; t++) this.blendPixel(x + t, y, color, opacityPercent);
    }
  }

  drawHLine(y: number, x0: number, x1: number, color: Rgb, opacityPercent: number, thickness = 2): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let t = 0; t < thickness; t++) this.blendPixel(x, y + t, color, opacityPercent);
    }
  }

  drawRectOutline(x0: number, y0: number, x1: number, y1: number, color: Rgb, opacityPercent: number, thickness = 2): void {
    this.drawHLine(y0, x0, x1, color, opacityPercent, thickness);
    this.drawHLine(y1, x0, x1, color, opacityPercent, thickness);
    this.drawVLine(x0, y0, y1, color, opacityPercent, thickness);
    this.drawVLine(x1, y0, y1, color, opacityPercent, thickness);
  }

  drawCircleOutline(cx: number, cy: number, radius: number, color: Rgb, opacityPercent: number, thickness = 2): void {
    const steps = Math.max(360, Math.round(radius * 4));
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      for (let t = 0; t < thickness; t++) {
        const x = Math.round(cx + (radius + t) * Math.cos(angle));
        const y = Math.round(cy + (radius + t) * Math.sin(angle));
        this.blendPixel(x, y, color, opacityPercent);
      }
    }
  }

  toPngBuffer(): Buffer {
    return encodePng(this.width, this.height, this.data);
  }
}

/** DESIGN-NOTES.md §7 — "linear <angle>°, `from` → `to`". Açı, CSS `linear-gradient` yönüne YAKIN (0° = yukarı, saat yönü). */
function linearGradientAt(width: number, height: number, x: number, y: number, angleDeg: number, from: Rgb, to: Rgb): Rgb {
  const rad = (angleDeg * Math.PI) / 180;
  // Yön vektörü (CSS'e yakın: 0° yukarı, 90° sağ).
  const dirX = Math.sin(rad);
  const dirY = -Math.cos(rad);
  // Merkezi orijine kaydırılmış koordinat, [-1, 1] aralığına normalize.
  const nx = (x / width) * 2 - 1;
  const ny = (y / height) * 2 - 1;
  const projection = nx * dirX + ny * dirY; // yaklaşık [-1.41, 1.41]
  const t = Math.min(1, Math.max(0, (projection + 1) / 2));
  return lerpRgb(from, to, t);
}

function radialGradientAt(width: number, height: number, x: number, y: number, center: Rgb, edge: Rgb): Rgb {
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  const t = Math.min(1, dist / maxDist);
  return lerpRgb(center, edge, t);
}

/* ---------------------------------------------------------------------------------------------
 * Palet (DESIGN-NOTES.md §1/§7 ile BİREBİR)
 * ------------------------------------------------------------------------------------------- */

const DARK_GREEN = hexToRgb("#1C4B42");
const DARK_GREEN_DEEP = hexToRgb("#12312B");
const ANTHRACITE = hexToRgb("#1F2124");
const ANTHRACITE_LIGHT = hexToRgb("#2B2E32");
const GOLD = hexToRgb("#C9A227");
const CREAM = hexToRgb("#F6F5F2");
const GOLD_TINT = hexToRgb("#EFE6CE");

/* ---------------------------------------------------------------------------------------------
 * Varlık üreticileri — DESIGN-NOTES.md §7 tablosu, satır satır
 * ------------------------------------------------------------------------------------------- */

function buildPortfolioCover1(): Buffer {
  // linear 135°, #1C4B42 → #12312B — "ikiz kule" (ince çizgi, %55 opaklık).
  const width = 1200;
  const height = 900;
  const canvas = new Canvas(width, height);
  canvas.fill((x, y) => linearGradientAt(width, height, x, y, 135, DARK_GREEN, DARK_GREEN_DEEP));

  canvas.drawRectOutline(430, 180, 540, 760, GOLD, 55, 3);
  canvas.drawRectOutline(620, 120, 720, 760, GOLD, 55, 3);
  for (let y = 220; y < 760; y += 60) {
    canvas.drawHLine(y, 430, 540, GOLD, 30, 1);
    canvas.drawHLine(y, 620, 720, GOLD, 30, 1);
  }
  return canvas.toPngBuffer();
}

function buildPortfolioCover2(): Buffer {
  // linear 135°, #1F2124 → #1C4B42 — "kademeli/teraslı yapı".
  const width = 1200;
  const height = 900;
  const canvas = new Canvas(width, height);
  canvas.fill((x, y) => linearGradientAt(width, height, x, y, 135, ANTHRACITE, DARK_GREEN));

  const steps = 5;
  let x0 = 320;
  let y0 = 760;
  for (let i = 0; i < steps; i++) {
    const stepWidth = 480 - i * 70;
    const stepTop = 760 - (i + 1) * 110;
    canvas.drawRectOutline(x0, stepTop, x0 + stepWidth, y0, GOLD, 50, 2);
    y0 = stepTop;
    x0 += 35;
  }
  return canvas.toPngBuffer();
}

function buildPortfolioCover3(): Buffer {
  // radial, #2B2E32 (merkez) → #1F2124 (kenar) — "kolonat / sütun sırası".
  const width = 1200;
  const height = 900;
  const canvas = new Canvas(width, height);
  canvas.fill((x, y) => radialGradientAt(width, height, x, y, ANTHRACITE_LIGHT, ANTHRACITE));

  const columnCount = 9;
  const marginX = 180;
  const spacing = (width - marginX * 2) / (columnCount - 1);
  for (let i = 0; i < columnCount; i++) {
    const x = Math.round(marginX + i * spacing);
    canvas.drawVLine(x, 200, 760, GOLD, 45, 4);
  }
  canvas.drawHLine(200, marginX, width - marginX, GOLD, 45, 3);
  canvas.drawHLine(760, marginX, width - marginX, GOLD, 45, 3);
  return canvas.toPngBuffer();
}

function buildPortfolioCover4(): Buffer {
  // linear 45°, #1C4B42 → #1F2124 — "farklı yükseklikte bina kümesi".
  const width = 1200;
  const height = 900;
  const canvas = new Canvas(width, height);
  canvas.fill((x, y) => linearGradientAt(width, height, x, y, 45, DARK_GREEN, ANTHRACITE));

  const heights = [420, 620, 500, 720, 380, 560];
  const blockWidth = 110;
  const gap = 24;
  let x = 200;
  for (const h of heights) {
    const top = 800 - h;
    canvas.drawRectOutline(x, top, x + blockWidth, 800, GOLD, 50, 2);
    x += blockWidth + gap;
  }
  return canvas.toPngBuffer();
}

function buildCtaBanner(): Buffer {
  // "sol/alt %100 düz #1F2124; sağ 1/3 linear #1F2124→#2B2E32" — sağ üçte birde ince çizgi
  // skyline, sol/alt TAMAMEN düz koyu (metin/pill buton için).
  const width = 1920;
  const height = 720;
  const canvas = new Canvas(width, height);
  const rightThirdStart = Math.round((width * 2) / 3);

  canvas.fill((x) => {
    if (x < rightThirdStart) return ANTHRACITE;
    const localT = (x - rightThirdStart) / (width - rightThirdStart);
    return lerpRgb(ANTHRACITE, ANTHRACITE_LIGHT, localT);
  });

  const skylineHeights = [180, 260, 140, 320, 200, 280, 160];
  const blockWidth = (width - rightThirdStart) / skylineHeights.length;
  skylineHeights.forEach((h, i) => {
    const x0 = Math.round(rightThirdStart + i * blockWidth + 12);
    const x1 = Math.round(rightThirdStart + (i + 1) * blockWidth - 12);
    const top = height - h;
    canvas.drawRectOutline(x0, top, x1, height - 40, GOLD, 45, 2);
  });

  return canvas.toPngBuffer();
}

function buildAboutImage(): Buffer {
  // linear 135°, #F6F5F2 → #EFE6CE — "ince çizgi cephe/kat planı" (#1C4B42) + altın kotasyon
  // çizgileri (#C9A227) + yumuşak ışık dairesi.
  const width = 1200;
  const height = 900;
  const canvas = new Canvas(width, height);
  canvas.fill((x, y) => linearGradientAt(width, height, x, y, 135, CREAM, GOLD_TINT));

  // Yumuşak ışık dairesi — merkeze yakın, düşük opaklıkla beyaza doğru "parlama".
  const glowCx = 780;
  const glowCy = 300;
  for (let radius = 220; radius > 0; radius -= 4) {
    const opacity = Math.max(0, 10 - radius / 25);
    if (opacity > 0) canvas.drawCircleOutline(glowCx, glowCy, radius, { r: 255, g: 255, b: 255 }, opacity, 3);
  }

  // Kat planı ince çizgileri (oda bölmeleri).
  canvas.drawRectOutline(200, 200, 1000, 700, DARK_GREEN, 60, 2);
  canvas.drawVLine(500, 200, 700, DARK_GREEN, 60, 2);
  canvas.drawVLine(760, 200, 460, DARK_GREEN, 60, 2);
  canvas.drawHLine(460, 200, 500, DARK_GREEN, 60, 2);
  canvas.drawHLine(460, 760, 1000, DARK_GREEN, 60, 2);

  // Altın kotasyon (ölçülendirme) çizgileri.
  canvas.drawHLine(760, 200, 1000, GOLD, 70, 1);
  canvas.drawVLine(150, 200, 700, GOLD, 70, 1);

  return canvas.toPngBuffer();
}

/* ---------------------------------------------------------------------------------------------
 * main
 * ------------------------------------------------------------------------------------------- */

const OUTPUT_DIR = path.join(__dirname, "..", "src", "modules", "demo-templates", "assets", "modern-architecture");

const GENERATORS: { file: string; build: () => Buffer }[] = [
  { file: "portfolio-cover-1.png", build: buildPortfolioCover1 },
  { file: "portfolio-cover-2.png", build: buildPortfolioCover2 },
  { file: "portfolio-cover-3.png", build: buildPortfolioCover3 },
  { file: "portfolio-cover-4.png", build: buildPortfolioCover4 },
  { file: "cta-banner.png", build: buildCtaBanner },
  { file: "about-image.png", build: buildAboutImage },
];

function main(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const { file, build } of GENERATORS) {
    const buffer = build();
    const outPath = path.join(OUTPUT_DIR, file);
    fs.writeFileSync(outPath, buffer);

    const dimensions = imageSize(buffer);
    const sizeKb = (buffer.byteLength / 1024).toFixed(1);
    console.log(`✓ ${file} — ${dimensions.width}×${dimensions.height}, ${sizeKb} KB`);
  }
}

main();
