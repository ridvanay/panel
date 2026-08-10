# Changelog

Bu proje [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) formatını takip eder.
Kategoriler: `Added` / `Changed` / `Fixed` / `Removed`.

## [Unreleased]

### Added

- **Ürün ve Portföy'de revizyon geçmişi, autosave ve toplu işlem** — `Page`/`BlogPost`
  ile aynı seviyeye getirildi:
  - `POST /admin/products/{productId}/autosave` ve
    `POST /admin/portfolio/{itemId}/autosave` — 3 saniyelik debounce ile otomatik
    kaydetme. Yalnızca serbest metin alanlarını (`title`/`excerpt`/`descriptionHtml`)
    kapsar; fiyat/indirim/SKU/stok/durum bu uçtan **değiştirilemez**. Revizyon
    üretmez, `AuditLog` yazmaz.
  - `POST /admin/products/bulk` ve `POST /admin/portfolio/bulk` — çoklu seçimde
    yayınla/taslağa al/çöpe taşı/geri al/kalıcı sil işlemleri artık tek bir atomik
    istekle uygulanıyor (`BulkContentActionRequest` / `BulkContentActionResult`).
    Kısmi başarı hata sayılmaz (200 + `skippedIds`); `permanent-delete` yalnızca
    ADMIN rolüne açık.
  - `GET /admin/products/{productId}/revisions`, `GET /admin/products/{productId}/revisions/{revisionId}`,
    `POST /admin/products/{productId}/revisions/{revisionId}/restore` ve
    portföy için birebir aynı sözleşmeye sahip `.../portfolio/{itemId}/revisions...`
    uçları. Entity başına en fazla 50 revizyon tutulur. Ürün geri yüklemesinde ek
    olarak fiyat/indirim çapraz-alan doğrulaması (`discountPriceCents < priceCents`)
    ve SKU/slug tekillik kontrolü çalışır (`422`/`409`).
  - Frontend: ürün ve portföy editörlerinde otomatik kaydetme rozeti ve
    "Geçmiş Sürümler" sekmesi eklendi; liste sayfalarındaki toplu işlemler artık
    tek bir API çağrısıyla yürütülüyor (önceden her kayıt için ayrı istek atılarak
    simüle ediliyordu).
  - Backend: `backend/src/lib/bulk-content-actions.ts` — blog/pages/products/portfolio
    modüllerinin ortak kullandığı tek toplu-işlem helper'ı.

- **WooCommerce ürün içe aktarma** — yeni `ImportJobType.PRODUCTS`. WordPress WXR
  dosyalarından WooCommerce ürünlerini (fiyat, SKU, stok, kategori, SEO meta) içe
  aktarır (`POST /admin/import/jobs` → `type: PRODUCTS`, yalnızca XML kabul eder).
  - Eşleştirme anahtarı `sku` (yoksa `slug`); `overwrite` öncesi otomatik
    `ContentRevision` snapshot'ı alınır; `createNew` + SKU çakışmasında satır
    atlanır (`DUPLICATE_SKIPPED`) — SKU'ya sonuna sayı eklenerek çoğaltılmaz.
  - Para birimi WXR'da taşınmadığı için `StartImportJobRequest.defaultCurrency`
    ile operatörden alınır (varsayılan `TRY`).
  - **İçe aktarılmayanlar (bilinçli, kullanıcıya önizlemede uyarı olarak gösterilir):**
    - **KDV oranı** — WXR bunu taşımıyor; ürün vergisiz/vergi oranı `null` olarak gelir.
    - **Ürün galerisi** — v1 kapsamı dışında (`WC_GALLERY_NOT_IMPORTED`).
    - **Ürün varyasyonları** — `variable` tipli ürünler tek, varyasyonsuz bir kayıt
      olarak içe aktarılır; varyantlar atlanır (`WC_VARIATIONS_UNSUPPORTED`).
    - **Sipariş/müşteri kayıtları** — `shop_order`/`shop_coupon`/`customer`
      item'ları güvenlik ve KVKK nedeniyle **kasıtlı olarak hiç içe aktarılmaz**,
      yalnızca sayısı önizlemede gösterilir (`WC_ORDERS_IGNORED`).
  - İçe aktarılan ürünler varsayılan olarak **TASLAK (DRAFT)** durumunda gelir —
    kaynakta `publish` olsa dahi fiyat/KDV/stok doğrulanmadan mağazaya düşmesin
    diye. Operatör `StartImportJobRequest.defaultStatus: PUBLISHED` göndererek bu
    varsayılanı değiştirebilir (yalnızca kaynakta zaten `publish` olan ürünler
    yayına geçer, durum yükseltilmez).
  - **Portföy içe aktarımı desteklenmiyor** — WordPress'te karşılığı olan
    kanonik bir portföy post type'ı olmadığından (her tema kendi custom post
    type'ını kullanır) bu, v1 kapsamı dışında bırakıldı.

### Changed

- Zamanlanmış yayın (`scheduledAt` sweeper) artık **Ürün** ve **Portföy**'de de
  çalışıyor — önceden yalnızca Sayfa/Blog'da çalışıyordu; zamanlanmış ürün/portföy
  kayıtları süresiz "zamanlanmış" durumda takılı kalabiliyordu.

### Fixed

- Genel hata işleyici: bazı geçersiz istekler (ör. bozuk `Content-Length` header'ı)
  artık doğru şekilde `400` dönüyor (önceden yanlışlıkla `500` dönüyordu).
- İçe aktarma sistemi: asılı kalan/süresi dolan import işlerinin ham kaynak
  dosyaları artık düzgün temizleniyor (önceden sunucu işlem sırasında çökerse
  dosya süresiz diskte kalabiliyordu — veri minimizasyonu/KVKK düzeltmesi).
- İçe aktarma sistemi: `excerpt` alanı artık diğer HTML alanları (`contentHtml`,
  `descriptionHtml` vb.) ile aynı şekilde sanitize ediliyor.
