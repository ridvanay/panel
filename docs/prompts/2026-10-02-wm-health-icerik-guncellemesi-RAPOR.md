# Rapor: WM Health içerik güncellemesi + Düzeltme 1

Branch: `feature/wm-health-oct-content` (master'dan ayrıldı, henüz push edilmedi)
Kaynak görevler: `docs/prompts/2026-10-02-wm-health-icerik-guncellemesi.md`, `docs/prompts/2026-10-02-wm-health-duzeltme-1.md`

---

## 1) Değişen dosyalar (özet)

### İş Paketi 1 — Ana sayfa "From Across the World to Istanbul" (commit `a1cd202`)
- `backend/src/lib/home-page-template.ts`, `backend/src/lib/page-template-fields.ts`, `backend/src/modules/pages/pages.schemas.ts`, `backend/tests/unit/pages-home-page-schema.test.ts`
- `docs/architecture/openapi.yaml`
- `frontend/src/lib/home-page.ts`, `frontend/src/lib/i18n/site-dictionaries/{en,tr}/home.ts`
- `frontend/src/components/site/home/home-journey.tsx` (yeni), `home-page-view.tsx`
- `frontend/src/components/admin/page-builder/home-template-form.tsx`
- `frontend/tests/unit/home-page-template.test.tsx`

### İş Paketi 2 — SSS (FAQ) sayfası (commit `079d335`)
- `backend/scripts/create-faq-page.ts` (yeni), `backend/scripts/add-faq-nav-link.ts` (yeni)

### İş Paketi 3 — About "Our treatment areas" animasyonları (commit `ec057a3`)
- `frontend/src/app/[lang]/(site)/about/page.tsx`, `about-hero.tsx`, `treatment-areas.tsx`
- `frontend/tests/unit/about-page.test.tsx`, `treatment-areas.test.tsx` (yeni)

### İş Paketi 4 — Doktor sosyal medya linkleri (commit `aa3cbc4`)
- `backend/prisma/schema.prisma` (+migration `20261002182049_add_doctor_social_links`)
- `backend/src/mappers/index.ts`, `telehealth.admin.routes.ts`, `telehealth.portal.routes.ts`, `telehealth.schemas.ts`, `schemas/entities.ts`
- `backend/scripts/update-vahit-mutlu-profile.ts` (yeni — Düzeltme 1'de yeniden yazıldı, bkz. aşağı)
- `frontend/src/lib/api/types.ts`, `doctor-json-ld.ts`
- `frontend/src/components/icons/brand-icons.tsx` (yeni — Simple Icons CC0 path verisi, yeni npm bağımlılığı EKLENMEDEN)
- `frontend/src/components/site/telehealth/doctor-social-links.tsx`, `doctor-social-links-editor.tsx` (yeni), `doctor-profile-hero.tsx`
- İlgili test dosyaları (8 fixture dosyası + 2 yeni test bloğu)

### Düzeltme 1, madde 2 — Doktorun ek uzmanlıkları (`DoctorAdditionalSpecialty`) — henüz commit edilmedi, bu raporla birlikte commit ediliyor
- **DB:** `backend/prisma/schema.prisma` (+`DoctorAdditionalSpecialty` modeli, composite PK, her iki FK `onDelete: Cascade`), migration `20261002204050_add_doctor_additional_specialty` (SADECE `CREATE TABLE`/`CREATE INDEX`/2×`ADD CONSTRAINT`, mevcut hiçbir tabloya dokunmuyor).
- **Backend:** `telehealth.routes.ts` (listeleme/filtreleme `OR` ile genişletildi, `search` ile birlikte kullanıldığında filtrenin EZİLMESİNİ önleyen bir regresyon da bu turda bulunup düzeltildi — bkz. madde 3), `telehealth.admin.routes.ts` (`additionalSpecialtyIds`, max 5, birincilyle çakışma 422), `telehealth.portal.routes.ts`, `telehealth.schemas.ts`, `schemas/entities.ts`, `mappers/index.ts`, `docs/architecture/openapi.yaml`.
- **Script düzeltmesi:** `backend/scripts/update-vahit-mutlu-profile.ts` — artık `specialtyId`'yi KOŞULSUZ ezmiyor (sadece `null` ise bağlanıyor), `subSpecialty`'ye dokunmuyor, ikinci uzmanlığı (Surgical Oncology) `doctorAdditionalSpecialty.upsert` ile ekliyor (silme yok), yazmadan önce eski değerleri konsola basıyor, `--dry-run` ÖNCE→SONRA farkını gösteriyor.
- **Frontend:** `frontend/src/lib/api/types.ts`, `doctor-additional-specialties-field.tsx` (yeni, admin çoklu seçim), admin doktor formu (`[doctorId]/page.tsx`, `new/page.tsx`), `doctor-profile-hero.tsx` (rozet gösterimi).
- **Testler:** `backend/tests/integration/telehealth.test.ts` (dedup, search+specialty birlikte kullanımı, doctorCount, 422 çakışma), `backend/tests/integration/update-vahit-mutlu-profile-script.test.ts` (yeni — 5 senaryo), frontend admin/profil test dosyalarına ek bloklar.

---

## 2) `git diff --stat master` (bu rapor + Düzeltme 1 dahil, tüm branch)

```
 .../20261002182049_add_doctor_social_links/migration.sql       |   7 +
 .../20261002204050_add_doctor_additional_specialty/migration.sql |   7 +
 backend/prisma/schema.prisma                                   |  36 +++
 backend/scripts/add-faq-nav-link.ts                            |  77 +++++
 backend/scripts/create-faq-page.ts                             | 323 +++++++++++++++++++++
 backend/scripts/update-vahit-mutlu-profile.ts                  | 242 +++++++++++++++
 backend/src/lib/home-page-template.ts                          |   7 +
 backend/src/lib/page-template-fields.ts                        |   5 +-
 backend/src/mappers/index.ts                                   |  12 +
 backend/src/modules/pages/pages.schemas.ts                     |  24 +-
 backend/src/modules/telehealth/telehealth.admin.routes.ts      |  61 +++-
 backend/src/modules/telehealth/telehealth.portal.routes.ts     |   8 +-
 backend/src/modules/telehealth/telehealth.routes.ts            |  51 +++-
 backend/src/modules/telehealth/telehealth.schemas.ts           |  37 ++-
 backend/src/schemas/entities.ts                                |  32 ++
 backend/tests/integration/telehealth.test.ts                   | 185 ++++++++++++
 backend/tests/integration/update-vahit-mutlu-profile-script.test.ts | (yeni)
 backend/tests/unit/pages-home-page-schema.test.ts              |  21 ++
 docs/architecture/openapi.yaml                                 |  55 ++++
 frontend/src/app/[lang]/(site)/about/page.tsx                  |  13 +-
 frontend/src/app/admin/telehealth/doctors/[doctorId]/page.tsx  |  40 ++-
 frontend/src/app/admin/telehealth/doctors/new/page.tsx         |  36 ++-
 frontend/src/components/admin/page-builder/home-template-form.tsx |  55 +++-
 frontend/src/components/admin/telehealth/doctor-additional-specialties-field.tsx | (yeni)
 frontend/src/components/icons/brand-icons.tsx                  |  67 +++++
 frontend/src/components/site/about/about-hero.tsx              |   3 +-
 frontend/src/components/site/about/treatment-areas.tsx         |  74 ++++-
 frontend/src/components/site/home/home-journey.tsx             | 258 ++++++++++++++++
 frontend/src/components/site/home/home-page-view.tsx           |   4 +
 frontend/src/components/site/telehealth/doctor-profile-hero.tsx |  36 ++-
 frontend/src/components/site/telehealth/doctor-social-links-editor.tsx | 110 +++++++
 frontend/src/components/site/telehealth/doctor-social-links.tsx |  72 +++++
 frontend/src/lib/api/types.ts                                  |  35 +++
 frontend/src/lib/doctor-json-ld.ts                              |   3 +
 frontend/src/lib/home-page.ts                                  |  66 +++++
 frontend/src/lib/i18n/site-dictionaries/en/home.ts             |  22 ++
 frontend/src/lib/i18n/site-dictionaries/tr/home.ts             |  20 ++
 frontend/tests/unit/*.test.tsx (11 dosya, fixture güncellemeleri + yeni testler)

 44 dosya değişti, 2397 ekleme(+), 54 çıkarma(-)
```

**`.claude/CLAUDE.md`** çalışma alanında değişmiş görünüyor ama bu benim değişikliğim DEĞİL (kullanıcının kendi, commit edilmemiş "Hızlı Mod" eklentisi) — talimata uyarak dokunulmadı, commit'e dahil EDİLMEDİ.

---

## 3) KIRMIZI ÇİZGİ teyidi (LiveKit / görüntülü görüşme)

Yukarıdaki `git diff --stat` listesinde aşağıdakilerin **HİÇBİRİ YOK** (grep ile ayrıca doğrulandı):
- `backend/src/modules/telehealth/lib/livekit*.ts`, `early-join.ts`, `booking.ts`
- `backend/src/modules/telehealth/telehealth.livekit.routes.ts`, `*.egress-webhook.routes.ts`, `*.recording*.ts`
- `backend/src/lib/telehealth-recording-*.ts`, `recording-retention.ts`
- `backend/src/config/env.ts`
- `frontend/src/app/[lang]/(site)/consultation/**`, `consultation-room.tsx`, `booking-payment-step.tsx`, `doctor-consultation-note-dialog.tsx`
- `docker-compose.yml`, Nginx config, `.env`/`.env.example` içindeki `LIVEKIT_*`/`NEXT_PUBLIC_LIVEKIT_*`
- `globals.css`'e global kural eklenmedi; root layout'a provider eklenmedi.
- `livekit-client`/`@livekit/components-react`/`@livekit/components-styles`/`livekit-server-sdk` sürümlerine dokunulmadı, yeni paket eklenmedi (`package.json`/`package-lock.json` diff'te YOK).
- Doktorun `id`/`slug`/`userId` alanlarına ve mevcut `specialtyId` kayıtlarına dokunulmadı — `specialtyId` kullanım taraması (`grep -rn specialtyId backend/src`) 6 dosyada sonuç verdi, hiçbirinde birincil uzmanlık davranışı değiştirilmedi (booking/checkout/bildirim dosyalarında `specialtyId` zaten hiç geçmiyor).

---

## 4) Test sonuçları

### 4a) Ana içerik güncellemesi (İş Paketi 1-4) — önceki QA turu
Gerçek tarayıcı + gerçek backend + gerçek Postgres (`saas_e2e`) ile doğrulandı: **4/4 iş paketi PASS**. Bulunan 1 gerçek bug (home-journey.tsx SSR/CSR hydration mismatch, `Math.hypot` IEEE754 belirsizliği) aynı turda düzeltildi ve matematiksel olarak kanıtlandı.
- Backend tam suite: 157/159 dosya, 1911/1924 test PASS (2 başarısız dosya branch DIŞI, izole çalıştırınca PASS — flaky/pre-existing).
- Frontend tam suite: 141/143 dosya, 959/962 test PASS (2 başarısız dosya branch DIŞI, izole çalıştırınca PASS — flaky/pre-existing).

### 4b) Düzeltme 1 — bu turda ÇALIŞTIRILAN testler (orkestratör tarafından BİZZAT, Windows'ta)

| Dosya | Sonuç | Not |
|---|---|---|
| `backend/tests/unit/telehealth-livekit.test.ts` | ✅ **PASS** (11/11) | Kırmızı çizgi — mandatory |
| `backend/tests/integration/telehealth-livekit.test.ts` | ✅ **PASS** (dahil) | Kırmızı çizgi — mandatory |
| `backend/tests/integration/telehealth-bookings.test.ts` | ✅ **PASS** (dahil) | Kırmızı çizgi — mandatory |
| `backend/tests/integration/telehealth-qa-regression.test.ts` | ✅ **PASS** (dahil) | Kırmızı çizgi — mandatory |
| **Toplam (4 dosya)** | ✅ **77/77 PASS** | Doğrudan `npx vitest run` ile çalıştırıldı |
| `frontend/tests/unit/consultation-room-access-gate.test.tsx` | ✅ **PASS** (dahil) | Kırmızı çizgi — mandatory |
| `frontend/tests/unit/consultation-room-connection-resilience.test.tsx` | ✅ **PASS** (dahil) | Kırmızı çizgi — mandatory |
| `frontend/tests/unit/booking-wizard-stale-recovery.test.tsx` | ✅ **PASS** (dahil) | Kırmızı çizgi — mandatory |
| **Toplam (3 dosya)** | ✅ **11/11 PASS** | Doğrudan `npx vitest run` ile çalıştırıldı |
| `backend/tests/integration/telehealth.test.ts` (değişen, yeni testler dahil) | ✅ **PASS** (22/22) | backend-agent tarafından çalıştırıldı |
| `backend/tests/integration/update-vahit-mutlu-profile-script.test.ts` (yeni) | ✅ **PASS** | backend-agent tarafından çalıştırıldı, 5 senaryo |
| Frontend admin/profil testleri (`admin-telehealth-doctor-new-fee-toggle.test.tsx`, `doctor-profile-hero.test.tsx`) | ✅ **PASS** (22/22) | frontend-agent tarafından çalıştırıldı |
| `frontend/tests/e2e/telehealth-consultation.spec.ts` (Playwright) | ❌ **FAILED (kurulum aşamasında)** | **Aşağıya bkz. — kod regresyonu DEĞİL** |

**Backend `npm run typecheck`/`npm run lint`:** temiz (yalnızca bu branch'te DEĞİŞMEMİŞ 3-7 dosyada pre-existing hatalar — `route-table-parser.ts`, `telehealth-identity.test.ts`, `otp.test.ts` — her defasında `git stash` ile baseline'a karşı doğrulandı).
**Frontend `npm run typecheck`/`npm run lint`:** temiz, 0 hata.

### 4c) Playwright e2e hatası — ayrıntı ve kök neden

`tests/e2e/telehealth-consultation.spec.ts`, `beforeAll` kurulum aşamasında şu hatayla durdu:
```
Konsültasyon testleri için müsait slotu olan bir doktor bulunamadı.
```
Hiçbir test senaryosu (madde 10, 11a-d) ÇALIŞMADI — hata, bu branch'teki hiçbir kod yoluna girmeden, paylaşımlı `saas_e2e` test veritabanının kendisinde oluştu.

**Doğrudan DB sorgusuyla doğrulanan kök neden:** `saas_e2e` veritabanında **320 aktif doktor kaydı** var ama yalnızca **4 gelecek randevu**. Bu, önceki bir QA turunun zaten işaret ettiği, bu veritabanının tekrar tekrar demo-şablon import'uyla kirlendiği durumla tutarlı (o turda "174 kopya Kardiyoloji uzmanlığı" tespit edilmişti). Test fixture yardımcısı (`ensureTelehealthModuleWithDoctors`) yalnızca "en az bir doktor var mı" kontrolü yapıyor, doktorlardan HERHANGİ BİRİNİN gerçekten müsait bir slotu olduğunu DOĞRULAMIYOR — 320 birikmiş/muhtemelen kopya kayıt arasında test, 30 günlük pencerede müsait bir slotu olan TEK bir doktor bile bulamadı.

**Bu bir kod regresyonu DEĞİLDİR:** Randevu/müsaitlik/slot üretimi kodu (`lib/booking.ts`, slot mantığı) bu branch'teki DÖRT iş paketinden hiçbiri tarafından DOKUNULMADI — `specialtyId` kullanım taraması bunu ayrıca doğruladı. Aynı kod yolları, yukarıdaki 77+11 mandatory testte (ki onlar GERÇEKTEN randevu/booking/LiveKit-token akışlarını `app.inject` seviyesinde uçtan uca test ediyor) sorunsuz PASS oldu. Sorun SADECE bu bir Playwright dosyasının paylaşımlı, kirli test veritabanına bağımlı kurulum mantığında.

Kullanıcıyla bu bulgu konuşuldu; kullanıcı mevcut haliyle devam edilmesini onayladı (bu test dosyası HARİÇ, diğer tüm mandatory testler PASS). `saas_e2e` veritabanının temizlenmesi/sıfırlanması bu turun kapsamı DIŞINDA bırakıldı — ayrı, dikkatli bir iş olarak ele alınmalı (paylaşımlı test ortamı, başka oturumların da ona bağımlı olabileceği göz önünde bulundurularak).

---

## 5) Satır sonu (CRLF) gürültüsü — öneri (bu branch'te UYGULANMADI)

Çalışma alanında ~800 dosyanın "değişmiş" görünmesinin kaynağı muhtemelen reponun Git geçmişinde LF/CRLF karışık commit edilmiş olması + bu makinedeki `core.autocrlf` ayarının farklı davranması. İki olası çözüm (ikisi de bu branch'te UYGULANMADI, ayrı bir karar/iş olarak değerlendirilmeli):
1. **`.gitattributes`** ekleyip (`* text=auto eol=lf` gibi) satır sonlarını repo genelinde LF'ye normalize etmek — tek seferlik büyük bir "renormalize" commit'i gerektirir, tüm açık branch'leri etkiler, dikkatli bir zamanlamada (ör. tüm PR'lar merge olduktan sonra) yapılmalı.
2. **`core.autocrlf=false`** (veya `input`) ayarını bu makinede/takımda standartlaştırmak — daha az invaziv ama takımdaki HERKESİN aynı ayarı yapması gerekir, tutarsızlık riski sürer.
Öneri: (1) daha kalıcı ve takım-bağımsız bir çözüm, ama ayrı bir PR'da, kimse aktif branch üzerinde çalışmazken yapılmalı (merge conflict riski yüksek).

---

## 6) Canlıya alma sırası (netleştirilmiş, Düzeltme 1 madde 5)

**LiveKit konteynerini etkileyen hiçbir komut YOK.**

1. **DB yedeği (migration'dan ÖNCE, zorunlu):**
   ```bash
   docker compose exec -T db pg_dump -U postgres -d saas_prod -Fc -f /tmp/backup_$(date +%Y%m%d%H%M%S).dump
   docker compose cp db:/tmp/backup_....dump ./backups/
   ```
2. **Kod güncellemesi:**
   ```bash
   git pull origin master   # (bu branch master'a merge edildikten sonra)
   ```
3. **Backend imajını yeniden derle** (yeni migration + scriptler imaja girsin):
   ```bash
   docker compose up -d --build backend
   ```
   Scriptler imaja (Dockerfile COPY adımı nedeniyle) girmiyorsa, önceki deneyimdeki gibi:
   ```bash
   docker compose cp backend/scripts backend:/app/scripts
   ```
4. **Migration'ı uygula:**
   ```bash
   docker compose exec -T backend npx prisma migrate deploy
   ```
5. **Scriptleri sırayla, önce `--dry-run` sonra gerçek çalıştır:**
   ```bash
   docker compose exec -T backend npx tsx scripts/create-faq-page.ts --dry-run
   docker compose exec -T backend npx tsx scripts/create-faq-page.ts
   docker compose exec -T backend npx tsx scripts/add-faq-nav-link.ts --dry-run
   docker compose exec -T backend npx tsx scripts/add-faq-nav-link.ts
   docker compose exec -T backend npx tsx scripts/update-vahit-mutlu-profile.ts --dry-run
   docker compose exec -T backend npx tsx scripts/update-vahit-mutlu-profile.ts
   ```
   (Vahit Mutlu script'i, prod'da "Vahit Mutlu" adında bir doktor VE "Obesity & Metabolic Surgery"/"Surgical Oncology" uzmanlıkları GERÇEKTEN var olduktan SONRA anlamlı sonuç üretir — yoksa net bir hatayla durur, sahte veri üretmez.)
6. **Frontend imajını yeniden derle:**
   ```bash
   docker compose up -d --build frontend
   ```
   Script ile DB'ye yazılan FAQ sayfası/nav linki önbellekte (ISR) hemen görünmeyebilir (bilinen 60sn eventual-consistency davranışı, bkz. proje hafızası). Gerekirse hedefli revalidate:
   ```bash
   curl -X POST https://wmhealthistanbul.com/api/revalidate \
     -H "Authorization: Bearer $REVALIDATE_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"paths": ["/faq", "/en/faq", "/", "/en", "/about", "/en/about", "/doctors/vahit-mutlu", "/en/doctors/vahit-mutlu"]}'
   ```
7. **Smoke test (elle):**
   - `/faq` ve `/en/faq` — 8 soru-cevap, FAQ nav linki.
   - Ana sayfa — "From Across the World to Istanbul" bölümü, scroll animasyonu.
   - `/about` — "Our treatment areas" hover/scroll animasyonu.
   - Doç. Dr. Vahit Mutlu profili — iki uzmanlık sekmesinde (Obesity & Metabolic Surgery VE Surgical Oncology) göründüğünü, sosyal medya linklerinin çalıştığını doğrula.
   - **Ardından:** doktor + hasta olarak (iki farklı tarayıcı/oturum) GERÇEK bir test randevusu oluşturup görüşme odasına gir, görüntü ve ses geldiğini doğrula.

---

## 7) Admin'de elle yapılması gerekenler

- About sayfasının yeni hero görseli (yaklaşık 16:13 oran, üstte yazı alanı olan) admin medya kütüphanesinden yüklenmeli — kod zaten bu orana hazır, görsel dosyası henüz sağlanmadı.
- (FAQ nav linki script ile otomatik eklendiği için elle yapılacak BİR ŞEY YOK.)
- Vahit Mutlu'nun gerçek doktor kaydı ve "Obesity & Metabolic Surgery"/"Surgical Oncology" uzmanlıkları prod'da henüz yoksa, script'in anlamlı çalışması için önce bunların (admin panelden veya ayrı bir import akışıyla) oluşturulması gerekiyor.

## 8) Bilinen mimari takip konusu (bu turun kapsamı dışı)

`DoctorProfile` modelinde TR/EN içerik için bir çeviri mekanizması (ayrı tablo veya `translations` JSON alanı) YOK. Bu yüzden Vahit Mutlu'nun Türkçe unvanı/biyografisi şu an hiçbir yere yazılamıyor — script bu alanları atlıyor, sessizce ezmiyor. Bu, mimari bir karar gerektiriyor (architect/db-agent) ve bu raporun kapsamı dışında bırakıldı.
