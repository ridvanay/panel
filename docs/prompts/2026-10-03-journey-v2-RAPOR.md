# Rapor: "From Across the World to Istanbul" bölümünü yeniden tasarla (v2)

**Mod: Hızlı Mod** (gerekçe: Prisma/LiveKit/ödeme/randevu koduna dokunulmadı, yeni RUNTIME paketi eklenmedi — ajanlara dağıtılmadı, bu oturumda doğrudan uygulandı).

Branch: `feature/journey-v2`, `origin/master`'dan açıldı. Başlangıç noktası doğrulandı: `d6283d4` (görev dosyasındaki beklenen commit ile birebir eşleşti — `feature/wm-health-oct-content` ve `feature/home-journey-faq-blocks` meanwhile başka bir oturum tarafından master'a merge edilmiş).

---

## 1) Yapılan değişiklik — özet

`components/site/home/home-journey.tsx` TAMAMEN yeniden yazıldı (veri modeli/dışa açık prop imzası DEĞİŞMEDİ — `journey-map` bloğu ve `home-page` şablonu kod değişikliği GEREKTİRMEDEN yeni tasarımla render olur):

- **Gerçek dünya küresi:** Ortografik (orthographic) projeksiyon, merkez boylam 25°/enlem 32° (Avrupa/Orta Doğu/Rusya önde). Kara kütlesi `frontend/scripts/generate-globe-dots.mjs` (d3-geo + world-atlas + topojson-client — **geçici bir klasörde**, `package.json`'a hiç girmeden) ile üretilip `src/components/site/home/globe-dots.ts`'e statik, 1-ondalık-yuvarlanmış veri olarak gömüldü.
- **Ülke konumları gerçek koordinatlardan** (`COUNTRY_COORDINATES`, EN+TR etiket anahtarlı) aynı projeksiyonla hesaplanıyor. ABD (arka yarım küre) yön vektörü normalize edilip kürenin SOL kenarına "clamp" ediliyor — tam istenen "referanstaki Amerika gibi" davranış.
- **Uçuş çizgileri:** Yukarı kavisli quadratic Bezier, sırayla (~0.4s) `pathLength` ile çizilir, uçlara doğru şeffaflaşan `--site-primary` gradyanı. Çizildikten sonra her rota üzerinde framer-motion keyframe-örneklemeli bir "comet" (glow filtreli) sürekli İstanbul'a akar.
- **İstanbul:** beyaz merkez nokta + 2 kademeli nabız halkası + dolu `--site-primary` "ISTANBUL" pill'i (koyu yazı, `color-mix` ile türetilmiş — SABİT HEX YOK).
- **Sol kolon:** kompakt 2×2 adım akışı — numara dairesi (01-04) + tek satır başlık, açıklama metni (`step.text`) görsel olarak KALDIRILDI ama `title` niteliği + `sr-only` metin olarak erişilebilir kaldı. 2.5s'de bir döngüsel vurgu + ok/çizgi dolumu.
- **Zemin:** `color-mix(in oklch, var(--site-accent) 32%, black)` — SABİT HEX YOK, görev dosyasının `--site-accent`/`--site-primary` eşlemesi BİREBİR izlendi.
- **Mobil:** küre üstte, metin+adımlar altta 2 sütun; yatay taşma YOK (Playwright ile ölçüldü, 0px).
- **`prefers-reduced-motion`:** comet, nabız halkaları ve küre "float" hareketi HİÇ render edilmez; çizgiler tam çizili, ilk adım sabit vurgulu — ayrı bir testle kanıtlandı.

---

## 2) `globe-dots.ts` dosya boyutu

**42.552 byte (~41,6 KB)** — hedef <60KB karşılandı. 3.315 kara noktası (hedef 2.000-3.500 aralığında).

---

## 3) Bölüm yüksekliği (Playwright ile ölçüldü)

| Viewport | Yükseklik | Hedef | Durum |
|---|---|---|---|
| Masaüstü 1440px | **548px** | ≤560px | ✅ |
| Mobil 375px | 612.6px | "makul" (sayısal hedef yok) | — |
| Yatay taşma (her iki viewport) | **0px** | 0px | ✅ |

İlk ölçümde masaüstü 572px çıktı (12px fazla) — `lg:py-14` → `lg:py-11` (dikey padding küçültme) ile 548px'e indirildi, başka hiçbir içerik/düzen değişikliği gerekmedi.

---

## 4) Test sonuçları

### Yeni testler

| Dosya | Testler | Sonuç |
|---|---|---|
| `tests/unit/home-journey-globe.test.tsx` | `projectLonLat` determinizm (aynı girdi → bit-eş çıktı), İstanbul'un cosC~1/merkeze yakınlığı, ABD'nin arka-yarım-küre (cosC≤eşik) olduğu, `resolveCountryPosition` ile İSTANBUL_POINT'in merkeze yakınlığı, ABD'nin kenara (rim) clamp edildiği VE sol tarafta kaldığı, Almanya'nın clamp EDİLMEDİĞİ, bilinmeyen bir ülkenin şematik yedeğe düştüğü, TR/EN etiketlerin AYNI koordinata eşlendiği, reduced-motion KAPALIYKEN comet'in render edildiği, genel içerik regresyonu | ✅ 10/10 |
| `tests/unit/home-journey-reduced-motion.test.tsx` | `prefers-reduced-motion` AÇIKKEN comet/nabız HİÇ render edilmez, çizgiler yine DOM'da | ✅ 1/1 |
| `tests/unit/journey-map-block.test.tsx` (güncellendi) | İstanbul pill'inin artık BÜYÜK HARF render edildiğine göre 2 assertion düzeltildi (davranış kasıtlı değişiklik, regresyon DEĞİL) | ✅ 7/7 (toplam dosya) |

### Tam suite

| Suite | Sonuç |
|---|---|
| Frontend `npx vitest run` | **988/991 geçti** (3 başarısız — `a11y-content-editor.test.tsx` (2) + `home-page-template.test.tsx` (1), hepsi axe-core'un paralel yük altında zaman aşımına uğradığı ÖNCEDEN BİLİNEN flaky davranış — bkz. önceki turun RAPOR'u, İZOLE çalıştırınca 18/18 PASS) |
| Frontend `npm run typecheck` | 0 hata |
| Frontend `npm run lint` | 0 hata, 6 pre-existing uyarı (dokunulmamış dosyalarda) |
| Backend | Bu turda SIFIR backend dosyası değişti (`git status` ile teyit edildi) — backend suite'i tekrar çalıştırmaya gerek yoktu, sadece KIRMIZI ÇİZGİ testleri aşağıda doğrulandı |

### Kırmızı çizgi — mandatory testler (bizzat çalıştırıldı)

| Dosya | Sonuç |
|---|---|
| `backend/tests/unit/telehealth-livekit.test.ts` + 3 entegrasyon dosyası | ✅ **77/77 PASS** |
| `frontend/tests/unit/consultation-room-*.test.tsx` + `booking-wizard-stale-recovery.test.tsx` | ✅ **11/11 PASS** |

`git status --short -- backend frontend docs` çıktısı: **bu turda yalnızca `frontend/` içinde değişiklik var** (`home-journey.tsx`, `globe-dots.ts` [yeni], `generate-globe-dots.mjs` [yeni], 2 yeni test dosyası + 1 güncellenen test). KIRMIZI ÇİZGİ listesindeki hiçbir dosya (LiveKit/booking/consultation/`docker-compose.yml`/`.env*`/`globals.css`/layout) bu listede YOK. `package.json`/`package-lock.json` DEĞİŞMEDİ — yeni runtime bağımlılığı eklenmedi.

---

## 5) Ekran görüntüleri

Geçici yerel ortam (backend `tsx` 4002, frontend `next dev` 3101 — prod-benzeri docker stack'e dokunulmadı) + geçici bir test sayfasında (6 ülkeli tam varsayılan içerik), **gerçek WM Health marka renkleriyle** (`SiteAppearance.primaryColor=#4ab9e1`, `accentColor=#2951a0` — test DB'nin kendi varsayılanı jenerik indigo/amber olduğu için, görsel doğruluk için GEÇİCİ olarak ayarlandı, doğrulama sonunda ORİJİNAL değerlerine geri alındı) alındı:

- `desktop-1440-start.png` / `desktop-1440-after4s.png` — animasyon başlangıcı (ilk çizgi çiziliyor) ve 4 saniye sonrası (tüm çizgiler çizili, adım 02 aktif, comet'ler akıyor).
- `mobile-375-start.png` / `mobile-375-after4s.png` / `mobile-375-fullpage.png` — küre üstte, 2 sütun adım akışı altta, yatay taşma yok.
- `reduced-motion.png` — adım 01 sabit vurgulu, nabız halkası YOK, tüm çizgiler tam çizili.

(Ekran görüntüleri proje dışı geçici bir dizinde tutuluyor, repoya commit edilmedi.)

**Gözlemlenen, koda özgü OLMAYAN bir ayrıntı:** Next.js fetch önbelleği yüzünden `SiteAppearance` güncellemesi ilk denemede yansımadı — dev sunucusu yeniden başlatılınca düzeldi (prod'da sorun değil, her deploy zaten taze başlar).

---

## 6) Veri modeli

`journey-map` blok verisi ve admin editörü **DEĞİŞMEDİ** — `HomeJourneyContent` (eyebrow/title/body/steps/countries) aynı kaldı. Hiçbir yeni ALAN eklenmedi (görev dosyası "yeni alan gerekiyorsa opsiyonel ekle" dedi ama gerekmedi — ülke koordinatları `label` metninden bir LOOKUP tablosuyla türetiliyor, veri şemasına dokunulmadan). Mevcut canlı `journey-map-block` id'li blok hiçbir migration/veri değişikliği olmadan yeni tasarımla render olur.

---

## 7) Değişen/eklenen dosyalar

```
M  frontend/src/components/site/home/home-journey.tsx     (tamamen yeniden yazıldı)
M  frontend/tests/unit/journey-map-block.test.tsx          (2 assertion güncellendi — büyük harf pill)
A  frontend/src/components/site/home/globe-dots.ts         (yeni, 42.552 byte)
A  frontend/scripts/generate-globe-dots.mjs                (yeni, dev-only üretim script'i)
A  frontend/tests/unit/home-journey-globe.test.tsx         (yeni)
A  frontend/tests/unit/home-journey-reduced-motion.test.tsx (yeni)
A  docs/prompts/2026-10-03-journey-v2-RAPOR.md              (bu dosya)
```

Commit edilmedi (bu rapor dahil) — bir sonraki adım kendi değiştirdiğim dosyaları `git add` edip commit'lemek (push ETMEDEN).
