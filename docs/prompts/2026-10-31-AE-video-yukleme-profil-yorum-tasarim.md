# Paket AE: Video yükleme (≤100 MB), PNG hatası, anasayfa yorum tasarımı, hekim profilinin sadeleştirilmesi (2026-10-31)

**Bütün cevaplarını ve raporunu Türkçe yaz.** Testler sıralı koşar. Push etme.

## Başlangıç
- Güncel `origin/master` (`2be6c3b`) üzerinden `feat/media-profile-polish-oct31` dalını aç.

## KIRMIZI ÇİZGİ
- `consultation-room.tsx`, LiveKit, ödeme ve randevu kuralları değişmez.
- compose, Dockerfile'lar, `.env`, `docs/legal/` değişmez.
- **Nginx'e dokunma.** Video yükleme için gereken Nginx ayarını yalnızca rapora yaz; sunucuda ben uygulayacağım.
- Yeni npm paketi yok. Sistemde ffmpeg olduğunu varsayma.
- Migration yalnızca ekleme yapar.

---

## İş 1: Sunucuya video yükleme (en çok 100 MB)
Hekim medya bölümüne kısa tanıtım ve işlem videoları doğrudan yüklenebilsin. YouTube/Vimeo seçeneği kalmaya devam eder.
- **Kabul edilen dosyalar:**
  - Yalnızca **MP4**. Tür, dosya içeriğinden doğrulanır (`ftyp` kutusu).
  - En çok **100 MB**. Sınır admin ayarından değiştirilebilsin; varsayılan 100.
- **Codec kontrolü (ffmpeg olmadan, MP4 kutularını okuyarak):**
  - **H.264 (`avc1`)** kabul edilir.
  - **HEVC/H.265 (`hvc1`/`hev1`)** yüklenirse dosya reddedilmez, ama admin'e uyarı gösterilir: "Bu video iPhone'un HEVC biçiminde. Bazı tarayıcılarda (Windows Chrome/Firefox) oynatılamayabilir. iPhone'da Ayarlar → Kamera → Biçimler → 'En Uyumlu' seçip yeniden çekin ya da H.264'e dönüştürün."
  - `moov` kutusu dosyanın sonundaysa uyarı gösterilir: "Video akışlı oynatma için optimize değil, yüklenmesi yavaş olabilir."
- **Yükleme:**
  - Dosya sunucuya **akışla** yazılsın; belleğe alınmasın. Mevcut medya yükleme yolunda bu mümkün değilse ayrı bir uç yaz: `POST /admin/media/video`.
  - Admin ekranında ilerleme çubuğu ve iptal düğmesi olsun.
  - Yükleme yalnızca ADMIN/yetkili personel tarafından yapılabilsin ve hız sınırı uygulansın.
- **Kapak görseli (ffmpeg yok):**
  - Admin videoyu seçtiğinde tarayıcı videoyu yükler, 1. saniyedeki kareyi `<canvas>` ile alıp JPEG kapak olarak videoyla birlikte gönderir.
  - Admin istediği saniyeyi seçebilsin ya da kendi kapak görselini yükleyebilsin.
- **Oynatma:**
  - Videolar **HTTP Range (206)** isteklerini desteklemeli. Yoksa iPhone Safari'de oynatma ve ileri sarma çalışmaz.
  - Doğru `Content-Type: video/mp4`, `Accept-Ranges: bytes` ve uzun önbellek başlıkları kullanılsın.
  - Sitede `<video>` etiketi: `preload="none"` (sayfa hızı için), kapak görseli, `controls`, `playsinline`.
  - Oynat'a basılmadan video indirilmesin.
  - Altyazı (VTT) yükleme alanı opsiyonel olarak eklensin.
- **Nginx (rapora yaz, uygulama):**
  - Yalnızca video yükleme ucuna `client_max_body_size 110m` ve gerekli zaman aşımı ayarları.
  - Videolar Nginx'ten ya da backend'den hangi yolla sunuluyorsa, Range desteğinin nasıl sağlandığını açıkla.
- **Depolama:** Mevcut uploads volume'u kullanılır. Dosya adı rastgele olsun, orijinal ad saklanmasın. Gece yedeği bu dosyaları zaten kapsıyor.

## İş 2: PNG yükleme hatası
- Hata: "Beyan edilen dosya türü, dosya içeriğiyle uyuşmuyor."
- Büyük ihtimalle dosyaların uzantısı `.PNG` ama içeriği JPEG/WebP ya da HEIC (iPhone ve yapay zekâ ile üretilmiş görsellerde sık görülür).
- **Yeni davranış:** Dosya türü **içerikten** belirlensin.
  - İçerik izin verilen bir görsel türüyse (JPEG, PNG, WebP), uzantı ve MIME içerikle uyumlu olacak şekilde **düzeltilerek kabul edilsin.** Admin'e "Dosya JPEG olarak kaydedildi" bilgisi gösterilsin.
  - HEIC/HEIF ise net bir mesajla reddedilsin: "iPhone HEIC biçimi desteklenmiyor. JPEG/PNG olarak dışa aktarın."
  - SVG ve diğer türler reddedilmeye devam etsin.
- Bu davranış bütün medya yükleme noktalarında (medya kütüphanesi, hekim medyası, logo) aynı olsun.

## İş 3: Anasayfa "What our patients say" bölümünün yeniden tasarımı
**Sorun:**
- Kartların yüksekliği farklı; uzun yorumlar sayfayı uzatıyor.
- Başlıklar yorumun ilk cümlesinden üretilip "…" ile kesiliyor.
- Kartlar sağ kenarda yarım kalıyor.

**İstenen düzen:**
- **Üst özet şeridi:**
  - büyük ortalama puan ("5.0"), yıldızlar, "26 doğrulanmış yorum"
  - hastaların geldiği ülke bayrakları (en çok 6, gerisi "+N")
- **Kart ızgarası/karuseli:**
  - Masaüstünde 3, tablette 2, mobilde 1 kart. **Bütün kartlar eşit yükseklikte.**
  - Kart başı ve gövde:
    - Başta: baş harflerden oluşan avatar, ad baş harfleri, ülke bayrağı, tarih ve "Verified patient" rozeti.
    - Yıldızlar.
    - Başlık **yalnızca hasta kendisi yazdıysa** gösterilir. Gövdeden otomatik başlık üretilmez.
  - Yorum metni **5 satırla sınırlansın** (line-clamp). Altında "Devamını oku" olsun; tamamı **modal** içinde açılsın (klavye, ESC, odak tuzağı).
  - Kart altı: "Hekim: Doç. Dr. V. Mutlu" bağlantısı ve yorumun yazıldığı dilin etiketi. Yönetici çevirisi varsa "Çeviriyi göster".
- **Gezinme:**
  - Ok düğmeleri ve noktalar, mobilde kaydırma.
  - Kart kenarda yarım kalmasın; kaydırma noktaları tam karta otursun (scroll-snap).
  - Otomatik geçiş olmasın.
- **Altta:** "Tüm yorumları gör" düğmesi. Yeni bir `/[lang]/reviews` sayfası açılsın: filtreler (hekim, dil, puan) ve sayfalama.
- **Dil önceliği:** Yorumların sırası ziyaretçinin diline göre ayarlansın; önce aktif dildeki yorumlar, sonra diğerleri.
- RTL ve erişilebilirlik desteklensin. Ekran görüntüleri: 390, 768 ve 1440 px, EN/TR/AR.

## İş 4: Hekim profil sayfasının sadeleştirilmesi
**Sorun:** Sayfa çok uzun. Overview'da uzun bir CV metni ve tam yayın listesi alt alta diziliyor.

**İstenen düzen:**
- **Hero:**
  - Mevcut tasarım kalır, ama daha kompakt olsun.
  - Hero'ya **"Önemli bilgiler" şeridi** eklensin: deneyim yılı, konuştuğu diller, yayın sayısı, işlem sayısı, hasta yorumu ortalaması (yalnızca 3+ yorum varsa).
  - Sosyal medya ikonları tekrar etmesin; ekran görüntüsünde iki Instagram ikonu var, nedenini bul.
- **Sekmeler:**
  - Gerçek sekme davranışı olsun: aynı anda **tek bölüm** görünür.
  - URL hash'i (`#reviews` gibi) değiştiğinde doğru sekme açılsın; geri tuşu çalışsın.
  - Sekme sırası: Genel bakış · Tedaviler · Foto/Video · Deneyim ve yayınlar · Yorumlar · SSS. Boş sekmeler gizlenir.
- **Genel bakış:**
  - Bio'nun ilk ~6 satırı görünür, altında "Devamını oku" (yerinde açılır).
  - "Öne çıkan uzmanlık alanları" çipleri gösterilsin.
  - Medya bölümünden 3–4 görselin önizlemesi ve "Tümünü gör" bağlantısı olsun.
  - En son 2 yorumun önizlemesi gösterilsin.
- **Deneyim ve yayınlar:**
  - Eğitim, deneyim, ödül ve üyelik için **zaman çizelgesi** görünümü kullanılsın.
  - Yayınlar türe göre gruplansın (uluslararası, ulusal, kitap bölümü, bildiri). Her grupta **ilk 5** yayın gösterilsin, altında "Tümünü göster (N)" olsun.
  - Yayın listesinde yıl filtresi ve arama olsun.
- **Foto/Video:**
  - Izgara ve lightbox.
  - Videolar kapak görseliyle gösterilsin ve modal içinde oynatılsın.
- **Randevu kutusu:** Masaüstünde sağda yapışkan kalsın (mevcut davranış). Mobilde alt sabit "Randevu al" düğmesi olsun.
- **Hedef:** Masaüstünde profil sayfası açıldığında, kaydırmadan önce sekmeler ve özet görünsün. Sayfanın toplam yüksekliği, sekmeli düzen sayesinde mevcut halin yaklaşık 1/3'üne insin. Önce ve sonra ölçümünü rapora yaz.
- **Değişmeyenler:** SEO, JSON-LD, görünen ad kuralı, founder davranışı ve tercüman rozeti. Sekmelerdeki içerik HTML'de bulunmaya devam etsin (SEO için); yalnızca görsel olarak gizlensin.

---

## Testler
- **Video:**
  - MP4 kabul edilir, MP4 olmayan dosya reddedilir.
  - 100 MB üstü reddedilir.
  - HEVC ve `moov`-sonda uyarıları çıkar.
  - Range isteği `206` döner (`curl -r 0-99`).
  - Oynat'a basılmadan video indirilmez.
- **PNG düzeltmesi:**
  - Uzantısı `.PNG` olan JPEG kabul edilir, JPEG olarak kaydedilir.
  - HEIC net mesajla reddedilir.
  - SVG reddedilir.
- **Yorum bölümü:**
  - Kartlar eşit yükseklikte.
  - 5 satır kırpması ve modal çalışır.
  - Otomatik başlık üretilmez.
  - `/reviews` sayfası, filtreler ve sayfalama çalışır.
  - Ziyaretçinin dilindeki yorumlar önce gelir.
- **Profil:**
  - Sekme hash davranışı çalışır.
  - Tekrar eden sosyal ikon yok.
  - Yayın gruplaması ve "Tümünü göster" çalışır.
  - Sayfa yüksekliği önceki ve sonraki ölçümle karşılaştırılır.
  - SEO/JSON-LD değişmemiş.
- RTL, 9 dil sözlük eşitliği, tip ve lint kontrolü.
- **Kırmızı çizgi kontrolü boş olmalı:** `consultation-room.tsx`, `livekit*`, billing, checkout, `package.json`, compose, Nginx.

## Rapor
`docs/prompts/2026-10-31-AE-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- **Nginx için gereken ayar metni** (benim uygulayacağım)
- migration SQL
- önce/sonra ekran görüntüleri (`docs/prompts/2026-10-31-AE-ekran/`)
- profil sayfası yüksekliği ölçümleri
- testler
- canlıya alma sırası
