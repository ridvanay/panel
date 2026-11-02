# Paket AH (ACİL): Sağlık turizmi aracı kuruluş dönüşümü (2026-11-02)

**Bütün cevaplarını ve raporunu Türkçe yaz.** Testler sıralı koşar. Push etme. E2E headless (`E2E_HEADLESS=1`).

## Öncelik ve sıra
- **Bu paket her şeyin önünde.** Blog parti 8–10 ve AG İş 3 (harici toplantı) bekler.
  - Yarım kalan blog işini kendi dalında commit'le (push yok) ve bırak.
- Ana klasörde çalış, yeni worktree açma. `git fetch`, ardından güncel `origin/master` üzerinden `feat/ah-intermediary-nov02` dalını aç.
- **Faz 1'i bitirince dur ve raporla.** Faz 1 bugün canlıya alınacak. Faz 2, onaydan sonra.

## Kullanıcı kararları (bağlayıcı)
1. **WM Health bir sağlık kuruluşu değil; uluslararası sağlık turizmi aracı kuruluşudur.** Tedaviler, Uluslararası Sağlık Turizmi Yetki Belgesi'ne sahip sağlık kuruluşlarında yapılır.
2. **Sitede hiçbir doktor görünmez.** Doktorlar admin'de pasife alındı. Kayıtlar silinmez; yalnızca ziyaretçiye gösterilmez.
3. **Randevu, bölüm bazlı bir "talep formu" ile alınır.** Ödeme yok. Hasta koordinatörü dönüş yapar.
4. **Türkçe kaldırılır:** dil seçeneği, `/tr` adresleri ve sitedeki ve müşteriye giden e-postalardaki bütün Türkçe metinler. Diğer 8 dil (EN, DE, AR, RU, FR, ES, RO, SR-Latn) kalır. Admin paneli iç araç olduğu için Türkçe kalabilir.
5. **Blog kalır,** ama doktor adları ve "Medically reviewed by" ifadeleri kaldırılır. Yeni yazı şimdilik durur.
6. **Yetki belgesi numarası** admin ayarından girilir ve sitede gösterilir. Numarayı kullanıcı verecek; şimdilik alan boş kalır.

## Kırmızı çizgi
- Veri silinmez: doktor, randevu, ödeme, yorum ve blog kayıtları kalır.
- Migration yalnızca ekleme yapar.
- Yeni npm paketi yok.
- compose, Dockerfile'lar, Nginx, `.env` ve LiveKit sunucu ayarları değişmez. Nginx'e dokunmadan yönlendirmeler Next tarafında yapılır.
- `docs/legal/` **metinleri** değişmez. Yalnızca TR sürümlerinin ziyaretçiden gizlenmesi ve EN sürümlerine yönlendirme yapılır. Hukuk kontrol listesine not düşülür.
- Görüşme odası ve tercüman altyapısı silinmez. Yalnızca ziyaretçi akışından erişim kalkar; admin tarafı çalışmaya devam eder.

---

# FAZ 1 (bugün canlıya alınacak)

## 1. Kurumsal kimlik ibaresi (sitenin her yerinde, profesyonel biçimde)
**EN ana metin** (diğer 7 dile çevrilir):
- **Kısa ibare:** "International Health Tourism Intermediary"
- **Açıklama:** "WM Health is an international health tourism intermediary organization, not a healthcare provider. All medical treatments are performed by healthcare facilities holding an International Health Tourism Authorization Certificate issued by the Republic of Türkiye Ministry of Health."
- **Belge satırı** (yalnızca numara girildiyse): "Health Tourism Authorization Certificate No: {no}"

**Nerede görünecek:**
- **Üst bilgi şeridi (top bar):** kısa ibare ve "Treatments by authorized healthcare facilities" bağlantısı. Bağlantı Hakkımızda'daki ilgili bölüme gider.
- **Footer:** logonun altında kısa ibare, açıklama ve belge satırı. Mevcut footer'da Türkçe kalan bütün metinler ("Tüm hakları saklıdır", "Branşlar", "Yasal", "Evinizden Uzman…") EN'ye ve çevirilerine çevrilir.
- **Hakkımızda:** "Who we are" bölümü (aracı kuruluş tanımı) ve "Our role / What we do not do" bölümü (tanı ve tedavi yapmıyoruz; tıbbi kararları sağlık kuruluşundaki hekim verir).
- **Hizmet ve bölüm sayfaları, talep formu, VIP sayfası, paket sayfaları ve blog yazılarının altı:** açıklama metni, sade bir bilgi kutusu içinde.
- **Kurumsal e-posta şablonunun footer'ı:** kısa ibare ve açıklama.
- **SEO ve JSON-LD:**
  - Kurum tipi `MedicalOrganization`, `MedicalClinic` ya da `Physician` olarak verilmez; `Organization` (veya uygunsa `TravelAgency`) kullanılır.
  - `Physician`, `reviewedBy` ve doktor şemaları kaldırılır.
  - Site açıklaması (meta description) aracı kuruluş vurgusuyla güncellenir.
- **Admin ayarı:** Ayarlar'a "Health Tourism Authorization Certificate No" alanı eklenir (yalnızca ekleme yapan migration). Alan boşsa belge satırı gösterilmez.

## 2. Menü
**Header:** Home · About · Health Tourism Services · VIP Accommodation & Transfer · Contact
- **"Health Tourism Services":** açılır menü. Aktif üst bölümler listelenir (alt bölümler, AG'deki gibi Gastroenterology altında). Menünün altında "All services" bağlantısı olur.
- Sağdaki düğmeler:
  - "Find my physician" kalkar; yerine **"Request a consultation"** gelir ve talep formuna gider.
  - "Appointment" düğmesi de talep formuna gider.
- "Health Guides" header'dan çıkar, footer'da kalır.
- Menü admin'deki Navigasyon'dan geliyorsa idempotent bir script yaz (kuru, yedek, `--restore`). Önceki `add-blog-nav-item` desenini kullan. Script'i rapora koy.

## 3. Doktorların ziyaretçi tarafından kaldırılması
Şu yerlerde hiçbir doktor adı, fotoğrafı, unvanı ya da sayısı görünmez:
- ana sayfa blokları (öne çıkan doktorlar, ekip)
- Hakkımızda
- bölüm sayfaları
- arama
- blog
- yorumlar (testimonials; doktor adı geçen alanlar)
- sihirbaz sonuçları
- JSON-LD
- sitemap
- llms.txt

Eşlik eden değişiklikler:
- **Hekim adresleri** (`/physicians`, `/physicians/{slug}` ve eşdeğerleri): 301 ile **Health Tourism Services** sayfasına, varsa ilgili bölüme yönlendirilir. Sitemap'ten çıkar.
- **Hekim eşleştirme sihirbazı (W):** Sonuç ekranı doktor yerine **bölüm** önerir. "Request a consultation for {bölüm}" düğmesi bölümü dolu hâlde talep formunu açar.
- **Blog:**
  - "Medically reviewed by", "Review pending" ve hekim kutuları, "Consult a physician" kartları ve hekim fotoğrafları kaldırılır.
  - Yazar "WM Health Editorial Team" olur.
  - Yazı sonuna "Talk to a patient coordinator" kartı eklenir (talep formuna gider).
  - `/medical-reviewers` adresi 301 ile `/content-standards` sayfasına gider.
  - Content standards metni düzeltilir: içerik editör ekibince güvenilir halk sağlığı kaynaklarına dayanarak hazırlanır, tıbbi tavsiye değildir, tanı ve tedavi kararını yetkili sağlık kuruluşundaki hekim verir. "Physician review" vaadi kaldırılır.
  - Blog açıklaması ve güven satırı buna göre değişir.
  - Hekim onay kuralı (Z1) ziyaretçi tarafında görünmez. Admin'de yayın kuralı: editoryal yayın (adminin yayınlaması) yeterli olur; tıbbi onay şartı **bayrakla kapatılır, kod silinmez.** Mevcut 10 yayındaki yazı yayında kalır.
- **Arayüz metinleri:** Sitedeki "our doctors", "physician" vb. ifadeler, aracı kuruluşa uygun dile çevrilir ("partner healthcare facilities", "specialists at authorized facilities").

## 4. Bölüm bazlı talep formu (randevu yerine)
- **Adres:** `/{lang}/request` (ve bölümden gelince `?service={slug}`).
- **Form alanları:**
  - Hizmet/bölüm (zorunlu; aktif bölümler, alt bölümler gruplu)
  - Tercih edilen tarih aralığı
  - Ülke
  - İletişim dili (8 dil)
  - Tercüman ihtiyacı (evet/hayır)
  - Ad soyad
  - E-posta
  - Telefon/WhatsApp (isteğe bağlı)
  - Kısa mesaj (isteğe bağlı; "Do not share detailed medical information here; our coordinator will guide you securely." uyarısıyla)
- **KVKK/GDPR:**
  - Aydınlatma metnine bağlantı.
  - İletişim için açık rıza onay kutusu.
  - Sağlık verisi zorunlu değil. Mesajda sağlık verisi paylaşılırsa ayrı bir açık rıza onay kutusu gerekir (mevcut rıza altyapısını kullan).
- **Kayıt:** Mevcut talep/lead altyapısı varsa (W eşleştirme talebi, CRM lead) onu kullan; yoksa yalnızca ekleme yapan bir model kur. Talep "Talepler" ekranında, durum takibiyle görünür.
- **Bildirim:**
  - AG'deki admin bildirim altyapısıyla (idempotent, yeniden denemeli) alıcılara "New consultation request #{no} — {bölüm}" e-postası gider.
  - E-postada ad, iletişim bilgisi ve mesaj **yer almaz.** Yalnızca bölüm, ülke, dil, tercüman ve "Open request" bağlantısı olur.
- **Ziyaretçiye onay e-postası** (kendi dilinde, kurumsal şablon): "We received your request; a patient coordinator will contact you within 1 business day." ve aracı kuruluş açıklaması.
- **Spam koruması:** Mevcut oran sınırı ve honeypot desenleri kullanılır. Yeni paket yok.
- **Eski akışlar:**
  - Ziyaretçi tarafındaki bütün doktor randevu ve ödeme girişleri (slot seçimi, checkout, "Book" düğmeleri) talep formuna yönlenir. Ödeme sayfaları ziyaretçiye kapanır.
  - **Ödeme backend'i ve webhook'lar silinmez.**
  - Paket sayfalarındaki satın alma düğmeleri "Request this package" olur ve paket seçili hâlde talep formunu açar. Sepet ve ödeme ziyaretçiye kapanır.
  - Mevcut randevular ve hasta hesapları etkilenmez. "Hesabım" ekranında geçmiş randevular görünmeye devam eder.

## 5. Türkçenin kaldırılması
- `tr` dili ziyaretçiye kapatılır: dil seçicide yok; hreflang ve sitemap'te yok.
  - Mevcut locale yönetimi kullanılır: `enabled=false`, gerekirse idempotent script. Varsayılan dil `en` kalır.
- `/tr` ve `/tr/*` adresleri 301 ile EN karşılığına yönlenir. Yalnızca Türkçe slug'ı olan içerik varsa EN slug'ına yönlenir.
- **Kodda sabit Türkçe metin taraması:** Ziyaretçi tarafında ve müşteri e-postalarında kalan Türkçe metinler (footer, varsayılan metinler, hata mesajları, OG başlıkları) EN'ye ve çevirilerine taşınır. Bunu doğrulayan otomatik bir tarama testi ekle (ziyaretçi bileşenlerinde Türkçe karakter ve kelime taraması; admin hariç).
- **Yasal sayfalar:**
  - Ziyaretçi footer'ında yalnızca EN yasal sayfalar (PDPL Privacy Notice vb.) görünür.
  - TR yasal sayfaların adresleri EN karşılığına yönlenir.
  - Metinler değişmez; hukuk kontrol listesine "TR yasal metinler ziyaretçiden kaldırıldı, EN sürümleri yeterli mi?" maddesi eklenir.

## Faz 1 testleri
- Ziyaretçi sayfalarında doktor adı ve fotoğrafı yok: ana sayfa, Hakkımızda, bölüm sayfaları, blog listesi ve yazı sayfası, sitemap, JSON-LD.
- Hekim adresleri 301 ile yönleniyor; `/tr/*` adresleri 301 ile yönleniyor; dil seçicide TR yok.
- İbare görünüyor: üst şerit, footer, Hakkımızda, talep formu, blog yazısı, e-posta.
- Belge numarası boşken satır yok, doluyken görünüyor.
- **Talep formu:**
  - Doğrulama ve rıza kutuları çalışıyor.
  - Kayıt oluşuyor.
  - Admin bildiriminde kişisel veri yok.
  - Ziyaretçiye onay e-postası gidiyor.
  - Oran sınırı çalışıyor.
- Ziyaretçi tarafında ödeme ve checkout sayfaları kapalı; ödeme backend testleri hâlâ geçiyor.
- Türkçe metin taraması testi geçiyor.
- Menü 5 öğeden oluşuyor ve 8 dilde doğru.
- Kırmızı çizgi kontrolü boş.

## Faz 1 ekran görüntüleri
Kayıt yeri: `docs/prompts/2026-11-02-AH-ekran/`. Masaüstü 1440 ve mobil 390; EN ve AR.
- ana sayfa (üst şerit, menü, footer)
- Hakkımızda
- Health Tourism Services
- bir bölüm sayfası
- talep formu ve başarı ekranı
- blog yazısı
- içerik standartları
- e-postalar

---

# FAZ 2 (Faz 1 onaylanıp canlıya alındıktan sonra)
- **"VIP Accommodation & Transfer" sayfası:** VIP havalimanı karşılama ve transfer, konaklama (anlaşmalı oteller, tedavi kuruluşuna yakınlık), refakatçi desteği, tercüman, şehir içi ulaşım ve 7/24 hasta koordinatörü.
  - Fiyat yok. Her bölümde "Request" düğmesi olur.
  - 8 dil. Görseller admin'den yüklenebilir.
  - Faz 1'de menü bağlantısı bu sayfanın sade bir sürümüne gidebilir; Faz 2'de sayfa zenginleştirilir.
- **"Health Tourism Services" ana sayfası:** Bölüm kartları, süreç şeması (Request → Coordinator call → Facility & plan → Travel & stay → Treatment at authorized facility → Aftercare follow-up) ve SSS.
- **Talepler için admin iş akışı:** atama, durum, not, dışa aktarma.
- Doktor portalı ve `doktor.` alt alan adı: ne yapılacağına kullanıcı karar verecek (rapora seçenekleri yaz).

## Rapor
`docs/prompts/2026-11-02-AH-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- migration SQL
- script'lerin kuru çalışma çıktıları
- değişen ziyaretçi adresleri ve yönlendirme tablosu
- Türkçe metin taraması sonucu
- ekran görüntüleri
- testler
- **canlıya alma sırası:** migration, derleme, script'ler (locale, menü), ardından admin'de belge numarasının girilmesi
- hukuk kontrol listesine eklenen maddeler

**Faz 1 bitince dur ve onay bekle.**
