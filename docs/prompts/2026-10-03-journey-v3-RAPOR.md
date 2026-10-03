# Rapor: Yolculuk küresine "tam tur" dönüş eklendi (v3)

**Mod: Hızlı Mod** (görev dosyasının kendi beyanı — backend/Prisma/LiveKit/ödeme/randevu koduna dokunulmadı, yeni RUNTIME paketi eklenmedi).

Branch: `feature/journey-rotation`, `git fetch origin && git switch -c feature/journey-rotation origin/master`. Başlangıç noktası doğrulandı: `83d498b` (görev dosyasındaki beklenen commit ile birebir eşleşti).

---

## 1) Yapılan değişiklik — özet

### Küre artık sürekli dönüyor
- Batıdan doğuya, sabit hızla, **tam tur ~40 saniye** (`ROTATION_PERIOD_MS = 40000`). Eksen eğimi sabit (merkez enlem 32°) — yalnızca rotasyon boylamı (`rotationLon`) her karede artıyor.
- **Başlangıç görünümü v2 ile BİREBİR aynı**: mount olmadan önce (SSR + hydration-güvenli ilk kare) ve `prefers-reduced-motion` açıkken, journey-v2'nin durağan küresi (`StaticGlobe`) DEĞİŞMEDEN render edilir — ABD "kenara clamp" mantığı dahil. Mount + hareket açıkken `RotatingGlobe`'a geçiliyor.
- Kara noktaları, ülke noktaları, uçuş çizgileri, comet'ler, İstanbul nabzı ve etiketler küreyle birlikte dönüyor, her biri kendi gerçek coğrafi konumunda.
- **Arka yüz:** Görünürlük artık `cosC` tabanlı yumuşak bir çarpanla (`globe-math.ts::frontFactor`, 0 ile 0.15 arası doğrusal geçiş) kontrol ediliyor — pat diye kaybolma yok. Bu fonksiyon aynı zamanda eski "limb (kenar) soluklaşması" kovalarının da yerini aldı (cosC zaten merkeze-yakınlığın doğal ölçüsü).
- **Uçuş çizgileri:** Gerçek büyük daire (great-circle) yayları — `slerp` ile ara noktalar hesaplanıyor, yarıçap `1 + 0.12·sin(πt)` ile kaldırılıyor, her karede yeniden projekte ediliyor (`pathLength={1}` + ref-mutasyonlu `strokeDashoffset`). İstanbul arkaya geçtiğinde çizgiler ve "ISTANBUL" pill'i sönüyor; öne gelince çizgiler ülke sırasına göre ~0.4s arayla yeniden çiziliyor. Comet'ler yalnızca çizgi tam çizili VE İstanbul öndeyken akıyor.
- **ABD "kenara clamp" mantığı KALDIRILDI** (yalnızca `RotatingGlobe`'da) — dönüş sayesinde ABD doğal olarak öne gelip görünür oluyor (Playwright ekran görüntüsüyle doğrulandı, bkz. §5).
- **Etkileşim:** Fare küre üzerindeyken dönüş hızı üstel yumuşatmayla (~200ms zaman sabiti, ~600ms'de %95 yakınsama) 0'a iniyor; fare çıkınca aynı şekilde 1'e geri dönüyor. Sürükleyerek döndürme YOK (görev dosyasına göre gerekmiyor).
- **`prefers-reduced-motion`:** Dönüş hiç başlamıyor (`rAF` hiç çağrılmıyor — birim testiyle doğrulandı), bugünkü statik görünüm ABD clamp'ı dahil AYNEN kalıyor.

### Teknik mimari (performans kritik)
- **`globe-dots.ts` artık çiğ boylam/enlem saklıyor** (önceden-projekte-edilmiş x/y DEĞİL) — `generate-globe-dots.mjs` güncellendi, tüm küre (ön/arka ayrımı YOK) taranıp yeniden üretildi. 4.237 kara noktası, **52.336 byte (~51,1 KB)** — hedef <60KB karşılandı.
- **Kara noktaları `<canvas>` üzerinde çiziliyor** — tek `beginPath`+`arc` döngüsü, `devicePixelRatio` desteği (en fazla 2), her karede `clearRect`+yeniden çizim. 4000+ noktayı SVG düğümü olarak güncelleme YASAĞI karşılandı.
- Çizgiler/comet'ler/İstanbul/etiketler SVG/HTML katmanında ama **`ref` ile doğrudan mutasyon** (`setAttribute`/`style.x =`) — her karede React state güncellemesi YOK.
- **Çizim döngüsü** yalnızca bölüm görünür alandayken (`IntersectionObserver`) VE sekme aktifken (`document.visibilityState`) çalışıyor; aksi halde `cancelAnimationFrame` ile durduruluyor, görünürlük geri gelince yeniden başlıyor. Unmount'ta temizleniyor (birim testiyle doğrulandı).
- Mobilde (<768px) her ikinci nokta atlanıyor.
- **Ortak matematik modülü:** `frontend/src/components/site/home/globe-math.ts` — saf fonksiyonlar (`rotate`, `frontFactor`, `lonLatToVector`/`vectorToLonLat`, `slerp`, `greatCircleMidpoint`, `arcLift`), DOM/React bağımlılığı yok, ayrı birim testleri var.
- **SSR/hydration:** Mount olmadan önce HER ZAMAN `StaticGlobe` (sunucu ile ilk client render BİREBİR aynı) — canvas yalnızca client'ta, mount+hareket-açık koşuluyla devreye giriyor. Sabit `aspect-square` kutu sayesinde CLS yok.

### Gerçek bir hydration hatası bulundu ve düzeltildi (bu turda, görsel doğrulama sırasında)
Playwright'ın `reducedMotion: "reduce"` emülasyonuyla gerçek bir SSR+hydration testi yapılınca **"Hydration failed"** hatası yakalandı: `useReducedMotion()` sunucuda her zaman `null` dönüyor, ama OS düzeyinde "reduce motion" AÇIK bir kullanıcıda istemcinin İLK (hydration) render'ında `matchMedia` senkron `true` çözümleyebiliyor — ham `reduceMotion` doğrudan JSX dallanmasında (`GlobeFloat`, `StaticGlobe` iç dalları) kullanıldığı için sunucu "null→motion açık" dalını, istemcinin hydration-pass'i "true→motion kapalı" dalını render ediyordu. **Düzeltme:** `mounted` olmadan önce (SSR + ilk client render) `reduceMotion` HER ZAMAN `false` sayılıyor (her iki taraf da AYNI dalı render ediyor); gerçek OS tercihi yalnızca mount SONRASI, sıradan bir re-render'da uygulanıyor. Bu, v2'den beri var olan ama daha önce (gerçek SSR+Playwright ile reduced-motion emülasyonu test edilmediği için) fark edilmemiş gizli bir hataydı — bu turda tamamen giderildi, tekrar test edilip doğrulandı (artık hydration hatası YOK).

---

## 2) Test sonuçları

### Yeni/güncellenen testler

| Dosya | İçerik | Sonuç |
|---|---|---|
| `tests/unit/globe-math.test.ts` (yeni) | `rotate` determinizm + 0°/180° dönüş testleri, `frontFactor` ufuk bandı, `arcLift` (yarıçap>1, t=0/1'de=1), `slerp`/`greatCircleMidpoint` round-trip | ✅ 12/12 |
| `tests/unit/home-journey-rotation.test.tsx` (yeni) | Hareket AÇIKKEN: bölüm görünür olunca rAF BAŞLAR, unmount'ta `cancelAnimationFrame` ile DURUR | ✅ 1/1 |
| `tests/unit/home-journey-reduced-motion.test.tsx` (güncellendi, +1 test) | Mevcut statik-görünüm testi + YENİ: reduced-motion'da rAF HİÇ çağrılmıyor | ✅ 2/2 |
| `tests/unit/home-journey-globe.test.tsx` (güncellendi) | Mount sonrası RotatingGlobe'a geçiş — seçiciler implementasyondan bağımsız `data-flight-line`/`data-comet` kancalarına taşındı | ✅ 10/10 |
| `tests/unit/journey-map-block.test.tsx` (DEĞİŞMEDİ) | Büyük harf İSTANBUL pill'i, adım/ülke render | ✅ 7/7 |

### Tam suite
- Frontend `npx vitest run`: **1005/1006 geçti** — tek başarısız (`a11y-content-editor.test.tsx`, axe-core paralel yük çakışması) ÖNCEDEN BİLİNEN flaky davranış (bkz. journey-v2 ve önceki turların raporları); izole çalıştırınca temiz geçiyor.
- `npm run typecheck`: 0 hata.
- `npm run lint`: 0 hata, aynı 6 pre-existing uyarı (dokunulmamış dosyalarda).

### Kırmızı çizgi — mandatory testler
| Dosya | Sonuç |
|---|---|
| `backend/tests/unit/telehealth-livekit.test.ts` + `backend/tests/integration/telehealth-livekit.test.ts` + `telehealth-bookings.test.ts` + `telehealth-qa-regression.test.ts` | ✅ **77/77 PASS** (59+18) |
| `frontend/tests/unit/consultation-room-*.test.tsx` + `booking-wizard-stale-recovery.test.tsx` | ✅ **11/11 PASS** |

Bu turda **SIFIR backend dosyası** değişti (`git status` ile teyit edildi) — `package.json`/`package-lock.json` DEĞİŞMEDİ, yeni runtime bağımlılığı eklenmedi.

---

## 3) Playwright ekran görüntüleri ve ölçümler

Geçici yerel ortam (backend `tsx` :4002, frontend `next dev` :3101, `siteadi.localhost` host) + geçici bir izole önizleme rotası (`[lang]/(site)/zz-journey-preview`, 6 ülkeli tam içerik, test sonunda SİLİNDİ) üzerinden alındı:

| Ölçüm | Değer | Hedef | Durum |
|---|---|---|---|
| Masaüstü (1440px) bölüm yüksekliği, t=0 | 548px | ≤560px | ✅ |
| Masaüstü (1440px) bölüm yüksekliği, t=20s | 548px | ≤560px | ✅ (rotasyon layout'u etkilemiyor) |
| Mobil (375px) bölüm yüksekliği | 583,4px | "makul" | ✅ |
| Yatay taşma (her iki viewport) | 0px | 0px | ✅ |
| Ortalama FPS (in-page `requestAnimationFrame` sayaç, 3s, masaüstü) | **~60,1 fps** | ~60fps | ✅ |

**Görsel doğrulama (ekran görüntüleriyle teyit edildi):**
- **t=0:** v2 ile görsel olarak aynı — Avrupa/Orta Doğu/Afrika önde, ABD görünmüyor (clamp YOK, henüz rotasyonla öne gelmedi).
- **t=10s:** Küre gözle görülür şekilde dönmüş — Afrika/Asya farklı konumda, uçuş çizgileri kavisli (lift uygulanmış), etiketler yeni konumlarında.
- **t=20s:** İstanbul ve tüm uçuş çizgileri/pill tamamen sönmüş (arka yüzde), **ABD doğal rotasyonla öne gelmiş ve görünür** — görev dosyasının ana hedefi (clamp kaldırıldı, dönüş bunu kendiliğinden çözüyor) doğrulandı.
- **Hover-paused:** Fare küre üzerine geldikten ~1,5s sonra rotasyon gözle görülür şekilde yavaşlamış/durmuş.
- **Reduced-motion (t=3s):** v2'nin statik görünümü BİREBİR — ABD kenara clamp edilmiş, çizgiler tam çizili, hareket yok. Hydration hatası YOK (düzeltme sonrası doğrulandı).

---

## 4) Veri modeli

`journey-map` blok verisi ve admin editörü **DEĞİŞMEDİ**. Hiçbir yeni alan eklenmedi. Mevcut canlı `journey-map-block` id'li blok hiçbir migration/veri değişikliği olmadan yeni (dönen) tasarımla render olur.

**Bilinçli basitleştirme (görev kapsamında, raporda belirtilir):** Haritası olmayan (bilinmeyen) bir admin-girdisi ülke, `RotatingGlobe`'da ATLANIR (StaticGlobe'daki şematik yedek yalnızca statik/reduced-motion görünümde uygulanır). Ayrıca uçuş çizgisinin arka-yüzde kalan kısmı segment başına değil, çizginin tümü için tek bir opaklık çarpanıyla (iki ucun `frontFactor`'ının minimumu) soluklaştırılır. Her iki basitleştirme de görsel sonucu büyük ölçüde korurken DOM/hesap karmaşıklığını azaltır; varsayılan 6 ülkenin tamamı etkilenmez.

---

## 5) Değişen/eklenen dosyalar

```
M  frontend/src/components/site/home/home-journey.tsx       (RotatingGlobe/StaticGlobe mimarisi eklendi)
M  frontend/src/components/site/home/globe-dots.ts           (lon/lat formatına geçti, tüm küre, 4237 nokta, 52.336 byte)
M  frontend/scripts/generate-globe-dots.mjs                  (tüm küre taraması, x/y yerine lon/lat üretir)
M  frontend/tests/unit/home-journey-globe.test.tsx            (seçiciler data-flight-line/data-comet'e taşındı)
M  frontend/tests/unit/home-journey-reduced-motion.test.tsx   (+1 test: rAF başlamıyor)
A  frontend/src/components/site/home/globe-math.ts            (yeni — saf rotasyon/great-circle matematiği)
A  frontend/tests/unit/globe-math.test.ts                     (yeni)
A  frontend/tests/unit/home-journey-rotation.test.tsx          (yeni)
A  docs/prompts/2026-10-03-journey-v3-RAPOR.md                 (bu dosya)
```

Backend: **DEĞİŞMEDİ** (sıfır dosya). `package.json`/`package-lock.json`: **DEĞİŞMEDİ**.

Commit edilmedi (bu rapor dahil) — bir sonraki adım kendi değiştirdiğim dosyaları `git add` edip commit'lemek (push ETMEDEN).
