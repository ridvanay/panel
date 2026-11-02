# Paket AI: Hizmet menüsü, hizmet bazlı randevu, "Find your treatment" (2026-11-02)

**Bütün cevaplarını ve raporunu Türkçe yaz.** Testler sıralı koşar. Push etme. E2E headless (`E2E_HEADLESS=1`).

## Başlangıç
- AH Faz 1 canlıda (`2bf4698`). Ana klasörde çalış, yeni worktree açma. `git fetch`, ardından `origin/master` üzerinden `feat/ai-services-booking-nov02` dalını aç.
- AH kuralları geçerli:
  - Sitede doktor yok.
  - Türkçe ziyaretçiye kapalı.
  - Aracı kuruluş ibaresi her yerde.
  - "Tedaviler yetki belgeli sağlık kuruluşlarında yapılır."
- Kırmızı çizgi:
  - Veri silinmez.
  - Migration yalnızca ekleme yapar.
  - Yeni npm paketi yok.
  - compose, Dockerfile'lar, Nginx, `.env`, LiveKit sunucu ayarları ve `docs/legal/` değişmez.
  - `consultation-room.tsx` ve mevcut görüşme token kuralları **değişmez** (iş 3'teki istisna hariç, o da önce tasarım).
- **Sıra:** İş 1 ve İş 2 kodlanır. İş 3 için önce tasarım raporu yazılır. Hepsi bitince dur ve raporla.

---

## İş 1: "Health Tourism Services" açılır menüsünün profesyonelleştirilmesi
Canlıdaki sorunlar (kullanıcı ekran görüntüsü):
- Öğeler arasında çok büyük boşluklar var; menü ekranın altına taşıyor.
- Hizalama dengesiz; "Procedures: ERCP · POEM · ESD" satırı sarkıyor.
- İkonlar birbirine benziyor.
- Bazı adlar hizmet değil, meslek unvanı: "Orthodontist", "Interventional Radiology Specialist".

**Hedef: kompakt, kurumsal bir mega menü** (masaüstü):
- **Sol bölüm, 2–3 kolonlu gruplu liste.** Gruplar admin'de uzmanlık kaydına eklenen bir "grup" alanından gelir (yalnızca ekleme yapan migration; boşsa "Other"). Varsayılan gruplama:
  - **Surgery & Oncology:** Obesity & Metabolic Surgery, Surgical Oncology, Thoracic Surgery, Neurosurgery
  - **Digestive & Interventional:** Gastroenterology (alt satırda küçük çipler: ERCP · ESD · POEM), Interventional Radiology
  - **Aesthetic, Dental & Hair:** Plastic & Aesthetic Surgery, Dental Care, Orthodontics, Hair Transplantation
  - **Fertility:** IVF & Reproductive Health
- **Her öğe:** küçük ikon (24 px, bölüme özel ve ayırt edilebilir), hizmet adı ve tek satırlık kısa açıklama (admin'den düzenlenebilir, 8 dil). Satır yüksekliği küçük, 8 px'lik ızgara düzeni.
- **Sağ bölüm, vurgulu bir panel:**
  - "Not sure which treatment you need?" ve **"Find your treatment"** düğmesi (iş 2).
  - Altında "Book an online consultation" (iş 3) ve hasta koordinatörü iletişimi (WhatsApp/telefon, site ayarlarından).
- **Alt şerit:** "View all services →" ve kısa aracı kuruluş ibaresi ("Treatments at authorized healthcare facilities").
- Menü yüksekliği masaüstünde 520 px'i geçmez. Klavye ile gezilebilir (ok tuşları, Esc), ARIA doğru, RTL düzgün.
- **Mobil:** gruplu akordeon; sağ paneldeki iki düğme en üstte.
- **Hizmet adları:** Ziyaretçiye görünen adlar hizmet adı olmalı. "Orthodontist" yerine "Orthodontics", "Interventional Radiology Specialist" yerine "Interventional Radiology".
  - Slug'lar ve URL'ler **değişmez.**
  - Adları ve 8 dil çevirilerini güncelleyen idempotent bir script yaz: `backend/scripts/rename-service-labels.ts` (kuru çalışma varsayılan, yedek alır, `--restore`, `--i-know-this-is-prod`). Admin'den de düzenlenebilir.
- **"Health Tourism Services" sayfası** (`/specialties`): Aynı gruplu yapı. Her grupta kartlar ve kartlarda kısa açıklama ile "Book" ve "Request" bağlantıları olur. Üstte süreç şeridi: Request/Book → Coordinator call → Authorized facility & plan → Travel & stay → Treatment → Aftercare.

## İş 2: "Find my physician" yerine "Find your treatment"
Mevcut eşleştirme sihirbazı (W) yeniden adlandırılıp konumlandırılır. Mantık, AH'de olduğu gibi bölüm önerir.
- **Düğme ve menü etiketi:** **"Find your treatment"**
- **Sayfa başlığı:** "Which treatment is right for me?"
- **Alt başlık:** "Answer a few questions about your concern and we'll suggest the right health tourism service."
- **Akış:**
  1. Bölge seçimi.
  2. Şikâyet/konu seçimi (mevcut bakım konuları).
  3. Kimin için.
  4. Sonuç: önerilen 1–3 hizmet. Her biri için "Book an online consultation" (iş 3) ve "Request a consultation" düğmeleri.
- **Zorunlu uyarı** (sonuç ekranında ve başlangıçta, 8 dil): "This tool does not provide a diagnosis or medical advice. Medical assessment and treatment decisions are made by physicians at authorized healthcare facilities." Kırmızı bayrak konularda mevcut acil yönlendirme aynen kalır.
- **Adres:** Yeni adres `/find-your-treatment`. Eski sihirbaz adresleri 301 ile yeni adrese gider.
- **Header:**
  - "Request a consultation" düğmesi yerine **"Find your treatment"** (ikincil stil).
  - "Appointment" düğmesi **"Book a consultation"** olur ve iş 3'e gider. İş 3 canlıya çıkana kadar talep formuna gider.

## İş 3: Hizmet bazlı randevu sistemi (ÖNCE TASARIM RAPORU, KOD YOK)
Kullanıcı isteği: Eski randevu sistemi geri gelsin, ama **doktora değil, sağlık turizmi hizmetine** randevu alınsın.

**Önerilen model:** Seçilen hizmet için **ücretsiz online ön görüşme.** Görüşme, WM Health hasta koordinatörüyle yapılır (doktorla değil). Amaç hastanın ihtiyacını anlamak, yetkili sağlık kuruluşunu ve seyahati planlamaktır.
- **Takvim:** Mevcut slot, randevu ve takvim altyapısı yeniden kullanılır. Randevu sahibi "hizmet masası" olur.
  - Admin, her hizmet (veya hizmet grubu) için çalışma saatleri ve görüşme süresi tanımlar.
  - Görüşmeyi yapacak koordinatörler (personel kullanıcıları) hizmet masasına atanır.
  - Hasta saati seçer; boş olan koordinatöre otomatik atanır.
- **Rezervasyon:**
  - Hizmet, saat ve hasta bilgisi (mevcut hasta hesabı veya misafir akışı); talep formundaki rıza kutuları; tercüman ihtiyacı.
  - Ödeme yok. Ücretli seçenek ileride bir ayarla açılabilecek şekilde tasarlansın, şimdilik kapalı.
- **Görüşme:**
  - Mevcut video görüşme altyapısı (AF arayüzü) kullanılır. Görüşmenin bir tarafı **koordinatör** olur.
  - Ad etiketlerinde "Patient Coordinator" ve koordinatörün adı yer alır; doktor unvanı yok.
  - Kayıt yok.
  - E-posta ve hatırlatmalar mevcut şablonlarla, aracı kuruluş ibaresiyle gider. Admin bildirimi AG'deki altyapıyla gider (kişisel veri yok).
- **Görünüm:** Hizmet sayfaları, mega menü, "Find your treatment" sonuçları ve paket sayfalarında "Book an online consultation" düğmesi.

**Tasarım raporu** (`docs/prompts/2026-11-02-AI-IS3-TASARIM.md`) şunları içerir:
- mevcut doktor bazlı randevu ve görüşme altyapısının hangi parçalarının yeniden kullanılacağı
- veri modeli (yalnızca ekleme)
- koordinatör rolü ve yetkileri
- slot üretimi
- misafir ya da hesaplı rezervasyon akışı
- görüşme token'ı (mevcut kuralların nasıl korunacağı; `consultation-room.tsx` değişmeden mi, yoksa sınırlı istisna gerekip gerekmediği ve nedeni)
- KVKK/GDPR (sağlık verisi, rıza)
- e-postalar
- admin ekranları
- test listesi
- tahmini iş büyüklüğü
- açık sorular

---

## Testler (iş 1–2)
- **Mega menü:**
  - gruplar ve hizmet sırası
  - alt hizmet çipleri
  - klavye ile gezinme ve Esc
  - RTL
  - mobil akordeon
  - yüksekliğin 520 px'i geçmemesi (görsel test)
  - doktor adı ya da "Specialist" kelimesinin görünmemesi
- **Ad script'i:** kuru çalışma, gerçek çalışma ve geri yükleme; slug'ların değişmediği.
- **"Find your treatment":**
  - eski adreslerin 301 ile yönlenmesi
  - uyarı metninin 8 dilde görünmesi
  - sonuçta hizmet ve iki düğme olması
  - kırmızı bayrakta acil yönlendirme
- Header düğmeleri.
- Türkçe metin tarama testi geçmeli.
- Kırmızı çizgi kontrolü boş olmalı.

## Ekran görüntüleri
Kayıt yeri `docs/prompts/2026-11-02-AI-ekran/`. Masaüstü 1440 ve mobil 390; EN ve AR.
- mega menü (açık)
- Health Tourism Services sayfası
- Find your treatment: başlangıç, sonuç ve kırmızı bayrak ekranları

## Rapor
`docs/prompts/2026-11-02-AI-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- migration SQL
- script kuru çalışma çıktısı
- yönlendirme tablosu
- ekran görüntüleri
- testler
- canlıya alma sırası

İş 3 için yalnızca tasarım raporu yazılır. **Bitince dur ve onay bekle.**
