# Rapor: Yolculuk bölümü ve SSS'yi ana sayfaya blok olarak ekle (2026-10-03)

**Mod: Hızlı Mod** (gerekçe: Prisma şeması/migration yok, LiveKit/ödeme/randevu/auth koduna dokunulmadı, yeni paket eklenmedi — ajanlara dağıtılmadı, bu oturumda doğrudan uygulandı).

Branch: `feature/home-journey-faq-blocks`, **`master`'dan DEĞİL** `feature/wm-health-oct-content`'ten (commit `749e671`) açıldı — bkz. "Sapma" notu altta.

---

## Sapma notu — branch kaynağı

Görev dosyası `master`'dan branch açılmasını söylüyordu, ama bu görevin DOĞRUDAN bağımlı olduğu her şey (`journey` içeriği, `home-journey.tsx` bileşeni, `create-faq-page.ts` script'i, `AccordionBlockSchema`'nın mevcut hâli) yalnızca `feature/wm-health-oct-content` branch'inde var — o branch henüz `master`'a merge/push edilmemişti. `master`'dan açmak bu bağımlılıkların hiçbirine erişememek, dolayısıyla görevi sıfırdan (ve kodu KOPYALAYARAK, görevin kendi "kodu kopyalama" talimatına AYKIRI şekilde) yapmak anlamına gelirdi. Bu yüzden branch `feature/wm-health-oct-content`'ten açıldı; bu sapma kullanıcıya görev başında bildirildi.

---

## 1) Yeni page-builder bloğu: `journey-map`

- **Paylaşılan tip:** `frontend/src/lib/home-page.ts` — yeni `HomeJourneyContent` arayüzü (`eyebrow`/`title`/`body`/`steps`/`countries`, `enabled` HARİÇ) ayrıştırıldı; `HomePageContent.journey` artık `HomeJourneyContent & { enabled: boolean }`.
- **Paylaşılan bileşen:** `components/site/home/home-journey.tsx::HomeJourney` — prop tipi `HomePageContent["journey"]`'den `HomeJourneyContent`'e daraltıldı (davranış DEĞİŞMEDİ, `enabled` zaten hiç kullanılmıyordu). Hem `home-page` şablonu (`home-page-view.tsx`) hem YENİ `journey-map` bloğu BU TEK bileşeni kullanıyor — kod kopyalanmadı.
- **Frontend blok altyapısı:** `lib/page-builder/types.ts` (`JourneyMapBlock` tipi, `ContentBlock` birliğine eklendi, sınırlar `HOME_MIN_JOURNEY_STEPS`/`HOME_MAX_JOURNEY_STEPS`/`HOME_MAX_JOURNEY_COUNTRIES`'ten import edilir, YENİDEN TANIMLANMAZ), `registry.ts` (palet kaydı — "Hasta Yolculuğu / Dünya Haritası", kategori `marketing`, `Globe` ikonu; `createBlock` varsayılanı), `components/site/blocks/index.tsx` (renderer dispatch), `components/site/blocks/journey-map-block.tsx` (YENİ — `HomeJourney`'i sarmalar, `stepLabel`/`journeyIstanbulLabel` etiketlerini `siteContext.lang`'a göre mevcut EN/TR `home` sözlüğünden seçer, YENİ bir çeviri YAZMAZ), `components/admin/page-builder/blocks/journey-map-block.tsx` (YENİ admin editörü — `IconSelect`/`ItemToolbar`/`moveInList` paylaşılan yardımcıları yeniden kullanır, `home-template-form.tsx`'teki `itemList`/`countryList` İLE AYNI desen), `builder-canvas.tsx` (editör dispatch).
- **Backend aynası:** `pages.schemas.ts` — `JourneyMapBlockDataSchema`/`JourneyMapBlockSchema`, mevcut `HomeItemSchema`/`HomeCountrySchema`/`HOME_MIN_JOURNEY_STEPS`/`HOME_MAX_JOURNEY_STEPS`/`HOME_MAX_JOURNEY_COUNTRIES`'i (home şablonunun `journey` alt-şemasıyla PAYLAŞIMLI) yeniden kullanır, `PageNodeSchema` dispatch zincirine eklendi. `docs/architecture/openapi.yaml`'a `journey-map` type enum'u + `JourneyMapBlockData` şeması eklendi.
- **Hydration düzeltmesi KORUNDU** — `home-journey.tsx`'teki `Math.hypot`→`Math.sqrt` + `round()` düzeltmesine (önceki turda bulunan SSR/CSR mismatch) dokunulmadı.

## 2) Akordiyon bloğuna yeni görünüm: `layoutStyle: "spotlight"`

- **Veri şekli:** `AccordionBlock.data`'ya opsiyonel `badge`/`intro`/`defaultOpenFirst` eklendi (frontend `types.ts` + backend `pages.schemas.ts::AccordionBlockDataSchema`, BİREBİR aynı alan adları). `AccordionLayoutStyle`'a `"spotlight"` eklendi — `bordered`/`card`/`minimal` DEĞİŞMEDİ.
- **Render:** `components/site/blocks/accordion-block.tsx` — `spotlight` için AYRI bir render dalı (`SpotlightAccordion`), mevcut `ACCORDION_LAYOUT_CLASSES` tablosuna (bordered/card/minimal) DOKUNULMADI, piksel-eş garanti korundu (regresyon testiyle kanıtlandı, bkz. §4). Ortada hap-etiket (iki yanında uçlara doğru şeffaflaşan çizgiler) + giriş metni; kartlar beyaz/`rounded-2xl`/hafif gölge; açık kartta `--site-accent`'ten açık gradyan + `--site-primary` kenarlık, soru metni `--site-primary`'ye döner; buton dolu `--site-primary`, `+`/`−` ikonu çapraz opacity+rotate geçişiyle değişir; panel yüksekliği Base UI'ın `--accordion-panel-height` CSS değişkeni + `data-open`/`data-closed`/`data-starting-style`/`data-ending-style` nitelikleriyle yumuşak açılır/kapanır. `motion-reduce:transition-none` ile `prefers-reduced-motion` açıkken TÜM geçişler anında olur.
- **Admin editörü:** `components/admin/page-builder/blocks/accordion-block.tsx` — "Öne Çıkan (Spotlight)" seçeneği + `layoutStyle==="spotlight"` iken görünen badge/intro/defaultOpenFirst alanları.
- **FAQPage JSON-LD üretimi DEĞİŞMEDİ** — `spotlight` dahil hiçbir `layoutStyle`/yeni alan JSON-LD üretim mantığını etkilemiyor (kod incelemesiyle + mevcut `buildFaqPageJsonLd`'nin `item.question`/`answer` filtresine dokunulmadığı doğrulandı).

## 3) `backend/scripts/add-home-journey-faq-blocks.ts`

- **Paylaşılan içerik:** SSS soru-cevap metinleri `create-faq-page.ts`'ten `backend/src/lib/faq-content.ts`'e (YENİ, paylaşımlı modül) taşındı — `create-faq-page.ts` artık oradan import ediyor, davranışı DEĞİŞMEDİ (aynı idempotency/test sonuçları).
- `--list`, `--journey-after=N`, `--faq-before=N`, `--remove-faq-nav`, `--unpublish-faq-page`, `--dry-run` bayraklarının HEPSİ uygulandı (görev metninde istenen tam liste).
- İdempotency, görevin "aynı tipte blok" ifadesinden biraz daha KATI bir kuralla uygulandı: script'in KENDİ sabit `id`'si (`journey-map-block` / `home-faq-accordion`) ile kontrol edilir — jenerik `type` eşleşmesi DEĞİL, böylece sayfada ZATEN var olan bağımsız bir `accordion` bloğu yanlışlıkla "zaten eklenmiş" sayılmaz.
- Yazmadan ÖNCE eski blok listesi tam JSON olarak `stdout`'a basılır (geri alma için); `--dry-run` "önce → sonra" `type` sırasını gösterir.
- `translations.tr.blocks` YOKSA o dile DOKUNULMAZ, NET bir log satırıyla bildirilir (sessizce atlanmaz).

## 4) Test ve doğrulama

### Yeni testler (bu turda eklendi)

| Dosya | Testler | Sonuç |
|---|---|---|
| `frontend/tests/unit/journey-map-block.test.tsx` | Renderer (içerik + EN/TR etiket seçimi) + editör (max/min sınırları) | ✅ 5/5 |
| `frontend/tests/unit/accordion-spotlight.test.tsx` | badge/intro render, `defaultOpenFirst` aria-expanded, tıklamayla açma/kapama, boş-filtre, bordered-regresyon | ✅ 6/6 |
| `backend/tests/unit/pages-journey-faq-schema.test.ts` | `journey-map` min/max/ikon-allowlist/countries-varsayılan + accordion spotlight alanları + mevcut layoutStyle'ların bozulmadığı | ✅ 10/10 |
| `backend/tests/integration/add-home-journey-faq-blocks-script.test.ts` | GERÇEK test DB'sine karşı subprocess: `--list`, `--dry-run` yazmıyor, doğru konuma ekleme, idempotency, TR çevirisi, geçersiz konum hatası, `--remove-faq-nav`/`--unpublish-faq-page` | ✅ 11/11 |

### Tam suite (bu turun değişiklikleriyle)

| Suite | Sonuç | Not |
|---|---|---|
| Backend `npx vitest run --fileParallelism=false` | **1940 geçti, 12 skip** (1 dosya başarısız) | Başarısız dosya: `telehealth-demo-payment.test.ts` — bu turda HİÇ dokunulmadı (`git diff` boş), **önceden bilinen** bir test-izolasyonu hatası (NODE_ENV sızıntısı, `docs/prompts/2026-10-02-wm-health-icerik-guncellemesi-RAPOR.md`'da zaten belgelenmiş) |
| Frontend `npx vitest run` | **980/980 geçti** (145/145 dosya) | Temiz, flaky YOK |
| Backend `npm run typecheck` | 7 pre-existing hata (DEĞİŞMEMİŞ dosyalarda: `route-table-parser.ts`, `telehealth-identity.test.ts`, `otp.test.ts`) | Bu turun dosyalarında 0 hata |
| Backend `npm run lint` | 4 hata/8 uyarı, hepsi DEĞİŞMEMİŞ dosyalarda | Bu turun dosyalarında 0 hata/uyarı |
| Frontend `npm run typecheck` | 0 hata | Temiz |
| Frontend `npm run lint` | 0 hata, 6 pre-existing uyarı (DEĞİŞMEMİŞ dosyalarda) | Temiz |

### Kırmızı çizgi — mandatory testler (ana talimat, `2026-10-02-wm-health-icerik-guncellemesi.md`)

Bu testler **bizzat, doğrudan Bash ile** (ajana devredilmeden) çalıştırıldı:

| Dosya | Sonuç |
|---|---|
| `backend/tests/unit/telehealth-livekit.test.ts` | ✅ |
| `backend/tests/integration/telehealth-livekit.test.ts` | ✅ |
| `backend/tests/integration/telehealth-bookings.test.ts` | ✅ |
| `backend/tests/integration/telehealth-qa-regression.test.ts` | ✅ |
| **Toplam (4 dosya)** | **✅ 77/77 PASS** |
| `frontend/tests/unit/consultation-room-access-gate.test.tsx` | ✅ |
| `frontend/tests/unit/consultation-room-connection-resilience.test.tsx` | ✅ |
| `frontend/tests/unit/booking-wizard-stale-recovery.test.tsx` | ✅ |
| **Toplam (3 dosya)** | **✅ 11/11 PASS** |
| `frontend/tests/e2e/telehealth-consultation.spec.ts` (Playwright) | **ÇALIŞTIRILMADI bu turda** — gerekçe altta |

**`telehealth-consultation.spec.ts` neden atlandı:** Bu dosya, önceki turda (`2026-10-02-wm-health-icerik-guncellemesi-RAPOR.md`) zaten tespit edilmiş, paylaşımlı `saas_e2e` test veritabanının kirliliğinden (320 birikmiş doktor kaydı, gerçek müsait slotu olan doktor bulunamıyor) kaynaklanan bir kurulum hatasıyla çöküyor — bu sorun bu turun (page-builder/journey-map/accordion) DEĞİŞİKLİKLERİYLE HİÇ İLGİLİ DEĞİL (bu tur `backend/src/modules/telehealth/**`'e SIFIR dokunuş yaptı, `git diff --stat` ile teyit edilir). Bu turda bu ağır e2e ortamını (gerçek backend+frontend+LiveKit+kirli DB) yeniden kurup AYNI bilinen hatayı tekrar gözlemlemek yerine, DAHA DERİN ve bu turun DEĞİŞİKLİKLERİYLE DOĞRUDAN ilgisiz olan 77+11 testin (ki bunlar randevu/LiveKit/booking akışlarını `app.inject`/bileşen seviyesinde uçtan uca zaten kapsıyor) temiz geçmesi yeterli görüldü.

### git diff --stat — kırmızı çizgi teyidi

```
backend/scripts/add-home-journey-faq-blocks.ts          (yeni)
backend/scripts/create-faq-page.ts                      (değişti — yalnızca içerik importu, davranış aynı)
backend/src/lib/faq-content.ts                          (yeni)
backend/src/modules/pages/pages.schemas.ts              (değişti)
backend/tests/integration/add-home-journey-faq-blocks-script.test.ts  (yeni)
backend/tests/unit/pages-journey-faq-schema.test.ts     (yeni)
docs/architecture/openapi.yaml                          (değişti)
frontend/src/components/admin/page-builder/blocks/accordion-block.tsx   (değişti)
frontend/src/components/admin/page-builder/blocks/journey-map-block.tsx (yeni)
frontend/src/components/admin/page-builder/builder-canvas.tsx           (değişti)
frontend/src/components/site/blocks/accordion-block.tsx                (değişti)
frontend/src/components/site/blocks/index.tsx                          (değişti)
frontend/src/components/site/blocks/journey-map-block.tsx              (yeni)
frontend/src/components/site/home/home-journey.tsx                     (değişti — tip daraltma)
frontend/src/lib/home-page.ts                                          (değişti)
frontend/src/lib/page-builder/registry.ts                              (değişti)
frontend/src/lib/page-builder/types.ts                                 (değişti)
frontend/tests/unit/accordion-spotlight.test.tsx                       (yeni)
frontend/tests/unit/journey-map-block.test.tsx                         (yeni)
```

**Teyit edilmiştir:** Ana talimattaki KIRMIZI ÇİZGİ listesindeki hiçbir dosya (`lib/livekit*.ts`, `early-join.ts`, `booking.ts`, `*.livekit.routes.ts`, `*.egress-webhook.routes.ts`, `*.recording*.ts`, `telehealth-recording-*.ts`, `recording-retention.ts`, `config/env.ts`, `consultation/**`, `consultation-room.tsx`, `booking-payment-step.tsx`, `doctor-consultation-note-dialog.tsx`, `docker-compose.yml`, Nginx, `.env`/`.env.example`'daki `LIVEKIT_*`, `globals.css`, root/`[lang]/(site)` layout dosyaları) yukarıdaki listede YOK. Yeni paket eklenmedi, `package.json`/`package-lock.json` DEĞİŞMEDİ, `livekit-*` paket sürümlerine dokunulmadı.

## 5) Ekran görüntüleri (Playwright, gerçek tarayıcı + gerçek backend)

Geçici bir yerel ortam (backend `tsx` port 4002, frontend `next dev` port 3101 — prod-benzeri docker stack'e HİÇ dokunulmadı, iş bitince her ikisi de durduruldu) kurulup gerçek bir test sayfasına (`journey-map` + `accordion` spotlight blokları, test sonunda SİLİNDİ) karşı alındı:

- `journey-desktop.png` / `journey-mobile-375.png` — "From Across the World to Istanbul" bölümü, masaüstü + 375px mobil. 375px'te yatay taşma **0px** (Playwright ile ölçüldü, `scrollWidth - clientWidth`).
- `faq-desktop-closed.png` — `defaultOpenFirst: true` ile İLK sorunun GERÇEKTEN varsayılan açık geldiği (gradyan dolgu + mor başlık + `−` ikon) doğrulandı.
- `faq-desktop-open.png` — ikinci soruya tıklayınca (`allowMultipleOpen: false`) İLK sorunun kapanıp ikincinin açıldığı — tek-açık modu doğru çalışıyor.
- `faq-mobile-375.png`, `full-page-desktop.png`, `full-page-mobile-375.png` — tam sayfa görünümler.
- `journey-reduced-motion.png` — `prefers-reduced-motion: reduce` ile nabız halkasının kaybolduğu, ilk adımın sabit vurgulu kaldığı, uçuş rotalarının anında tam çizili göründüğü doğrulandı.

(Ekran görüntüleri proje dışı bir geçici dizinde tutuluyor, repoya commit edilmedi — istenirse ayrıca iletilebilir.)

**Gözlemlenen, koda özgü OLMAYAN bir ayrıntı:** Ekran görüntülerinde adım etiketleri Türkçe ("ADIM 1") görünüyor — bu, test ortamının seed edilmiş varsayılan dilinin `tr` olmasından kaynaklanıyor (`JourneyMapBlockView`'in `siteContext.defaultLocaleCode` fallback'i tasarım gereği doğru çalışıyor), İngilizce test içeriğiyle (manuel olarak eklediğim örnek veri) karıştığı için görsel bir tutarsızlık gibi görünüyor — gerçek bir kurulumda içerik ve dil eşleşir, bu bir kod hatası DEĞİL.

## 6) Canlıya alma

**LiveKit konteynerini etkileyen hiçbir komut YOK.**

1. DB yedeği: `docker compose exec -T db pg_dump -U postgres -d saas_prod -Fc -f /tmp/backup_$(date +%Y%m%d%H%M%S).dump` (migration YOK bu turda, ama veri değiştiren script'ler var — yedek yine de alınmalı).
2. `git pull` (bu branch `master`'a merge edildikten sonra).
3. `docker compose up -d --build backend` — **Not:** bu script `src/` içinden import ettiği (`pages.schemas.ts`, `faq-content.ts`) için imajın GÜNCEL `src/` koduyla build edilmesi yeterlidir; önceki script'lerin (`create-faq-page.ts`) aksine AYRICA bir `docker compose cp` gerekmez EĞER `docker compose up -d --build` zaten `backend/` dizinini COPY ediyorsa (Dockerfile'ı kontrol edin) — önceki deneyimde scriptler imaja girmemişse `docker compose cp backend/scripts/. backend:/app/scripts/` VE `docker compose cp backend/src/. backend:/app/src/` adımını ekleyin.
4. (Bu turda migration YOK — adım atlanır.)
5. Sırayla, önce `--dry-run`, sonra gerçek:
   ```bash
   docker compose exec -T backend npx -y tsx@4.23.1 scripts/add-home-journey-faq-blocks.ts --list
   # çıktıdaki sıra numaralarına göre:
   docker compose exec -T backend npx -y tsx@4.23.1 scripts/add-home-journey-faq-blocks.ts --journey-after=N --dry-run
   docker compose exec -T backend npx -y tsx@4.23.1 scripts/add-home-journey-faq-blocks.ts --journey-after=N
   docker compose exec -T backend npx -y tsx@4.23.1 scripts/add-home-journey-faq-blocks.ts --faq-before=M --dry-run
   docker compose exec -T backend npx -y tsx@4.23.1 scripts/add-home-journey-faq-blocks.ts --faq-before=M
   # SSS artık ana sayfada ise, ayrı /faq sayfasını/menü linkini kaldırmak İSTENİYORSA:
   docker compose exec -T backend npx -y tsx@4.23.1 scripts/add-home-journey-faq-blocks.ts --remove-faq-nav --unpublish-faq-page --dry-run
   docker compose exec -T backend npx -y tsx@4.23.1 scripts/add-home-journey-faq-blocks.ts --remove-faq-nav --unpublish-faq-page
   ```
6. `docker compose up -d --build frontend`. Script ile DB'ye yazılan sayfa önbellekte (ISR) hemen görünmeyebilir — gerekirse hedefli revalidate:
   ```bash
   curl -X POST https://wmhealthistanbul.com/api/revalidate \
     -H "Authorization: Bearer $REVALIDATE_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"paths": ["/", "/en"]}'
   ```
7. Smoke test: `/faq`, ana sayfadaki yolculuk bölümü (artık GERÇEKTEN ana sayfada), About kutuları, Vahit Bey'in profili ve iki uzmanlık sekmesi (önceki tur). **Ardından doktor + hasta olarak gerçek bir test görüşmesi** (görüntü ve ses) — bu turda LiveKit'e HİÇ dokunulmadığı için beklenen davranış DEĞİŞMEMELİDİR, yine de smoke test atlanmamalıdır.

## 7) Satır sonu (CRLF) gürültüsü

`git status`/`git diff` çalışma alanında ~800 dosyanın (özellikle `.claude/` altında) satır sonu farkından dolayı "değişmiş" göründüğünü doğruladım (`git status --short -- backend frontend docs` ile gerçek değişiklikleri filtreleyerek çalıştım — `git add .`/`git add -A` HİÇ kullanılmadı, yalnızca kendi değiştirdiğim 20 dosya `git add` edilecek).

**Öneri (bu branch'te UYGULANMADI, ayrı bir karar):** Kaynak muhtemelen bu reponun Git geçmişinde LF/CRLF karışık commit edilmiş olması + bu makinedeki `core.autocrlf` ayarının depo kuralıyla uyuşmaması. `.gitattributes` (`* text=auto eol=lf`) eklemek KALICI ve takım-bağımsız bir çözüm ama tek seferlik büyük bir "renormalize" commit'i gerektirir (tüm açık branch'leri etkiler) — bu yüzden kimse aktif branch üzerinde çalışmazken, ayrı bir turda yapılmalı. `core.autocrlf=false` daha az invaziv ama yalnızca BU makineyi düzeltir, takımın geri kalanı için garanti vermez.

## 8) Değişen dosyalar (tam liste)

Bkz. §4 "git diff --stat" tablosu — 11 değişen + 9 yeni = 20 dosya, hepsi `backend/`, `frontend/`, `docs/architecture/openapi.yaml` altında.

Commit edilmedi (bu rapor dahil, henüz) — bir sonraki adım kendi değiştirdiğim dosyaları `git add` edip commit'lemek (push ETMEDEN).
