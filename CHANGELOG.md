# Changelog

Bu proje [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) formatını ve
[Conventional Commits](https://www.conventionalcommits.org)'i takip eder. Sürüm numaraları
henüz etiketlenmemiştir (`0.1.0`, henüz ilk stabil sürüm öncesi); değişiklikler tarih
bazlı olarak `Unreleased` altında gruplanır.

Kaynak doğruluk: kontrat değişiklikleri için `docs/architecture/openapi.yaml` +
`docs/architecture/shared-types.ts`; mimari kararlar için `docs/architecture/ARCHITECTURE.md`.
Bu dosya onların **özetidir**, ikinci bir doğruluk kaynağı değildir.

## [Unreleased]

### Added

- **`feat(site)`: İletişim sayfası (`/contact`) yeniden tasarlandı.** Breadcrumb, "Contact" etiketi,
  Hakkımızda ile aynı serif başlık; masaüstünde form (7/12) + bilgi kartları (5/12): iletişim
  bilgileri (telefon, WhatsApp, e-posta, adres — tıklanabilir), çalışma saatleri, TeleHealth acil
  durum uyarısının özet metni ve harita (statik görsel + "Google Haritalar'da aç"; iframe ve üçüncü
  taraf çerezi YOK). Mobilde tek kolon, başlığın altında Ara/WhatsApp düğmeleri. Form: ad soyad,
  e-posta, ülke kodlu telefon, ülke (tam liste), ilgilenilen tedavi (Uzmanlıklar modülünden +
  "Henüz emin değilim", isteğe bağlı), tercih edilen iletişim yolu, mesaj, aydınlatma metni onayı.
  Tedavi seçilirse ayrı, varsayılan işaretsiz ve zorunlu açık rıza kutusu çıkar; metin kopyası ve
  zamanı gönderimle saklanır (compliance-agent onaylı metinler). Doğrulama istemci + sunucu; hatalar
  alanın altında, ilk hatalı alana odak; hata olursa veri kaybolmaz. Spam: honeypot + 5/dk rate
  limit + imzalı zaman damgası (security-agent). Gönderim tarayıcıdan doğrudan API'ye; kayıtlar
  mevcut Admin → İletişim → Gelen Kutusu'nda, bildirim mevcut e-posta şablonuyla (tedavi e-postaya
  yazılmaz). Admin → İletişim'e "İletişim sayfası" kartı (TR/EN ayrı metinler ve iletişim
  bilgileri, çalışma saati satırları, harita görseli/bağlantısı). Yeni uçlar: `GET /contact/page`,
  `GET /contact/page/token`, `POST /contact/page-submissions`, `GET|PUT /admin/contact/page`.
  **Şema değişikliği:** `contact_forms.pageContent` (JSONB, varsayılan `{}`) — migration
  `20260926092000_add_contact_page_content`.

- **`feat(site)`: Canlı sohbet düğmesi alt çubuklarla çakışmıyor; konum seçeneği (sağ alt / sol alt).**
  Ekranın altına sabitlenen her çubuk (`data-bottom-bar`: çerez bildirimi, doktor sayfasının mobil
  randevu çubuğu, ürün sepete ekle çubuğu) ortak bir gözlemciyle ölçülür ve `--site-bottom-inset`
  değişkenine yazılır; sohbet ve "yukarı çık" düğmeleri bununla çubukların üstüne çıkar, iPhone
  güvenli alanı (`safe-area-inset-bottom`) da hesaba katılır. Yeni bir alt çubuk için yalnızca
  özniteliği eklemek yeterli. "Yukarı çık" düğmesi aynı köşedeki sohbet düğmesinin üstüne yığılır.
  Admin → Ayarlar → Canlı Destek'e "Konum" eklendi (yalnızca dahili sohbet; açılan pencere de
  seçilen tarafa hizalanır). Görüşme ekranında sohbet düğmesi gösterilmez (değişmedi). **Şema
  değişikliği:** `site_settings.liveChatPosition` (enum, varsayılan `BOTTOM_RIGHT`) — migration
  `20260926091000_add_live_chat_position`.

- **`feat(site)`: Sayfa oluşturucuya "Uzmanlık Kartları" bloğu.** Kartlar Tele-Sağlık → Uzmanlıklar
  modülündeki aktif uzmanlıklardan, oradaki sırayla otomatik oluşur: görsel, ad (en fazla 2 satır),
  isteğe bağlı açıklama; kartın tamamı uzmanlık sayfasına bağlantıdır. Tüm kartlar aynı yükseklikte
  ve aynı yazı boyutunda; mobilde 2, tablette 3, masaüstünde 3/4/6 kolon. Blok ayarları: TR/EN
  başlık ve alt başlık, masaüstü kolon sayısı, açıklamayı göster/gizle, görsel şekli
  (daire/kare/köşeli). Görseli olmayan uzmanlıkta uzmanlığın ikonu açık zeminde gösterilir.
  Admin → Tele-Sağlık → Uzmanlıklar'a "Görsel" alanı eklendi (medya kütüphanesinden seç veya yükle;
  yalnızca PNG/JPG/WebP). **Şema değişikliği:** `specialties.imageMediaId` (boş geçilebilir) —
  migration `20260926090000_add_specialty_image`. Anasayfadaki mevcut bölüm DEĞİŞTİRİLMEDİ.

- **`feat(telehealth)`: Acil durum uyarısı yeniden düzenlendi — katlanabilir şerit, admin anahtarı ve
  düzenlenebilir metinler.** Doktorlar, uzmanlıklar ve görüşme sayfalarında header altındaki şerit
  artık kapalı (tek satırlık özet + "Ayrıntılar" düğmesi) başlar; düğme tam metni açar/kapatır
  ("Ayrıntıları gizle"). Ziyaretçi şeridi tamamen kapatamaz, durum hatırlanmaz (her sayfada kapalı
  başlar); `role="note"`, `aria-expanded`/`aria-controls`, 44px dokunma alanı. Yazı 1280px'e kadar
  13px, üstünde 14px; zemin birincil rengin açık tonu, ikon `--warning`. Admin → TeleHealth →
  "Arayüz & Tema Renkleri" sayfasına "Acil Durum Uyarısı" kartı eklendi: "Acil durum uyarısını göster"
  anahtarı (varsayılan AÇIK, kapatmak onay ister) yalnızca doktorlar ve uzmanlıklar sayfalarındaki
  şeridi kontrol eder — görüşme ekranındaki şerit ve doktor detay sayfasındaki uyarı kartı (tam
  metin) her zaman görünür. TR/EN özet (10–90) ve tam metin (20–300) düzenlenebilir, boş
  bırakılamaz, düz metin; EN metinler "emergency", TR metinler "acil" kelimesini içermek zorunda
  (sunucu 422 döner, form anlaşılır hata gösterir). "Varsayılana dön" dil sözlüğündeki metne döner.
  Yalnızca ADMIN rolü değiştirebilir; her değişiklik denetim kaydına (önce/sonra) yazılır. Yeni uç:
  `PATCH /admin/telehealth/settings/emergency-notice`; `GET /telehealth/theme` ve
  `GET|PATCH /admin/telehealth/settings` yanıtına `emergencyNotice` eklendi. Şema değişikliği YOK
  (ayar `site_modules.settings` JSON'unda).

- **`feat(site)`: Site simgesi (favicon) ve Apple touch icon admin panelinden değiştirilebilir.**
  Admin → Navigasyon'da logonun altına "Site simgesi (favicon)" ve "Apple touch icon (opsiyonel)"
  alanları eklendi (medya kütüphanesinden seçme veya yükleme). Yalnızca PNG (SVG bilinçli olarak
  desteklenmez — medya kütüphanesi SVG'yi XSS riski nedeniyle reddeder; ayrı iş). Site ve doktor
  portalı `<link rel="icon">`/`apple-touch-icon` etiketlerini bu ayardan üretir; adresten türetilen
  `?v=` sürüm parametresi simge değişince tarayıcı önbelleğini kırar. Ayar boşsa varsayılan
  `/favicon.ico` (`src/app/favicon.ico` → `public/favicon.ico` taşındı). **Şema değişikliği:**
  `SiteSettings.faviconUrl` / `appleTouchIconUrl` (boş geçilebilir) — migration
  `20260925090000_add_site_favicon` yalnızca bu iki kolonu ekler.
- **`feat(site)`: Mobil/tablet (1024px altı) header'da hamburger menü.** Başlıkta yalnızca logo, CTA
  ve hamburger; sağdan açılan panelde menü öğeleri (alt menüler akordeon), dil listesi ve
  giriş/hesap linkleri. Odak panelde kalır, Esc/dış tıklama kapatır, kapanınca odak düğmeye döner,
  sayfa değişince kapanır, arka plan kaymaz; dokunma alanları ≥44px. Masaüstü görünümü değişmedi.

- **`feat(site)`: "Hakkımızda" (`/about`, `/en/about`) sayfası admin panelinden düzenlenebilir.**
  İçerik, admin → Sayfalar'daki `slug = "about"` CMS kaydının tek kök `about-page` bloğunda
  (tr: `blocks`, diğer diller: `translations.<locale>.blocks`) tutulur; tasarım kodda sabittir.
  Sayfa bu şablonu kullanıyorsa editör blok tuvali yerine her rolde yapılandırılmış bir form
  gösterir (Hero, Tedavi alanları, Why WM Health, Doktorlar, Kapanış bandı; kart/madde ekle-sil-
  sırala, ikon listesi, medya kütüphanesinden görsel, aktif doktorlardan kurucu seçimi, tedavi/
  yaklaşım/doktor bölümleri için göster/gizle, gösterilecek doktor sayısı 1–6). SEO alanları
  mevcut CMS alanlarıdır. **Şema değişikliği yok**; backend `pages.schemas.ts`'e `about-page`
  blok şeması (düz metin, `SafeHrefSchema` + yalnızca sayfa içi çapa, kapalı ikon listesi,
  "tek kök blok" kuralı → aksi halde 422) ve `TEMPLATE_EDITABLE_FIELDS["about-page"]` eklendi
  (openapi `AboutPageBlockData`). **Geriye dönük güvenlik:** kayıt yoksa/yayında değilse/
  silinmişse ya da bir alan boşsa sayfa sözlük metinlerini gösterir; bir dilin kendi içeriği
  yoksa o dilin sözlüğü gösterilir (Türkçe içerik İngilizce sayfaya düşmez). **Veri migration'ı**
  `20260924120000_add_about_page_content` kaydı sözlük metinleriyle (PUBLISHED, TEMPLATE) oluşturur;
  varsayılan dili `locales` tablosundan okur (varsayılan `en` → ana alanlar İngilizce + `translations.tr`;
  varsayılan `tr` → ana alanlar Türkçe + `translations.en`; başka bir dil → hiçbir şey eklemez), etkin
  `en`/`tr` için slug satırı ekler. İdempotenttir, `about` slug'ı varsa (çöp kutusu dahil) hiçbir şey
  yapmaz, UPDATE/DELETE içermez, tek SQL ifadesidir.
  Demo Şablonlar "uygula" işleminin `about` sayfasına dokunmadığı regresyon testiyle korunur
  (menü/footer ise o işlemde bilinen şekilde tamamen değiştirilir). Kurucu artık koddaki sabit slug
  (`FOUNDER_DOCTOR_SLUG`, kaldırıldı) yerine admin'de seçilen doktorun `id`'siyle belirlenir.

### Fixed

- **`fix(telehealth)`: İngilizce doktor detay sayfasında randevu özeti ve mobil randevu çubuğu
  Türkçe görünüyordu** ("Ücretsiz / Bilgi Alınız", "Devam Et", adım sayacı). Randevu sihirbazı
  özet paneline aktif dilin sözlüğünü iletmiyordu, panel Türkçe varsayılana düşüyordu; artık sayfanın
  dil sözlüğü iletiliyor.

- **`fix(telehealth)`: Tema renkleri kaydedilince `site_modules.settings` içindeki diğer ayarlar
  siliniyordu.** `PATCH /admin/telehealth/settings` artık mevcut JSON'u birleştirerek yazar; tema
  kaydı acil durum uyarısı ayarını (ve tersi) korur. Regresyon testi eklendi.

- **`fix(site)`: Masaüstü açılır menü (ör. Specialties) tetikleyici kadar dar açılıyordu** — öğeler 3
  satıra kırılıyordu. Genişlik artık içeriğe göre (en fazla 22rem); öğeler en fazla 2 satır
  (`line-clamp-2`, tam metin `title`da); sağ kenara sığmazsa menü sola açılır.
- **`fix(site)`: Hero Studio'da dar ekranlarda metin ile buton üst üste biniyordu.** 1280px altında
  katmanlar mutlak konum yerine alt alta akışla dizilir (dikey sıra ve yatay hiza admin'deki
  konumdan türetilir, slider gerekirse içeriğe göre uzar; katmanların cihaz ayarları yine
  mobil/tablet/masaüstü eşiklerine göre seçilir). ≥1280px değişmedi.
- **`fix(telehealth)`: Görüşme ekranında mobilde yerel kamera önizlemesi "Görüşmeyi sonlandır" ve
  "Tam Ekran" düğmelerini örtüyordu.** 1024px altında: önizleme sağ üstte (kayıt göstergesinin
  altında), kontrol düğmeleri 44px ve tek satırda, doktorun kayıt kontrolü sol üstte; dikey
  telefonda sahne 3:4 ve hiçbir yönde ekran yüksekliğini aşmaz (yatay telefonda kontroller
  ekranda kalır). Masaüstü (≥1024px) görüşme ekranı değişmedi.

- **`fix(site)`: Public sayfaların gizli RSC verisine yayındaki TÜM sayfaların içeriği gömülüyordu.**
  `(site)/layout.tsx` header'ın yedek menüsü için `SiteHeader`'a (istemci bileşeni) tam `SitePage`
  nesnelerini (bloklar + tüm dillerin çevirileri) geçiriyordu; bu veri her sayfanın HTML'ine
  serileştiriliyordu (ör. Türkçe `/about`'ta İngilizce içerik görünmez veri olarak bulunuyordu).
  Artık yalnızca menüde kullanılan `id`/`slug`/`title` geçirilir; görünür davranış değişmedi.

- **`fix(telehealth)`: Randevu sihirbazı (`/doctors/[slug]#randevu`) tamamlanmış bir rezervasyondan
  sonra çıkmaz duruma girmiyor artık.** Kök neden: mount-anı kurtarma effect'i (sayfa yenileme/geri
  dönüşte `?booking=&t=`'yi okuyup backend'den güncel durumu sorar) ücretsiz (`totalCents === 0`)
  doktor bookinglerini `PAID` bulduğunda bilerek Adım 5'e (tamamlandı ekranı) geri döndürüyordu —
  bu, booking oluşturulduktan HEMEN SONRA bir yenilemede doğruydu, ama kullanıcı SONRA aynı sayfaya
  (aynı doktordan yeni randevu almak için) döndüğünde onu eski "Ödeme adımı gerekmiyor —
  randevunuz tamamlandı" ekranında SIKIŞTIRIYORDU; yeni tarih/saat seçilemiyordu. Artık ZATEN
  ödenmiş (ücretsiz dahil) her booking mount'ta sessizce temizlenir, Adım 2'den (Tarih & Saat)
  TEMİZ başlanır — booking'in kendi onay e-postası (görüşme linki dahil, bkz. az önceki madde)
  zaten gönderildi, sihirbazın ekranı tek/kalıcı onay kaynağı değildi. Ayrıca: (1) ücretsiz booking
  onay panelinde "Yeni Randevu Oluştur" butonu eklendi (aynı oturumda hemen tekrar randevu almak
  isteyenler için); (2) `booking-selection-context.tsx`'e paylaşılan `hasCompletedBooking`/
  `resetSignal`/`requestBookingReset` eklendi — sağ sticky "Randevu Oluştur" kartı (KARDEŞ ağaç,
  prop-drilling ile ulaşılamaz) artık sihirbaz tamamlanmış bir rezervasyon gösteriyorken tıklanırsa
  salt kaydırma yerine sihirbazı Adım 2'ye sıfırlar.

- **`fix(telehealth)`: Randevu onay e-postasına görüşme bağlantısı eklendi, ücretsiz randevularda
  yanlış "ödemenizi aldık" metni düzeltildi.** Kök neden (1): `APPOINTMENT_CONFIRMATION` şablonuna
  `{{join_link}}` daha önce bir ONE-OFF script'le (`scripts/add-consultation-join-link-to-
  confirmation-email.ts`) eklenmişti — `prisma/seed.ts`'in `upsert.update: {}` idempotency'si zaten
  seed edilmiş ortamları GÜNCELLEMEZ, bu script mevcut/canlı ortamlarda HİÇ ÇALIŞTIRILMAMIŞSA
  e-postada görüşme bağlantısı YOK olur (kod HATASI değil, uygulanmamış veri migrasyonu). Kök
  neden (2): "We have received your payment…" ifadesi `sessionPriceCents: null` (ücretsiz/bilgi-
  alınız) doktorlarda `totalCents === 0` olduğu halde SABİTTİ — hiçbir ödeme alınmadığı halde
  yanıltıcıydı. Yeni `{{status_message}}` değişkeni (`notifications.ts::buildConfirmationStatusMessage`)
  `total`e göre "We have received your payment and your appointment is confirmed." / "Your
  appointment has been successfully created and confirmed." arasında seçim yapar — şablon koşullu
  blok desteklemediği için karar tetikleyicide verilir. Yeni tek seferlik script
  (`scripts/add-status-message-to-confirmation-email.ts`) mevcut ortamların DB satırını günceller
  (idempotent, özelleştirilmiş şablonlara DOKUNMAZ). `EmailTemplate` modelinde locale/translations
  alanı YOKTUR (tek dilli — varsayılan İngilizce, bkz. `.claude/architect-scope-i18n.md`) — ayrı
  TR/EN sistem e-posta şablonları bu turun kapsamında DEĞİLDİR, mevcut mimari sınır.

- **`fix(telehealth)`: LiveKit görüşme odası "Bağlanıyor…"da sonsuza dek takılı kalmıyor artık.**
  Kök neden: `<LiveKitRoom>`in `onDisconnected`'ı YALNIZCA önce kurulmuş bir bağlantı koptuğunda
  tetiklenir — `room.connect()`'in kendisi (ilk WS/ICE handshake) başarısız olursa NE bu callback
  NE DE herhangi bir yerel state güncellenirdi; `onError`/`onMediaDeviceFailure` HİÇ BAĞLANMAMIŞTI.
  İkisi de artık bağlı: bağlantı kurulamazsa veya kamera/mikrofon izni reddedilirse (Türkçe,
  nedene özel mesaj — izin reddi/cihaz bulunamadı/cihaz meşgul) kullanıcı açık bir hatayla
  ön-katılım ekranına döner, çıkmaz bir "Bağlanıyor…" durumunda kalmaz. `adaptiveStream`/
  `dynacast` (SDK varsayılanında İKİSİ DE kapalı) artık açık — zayıf ağlarda bant genişliği/CPU
  baskısını azaltır. Sunucu tarafında (nginx WS upgrade/timeout + LiveKit UDP medya port aralığı)
  bu oturumda sunucuya erişim olmadığı için doğrudan düzeltilemedi — `INFRA.md`'ye referans
  nginx config'i + kontrol listesi + teşhis komutları eklendi (canlıda manuel doğrulanmalı).

- **`fix(telehealth)`: `/consultation/[id]` sayfası yetkisiz/doğrudan erişimde artık çökmüyor.**
  Oturumu olmayan VE `?t=` misafir token'ı taşımayan ziyaretçiler için `GET /appointments/{id}`
  hiç çağrılmadan (zaten `404` döneceği kesin — backend'in IDOR-güvenli, varlık sızdırmayan
  tasarımı gereği) temiz bir "Erişim Doğrulama Gerekli" paneli gösterilir ("Giriş Yap" CTA'sı
  `/login?next=/consultation/{id}` ile geri döner — `patient-booking-detail-panel.tsx`'teki
  kurulu desenle aynı). Randevu/doktor/hasta alanlarına erişim artık savunmacı (`?.`/fallback)
  yapılıyor. Yeni bir `consultation/error.tsx` sınır bileşeni, gerçekten beklenmeyen bir render
  hatasını segment içinde yakalar — artık `global-error.tsx`'e kadar yükselip tüm site
  kabuğunu (header/nav dahil) "Beklenmeyen bir hata oluştu" ekranıyla değiştirmiyor. LiveKit
  `POST /appointments/{id}/meeting-token` ucu KASITLI olarak `404` döndürmeye devam ediyor
  (401/403 DEĞİL — mevcut IDOR-güvenli konvansiyon, `assertAppointmentAccess` ile aynı); bu
  hata frontend'de zaten satır içi, kibar bir uyarı olarak yakalanıp gösteriliyordu.

### Added

- **`feat(telehealth)`: Doktor seans ücreti opsiyonel/açılır-kapanır hale getirildi**
  (`docs/architecture/openapi.yaml`). Admin panelde doktor ekleme/düzenleme formunda
  ("Seans süresi"/"Seans ücreti"/"Para birimi" alanlarının üstünde) "Ücret Bilgisi Belirle /
  Ücretli Hizmet" switch'i eklendi — kapalıyken bu alanlar gizlenir ve `sessionPriceCents`
  `null` (ücretsiz/bilgi-alınız) olarak gönderilir. `DoctorProfile.sessionPriceCents`
  (Prisma) artık nullable; backend booking akışı `sessionPriceCents === null` doktorlarda
  `unitPriceCents`'i `0` kabul eder ve rezervasyonu **oluşturulur oluşturulmaz** (mevcut
  `confirmBookingPayment` — Stripe webhook/demo-pay/ADMIN mark-paid İLE AYNI fonksiyon,
  `paidBy: "free"`) ödeme adımı hiç sunulmadan `PAID`/`SCHEDULED`'a çevirir; onay e-postası
  ve misafir hesap sağlama diğer ödeme yollarıyla AYNI şekilde tetiklenir. Hasta tarafında
  doktor kartı/profili/hızlı randevu kartı/hizmet özeti ücret yerine "Ücretsiz / Bilgi
  Alınız" gösterir; randevu sihirbazı Adım 5'te ödeme formu yerine bir onay notu render eder.

- **`feat(telehealth)`: Erken katılım güvenlik onay modalı, otomatik randevu hatırlatma
  e-postaları ve canlı destek yönetim masası** (bağlayıcı karar dokümanı
  `.claude/architect-scope-support-desk-and-reminders.md`, KVKK değerlendirmesi
  `.claude/compliance-notes-support-desk.md`, `docs/architecture/ARCHITECTURE.md` §10.23.10
  ve §10.24, `docs/architecture/openapi.yaml`). Tamamen **additive** bir tur — mevcut hiçbir
  uç/davranış kırılmadı.
  - **Erken katılım güvenlik onay modalı:** randevu saatinden 10 dakikadan fazla erken
    "Toplantıya Katıl" tıklayan hasta/doktora `ConfirmDialog` (`tone="warning"`) ile uyarı
    gösterilir ("Anladım, Odaya Katıl" / "Vazgeç"); onay `sessionStorage`'da randevu başına
    bir kez hatırlanır. **Backend hiçbir şeyi reddetmez** — bu bilinçli bir karardır, katılım
    penceresi kısıtı 2026-09-15'te kaldırılmıştı ve geri getirilmedi. Sunucu yalnızca mevcut
    katılım audit kaydına `earlyJoin`/`minutesBeforeStart` (sunucu saatinden) metadata'sı
    ekler — ileride bir kısıt gerekirse karar ölçülmüş veriyle verilir.
  - **1 saat / 30 dakika randevu hatırlatma e-postaları:** yeni süreç-içi `setInterval`
    sweeper'ı (`lib/appointment-reminders.ts`, mevcut `booking-expiry.ts` iskeletiyle
    birebir — yeni kuyruk altyapısı (BullMQ/Redis) **eklenmedi**), 5 dakikalık kadans, iki
    yeni `Appointment` kolonu (`reminded60mAt`/`reminded30mAt`, hiçbir DTO'da dönmez) ve
    claim-first `updateMany` ile çift gönderim engellenir. Yeniden planlanan randevularda
    hatırlatma damgaları sıfırlanır, arka arkaya slotlarda tekrar bastırılır. İki yeni
    e-posta şablonu (`APPOINTMENT_REMINDER_60M`/`_30M`) — 30 dakikalık e-postadaki katılım
    bağlantısı token'sız derin bağlantıdır (mevcut onay bağlantısı rotate edilmez).
  - **Canlı destek yönetim masası — gerçek backend'e geçiş:** `live-chat-widget.tsx`'in
    daha önce istemci tarafı **mock** olan `internal` sohbet modu (bkz. önceki tur notu),
    kalıcı, sunucu taraflı bir sohbet sistemiyle **değiştirildi** — ziyaretçi mesajı artık
    sayfa yenilendiğinde kaybolmaz. Yeni `modules/support/` (ziyaretçi + yönetim uçları),
    üç yeni tablo (`SupportChatSession`/`SupportChatMessage`/`SupportReplyTemplate`, düz
    metin, HTML render edilmez) ve yeni admin sayfaları (`/admin/support`,
    `/admin/support/templates`: oturum listesi, mesajlaşma, temsilci atama, hazır şablon
    yönetimi). Gerçek zamanlılık **polling** ile sağlanır (`?afterSeq=` artımlı, 5/15sn
    kadanslar) — projede SSE/WebSocket emsali olmadığı için bilinçli olarak tercih edildi.
    Ayrı bir `SUPPORT_AGENT` rolü **eklenmedi**; erişim mevcut `ADMIN`/`MANAGER`'a verildi
    (EDITOR göremez). KVKK: özel nitelikli veri riski **rıza yerine veri minimizasyonu**
    (widget'ta kalıcı sağlık-verisi-paylaşmayın uyarısı) ile ele alındı; saklama: 30 gün
    (IP/UA redaksiyon) + 180 gün (`closedAt` bazlı kapalı oturum silme) + 365 gün
    (kapatılmamış oturum güvenlik ağı, yeni bağlayıcı karar).
  - Kapsam dışı (bilinçli): erken katılımın backend'de engellenmesi, SSE/WebSocket, ayrı
    destek rolü, destek mesajlarında tam metin arama, kuyruk altyapısına geçiş — ayrıntılar
    ve takip branşları için `ARCHITECTURE.md` §10.23.10/§10.24.

- **`feat(telehealth)`: Kurumsal hekim profili, doktor öz-servis düzenleme paneli, randevu
  öncesi kimlik bilgisi toplama adımı ve doktor konsolu metrik ucu** (bağlayıcı karar
  dokümanı `.claude/architect-scope-doctor-portfolio-identity-console.md`,
  `docs/architecture/ARCHITECTURE.md` §10.23.9, `docs/architecture/openapi.yaml`). Tele-Sağlık
  modülünün üçüncü genişleme turu, üç ayrı ekseni tek turda ilerletir.
  - **Doktor öz-geçmiş alanları + dar öz-servis yazma yüzeyi:** `DoctorProfile`e
    `subSpecialty`, `aboutHtml` (uzun biyografi — kısa özet `bio` DEĞİŞMEDEN korunur, demo
    şablonunun zorunlu ilk cümle garantisi bu yüzden bozulmadı), `practiceStartYear`,
    `cvEntries[]`, `publications[]` eklendi. `experienceYears` bir kolon DEĞİLDİR — DTO'da
    `currentYear - practiceStartYear` ile türetilir, istekte gönderilirse `422`. Yeni uç
    `PUT /doctor/profile`: doktor kendi özgeçmişini, `bio`sunu ve dillerini düzenleyebilir;
    **fiyat, unvan, slug, saat dilimi, `isVerified` alanlarını YAZAMAZ** (Zod `.strict()`,
    kapsam dışı alan `422`) — bunlar birer yetkinlik/ürün tanımı iddiasıdır. `aboutHtml`
    yazma yolunda mevcut `lib/html-sanitize.ts`'ten geçer; `cvEntries`/`publications` düz
    metin JSON'dur, HTML kabul etmez (`422`).
  - **Randevu öncesi kimlik bilgisi toplama (ödemeden ÖNCE, zorunlu):** `POST
    /appointments/bookings` gövdesine `identity` nesnesi eklendi — T.C. Kimlik No
    (**algoritmik format denetimi**: mod-11/mod-10 sağlama + repdigit reddi; **bu bir
    NVİ/KPS sorgusu DEĞİLDİR**) veya pasaport no + ülke kodu, artı doğum tarihi. 18 yaş altı
    `422 IDENTITY_MINOR_NOT_SUPPORTED` ile reddedilir ve **hiçbir slot tutulmaz**
    (`SLOT_TAKEN` ile aynı ya-hep-ya-hiç kuralı). Veriler yeni `AppointmentBooking` kolonları
    üzerinde tutulur — **`Patient` diye yeni bir tablo AÇILMADI**, **`Appointment`'a
    kopyalanmadı** (veri minimizasyonu; `Appointment.bookingId` join'i zaten yeterli).
    Şifreleme AES-256-GCM (mevcut `lib/crypto.ts`), arama/eşleştirme için HKDF-türetilmiş
    anahtarla HMAC-SHA-256 hash (yeni `lib/identity.ts`) — çıplak `hashToken` kimlik için
    **hiçbir yerde kullanılmadı** (düşük entropili girdi için güvensiz olurdu). Görüntüleme
    için denormalize maskeleme (en fazla 5 gerçek karakter açık).
  - **Okuma yetkisi ve düzeltme penceresi:** hasta ✓, o booking'in doktoru ✓, `ADMIN` ✓;
    **`MANAGER` booking'i görür ama `identity: null` alır**, `EDITOR`/başka doktor `404`.
    Açık değer yalnızca `GET .../identity` ucundan döner (`Cache-Control: no-store`, her
    erişim denetim kaydına düşer). `PUT .../identity` yalnızca hasta + yalnızca ödeme
    beklemedeki (`PENDING`) bir rezervasyonda çalışır; ödenmiş bir rezervasyonda
    `409 IDENTITY_LOCKED`.
  - **Doktor konsolu — yeni toplama ucu:** `GET /doctor/overview` (`doctorId` parametresi
    YOK, IDOR koruması) doktorun saat diliminde "bugünkü seanslar", tamamlanan
    konsültasyon sayısı, toplam hasta (`PAID` booking'lerde tekil sayım) ve bekleyen tıbbi
    belge sayısını döner. `GET /doctor/bookings`e durum filtresi (`scope`) eklendi.
    `AppointmentDocument`e bir "incelendi" bayrağı **EKLENMEDİ** — uygulanmayan bir tıbbi
    inceleme sorumluluğunu ima eder.
  - **Kurumsal hekim profil sayfası (`/doctors/[slug]`):** koyu lacivert üst bant + tek
    URL'de kalan üç sekme (Doktor Hakkında / Özgeçmiş / Bilimsel Yayınlar); boş sekmeler
    gizlenmez, nötr bir bilgi notu gösterir.
  - **Dil kuralı (bağlayıcı):** yapılan iş **algoritmik format denetimidir** — **NVİ/KPS
    sorgusu DEĞİLDİR** — kolon adı `identityCapturedAt`'tir (`identityVerifiedAt` DEĞİL) ve
    hiçbir kullanıcı yüzeyinde/e-postada/bu belgede bunun aksini ima eden bir ifade
    kullanılmaz. Gerçek NVİ/KPS sorgu entegrasyonu kapsam dışıdır (backlog:
    `feature/telehealth-kps-identity-verification`).
  - **Bilinen operasyonel gap (dokümante edildi, engelleyici değil):** `ENCRYPTION_KEY`
    rotasyonu mevcut `identityNumberHash` değerlerini geçersiz kılar; şifreli değer
    (`identityNumberCiphertext`) teorik olarak çözülüp yeniden şifrelenip yeniden
    hash'lenebilir, **ancak bunu otomatikleştiren bir offline runbook/script bugün YOKTUR**
    (yalnızca kimlik alanları için değil, projedeki tüm `encryptSecret` tüketicileri için
    genel bir boşluk) — bkz. `.claude/security-review-doctor-identity.md`,
    `docs/architecture/ARCHITECTURE.md` §10.23.9.
  - **Diğer bilinçli kapsam dışı (backlog):** 12 aylık booking-kimlik anonimleştirme
    süpürücüsü henüz yazılmadı (mevcut isim/e-posta süpürücüsü kimlik kolonlarını
    kapsamıyor — `.claude/compliance-notes-doctor-identity.md`), veli/vasi (18 yaş altı)
    rıza akışı, doktor bazında komisyon oranı, kimlik numarasıyla admin araması.
  - İki turluk `security-agent` (tasarım + implementasyon) ve `compliance-agent` (ön onay +
    implementasyon) denetiminden **ENGELLEYİCİ bulgu olmadan** geçti; 24/24 Playwright e2e
    senaryosu yeşil.

- **`feat(telehealth)`: Çoklu slot randevu rezervasyonu, Stripe ile ödeme, opsiyonel/rızaya
  bağlı sağlık verisi (şikâyet notu + belge) yükleme ve doktor/hasta portalları** (bağlayıcı
  karar dokümanı `.claude/architect-scope-telehealth-template.md` §9.7 "TADİLAT TURU 2",
  `.claude/compliance-notes-telehealth.md` "TUR 2", `docs/architecture/openapi.yaml`). Tele-Sağlık
  modülünün (bkz. aşağıdaki Tur 1 kaydı) ikinci, kapsamlı genişleme turu.
  - **Çoklu slot rezervasyonu:** bir randevu artık 1-4 bitişik-olmayan slot içerebilir (aynı
    doktor, doktorun kendi takviminde aynı gün) — yeni `AppointmentBooking` üst kaydı, her slot
    kendi `Appointment` satırını korur (`@@unique([doctorId, startsAt])` çifte rezervasyon
    garantisi değişmeden çalışır). Herhangi bir slot doluysa **hiçbiri** oluşmaz
    (`409 SLOT_TAKEN`); toplam tutar her zaman sunucuda hesaplanır, istemciden asla kabul
    edilmez. Mevcut tek-slot `POST /appointments` geriye dönük uyumluluk için korunur ama
    `deprecated: true` işaretlendi.
  - **Ödeme (Stripe Checkout, `mode: "payment"`):** rezervasyon oluşturulunca slot **30 dakika**
    tutulur (`AppointmentStatus.PENDING_PAYMENT`); ödeme `checkout.session.completed` webhook'uyla
    onaylanır (mevcut `webhooks/stripe.routes.ts` genişletildi, yeni bir webhook yolu açılmadı).
    Süresi dolan, hiç ödenmemiş rezervasyonlar 5 dakikalık bir süpürücüyle (`lib/booking-expiry.ts`)
    **gerçekten silinir** ve slot serbest kalır — ödenmiş/onaylanmış bir randevunun iptalinde mevcut
    kural (slot kapalı kalır) değişmedi. Stripe yapılandırılmamışken `POST .../checkout-session`
    dürüstçe `503 PAYMENTS_NOT_CONFIGURED` döner (LiveKit'in mevcut deseniyle birebir aynı).
    ADMIN için ofis-içi manuel ödeme kaçış kapısı: `POST
    /admin/telehealth/bookings/{id}/mark-paid` (zorunlu gerekçe + audit). **Sahte "emanet
    (escrow)" arayüzü bilinçli olarak reddedildi** (lisanslı finansal faaliyet); iade,
    doktora ödeme aktarımı ve e-Fatura entegrasyonu bu turda kapsam dışı bırakıldı (bkz. aşağıdaki
    backlog listesi). Ödenmiş bir rezervasyon için "Ödeme Belgesi (bilgi amaçlıdır)" görünümü
    (`GET .../invoice`) sunulur — bu gerçek bir e-Fatura/GİB belgesi değildir, ayrı bir `Invoice`
    tablosu açılmadı.
  - **Sağlık verisi (opsiyonel, rızaya bağlı, ENGELLEYİCİ compliance-agent ön-onayı ile):**
    rezervasyona randevudan **bağımsız** bir "intake" adımı eklenebilir — şikâyet notu
    (`AppointmentIntake.noteCiphertext`, AES-256-GCM şifreli, düz metin asla saklanmaz/aranmaz)
    ve en fazla 5 belge (reçete/tahlil/radyoloji, ≤5 MB, PDF/PNG/JPEG, sihirli-bayt doğrulaması,
    `AppointmentDocument`). Bu adım **randevunun ön koşulu değildir** — atlanması rezervasyonu,
    ödemeyi veya görüşmeyi hiçbir şekilde engellemez. Ayrı, varsayılan işaretsiz, randevu KVKK
    onayından bağımsız ikinci bir açık rıza zorunludur (`422 HEALTH_CONSENT_REQUIRED` rıza
    yoksa). Belgeler **`Media` tablosuna asla girmez** ve `@fastify/static`in herkese açık
    `/uploads/**` sunumunun tamamen dışında, ayrı bir özel dizinde (`PRIVATE_UPLOAD_DIR`)
    tutulur; içeriğe yalnızca hasta, o rezervasyonun doktoru ve ADMIN erişebilir (**MANAGER
    içeriği göremez, yalnızca belge sayısını görür; EDITOR hiçbir şey göremez**), her erişim
    denetim kaydına düşer. Saklama: son randevu bitiminden **90 gün sonra gerçekten silinir**
    (dosya diskten, not `null`'lanır) — mevcut 12 aylık isim/e-posta anonimleştirme
    penceresinden kasıtlı olarak daha kısa. Silme hakkı uçları (`DELETE .../intake`,
    `DELETE .../documents/{id}`) hastaya beklemeden silme imkânı verir.
  - **Doktor ve hasta portalları:** yeni bir rol/kimlik doğrulama sistemi **eklenmedi** — mevcut
    e-posta/şifre + TOTP 2FA akışı aynen kullanılıyor. **`SiteRole.DOCTOR` eklenmedi**
    (doktorluk bir rol değil `DoctorProfile.userId` ilişkisidir). Doktor portalı
    (`/{lang}/doctor/**`, backend `/api/v1/doctor/*`) için 2FA **route seviyesinde zorunlu**
    (`403 TWO_FACTOR_REQUIRED`, yeni DB kolonu/2FA ucu yok). Hasta portalı
    (`/{lang}/patient/**`) rezervasyon anında üretilen, ödeme sonrası e-postayla iletilen bir
    **magic-link** (`?t=`) ile çalışır; her ikisi de `noindex`, admin panelinden ayrı. "Geçmiş
    görüşme kayıtları" **randevu geçmişi listesidir** — ses/video kaydı yoktur ve bu turda da
    eklenmedi.
  - **Bildirim:** yalnızca `APPOINTMENT_CONFIRMATION` e-postası (ödeme onaylandığında, magic-link
    içerir) eklendi — konu satırı nötrdür ("Randevunuz onaylandı"), gövdeye şikâyet notu/belge
    adı/uzmanlık adı asla yazılmaz. Hatırlatma/iptal e-postaları backlog'da kalıyor.
  - Yeni migration'lar (salt-ekleme + iki izole `ALTER TYPE`):
    `add_appointment_status_pending_payment`, `add_email_template_purpose_appointment_confirmation`,
    `add_telehealth_booking_and_payments`, `add_telehealth_intake_and_documents`.
  - Yeni hata kodları: `PAYMENTS_NOT_CONFIGURED` (503), `BOOKING_NOT_PAYABLE` (409),
    `BOOKING_EXPIRED` (409), `HEALTH_CONSENT_REQUIRED` (422), `UNSUPPORTED_DOCUMENT_TYPE` (422),
    `DOCUMENT_LIMIT_REACHED` (409), `TWO_FACTOR_REQUIRED` (403), `NOT_A_DOCTOR` (403).
  - **Bilinçli kapsam dışı (backlog):** iade/kısmi iade (`feature/telehealth-refunds`), gerçek
    escrow/doktora ödeme aktarımı (`feature/telehealth-escrow-payouts`), e-Fatura/e-Arşiv
    (`feature/e-invoice-integration`), görüşme kaydı (`feature/telehealth-recording`), randevu
    hatırlatma/iptal e-postası (`feature/telehealth-reminder-emails`), `SiteRole.DOCTOR`
    (`feature/doctor-role-tier`), randevu erteleme (`feature/appointment-reschedule`), belgede
    virüs taraması (`feature/upload-antivirus`), doktorun kendi müsaitliğini düzenlemesi
    (`feature/doctor-self-availability`).
  - **Denetimde bulunup düzeltilen bulgular:** e2e doğrulaması sırasında iki gerçek regresyon
    tespit edilip kapatıldı — (1) doktor portalı sayfalarının (`/doctor`, `/doctor/profile`)
    bir Server Component'ten Client Component'e `children` olarak fonksiyon (render-prop)
    geçirmesi nedeniyle RSC sınırında serileştirilemeyip **her istekte `500` ile çökmesi**
    (düzeltme: `profile` artık bir React context ile expose ediliyor, `children` düz
    `ReactNode`), (2) doktor/hasta portalı kimlik doğrulama yönlendirme akışındaki bir
    tutarsızlık. İkisi de frontend-agent tarafından düzeltildi ve qa-agent'ın
    `telehealth-multi-slot-booking.spec.ts` (madde 27) testiyle doğrulandı — bkz.
    `TEST_COVERAGE.md`.
  - Testler: backend `tests/` tamamı (117 dosya, 1390 test) + bu tura özel 8 yeni birim/
    entegrasyon regresyon testi yeşil; 10 yeni `telehealth-multi-slot-booking.spec.ts` Playwright
    e2e senaryosu (çoklu slot toplam tutarı, belgeli/belgesiz intake, gerçek Stripe webhook imzası,
    belge sızıntı testi — `/uploads/**` altından erişilemiyor + `/admin/media`de görünmüyor —,
    doktor/MANAGER/EDITOR yetki matrisi, 2FA kapısı, magic-link erişim denetimi) dahil
    `telehealth-*.spec.ts` suite'inin tamamı yeşil.

- **`feat(telehealth)`: Tele-Sağlık modülü (doktor profilleri, haftalık müsaitlik, saat
  dilimi duyarlı randevu, LiveKit görüntülü konsültasyon) + `feat(demo-templates)`:
  üçüncü hazır şablon "Global TeleHealth & Clinic"** (bağlayıcı karar dokümanı
  `.claude/architect-scope-telehealth-template.md`, `ARCHITECTURE.md` §10.23,
  `docs/architecture/openapi.yaml` `TeleHealth` tag'i). İki ayrı iş: (A) platformun
  kalıcı bir yetenek genişlemesi olan `telehealth` modülü, (B) bunu sergileyen üçüncü
  demo şablonu `telehealth-clinic`.
  - **(A) Veri modeli:** yeni `AppointmentStatus` enum'u + `Specialty`/`DoctorProfile`/
    `DoctorAvailability`/`Appointment` tabloları (migration `add_telehealth_module`,
    salt-ekleme). `DoctorAvailability` haftalık **tekrarlayan bir kural**dır, üretilmiş
    slot satırı değildir — somut slotlar (`GET /doctors/{slug}/slots`) bu kurallardan
    çalışma zamanında saf bir fonksiyonla türetilir. **`MeetingRoom` tablosu açılmadı**
    ve doktor `rating`/`reviewCount` alanı (dayanaksız sosyal kanıt) bilinçli olarak
    reddedildi.
  - **(A) Saat dilimi:** tekrarlayan müsaitlik doktorun IANA diliminde **duvar
    saatidir**; randevu UTC bir **an**dır. Dönüşüm tek yerde yapılır, API sınırından
    dışarıya yalnızca ISO-8601 `Z`'li anlar çıkar; DST geçişlerinde var olmayan saat
    üretilmez, çift geçen saatte ilk örnek alınır. Yeni bir saat dilimi kütüphanesi
    **eklenmedi** (Node 20'nin `Intl` desteği yeterli).
  - **(A) Rezervasyon:** `POST /appointments` kimlik doğrulama gerektirmez (5 istek/dk),
    `runSerializable` + `@@unique([doctorId, startsAt])` çifte rezervasyonu engeller
    (`409 SLOT_TAKEN`); fiyat/süre istemciden asla kabul edilmez. İptal edilen bir
    randevunun saati v1'de yeniden satılabilir hale gelmez (bilinçli, backlog:
    `feature/appointment-reschedule`).
  - **(A) LiveKit konsültasyon odası (integration-agent):** gerçek `livekit-server-sdk`
    entegrasyonu — sahte/mock video arayüzü yazılmadı. Yapılandırma `STRIPE_SECRET_KEY`
    ile birebir aynı opsiyonel deseni izler: `LIVEKIT_URL`/`LIVEKIT_API_KEY`/
    `LIVEKIT_API_SECRET` boşsa `POST /appointments/{id}/meeting-token`
    `503 LIVEKIT_NOT_CONFIGURED` döner ve `/consultation/[id]` dürüst bir
    "yapılandırılmamış" durum paneli gösterir. Token grant kapsamı yalnızca
    `roomJoin: true, room: <meetingRoomName>`; katılımcı kimliği PII içermez; katılım
    yalnızca randevu penceresi içinde (`startsAt - 5dk … endsAt + 15dk`) mümkündür.
    Görüşme kaydı (Egress) bilinçli olarak kapsam dışı bırakıldı.
  - **(A) RBAC ve modül kapatma:** `telehealth` `MODULE_REGISTRY`'de
    **`defaultEnabled: false`** ile kayıtlı (dikey sektör modülü, `products`/`portfolio`
    gibi yatay yeteneklerden bilinçli olarak farklı). Modül kapalıyken **hem public hem
    admin** tele-sağlık uçları 404 döner — bu, admin uçlarının modül durumundan bağımsız
    çalıştığı genel platform deseninden (§10.9.1) hasta PII'si nedeniyle bilinçli bir
    sapmadır (security-agent denetiminde eksik bulunup düzeltildi, aşağıya bkz.).
    `/admin/telehealth/appointments` yalnızca ADMIN/MANAGER'a açıktır (EDITOR hariç).
  - **(A) KVKK:** compliance-agent onayı **engelleyiciydi** ve verildi — randevu formu
    yalnızca ad + e-posta toplar (semptom/şikâyet alanı yok, özel nitelikli veri reddi),
    açık rıza onay kutusu zorunlu, önerilen saklama politikası randevu bitiminden
    12 ay sonra hasta adı/e-postasının anonimleştirilmesi (satır silinmez). Acil durum
    uyarısı (*"Bu platform acil tıbbi durumlar için kullanılamaz."*) sitewide kalıcı bir
    şerit + randevu formunda ikinci kez gösterilir.
  - **(B) `telehealth-clinic` demo şablonu** ("Global TeleHealth & Clinic"): 6 uzmanlık +
    4 kurgusal doktor profili + haftalık müsaitlik takvimi oluşturur. **Örnek/sahte
    randevu üretmez** — `DemoTemplateDefinition.telehealth` şeklinde `appointments` diye
    bir alan hiç yoktur (yapısal garanti, [EPT]'deki sahte sipariş reddiyle aynı
    gerekçe + çıkarımsal sağlık verisi riski). Demo doktorların `isVerified` alanı
    daima `false`, `bio`'nun ilk cümlesi zorunlu bir demo uyarısı taşır. Modül
    varsayılan kapalı geldiği için şablon `requiredModules: ["telehealth"]` bildirir;
    `ImportDemoTemplateRequest.enableRequiredModules` (varsayılan `false`) açık
    opt-in'i olmadan modül otomatik açılmaz — kapalıyken import yine `201` döner ve
    `warnings[]` ile bilgilendirir. **Şablonun taşıyıcısı, diğer ikisiyle aynı şekilde,
    `.ts`'tir; `.json` reddedildi.** Şablonun şeması istenen JSON şekliyle birebir
    aynıdır, yalnızca taşıyıcısı TypeScript'tir — böylece bozuk bir şablon üretime
    değil, CI'ya düşer.
  - **Görsel:** ui-designer, mimarinin önerdiği ham `#0D9488`/`#0284C7` tonlarının
    WCAG AA'yı geçmediğini tespit edip `#0F766E`/`#0369A1`'e koyulaştırdı; slot düğmesi
    durumları (müsait/seçili/dolu/geçmiş), saat dilimi rozeti ve konsültasyon kontrol
    çubuğu bu paletle tanımlandı.
  - **Denetimde bulunup düzeltilen bulgular:** security-agent, modül kapalıyken
    `/admin/telehealth/*` uçlarının (hasta PII'si dahil) yanlışlıkla erişilebilir
    kaldığını ve `accessToken` karşılaştırmasının sabit zamanlı olmadığını tespit edip
    ikisini de düzeltti (`.claude/security-review-telehealth.md`). compliance-agent,
    randevu onay ekranındaki "e-postanıza kaydettik" ifadesinin gerçekleşmeyen bir
    işlemi anlatan yanıltıcı bir metin olduğunu bulup düzeltti
    (`.claude/compliance-notes-telehealth.md`).
  - Testler: backend 89/89 birim + entegrasyon testi (saat dilimi/DST, slot üretimi,
    rezervasyon yarışı, LiveKit token/IDOR, demo şablon içe aktarma) + 15 yeni
    Playwright e2e senaryosu (`telehealth-public-booking`, `telehealth-consultation`,
    `telehealth-rbac`, `telehealth-template-import`) geçiyor.

- **Sipariş yönetimi profesyonelleştirildi: askıya alma, hedefe göre daralan RBAC,
  düzenleme paneli, iptal e-postası ve sipariş bazlı aktivite günlüğü** (bağlayıcı
  karar dokümanı `.claude/architect-scope-order-management-pro.md`, `ARCHITECTURE.md`
  §10.9.3, `docs/architecture/openapi.yaml` `Orders` tag'i).
  - **Yeni durum — `ON_HOLD` ("Askıya Alındı"):** `OrderStatus` enumuna eklenen TEK
    yeni değer (mevcut 8 değer yeniden adlandırılmadı — geri alınamaz veri
    migration'ı + dış webhook tüketicilerinin sessizce kırılması riski). Yalnızca
    `PAID`'den ulaşılır; "Siparişi Onayla" butonu askıdaki bir siparişi yeniden
    `PAID` ("Hazırlanıyor") durumuna döndürür. Ödemesi alınmış bir sipariş artık
    tek adımda iptal edilemez — admin önce **Askıya Al**, sonra (para iade
    edilmediyse `confirmWithoutRefund` onay kutusuyla) **İptal Et** adımlarını
    izler; `ON_HOLD` ayrıca doğrudan iade edilebilir durumlar listesine eklendi.
  - **Hedefe göre daralan yetki:** sevkiyat işaretleme (`SHIPPED`/`FULFILLED`)
    ADMIN+MANAGER'da kalırken, istisnai/geri alınamaz eylemler (`ON_HOLD`/`PAID`/
    `CANCELLED` hedefli durum değişikliği ve yeni düzenleme ucu) **yalnızca ADMIN**'e
    daraltıldı. Yeni bir `SUPER_ADMIN` rolü İCAT EDİLMEDİ — mevcut 5 kademeli rol
    modeli (§10.21) korunarak "en üst yetki" isteği `ADMIN`'e eşlendi. Reddedilen
    denemeler `403` yanıtına ek olarak siparişe özel bir audit kaydına da düşer.
  - **Yeni uç — `PATCH /admin/orders/{orderId}`** (yalnızca ADMIN): müşteri
    e-posta/adı, teslimat/fatura adresi (tam nesne, kısmi yama yok) ve dahili
    `adminNotes` düzenlenebilir; sipariş `SHIPPED` sonrası iletişim/adres bilgisi
    artık değiştirilemez (409 — kargo etiketi fiilen kullanılmış olur). Sipariş
    kalemi (ürün/adet) düzenleme bilinçli olarak kapsam dışıdır — ürün tablosu
    panelde salt okunur kalır.
  - **Yeni uç — `GET /admin/orders/{orderId}/activity`** (ADMIN+MANAGER): mevcut
    denetim izinden (`AuditLog`) türeyen, sipariş bazlı bir olay akışı (durum
    değişikliği, düzenleme, iade, iptal e-postası). `ipAddress` bu uçtan asla
    dönmez.
  - **İptal e-postası:** yeni `EmailTemplatePurpose.ORDER_CANCELLATION` sistem
    şablonu — sipariş iptalinde (aksi belirtilmedikçe) müşteriye otomatik
    gönderilir; admin'in girdiği iptal nedeni e-postada aynen yer alır. Gönderim
    hatası sipariş güncellemesini asla bozmaz (best-effort, ayrıca denetlenir).
  - `AdminOrder` — `/admin/orders*` uçları artık `cancellationReason`/`adminNotes`
    içeren ayrı bir DTO döner; müşteri yüzeyi (`/users/me/orders*`) bu alanları
    ASLA görmez.
  - **Denetimde bulunup düzeltilen bulgular:** security-agent, aynı siparişe
    eşzamanlı gelen iki durum-değişikliği isteğinin (ör. onaylama + iptal) ikisinin
    de işlenebildiği bir race condition tespit etti; atomik "claim" deseniyle
    (mevcut iade ucuyla aynı desen) kapatıldı — yalnızca biri kazanır, diğeri 409
    alır. qa-agent, admin düzenleme formunun kaydet akışının fatura tipinden
    bağımsız her durumda 422 ile başarısız olduğu bir regresyonu buldu (form,
    kullanılmayan fatura alt-alanlarına `null` gönderiyordu; checkout formunun
    aksine anahtarı hiç omit etmiyordu) — form artık checkout ile aynı deseni
    kullanıyor, kayıt akışı çalışıyor. İki bulgu da yayına çıkmadan kapatıldı.
  - Testler: backend 1237, frontend 637 birim test + 8 yeni Playwright e2e
    senaryosu (askıya alma/onaylama, iptal + e-posta tetikleme, ödenmiş sipariş
    iptalinde para koruması, MANAGER yetkisizliği, düzenleme paneli kalıcılığı,
    aktivite günlüğünde `ipAddress` sızdırmaması) geçiyor.

- **`ecommerce-pro` demo şablonu + ürün varyasyonu/teknik döküman/kargo eşiği (storefront
  kalıcı genişlemesi)** (bağlayıcı karar dokümanı
  `.claude/architect-scope-ecommerce-pro-template.md`, `ARCHITECTURE.md` §10.9.2/§10.22).
  İki ayrı iş: (A) storefront'un kalıcı yetenek genişlemesi, (B) bunu sergileyen ikinci demo
  şablonu.
  - **(A) Ürün varyasyonu:** yeni `ProductVariant` tablosu (renk/beden gibi en fazla 2 eksen,
    eksen başına en fazla 12 değer, ürün başına en fazla 60 kombinasyon) + `Product.
    variantOptions` (eksen tanımı, JSON). Bir ürünün en az bir varyasyonu varsa stok/fiyat
    **varyasyondan** okunur, `Product.stockQuantity` o ürün için yok sayılır (`PATCH
    /admin/products/{id}/stock` varyasyonlu üründe artık `409`). Fiyat çözümlemesi tek yerde:
    `lib/product-pricing.ts::resolveUnitPriceCents` (miras/mutlak fiyat + indirim matrisi) —
    sepete ekleme, sepet DTO'su ve checkout'un taze okuması aynı fonksiyonu çağırıyor.
    `CartItem`/`OrderItem` artık `variantId` taşıyor; sepet benzersizliği `@@unique([cartId,
    productId, variantId])`'e genişledi (NULL-eşitsizlik zayıflaması uygulama katmanında —
    `(productId, variantId ?? null)` arama anahtarıyla — telafi edildi).
  - **(A) Teknik döküman (PDF):** yeni `ProductDocument` tablosu (`ProductImage` ile aynı
    sıralı join-tablo deseni). Medya boru hattı ilk kez PDF kabul ediyor: `%PDF-` magic byte
    tespiti (`lib/mime-detect.ts::detectUploadMimeType`), görsel bekleyen hiçbir FK slotunun
    (kapak/galeri/varyasyon görseli vb.) PDF kabul etmemesi (`422`), `/uploads/*`'ta
    görsel-olmayan dosyalar için `Content-Disposition: attachment` + `X-Content-Type-Options:
    nosniff`, `GET /admin/media?type=image|document` filtresi.
  - **(A) Kargo:** ayrı bir kural tablosu yerine `SiteSettings`'e iki alan —
    `shippingFlatFeeCents` (mağaza geneli sabit kargo bedeli, `null` = kargo hiç hesaplanmaz,
    mevcut davranış birebir korunur) + `freeShippingThresholdCents`. Tek hesaplama noktası
    `lib/shipping.ts::computeShipping`; sepet DTO'su, checkout ve yeni `Order.shippingCents`
    snapshot'ı aynı fonksiyonu kullanıyor. Kargo bedeli sepette gösteriliyorsa Stripe
    oturumuna ayrı bir satır olarak eklenip **tahsil ediliyor** (gösterilen ile tahsil edilen
    tutar her zaman birebir aynı).
  - **(B) `ecommerce-pro` demo şablonu** ("Modern Storefront / E-Ticaret", kurgusal mağaza
    "Ferah Ev Yaşam"): 4 kategori + 8 varyasyonlu/dökümanlı ürün + 4 yasal **yer tutucu**
    sayfa (KVKK Aydınlatma Metni, Mesafeli Satış Sözleşmesi, Ön Bilgilendirme Formu, İptal &
    İade Koşulları — gerçek hukuki metin İÇERMEZ, hukuk danışmanı onayı gerektiren açık uyarı
    metniyle işaretli) oluşturuyor. **Örnek/sahte sipariş üretilmiyor** (bilinçli ret —
    `Order` PII taşır, silinemez, muhasebe/ödeme değişmezlerini bozar); admin "Siparişler"
    ekranı import sonrası boş kalıyor. `DemoTemplateDefinition` yeni `commerce` (ürün/
    kategori/kargo verisi) ve `extraPages` (ana sayfa dışı sayfalar) alanlarıyla genişledi;
    yeni sayfa-blok token'ı `ref:product-category:<slug>`. Yeni tavanlar:
    `MAX_TEMPLATE_ASSETS=40`, `MAX_TEMPLATE_PRODUCTS=12`, `MAX_TEMPLATE_PRODUCT_VARIANTS=12`,
    `MAX_TEMPLATE_PRODUCT_DOCUMENTS=3`, `MAX_TEMPLATE_EXTRA_PAGES=8`.
  - Yeni admin arayüzü: ürün düzenleyicide varyasyon + döküman panelleri; PDP'de renk/beden
    seçici (URL'de durum, `?variant=<id>`), stok uyarısı ("Son N ürün!"), PDF indirme
    kartları; sepet çekmecesi (`cart-drawer`) ve ücretsiz kargoya kalan tutarı gösteren
    ilerleme çubuğu (`free-shipping-progress`) — para matematiği her zaman sunucudan gelir,
    frontend'de tekrarlanmaz.
  - Migration: `add_product_variants_documents_shipping` (salt-ekleme + tek kısıt değişimi).

- **Page Builder — Google Harita bloğu ve kurumsal blok genişletmeleri** (bağlayıcı karar
  dokümanları `.claude/architect-scope-google-map-corporate-blocks.md` ve
  `.claude/security-review-google-map-corporate-blocks.md`). Yeni `google-map` bloğu: hazır
  Google Maps "Harita yerleştir" embed URL'i (sıkı domain beyaz listesiyle doğrulanır) veya
  serbest adres metninden inşa edilen harita, 4 sabit `mapStyle` filtresi (standart/koyu/
  gümüş/retro), sıfır-CLS yükseklik rezervasyonu, `sandbox`/`referrerPolicy` ile sertleştirilmiş
  iframe. Ayrıca 5 mevcut blok geriye dönük uyumlu opsiyonel alanlarla genişletildi: `accordion`
  (`layoutStyle`, öğe başına `isOpenDefault`), `before-after-slider` (`initialSliderPosition`),
  `pricing-table` (`billingInterval` rozeti), `logo-marquee` (`displayMode: grid`, `grayscale`),
  `video` (`coverUrl` + lightbox oynatma stili + `loop`). FAQPage JSON-LD üretimi blok
  seviyesinden sayfa seviyesine taşındı (sayfa başına birden fazla SSS bloğu artık tek
  `FAQPage` script'inde birleşiyor, `noIndex` sayfalarda bastırılıyor); adresi olan harita
  blokları için opsiyonel `Place` yapılandırılmış verisi eklendi.

### Changed

- **Gelişmiş Slider — genişlik modu ve kısa kod/embed mekanizması** (bağlayıcı karar eki
  `.claude/architect-scope-advanced-slider.md` §9). "Gelişmiş Slider" özelliğine iki yeni
  yerleşim/dağıtım yeteneği eklendi:
  - **Genişlik modu (`Slider.widthMode`):** `Tam Genişlik` (varsayılan, mevcut kenardan
    kenara davranışla BİREBİR aynı, geriye dönük uyumluluk için hiç ek DOM üretmez) veya
    `Kutulu` (page-builder `container` bloğunun zaten onaylı "boxed" ölçüsünü — `max-width:
    1170px` + `px-4 sm:px-6` — yeniden kullanır). Hero Studio "Slider" sekmesinde "Yerleşim"
    grubundan ayarlanır.
  - **Kısa kod / embed (`[slider id="..."]`):** Hero Studio üst çubuğunda ve
    `/admin/sliders` liste satırlarında tek tıkla panoya kopyalanan bir kısa kod artık
    zengin metin (Tiptap) ve genel HTML bloklarına, ayrıca blog/portfolyo/ürün detay
    içeriklerine yapıştırılarak slider'ı canlı gömebiliyor — yeni bir backend ucu
    EKLENMEDİ (mevcut public `GET /sliders/{sliderId}` tüketiliyor), ikinci bir HTML
    sanitizasyon yolu AÇILMADI. Silme öncesi referans koruması (`409`) artık kısa kod
    referanslarını da görüyor (`SliderUsage.usageType: "block" | "shortcode"`).

- **Hero Studio — tam görsel katman/animasyon stüdyosuna genişletildi** (bağlayıcı karar eki
  `.claude/ui-designer-scope-advanced-slider.md` §7). "Gelişmiş Slider" özelliğinin bir önceki
  turda eklenen düzenleyicisini Slider Revolution düzeyine taşır:
  - **Katman Ekle çubuğu** artık tuvalin HEMEN ÜSTÜNDE, sağ panelden BAĞIMSIZ, daima görünür
    (Başlık/Metin/Buton/Görsel/Rozet); aynı çubukta 4 hizalama butonu (Sola Yasla, Yatayda
    Ortala, Sağa Yasla, Dikeyde Ortala) — seçili katmanın `origin`'inin yalnızca ilgili eksenini
    değiştirir, diğer eksen korunur.
  - **Tuval artık WYSIWYG**: katmanlar önceki "renkli etiket pili" yerine public render'la AYNI
    kaynaktan (yeni `lib/sliders/layer-render.ts`, `slide-layer.tsx` ile PAYLAŞILIR) gerçek
    stilli içerik olarak render edilir; seçili katmanda 4 köşe tutamacıyla (§5.2, sembolik
    "merkezden simetrik" mantıkla `widthPercent` yazar) yeniden boyutlandırma. Çift tıklama
    metin katmanlarını (başlık/metin/rozet/buton etiketi) yerinde düzenler (Enter/blur kaydeder,
    Escape iptal eder).
  - **Akıllı sağ panel**: bir katman seçilince müfettiş ANINDA "Katman" sekmesine, seçim
    kalkınca "Slayt" (arka plan) sekmesine döner — 4 sekme yapısı (Slayt/Katman/Animasyon/
    Slider) korunur. "Katman" sekmesine, tablet/mobil görünümünde, daha önce yalnızca tuvalde
    soluk bir gösterge olarak tüketilen cihaz-bazlı gizleme için ilk gerçek yazma kontrolü
    (`Eye`/`EyeOff` anahtarı) eklendi.
  - **Zaman çizelgesindeki "Oynat" artık tuvali de canlandırır** (önceki turda yalnızca
    çizelgenin kendi playhead'ini süpürüyordu, `HeroCanvas`'a bağlı DEĞİLDİ — bu tur
    düzeltildi): tıklanınca tuvaldeki her katman kendi `delayMs`/`durationMs`'i ile giriş
    animasyonuyla belirir, oynatma boyunca tuval düzenlemesi kilitlenir.
  - **Yeni giriş efekti — "Esnek Sıçrama" (`elastic-bounce`)**: `SliderLayerInEffect`
    enum'ına eklendi (Zod/TS/openapi.yaml üçü birden, JSON alanı olduğu için migration
    GEREKMEZ); seçildiğinde `easing` alanı ne olursa olsun yüksek "bounce" değerli bir
    `spring` transition'a zorlanır.
  - **Düzeltme:** Hero Studio üst çubuğunun gereksiz `position: sticky`'si (bu konteyner hiç
    kaymadığı için) akıştaki bir sonraki elemanla (bu turda eklenen Katman Ekle çubuğu dahil)
    aynı dikey bölgede boyanıp onu görünmez kılıyordu — `relative`'e çevrildi.

- **[MİMARİ KARAR — implementasyon devam ediyor] Rol modeli 3 kademeden 5 kademeye
  genişletildi** (`ARCHITECTURE.md` §10.21, bağlayıcı karar dokümanı
  `.claude/architect-scope-rbac-5-tier.md`). Yeni roller: **Süper Yönetici** (`ADMIN`),
  **Yönetici** (`MANAGER`), **Editör** (`EDITOR`), **Müşteri** (`CUSTOMER`), **Standart Üye**
  (`USER`). Bu turda yalnızca kontrat ve mimari dokümanlar güncellendi
  (`docs/architecture/openapi.yaml`, `docs/architecture/ARCHITECTURE.md`); şema, backend,
  frontend ve testler sıradaki ajanlarda tamamlanacak ve bu madde o zaman
  detaylandırılacaktır.
  - **BREAKING:** `İzleyici` (`VIEWER`) rolü kaldırıldı; mevcut hesapları `Standart Üye`
    (`USER`) olur ve **yönetim paneline erişimlerini tamamen kaybederler**. Panele ihtiyacı
    olan hesaplar bir Süper Yönetici tarafından elle yükseltilmelidir.
  - **BREAKING:** `Editör` rolünün kapsamı daraldı — artık yalnızca blog, medya ve sayfa
    içeriği. Ürünler, portföy, iletişim gönderimleri ve istatistiklere erişemez.
  - **BREAKING:** kullanıcı başına verilen `Gelişmiş Düzenleyici` yetkisi ve onu değiştiren
    `PATCH /admin/users/{userId}/builder-access` ucu kaldırıldı; sayfa blok yapısını artık
    yalnızca Süper Yönetici değiştirebilir.
  - **Güvenlik:** `/admin/*` altındaki tüm uçlar için tek bir panel kapısı eklendi — Müşteri
    ve Standart Üye hesapları 403 alır. Daha önce bazı yönetim okuma uçları yalnızca "giriş
    yapmış olmak" ile korunuyordu.
  - Yeni kayıtların varsayılan rolü `Standart Üye`; ilk siparişi ödendiğinde otomatik olarak
    `Müşteri`'ye yükselir. Yeni uç: `GET /users/me/orders` (kendi sipariş geçmişi).

- **Standart kullanıcı için sayfa düzenleme kilidi sıkılaştırıldı** (`ARCHITECTURE.md`
  §10.20, güncelleme notu 2026-08-23). Daha önce **Yazar (Standart Düzenleyici)** yetkisine
  sahip bir kullanıcı, yalnızca **Şablon** (`TEMPLATE`) modundaki sayfalarda yapısal
  değişiklik yapamıyordu; **Serbest Tasarım** (`FREEFORM`) modundaki sayfalarda konteyner
  ekleme/silme gibi yapısal işlemlere hâlâ erişebiliyordu. Artık bu kısıt sayfanın moduna
  bakılmaksızın geçerli: standart kullanıcı hangi sayfada olursa olsun yalnızca başlık/zengin
  metin/görsel/buton gibi içerik alanlarını düzenleyebilir, `BuilderCanvas`'a (sürükle-bırak
  tuvaline) hiç erişemez — yapısal bir değişiklik denenirse (autosave dahil) sunucu **403**
  ile reddeder.
  - **Serbest Tasarım/Şablon** ayrımının kendisi kaldırılmadı; `editMode` alanı artık yalnızca
    gelişmiş yetenekli kullanıcılara gösterilen kozmetik bir bilgi rozetidir, herhangi bir
    yetkilendirme kararını etkilemez.

### Added

- **feat(demo-templates): 1 tıkla hazır demo şablon içe aktarıcı eklendi** (`demo-templates`
  modülü, `ARCHITECTURE.md` §10.22, bağlayıcı karar dokümanı
  `.claude/architect-scope-demo-template-import.md`). Bir ADMIN, tek bir onaylı istekle
  sitenin görünümünü, ayarlarını, navigasyon/footer/sosyal linklerini, örnek bir portföyü, bir
  Hero Studio slider'ını ve bir anasayfayı hazır bir demo içerikle doldurabiliyor.
  - **İlk şablon:** `modern-architecture` ("Modern Mimarlık & İnşaat", kurgusal firma
    "Kütle Yapı") — tek istekte `SiteAppearance`, `SiteSettings` (5 alan), `NavigationItem`,
    `FooterColumn`/`FooterLink`, `SocialLink`, `PortfolioCategory`/`PortfolioItem`,
    `Slider`/`Slide` ve tek bir anasayfa `Page` oluşturuyor; 6 gerçek `Media` kaydı paket PNG
    varlıklarından materyalize ediliyor (medya kütüphanesinden değiştirilebilir).
  - Yeni uçlar: `GET /admin/demo-templates` (panel erişimi: ADMIN/MANAGER/EDITOR) ve
    `POST /admin/demo-templates/{templateKey}/import` (yalnızca ADMIN, 5 istek/dk hız sınırı,
    gövdede `confirm: true` zorunlu, `force` ile idempotent yeniden-uygulama — önceki içerik
    silinmez, additive kayıtlar ikinci bir kopya olarak eklenir).
  - İşlem iki fazlıdır: dosya/varlık materyalizasyonu transaction DIŞINDA yapılır, ardından
    tek bir Prisma transaction'ında (`timeout: 30_000`) DB'ye yazılır; transaction hata
    verirse Faz 1'de yazılan dosyalar best-effort geri alınır (telafi).
  - Yeni model `DemoTemplateImport` (migration `add_demo_template_imports`) yalnızca
    idempotency işaretini tutar, içerik taşımaz.
  - Yeni admin ekranı `/admin/demo-templates` (şablon galerisi, onay diyaloğu, yıkıcılık
    matrisi uyarısı).
  - Telif/KVKK: gerçek firma/logo/fotoğraf kullanılmadı; tüm görseller depoda üretilen soyut
    PNG'ler, iletişim bilgileri RFC-rezerve/jenerik yer tutucular (`info@example.com`,
    `+90 212 000 00 00`, jenerik adres); şablon PII taşımaz.

- **Gelişmiş Slider / Hero Studio** (`sliders` modülü, bağlayıcı karar dokümanları
  `.claude/architect-scope-advanced-slider.md` ve `.claude/ui-designer-scope-advanced-slider.md`).
  Slider Revolution benzeri, çok katmanlı, cihaza göre geçersiz kılınabilen bir hero/slider
  düzenleyicisi.
  - **Yeni model:** `Slider` + `Slide` (ilişkisel) + `Slide.layers` (JSON, en fazla 20 katman /
    64 KB) — slider bir "içerik" DEĞİL, sayfalara `advanced-slider` bloğuyla REFERANS verilen
    yeniden kullanılabilir bir bileşen; kendi `status`/yayın alanı yok, yayın kararı gömen
    sayfaya ait. `ContentEntityType` enum'ına değer EKLENMEDİ.
  - Katman tipleri: başlık, metin, buton, görsel, rozet — her biri yüzde + 9'lu hizalama
    noktası (`origin`) ile konumlanır; **masaüstü kanoniktir**, tablet/mobil yalnızca
    değişen alan grubunu basamaklı olarak geçersiz kılar (`content` override edilemez).
  - Yeni admin ekranı `/admin/sliders/[id]` (Hero Studio): sürüklenebilir tuval, slayt şeridi,
    sekmeli müfettiş (Slayt/Katman/Animasyon/Slider), `delayMs`/`durationMs` zaman çizelgesi.
  - Ön yüz render motoru mevcut `framer-motion` üzerine kuruldu (Swiper.js gibi yeni bir
    bağımlılık EKLENMEDİ) — sıfır CLS (`100svh`/`aspect-ratio` sunucu HTML'inde belirli),
    `prefers-reduced-motion: reduce` altında otomatik oynatma/Ken Burns/geçiş efektleri kapanır.
  - `SafeHrefSchema`/`isSafeHref` `pages.schemas.ts`'ten `schemas/common.ts`'e taşınıp
    ortaklaştırıldı (davranış değişikliği yok); slider katmanlarının `href`/`linkHref`/
    `bgVideoUrl` alanları aynı protokol beyaz listesini kullanır.
  - Yetki: okuma (`GET /admin/sliders*`) ADMIN/MANAGER/**EDITOR**, yazma yalnızca
    ADMIN/MANAGER; public `GET /sliders/{sliderId}` kimlik doğrulama gerektirmez.
  - Silme öncesi referans koruması: kullanılan bir slider `409` + kullanan sayfa listesi
    döner, `?force=true` ile geçilebilir.

- **Sayfa yönetiminde standart/gelişmiş düzenleyici mod ayrımı** (`ARCHITECTURE.md` §10.20,
  bağlayıcı karar dokümanı `.claude/architect-scope-page-editor-roles.md`). Sayfalar artık
  **Serbest Tasarım** (`FREEFORM`, mevcut davranış, varsayılan) veya **Şablon** (`TEMPLATE`)
  modunda olabilir; şablon modundaki bir sayfada **Yazar (Standart Düzenleyici)** yetkisine
  sahip bir kullanıcı yalnızca başlık/zengin metin/görsel/buton gibi içerik alanlarını
  doldurabilir — konteyner ekleme/silme, düzen, CSS, giriş efekti ve özel HTML tamamen
  kapalıdır; yapısal bir değişiklik denenirse (autosave dahil) sunucu **403** ile reddeder.
  - `SiteRole` enum'ına yeni bir değer EKLENMEDİ. Bunun yerine kullanıcı başına
    `advancedBuilderEnabled` yetenek bayrağı eklendi; etkin yetki
    `canUseAdvancedBuilder = role === "ADMIN" || advancedBuilderEnabled` olarak sunucu
    tarafında türetiliyor (ADMIN her zaman gelişmiş — kilitlenmeyi önlemek için).
  - Yeni uç: `PATCH /admin/users/{userId}/builder-access` (yalnızca ADMIN) — `/admin/users`
    sayfasına "Yetenek" sütunu eklendi.
  - `POST /admin/pages`, sayfa silme/geri yükleme, toplu işlemler ve revizyon geri yükleme
    artık gelişmiş yetenek gerektiriyor (`requireAdvancedBuilder`); `PATCH`/autosave uçları
    açık kalıyor ama gövde, kayıtlı sayfa ağacıyla düğüm-düğüm karşılaştırılarak (iteratif
    diff) alan seviyesinde denetleniyor.
  - Standart kullanıcı için ayrı, sadeleştirilmiş bir düzenleyici görünümü eklendi (form +
    salt-okunur canlı önizleme); sürükle-bırak, katman paneli ve konteyner ayar çekmecesi bu
    modda hiç render edilmiyor.
  - Migration `20260822154259_add_page_editor_roles`: mevcut ADMIN/EDITOR hesaplarının
    yetkisi backfill ile korundu, davranış geriye dönük değişmedi.

- **Page-builder — "Pazarlama & Sosyal Kanıt" blok kategorisi (Faz 3)**: CTA Box, Sayaç/
  İstatistik, Müşteri Yorumları, Fiyatlandırma Tablosu.
  - **CTA zenginleştirmesi** (`cta` bloğu, mevcut alanlar DEĞİŞMEDİ): opsiyonel açıklama,
    hizalama, 4 hazır görünüm (`plain`/`soft`/`solid`/`outline`) ve opsiyonel ikincil buton.
    Bu blok bu turda İLK KEZ backend'de Zod ile doğrulanıyor (daha önce `hero`/`text`/
    `featured-*` gibi doğrulanmadan geçiyordu).
  - **Sayaç / İstatistik** (`counter`, en fazla 8 öğe): önek/sonek + `Intl.NumberFormat("tr-TR")`
    ile biçimlendirilmiş değer + etiket.
  - **Müşteri Yorumları** (`testimonial`, en fazla 12 öğe): yorum metni, yazar adı/unvanı,
    opsiyonel fotoğraf (yoksa baş harf rozetine düşer) ve 1-5 yıldız puan.
  - **Fiyatlandırma Tablosu** (`pricing-table`, en fazla 6 plan, plan başına en fazla 15
    özellik): plan adı, serbest metin fiyat (`"Ücretsiz"`/`"Bize Sorun"` gibi biçimler de
    geçerli), özellik listesi, "öne çıkan plan" rozeti, buton.
  - Tüm `href`/görsel URL alanları (`buttonHref`, `secondaryButtonHref`, `avatarUrl`,
    `pricing.buttonHref`) `SafeHrefSchema` ile doğrulanır — konteyner arka plan URL'iyle AYNI
    protokol beyaz listesi (`javascript:`/`vbscript:`/`data:` YASAK).

- **Page-builder — "Dinamik & CMS" blok kategorisi (Faz 4)**: Son Blog Yazıları, İletişim
  Formu, Özel HTML / Kod.
  - **Son Blog Yazıları** (`latest-posts`, en fazla 12 yazı): kategori/etiket filtresi (AND
    mantığı), yazı sayısı, `publishedAt` DESC sıralama, mevcut `BlogCard` grid kart düzeni.
  - **İletişim Formu** (`contact-form`): kendi alan şemasını TAŞIMAZ — site genelindeki TEK
    `ContactForm` singleton'ını (`/admin/contact`'ta yönetilen ad/e-posta/mesaj alanları, KVKK
    onayı, honeypot, bildirim e-postası) sayfanın istenen noktasına gömer; yalnızca formun
    kendi başlığını gösterme/gizleme seçeneği taşır.
  - **Özel HTML / Kod** (`custom-html`, en fazla 20.000 karakter): harici widget/harita
    gömme için `iframe` içeren sanitize edilmiş bir kod alanı.
    - **Güvenlik**: `lib/html-sanitize.ts::sanitizeCustomHtmlBlock` — `text` bloğunun
      sanitizer'ından AYRI, DAHA GENİŞ bir izin listesi (`iframe` eklenir), ama
      `script`/`style`/`object`/`embed`/`form` HİÇBİR KOŞULDA izin listesine ALINMAZ.
      `iframe.src` yalnızca `http(s)` (`javascript:`/`data:` YASAK); `sandbox` özniteliği
      kullanıcı girdisinden BAĞIMSIZ, sabit güvenli bir değere ZORLANIR (`allow-same-origin`/
      `allow-top-navigation` HARİÇ tutulur). `modules/pages/lib/sanitize-blocks.ts`
      (container/columns içi bloklar dahil, önceki bir stored-XSS bulgusunun tekrarlanmaması
      için özyinelemeli) DB'ye yazılmadan HEMEN ÖNCE bunu uygular; frontend yalnızca yazma-
      anında zaten temizlenmiş HTML'i render eder (`text` bloğuyla AYNI "tek temizleme yolu"
      deseni).

- **Page-builder — konteyner arka plan geliştirmeleri + 4 yeni görsel widget**.
  - **Konteyner arka planı**: Gradient (doğrusal/dairesel, 2 renk + 8 sabit yön veya özel açı),
    Animasyonlu (Floating/Gradient Wave — saf CSS `background-position` döngüsü; Subtle Dots/
    Grid — statik CSS desen) ve mevcut Görsel arka planına opaklığı ayarlanabilir Overlay
    (kaplama). Tümü tek bir `style` nesnesiyle ifade edilir (ek DOM öğesi YOK); tüm yeni renk
    alanları `#rrggbb` (6 hane) regex ile doğrulanır, yön/varyant HAM CSS DEĞİL sabit bir
    tablodan gelir.
  - **Öncesi / Sonrası Karşılaştırma** (`before-after-slider`): iki görsel + `clip-path` ile
    kırpılan, fare/dokunma (Pointer Events) VE ok tuşlarıyla sürüklenebilir bir tutamaç
    (yatay/dikey), harici kütüphane kullanılmadan.
  - **Logo Bandı** (`logo-marquee`, en fazla 20 logo): kesintisiz akan (marquee) yatay şerit —
    içerik İKİ KEZ render edilip tam yarı genişlik kadar kaydırılarak dikişsiz döngü elde
    edilir (ikinci kopya `aria-hidden`); hız ve "üzerine gelince durdur" ayarı.
  - **İlerleme Çubuğu & Yetenekler** (`skill-bar`, en fazla 12 öğe): başlık, yüzde (0-100),
    opsiyonel çubuk rengi, sayfa yüklenince BİR KEZ çalışan saf CSS dolma animasyonu.
  - **Ekip Üyesi Kartı** (`team`, en fazla 12 üye, üye başına en fazla 5 sosyal bağlantı):
    fotoğraf (yoksa baş harf rozeti), ad, unvan, biyografi, sosyal medya bağlantıları —
    `SocialPlatform` (site footer'ının "sosyal hesap linkleri" ile AYNI kapalı platform kümesi,
    `lib/social-platform-icons.ts` artık İKİSİ ARASINDA PAYLAŞILAN tek kaynak).
  - Tüm animasyonlar (`globals.css`) `prefers-reduced-motion: reduce` ile devre dışı kalır;
    harici animasyon/kaydırma kütüphanesi eklenmedi.

- **E-posta şablonu blok editörü** (`docs/architecture/ARCHITECTURE.md` §10.16). Admin artık
  ham HTML yazmadan, sürükle-bırak bloklarla (logo/başlık, metin, buton, görsel, ayırıcı,
  footer) e-posta şablonu tasarlayabiliyor. HTML **her zaman sunucuda** üretilir
  (`backend/src/lib/email-renderer.ts`) — istemci yalnızca yapısal `blocks` verisi gönderir.
  - Sistem değişkenleri (`{{user_name}}`, `{{reset_link}}` vb.) + şablon başına en fazla 20
    kullanıcı tanımlı özel değişken. Değişken listesi `GET
    /admin/notifications/templates/variables` ile registry'den (`lib/email-variables.ts`)
    okunur, frontend'de hardcode edilmez.
  - Durumsuz canlı önizleme: `POST /admin/notifications/templates/preview` (kaydetmeden
    render), `iframe sandbox` içinde gösterilir.
  - Kaydedilmiş şablonu admin'in kendi adresine test gönderimi: `POST
    /admin/notifications/templates/{templateId}/test-send` (`to` alanı YOKTUR — alıcı her
    zaman isteği yapan kullanıcı; spam-relay riskine karşı bilinçli bir kısıt).
  - Şablon kopyalama: `POST /admin/notifications/templates/{templateId}/duplicate`.
  - **BREAKING (dahili):** şablon adresleme `{key}`'den `{templateId}` (uuid)'e geçti —
    kullanıcı şablonlarının `key`'i yoktur. Bkz. "Changed" bölümü.
- **İletişim formu** (§10.16.7–10.16.9). Tek (singleton) yapılandırılabilir form + alan
  yönetimi + gönderim kutusu ("Gelen Kutusu").
  - Admin: `GET/PATCH /admin/contact/form`, `PUT /admin/contact/form/fields`, `GET
    /admin/contact/submissions`, `GET/PATCH/DELETE
    /admin/contact/submissions/{submissionId}`.
  - Public: `GET /contact/form`, `POST /contact/submissions` (kimlik doğrulama gerektirmez).
  - Gönderimler önce **veritabanına yazılır**, bildirim e-postası bundan türetilir — SMTP
    arızası ziyaretçinin mesajını kaybettirmez (yanıt yine `201`, hata `notificationError`
    alanında iz bırakır).
  - KVKK: onay metni anlık görüntüsü (`consentTextSnapshot`), 30 gün sonra IP/User-Agent
    redaksiyonu, yapılandırılabilir saklama süresi (`retentionDays`, varsayılan 180 gün).
  - Kötüye kullanım koruması: honeypot alanı (`website`) + IP bazlı rate limit (5/dakika).
    Bkz. "Known limitations" (CAPTCHA yok).
- **feat(pages): Sayfa içerik bloklarında hiyerarşik konteyner (Container) mimarisi (v3)**
  (§10.19 — `Page` içeriğinin blok/düzen modelinin Elementor/Gutenberg tarzı bir "Container"
  ağacına dönüşümü, önceki turdaki v2 "Grid/Kolon düzeni"ni **supersede eder**, bkz. aşağıdaki
  eski madde ve `ARCHITECTURE.md` §10.17 başlığındaki "v3 ile SUPERSEDE edildi" notu). Yalnızca
  `Page` içeriği için (Blog kapsam dışı — blog içeriği hâlâ `contentHtml` TipTap zengin
  metnidir).
  - Kanonik tek düğüm tipi **`container`**: kendi başına görsel bir varlıktır — `layout`
    (boxed/full-width + 320–1920px özel genişlik, varsayılan 1170), `minHeight`
    (`{value, unit: "px"|"vh"}`), flexbox `direction`/`justifyContent`/`alignItems`/`gap`,
    4-kenar `padding`/`margin` (0–200px, negatif YASAK), `background` (yok/renk/görsel).
    Konteynerler **keyfi derinlikte** (`MAX_CONTAINER_DEPTH = 4`, kök=1) iç içe geçebilir ve
    **`hero` dahil HERHANGİ bir içerik bloğunu** barındırabilir (v2'nin "sütun içine
    sütun/hero konulamaz" derinlik-1 kısıtı kaldırıldı).
  - Editörde **Layout Picker**: 7 hazır ızgara ön ayarı (Tam Genişlik, 50/50, 33/66, 66/33,
    33/33/33, 25/50/25, 25/25/25/25) — boş bir konteyner ekleyip doldurmak artık birincil akış
    (önceki turun "columns palette'e eklenmez" kararı geçersiz kılındı). Mevcut bir bloğu tek
    hamlede konteynere sarma ("Konteynere Sar") ve konteyner kaldırma (unwrap, veri kaybı
    tuzağı koruması + onay diyaloğu AYNEN KORUNDU) da mevcuttur.
  - `Page.blocks` KÖK şekli DEĞİŞMEDİ (hâlâ bir dizi — kök = "örtük root container",
    ayarları serileştirilmez); bir tek kök `Container` nesnesine geçiş bilinçli olarak
    REDDEDİLDİ (kırıcı olurdu).
  - Sayısal sınırlar yükseltildi: sayfa başına toplam düğüm **200 → 300**, konteyner başına
    çocuk **24** (v2'nin 20/24 ikilisinin birleşimi), YENİ **256 KB** gövde-boyutu tavanı.
    Doğrulama sırası (iteratif yapı taraması → byte tavanı → şema parse'ı) bağlayıcıdır — 10
    binlerce seviye derin bir payload artık `RangeError` fırlatmadan temiz `422` döner.
  - Geriye dönük uyumluluk (DB migration **YOK**): `type: "columns"` (v1/v2) yeni kod
    tarafından ASLA üretilmez ama okunmaya/kabul edilmeye devam eder — bir `WRITE`
    isteğinde sessizce kanonik `container`'a çevrilir (görsel oran/genişlik/hizalama piksel-
    piksel korunur), 422 VERİLMEZ. Okuma tarafında (`GET`, ham JSON) frontend
    `normalizePageNodes()` aynı çevrimi uygular.
  - `docs/architecture/openapi.yaml`: YENİ `PageContainerNode`/`PageContainerSettings`/
    `PageContainerSpacing`/`PageContainerBackground` şemaları; `PageColumnsBlockData`
    `deprecated: true` işaretlendi; `CreatePageRequest`/`UpdatePageRequest`/
    `AutosavePageRequest.blocks` `maxItems: 200 → 300`.

<details>
<summary>Önceki tur (v2, artık supersede edildi) — orijinal changelog kaydı, tarihsel referans</summary>

- **Sayfa editöründe Grid/Kolon düzeni** (§10.17). Yalnızca `Page` içeriği için (Blog
  kapsam dışı — blog içeriği hâlâ `contentHtml` TipTap zengin metnidir). Herhangi bir bloğu
  2 sütuna sarmalama; satırın kendi "+" butonuyla **sınırsız** (pratikte `MAX_COLUMNS_PER_ROW`
  = 24, salt DoS koruması) sayıda sütuna büyütme — sabit bir 2/3 seçici veya oran enum'u
  (`1-1`/`2-1`/`1-2`/`1-1-1`) YOKTUR, her sütun kendi göreli genişlik ağırlığını (`width`,
  varsayılan 1 = eşit pay) taşır ve yapısal değişikliklerde (sütun ekle/kaldır) otomatik
  eşitlenir; ayrıca manuel ince ayar (per-sütun genişlik step control) mümkündür. Bir sütunu
  boşaltan blok silme işlemi o sütunu otomatik kaldırıp kalanları dengeler (satırdaki BAŞKA,
  önceden zaten boş sütunlara dokunmadan); tek sütuna düşen satır otomatik Tam Genişliğe
  döner. 6+ sütunlu bir satırda engellemeyen bir okunabilirlik uyarısı gösterilir. Sütun başı
  boşluk (`gap`) ve dikey hizalama (`verticalAlign`) korunur. Mobilde otomatik alt alta düşme
  (`flex-col` tabanı, `md:`de `grid`e geçiş — saklı bir "mobilde yığıl" veri alanı YOKTUR, saf
  CSS). Derinlik en fazla 1 (bir sütunun içine sütun/hero konulamaz, 422).
  - Yeni `PageBlock` tipi: `columns` (bkz. `openapi.yaml::PageColumnsBlockData`).
  - db-agent tarafında migration **YOK** (`Page.blocks` zaten serbest `Json` alanı).
  - Geriye dönük uyumluluk: bu özelliğin ilk (v1, sabit `columnCount`/`ratio`) sürümüyle
    kaydedilmiş sayfalar bir sonraki WRITE'ta sessizce yeni şekle çevrilir (görsel oran
    korunur) — bkz. `ARCHITECTURE.md` §10.17.8.

</details>
- **Admin kullanıcı yönetimi: yumuşak silme (soft-delete) ve geri yükleme.** `/admin/users`
  altında iki yeni uç eklendi (bkz. `openapi.yaml` `AdminUsers` tag'i):
  - `DELETE /admin/users/{userId}`: kullanıcıyı fiziksel olarak SİLMEZ — `status: DELETED`
    yapar, `deletedAt` damgalar. Tek bir Serializable transaction içinde: kullanıcının TÜM
    `RefreshToken`'ları iptal edilir (aktif oturumlar anında düşer), bekleyen TÜM
    `PasswordResetToken`'ları geçersizleşir, `AuditLog`'a `user.delete` yazılır. İçerik/medya/
    organizasyon yazarlık kayıtları DEĞİŞTİRİLMEZ. Fiziksel silme yerine yumuşak silme tercih
    edildi çünkü `Organization.ownerId` zorunlu bir ilişkidir (Prisma varsayılanı `Restrict`)
    ve `BlogPost`/`Page`/`Product`/`PortfolioItem`/`AuditLog` yazarlık alanları
    `onDelete: SetNull`'dır.
  - `POST /admin/users/{userId}/restore`: `DELETED` kullanıcıyı `status: ACTIVE`'e döndürür,
    `deletedAt`'i `null`'a çeker, rolü silme öncesi değeriyle korur. Bilinçli olarak jenerik
    `PATCH /status` üzerinden DEĞİL ayrı bir uç — kendi denetim aksiyonunu (`user.restore`)
    alır ve `PATCH /status` gövdesi `ACTIVE|SUSPENDED` ile sınırlı kalır. İptal edilen
    refresh token'lar geri GELMEZ; kullanıcı yeniden giriş yapmalıdır.
  - Korumalar (mevcut `PATCH /role`/`PATCH /status` kurallarıyla tutarlı): kendi hesabını
    silme engeli (`409`, "Kendi hesabınızı silemezsiniz."), son aktif admin koruması (`409`,
    "Sistemde en az bir yönetici kalmalı.", `assertNotLastActiveAdmin`, TOCTOU'ya karşı silme
    yazımıyla aynı transaction içinde kontrol edilir).
  - `GET /admin/users` artık `includeDeleted` query param'ı destekliyor (varsayılan `false`)
    — silinmiş kullanıcılar varsayılan listede GÖRÜNMEZ, admin panelini doldurmaz ama kayıt
    geri alınabilir kalır.
  - Frontend: kullanıcılar sayfasına "Sil"/"Geri Yükle" aksiyonları, "Silinen kullanıcıları
    göster" toggle'ı, onay diyalogları eklendi.
  - **KVKK/GDPR sınırı — bkz. "Known limitations".** Bu bir **yönetimsel silme**dir, KVKK
    m.11/GDPR Art. 17 unutulma hakkını KARŞILAMAZ.

### Changed

- `sendTemplateEmail(app, key, …)` imzası `sendTemplateEmail(app, purpose, …)` oldu —
  gönderim artık şablon anahtarına değil **amaca** (`EmailTemplatePurpose`) göre çözülür.
  `purpose ≠ CUSTOM` amaçlarda aynı anda en fazla bir şablon aktif olabilir (DB seviyesinde
  kısmi unique index ile de zorlanır).
- E-posta şablonu uçları `{key}` yerine `{templateId}` (uuid) ile adresleniyor
  (`frontend/src/lib/api/email-templates.ts`, `app/admin/notifications/templates/[templateId]/`).
  `EmailTemplateKey` union tipi kaldırıldı.
- `modules/pages/lib/sanitize-blocks.ts::sanitizePageBlocks` artık özyinelemeli — sütun
  içindeki `text` bloklarını da temizliyor (önceden yalnızca üst seviyeyi geziyordu; bu bir
  güvenlik düzeltmesiydi, bkz. "Fixed").
- `lib/seo-score.ts` sütun içine taşınan görsel/metni de SEO tamlık skoruna dahil ediyor
  (`flattenPageBlocks` üzerinden).
- **(v3, §10.19)** `backend/src/lib/page-blocks.ts::flattenPageBlocks` özyinelemeliden
  **iteratife** (explicit stack) çevrildi — imzası DEĞİŞMEDİ (`seo-score.ts` tüketicisi
  korunur), artık `container.children`'ı da (konteyner derinliğinden bağımsız) düzleştiriyor.
  YENİ `scanPageNodeStructure` (iteratif yapı tarayıcısı) eklendi — derinlik/toplam-düğüm/
  konteyner-başına-çocuk sınırlarını zod'un özyinelemeli parse'ından ÖNCE, stack-safe şekilde
  ölçer/reddeder.
- **(v3, §10.19)** `pages.schemas.ts::refineTotalBlockCount` kaldırıldı — toplam düğüm
  kontrolü artık tek giriş noktalı `PageBlockListSchema` içinde, doğru sırada
  (`scanPageNodeStructure` → byte tavanı → şema parse'ı) yapılıyor.
- **(v3, §10.19)** `frontend/src/lib/page-builder/columns.ts` silindi — ağaç işlemleri YENİ
  `containers.ts`'e, legacy okuma dönüşümü YENİ `normalize.ts::normalizePageNodes()`'e
  taşındı. `wrapInColumns`/`unwrapColumns` → `wrapInContainer`/`unwrapContainer` (veri kaybı
  tuzağı koruması AYNEN KORUNDU). `components/site/blocks/columns-block.tsx` silindi, yerine
  `container-block.tsx` geldi.
- Şema: `SiteUserStatus` enum'una `DELETED` eklendi, `User.deletedAt` (nullable) alanı
  eklendi — migration `20260818074116_add_user_soft_delete` (db-agent).

### Fixed

- **[security]** Sütun (`columns`) bloğu içine konan `text` bloklarının `data.html`'i
  sanitize'den geçmeden DB'ye yazılabiliyordu → public sayfada stored XSS riski.
  `sanitizePageBlocks` bir seviye özyinelemeli hale getirildi (security-agent).
- **[security] (v3, §10.19)** Hiyerarşik `container` mimarisine geçişte AYNI stored-XSS
  sınıfının `container.children` üzerinden YENİDEN AÇILMAMASI için `sanitizePageBlocks`'a
  ayrı bir özyineleme dalı eklendi (legacy `columns` dalı AYNEN KORUNDU — eski
  `PageRevision` snapshot'ları hâlâ o şekilde olabilir); ayrıca snapshot'lar yeni şemadan
  hiç geçmediği için bağımsız bir `depth-cutoff` (`MAX_CONTAINER_DEPTH + 2`) eklendi
  (security-agent onayı, ön ve son denetim).
- **[security] (v3, §10.19)** İlk tasarım taslağında `blocks` doğrulama sırası
  (`JSON.stringify` byte tavanı → iteratif yapı taraması) `JSON.stringify`'ın V8'de
  özyinelemeli olması nedeniyle kendi kendini baltalayan bir stack-overflow DoS vektörü
  içeriyordu; sıra `scanPageNodeStructure` (iteratif) → byte tavanı olacak şekilde
  düzeltildi ve `JSON.stringify` `try/catch`'e alındı (security-agent ön denetimi).
- **[security] (v3, §10.19)** `container.settings.background` (görsel URL) doğrulaması
  yalnızca bir karakter kara listesiyle (`%` URL-encoding'i ile atlatılabilir) sınırlıydı;
  bir protokol BEYAZ LİSTESİ eklendi — yalnızca `/` (relative) veya `https://`/`http://`
  kabul edilir, `javascript:`/`vbscript:`/`data:` şemaları açıkça reddedilir
  (security-agent ön denetimi).
- **[security]** E-posta HTML'i, blog/sayfa için kullanılan geniş allow-list
  (`sanitizeRichHtml`) yerine e-postaya özel, daha dar bir allow-list
  (`sanitizeEmailRichText` — `style`/`class`/`id` YOK) ile temizleniyor; satır-içi stiller
  yalnızca doğrulanmış token'lardan (renk regex'i, boşluk/hizalama enum'ları) üretiliyor,
  kullanıcı ham CSS yazamıyor (security-agent).
- **[security]** `button.href` ve benzeri değişken kabul eden alanlarda `javascript:`/`data:`
  şemaları reddediliyor; değişken kalıbı (`{{var}}`) ile karışık serbest metin 422 ile
  engelleniyor (security-agent).
- **[security]** İletişim formu gönderiminde ziyaretçinin girdiği `email` hiçbir zaman SMTP
  `to`/`from`/`Reply-To` başlığına yazılmıyor (başlık enjeksiyonu önleniyor) — yalnızca
  gövdede HTML-escape edilerek değişken olarak basılıyor (security-agent).
- **[security]** `POST /admin/notifications/templates/preview` ve `test-send` uçlarına
  route seviyesinde rate limit eklendi (önceden yalnızca genel/global limit vardı;
  security-agent denetimi).
- **[security]** `middleware/authenticate.ts` ve `auth.service.ts`'deki login/refresh
  akışları artık `status: DELETED` kullanıcıları da `SUSPENDED` ile birebir aynı şekilde
  reddediyor — aksi hâlde soft-delete edilmiş bir kullanıcı, mevcut access token'ının ömrü
  boyunca (15 dk) sistemi kullanmaya devam edebilirdi (security-agent denetimi).
- **[security]** `PATCH /admin/users/{userId}/role`, hedef kullanıcı `DELETED` durumundaysa
  artık `404` döndürüyor — önceden bu kontrolü **es geçiyordu** ve `PATCH /status`'ten
  tutarsızdı; soft-delete edilmiş, varsayılan listede görünmeyen bir hesabın rolü sessizce
  değiştirilip `POST /restore` ile geri alındığında fark edilmeyen bir ayrıcalık
  değişikliğiyle geri dönebiliyordu (security-agent denetimi).
- **[compliance]** Otomatik eklenen KVKK footer'ındaki hukuki sayfa bağlantıları
  düzeltildi — yayınlanan (`PUBLISHED`, silinmemiş) `isLegalDocument=true` sayfaların
  tamamı doğru, mutlak URL ile listeleniyor (compliance-agent).
- **[usability]** `purpose = CUSTOM` bir e-posta şablonu bir kez aktifleştirildikten sonra
  hiçbir uçla deaktive/silinemiyordu (`DELETE` `isActive=true` iken koşulsuz 409
  döndürüyordu, `PATCH` `isActive` alanını kabul etmiyordu — qa-agent bulgusu,
  2026-08-17). `PATCH /admin/notifications/templates/{templateId}` artık **yalnızca
  `purpose=CUSTOM` şablonlarda** `isActive` alanını kabul ediyor (`purpose != CUSTOM`
  şablonlarda aktiflik hâlâ yalnızca `/activate`'in transaction'ıyla değişir, teklik
  kuralı bozulmaz).
- dnd-kit çok konteynerli sürükle-bırak: boş/kısa sütunlarda `closestCenter` yanlış hedef
  seçiyordu → `closestCorners`'a geçildi.
- "Tam Genişlik"e geri dönerken (sütunları kaldırma) boş olmayan sütunlardaki bloklar artık
  sessizce silinmiyor; kullanıcıya onay diyaloğu gösterilip bloklar sırayla düzleştiriliyor.

### Known limitations

- **CAPTCHA yok.** Public iletişim formu (`POST /contact/submissions`) yalnızca honeypot
  alanı + IP bazlı rate limit (5/dakika) ile korunuyor; üçüncü parti bir CAPTCHA/bot
  koruması bilinçli olarak v1 kapsamı dışında bırakıldı (üçüncü parti bağımlılık kararı
  security-agent'a ait). Yoğun spam görülürse fast-follow olarak eklenmesi öneriliyor.
- **`sanitizeRichHtml` (blog/sayfa, legacy) `rel="noopener"` üretmiyor.** Bu, blok
  editöründen ayrı, önceden var olan blog/sayfa zengin metin temizleyicisiyle ilgili bir
  konudur (yeni e-posta temizleyicisi `sanitizeEmailRichText`'i etkilemez — o zaten
  `target`/`rel` özniteliklerini ayrıca ele alır). security-agent bunu mimara iletilmesi
  gereken ayrı bir konu olarak işaretledi.
- **Admin kullanıcı soft-delete KVKK m.11 / GDPR Art. 17 "unutulma hakkı"nı KARŞILAMAZ.**
  `DELETE /admin/users/{userId}` bir **yönetimsel silmedir** ("bu kişi artık ekipte değil")
  — hesap erişimini kapatır (oturumları iptal eder, girişi engeller) ama kullanıcının
  ad/e-posta gibi kişisel verileri `User` satırında olduğu gibi durmaya devam eder,
  fiziksel silme veya anonimleştirme YAPILMAZ (gerekçe: `Organization.ownerId` zorunlu
  ilişkisi + içerik/audit-log yazarlık alanlarının `SetNull` bütünlüğü, bkz.
  `openapi.yaml`'daki `DELETE /admin/users/{userId}` açıklaması). Gerçek, geri
  döndürülemez anonimleştirme/erasure akışı ayrı, henüz yapılmamış bir backlog maddesidir
  (sahibi: compliance-agent + db-agent, bkz. `ARCHITECTURE.md` §10.8.8 çevresindeki
  saklama/PII deseni). Bu uç "kullanıcıyı KVKK kapsamında sildim" gerekçesiyle
  SUNULMAMALIDIR.

---

## Sürüm öncesi geçmiş

Bu değişiklik günlüğü açılmadan önceki değişiklikler için `git log` (Conventional Commits
formatında) tek kaynaktır.
