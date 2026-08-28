# Changelog

Bu proje [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) formatını ve
[Conventional Commits](https://www.conventionalcommits.org)'i takip eder. Sürüm numaraları
henüz etiketlenmemiştir (`0.1.0`, henüz ilk stabil sürüm öncesi); değişiklikler tarih
bazlı olarak `Unreleased` altında gruplanır.

Kaynak doğruluk: kontrat değişiklikleri için `docs/architecture/openapi.yaml` +
`docs/architecture/shared-types.ts`; mimari kararlar için `docs/architecture/ARCHITECTURE.md`.
Bu dosya onların **özetidir**, ikinci bir doğruluk kaynağı değildir.

## [Unreleased]

### Changed

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
