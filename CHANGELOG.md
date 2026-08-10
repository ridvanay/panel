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

- **Admin Navigasyon: iç içe (nested) menüler ve WordPress benzeri düzenleyici** —
  Navigasyon sayfası iki sekmeye ayrıldı: **Menüleri Düzenle** ve **Konumları Yönet**.
  - Menü öğeleri artık dnd-kit tabanlı gerçek sürükle-bırak ile hem sıralanabiliyor
    hem de birbirinin altına (nested) taşınabiliyor — maksimum derinlik 2 (kök + 1
    alt seviye).
  - "Menüleri Düzenle" sekmesinde sol panelden içerik türüne göre (Sayfalar / Blog /
    Ürünler / Portföy) yayındaki içerik checkbox ile menüye eklenebiliyor; ayrıca
    serbest metin/URL girilen Özel Bağlantılar desteği var.
  - "Konumları Yönet" sekmesi Logo/Marka, Header CTA ve Footer konumlarını tek yerde
    topluyor (veri modeli değişmedi, yalnızca yönetim arayüzü gruplandı).
  - Backend: `NavigationItem` şemasına self-relation `parentId` eklendi (migration).
    `PUT /admin/navigation` artık hiyerarşik bir düz dizi kabul ediyor: her öğe
    isteğe bağlı istemci-üretimli `id` ve `parentId` taşıyabilir; derinlik-2 kuralı,
    kendi kendine referans ve payload-içi `parentId` bütünlüğü sunucu tarafında
    doğrulanıyor (`422`). Kayıt sırasında kök öğeler önce, alt öğeler sonra
    eklenerek (roots-first) `parentId` referans bütünlüğü garanti ediliyor.
  - Sunucu `GET /admin/navigation` ve genel/public menü uçlarında diziyi
    `(parentId NULLS FIRST, order)` sırasıyla döner; `order` kardeş-kapsamlıdır
    (global değil, aynı `parentId` grubu içinde 0'dan artar).
  - Gerçek site header'ı (public, anonim kullanıcılara sunulan) artık nested menü
    öğelerini dropdown olarak render ediyor — önceden düz liste olarak render
    ediliyordu ve alt öğeler yanlış/eksik görünüyordu.
  - Kapsam: backend 9 yeni entegrasyon testi, frontend 251 test (unit + a11y),
    security-agent denetimi ve qa-agent bağımsız curl doğrulaması; kritik bulgu yok.

### Changed

- Zamanlanmış yayın (`scheduledAt` sweeper) artık **Ürün** ve **Portföy**'de de
  çalışıyor — önceden yalnızca Sayfa/Blog'da çalışıyordu; zamanlanmış ürün/portföy
  kayıtları süresiz "zamanlanmış" durumda takılı kalabiliyordu.

### Fixed

- Admin Canlı Önizleme panelinde ve gerçek site header'ında logo görselinin
  taşarak bozuk render olması düzeltildi (object-fit/boyut kısıtlaması eksikti).
- Genel hata işleyici: bazı geçersiz istekler (ör. bozuk `Content-Length` header'ı)
  artık doğru şekilde `400` dönüyor (önceden yanlışlıkla `500` dönüyordu).
- İçe aktarma sistemi: asılı kalan/süresi dolan import işlerinin ham kaynak
  dosyaları artık düzgün temizleniyor (önceden sunucu işlem sırasında çökerse
  dosya süresiz diskte kalabiliyordu — veri minimizasyonu/KVKK düzeltmesi).
- İçe aktarma sistemi: `excerpt` alanı artık diğer HTML alanları (`contentHtml`,
  `descriptionHtml` vb.) ile aynı şekilde sanitize ediliyor.
