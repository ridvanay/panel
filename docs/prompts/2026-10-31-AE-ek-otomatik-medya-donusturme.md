# Paket AE-ek: Otomatik medya dönüştürme (fotoğraf → WebP, video → H.264 MP4) (2026-10-31)

**Bütün cevaplarını ve raporunu Türkçe yaz.** Testler sıralı koşar. Push etme.

## Başlangıç
- **Paket AE bittikten sonra** başla. AE dalının üzerine ya da AE master'a girdiyse `origin/master` üzerinden `feat/media-transcode-oct31` dalını aç; hangisini kullandığını rapora yaz.
- **Kullanıcı onaylı kırmızı çizgi istisnaları (yalnızca bu iki madde):**
  1. Backend'e **`sharp`** npm paketi eklenebilir: güncel kararlı sürüm, `package.json` ve lock dosyası.
  2. **Backend** Dockerfile'ının çalışma (runtime) aşamasına **`ffmpeg`** eklenebilir (`apk add --no-cache ffmpeg`).
  - Başka paket, başka Dockerfile değişikliği ya da compose değişikliği **yok.** Frontend Dockerfile'ına dokunulmaz.
- Diğer kırmızı çizgiler aynı: `consultation-room.tsx`, LiveKit, ödeme ve randevu kuralları, Nginx, `.env`, `docs/legal/`.
- Migration yalnızca ekleme yapar.

## Kapsam (önemli)
- **Yalnızca admin/personel tarafından yüklenen site medyası dönüştürülür:**
  - medya kütüphanesi
  - hekim fotoğraf ve videoları
  - slider
  - blog kapakları
  - logo
- **Hasta belgeleri** (`AppointmentDocument`, intake ekleri, tercüman/destek dosyaları ve hastanın yüklediği her şey) **hiçbir şekilde dönüştürülmez, sharp ya da ffmpeg'e verilmez.** Mevcut haliyle saklanmaya devam eder. Bunu bir test doğrulasın.

## İş 1: Fotoğraf dönüştürme (sharp)
- **Kabul edilen girdiler:** JPEG, PNG, WebP, HEIC/HEIF (sharp destekliyorsa; desteklemiyorsa net bir hata mesajı). Tür, içerikten belirlenir.
- **İşleme adımları:**
  - EXIF yönüne göre döndür.
  - **Bütün meta verileri sil:** EXIF, GPS, kamera bilgisi, ICC dışındaki her şey.
  - En uzun kenar en çok **2560 px**; küçük görseller büyütülmez.
  - **WebP** olarak kaydet (kalite ≈ 82). Saydam PNG'lerde saydamlık korunur.
- **Uyumluluk kopyası:**
  - Logo ve e-posta logosu için ayrıca **PNG** kopyası, diğer görseller için **JPEG** kopyası (≈ 85, en çok 1600 px) saklanır.
  - E-posta şablonu (`branded-mail.ts`) ve Open Graph görselleri bu kopyayı kullanır; sosyal ağlar ve e-postalar WebP'yi her zaman göstermiyor.
- Orijinal dosya **saklanmaz.** Yalnızca işlenmiş sürümler tutulur (gizlilik ve disk için).
- **Güvenlik:**
  - `limitInputPixels` (örn. 50 MP) aşan görseller reddedilir.
  - Görsel başına zaman aşımı uygulanır.
  - SVG bu yola hiç girmez ve reddedilmeye devam eder.
- **Mevcut medya için script:** `backend/scripts/convert-existing-media.ts`
  - Varsayılan kuru çalışma; gerçek çalıştırma `--confirm=convert-media --operator=...` ile.
  - Mevcut görselleri WebP'ye çevirir.
  - Veritabanındaki bütün referansları (`logoUrl`, `avatarMediaId`, `coverImageUrl`, slider vb.) günceller.
  - Eski dosyaları önce yedek klasörüne taşır; `--restore` desteği olur.
  - Rapor: dosya sayısı, toplam boyut (önce/sonra).

## İş 2: Video dönüştürme (ffmpeg)
- **Kabul edilen girdiler:** MP4 ve MOV (iPhone). Tür, içerikten belirlenir. Sınır AE'deki gibi 100 MB.
- **Kuyruk:**
  - Yükleme sonrası video **"İşleniyor"** durumunda kalır; sitede görünmez.
  - Arka plan işi videoları **tek tek** işler; aynı anda en çok 1 dönüştürme.
  - Dönüştürme bitince otomatik olarak "Hazır" olur. Admin "Yayında" anahtarını açtıysa sitede görünür.
  - Hata olursa "Başarısız" durumu ve okunabilir bir hata mesajı gösterilir. Orijinal 24 saat saklanır, sonra silinir.
- **Çıktı:**
  - H.264 (`libx264`, `-preset veryfast`, `-crf 23`), AAC 128k.
  - En çok 1080p; daha küçükse ölçek değişmez.
  - `-movflags +faststart`, `yuv420p`.
  - Kapak görseli: 1. saniyedeki kare, WebP ve JPEG olarak. AE'deki tarayıcı-canvas yöntemi yedek olarak kalır; admin kendi kapağını yükleyebilir.
- **Kaynak sınırları (canlı görüşmeleri korumak için):**
  - ffmpeg `nice -n 19` ile ve **`-threads 2`** ile çalışsın.
  - **Aktif bir görüşme varsa** (IN_PROGRESS randevu veya LiveKit'te aktif oda) yeni dönüştürme başlamasın; 2 dakika sonra tekrar denesin. Bu kontrol mevcut veriden yapılsın, LiveKit koduna dokunulmasın.
  - İş başına zaman aşımı **10 dakika**; aşılırsa süreç öldürülür ve video "Başarısız" olur.
- **Güvenlik:**
  - ffmpeg her zaman şu bayraklarla çalışsın: `-protocol_whitelist file,pipe`, `-nostdin`, `-y`; girdi ve çıktı yolları sabit ve sunucunun kendi ürettiği yollar olsun.
  - Dosya adları kullanıcıdan alınmaz; `spawn` argüman dizisi kullanılır, **shell yok.**
  - Girdi yalnızca MP4/MOV demuxer'ı ile açılır (`-f mov`), HLS/playlist/concat gibi biçimler reddedilir.
  - Çalışan süreç root değil; konteynerdeki mevcut `nodejs` kullanıcısı.
  - Geçici dosyalar özel bir klasörde tutulur ve iş bitince silinir.
- **Admin ekranı:**
  - durum rozeti (İşleniyor / Hazır / Başarısız)
  - kuyruktaki sıra
  - yeniden dene
  - boyut ve süre bilgisi (önce/sonra)

## İş 3: İzleme ve güncellik
- Disk kullanımı: dönüştürme klasörü izleme scriptinin disk kontrolüne zaten dahil. Rapora, beklenen ek disk kullanımını yaz.
- `npm audit`, sharp'ın ve ffmpeg'in sürümünü raporlasın.
- Rapora "aylık güncelleme kontrolü" için iki komut yaz: sharp için `npm outdated sharp`, ffmpeg için imaj yeniden derlemesi.

## Testler
- **Fotoğraf:**
  - PNG, JPEG ve HEIC → WebP dönüşümü.
  - EXIF/GPS'in silindiği doğrulanır (çıktıda konum yok).
  - 2560 px sınırı.
  - Saydamlık korunuyor.
  - Logo için PNG kopyası; e-posta bu kopyayı kullanıyor.
  - Piksel bombası reddediliyor.
- **Video:**
  - HEVC MOV → H.264 MP4, `faststart` ve kapak üretiliyor.
  - Zaman aşımında süreç öldürülüyor.
  - Playlist/HLS girdisi reddediliyor.
  - Aktif görüşme varken iş bekliyor.
  - Aynı anda tek iş çalışıyor.
- **Hasta belgeleri:** sharp/ffmpeg'e **hiç gönderilmiyor** (spy testi).
- **Script:** kuru çalışma, gerçek çalışma ve geri alma, referans güncellemeleri.
- Tam backend paketi sıralı; tip ve lint kontrolü.
- **Kırmızı çizgi kontrolü:** `consultation-room.tsx`, `livekit*`, billing, checkout, frontend `package.json`, compose ve frontend Dockerfile diff'leri **boş.** Backend `package.json` diff'i yalnızca `sharp`, backend Dockerfile diff'i yalnızca ffmpeg satırı olmalı.

## Rapor
`docs/prompts/2026-10-31-AE-ek-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- Dockerfile ve `package.json` diff'leri
- migration SQL
- örnek dönüşüm sonuçları (boyut önce/sonra)
- testler
- canlıya alma sırası: backend imajı yeniden derlenir (ffmpeg kurulumu nedeniyle ilk derleme uzun sürer), sonra `convert-existing-media` önce kuru, sonra gerçek çalıştırma
