/**
 * journey-v3 turu (2026-10-03) — küre rotasyonu ve büyük daire (great-circle) yay matematiği.
 * Saf fonksiyonlar: DOM/React bağımlılığı YOK, birim testleri `globe-math.test.ts`'te.
 *
 * `rotate()` journey-v2'deki sabit-merkezli ortografik projeksiyonun BİREBİR AYNISI (aynı
 * formül, d3-geo'ya karşı sayısal doğrulanmıştı) — tek fark merkez boylamının (`rotLon`) artık
 * sabit bir modül sabiti DEĞİL, çağıran tarafın her karede değiştirdiği bir PARAMETRE olması
 * (bkz. `home-journey.tsx`'teki `rotationLon` ref'i). `y` ekran/d3 konvansiyonuyla aynı yönde
 * (kuzey = daha küçük/negatif y = ekranda yukarı).
 */

export interface RotatedPoint {
  x: number;
  y: number;
  cosC: number;
}

export function rotate(lon: number, lat: number, rotLon: number, tiltLat: number): RotatedPoint {
  const toRad = Math.PI / 180;
  const phi0 = tiltLat * toRad;
  const phi = lat * toRad;
  const dLambda = (lon - rotLon) * toRad;
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const cosDLambda = Math.cos(dLambda);
  const cosC = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosDLambda;
  const x = cosPhi * Math.sin(dLambda);
  const y = sinPhi0 * cosPhi * cosDLambda - cosPhi0 * sinPhi;
  return { x, y, cosC };
}

/** `cosC` → 0..1 opaklık eşlemesi. Tam arkada (`cosC<=0`) tamamen saydam, ufuk bandında
 *  (`0..LIMB_BAND`) yumuşak geçiş, önde (`cosC>=LIMB_BAND`) tam opak — görev dosyası
 *  §"Arka yüz": "Görünürlük cosC değerine bağlı olsun, ~0.0–0.15 aralığında opaklık geçişi.
 *  Kenarda pat diye kaybolmasın." Aynı fonksiyon limb (kenar) soluklaşması İÇİN DE kullanılır:
 *  `cosC` zaten merkeze-yakınlığın doğal ölçüsüdür (1=tam merkez, 0=tam ufuk/limb, <0=arka),
 *  bu yüzden ayrı bir "radyal mesafe kovası" mantığına gerek kalmaz. */
const LIMB_BAND = 0.15;
export function frontFactor(cosC: number): number {
  if (cosC <= 0) return 0;
  if (cosC >= LIMB_BAND) return 1;
  return cosC / LIMB_BAND;
}

type Vec3 = readonly [number, number, number];

/** Boylam/enlemi (derece) birim küre üzerinde bir 3B vektöre çevirir. */
export function lonLatToVector(lon: number, lat: number): Vec3 {
  const toRad = Math.PI / 180;
  const phi = lat * toRad;
  const lambda = lon * toRad;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)];
}

/** Birim küre vektörünü boylam/enleme (derece) çevirir — `lonLatToVector`'ın tersi. */
export function vectorToLonLat(v: Vec3): { lon: number; lat: number } {
  const toDeg = 180 / Math.PI;
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2]))) * toDeg;
  const lon = Math.atan2(v[1], v[0]) * toDeg;
  return { lon, lat };
}

/** İki birim vektör arasında küresel doğrusal enterpolasyon (slerp). `t=0`→a, `t=1`→b. */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const theta = Math.acos(dot) * t;
  if (theta === 0) return a;
  const relX = b[0] - a[0] * dot;
  const relY = b[1] - a[1] * dot;
  const relZ = b[2] - a[2] * dot;
  const relLength = Math.sqrt(relX * relX + relY * relY + relZ * relZ) || 1;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  return [
    a[0] * cosTheta + (relX / relLength) * sinTheta,
    a[1] * cosTheta + (relY / relLength) * sinTheta,
    a[2] * cosTheta + (relZ / relLength) * sinTheta,
  ];
}

/** `t=0`→from, `t=1`→to arasında büyük daire (great-circle) üzerindeki ara nokta (lon/lat).
 *  Görev dosyası §"Uçuş çizgileri": "slerp ile ara noktalar hesaplanır". */
export function greatCircleMidpoint(
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number,
  t: number
): { lon: number; lat: number } {
  const a = lonLatToVector(fromLon, fromLat);
  const b = lonLatToVector(toLon, toLat);
  return vectorToLonLat(slerp(a, b, t));
}

/**
 * Uçuş yayının yerden kalkış (lift) çarpanı — görev dosyası §"Uçuş çizgileri": "yarıçap
 * `1 + 0.12·sin(πt)` ile kaldırılır". `t=0`/`t=1`'de yüzeyde (çarpan 1), `t=0.5`'te en yüksek
 * (çarpan 1.12). Projekte edilen 2B noktanın (x,y) merkeze göre yarıçapını bu katsayıyla
 * ölçekleyerek uygulanır (bkz. `home-journey.tsx` — tam 3B derinlik-doğru raytracing YERİNE,
 * performans/basitlik için bu 2B radyal yaklaşıklık kullanılır — görsel sonuç eşdeğerdir).
 */
export function arcLift(t: number): number {
  return 1 + 0.12 * Math.sin(Math.PI * t);
}
