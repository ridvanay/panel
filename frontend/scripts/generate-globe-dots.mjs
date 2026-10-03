/**
 * `src/components/site/home/globe-dots.ts`'i ÜRETEN tek seferlik geliştirme script'i
 * (journey-v3 turu, 2026-10-03 — journey-v2'deki script'in rotasyon için güncellenmiş hali)
 * — bu script `d3-geo`/`world-atlas`/`topojson-client` KULLANIR ama bu paketler
 * `frontend/package.json`'a EKLENMEZ (yeni runtime bağımlılığı YASAK). Script yalnızca
 * GEÇİCİ bir klasörde, elle çalıştırılır:
 *
 *   mkdir -p /tmp/globe-gen && cd /tmp/globe-gen
 *   npm init -y
 *   npm install d3-geo@3 world-atlas@2 topojson-client@3
 *   cp <repo>/frontend/scripts/generate-globe-dots.mjs .
 *   node generate-globe-dots.mjs
 *   # çıktı ./globe-dots.ts dosyası — içeriğini <repo>/frontend/src/components/site/home/
 *   # globe-dots.ts'e yapıştır, geçici klasörü (node_modules dahil) sil.
 *
 * NE ÜRETİR (v3 DEĞİŞİKLİĞİ): Küre artık kendi etrafında SÜREKLİ DÖNDÜĞÜ için, noktalar
 * önceden belli bir merkeze göre PROJEKTE EDİLEMEZ — her kare farklı bir rotasyon açısıyla
 * yeniden projekte edilmesi gerekir (bkz. `globe-math.ts::rotate`). Bu yüzden bu script artık
 * x/y DEĞİL, ÇİĞ boylam/enlem (`[lon, lat]`, derece, 1 ondalık) üretir — projeksiyon
 * `home-journey.tsx`/`globe-math.ts` içinde RUNTIME'DA (her karede) yapılır. `world-atlas`'ın
 * `land-110m.json` kara-kütle TopoJSON'u + `d3-geo::geoContains` ile GERÇEK kara noktaları
 * (okyanus HİÇ nokta içermez) bulunur — artık TÜM KÜRE taranır (ön/arka yarım küre ayrımı
 * YOK, çünkü rotasyonla her nokta sırayla öne gelir).
 *
 * NEDEN STATİK DOSYA (runtime'da d3-geo/world-atlas/topojson-client ÇALIŞTIRILMAZ): (1) yeni
 * bir runtime paketi eklememek için, (2) "kara olup olmama" testinin (coğrafi, pahalı) bir
 * defaya mahsus yapılıp sabit veri olarak gömülmesi için. Runtime'da yalnızca basit trigonometri
 * (`globe-math.ts::rotate` — sin/cos) çalışır, bu da deterministik/performanslıdır.
 */
import { geoContains } from "d3-geo";
import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json" with { type: "json" };
import fs from "node:fs";

/** Enlem adımı (derece) — küçültmek nokta yoğunluğunu/sayısını artırır. Artık TÜM küre
 *  taranıyor (önceki v2 script'i sadece ön yarım küreyi tarıyordu), bu yüzden v2'ye göre
 *  daha büyük bir adım kullanılır — hedef <60KB dosya boyutu, 1 ondalık değerler. */
const LAT_STEP = 1.7;

const land = feature(landTopo, landTopo.objects.land);

const dots = [];
for (let lat = -84; lat <= 84; lat += LAT_STEP) {
  // Boylam adımı kutuplara yaklaştıkça genişler (1/cos(lat) ile ölçeklenir) — küre YÜZEYİNDE
  // kabaca tekdüze yoğunluk için, kutuplarda yığılma OLMAZ (görev dosyası §"Teknik yaklaşım").
  const lonStep = Math.min(6, LAT_STEP / Math.max(0.12, Math.cos((lat * Math.PI) / 180)));
  for (let lon = -180; lon < 180; lon += lonStep) {
    if (!geoContains(land, [lon, lat])) continue;
    dots.push([Math.round(lon * 10) / 10, Math.round(lat * 10) / 10]);
  }
}

console.log("dot count:", dots.length);

const out = `/**
 * Küre yüzeyindeki kara noktaları — ÇİĞ boylam/enlem (derece, 1 ondalık), TÜM KÜRE (ön/arka
 * yarım küre ayrımı YOK — küre sürekli döndüğü için her nokta sırayla öne gelir). GERÇEK kara
 * noktaları (d3-geo::geoContains + world-atlas land-110m.json ile üretildi, okyanus HİÇ nokta
 * içermez). Projeksiyon (ortografik, rotasyonlu) RUNTIME'DA \`globe-math.ts::rotate\` ile her
 * karede yapılır — bu dosya SABİT/STATİK veridir, ELLE DÜZENLENMEZ. Üretim: bkz.
 * \`frontend/scripts/generate-globe-dots.mjs\` dosya başı yorumu.
 */
export const GLOBE_DOTS: readonly (readonly [number, number])[] = ${JSON.stringify(dots)};
`;

fs.writeFileSync("globe-dots.ts", out);
console.log("bytes:", Buffer.byteLength(out, "utf8"));
