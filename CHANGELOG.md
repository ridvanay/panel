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
- **Sayfa editöründe Grid/Kolon düzeni** (§10.17). Yalnızca `Page` içeriği için (Blog
  kapsam dışı — blog içeriği hâlâ `contentHtml` TipTap zengin metnidir). Herhangi bir bloğu
  2 veya 3 sütuna sarmalama/sarmalamayı kaldırma; 4 oran seçeneği (`1-1`, `2-1`, `1-2`,
  `1-1-1`), sütun başı boşluk (`gap`) ve dikey hizalama (`verticalAlign`). Mobilde otomatik
  alt alta düşme (`grid-cols-1` tabanı, saklı bir "mobilde yığıl" veri alanı YOKTUR — saf
  CSS). Derinlik en fazla 1 (bir sütunun içine sütun/hero konulamaz, 422).
  - Yeni `PageBlock` tipi: `columns` (bkz. `openapi.yaml::PageColumnsBlockData`).
  - db-agent tarafında migration **YOK** (`Page.blocks` zaten serbest `Json` alanı).

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

### Fixed

- **[security]** Sütun (`columns`) bloğu içine konan `text` bloklarının `data.html`'i
  sanitize'den geçmeden DB'ye yazılabiliyordu → public sayfada stored XSS riski.
  `sanitizePageBlocks` bir seviye özyinelemeli hale getirildi (security-agent).
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

---

## Sürüm öncesi geçmiş

Bu değişiklik günlüğü açılmadan önceki değişiklikler için `git log` (Conventional Commits
formatında) tek kaynaktır.
