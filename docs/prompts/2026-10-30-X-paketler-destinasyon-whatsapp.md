# Paket X: Sağlık paketleri yan paneli, "Top destinations", WhatsApp/koordinatör bağlantısı (2026-10-30)

**Hızlı Mod geçerli.** Testler sıralı koşar. **Bütün cevaplarını ve raporunu Türkçe yaz.**

## Başlangıç
- W paketinden sonra `origin/master` üzerinden `feat/packages-destinations-oct30` dalını aç. Push etme.

## KIRMIZI ÇİZGİ
- `consultation-room.tsx`, LiveKit, meeting-token, kayıt, egress
- Ödeme ve randevu oluşturma kuralları. **Paketler satın alınmaz, sepete eklenmez.** Yalnızca "planlama talebi" toplanır.
- docker-compose, Dockerfile'lar, Nginx, `.env`, `docs/legal/`
- Yeni npm paketi yok.
- Migration yalnızca ekleme yapar.
- **Uydurma veri yok.** Fiyat, hasta sayısı, puan ya da "geçen yıl en çok gidilen" gibi her rakam yönetici tarafından girilir. Seed yalnızca boş/taslak kayıt içerir.

---

## İş 1: WhatsApp ve koordinatör kanalı (ortak altyapı)

- **Site ayarları:**
  - `whatsappNumber` (E.164)
  - `whatsappEnabled`
  - `coordinatorEmail`
  - dil başına hazır mesaj şablonu, örnek: "Hello, I'm interested in {package}."
- **Ortak `ContactCta` bileşeni,** üç seçenekli:
  - **WhatsApp:** `https://wa.me/<numara>?text=<şablon>`, yeni sekmede açılır.
  - **Canlı destek:** mevcut SupportChat, bağlam bilgisiyle açılır.
  - **"Sizi arayalım" formu**
- **WhatsApp tıklaması:**
  - CRM onayı varsa mevcut "aday talep" (`candidate=true`) mekanizmasıyla kaydedilir.
  - Onay yoksa hiçbir şey kaydedilmez, yalnızca link açılır.
  - Hazır mesajda kişisel ya da sağlık verisi bulunmaz; yalnızca paket ya da sayfa adı.
- **Mobil:** Sağ altta yüzen WhatsApp düğmesi (`whatsappEnabled` ise). Canlı destek balonuyla çakışmayacak şekilde ikisi tek bir "Contact" düğmesi altında birleşsin.
- V paketindeki "Kendi dilinizde destek" bandının "Talk to us" düğmesi bu bileşene bağlansın.

## İş 2: Sağlık paketleri

**Veri modeli, `HealthPackage`:**
- `slug`
- `category`: check-up, aesthetic (filler/botox), wellness (masaj/spa), longevity, dental, women, men, other
- `coverMediaId`
- `translations`: `{ [dil]: { title, summary, includes[], notIncluded[], duration, idealFor, faq[] } }`
- `priceFrom` (Decimal, opsiyonel), `currency`, `showPrice` (varsayılan **false**)
- `relatedSpecialtyIds[]`, `relatedDoctorIds[]`
- `isActive`, `isFeatured`, `sortOrder`

`CrmLeadChannel` enum'una `PACKAGE` değeri eklenir. `PackageInquiry`:
- `leadId`, `packageId`
- `preferredDates`, `travellers` (kişi sayısı)
- `note` (en çok 500 karakter)
- `consentContactAt`, `consentHealthAt` (not alanı sağlık bilgisi içerebileceği için)
- `anonymizedAt`

**Yan panel ("runner"):**
- **Masaüstü:**
  - Sağ kenarda dikey sekme: "Health Packages" ve küçük ikon.
  - Sayfa yüklendikten 3 saniye sonra panel yarı açık bir "peek" olarak görünür. Öne çıkan paket kartları dikey olarak yavaşça döner (otomatik kayan liste).
  - Üzerine gelince ve odaklanınca durur.
  - `prefers-reduced-motion` açıksa animasyon yoktur.
  - Kapatılabilir. Kapatma oturum boyunca hatırlanır (sessionStorage, try/catch).
- **Mobil:** Alt kenarda yatay kayan ince bir şerit ("Check-up · Longevity · Aesthetic …"). Dokununca alt sayfa (bottom sheet) açılır, kategori sekmeleri ve kartlarla.
- **Görünmeyeceği yerler:**
  - ödeme ve checkout sayfaları
  - görüşme odası
  - hasta portalı
  - randevu sihirbazının adımları
  - admin ve doktor paneli
- Sayfa içeriğini kapatmamalı, CLS üretmemeli, Lighthouse erişilebilirlik puanını düşürmemeli.
- **Kart tıklaması:** Paket ayrıntı sheet'i açılır. İçinde:
  - özet, "Neler dahil"
  - süre
  - fiyat: yalnızca `showPrice=true` ise, "Starting from €X" ve "Final price is confirmed after medical evaluation" notuyla
  - ilgili hekimler
  - **"Plan my package"** formu: ad soyad, e-posta/telefon, ülke, tercih edilen tarih aralığı, kişi sayısı, not, iki onay kutusu (W'deki gibi)
  - `ContactCta` (WhatsApp / canlı destek)
- **Sayfalar:**
  - `/[lang]/packages`: kategori filtreli ızgara
  - `/[lang]/packages/[slug]`: SEO için tam sayfa; JSON-LD `MedicalProcedure` ya da `Offer`, yalnızca `showPrice` ise fiyatla
  - Sitemap ve hreflang, `llms.txt` satırı
- **Admin:**
  - Paket CRUD: dil sekmeleri, sıralama, öne çıkarma, önizleme
  - Talepler CRM'de "Package" kanalı olarak görünür
  - Koordinatöre `package.new_inquiry` e-postası (içinde not metni yok, yalnızca bağlantı)
- **Seed:** `seed-health-packages.ts`, kuru çalışma ve `--confirm` ile. **8 taslak paket**, `isActive=false`:
  - Executive Check-up
  - Women's Check-up
  - Cardiac Check-up
  - Longevity Assessment
  - Dermal Filler & Botox
  - Therapeutic Massage
  - Dental Check & Cleaning
  - Cancer Screening

  Seed'de yalnızca EN metin olsun, fiyat olmasın. Yönetici içeriği kontrol edip aktifleştirecek.

## İş 3: "Top destinations"

- **Bölüm başlığı:** "Top destinations — Where WM Health patients travelled most in the past year, with typical starting prices."
- **Veri modeli, `DestinationHighlight`:**
  - `slug`, `city`
  - `coverMediaId`
  - `translations` (başlık, kısa metin, öne çıkan tedaviler)
  - `topTreatments[]`: `{ label, priceFrom, currency }`
  - `patientCountLastYear` (opsiyonel, Int)
  - `dataPeriodLabel` (örn. "Nov 2025 – Oct 2026")
  - `showPrices`, `isActive`, `sortOrder`
- **Görünüm:** Anasayfada kart ızgarası. Kartta:
  - şehir görseli
  - "X patients" (yalnızca alan doluysa)
  - 3 tedavi ve "from €…"
  - "Explore" → ilgili paketler, uzmanlıklar ve eşleştirme sihirbazı
- **Doğruluk kuralları:**
  - Hiç aktif kayıt yoksa bölüm **görünmez.**
  - Hasta sayısı boşsa gösterilmez.
  - `dataPeriodLabel` doluysa başlığın altında görünür.
  - "Prices are indicative starting prices; final price after medical evaluation" notu fiyat varsa her zaman görünür.
- **Admin:** CRUD. Seed yok.

## İş 4: Ödeme fazıyla ilişki
- Bu paketteki fiyatlar **yalnızca bilgi amaçlıdır.** Checkout, sepet ve Stripe'a bağlanmaz.
- `showPrice` ve `showPrices` varsayılan olarak kapalıdır. Faz 3 fiyatlandırma kararı verilince açılacak.

## Testler
- Yan panel:
  - hariç tutulan sayfalarda görünmez
  - reduced-motion'da animasyon yok
  - kapatma hatırlanır
  - klavye ile gezinme
- Fiyat gizleme ve gösterme (`showPrice`).
- Destinasyon: kayıt yokken bölüm yok; hasta sayısı boşken gizli.
- WhatsApp bağlantısı:
  - doğru numara ve dilde şablon
  - mesajda kişisel veri yok
  - onay yokken kayıt yok
- Paket talebi:
  - rıza kuralları
  - hız sınırı
  - e-postada not metni yok
- Sözlük eşitliği.
- 360 ve 1440 px ekran görüntüleri (`docs/prompts/2026-10-30-X-ekran/`).

## İnceleme
- `security-agent`, `compliance-agent` ve `frontend-agent` (performans: yan panel bundle'ı lazy yüklenmeli) incelesin.
- Kırmızı çizgi kontrolü boş olmalı. Migration SQL'i rapora konsun.

## Rapor
`docs/prompts/2026-10-30-X-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- ekran görüntüleri
- hukuk kontrolü gereken metinler (fiyat notu, onay cümleleri, paket açıklamalarındaki iddialar)
- testler
- canlıya alma sırası
