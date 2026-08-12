# Changelog

Bu projedeki tüm önemli değişiklikler bu dosyada belgelenir.
Format [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) temel alınmıştır.

## [Unreleased]

### Added
- **Medya Kütüphanesi: klasör sistemi.** Görseller artık klasörlere organize edilebilir.
  - Klasör oluşturma, yeniden adlandırma ve silme (`POST/PATCH/DELETE /admin/media/folders`).
  - Klasör hiyerarşisi en fazla 2 seviye derinliğindedir (kök + bir alt seviye).
  - Klasör silindiğinde içindeki görseller **silinmez** — otomatik olarak "Kategorisiz"
    listesine düşer; alt klasörler varsa köke taşınır (organizasyon bilgisi kaybolur,
    görseller ve dosyalar her zaman korunur).
  - Aynı üst klasör altında birbirinin aynı (büyük/küçük harf duyarsız) isimde iki klasör
    oluşturulamaz.
  - Admin medya sayfasında ve içerik editöründeki görsel seçici (`MediaPicker`) aynı
    klasör ağacını paylaşır.
- **Medya taşıma.** Görseller tek bir uçtan (`POST /admin/media/move`) hem tekil hem toplu
  olarak başka bir klasöre taşınabilir; hedef klasör verilmezse görsel "Kategorisiz"e alınır.
- **Gelişmiş çoklu seçim.** Medya listesinde Shift+tık ile aralık seçimi, Ctrl/Cmd+tık ile
  tekil ekle/çıkar, Ctrl/Cmd+A ile o an görünen (aktif klasör ve filtreler dahilindeki) tüm
  öğeleri seçme desteği eklendi. Seçili öğeler için toplu silme ve toplu klasöre taşıma
  eylemleri seçim çubuğunda sunulur.
- Admin medya sayfasına yeni bir tablo/liste görünümü (`media-list-table`) eklendi.

- **Site Özelleştirme paneli.** Yeni `/admin/appearance` ekranı, sitenin **görünümünü**
  admin panelinin kendi temasından bağımsız olarak yönetir; dokuz bölümden oluşur:
  Tasarım Ön Ayarları, Sayfa Başlığı Düzeni, Stil/Renk, Sosyal Medya (paylaşım butonu
  anahtarı), Yazı Tipi, Ekstra Özellikler (kayan yukarı-çık, yapışkan başlık, çerez
  bandı, bakım modu), Özel CSS/JS ve 404 Sayfası. Logo & Marka ve Sosyal Hesap
  Linkleri bu panele **taşınmadı**; ilgili kartlar `/admin/navigation`'a derin link
  verir (bu iki alan zaten orada düzenleniyordu).
  - Yeni uçlar: `GET /appearance` (public), `GET/PATCH /admin/appearance`,
    `GET /admin/appearance/presets`, `POST /admin/appearance/reset`,
    `GET /admin/appearance/custom-code`,
    `PUT /admin/appearance/custom-code/{css,js}`.
  - Tasarım ön ayarları (Klasik/Modern/Minimal vb.) uygulandığı anda kaydedilmez —
    yalnızca formu doldurur; kalıcı hale gelmesi için normal Kaydet akışı gerekir.
  - Renkler ve fontlar admin panelinin kendi arayüzünü **hiçbir zaman** etkilemez;
    site tarafında ayrı bir `--site-*` CSS değişken kümesiyle uygulanır.
  - Canlı önizleme, mevcut `SiteHeader`/`SiteFooter` bileşenleri üzerinden çalışır
    (ayrı bir önizleme bileşeni eklenmedi).
  - Bakım modu yalnızca ziyaretçi tarafını etkiler (HTTP 503 + `Retry-After`); admin
    paneli asla kilitlenmez. v1'de yönetici için bypass yoktur.
  - Özel 404 sayfası: başlık/mesaj/buton metni ve linki özelleştirilebilir, boş
    bırakılan alanlar için varsayılan Türkçe metinler kullanılır.
  - **Özel CSS/JS** yalnızca ADMIN rolüne açıktır, kaydetmeden önce onay kutusu
    işaretlenmesi zorunludur, `CUSTOM_CODE_ENABLED` ortam değişkeniyle tamamen
    kapatılabilir (kill switch) ve her kayıt denetim izine (audit log) sha256 özetiyle
    işlenir — kod gövdesinin kendisi denetim kaydına yazılmaz. Bu alan canlı
    önizlemede uygulanmaz; "yeni sekmede siteyi aç" ile kontrol edilir.
- **Ortak `useUnsavedChangesGuard` hook'u.** Kaydedilmemiş değişiklik uyarısı
  (sayfadan ayrılırken onay isteme) artık tek bir paylaşılan hook'ta toplandı; Navigasyon
  ve Ayarlar sayfaları da bu ortak hook'u kullanacak şekilde güncellendi (davranışta
  kullanıcıya yansıyan bir değişiklik yok, sürdürülebilirlik iyileştirmesi).

### Changed
- `GET /admin/media` artık `folderId` sorgu parametresini destekler (klasöre göre
  sunucu tarafı filtreleme); `folderId=none` "Kategorisiz" görselleri döner.
- `POST /admin/media` (yükleme) artık opsiyonel `folderId` kabul eder — kullanıcı bir
  klasörün içindeyken yüklediği görsel doğrudan o klasöre düşer.
- Görsel meta verisine `width`/`height` alanları eklendi (Prisma migration:
  `20260811083016_add_media_width_height`).

## Notlar

- `PATCH /admin/media/{mediaId}` **`folderId` kabul etmez** — taşımanın tek yolu
  `POST /admin/media/move`'dur. Bu kısıtın gerekçesi için bkz.
  `docs/architecture/ARCHITECTURE.md` §10.11.4.
- Tam API kontratı ve karar gerekçeleri için: `docs/architecture/openapi.yaml`
  (`Media` tag'i) ve `docs/architecture/ARCHITECTURE.md` §10.11.
- Site Özelleştirme paneli için tam API kontratı ve karar gerekçeleri:
  `docs/architecture/openapi.yaml` (`Appearance` tag'i) ve
  `docs/architecture/ARCHITECTURE.md` §10.12.
