import { describe, expect, it } from "vitest";
import { rotate, frontFactor, slerp, lonLatToVector, vectorToLonLat, greatCircleMidpoint, arcLift } from "@/components/site/home/globe-math";
import { projectLonLat } from "@/components/site/home/home-journey";

/**
 * journey-v3 turu (2026-10-03) — küre rotasyonu ve great-circle yay matematiğinin saf
 * birim testleri (görev dosyası §"Test ve teslim"). Görsel/animasyon doğrulaması Playwright
 * ile ayrıca yapıldı (bkz. RAPOR) — burada yalnızca DETERMİNİSTİK matematik test edilir.
 */
describe("rotate — 0° dönüşte bugünkü konumlar korunur", () => {
  it("rotLon=25 (journey-v2'nin sabit merkezi) ile `projectLonLat` AYNI sonucu üretir", () => {
    const direct = rotate(28.97, 41.01, 25, 32);
    const legacy = projectLonLat(28.97, 41.01);
    expect(direct.x).toBeCloseTo(legacy.x, 3);
    expect(direct.y).toBeCloseTo(legacy.y, 3);
    expect(direct.cosC).toBeCloseTo(legacy.cosC, 3);
  });

  it("aynı girdi için HER ZAMAN bit-eş aynı sonucu üretir (determinizm)", () => {
    const a = rotate(10.45, 51.17, 25, 32);
    const b = rotate(10.45, 51.17, 25, 32);
    expect(a).toEqual(b);
  });
});

describe("rotate — 180° dönüşte İstanbul arka yüzde", () => {
  it("rotLon 25+180=205 iken İstanbul'un cosC'si NEGATİF (arka yarım küre)", () => {
    const rotated = rotate(28.97, 41.01, 205, 32);
    expect(rotated.cosC).toBeLessThan(0);
  });

  it("rotLon=25 (başlangıç) iken İstanbul ÖNDEDİR (cosC yüksek, referans)", () => {
    const start = rotate(28.97, 41.01, 25, 32);
    expect(start.cosC).toBeGreaterThan(0.9);
  });
});

describe("frontFactor — ufuk bandı (0..0.15) opaklık geçişi", () => {
  it("cosC<=0 iken tamamen saydam (0)", () => {
    expect(frontFactor(-0.1)).toBe(0);
    expect(frontFactor(0)).toBe(0);
  });
  it("cosC>=0.15 iken tam opak (1)", () => {
    expect(frontFactor(0.15)).toBe(1);
    expect(frontFactor(0.9)).toBe(1);
  });
  it("ara değerlerde (0..0.15) doğrusal geçiş — pat diye kaybolma YOK", () => {
    expect(frontFactor(0.075)).toBeCloseTo(0.5, 5);
  });
});

describe("arcLift — uçuş yayının yerden kalkışı, yarıçap > 1", () => {
  it("t=0 ve t=1'de yüzeyde (çarpan tam 1)", () => {
    expect(arcLift(0)).toBeCloseTo(1, 10);
    expect(arcLift(1)).toBeCloseTo(1, 10);
  });
  it("ara t değerlerinde (0,1) yay noktalarının yarıçap çarpanı HER ZAMAN > 1", () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(arcLift(t)).toBeGreaterThan(1);
    }
  });
  it("t=0.5'te en yüksek kaldırma (1.12)", () => {
    expect(arcLift(0.5)).toBeCloseTo(1.12, 5);
  });
});

describe("slerp / greatCircleMidpoint — büyük daire ara noktaları", () => {
  it("t=0'da `from`'a, t=1'de `to`'ya BİREBİR eşittir", () => {
    const a = lonLatToVector(10, 20);
    const b = lonLatToVector(50, -10);
    expect(slerp(a, b, 0)).toEqual(a);
    const atEnd = slerp(a, b, 1);
    expect(atEnd[0]).toBeCloseTo(b[0], 5);
    expect(atEnd[1]).toBeCloseTo(b[1], 5);
    expect(atEnd[2]).toBeCloseTo(b[2], 5);
  });

  it("greatCircleMidpoint t=0.5'te from/to arasında BİRİM KÜRE üzerinde bir nokta döndürür", () => {
    const mid = greatCircleMidpoint(0, 0, 90, 0, 0.5);
    // (0,0) ve (90,0) arasındaki büyük daire ekvator üzerindedir — orta nokta (45, 0) olmalı.
    expect(mid.lon).toBeCloseTo(45, 1);
    expect(mid.lat).toBeCloseTo(0, 1);
  });

  it("vectorToLonLat(lonLatToVector(x)) round-trip ORİJİNAL lon/lat'i verir", () => {
    const v = lonLatToVector(37.6, 55.75);
    const back = vectorToLonLat(v);
    expect(back.lon).toBeCloseTo(37.6, 5);
    expect(back.lat).toBeCloseTo(55.75, 5);
  });
});
