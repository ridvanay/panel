# Paket Y: Zengin hekim profili (video, foto, işlemler) ve hasta memnuniyet yorumları (2026-10-30)

**Hızlı Mod geçerli.** Testler sıralı koşar. **Bütün cevaplarını ve raporunu Türkçe yaz.**

## Başlangıç
- V paketinden sonra `origin/master` üzerinden `feat/physician-profile-reviews-oct30` dalını aç. Push etme.

## KIRMIZI ÇİZGİ
- `consultation-room.tsx`, LiveKit, meeting-token, kayıt, egress
- Ödeme ve randevu oluşturma kuralları
- docker-compose, Dockerfile'lar, **Nginx (yükleme boyut sınırı dahil)**, `.env`, `docs/legal/`
- Yeni npm paketi yok.
- Migration yalnızca ekleme yapar.
- **Uydurma yorum yok.** Seed, örnek ya da "demo" yorum verisi canlıya girmez. Testlerde fixture kullanılır.

---

## İş 1: Hekim profili yeni düzeni

`/[lang]/physicians/[slug]` sayfası sekmeli ya da bölümlü düzene geçsin. Masaüstünde yapışkan sekme çubuğu, mobilde yatay kaydırılabilir çipler.
1. **Overview:**
   - mevcut bio ve about
   - konuştuğu diller
   - görev yaptığı hastane/klinik
   - "Kendi dilinizde destek" rozeti (V paketi)
2. **Treatments & Procedures:**
   - yeni `DoctorProcedure` listesi
   - akordeon: ne yapılır, süre, anestezi, hastanede kalış, iyileşme
   - fiyat yok
3. **Photos & Videos:** galeri (bkz. İş 2)
4. **Experience & Publications:** mevcut CV ve yayın listesi
5. **Patient Reviews:** bkz. İş 3
6. **Book:** mevcut randevu kutusu. Masaüstünde sağda yapışkan, mobilde alt sabit "Book" düğmesi.

- Mevcut SEO, JSON-LD, görünen ad kuralı (U/C) ve founder davranışı **değişmez.**
- Boş bölümler gösterilmez.

## İş 2: Medya (foto ve video)

**`DoctorMedia`:**
- `doctorId`
- `kind`: photo / video
- `mediaId`: fotoğraf ya da kısa mp4; mevcut Media modülü ve mevcut yükleme sınırı
- `videoProvider` (youtube/vimeo) ve `videoId`
- `category`: about, clinic, procedure, interview, before-after
- `translations` (başlık/açıklama)
- `patientConsentConfirmed` (bool), `consentNote`
- `isPublished`, `sortOrder`

**Kurallar:**
- **Video gömme:**
  - YouTube için `youtube-nocookie.com`.
  - Önce yalnızca küçük resim gösterilir. Oynat'a basılınca iframe yüklenir (çerez ve KVKK açısından zorunlu).
  - Vimeo için `dnt=1`.
  - Küçük resim sunucumuza kopyalanmaz; sağlayıcının statik küçük resim adresi kullanılır. CSP'de izin gerekiyorsa yalnızca rapora yaz, Nginx'e dokunma. Next.js header'ları üzerinden yapılabiliyorsa yap ve rapora yaz.
- **Hasta görünen içerik (`before-after` ve hastanın tanınabileceği her içerik):**
  - `patientConsentConfirmed=true` olmadan yayınlanamaz (backend doğrulaması).
  - Admin'de "Hastadan yazılı onay alındı" kutusu ve not alanı.
  - Site ayarı `beforeAfterEnabled` varsayılan **false**. Hukuk onayı gelene kadar bu kategori hiç görünmez.
- **Galeri:**
  - ızgara ve lightbox (klavye, swipe, ESC)
  - lazy yükleme, `next/image` ve uygun boyutlar
  - alt metin zorunlu
- Büyük videoların sunucuya yüklenmesi yerine YouTube/Vimeo önerilsin. Admin formunda bu yönlendirme notu dursun.

## İş 3: Hasta memnuniyet yorumları

**`Testimonial`:**
- `doctorId` (opsiyonel; kurum yorumu için boş), `specialtyId` (opsiyonel)
- `bookingId` (opsiyonel, doğrulanmış hasta için)
- `authorDisplay` (varsayılan baş harf ve ülke, örn. "M. K., Germany")
- `country`, `language`
- `rating` (1–5)
- `title`, `body` (orijinal dilde)
- `translations` (opsiyonel, yönetici çevirisi)
- `source`: verified_booking / manual_with_consent / imported
- `consentAt`, `consentEvidenceNote` (manuel için zorunlu)
- `status`: pending / approved / rejected / hidden
- `moderatedById`, `moderatedAt`
- `featuredOnHome`, `publishedAt`
- `doctorReply` (opsiyonel)

**Yorum toplama:**
- Tamamlanmış görüşmeden 24 saat sonra hastaya, kendi dilinde, tek kullanımlık ve 30 gün geçerli tokenlı **"Deneyiminizi paylaşın"** e-postası gider (mevcut e-posta şablon sistemi).
- Aynı form hasta portalında, tamamlanmış randevunun altında da olsun.
- **Form:**
  - yıldız, başlık, metin (en az 30, en çok 1500 karakter)
  - görünen ad seçimi: baş harfler (varsayılan) / ad ve soyad baş harfi / anonim
  - **yayın onayı kutusu** (zorunlu)
  - uyarı: "Lütfen tanı, ilaç ya da başkasını tanıtan bilgi yazmayın"
- **Manuel ekleme** (admin): `consentEvidenceNote` zorunlu. Rozet "Verified patient" yerine gösterilmez; doğrulama yalnızca `verified_booking` kaynaklı yorumlara verilir.

**Moderasyon:**
- Her yorum `pending` başlar.
- Admin metni **düzenleyemez.** Yalnızca kişisel/sağlık bilgisi maskeleme (karartma) yapabilir; maskeleme kayıt altına alınır.
- Onaylar, reddeder ya da gizler. Her işlem audit log'a düşer.

**Görünüm:**
- **Anasayfa:** "What our patients say" karuseli. `featuredOnHome` yorumlar, ortalama puan ve yorum sayısı (yalnızca onaylı). Kayıt yoksa bölüm görünmez.
- **Hekim profili, Reviews sekmesi:**
  - ortalama, dağılım çubukları
  - liste: sayfalı, en yeni/en yüksek sıralama, dil filtresi
  - "Verified patient" rozeti
  - orijinal dil etiketi ve varsa yönetici çevirisi için "Show translation" anahtarı
- **Uydurma koruması:** Bir hekimde 3'ten az onaylı yorum varsa ortalama puan gösterilmez, yalnızca yorumlar listelenir.

**SEO:**
- `Review` / `AggregateRating` JSON-LD **eklenmez.** Google kendi hakkındaki yorum işaretlemesini desteklemiyor ve yanlış kullanım cezaya yol açabilir. Gerekçeyi rapora yaz.
- Yorum metinleri sayfada HTML olarak bulunur.

**Saklama ve silme:**
- Hasta yorumunun kaldırılmasını isterse admin "kaldır" işlemiyle yorum anonimleştirilir.
- Hasta portalında "Yorumumu sil" seçeneği olsun.

## İş 4: Diğer profil alanları

**`DoctorProcedure`:**
- `doctorId`
- `translations` (`title`, `description`, `duration`, `anesthesia`, `hospitalStay`, `recovery`)
- `relatedCareTopicIds[]` (W paketi)
- `sortOrder`, `isPublished`

**Profil FAQ:** `DoctorProfile` üzerinde yeni JSON kolon `faq` (`translations` içinde dil başına). JSON-LD `FAQPage` yalnızca içerik varsa eklenir.

Bu içerikler mevcut export/import akışına eklensin. Ardından 8 dil çevirisi aynı yöntemle yapılır.

## Testler
- Video: oynat'a basmadan iframe ve üçüncü taraf istek yok (`youtube-nocookie`).
- before-after: onaysız yayınlanamaz; `beforeAfterEnabled=false` iken hiç görünmez.
- Yorum:
  - token tek kullanımlık ve süreli
  - `pending` yorum görünmez
  - admin metni düzenleyemez, maskeleme log'a düşer
  - 3'ten az yorumda ortalama gizli
  - JSON-LD'de `Review`/`AggregateRating` yok
- Profil düzeni: boş bölümler gizli; founder ve görünen ad kuralı korunuyor.
- Sözlük eşitliği.
- RTL düzeni.
- Ekran görüntüleri (`docs/prompts/2026-10-30-Y-ekran/`).

## İnceleme
- `security-agent` (token, yükleme, iframe), `compliance-agent` (hasta onayı, sağlık verisi), `frontend-agent` ve `db-agent` incelesin.
- Kırmızı çizgi kontrolü boş olmalı. Migration SQL'i rapora konsun.

## Rapor
`docs/prompts/2026-10-30-Y-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- ekran görüntüleri
- hukuk kontrolü gereken noktalar (yorum yayını, önce/sonra, onay metinleri)
- testler
- canlıya alma sırası (export/çeviri/import dahil)
