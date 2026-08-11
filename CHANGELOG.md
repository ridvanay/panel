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
