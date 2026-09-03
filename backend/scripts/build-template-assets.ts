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
 * `ecommerce-pro` — `.claude/architect-scope-ecommerce-pro-template.md` §9.3/§7.2 +
 * `.claude/design-notes-ecommerce-storefront.md` §9-11. AYNI bağımlılıksız yaklaşım: kategori
 * kartları + ürün kapak/galeri görselleri `node:zlib` ile PNG, teknik dökümanlar düz PDF
 * sözdizimiyle (bağımlılık YOK) üretilir. Palet §9 ile BİREBİR.
 * ------------------------------------------------------------------------------------------- */

const EP_PRIMARY = hexToRgb("#1E3A8A");
const EP_SECONDARY = hexToRgb("#0F172A");
const EP_ACCENT = hexToRgb("#047857");
const EP_BACKGROUND = hexToRgb("#F8FAFC");
const EP_SURFACE = hexToRgb("#FFFFFF");

type EpMotif = "rings" | "curve" | "grid" | "dots";

/** design-notes §11 — 4 kategori motifi, deterministik (seed'e bağlı, `Math.random()` YOK). */
function drawEpMotif(canvas: Canvas, motif: EpMotif, color: Rgb, opacityPercent: number, seed: number): void {
  const { width, height } = canvas;
  switch (motif) {
    case "rings": {
      const cx = width * 0.52;
      const cy = height * 0.44;
      for (let radius = 70; radius <= 380; radius += 70) {
        canvas.drawCircleOutline(cx, cy, radius + seed * 12, color, opacityPercent, 2);
      }
      break;
    }
    case "curve": {
      const amplitude = height * 0.12;
      const baseY = height * 0.56;
      for (let x = 0; x < width; x += 2) {
        const y = Math.round(baseY + Math.sin((x / width) * Math.PI * 1.4 + seed) * amplitude);
        canvas.blendPixel(x, y, color, opacityPercent);
        canvas.blendPixel(x, y + 1, color, opacityPercent);
      }
      break;
    }
    case "grid": {
      const marginX = width * 0.16;
      const marginY = height * 0.2;
      const colStep = (width - marginX * 2) / 6;
      const rowStep = (height - marginY * 2) / 5;
      for (let i = 0; i <= 6; i++) {
        canvas.drawVLine(Math.round(marginX + i * colStep), marginY, height - marginY, color, opacityPercent, 2);
      }
      for (let i = 0; i <= 5; i++) {
        canvas.drawHLine(Math.round(marginY + i * rowStep), marginX, width - marginX, color, opacityPercent, 2);
      }
      break;
    }
    case "dots": {
      let state = (seed + 1) * 7919; // deterministik LCG — dosya her koşuda AYNI çıktıyı üretir
      const next = () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
      };
      for (let i = 0; i < 70; i++) {
        const x = Math.round(next() * width);
        const y = Math.round(next() * height);
        const r = 4 + Math.round(next() * 10);
        canvas.drawCircleOutline(x, y, r, color, opacityPercent, 2);
      }
      break;
    }
  }
}

/** design-notes §11 tablosu — kategori kartı: neredeyse düz zemin + %15-25 opaklık ince motif. */
function buildEpCategoryCard(motif: EpMotif, motifColor: Rgb): Buffer {
  const width = 1200;
  const height = 900;
  const canvas = new Canvas(width, height);
  canvas.fill((x, y) => linearGradientAt(width, height, x, y, 135, EP_BACKGROUND, EP_SURFACE));
  drawEpMotif(canvas, motif, motifColor, 20, 0);
  return canvas.toPngBuffer();
}

/**
 * §7.2 — ürün kapak/galeri görselleri: GERÇEK ürün fotoğrafı DEĞİL, kategori motifini düşük
 * opaklıkla yineleyen soyut bir "ürün kartı" silüeti (telif-güvenli, [DTI] §9 ile aynı disiplin).
 * `seed` kapak/galeri farkını verir (0=kapak, 1=galeri) — İKİSİ de aynı üretim fonksiyonundan.
 */
function buildEpProductPlaceholder(motif: EpMotif, motifColor: Rgb, seed: number): Buffer {
  const width = 1200;
  const height = 900;
  const canvas = new Canvas(width, height);
  canvas.fill((x, y) => linearGradientAt(width, height, x, y, seed === 0 ? 135 : 45, EP_BACKGROUND, EP_SURFACE));
  drawEpMotif(canvas, motif, motifColor, 12, seed);
  canvas.drawRectOutline(240, 190, 960, 770, motifColor, 35, 3);
  return canvas.toPngBuffer();
}

const EP_CATEGORY_GENERATORS: { file: string; build: () => Buffer }[] = [
  { file: "category-aydinlatma.png", build: () => buildEpCategoryCard("rings", EP_ACCENT) },
  { file: "category-oturma-grubu.png", build: () => buildEpCategoryCard("curve", EP_PRIMARY) },
  { file: "category-depolama.png", build: () => buildEpCategoryCard("grid", EP_SECONDARY) },
  { file: "category-aksesuar.png", build: () => buildEpCategoryCard("dots", EP_ACCENT) },
];

const EP_PRODUCT_MOTIFS: { slug: string; motif: EpMotif; color: Rgb }[] = [
  { slug: "silindirik-metal-masa-lambasi", motif: "rings", color: EP_ACCENT },
  { slug: "ayarlanabilir-lambader", motif: "rings", color: EP_ACCENT },
  { slug: "kadife-dosemeli-berjer-koltuk", motif: "curve", color: EP_PRIMARY },
  { slug: "katlanabilir-bahce-sandalyesi", motif: "curve", color: EP_PRIMARY },
  { slug: "moduler-raf-sistemi", motif: "grid", color: EP_SECONDARY },
  { slug: "ahsap-ayakkabilik-dolabi", motif: "grid", color: EP_SECONDARY },
  { slug: "desenli-dekoratif-yastik-seti", motif: "dots", color: EP_ACCENT },
  { slug: "cam-aromaterapi-difuzoru", motif: "dots", color: EP_ACCENT },
];

const EP_PRODUCT_GENERATORS: { file: string; build: () => Buffer }[] = EP_PRODUCT_MOTIFS.flatMap(({ slug, motif, color }) => [
  { file: `${slug}-cover.png`, build: () => buildEpProductPlaceholder(motif, color, 0) },
  { file: `${slug}-gallery-1.png`, build: () => buildEpProductPlaceholder(motif, color, 1) },
]);

/* ---------------------------------------------------------------------------------------------
 * §2.2/§7.2 — teknik döküman PDF'leri. Bağımlılıksız, düz PDF sözdizimi (klasik xref tablosu,
 * FlateDecode YOK — içerik zaten çok küçük, sıkıştırma gerektirmiyor). Görünür sayfa metni
 * BİLİNÇLİ OLARAK ASCII'dir (Türkçe "İ" gibi karakterler base-14 Helvetica/WinAnsiEncoding'de
 * güvenilir şekilde temsil edilemez); belgenin GERÇEK Türkçe başlığı `/Title` meta verisinde
 * UTF-16BE olarak taşınır (PDF spesifikasyonunun standart mekanizması) — böylece hem evrensel
 * görüntülenebilirlik hem doğru başlık aynı anda sağlanır.
 * ------------------------------------------------------------------------------------------- */

function pdfEscapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function utf16BeHexString(text: string): string {
  const bytes: number[] = [0xfe, 0xff]; // BOM — PDF metin dizgisini UTF-16BE olarak işaretler.
  for (const ch of text) {
    const codePoint = ch.codePointAt(0)!;
    if (codePoint > 0xffff) {
      const high = Math.floor((codePoint - 0x10000) / 0x400) + 0xd800;
      const low = ((codePoint - 0x10000) % 0x400) + 0xdc00;
      bytes.push(high >> 8, high & 0xff, low >> 8, low & 0xff);
    } else {
      bytes.push(codePoint >> 8, codePoint & 0xff);
    }
  }
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tek sayfalık, bağımsız (harici font/görsel gömme YOK) yer tutucu teknik döküman PDF'i üretir. */
function buildPlaceholderPdf(input: { titleAscii: string; bodyLines: string[]; metaTitleTurkish: string }): Buffer {
  let contentStream = "BT\n/F1 20 Tf\n60 780 Td\n";
  contentStream += `(${pdfEscapeText(input.titleAscii)}) Tj\n`;
  contentStream += "/F1 11 Tf\n";
  for (const line of input.bodyLines) {
    contentStream += `0 -22 Td\n(${pdfEscapeText(line)}) Tj\n`;
  }
  contentStream += "ET\n";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}endstream`,
    `<< /Title <${utf16BeHexString(input.metaTitleTurkish)}> /Producer (ecommerce-pro demo sablonu uretici script) >>`,
  ];

  const header = "%PDF-1.4\n";
  let body = header;
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(body, "utf8");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(body + xref + trailer, "utf8");
}

const EP_PDF_GENERATORS: { file: string; build: () => Buffer }[] = [
  {
    file: "tech-doc-1.pdf",
    build: () =>
      buildPlaceholderPdf({
        titleAscii: "ORNEK TEKNIK DOKUMAN - YER TUTUCU",
        bodyLines: [
          "Bu belge bir DEMO SABLONU yer tutucusudur.",
          "Gercek bir urune ait teknik icerik ICERMEZ.",
          "Sablon: ecommerce-pro | Magaza: Ferah Ev Yasam",
        ],
        metaTitleTurkish: "ÖRNEK TEKNİK DÖKÜMAN — YER TUTUCU 1",
      }),
  },
  {
    file: "tech-doc-2.pdf",
    build: () =>
      buildPlaceholderPdf({
        titleAscii: "ORNEK TEKNIK DOKUMAN - YER TUTUCU",
        bodyLines: [
          "Bu belge bir DEMO SABLONU yer tutucusudur.",
          "Gercek bir urune ait teknik icerik ICERMEZ.",
          "Sablon: ecommerce-pro | Magaza: Ferah Ev Yasam",
        ],
        metaTitleTurkish: "ÖRNEK TEKNİK DÖKÜMAN — YER TUTUCU 2",
      }),
  },
];

/* ---------------------------------------------------------------------------------------------
 * main
 * ------------------------------------------------------------------------------------------- */

const OUTPUT_DIR = path.join(__dirname, "..", "src", "modules", "demo-templates", "assets", "modern-architecture");
const EP_OUTPUT_DIR = path.join(__dirname, "..", "src", "modules", "demo-templates", "assets", "ecommerce-pro");

const GENERATORS: { file: string; build: () => Buffer }[] = [
  { file: "portfolio-cover-1.png", build: buildPortfolioCover1 },
  { file: "portfolio-cover-2.png", build: buildPortfolioCover2 },
  { file: "portfolio-cover-3.png", build: buildPortfolioCover3 },
  { file: "portfolio-cover-4.png", build: buildPortfolioCover4 },
  { file: "cta-banner.png", build: buildCtaBanner },
  { file: "about-image.png", build: buildAboutImage },
];

function writePngAssets(outputDir: string, generators: { file: string; build: () => Buffer }[]): void {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const { file, build } of generators) {
    const buffer = build();
    fs.writeFileSync(path.join(outputDir, file), buffer);

    const dimensions = imageSize(buffer);
    const sizeKb = (buffer.byteLength / 1024).toFixed(1);
    console.log(`✓ ${file} — ${dimensions.width}×${dimensions.height}, ${sizeKb} KB`);
  }
}

function writePdfAssets(outputDir: string, generators: { file: string; build: () => Buffer }[]): void {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const { file, build } of generators) {
    const buffer = build();
    fs.writeFileSync(path.join(outputDir, file), buffer);
    const sizeKb = (buffer.byteLength / 1024).toFixed(1);
    console.log(`✓ ${file} — ${sizeKb} KB (PDF)`);
  }
}

function main(): void {
  writePngAssets(OUTPUT_DIR, GENERATORS);
  writePngAssets(EP_OUTPUT_DIR, [...EP_CATEGORY_GENERATORS, ...EP_PRODUCT_GENERATORS]);
  writePdfAssets(EP_OUTPUT_DIR, EP_PDF_GENERATORS);
}

main();
