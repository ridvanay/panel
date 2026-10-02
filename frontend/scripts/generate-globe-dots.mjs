/**
 * `src/components/site/home/globe-dots.ts`'i ÜRETEN tek seferlik geliştirme script'i
 * (journey-v2 turu, 2026-10-03) — bu script `d3-geo`/`world-atlas`/`topojson-client`
 * KULLANIR ama bu paketler `frontend/package.json`'a EKLENMEZ (yeni runtime bağımlılığı
 * YASAK). Script yalnızca GEÇİCİ bir klasörde, elle çalıştırılır:
 *
 *   mkdir -p /tmp/globe-gen && cd /tmp/globe-gen
 *   npm init -y
 *   npm install d3-geo@3 world-atlas@2 topojson-client@3
 *   cp <repo>/frontend/scripts/generate-globe-dots.mjs .
 *   node generate-globe-dots.mjs
 *   # çıktı ./globe-dots.ts dosyası — içeriğini <repo>/frontend/src/components/site/home/
 *   # globe-dots.ts'e yapıştır, geçici klasörü (node_modules dahil) sil.
 *
 * NE ÜRETİR: `home-journey.tsx`'in kullandığı `GLOBE_DOTS` sabiti — ortografik (orthographic)
 * projeksiyon, merkez boylam/enlem `CENTER_LON`/`CENTER_LAT` (Avrupa/Orta Doğu/Rusya önde
 * görünecek şekilde — journey-v2 görev dosyasındaki tasarım hedefi). `world-atlas`'ın
 * `land-110m.json` kara-kütle TopoJSON'u + `d3-geo::geoContains` ile GERÇEK kara noktaları
 * (okyanus HİÇ nokta içermez) bulunur; yalnızca ÖN yarım küre (`cosC > 0.03` eşiği, kenara
 * yakın noktaları hafifçe içeri çeker) tutulur. Koordinatlar birim çember üzerinde
 * %-cinsinden (yarıçap=100) saklanır, 1 ondalığa yuvarlanır — `home-journey.tsx` bunları
 * KENDİ `GLOBE_RADIUS`'una göre ölçekler.
 *
 * NEDEN STATİK DOSYA (runtime'da d3-geo ÇALIŞTIRILMAZ): (1) yeni bir runtime paketi
 * eklememek için, (2) binlerce noktanın SSR/CSR arasında bit-eş kalması için — bu dosyadaki
 * sayılar ZATEN yuvarlanmış sabitlerdir, komponent onlardan `Math.sqrt` (IEEE754 "doğru
 * yuvarlama" GARANTİLİ, `Math.hypot`'un AKSİNE — bkz. önceki turun hydration dersi) ile
 * limb-fade türetir, hiçbir transcendental fonksiyon (sin/cos/hypot) ÇALIŞTIRMAZ.
 */
import { geoOrthographic, geoContains } from "d3-geo";
import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json" with { type: "json" };
import fs from "node:fs";

const CENTER_LON = 25;
const CENTER_LAT = 32;
/** Enlem adımı (derece) — küçültmek nokta yoğunluğunu/sayısını artırır. */
const LAT_STEP = 1.6;
/** Ön/arka yarım küre eşiği — küçük pozitif pay, kenar noktalarının "yarı görünür" titreşimini önler. */
const FRONT_HEMISPHERE_MARGIN = 0.03;

const land = feature(landTopo, landTopo.objects.land);

const projection = geoOrthographic().rotate([-CENTER_LON, -CENTER_LAT]).scale(1).translate([0, 0]);

function cosC(lon, lat) {
  const toRad = Math.PI / 180;
  const phi0 = CENTER_LAT * toRad;
  const phi = lat * toRad;
  const dLambda = (lon - CENTER_LON) * toRad;
  return Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(dLambda);
}

const dots = [];
for (let lat = -84; lat <= 84; lat += LAT_STEP) {
  // Boylam adımı kutuplara yaklaştıkça genişler — küre YÜZEYİNDE kabaca tekdüze yoğunluk için.
  const lonStep = Math.min(6, LAT_STEP / Math.max(0.12, Math.cos((lat * Math.PI) / 180)));
  for (let lon = -180; lon < 180; lon += lonStep) {
    if (cosC(lon, lat) <= FRONT_HEMISPHERE_MARGIN) continue;
    if (!geoContains(land, [lon, lat])) continue;
    const projected = projection([lon, lat]);
    if (!projected) continue;
    dots.push(projected);
  }
}

console.log("dot count:", dots.length);

// %-cinsinden (yarıçap=100), 1 ondalığa yuvarlanmış.
const scaled = dots.map(([x, y]) => [Math.round(x * 1000) / 10, Math.round(y * 1000) / 10]);

const out = `/**
 * Küre yüzeyindeki kara noktaları — ortografik (orthographic) projeksiyon, merkez boylam ${CENTER_LON}°,
 * enlem ${CENTER_LAT}° (Avrupa/Orta Doğu/Rusya önde). GERÇEK kara noktaları (d3-geo::geoContains +
 * world-atlas land-110m.json ile üretildi, okyanus HİÇ nokta içermez), yalnızca ÖN yarım küre.
 * Koordinatlar birim çember üzerinde %-cinsinden (yarıçap=100), 1 ondalığa yuvarlanmış — SABİT/
 * STATİK veri, bu dosya ELLE DÜZENLENMEZ. Üretim: bkz. \`frontend/scripts/generate-globe-dots.mjs\`
 * dosya başı yorumu.
 */
export const GLOBE_DOTS: readonly (readonly [number, number])[] = ${JSON.stringify(scaled)};
`;

fs.writeFileSync("globe-dots.ts", out);
console.log("bytes:", Buffer.byteLength(out, "utf8"));
