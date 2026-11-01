# Paket Z: Profesyonel blog (flymedi tarzı) ve 100 yazı × 9 dil (2026-10-30)

**Hızlı Mod geçerli.** Testler sıralı koşar. **Bütün cevaplarını ve raporunu Türkçe yaz.**

Paket üç aşamalıdır. **Her aşamanın sonunda dur, rapor yaz ve onay bekle:**
- **Z1:** Blog altyapısı ve tasarım (kod)
- **Z2:** 100 yazının EN metni (10'luk partiler hâlinde, taslak olarak)
- **Z3:** 8 dile çeviri (mevcut export/import akışı)

## Başlangıç
- **Güncelleme 2026-11-01:** V, W, W-ek, X, AE, AE-ek ve AF canlıda. Bu pakete şimdi başlanıyor.
- **Yeni worktree ya da klasör açma.** Ana proje klasöründe çalış. Şu an `feat/consultation-room-ux-nov01` dalındasın; o dal master'a alındı. `git fetch`, ardından güncel `origin/master` üzerinden `feat/blog-redesign-nov01` dalını aç. Push etme.
- Çalışma alanındaki commit'lenmemiş dosyalara (`.claude/…`, `design/`, eski prompt dosyaları) dokunma, commit'e ekleme. Bu prompt dosyasını ve raporlarını commit'e ekleyebilirsin.
- Mevcut `BlogPost`, `BlogCategory`, `BlogTag`, `ContentSlug`, admin blog modülü ve export/import yeniden kullanılsın. Yeni bir blog sistemi yazılmaz.
- **Kodlamaya başlamadan önce kontrol et ve rapora yaz:**
  - Varsayılan dil (`Locale.isDefault`) canlıda hangisi? Z2'deki EN metinler kanonik kolonlara mı, `translations.en` alanına mı yazılacak? Buna göre import script'ini tasarla.
  - Mevcut blog yazıları ve kategoriler (sayı, durum). Hiçbiri silinmez; yeni alanlar boş başlar.
  - Hekim sayısı: reviewer önerileri **mevcut aktif hekimler** arasından yapılır (sabit "12 hekim" varsayımı yok).
  - Kapak görselleri admin tarafından yüklenecek; AE-ek'teki otomatik WebP dönüştürme blog kapaklarına da uygulanıyor, bunu doğrula.
  - "Popular packages" bloğu: X paketindeki paketler şu an taslak/pasif; aktif paket yoksa blok gizli kalmalı.

## KIRMIZI ÇİZGİ
- `consultation-room.tsx`, LiveKit, meeting-token, kayıt, egress
- Ödeme ve randevu oluşturma kuralları
- docker-compose, Dockerfile'lar, Nginx, `.env`, `docs/legal/`
- Yeni npm paketi yok.
- Migration yalnızca ekleme yapar.
- **flymedi.com'dan metin, görsel ya da kod kopyalanmaz.** Yalnızca bilgi mimarisi örnek alınır.

---

## Z1: Altyapı ve tasarım

### Veri (yalnızca ekleme)
`BlogPost` modeline şu kolonlar eklenir:
- `specialtyId`
- `careTopicIds[]` (W paketi)
- `reviewerDoctorId`: tıbbi gözden geçiren hekim
- `medicalReviewStatus`: not_required / pending / approved
- `lastReviewedAt`
- `readingMinutes` (otomatik hesaplanır)
- `keyTakeaways` (JSON)
- `faq` (JSON)
- `references` (JSON: `{ title, publisher, url, accessedAt }[]`)
- `isFeatured`

Dil başına alanlar mevcut `translations` JSON'unda tutulur: `keyTakeaways`, `faq`, `title`, `excerpt`, `contentHtml`, `seoTitle`, `seoDescription`.

**Yayın kuralı (backend doğrulaması):**
- Bir yazının `status=PUBLISHED` olabilmesi için `medicalReviewStatus=approved` ve `reviewerDoctorId` dolu olmalı.
- Kategori "Health travel guide" gibi tıbbi olmayan bir konuysa `not_required` seçilebilir.

### Blog ana sayfası `/[lang]/blog`
- Breadcrumb, H1 "Health Guides" ve tek satırlık açıklama: "Patient guides written by our editorial team and reviewed by our physicians."
- Toplam yazı sayısı.
- **Konu filtresi:** uzmanlık bazlı ana gruplar ve sayıları; altında konu çipleri ve sayıları; "More topics" daraltması. URL'ye yansır (`?topic=`) ve SEO uyumludur.
- Arama kutusu (başlık ve özet içinde, sunucu tarafında).
- **"Latest" öne çıkan blok:** büyük kapak, kategori, başlık, özet, hekim onayı satırı ("✓ Reviewed by Prof. Dr. H. Sofu", görünen ad kuralıyla), tarih, okuma süresi, "Read the article".
- **Kart ızgarası:** kapak, kategori etiketi, başlık, özet, onaylayan hekim ✓, tarih, okuma süresi.
- Sayfalama: `/[lang]/blog/page/2` ve `rel=prev/next` gerekmez, ama sayfa başına canonical doğru olmalı.
- **Ara CTA blokları:**
  - "Not sure which physician you need? → Find my physician" (W sihirbazı)
  - "Popular packages" (X paketi; aktif paket yoksa gizli)
- **Editoryal güven satırı:** "Content standards" · "Authors & medical reviewers" bağlantıları. Bu iki sayfa CMS `Page` olarak oluşturulsun. Taslak metni EN olarak yaz ve hukuk/editör kontrolü listesine koy.

### Yazı sayfası `/[lang]/blog/[slug]`
Sayfada sırasıyla:
- breadcrumb
- kategori
- H1
- yazar (kurum: "WM Health Editorial Team") ve **tıbbi gözden geçiren hekim** (fotoğraf, ad, unvan, profil bağlantısı)
- "Last reviewed: tarih"
- okuma süresi
- **İçindekiler:** masaüstünde yapışkan yan sütun, mobilde açılır kutu. H2/H3'lerden otomatik üretilir, kaydırmada aktif başlık vurgulanır.
- "Key takeaways" kutusu
- içerik (tipografi: max ~70 karakter satır, okunaklı aralıklar, tablolar, alıntı, bilgi kutuları)
- yazının ortasında ve sonunda "Consult a physician" kartı: ilgili uzmanlığın 2 hekimi ve "Book" düğmesi
- FAQ akordeonu
- "References" listesi
- **sabit uyarı:** "This article is for general information and is not a substitute for a medical consultation."
- ilgili yazılar (3), paylaşım düğmeleri (bağlantı kopyala, WhatsApp, e-posta; üçüncü taraf script yok)

**SEO:**
- JSON-LD `MedicalWebPage` + `Article`: `reviewedBy` (Physician), `lastReviewed`, `author` (Organization), `about` (`MedicalSpecialty`).
- FAQ varsa `FAQPage`.
- hreflang (çevirisi olan dillerde), sitemap (`lastmod` = `lastReviewedAt`), `llms.txt` blog bölümü.
- Taslak ve çevirisi olmayan dil URL'leri yayına çıkmaz.

### Admin
Blog editöründe şu alanlar eklensin:
- uzmanlık, care topic
- reviewer seçimi, inceleme durumu
- key takeaways, FAQ ve references düzenleyicileri
- okuma süresi önizlemesi

**"Medical review" kuyruğu:**
- Reviewer hekim kendi doktor panelinde atanan yazıları görür.
- "Approve" ya da "Request changes" (not ile) seçer. Onay tarih ve kullanıcıyla audit log'a düşer.
- Doktor paneli değişikliği yalnızca bu listeyle sınırlı kalır.

### Testler (Z1)
- Yayın kuralı: onaysız yayınlanamaz.
- TOC üretimi.
- JSON-LD alanları.
- Filtre sayıları.
- Sayfalama canonical'ı.
- Taslak URL 404.
- RTL.
- Ekran görüntüleri (`docs/prompts/2026-10-30-Z-ekran/`).
- Kırmızı çizgi kontrolü boş olmalı.

**Z1 sonunda dur ve raporla.**

---

## Z2: 100 yazı (EN, taslak)

### Konu planı
- Önce `docs/prompts/2026-10-30-Z-konu-plani.md` dosyasını yaz ve **onaya sun.** Yazmaya onaydan sonra başla.
- Plan **100 başlıktan** oluşur. Her başlık için: hedef arama niyeti, uzmanlık, care topic, önerilen reviewer hekim (uzmanlığa göre mevcut 12 hekimden).
- **Dağılım:**
  - mevcut uzmanlıklar ve V paketinin 2 yeni uzmanlığı
  - X paketinin konuları (check-up, longevity, estetik, dental)
  - "Health travel to Istanbul" rehberleri (vize, konaklama, tedavi sonrası seyahat, online ön görüşme nasıl yapılır, hangi belgeler gerekir) — en çok 15 yazı

### Yazım kuralları (her yazı)
- **Uzunluk:** 1.200–1.800 kelime. H2/H3 yapısı, 4–6 key takeaway, 5–8 FAQ.
- **Dil:** Hastaya yönelik, sade, sakin, profesyonel. Korkutucu dil yok.
- **Yasak içerik:**
  - **Fiyat, başarı oranı, garanti**
  - "en iyi doktor/klinik" gibi üstünlük iddiaları
  - önce/sonra iddiası
  - ilaç dozu
- **Kaynak:**
  - Tıbbi iddialar yalnızca otoriter kaynaklara dayanır: WHO, NHS, NIH/MedlinePlus, CDC, ilgili uzmanlık derneklerinin kılavuzları, T.C. Sağlık Bakanlığı.
  - `references` alanına yalnızca **erişip doğruladığın** bağlantıları koy. Doğrulayamadığın bağlantıyı ekleme, yazıyı "kaynak eksik" olarak işaretle.
- **Bağlantılar:**
  - Her yazının sonunda ilgili uzmanlık sayfasına, W sihirbazına ve uygun bir pakete iç bağlantı.
  - Hekimler adlarıyla övülmez, yalnızca "Consult a physician" kartında listelenir.
- **Kopya yok:** Başka sitelerden metin alınmaz. Benzerlik kontrolü için her partide yazılar arası tekrar oranını raporla.
- **Görsel:** Kapak görseli üretilmez ve indirilmez. `coverImageUrl` boş kalır, yönetici ekleyecek. Şablon kapak olarak uzmanlık ikonlu nötr bir görünüm kullanılsın (Z1'de tasarlanır).

### Teslim
- Yazılar `imports/blog/batch-XX.json` (gitignore) dosyalarına, **10'luk partiler** hâlinde.
- `backend/scripts/import-blog-posts.ts`:
  - kuru çalışma varsayılan, `--confirm=import-blog --operator=...`
  - idempotent: slug ile
  - hepsi `status=DRAFT`, `medicalReviewStatus=pending`
  - yedek ve `--restore`
- Her partiden sonra kısa rapor yaz: başlıklar, kelime sayıları, kaynak sayıları, "kaynak eksik" listesi. **Sonra devam et.** Her 30 yazıda bir dur ve onay iste.

---

## Z3: Çeviri (8 dil)
- Mevcut export/import akışına `blogPost` türü dahilse kullan, değilse ekle. Alanlar: `title`, `excerpt`, `contentHtml`, `keyTakeaways`, `faq`, `seoTitle`, `seoDescription`.
- **Sıra önemli:** Çeviri, yalnızca **hekim onayı almış (approved)** yazılar için yapılır. Böylece onay sonrası yapılan düzeltmeler 8 dilde tekrar çevrilmek zorunda kalmaz.
- Paket L/T çeviri kalite kuralları geçerli. Tıbbi terimlerde anlam kayması olmamalı. Sırpça Latin alfabesiyle yazılır. Arapça RTL düzende kontrol edilir.
- Dil başına slug: `ContentSlug`, Latin harfle transliterasyon. Arapça ve Rusça slug'lar da Latin harfle yazılır.

---

## Rapor
Her aşama için ayrı rapor yazılır: `docs/prompts/2026-10-30-Z1-RAPOR.md`, `Z2-RAPOR.md`, `Z3-RAPOR.md`. Her raporda:
- commit listesi
- ekran görüntüleri
- konu planı
- parti raporları
- "kaynak eksik" listesi
- testler
- canlıya alma ve içe aktarma komutları (G/L/T yöntemiyle)
