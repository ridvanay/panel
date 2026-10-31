# Paket AE-ek — Rapor: otomatik medya dönüştürme (fotoğraf → WebP, video → H.264 MP4)

- **Dal:** `feat/media-transcode-oct31`.
  - AE master'a girdikten sonra `origin/master` (`f27f9c0`) üzerinden açıldı.
  - Bitirmeden önce güncel `origin/master`'a (`9fe4d06`, medya adres düzeltmesi) rebase edildi; çakışma çıkmadı.
- **Push edilmedi.**
- **Akış:** Tam akış. Gerekçe: yeni paket, Dockerfile, migration, medya güvenliği, arka plan işi.
  - Arka uç ana oturumda yazıldı.
  - Admin ön yüzü ve Open Graph işi sözleşmeyle bir ön yüz ajanına verildi; ana oturumda gözden geçirildi.

## Commitler

| Hash | Konu |
|---|---|
| `0b96255` | chore(deps): backend'e sharp, runtime imajına ffmpeg (kullanıcı onaylı istisna) |
| `a85a56e` | feat(media): fotoğraf WebP, video H.264 kuyruğu, mevcut medya scripti, migration, testler |
| `3359da0` | feat(admin): video dönüştürme durumu, logo/favicon amacı, Open Graph JPEG kopyası |
| (bu rapor) | docs(prompts): Paket AE-ek raporu |

## Dockerfile ve `package.json` farkları (kırmızı çizgi istisnaları)

```diff
--- a/backend/Dockerfile
+++ b/backend/Dockerfile
@@ runtime aşaması
 RUN apk update && apk upgrade --no-cache \
   && apk add --no-cache openssl \
+  && apk add --no-cache ffmpeg \
   && addgroup -S nodejs \
```

```diff
--- a/backend/package.json
+++ b/backend/package.json
     "saxes": "^6.0.0",
+    "sharp": "^0.35.5",
     "stripe": "^16.8.0",
```

- `backend/package-lock.json`: yalnızca sharp ve platform paketleri (`@img/sharp-*`, linuxmusl dahil).
- Başka paket, Dockerfile ya da compose değişikliği yok.
- Ön yüz `package.json`/Dockerfile, `consultation-room.tsx`, LiveKit, ödeme/randevu, Nginx, `.env`, `docs/legal/` farkları **boş**.
- Ayrıca `backend/.gitignore`'a iki çalışma klasörü eklendi: `storage/media-transcode/` ve `storage/media-backup/`.

## Ne yapıldı

### İş 1 — Fotoğraf (sharp)

- **Kapsam:** Yalnızca admin/personel yüklemeleri dönüştürülür. Hepsi aynı uçtan geçer (`POST /admin/media`): medya kütüphanesi, hekim fotoğrafları, slider, blog kapakları, logo.
- **Girdiler:**
  - JPEG, PNG ve WebP dönüştürülür; tür içerikten belirlenir.
  - GIF ve PDF olduğu gibi kalır.
  - SVG bu yola hiç girmez ve reddedilmeye devam eder.
- **İşleme:**
  - EXIF yönüne göre döndürülür.
  - EXIF, GPS, XMP ve IPTC silinir; yalnızca ICC renk profili korunur.
  - En uzun kenar en çok 2560 px; küçük görseller büyütülmez.
  - WebP kalitesi 82; saydamlık korunur.
- **Ek kural:** Zaten sıkıştırılmış çok ayrıntılı görsellerde WebP 82 girdiden büyük çıkabiliyor (gerçek örnek: 489 KB → 532 KB). Bu durumda bir kez kalite 72 denenir ve küçük olan alınır (aynı örnek: 413 KB).
- **Uyumluluk kopyaları** (aynı UUID ile):
  - `<uuid>.jpg` her zaman yazılır (kalite 85, en çok 1600 px).
  - Saydam görselde ya da logoda ayrıca `<uuid>.png` yazılır.
  - E-posta logosu (`branded-mail.ts`) PNG kopyasını kullanır. Önceden WebP logo e-postada hiç gösterilmiyordu.
  - Open Graph görselleri `.webp` → `.jpg` eşlemesiyle JPEG kopyasını kullanır.
  - Favicon ve apple-touch-icon `purpose=icon` ile yüklenir; ana sürüm PNG kalır.
- **Orijinal saklanmaz.**
- **Güvenlik:**
  - En çok 50 MP; başlığı 400 MP diyen piksel bombası reddedilir.
  - Görsel başına 20 sn zaman aşımı.
  - Bozuk ya da çözülemeyen dosya için "Görsel okunamadı ya da bozuk." mesajı.
- **HEIC:** Hazır sharp derlemesi (libvips 8.18.7) HEIF'in yalnızca AVIF türünü okuyabiliyor; iPhone'un HEVC tabanlı HEIC'ini okuyamıyor. Paketin izin verdiği gibi net bir mesaj veriliyor: "iPhone HEIC fotoğrafı bu sunucuda dönüştürülemiyor. iPhone'da Ayarlar → Kamera → Biçimler → 'En Uyumlu' seçin ya da fotoğrafı JPEG/PNG olarak dışa aktarın." Kod HEIC'i sharp'a yine de verir; HEVC desteği olan bir libvips ile kendiliğinden dönüştürülür.
- **Admin bilgilendirmesi:** Yüklemede şu bildirim çıkar: "WebP olarak kaydedildi (1,2 MB → 240 KB); konum ve kamera bilgileri silindi."
- **Kapsam dışı:** Toplu içe aktarma (ZIP) ve demo şablon varlıkları bu yükleme yolundan geçmez. Bunlar mevcut medya scriptiyle dönüştürülür.

**Mevcut medya scripti:** `backend/scripts/convert-existing-media.ts`. Canlıda derlenmiş giriş noktası: `dist/cli/convert-existing-media.js`.

- **Çalışma kipleri:**
  - Varsayılan kuru çalışma: hiçbir şey yazmaz. Aday sayısını, önce/sonra toplam boyutu, güncellenecek referansları ve listede olmayıp `/uploads/` içeren kolonları raporlar.
  - Gerçek çalışma: `--confirm=convert-media --operator=<ad>`.
  - Geri alma: `--restore=<runId> --confirm=convert-media --operator=<ad>`.
- **Güvenli tasarım:**
  - Ana sürüm `<uuid>.webp` olarak yazılır.
  - Eski dosyanın yolu aynı biçimde uyumluluk kopyası olarak yaşamaya devam eder (`<uuid>.jpg` ya da `.png`, meta verisiz). Güncellenmemiş bir referans (dış bağlantı, Open Graph, favicon) bu yüzden bozulmaz.
  - Eski dosya önce yedeğe kopyalanır ve her öğeden sonra bir bildirim dosyası (manifest) yazılır. Yarıda kalan çalışma da `--restore` ile geri alınabilir.
- **Referanslar:**
  - `Media` satırı yerinde güncellenir. Bu yüzden FK referansları (`avatarMediaId`, `coverMediaId`, slider vb.) kendiliğinden doğru kalır.
  - Metin referansları yalnızca sabit bir (tablo, kolon) listesinde güncellenir: sayfa blokları/çevirileri, blog içerik ve kapakları, ürün, portföy, hekim biyografisi/çevirileri, slider katmanları, `logoUrl`, `avatarUrl`, e-posta şablonları.
  - `ogImageUrl`, `faviconUrl` ve `appleTouchIconUrl` bilerek değiştirilmez.
  - Favicon olarak kullanılan görseller hiç dönüştürülmez.
- **Sınırlar:** Yalnızca yerel depolama desteklenir (`STORAGE_DRIVER=local`).

### İş 2 — Video (ffmpeg)

- **Yükleme:**
  - MP4 ve MOV (iPhone) kabul edilir; tür içerikten belirlenir. Sınır AE'deki admin ayarı (varsayılan 100 MB).
  - Orijinal, herkese açık olmayan `storage/media-transcode/originals/<uuid>.<mp4|mov>` klasörüne akışla yazılır.
  - Video sitede görünmez; durumu "İşleniyor"dur.
- **Kuyruk** (`lib/video-transcode/worker.ts`):
  - Her seferinde tek iş alınır: süreç içi bayrak, veritabanında "running" iş kontrolü ve atomik sahiplenme.
  - 30 sn'de bir tur atılır; yüklemeden hemen sonra da bir tur tetiklenir.
  - Açılışta yarıda kalan işler yeniden kuyruğa alınır.
- **Aktif görüşme varken iş başlamaz, 2 dk sonra yeniden denenir.**
  - Ölçüt: `IN_PROGRESS` randevu ya da başlamış ama bitmemiş görüşme.
  - Kontrol mevcut randevu verisinden yapılır; LiveKit koduna dokunulmadı.
- **Çıktı:**
  - `libx264 -preset veryfast -crf 23`, `yuv420p`, AAC 128k, `-movflags +faststart`.
  - En çok 1080p: kısa kenar 1080'e indirilir, dikey videolar dahil.
  - `-map_metadata -1`: iPhone konum ve cihaz bilgisi silinir.
  - Kapak: 1. saniyedeki kare (çok kısa videoda 0. saniye), WebP + JPEG. Admin kapak seçmediyse hekim medyasına otomatik atanır. AE'deki tarayıcı-canvas yöntemi yedek olarak duruyor.
- **Kaynak sınırları:** Linux'ta `nice -n 19`, `-threads 2`, iş başına 10 dk. Süre aşılırsa süreç SIGKILL ile öldürülür ve iş "Başarısız" olur.
- **Güvenlik:**
  - ffmpeg her çağrıda `-nostdin -y -protocol_whitelist file,pipe` ile çalışır.
  - Girdi yalnızca MOV/MP4 demuxer'ıyla açılır (`-f mov`).
  - `spawn` argüman dizisiyle, kabuksuz çalışır; yollar sunucunun ürettiği UUID'lerden oluşur.
  - Süreç imajdaki `nodejs` kullanıcısıyla çalışır; ara dosyalar iş klasöründe tutulur ve iş bitince silinir.
  - HLS/m3u8 ve concat girdileri yüklemede (imza denetimi) ve ffmpeg'de (`-f mov`) reddedilir.
- **Hata:**
  - "Başarısız" durumu ve okunabilir bir mesaj gösterilir (ör. "Dönüştürme 10 dakikayı aştı ve durduruldu.", "Sunucuda ffmpeg bulunamadı").
  - Orijinal 24 saat saklanır, sonra saatlik temizlikte silinir.
  - Uçlar: `POST /admin/media/:mediaId/transcode/retry` (yeniden dene) ve `GET /admin/media/transcode-jobs` (kuyruk).
- **Admin ekranı:**
  - Durum rozeti (İşleniyor / Hazır / Başarısız), "Sırada: N", "Yeniden dene", boyut ve süre önce/sonra.
  - İşlenen video varken ekran 10 sn'de bir yenilenir.
  - Medya kütüphanesinde de durum rozeti gösterilir.

### Hasta belgeleri

Hasta belgeleri (`AppointmentDocument`, intake ekleri, hastanın yüklediği her şey) ayrı uçtan (`/appointments/bookings/:id/documents`) ve ayrı özel depodan geçer. Bu dosyalar sharp'a ya da ffmpeg'e hiç verilmez ve olduğu gibi saklanır.

Bunu bir spy testi doğruluyor: hastanın EXIF'li JPEG belgesi yüklenirken sharp çağrısı 0, `spawn` çağrısı 0. Belge bayt bayt aynı kalıyor (sha256 eşit).

## Migration (yalnızca ekleme) — `20261105090000_media_transcode`

```sql
ALTER TABLE "media" ADD COLUMN "variants" JSONB;
ALTER TABLE "media" ADD COLUMN "processingStatus" TEXT;

CREATE TABLE "media_transcode_jobs" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sourcePath" TEXT,
    "sourceContainer" TEXT NOT NULL,
    "sourceSizeBytes" INTEGER NOT NULL,
    "sourceCodec" TEXT,
    "sourceDurationSec" DOUBLE PRECISION,
    "outputSizeBytes" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "sourceDeleteAfter" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "media_transcode_jobs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "media_transcode_jobs_mediaId_key" ON "media_transcode_jobs"("mediaId");
CREATE INDEX "media_transcode_jobs_status_notBefore_queuedAt_idx" ON "media_transcode_jobs"("status", "notBefore", "queuedAt");
ALTER TABLE "media_transcode_jobs" ADD CONSTRAINT "media_transcode_jobs_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

`prisma migrate diff` (e2e veritabanı ↔ şema) boş. Mevcut veriye dokunulmuyor; `processingStatus = NULL` "hazır" (eski kayıt) demek.

## Örnek dönüşüm sonuçları

**Gerçek derlenmiş imaj içinde** (`docker build backend/`, `nodejs` kullanıcısı, ffmpeg 8.1.3, sharp 0.35.5 / libvips 8.18.7):

| Girdi | Çıktı |
|---|---|
| Dikey HEVC `.MOV`, 1440×1920, 4 sn, ses + konum meta verisi — **3,4 MB** | H.264 High, yuv420p, **1080×1440**, AAC, faststart — **1,06 MB** (0,7 sn'de dönüştü). Konum etiketi çıktıda yok. |
| Aynı videodan kapak | WebP 1080×1440 + JPEG kopya |
| 12 MP JPEG (4032×3024, EXIF + GPS, yüksek ayrıntı) — **7,4 MB** | WebP 2560×1920 **1,6 MB** + JPEG kopya 300 KB; EXIF yok |
| HLS çalma listesi (`169.254.169.254` adresli) | Reddedildi ("Invalid data found when processing input") |
| 10 dk'lık kodlama, 1,5 sn sınırla | `ProcessTimeoutError`; süreç öldürüldü |

**Yerel geliştirme verisi** (dosyalar değiştirilmedi, yalnızca ölçüldü):

| Dosya | Önce | WebP | Kopya |
|---|---|---|---|
| PNG 585×578 | 651 KB | 28 KB | JPEG 40 KB, PNG 358 KB |
| JPEG 1920×1080 (çok ayrıntılı demo görseli) | 489 KB | 413 KB (kalite 72'ye düşüldü) | JPEG 434 KB |
| "1×1 PNG" (8 MB'lık test kalıntısı) | 8 MB | reddedildi: bozuk | — |

- Yerel 18 678 görselden düzenli aralıklarla alınan 407 dosyalık örneğin **tamamı** sorunsuz işlendi.
- Gerçek telefon fotoğraflarında WebP genelde orijinalin %20–35'i olur. Kopyalarla birlikte toplam diskte orijinalin yaklaşık %35–60'ı beklenir. Kesin rakamı canlıda scriptin kuru çalışması verir.

## Beklenen ek disk kullanımı

- **Fotoğraf:** orijinal saklanmadığı için yeni yüklemelerde net azalma beklenir. Uyumluluk kopyaları (JPEG ≤1600 px, gerekirse PNG) ana WebP'nin kabaca %20–100'ü kadar ek yer tutar.
- **Video:**
  - Kuyrukta en çok bir orijinal + bir çıktı aynı anda vardır (≤ 100 MB + çıktı).
  - Başarısız işlerin orijinalleri 24 saat durur.
  - 1080p CRF 23 çıktı dakikada yaklaşık 5–10 MB tutar.
- **Script yedeği:** gerçek çalıştırmada dönüştürülen bütün görsellerin bir kopyası `storage/media-backup/<runId>/` altında durur. Bu, mevcut görsellerin toplam boyutu kadar yer demek; elle silinene kadar kalır.
- **Önemli:** `/app/storage` bir Docker volume'ü değil. Konteyner yeniden kurulunca bu klasördeki her şey silinir: yedekler, sırada bekleyen video orijinalleri.
  - Script yedeği gerçek çalıştırmadan hemen sonra sunucuya kopyalanmalı (aşağıdaki dağıtım sırasına bakın).
  - Deploy anında kuyrukta video varsa o işler "Orijinal video bulunamadı; yeniden yükleyin" ile başarısız olur.
- İzleme scriptinin disk kontrolü bu klasörleri zaten kapsıyor.

## Güncellik ve denetim

- **`npm audit --omit=dev`:** 19 bulgu (2 düşük, 8 orta, 9 yüksek).
  - Master'ın kilit dosyasıyla aynı sayı; sharp yeni bulgu eklemiyor.
  - Bulgular var olan bağımlılıklarda: `@fastify/busboy`, `brace-expansion`, `deepmerge`, `fast-copy` vb.
  - Ayrı bir bağımlılık güncelleme işi olarak önerilir; bu pakette dokunulmadı.
- **Sürümler:** sharp 0.35.5 (libvips 8.18.7). ffmpeg 8.1.3 (Alpine `ffmpeg` paketi, `node:22-alpine` tabanı).
- **Aylık güncelleme kontrolü:**
  ```bash
  cd backend && npm outdated sharp
  docker compose build --no-cache --pull backend   # ffmpeg ve Alpine yamaları imaj yeniden derlenince güncellenir
  ```

## Testler

**Arka uç tam paket** (`--no-file-parallelism`, rebase öncesi): **2632 geçti**, 15 atlandı. İki dosya düştü:
- `telehealth-demo-payment`: bilinen. Worktree'nin yerel `.env`'i (`NODE_ENV=production` + demo ödeme); master'da da aynı.
- `auth-email-verification`: **kod hatası değil, test veritabanı kilitlenmesi.**
  - Tam koşuda `beforeAll` içindeki `resetDatabase()` → `TRUNCATE` Postgres `40P01 deadlock detected` aldı. Bir süreç `AccessExclusiveLock` bekliyor, diğeri `AccessShareLock`.
  - Bu, açılışta çalışan zamanlayıcıların test sıfırlamasıyla çakışması; Paket Y raporundaki desenin aynısı.
  - Dosya tek başına **3 kez** koşturuldu: üçünde de **10/10 geçti**.
  - AE-ek test ortamında zamanlayıcı kurmuyor (dönüştürme işçisi `NODE_ENV=test`'te kayıtlı değil), bu yüzden yeni bir kilit kaynağı eklemiyor.

**Rebase sonrası:**
- Arka uç `tsc` temiz.
- AE-ek, medya, AE video, profil/yorum ve e-posta testleri: **5 dosya / 193 test geçti**.
- `eslint` değişen bütün dosyalarda temiz.

**Ön yüz tam paket** (rebase sonrası, medya adres düzeltmesiyle birlikte): **1552 geçti**, 2 düştü. Düşen ikisi `edit-blog-post-page.test.tsx`; master'da da düşüyor. `tsc` ve `eslint` temiz.

**Paket testleri** (`media-transcode-ae-ek.test.ts`, 13 test, art arda 3 koşuda kararlı):
- Fotoğraf:
  - JPEG → WebP: EXIF/GPS/kamera bilgisi silinir (ham baytlarda "iPhone" yok), EXIF yönü uygulanır, orijinal saklanmaz.
  - 4000×3000 → 2560×1920; küçük görsel büyütülmez; kopya en çok 1600 px.
  - Saydam PNG: WebP'de alfa korunur, PNG kopyası yazılır.
  - Logo PNG kopyası; e-posta bağlamındaki logo adresi `.png` (WebP değil).
  - Favicon PNG kalır.
  - Piksel bombası, HEIC ve SVG reddedilir.
- Video:
  - HEVC MOV kabul edilir; "İşleniyor" iken sitede görünmez. Dönüştürme sonrası H.264 + faststart + WebP kapak; orijinal silinir.
  - Playlist/HLS/concat reddedilir; ffmpeg argümanları (`-f mov`, whitelist, `-threads 2`, `nice -n 19`, `-map_metadata -1`) doğrulanır.
  - Aktif görüşme (IN_PROGRESS randevu) varken iş ertelenir; görüşme bitince çalışır.
  - Aynı anda en çok 1 dönüştürme.
  - Zaman aşımında süreç gerçekten öldürülür, iş "Başarısız" olur, yeniden denenebilir; 24 saat sonra orijinal silinir ve yeniden deneme 409 döner.
- Hasta belgeleri: sharp/spawn spy testi.
- Script: kuru çalışma (yazmaz), operatörsüz gerçek çalışma reddedilir.
  - Gerçek çalışma WebP + kopyaları üretir, eski yol meta verisiz aynı biçimde kalır.
  - İçerik HTML'i, kapak ve logo güncellenir; OG değişmez.
  - İkinci çalıştırma tekrar dönüştürmez.
  - Geri alma dosyaları bayt bayt, satırları ve referansları geri getirir; ikinci geri alma reddedilir.

**Eski testlerde güncellemeler:**
- `media.test.ts`: eski "1×1 PNG" örneği aslında bozukmuş (IDAT hatalı), JPEG örneği ise yalnızca 10 baytlık imzaymış. Eski imza denetimi bunu fark etmiyordu. İkisi gerçek görsellerle değiştirildi; beklentiler WebP'ye göre güncellendi.
- `media-video-reviews-ae.test.ts`: video artık önce "işleniyor"; MOV ve diğer kodekler kabul edilir, HEVC/moov uyarıları kalktı.

**Ön yüz testleri:** 47 yeni ya da güncellenmiş test.
- MOV kabulü, durum rozetleri, "Sırada: N", yeniden dene ve 409.
- 10 sn yenilemenin iş bitince durması.
- `purpose` (logo/icon), Open Graph yardımcısı, `seo.ts`'te `.jpg`.

## Canlıya alma sırası

1. `git pull` (dal birleştirildikten sonra).
2. **Migration** (depo kökünden, uygulama yeniden kurulmadan önce):
   ```bash
   DB_URL=$(docker compose exec -T backend printenv DATABASE_URL | tr -d '\r')
   NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' $(docker compose ps -q db))
   docker run --rm --network "$NET" -v "$PWD/backend/prisma:/app/prisma" -w /app -e DATABASE_URL="$DB_URL" \
     node:20-alpine sh -c "apk add --no-cache openssl >/dev/null && npx --yes prisma@5.22.0 migrate deploy"
   ```
3. **Backend imajı yeniden derlenir.** ffmpeg kurulumu nedeniyle ilk derleme uzun sürer:
   ```bash
   docker compose up -d --build --no-deps backend frontend
   docker compose exec backend sh -c 'ffmpeg -version | head -1 && node -e "console.log(require(\"sharp\").versions.sharp)"'
   ```
4. **Mevcut medya — önce kuru çalışma:**
   ```bash
   docker compose exec backend node dist/cli/convert-existing-media.js
   ```
   Çıktıyı kontrol edin: aday sayısı, önce/sonra toplam boyut, atlananlar, `unlistedColumnsWithUploads` (listede olmayan ama görsel adresi içeren kolonlar; güncellenmez, eski yolları çalışmaya devam eder).
5. **Gerçek çalıştırma** (sitenin sakin olduğu bir saatte):
   ```bash
   docker compose exec backend node dist/cli/convert-existing-media.js --confirm=convert-media --operator=<adınız>
   docker compose cp backend:/app/storage/media-backup ./media-backup-$(date +%F)   # yedeği konteyner dışına alın
   ```
   Geri almak gerekirse:
   ```bash
   docker compose exec backend node dist/cli/convert-existing-media.js --restore=<runId> --confirm=convert-media --operator=<adınız>
   ```
   Yedek konteyner yeniden kurulduktan sonra geri alınacaksa, önce `./media-backup-…/<runId>` klasörünü `docker compose cp` ile `/app/storage/media-backup/` altına geri kopyalayın.
6. **Kontrol:**
   - Admin'de bir fotoğraf yükleyin: "WebP olarak kaydedildi … konum ve kamera bilgileri silindi" mesajı çıkmalı.
   - Bir iPhone MOV yükleyin: "İşleniyor" → "Hazır" olmalı, sitede H.264 MP4 oynamalı.
   - Test e-postasında logo görünmeli.
   - Bir paylaşım önizlemesinde Open Graph görseli `.jpg` olmalı.

**Elle yapılacaklar:** yalnızca 2–5. adımlar (migration, imaj derlemesi, script). Nginx değişikliği gerekmiyor: AE'deki video ucu ayarı aynen geçerli.
