# Test Kapsamı

Bu dosya qa-agent tarafından tutulur — hangi kullanıcı akışlarının test edildiğini, hangilerinin
eksik olduğunu güncel tutar (bkz. `.claude/CLAUDE.md` görev tanımı). Her yeni özellikten sonra
qa-agent bu dosyayı günceller.

## Katmanlar

| Katman | Araç | Konum | Ne test eder |
|---|---|---|---|
| Backend unit | Vitest | `backend/tests/unit/` | Saf fonksiyonlar (slug, sanitize, parser'lar, format...) |
| Backend entegrasyon | Vitest + `app.inject` (gerçek Postgres, `saas_test`) | `backend/tests/integration/` | API iş mantığı, DB ile birlikte — gerçek HTTP sunucusu YOK |
| Frontend unit | Vitest + Testing Library + jest-axe | `frontend/tests/unit/` | Bileşenler, hook'lar, a11y (axe-core) |
| **E2E / entegrasyon** | **Playwright** (gerçek tarayıcı, gerçek çalışan backend+frontend, ayrı `saas_e2e` DB) | `frontend/tests/e2e/` | Uçtan uca kullanıcı akışları, gerçek HTTP wiring, gerçek proxy/routing |

Backend entegrasyon testleri `app.inject` kullandığı için gerçek bir HTTP sunucusu/network
katmanını atlar (route mount, CORS, gerçek proxy sıralaması gibi "wiring" hatalarını YAKALAMAZ).
Playwright katmanı bu boşluğu kapatır — bazı testler (`api-contract-legal-document.spec.ts`)
backend'in kendi testleriyle AYNI davranışı kasıtlı olarak GERÇEK bir çalışan sunucuya karşı
tekrar doğrular.

## §10.5 Çoklu Dil (i18n) — E2E kapsamı (bu turda eklendi)

Kaynak: `.claude/architect-scope-i18n.md` §9 "qa-agent" görev listesi (13 madde, bağlayıcı).

Playwright altyapısı bu görevde SIFIRDAN kuruldu (`@playwright/test` + `cross-env` eklendi,
`frontend/playwright.config.ts`, kurulum talimatları dosya başlığında). Yerel/CI çalıştırma:

```bash
cd frontend
npx playwright install chromium   # ilk kurulumda
npm run test:e2e                  # webServer'ı otomatik başlatır (bkz. playwright.config.ts)
```

CI'da backend'in de ayrı bir Postgres servisi + `saas_e2e` migration adımıyla ayağa
kaldırılması gerekir (backend `ci.yml`'deki `saas_test` deseninin aynısı, bkz.
`backend/.env.e2e` başlığındaki kurulum notu) — **bu adımı ci.yml'e eklemek devops-agent'ın
işidir**, qa-agent kendi ci.yml'ini değiştirmez (bkz. proje kökü CLAUDE.md ajan sınırları).

### Sonuç özeti (bu oturumda yerel koşum)

**21/22 test yeşil.** Kalan 1 test (madde 7, UI akışı) yerel Windows/Playwright ortamında
tekrarlanan bir tarayıcı süreç çökmesi nedeniyle tamamlanamadı; kök neden izlendi ve
**uygulama koduna bağlanamadı** — aynı akış bağımsız bir betikle ve saf API çağrılarıyla her
seferinde doğru çalıştı (ayrıntı aşağıda, madde 7 satırında). CI'daki temiz bir Linux runner'da
yeniden değerlendirilmelidir.

| # | Mimari madde | Dosya | Durum |
|---|---|---|---|
| 1 | TR→EN dil değiştir, `/en/<en-slug>` altında EN içerik | `routing-locale.spec.ts` | ✅ Geçiyor |
| 2 | Çevrilmemiş içerik `/en/...` → 404 DEĞİL, varsayılan dil | `routing-locale.spec.ts` | ✅ Geçiyor |
| 3 | `/tr/<slug>` → 301 → `/<slug>` | `routing-locale.spec.ts` | ✅ Geçiyor |
| 4 | **Bakım modu + locale birlikte** (en yüksek riskli) | `maintenance-mode-locale.spec.ts` | ✅ Geçiyor (4 alt senaryo) |
| 5 | `/admin` locale prefix almaz, panel dili URL'i değiştirmez | `admin-locale-separation.spec.ts` | ✅ Geçiyor |
| 6 | Panel dili EN iken TR içerik düzenlenebiliyor | `admin-locale-separation.spec.ts` | ✅ Geçiyor |
| 7 | Panelden yeni dil (`de`) eklenince deploy'suz çalışıyor | `admin-locale-management.spec.ts` | ⚠️ Yazıldı, yerelde ortam kaynaklı kararsız (aşağıya bkz.) — **API seviyesinde ayrıca elle doğrulandı, çalışıyor** |
| 8 | Varsayılan dil silinemez/devre dışı bırakılamaz | `admin-locale-management.spec.ts` | ✅ Geçiyor (UI + API çift kontrol) |
| 9 | **Regresyon: mevcut TR URL'leri değişmedi** (en yüksek riskli) | `routing-locale.spec.ts` | ✅ Geçiyor |
| 10 | hreflang + x-default; çevrilmemiş dil alternate YOK | `routing-locale.spec.ts` | ✅ Geçiyor |
| 11 | Slug çakışması 409; geçersiz locale query 400 DEĞİL | `api-contract-legal-document.spec.ts` | ✅ Geçiyor |
| 12a-d | `isLegalDocument` istisnası (§5.1) — blocks boş, notice, çevrilince normal, istisna sızmıyor | `api-contract-legal-document.spec.ts` | ✅ Geçiyor (4 alt senaryo) |
| 12e | EDITOR 403 / ADMIN + audit | — (yinelenmedi) | ✅ **backend'in kendi entegrasyon testinde zaten kapsanıyor** (`backend/tests/integration/localization.test.ts`, doğrudan Prisma rol değişimi gerektirdiği için Playwright'ta kırılgan bir workaround yerine orada bırakıldı) |

### Bilinen ortam sınırlaması — madde 7

`/admin/settings` → "Diller" sekmesi → "Dil Ekle" diyaloğunda form doldurulmaya başlarken,
qa-agent'ın yerel Windows/Playwright/Chromium kombinasyonunda tarayıcı süreci tekrarlanan
biçimde çöktü (trace kaydı: `fill` çağrısı BAŞLADI ama hiç TAMAMLANMADI — gerçek bir süreç
sonlanması, "element bulunamadı" DEĞİL). Kök neden araştırıldı:

- Aynı UI akışı (login → Diller sekmesi → Dil Ekle → form → kaydet), Playwright test-runner'ının
  trace/screenshot altyapısı OLMADAN bağımsız bir betikle birden çok kez ÇALIŞTI.
- Kabul kriterinin kendisi (dil ekleme → `GET /locales`'e yansıması → `/de` rotasının 200
  dönmesi) **doğrudan API çağrılarıyla elle doğrulandı** ve doğru çalışıyor — yeni dil ~birkaç
  saniye içinde (proxy'nin `revalidate: 60` önbellek politikası dahilinde, §4.3 — bilinçli bir
  gecikme, hata değil) rota uzayına giriyor.
- Sonuç: bu bir **test/ortam** sorunu (muhtemelen bu oturumun kaynak baskısı + Playwright'ın
  Windows'taki otomasyon davranışı), **uygulama bug'ı değil**. Test dosyasında `retries: 2` ile
  işaretlendi; CI'da (temiz `ubuntu-latest` runner) yeniden değerlendirilmeli.

## Bulunan ve raporlanan bug'lar (bu turda)

Kural gereği (bkz. proje kökü CLAUDE.md): qa-agent bug'ları KENDİSİ DÜZELTMEZ, ilgili ajana
yönlendirir. Aşağıdaki ikisi **frontend-agent**'a aittir; testler `test.fail()` ile bilinçli
olarak "beklenen başarısızlık" işaretlendi (CI'ı kırmadan iz bırakır — düzeltilirse test
kırmızıya döner ve işaretin kaldırılması gerektiği anlaşılır).

1. **`<html lang>` client-side (SPA) dil değiştirmede güncellenmiyor** — `frontend/src/app/layout.tsx`
   `x-active-locale` request header'ından `lang`'ı okuyor (yalnızca TAM sayfa yüklemesinde
   çalışır). Kök `RootLayout`, `[lang]` dinamik segmentinin ÜSTÜNDE olduğu için, dil
   değiştiricideki `<Link>` client-side navigasyonunda React ağacının bu kısmı yeniden
   ÇALIŞMAZ → `<html lang>` bir sonraki tam yenilemeye kadar bayat kalır. WCAG 3.1.1 ihlali +
   yanlış ekran okuyucu/SEO sinyali. Doğrudan `page.goto` (tam yükleme) ile doğru geliyor —
   yalnızca client nav'da fark var. Test: `routing-locale.spec.ts` ("BUG (frontend-agent) —
   dil değiştiriciyle CLIENT-SIDE geçişte <html lang> güncellenmiyor").
2. **§12.2 kanonik-slug-yanlış-prefix 301'i eksik** — mimari doküman (§12.2, frontend-agent
   görev listesi madde 14) `/en/<tr-kanonik-slug>` gibi bir isteğin EN'in KENDİ slug'ına 301
   ile yönlendirilmesini bağlayıcı olarak istiyor (aksi halde aynı içerik iki farklı EN URL'inde
   erişilebilir kalır — duplicate content). İçerik DOĞRU bulunuyor (backend fallback'i çalışıyor,
   200 dönüyor) ama `app/[lang]/(site)/[slug]/page.tsx`'te bu yönlendirme YOK. Test:
   `routing-locale.spec.ts` ("BUG (frontend-agent) — §12.2: ... 301 ile yönlendirilmeli").

Backend tarafında bug BULUNMADI — `backend/tests/integration/localization.test.ts` (16/16 geçiyor)
ve bu turda eklenen `api-contract-legal-document.spec.ts`'in gerçek sunucuya karşı doğrulaması
tutarlı: slug çakışması 409, geçersiz locale sessiz fallback, `isLegalDocument` sunucu tarafında
gövdeyi doğru boşaltıyor, `isDefault` korumaları (422) doğru.

## Eksik / kapsam dışı bırakılan alanlar (bilinçli, gerekçeli)

- **İçe aktarma (import) sistemi + i18n** — mimari doküman §8'de bu işin KAPSAMI DIŞINDA
  bırakıldığını açıkça belirtiyor (`feature/i18n-import` ayrı takip kalemi). qa-agent bu yüzden
  test EKLEMEDİ.
- **A11y otomasyonu (axe-core)** — bu tur için yeni public/admin sayfası eklenmedi (mevcut
  sayfalara küçük UI eklemeleri yapıldı — dil değiştirici, Diller sekmesi). Mevcut
  `frontend/tests/unit/a11y-*.test.tsx` paketi (jest-axe) admin ekranlarının çoğunu zaten
  kapsıyor; yeni "Diller" sekmesi ve dil değiştirici için özel bir a11y testi bu turda
  EKLENMEDİ — **frontend-agent'a önerilir**: `a11y-admin-settings.test.tsx`'e Diller sekmesi
  senaryosu eklensin.
- **Çoklu dilde ürün/portföy (Product/PortfolioItem çeviri editörü UI'ı)** — mimari §9
  frontend-agent madde 10 bunu istiyor; qa-agent bu turda yalnızca `Page` editörünü (madde 5-6
  için) ve genel `LocaleTabs`/`FallbackBadge` bileşenlerini backend API seviyesinde (Product/
  Portfolio `applyLocale()` — `backend/tests/integration/products.test.ts`,
  `portfolio.test.ts`) DOLAYLI olarak kapsadı; `products`/`portfolio` admin editörlerinde
  çeviri sekmesinin GERÇEK tarayıcı testi EKLENMEDİ (zaman/kapsam kısıtı). **Sonraki tur için
  önerilir.**
- **Sitemap `alternates.languages` çıktısı (`frontend/src/app/sitemap.ts`)** — architect §6.2
  bunu istiyor; qa-agent bu turda sitemap XML çıktısını doğrudan test ETMEDİ (yalnızca sayfa
  seviyesinde hreflang doğrulandı). **Sonraki tur için önerilir**: `sitemap.ts` çıktısını
  parse edip `alternates` alanının doğru/eksiksiz olduğunu doğrulayan bir Playwright API testi.
- **Panel dili değişince `Intl` biçimlendiricilerinin (`notification-center.tsx` tarih formatı
  gibi) gerçekten değiştiği** — mimari §7.3 bunu istiyor; qa-agent bu turda test ETMEDİ.

## §10.13 Üçüncü Parti Entegrasyon (API Anahtarları / Public API / Giden Webhook) — backend entegrasyon kapsamı (bu turda eklendi)

Kaynak: `docs/architecture/ARCHITECTURE.md` §10.13, özellikle §10.13.10 sonundaki "qa-agent için
kritik akışlar" listesi (a—i). backend-agent zaten `backend/tests/unit/{api-key,ssrf-guard,
webhook-signature,api-key-rate-limit,webhook-events}.test.ts` ve `backend/tests/integration/
{api-keys,outbound-webhooks,webhook-emission}.test.ts` ile 608 testlik bir taban bırakmıştı;
security-agent denetiminde bu tabanın kapsamadığı üç kritik akış + paylaşılan altyapıya dokunan
bir nokta (bulk-publish webhook emisyonu) tespit edildi ve bu turda kapatıldı. Ayrıca, projede
o zamana kadar **hiçbir testin** `outbound-webhooks.dispatcher.ts::sendWebhookRequest`'in
gerçek gönderim yolunu (HTTP isteği + HMAC imza üretimi + backoff/retry) TETİKLEMEDİĞİ görüldü
(`webhook-emission.test.ts` yalnızca `WebhookDelivery` satırının doğru oluştuğunu, ağa çıkışı
DEĞİL, doğruluyordu) — bu boşluk da bu turda kapatıldı.

| # | Kontrat maddesi | Dosya | Durum |
|---|---|---|---|
| 1 | Anahtar oluşturma/iptal → plaintext tek sefer, iptal sonrası ANINDA (cache dahil) 401 | `backend/tests/integration/api-keys.test.ts` (mevcut, backend-agent) | ✅ Geçiyor |
| 2 | Public API'den yayındaki içerik → doğru `Public*` DTO, admin-only alan sızmıyor; taslak → 404 | `backend/tests/integration/api-keys.test.ts` (mevcut, backend-agent) | ✅ Geçiyor |
| §10.13.10 (b) | Süresi dolmuş anahtar → 401 (cache'i hiç görmeden DB'den taze okunarak) | `backend/tests/integration/api-keys-critical-flows.test.ts` | ✅ Geçiyor (yeni) |
| §10.13.10 (c) | READ anahtarın READ_WRITE gerektiren bir işleme 403'ü — public API tamamen GET-only olduğu için gerçek uç yok, `requireApiKey()` doğrudan çağrılarak doğrulandı | `backend/tests/integration/api-keys-critical-flows.test.ts` | ✅ Geçiyor (yeni) |
| §10.13.10 (e) | Anahtar kotası aşımında 429 — §10.13.6 Katman 2 (`ApiKey.id` başına 120/dk + 20/sn burst) `/public/*`'e uçtan uca bağlı: burst aşımında `429 RATE_LIMITED` + `Retry-After` | `backend/tests/integration/api-keys-critical-flows.test.ts` | ✅ Geçiyor (yeni — düzeltildi, aşağıya bkz.) |
| §10.13.8 (bulk) | Bulk-publish (`/blog/bulk`, `/pages/bulk`, `/portfolio/bulk`) sonrası `*_PUBLISHED` YALNIZCA gerçek taslak→yayın geçişi yapan öğeler için tetiklenir (zaten yayındaki öğe TEKRAR tetiklemez) | `backend/tests/integration/webhook-bulk-publish.test.ts` | ✅ Geçiyor (yeni — backend-agent'ın "ikinci göz" talebi) |
| §10.13.8/9 | Dispatcher'ın GERÇEK gönderim yolu: doğru URL/method/header, GEÇERLİ `X-Webhook-Signature` (`HMAC-SHA256(secret, "ts.rawBody")`), alıcı-tarafı referans doğrulama + sahte/bozuk imza reddi | `backend/tests/integration/webhook-dispatch-signature.test.ts` | ✅ Geçiyor (yeni — `node:dns`/`undici` mocklanarak, ilk kez) |
| §10.13.10 (g) | 5xx → backoff ile yeniden deneme, `WEBHOOK_MAX_ATTEMPTS`(5)'te FAILED | `backend/tests/integration/webhook-dispatch-signature.test.ts` | ✅ Geçiyor (yeni) |
| §10.13.10 (a,d,f,h,i) | İptal edilmiş anahtar 401, taslak/çöp görünmez, SSRF reddi, HMAC vektörü, `*_PUBLISHED` tekrar tetiklenmez | `backend/tests/integration/{api-keys,outbound-webhooks,webhook-emission}.test.ts`, `backend/tests/unit/webhook-signature.test.ts` (mevcut, backend-agent) | ✅ Geçiyor |

Yöntem notu (§10.13.7 SSRF ile ilişkili): dispatcher gerçek DNS çözümlemesi yapıp SSRF için
literal-IP/localhost/private-range hedefleri reddettiği için gerçek bir yerel test sunucusuna
bağlanmak mümkün değildir — `webhook-dispatch-signature.test.ts` bu yüzden `node:dns` ve
`undici`'yi projedeki YERLEŞİK `vi.mock` deseniyle (bkz. `checkout.test.ts::vi.mock(".../
stripe")`) sahteler; DNS sahte-public bir IP'ye çözülür, HTTP isteği kontrollü bir yanıt
kuyruğuna bağlanır ve GERÇEKTEN gönderilen header'lar/gövde yakalanıp doğrulanır.

### Düzeltilen yanlış kontrat okuması (koordinatör tarafından, bu turda)

qa-agent'ın ilk turu §10.13.10 madde (e) "anahtar kotası aşımında 429" cümlesini "hesap başına
en fazla N API anahtarı oluşturulabilir" (create-time max-count) olarak yorumlamış ve
`outbound-webhooks.service.ts::WEBHOOK_MAX_COUNT` (409, site genelinde en fazla 20 webhook)
desenine benzeterek `api-keys.service.ts::createApiKey`'de eksik bir kontrol olduğunu — ve bunu
bir kontrat açığı olarak — raporlamıştı (`it.fails` ile işaretli bir test). Kontrat metni yeniden
okunduğunda bu YANLIŞ bir eşleştirme olduğu görüldü: madde (e), §10.13.6 "Katman 2 — anahtar
başına kota" (istek/dakika + istek/saniye hız sınırı) ile AYNI cümledir — `GET /public/me`'nin
"kalan kota" alanına ve §10.13.10'un kendi hata kodu tablosundaki "429 | RATE_LIMITED | Kota
aşıldı" satırına işaret eder. Kontratta "en fazla N API anahtarı" gibi bir create-time sınır hiç
YOKTUR; `createApiKey`'de böyle bir kontrolün olmaması bir kontrat ihlali değildir.

Düzeltme: yanlış `it.fails` bloğu kaldırıldı, yerine `/public/me`'ye gerçek bir istekle burst
kovasını (20/sn) aşan, `429 RATE_LIMITED` + `Retry-After` + doğru `x-ratelimit-remaining`
header'ını doğrulayan bir entegrasyon testi eklendi (bkz. tablo). backend-agent'a yönlendirilecek
bir bulgu YOKTUR — davranış zaten kontrata uygundu, yalnızca test eksikti.

Frontend/backend içerik/DTO tarafında başka bug BULUNMADI — mevcut 608 test + bu turda eklenen
13 test (7 geçen + 3 bulk-publish + 3 dispatcher) toplamda `backend/tests/` altında **69 dosya /
622 test**, hepsi yeşil.

## Blog/Sayfa listesi + editör düzeltmeleri (pagination bug + Tag sistemi) — E2E kapsamı (bu turda eklendi)

Kaynak: `docs/architecture/ARCHITECTURE.md` §10.7.1 (pagination eşik bug'ı), §10.7.2 (Hızlı
Düzenle genişletmesi), §10.14 (Tag sistemi), §10.15 (galeri bloğu). Kullanıcının açıkça istediği
odak: **madde 3 (pagination) ve Tag sistemi**, gerçek backend + Postgres'e (`saas_e2e`) karşı,
GERÇEK 229 blog yazısıyla.

| # | Senaryo | Dosya | Durum |
|---|---|---|---|
| KRİTİK | 229 yazı, 50/sayfa'da pagination + pageSize seçici GÖRÜNÜR kalır, 2. sayfaya geçilir, 10/sayfa'ya geri dönülür | `admin-blog-pagination.spec.ts` | ✅ Geçiyor |
| — | `totalPages===1` iken pagination kontrolleri GİZLİ | `admin-blog-pagination.spec.ts` | ✅ Geçiyor |
| — | 10/20/50 üç pageSize'ın hepsi — ilk/orta/son sayfa aralığında doğru satır sayısı + buton disabled durumları | `admin-blog-pagination.spec.ts` (3 alt senaryo) | ✅ Geçiyor |
| — | pageSize seçici metni KESMİYOR (`w-24`→`w-auto` doğrulaması, ölçülen piksel genişliği ile) | `admin-blog-pagination.spec.ts` | ✅ Geçiyor |
| madde 1 | Tam editörde satır-içi YENİ ETİKET oluşturma → otomatik seçili → kaydet → listede chip | `admin-blog-tags.spec.ts` | ✅ Geçiyor |
| madde 5 | Tam editörde satır-içi YENİ KATEGORİ oluşturma → otomatik seçili → kaydet → listede görünür | `admin-blog-tags.spec.ts` | ✅ Geçiyor |
| madde 3 | Hızlı Düzenle'den Kategori+Etiket değiştir → liste güncellenir | `admin-blog-tags.spec.ts` | ✅ Geçiyor |
| madde 4 | `tagIds` TAM SET semantiği — 3 etiketten 1'i kaldırılınca PATCH gövdesi kalan 2'yi içerir (network-mock DEĞİL, gerçek `waitForRequest`) | `admin-blog-tags.spec.ts` | ✅ Geçiyor |
| madde 4 (belge) | Hızlı Düzenle'de kategori/etiket DOKUNULMADAN kaydedilince PATCH gövdesi mevcut `tagIds`'i aynen taşır (gözlemlenen davranış — bkz. bulgu 3 aşağıda) | `admin-blog-tags.spec.ts` | ✅ Geçiyor |
| madde 6 | Etikete göre filtreleme (client-side) | `admin-blog-tags.spec.ts` | ✅ Geçiyor |
| madde 7 | Etiket silinince yazı VAR OLMAYA devam eder, yalnızca etiketi kaybeder | `admin-blog-tags.spec.ts` | ✅ Geçiyor |
| — | `MediaPicker` çoklu seçim modu (toggle, "Seç (N)", maxSelection, Vazgeç) | `frontend/tests/unit/media-picker-multiple.test.tsx` (component-level, Playwright DEĞİL — zaman kısıtı, aşağıya bkz.) | ✅ Geçiyor |
| — | `TagSelect` bileşeni (chip, arama, satır-içi oluşturma, TAM SET add/remove, `canCreate=false`) | `frontend/tests/unit/tag-select.test.tsx` | ✅ Geçiyor |
| — | `useFilteredList` (etikete göre client-side filtre hook'u) | `frontend/tests/unit/use-filtered-list.test.tsx` | ✅ Geçiyor |

**13/13 e2e senaryosu yeşil** (`admin-blog-pagination.spec.ts` 5, `admin-blog-tags.spec.ts` 8),
**+14 yeni frontend unit test** yeşil, mevcut **375 frontend unit + 642 backend test** kırılmadı
(tamamı bu turda yeniden koşuldu, hepsi geçti).

### Öncelik 3 (galeri bloğu e2e) — KAPATILDI (bkz. "§Galeri Bloğu v2" bölümü aşağıda)

~~Zaman kısıtı nedeniyle "Galeri Ekle" → MediaPicker çoklu seçim → içerikte render → kaydet/yeniden
aç → korunma akışının TAM Playwright e2e'si eklenmedi.~~ Galeri bloğu tek-görsel taklidinden gerçek
çoklu-görsel/sürükle-sıralanabilir/3-stilli bir bileşene dönüştürüldüğünde bu boşluk kapatıldı —
bkz. aşağıdaki "§Galeri Bloğu v2 (çoklu görsel, sürükle-sıralama, Grid/Carousel/Masonry) — E2E +
component kapsamı" bölümü.

### qa-agent'ın KENDİ test altyapısında bulup düzelttiği bug'lar (bu turda)

Bu üçü **ürün/uygulama kodu DEĞİL**, qa-agent'ın kendi `tests/e2e/support/*.ts` fixture
yardımcılarında/spec'lerindeydi — kural gereği (proje kökü CLAUDE.md, madde 3 "flaky testleri
düzelt") qa-agent bunları doğrudan kendisi düzeltti:

1. **KRİTİK — tüm fixture temizliği sessizce başarısız oluyordu.** `blog-fixtures.ts`/`api.ts`
   içindeki `authHeaders()` GÖVDESİZ `DELETE` isteklerinde (ör. `deleteBlogPostPermanently`,
   `deleteBlogCategory`, `deleteBlogTag`, `deletePagePermanently`, `deleteLocale`) de
   `Content-Type: application/json` gönderiyordu; Fastify boş gövdeyi geçersiz JSON sayıp
   `400 Bad Request: "Body cannot be empty when content-type is set to 'application/json'"`
   döndürüyordu (GET/HEAD bundan muaf — yalnızca DELETE'lerde gözlemlendi). Hiçbir çağıran
   `res.ok` kontrol etmediği için bu SESSİZCE yutuluyordu — sonuç: `cleanupBlogPostsByPrefix` hiç
   çalışmıyordu, her koşum önceki 229+ test yazısını DB'de bırakıyor, bir sonraki koşumun
   `createManyBlogPosts`'u `409 CONFLICT`'e çarpıyordu (kartopu etkisi). Düzeltme: gövdesiz
   istekler için ayrı `authHeadersNoBody()` (yalnızca `Authorization`) + `assertDeleteOk()` ile
   artık 2xx/404 dışındaki durumlar SESSİZCE YUTULMUYOR, fırlatılıyor.
2. **Retry güvenli değildi.** `admin-blog-tags.spec.ts` testleri SABİT başlık/adla fixture
   oluşturuyordu; yalnızca dosya-seviyesi `beforeAll`/`afterAll` temizliği vardı — bir test
   başarısız olup retry edildiğinde ilk denemenin oluşturduğu kayıt hâlâ DB'de durduğundan retry
   `409` alıyordu (asıl hatayı maskeleyen ikinci bir sahte başarısızlık). Düzeltme: `test.afterEach`
   eklendi (her testten sonra süpürme, başarı/başarısızlık fark etmeksizin).
3. **Hızlı Düzenle locator'ları strict-mode ihlali veriyordu.** `content-list-table` Hızlı
   Düzenle'yi masaüstü/mobil için AYRI DOM markup'ında render ediyor (id'ler `-m-` son ekiyle
   ayrışıyor), ikisi de aynı erişilebilir etikete sahip → `getByLabel` iki eşleşme buluyordu.
   Düzeltme: ilgili locator'lara `.filter({ visible: true })` eklendi.
4. **Tam editör sayfasında `getByLabel("Başlık")` güvenilir değildi.** Bir a11y-snapshot'ta
   (`error-context.md`) elemanın DOĞRU değerle DOM'da olduğu görülmesine rağmen `getByLabel`
   30s'de bile "element(s) not found" veriyordu (muhtemelen sayfadaki otomatik-taslak-kaydetme
   göstergesiyle ("Taslak kaydedildi HH:MM") eşzamanlı bir remount/polling yarışı — kesin kök
   neden doğrulanamadı, **frontend-agent'a bilgi amaçlı bırakılıyor**, uygulama davranışını
   BOZMUYOR). Düzeltme: test, kararlı `#title` DOM id'sine (`Field id="title"`) geçti — bu,
   `getByLabel` polling yarışını atlatıp aynı değeri doğruluyor.

Bu dört düzeltmeden SONRA suite art arda 3 kez (`13/13`, sonra tam suite'in geri kalanıyla
birlikte `33/34` — bkz. aşağıdaki pre-existing not) yeşil koştu; kalan tek ara-sıra görülen
"flaky" (1/13 çalıştırmada) `createAuthenticatedPage`'in GERÇEK UI login'inde ara sıra oluşan bir
zaman aşımıydı — bu, `admin-session.ts` başlığında ÖNCEDEN belgelenmiş, `retries: 1` ile zaten
telafi edilen bilinen bir sınırlamadır (frontend'in refresh-token rotasyon yarışı, bkz. o
dosyadaki uzun not); yeni bir bulgu DEĞİLDİR.

### Pre-existing, bu turdan BAĞIMSIZ doğrulanan flake

Tam suite koşumunda (`npx playwright test`, dosya filtresi yok) `admin-locale-management.spec.ts`
"madde 7" testi 1 kez başarısız oldu. Bu dosyaya bu turda HİÇ dokunulmadı; testi TEK BAŞINA
(diğer tüm dosyalardan izole) tekrar çalıştırınca AYNI şekilde başarısız olduğu doğrulandı —
yani bu turdaki değişikliklerden (pagination/tag testleri veya `support/api.ts` düzeltmesi)
KAYNAKLANMIYOR. Zaten bu dosyanın kendi bölümünde ("Bilinen ortam sınırlaması — madde 7", yukarı
bkz.) önceki bir qa-agent turu tarafından belgelenmiş, API seviyesinde ayrıca doğrulanmış,
bilinen bir yerel Windows/Playwright ortam sınırlamasıdır. Yeni bir aksiyon GEREKMİYOR.

## Blog yayınlama akışı — "yayınla → public URL'de görüntüle" (bu turda eklendi)

Kaynak: bugün düzeltilen 2 kritik bug'ın regresyonu — (1) SSR fetch'lerin Docker'da backend'e
ulaşamaması (`SERVER_API_BASE_URL`/`INTERNAL_API_URL` düzeltmesi, `frontend/src/lib/env.ts`),
(2) `backend/src/lib/slug.ts::slugify()`'ın Türkçe noktasız "ı" (U+0131) karakterini "-" ile
değiştirmesi (backend'in kendi `tests/unit/slug.test.ts`'i BURADA TEKRAR YAZILMADI — bu dosya
aynı düzeltmeyi gerçek admin UI akışı + gerçek public sayfa render'ı üzerinden e2e seviyesinde
doğrular).

| # | Senaryo | Dosya | Durum |
|---|---|---|---|
| 1 | PUBLISHED yazı — Türkçe "ı" içeren başlığın slug'ı TAM olarak beklenen değere dönüşür (`isikli-kirik-yazi-testi`), `/blog/{slug}` VE `/tr/blog/{slug}` (301→prefix'siz) gerçek içerik döndürür (200, `<h1>`) | `blog-publish-public-url.spec.ts` | ✅ Geçiyor |
| 2 | Admin UI'dan gerçek "Durum: Yayında" seçip "Kaydet" akışı — yayınlanmadan ÖNCE public URL 404, yayınlandıktan SONRA 200 | `blog-publish-public-url.spec.ts` | ✅ Geçiyor |
| 3 | REGRESYON — DRAFT yazının public URL'i gerçekten 404 verir (publish/draft ayrımının netliği) | `blog-publish-public-url.spec.ts` | ✅ Geçiyor |

**3/3 e2e senaryosu yeşil** (yerel `next dev` + backend `:4001` + `saas_e2e`, izole 3 kez ve tam
suite içinde 2 kez tekrar koşuldu, tutarlı geçti).

### Bug 1 (SSR/Docker network) — bu ortamda kapsanma durumu (dürüst değerlendirme)

`playwright.config.ts` `webServer`, frontend'i **Docker DIŞINDA**, doğrudan `next dev` ile başlatır
ve `NEXT_PUBLIC_API_URL=http://localhost:4001/api/v1` verir; `INTERNAL_API_URL` HİÇ set edilmez.
`SERVER_API_BASE_URL` (`frontend/src/lib/env.ts`) bu durumda `API_BASE_URL`'e (`NEXT_PUBLIC_API_URL`)
düşer — ve bu ortamda `localhost:4001` zaten GERÇEK backend'e işaret eder (aynı host, Docker
container network izolasyonu YOK). Yani bu testler **SSR fetch'in backend'e ulaştığını ve public
sayfanın gerçekten içerik döndürdüğünü** doğrular, ama **Bug 1'in kök nedenini (Docker container'ları
arası `localhost` ile `backend:4000` network izolasyonu karışıklığı) reprodükleyip düzeltmeyi
KANITLAMAZ** — kök neden bu ortamda zaten yok. `INTERNAL_API_URL` yönlendirmesinin kendisini
doğrulamak için devops-agent'ın Docker Compose ortamında ayrı bir doğrulama adımı (ör.
`docker compose up` sonrası `curl http://localhost:3000/blog/<slug>` veya Docker-tabanlı bir CI
e2e job'ı) gerekir — bu turda qa-agent tarafından EKLENMEDİ (playwright.config.ts'in kapsamı
dışında, devops-agent'ın Docker ortam yönetimi alanına girer).

### qa-agent'ın KENDİ test tasarımında bulup düzelttiği bir flaky kaynağı (bu turda)

İlk taslakta "Durum: Yayında" ve "DRAFT → 404" testleri SABİT (statik) Türkçe başlık/slug
kullanıyordu. Aynı dosya arka arkaya (warm `next dev` sunucusu, `reuseExistingServer`) tekrar
çalıştırıldığında, `proxy.ts`'in `revalidate: 60` fetch cache'i ÖNCEKİ koşumda AYNI slug'ın
PUBLISHED halini önbellekte tuttuğu için "yayınlanmadan önce 404" beklentisi yanlışlıkla 200
alıyordu (kararsız — tam suite koşumunda gözlemlendi, tekil koşumda GÖRÜNMÜYORDU). Düzeltme: bu
iki test için her koşumda taze/benzersiz bir slug üreten kısa bir rastgele son ek eklendi (Türkçe
"ı"→"i" dönüşümü yine TAM olarak, yalnızca sabit kısım için, doğrulanmaya devam ediyor — asıl
karakter dönüşümü regresyonu zaten 1. senaryoda TAM sabit bir slug ile ayrıca kapsanıyor).

## §10.16 E-posta Şablonu Blok Editörü + İletişim Formu / §10.17 Sayfa Grid-Kolon Düzeni — E2E kapsamı (bu turda eklendi)

Kaynak: `docs/architecture/ARCHITECTURE.md` §10.16 ve §10.17, `.claude/design-notes-email-editor-and-grid.md`.
Kullanıcının açıkça istediği üç akış: (1) e-posta şablonu oluşturma → blok ekleme/sıralama →
değişken ekleme (sistem+özel) → canlı önizleme → test gönderimi → aktifleştirme, (2) sayfa
editöründe 2-3 sütunlu blok yerleşimi (wrap/boş-sütuna-bırak/sütunlar-arası-taşı/unwrap/mobil
yığılma), (3) public iletişim formu gönderimi → admin Gelen Kutusu. Gerçek backend + Postgres'e
(`saas_e2e`) karşı; test gönderimi backend'in dev-fallback Ethereal SMTP hesabına gider (GERÇEK
posta kutusuna gitmez, bkz. `backend/src/lib/mail.ts`).

| # | Senaryo | Dosya | Durum |
|---|---|---|---|
| 1 | Şablon oluşturma (varsayılan amaç "Özel"/CUSTOM) → editöre yönlendirme | `admin-email-template-editor.spec.ts` | ✅ Geçiyor |
| 2 | 6 blok tipinin tamamı eklenir (Başlık/Metin/Buton/Görsel/Ayırıcı/Footer), sırayla otomatik seçilir | `admin-email-template-editor.spec.ts` | ✅ Geçiyor |
| 3 | Konu + Başlık bloğuna SİSTEM değişkeni (`site_name`) panelden tıklayıp imlece ekleme | `admin-email-template-editor.spec.ts` | ✅ Geçiyor |
| 4 | ÖZEL değişken tanımlama (inline form, canlı `slugify` anahtar önizlemesi) + Buton bloğu etiketine ekleme | `admin-email-template-editor.spec.ts` | ✅ Geçiyor (bkz. aşağıdaki bug 2 — kaydetme sonrası çalışıyor) |
| 5 | Canlı önizleme — değişkenler örnek/gerçek verilerle DOLU render edilir, ham `{{...}}` sızmaz | `admin-email-template-editor.spec.ts` | ✅ Geçiyor |
| 6 | Kaydet → Test E-postası Gönder (dev Ethereal SMTP) → başarı toast'ı (`sentTo` admin'in kendi adresi) | `admin-email-template-editor.spec.ts` | ✅ Geçiyor |
| 7 | Aktif Yap → listede "Aktif" rozeti + "kullanıldığı yer" (Özel) doğru | `admin-email-template-editor.spec.ts` | ✅ Geçiyor |
| 8 | "Düzen" seçiciden 2 Sütun seç (sarmalama) → boş sütun placeholder görünür | `admin-page-builder-columns.spec.ts` | ✅ Geçiyor |
| 9 | İkinci blok (Metin) boş sütuna sürüklenir — "sol Görsel, sağ Metin" | `admin-page-builder-columns.spec.ts` | ✅ Geçiyor |
| 10 | Kaydedilmiş 2 sütunlu içerik public'te DESKTOP'ta yan yana render edilir | `admin-page-builder-columns.spec.ts` | ✅ Geçiyor |
| 11 | AYNI içerik MOBİL viewport'ta (`md` kırılma noktası altı) alt alta düşer (§10.17.5, ek JS yok) | `admin-page-builder-columns.spec.ts` | ✅ Geçiyor |
| 12 | Unwrap (Tam Genişlik) — boş olmayan sütunda ConfirmDialog çıkar, onaylanınca İKİ blok da top-level'a düzleşir, veri KAYBOLMAZ | `admin-page-builder-columns.spec.ts` | ✅ Geçiyor |
| 13 | Public iletişim formu — honeypot BOŞ → 201 + successMessage, admin Gelen Kutusu'nda `NEW`, detay açılınca otomatik `READ` | `public-contact-form.spec.ts` | ✅ Geçiyor |
| 14 | Public iletişim formu — honeypot DOLU → sahte başarı (201) ama kayıt `SPAM` | `public-contact-form.spec.ts` | ✅ Geçiyor |
| 15 (BUG) | Sütunlar arası taşıma: bloğu DOLU bir sütuna (mevcut öğenin üzerine) sürükleme | `admin-page-builder-columns.spec.ts` (`test.fail()`) | ❌ **Uygulama çöküyor** — bkz. bug 3 aşağıda |

**13/13 "normal" senaryo yeşil + 1 bilinçli `test.fail()` (bug 3'ü izler).**

> **RETİRE EDİLDİ (bu turda, §10.19 Dalga 3.3 kapsamında)** — yukarıdaki 8-12 ve 15 numaralı
> satırların dayandığı `admin-page-builder-columns.spec.ts`, v2'nin sabit "Düzen" açılır menüsü
> ("2 Sütun" öğesi, "Satıra blok ekle" butonu, "Tam Genişlik" butonu) üzerine yazılmıştı. v3
> hiyerarşik `container` mimarisi bu UI'ı TAMAMEN supersede etti (bkz. `.claude/design-notes-page-
> builder-containers.md` §8) — dosya çalıştırıldığında (bu turda doğrulandı) 3/3 gerçek testi artık
> DOM'da var olmayan elemanları arayarak başarısız oluyordu (`admin uygulaması çökmez` testi hariç
> tutulursa 2/2 canlı senaryo net biçimde kırık). Bu, bir regresyon DEĞİL — mimarın bilinçli "supersede"
> kararının doğal sonucu. Dosya silindi (`git rm`); kapsadığı senaryoların (sarmalama, boş-sütuna-
> ekleme, sütunlar-arası-taşıma, unwrap-onaylı, mobil yığılma) v3 karşılığı aşağıdaki **§10.19
> Dalga 3.3** bölümündeki `admin-page-builder-containers.spec.ts`'e taşındı/genişletildi. Bug 3
> ("sütunlar arası taşıma: DOLU bir sütuna sürükleme admin'i çökertiyor") **v3'te YENİDEN
> DOĞRULANMADI** — kök nedeni gideren mimari desen (`onDragEnd`-only state mutasyonu) v3'ün
> `builder-canvas.tsx`'inde AYNEN korundu (bkz. dosya başlığı yorumu), bu yüzden regresyon riski
> düşük değerlendirildi, ancak "dolu bir konteynere sürükleyerek bırakma" senaryosu bu turun 6
> maddelik bağlayıcı listesinde YOKTU ve zaman kısıtı nedeniyle ayrıca tekrarlanmadı — **sonraki
> tur için önerilir** (frontend-agent'a değil, qa-agent'ın kendi backlog'una, çünkü bug zaten
> önceden düzeltilmiş bir davranışın regresyon kanıtı).

### Bulunan ve raporlanan bug'lar (bu turda) — kural gereği qa-agent DÜZELTMEZ, ilgili ajana yönlendirir

**1. frontend-agent — `useEmailTemplateEditor`: sayfa ilk yüklenirken tekrarlanan `GET` isteği geç
dönüp kullanıcı düzenlemesini sessizce sıfırlıyor (dar pencereli veri kaybı, ORTA öncelik).**
Şablon editörü açıldığında `GET /admin/notifications/templates/{id}` isteği tek bir mount'ta
**4 kez** tetikleniyor (network trace ile doğrulandı — 2'şerli 2 grup, ~200-300ms arayla; büyük
ihtimalle React Strict Mode'un dev-modu çift-effect'i + Next.js App Router navigasyon/RSC
mount'unun üst üste binmesi). `load()`'un hiçbir istek iptali/AbortController'ı veya "yalnızca en
son isteğin yanıtı kazanır" koruması yok — `applyLoaded()` HANGİ sırada dönerse dönsün state'i
KOŞULSUZ uyguluyor. Sonuç: kullanıcı sayfa açılır açılmaz (~1-2sn içinde) bir alanı doldurursa, geç
dönen bir yanıt o düzenlemeyi SESSİZCE sıfırlayabiliyor. qa-agent'ın testi bunu `page.waitForTimeout(1000)`
ile atlatıyor (bkz. `admin-email-template-editor.spec.ts` madde 2 yorum bloğu) — kalıcı düzeltme
frontend-agent'ın: `load()`'a bir "istek nesli" sayacı/AbortController eklenip yalnızca EN SON
başlatılan isteğin yanıtının uygulanması gerekir.

**2. frontend-agent — `components/admin/email-editor/variable-panel.tsx`: yeni tanımlanan özel
değişken panelde HİÇ görünmüyor (design-notes §A.7 ihlali, YÜKSEK öncelik — özellik fiilen
kullanılamaz).** "Özel Değişken Ekle" formu doldurulup "Ekle"ye basıldığında form KAPANIYOR
(`handleAdd()` başarıyla çalışıp `customVariables` state'ine ekliyor) ama panel satırları
`groupVariables(filtered)` — bu, YALNIZCA `variables` PROP'undan (sunucudan EN SON YÜKLEMEDE gelen,
DB'ye kaydedilmiş liste) türetiliyor. Component'e ayrıca geçirilen `customVariables` (henüz
KAYDEDİLMEMİŞ yeni tanım) render'a HİÇ katılmıyor — yalnızca "en fazla 20" sayacı ve
`onAddCustomVariable` çağrısı için okunuyor. Kullanıcı "tanımla → hemen ekle" akışını (design-notes
§A.7: "Eklenen değişken ANINDA 'Özel Değişkenler' grubunun listesine düşer") DENEYEMEZ — değişken
yalnızca şablon KAYDEDİLİP sayfa yeniden yüklendikten SONRA kullanılabilir hale geliyor. qa-agent'ın
testi bu yüzden "tanımla → Kaydet → bloğa dön → şimdi görünen değişkeni ekle" sırasını izliyor (bkz.
`admin-email-template-editor.spec.ts` madde 7-10 yorumları). Düzeltme: `VariablePanel` içinde
render'a giren liste `variables` ile `customVariables`'ın (henüz sunucuda karşılığı olmayanlar)
BİRLEŞİMİ olmalı.

**3. frontend-agent — KRİTİK: sütunlar arası blok taşıma (dolu bir sütuna sürükleme) admin
uygulamasını çökertiyor.** Bir bloğu (özellikle TipTap tabanlı bir Metin bloğunu) BOŞ OLMAYAN bir
sütuna, mevcut bir sıralanabilir öğenin ÜZERİNE sürüklemek React'in "Maximum update depth exceeded"
hatasına yol açıyor (gerçek `pageError` olarak yakalandı, tarayıcı konsolunda doğrulandı). Yığın izi
`PureEditorContent.componentDidMount → init → forceUpdate` (`@tiptap/react` `EditorContent`)
üzerinden geliyor — taşınan blok yeni sütuna yeniden-ebeveynlenirken (re-parent) TipTap editörünün
ard arda remount edilmesi bir sonsuz güncelleme döngüsüne giriyor. Sonuç: Error Boundary'ye düşülüyor
("Beklenmeyen bir hata oluştu"), kullanıcı sayfayı yenilemeden DEVAM EDEMİYOR — kaydedilmemiş TÜM
değişiklikler kaybolma riskiyle karşı karşıya. **Boş bir sütuna bırakmak ETKİLENMİYOR** (yalnızca
DOLU sütuna/mevcut öğenin üzerine bırakmak tetikliyor). Reprodüksiyon adımları + tam stack trace:
`admin-page-builder-columns.spec.ts`'teki ayrı, `test.fail()` ile işaretli test (`"BUG
(frontend-agent) — sütunlar arası taşıma..."`) — bu test BEKLENEN davranışı yazar ve bug
düzeltilince "beklenmedik biçimde geçti" diye kırmızıya dönüp işaretin kaldırılması gerektiğini
haber verir. Ana test bu yüzden dolu-sütuna-taşımayı **atlar** (kapsamın geri kalanı bu çökme
yüzünden maskelenmesin diye) — wrap/boş-sütuna-bırak/unwrap/public-render kapsamı ayrı, sağlam bir
testte kalır.

**4. backend-agent — bilgi amaçlı, ORTA öncelik: `purpose = CUSTOM` bir e-posta şablonu bir kez
`POST .../activate` ile aktifleştirildikten SONRA hiçbir uçla tekrar deaktive/silinemez.**
`activate` endpoint'i yalnızca `purpose !== "CUSTOM"` iken kardeş satırları pasifleştiriyor
(§10.16.3 "CUSTOM'da teklik kuralı uygulanmaz" kararının doğal bir sonucu), `PATCH` gövdesi
`isActive` alanını KABUL ETMİYOR, ve `DELETE` `isActive === true` iken KOŞULSUZ 409 dönüyor. Sonuç:
admin panelinden aktifleştirilen bir CUSTOM şablon kalıcı olarak silinemez hale geliyor — kullanıcı
onu "pasifleştirmenin" hiçbir yolu yok. Kritik bir güvenlik/veri sorunu değil (yalnızca kalıcı,
silinemeyen bir satır birikimi) ama gerçek bir kullanılabilirlik açığı. qa-agent'ın kendi fixture
temizliği bu yüzden bu durumu YUTUYOR (bkz. `tests/e2e/support/notifications-fixtures.ts` başlığı) —
gerçek bir düzeltme (ör. CUSTOM için ayrı bir "Pasifleştir" ucu veya `PATCH`'in `isActive: false`
kabul etmesi) backend-agent'ın kararı.

### qa-agent'ın kendi test tasarımında bulup düzelttiği flaky kaynakları (bu turda)

1. **`getByLabel(...)` gerçek `<label htmlFor>` (`Field` bileşeni) eşleşmelerinde tekrar tekrar
   90s'de bile çözümlenmeden asılı kalıyordu** — `admin-blog-tags.spec.ts::openEditPage`'teki
   BİREBİR AYNI, önceden belgelenmiş kategori (bkz. o dosyanın yorumu). `aria-label` tabanlı
   eşleşmeler ETKİLENMEDİ. Düzeltme: dinamik `block.id` içeren alan id'leri için `getByLabel`
   yerine kararlı `#id` veya SABİT SONEK (`[id$="-heading-text"]` gibi) CSS seçicilerine geçildi.
2. **dnd-kit `PointerSensor` sentetik imleç olaylarını ara sıra (~%30 koşumda) tamamen kaçırıyor**,
   sürükleme yerine tarayıcının varsayılan METİN SEÇİMİ tetikleniyordu. Kök neden bu ortamın
   sentetik pointer-olayı zamanlamasında (`admin-locale-management.spec.ts` başlığındaki "tarayıcı
   süreç çökmesi" notuyla AYNI kategori yerel Windows/Playwright sınırlaması) — uygulama kodu
   DEĞİL. Düzeltme: `admin-page-builder-columns.spec.ts::dragUntil()` — her denemede konumları
   TAZE okuyan, başarı koşulu sağlanana kadar (en fazla 4 kez) sürükleme hareketini TEKRARLAYAN bir
   sarmalayıcı.
3. Yeni CUSTOM e-posta şablonlarının backend'den **3 varsayılan başlangıç bloğuyla** (`logo-header`
   + `heading` + `text`) geldiği ilk denemede fark edilmedi (ARCHITECTURE.md'de belgelenmemiş ama
   kasıtlı bir UX kolaylığı, BUG değil) — test bunları baştan temizleyip kendi net blok sırasını
   kuracak şekilde düzeltildi.

Pre-existing, bu turdan bağımsız iki kez daha doğrulanan flake: `support/admin-session.ts`
başlığında ÖNCEDEN belgelenmiş refresh-token yarışı (`waitForURL(/\/dashboard/)` zaman aşımı) —
yeni bir bulgu DEĞİL, `retries: 1` ile telafi ediliyor.

## Admin kullanıcı yönetimi — yumuşak silme + self/last-admin regresyon matrisi (bu turda eklendi)

Kaynak: bir bug raporu üzerine backend-agent'ın soft-delete (`DELETE /admin/users/{userId}`,
`POST .../restore`, `GET /admin/users?includeDeleted`) implementasyonu + kullanıcının açıkça
istediği 3 regresyon senaryosu:
(a) tek admin varken kendini silmeye/rol düşürmeye çalış → engellenmeli,
(b) 2+ admin varken birini sil/düzenle → başarılı olmalı,
(c) admin olmayan bir kullanıcıyı sil/düzenle → başarılı olmalı.

Mevcut taban zaten kapsamlıydı: `backend/tests/integration/admin-users.test.ts` (RBAC + son-admin,
24 test → bu turda 31'e çıktı) ve `admin-users-soft-delete.test.ts` (14 test) + frontend
`tests/unit/a11y-admin-users.test.tsx` (mock API, a11y + golden-path). İnceleme SONUCUNDA iki
GERÇEK boşluk tespit edildi ve kapatıldı (kod DEĞİŞTİRİLMEDİ, yalnızca test eklendi):

1. **Boşluk — "self-block" testleri "son admin" kuralıyla KARIŞTIRILMIŞTI.** Mevcut self-delete
   (`admin-users-soft-delete.test.ts`) ve self-suspend (`admin-users.test.ts`) testleri SADECE
   aktörün AYNI ZAMANDA sistemin TEK aktif admini olduğu anda çalıştırılmıştı — backend'deki
   koşulsuz self-check (`admin-users.routes.ts`, `assertNotLastActiveAdmin` ÇAĞRILMADAN ÖNCE)
   ile "son admin" kuralı (`assertNotLastActiveAdmin`) o senaryoda TESADÜFEN aynı sonucu (409)
   üretiyordu — yani koşulsuz self-check SİLİNSE bile o testler yeşil kalırdı. Kapatıldı:
   `admin-users-regression-matrix.test.ts` 2+ aktif admin varken bile self-delete/self-suspend'in
   409 döndüğünü (last-admin kuralından İZOLE) doğrudan doğruluyor.
2. **Boşluk — senaryo (c)'nin `PATCH /role` ve `PATCH /status` başarı yolu hiç test edilmemişti.**
   Mevcut testlerin TAMAMI ya ADMIN hedefler ya da DELETED hedefler üzerindeydi; bir ADMIN'in bir
   EDITOR/VIEWER'ın rolünü/durumunu değiştirdiği başarı senaryosu (delete/restore için zaten
   vardı) role/status için YOKTU. Kapatıldı: aynı dosyada 4 test (rol düşür/yükselt, durum
   değiştir/geri al, hepsi non-admin hedefte).
3. Tamamlayıcı: DELETED bir ADMIN'in restore edilip rolünün korunduğu (önceden yalnızca
   EDITOR/VIEWER hedeflerle sınanmıştı) da eklendi.

| Katman | Senaryo | Dosya | Durum |
|---|---|---|---|
| Backend entegrasyon | (a) self-delete, self-rol-düşürme, self-suspend — TEK admin | `admin-users-soft-delete.test.ts`, `admin-users.test.ts` (mevcut) | ✅ Geçiyor |
| Backend entegrasyon | (a) self-suspend/self-delete — 2+ AKTİF ADMİN VARKEN de engellenir (izole edilmiş boşluk) | `admin-users-regression-matrix.test.ts` (yeni) | ✅ Geçiyor |
| Backend entegrasyon | (b) 2+ admin varken diğerini sil/rol değiştir/suspend et | `admin-users-soft-delete.test.ts`, `admin-users.test.ts` (mevcut) | ✅ Geçiyor |
| Backend entegrasyon | (c) admin-olmayan hedefte sil/restore | `admin-users-soft-delete.test.ts` (mevcut) | ✅ Geçiyor |
| Backend entegrasyon | (c) admin-olmayan hedefte rol/durum değiştir (boşluk) | `admin-users-regression-matrix.test.ts` (yeni) | ✅ Geçiyor |
| Backend entegrasyon | Race/write-skew (son 2 admin karşılıklı silme/suspend) | `admin-users.test.ts`, `admin-users-soft-delete.test.ts` (mevcut) | ✅ Geçiyor |
| Frontend unit + a11y | Buton disabled durumları (self/last-admin), golden-path sil/geri yükle, 409 görünürlüğü | `a11y-admin-users.test.tsx` (mevcut) | ✅ Geçiyor |
| **E2E (yeni katman)** | (a) gerçek backend state'inden hesaplanan disabled UI + API seviyesinde defense-in-depth (3×409) | `frontend/tests/e2e/admin-user-management.spec.ts` | ✅ Geçiyor |
| **E2E** | (c) rol + durum değişikliği panelden gerçek tıklamayla (VIEWER→EDITOR→askıya al→aktifleştir) | `admin-user-management.spec.ts` | ✅ Geçiyor |
| **E2E** | (c) sil → "Silinenleri göster" → geri yükle, gerçek tıklamayla | `admin-user-management.spec.ts` | ✅ Geçiyor |
| **E2E** | (b) VIEWER→ADMIN yükselt (2. aktif admin kurulur) → diğer admin'i suspend/aktifleştir/sil | `admin-user-management.spec.ts` | ✅ Geçiyor |

E2E katmanı bilinçli tercih: proje zaten olgun bir Playwright altyapısına sahipti (`frontend/
playwright.config.ts`, `tests/e2e/support/{api,admin-session}.ts`) — yeni bir framework
KURULMADI (kapsam dışı), mevcut desen (gerçek UI login + gerçek `fetch` fixture'ları) izlendi.
Bu katman, backend `app.inject` testlerinin (gerçek HTTP/tarayıcı YOK) ve frontend'in mock'lu
component testinin (gerçek backend YOK) KAPSAMADIĞI tek zinciri kapatıyor: gerçek buton tıklaması
→ gerçek ağ isteği → gerçek route handler → gerçek DB satırı → tabloya yansıma. Yeni fixture
yardımcıları `frontend/tests/e2e/support/admin-users-fixtures.ts`'te (`registerFixtureUser`,
`adminGetUserByEmail`, `adminUpdateRole`, `adminUpdateStatus`, `cleanupFixtureUserByEmail`).

**5/5 e2e senaryosu**, **7/7 yeni backend entegrasyon testi**, mevcut **743 backend + 451
frontend** testin TAMAMI bu turda yeniden koşuldu — hepsi yeşil, hiçbir regresyon yok.

### Bulgu (frontend-agent'a yönlendirilecek — qa-agent DÜZELTMEDİ)

**ORTA öncelik — UX tutarsızlığı, güvenlik açığı DEĞİL:** `app/admin/users/page.tsx`'teki
istemci-taraflı "Askıya Al" butonu devre dışı bırakma mantığı yalnızca `isLastActiveAdmin`'e
bakıyor (`disabled={isLastActiveAdmin}`), `isSelf`'e BAKMIYOR — oysa aynı dosyada silme butonu
için `deleteDisabled = isSelf || isLastActiveAdmin` şeklinde İKİSİNE BİRDEN bakılıyor. Backend'de
`PATCH /status`'ün self-check'i (`admin-users.routes.ts` satır ~204-206) admin sayısından TAMAMEN
bağımsız, koşulsuz bir kontroldür — bu yüzden 2+ aktif admin varken kullanıcı kendi satırındaki
"Askıya Al" butonuna TIKLAYABİLİYOR (buton enabled), onay diyaloğunu geçiyor, backend 409 ile
reddediyor (hesap GERÇEKTEN suspend olmuyor — kritik bir güvenlik açığı YOK) ama hata mesajı
`setError` (üst banner) ile gösteriliyor ve bu banner'ın dialog backdrop'ının ARKASINDA kaybolduğu
zaten dosyanın kendi yorumunda ("bilinen sorun") belgeli — kullanıcı NEDEN başarısız olduğunu
görmüyor, dialog kapanmadan asılı kalıyor. Bunu doğrulayan test: `admin-user-management.spec.ts`
"senaryo (b)" içindeki ilgili blok (buton enabled olduğunu VE hesabın gerçekten ACTIVE kaldığını
doğruluyor, hata mesajının görünürlüğünü İDDİA ETMİYOR — bu bilinen kozmetik sorunla test'i
kırılgan yapmamak için bilinçli bir tercih). Önerilen düzeltme: status butonunun `disabled`
ifadesine `isSelf` eklensin (silme butonuyla TUTARLI hale getirilsin) VE/VEYA rol/durum
hatalarının da (silme gibi) `toast` ile gösterilmesi sağlansın.

## Ana sayfa `(site)` route-group parity — regresyon testi (bu turda eklendi)

Kaynak: gerçek bir bug — `frontend/src/app/[lang]/page.tsx` (ana sayfa, `/`) yanlışlıkla
`[lang]/(site)/layout.tsx` route-group'unun DIŞINDA duruyordu. Next.js'te `(site)` gibi
parantezli klasörler URL'e segment EKLEMEZ ama SADECE kendi İÇİNDEKİ sayfaları sarar — bu
grubun bir KARDEŞİ olarak duran `[lang]/page.tsx` ortak `SiteHeader`/`SiteFooter`'ı, admin
panelinden yönetilen Navigasyon menüsünü, `--site-primary` vb. Görünüm CSS değişkenlerini ve
Özel CSS/JS enjeksiyonunu HİÇ almıyordu — admin panelinde yapılan hiçbir değişiklik ana sayfada
görünmüyordu (diğer TÜM public sayfalar zaten `(site)/` içinde oldukları için ETKİLENMEMİŞTİ).
Düzeltme: sayfa `[lang]/(site)/page.tsx`'e taşındı, `(site)/[slug]/page.tsx` ile AYNI desene
uyacak şekilde sadeleştirildi (header/footer'ı kendisi render ETMEZ). URL yapısı DEĞİŞMEDİ.

| # | Senaryo | Dosya | Durum |
|---|---|---|---|
| 1 | Ana sayfa ile GERÇEK bir CMS sayfasının header/nav (`nav[aria-label="Site gezinme"]`) ve footer (`getByRole("contentinfo")`) DOM iskeleti BİREBİR aynı | `site-home-layout-parity.spec.ts` | ✅ Geçiyor |
| 2 | Admin panelinden (API üzerinden) navigasyona eklenen BENZERSİZ etiketli link + değiştirilen `primaryColor`, hem ana sayfada HEM DE bir CMS sayfasında yansır | `site-home-layout-parity.spec.ts` | ✅ Geçiyor |

**Regresyon kanıtı — kasıtlı olarak KIRILDI ve DOĞRULANDI:** `frontend/src/app/[lang]/(site)/
page.tsx`, dosya sisteminde geçici olarak (git'e DOKUNMADAN, salt `mv` ile) eski/bug'lı konumuna
(`frontend/src/app/[lang]/page.tsx`, `(site)/` DIŞINDA) taşınıp test tekrar çalıştırıldığında
**her iki senaryo da (retry'lerle birlikte) başarısız oldu** — test 1 farklı bir `aria-label`
("Ana gezinme", eski marketing `Navbar`'ından) yakaladı, test 2 `expect.poll` zaman aşımına
uğradı (nav/appearance değişikliği hiç yansımadı, çünkü sayfa artık `(site)/layout.tsx`'i
almıyordu). Dosya orijinal konumuna geri taşınıp (`diff` ile byte-birebir doğrulanarak) test
tekrar çalıştırıldığında **3/3 yeşil** döndü. Bu, testin regresyonu GERÇEKTEN yakaladığının
kanıtıdır.

Tasarım notu — `homePageId` KASITLI OLARAK ayarlanmıyor: `SiteSettings.homePageId` boşken `/`
kendi iç `Navbar`/`<footer>`'ı olan bir `FallbackHome` gösterir (bkz.
`components/marketing/fallback-home.tsx`) ama bu içerik de `[lang]/(site)/page.tsx` İÇİNDE
render edildiği için YİNE `(site)/layout.tsx`'in SiteHeader/SiteFooter/nav/appearance'ını
ÜSTÜNE alır — bu senaryo regresyonu doğrulamak için zaten yeterlidir ve `fetchHomepageServer()`'ın
`revalidate: 60` önbelleğinin gerçek bir "Ana Sayfa" atanmasından sonra tazelenmesini bekleyen
(~60sn'lik, gereksiz) bir ek gecikmeden kaçınır. `FallbackHome`'un kendi `<footer>`'ı `(site)/
layout.tsx`'in `<main>`'i İÇİNE nested olduğu için HTML5 spesine göre `contentinfo` rolünü
ALMAZ (yalnızca üst düzey `<footer>` alır) — bu yüzden `getByRole("contentinfo")` genel `footer`
etiket seçicisinden DAHA GÜVENİLİRDİR (ilk taslakta generic `footer` seçicisi 2 eşleşme
buldu — strict-mode ihlali — bu yüzden değiştirildi).

Bilinen zamanlama karakteristiği (yeni bulgu DEĞİL, `admin-locale-management.spec.ts` "madde 7"
ile AYNI kategori): `(site)/layout.tsx`'in navigasyon/appearance fetch'leri `revalidate: 60` ile
önbelleklidir; admin panelinden yapılan bir değişikliğin siteye yansıması anlık DEĞİL, en fazla
~60sn sürebilir. Test 2 bu yüzden `expect.poll({ timeout: 90_000 })` kullanır ve dosya
`test.describe.configure({ timeout: 150_000, retries: 2 })` ile genişletilmiştir (Playwright'ın
varsayılan 30sn test/hook timeout'u bu pencereyi keser) — yerel koşumda test 2 tipik olarak
~1 dakika sürer. CI'daki temiz bir Linux runner'da daha tutarlı/hızlı olması beklenir.

Yeni fixture yardımcıları `frontend/tests/e2e/support/api.ts`'e eklendi: `getAdminAppearance`,
`patchAppearance`, `getNavigationConfig`, `updateNavigationConfig` (tam-değiştirme/replace
semantiğine dikkat — teardown orijinal DTO'yu AYNEN geri yazar) ve genel amaçlı `getAdminSettings`/
`patchSiteSettings` (bu turda başka bir senaryoda kullanılmadı, ama `homePageId` gibi diğer
`SiteSettings` alanlarını değiştirmesi gereken gelecekteki testler için hazır bırakıldı).

## §Galeri Bloğu v2 (çoklu görsel, sürükle-sıralama, Grid/Carousel/Masonry) — E2E + component kapsamı (bu turda eklendi)

Kaynak: page-builder'daki "Galeri" bloğu tek-görsel taklidi olan eski halinden gerçek çoklu-görsel,
sürükle-sıralanabilir, 3 stil varyantlı (Grid/Carousel/Masonry) bir WordPress-tarzı galeriye
dönüştürüldü (frontend `lib/page-builder/types.ts::GalleryBlock`/`GALLERY_MAX_IMAGES`,
`components/admin/page-builder/blocks/gallery-block.tsx`, `components/site/blocks/gallery-block.tsx`;
backend `pages.schemas.ts::GalleryBlockDataSchema`, zaten backend-agent'ın `backend/tests/unit/
pages-gallery-schema.test.ts`'i ile unit-seviyesinde kapsanmıştı). Bu tur, projede daha önce
"yalnızca admin süsü kalan özellik" diye adlandırılan hata sınıfını (bir özelliğin admin'de
çalışıp public sitede GERÇEKTEN render edilmemesi) özellikle hedef alarak, gerçek backend +
Postgres'e (`saas_e2e`) karşı hem admin editörü hem de public site render'ını doğrular.

| # | Senaryo | Dosya | Durum |
|---|---|---|---|
| 1 | Boş durum (`EmptyState`) → "Görsel Ekle" → `MediaPicker` ÇOKLU seçim modunda açılır → 2 GERÇEK görsel (magic-byte doğrulamasından geçen PNG, `uploadTestMedia`) seçilir → thumbnail grid'inde ikisi de görünür, sayaç "2 / 30" | `admin-page-builder-gallery.spec.ts` | ✅ Geçiyor |
| 2 | Klavye ile sürükle-sıralama (dnd-kit `KeyboardSensor`: tutamaca odaklan → Space → ArrowRight → Space) — 3 görselin ilk ikisi yer değiştirir, kaydedilip sayfa YENİDEN açıldığında (taze `GET`) sıra kalıcıdır | `admin-page-builder-gallery.spec.ts` | ✅ Geçiyor |
| 3 | Alt metni eksik görselde uyarı rozeti (`title="Alt metin eksik"`) görünür, alt metin girilince kaybolur, tekrar boşaltılınca GERİ gelir (canlı doğrulama) | `admin-page-builder-gallery.spec.ts` | ✅ Geçiyor |
| 4 | Grid ⇄ Carousel ⇄ Masonry geçişi (`aria-pressed`), kaydedilip sayfa yeniden açıldığında stil seçimi KORUNUR | `admin-page-builder-gallery.spec.ts` | ✅ Geçiyor |
| 5 | 30 görsel limiti — **pragmatik, component-seviyesinde** (aşağıya bkz.): 30/30'da "Görsel Ekle" disabled + uyarı title'ı, 28/30'da `MediaPicker.maxSelection` doğru hesaplanır (2), 25/30 (`nearLimit` eşiği) sayaç `text-warning` stiline döner, 10/30'da dönmez | `frontend/tests/unit/gallery-block-editor-limit.test.tsx` | ✅ Geçiyor (4/4) |
| 6 (KRİTİK) | Public render — Grid: `[class*="auto-fit"]` gerçekten DOM'da, doğru `<figure>` sayısı, Carousel/Masonry'ye özgü class'lar YOK (3 stilin GERÇEKTEN farklı DOM ürettiğinin kanıtı) | `admin-page-builder-gallery.spec.ts` | ✅ Geçiyor |
| 7 (KRİTİK) | Public render — Carousel: `role="region" name="Galeri, kaydırmalı görünüm"` + `[class*="snap-x"]` + "Sonraki/Önceki görsel" okları gerçekten DOM'da | `admin-page-builder-gallery.spec.ts` | ✅ Geçiyor |
| 8 (KRİTİK) | Public render — Masonry: `[class*="columns-2"]` gerçekten DOM'da | `admin-page-builder-gallery.spec.ts` | ✅ Geçiyor |
| 9 (KRİTİK) | Public render — boş galeri (`images: []`) HİÇBİR ŞEY render ETMEZ: iki benzersiz metin bloğu arasına yerleştirilip aradaki DOM'da (blok-seviye `nextElementSibling`) sızmış boş bir konteyner OLMADIĞI doğrudan doğrulanır | `admin-page-builder-gallery.spec.ts` | ✅ Geçiyor |

**9/9 Playwright senaryosu + 4/4 yeni unit test yeşil** (izole 4 kez, tam suite içinde 1 kez
tekrar koşuldu — bkz. aşağıdaki "bilinen ortam sınırlaması" notu). Mevcut **460 frontend unit
test** bu turda yeniden koşuldu, hepsi geçti (yeni dosya dahil 84 dosya).

### Yöntem notları

- **30 görsel limiti bilinçli olarak Playwright'ta test EDİLMEDİ** — 30 gerçek dosya
  yükleme/seçme akışı hem yavaş hem de (30 kart arasından doğru olanları tıklama) kırılgan
  olurdu. Bunun yerine `GalleryBlockEditor`'a doğrudan 30 öğelik bir `images` state'i verilen bir
  component testiyle (`media-picker-multiple.test.tsx` ile AYNI mock deseni) "Görsel Ekle"
  butonunun disabled davranışı ve `MediaPicker.maxSelection` hesaplaması doğrulandı — görev
  tanımındaki "pragmatik ol" yönergesine uygun, gerekçesi yukarıda not edildi.
- **Public-render testleri UI ÜZERİNDEN DEĞİL, `patchPageBlocks` (doğrudan `PATCH /admin/pages/
  {id}`) ile kuruldu** — `admin-page-builder-columns.spec.ts`'teki AYNI desen (görev tanımı madde
  7). `GalleryBlockDataSchema.images[].url` backend'de yalnızca `min(1)` string olduğu için (gerçek
  bir URL formatı ZORUNLU değil) sabit `https://example.com/...` URL'leri yeterliydi, gerçek medya
  yüklemeye GEREK yoktu.
- **Reorder testinde GERÇEK bir dosya yükleme gerekti** (MediaPicker'ın kart tıklamalarını
  tetikleyebilmek için) — `tests/e2e/support/api.ts`'e `uploadTestMedia` (geçerli magic-byte'lı
  1x1 PNG, backend'in `detectImageMimeType` doğrulamasını GEÇER), `setTestMediaAltText`,
  `deleteTestMedia` ve `patchPageBlocks` yardımcıları eklendi.

### qa-agent'ın kendi test tasarımında bulup düzelttiği flaky kaynakları (bu turda)

1. **dnd-kit `KeyboardSensor` — art arda, ARADA BEKLEME OLMADAN gönderilen tuş basışları
   kaçırılıyordu.** `KeyboardSensor.attach()` (`node_modules/@dnd-kit/core/dist/core.esm.js`)
   "kaldır" (Space) tuşunun AYNI keydown olayında sensörü başlatıyor ama hareket/"bırak"
   tuşlarını işleyecek asıl dinleyiciyi `setTimeout(() => this.listeners.add(...))` İLE (bir
   sonraki turda) ekliyor — `Space` hemen ardından `ArrowRight` gönderilince ikincisi bu
   dinleyici henüz TAKILMADAN gelip SESSİZCE YUTULUYORDU (standalone bir betikle doğrulandı:
   aradaki beklemeler kaldırılınca sıralama HİÇ değişmiyordu, 150-200ms eklenince HER SEFERİNDE
   değişti). `dragUntil`/`dragByHandle` (pointer sensörü) başlığındaki "sentetik olay zamanlaması"
   bulgusuyla AYNI kategoriden bir test-ortamı sınırlaması (uygulama kodu DEĞİL). Düzeltme: tuş
   basışları arasına `page.waitForTimeout(150)` eklendi (bkz. dosyadaki uzun yorum).
2. **Kendi test fixture slug'ları 48 karakter sınırını aşıyordu ve bu bir GERÇEK backend bug'ını
   (aşağıya bkz.) tetikliyordu.** İlk taslakta `qa-e2e-gallery-<varyant>-<13hane-timestamp>-<4hane-
   rastgele>` deseni 48-51 karakter arasında değişiyordu. Düzeltme: `createHostPage()` artık
   taban-36 kompakt bir `unique` üretir (`qa-gal-<varyant>-<~11 karakter>`, her zaman < 40 karakter)
   VE (savunma derinliği için) sayfanın ID'sini DEĞİL backend'in DÖNDÜRDÜĞÜ `created.slug`'ı
   kaynak-doğruluk olarak kullanır (kendi ürettiği yerel `slug` değişkenini DEĞİL) — böylece
   backend ileride slug'ı başka bir nedenle değiştirse bile test kendi kendini düzeltir.
3. **Boş-galeri testinin ilk hâli yanlış DOM düğümünü ölçüyordu (test bug'ı, uygulama bug'ı
   DEĞİL).** `getByText("QA_GALLERY_MARKER_BEFORE")` `TextBlockView`'ın kök `<div class="prose">`'u
   DEĞİL, `dangerouslySetInnerHTML` ile basılan İÇTEKİ `<p>` düğümünü buluyordu — bu `<p>`'nin
   `nextElementSibling`'i her zaman `null` (kendi `div`'i içinde TEK çocuk), blok-seviye kardeşlik
   ile ilgisi yok. Düzeltme: `div.prose` seçicisiyle blok'un KÖK elemanı hedeflendi.
4. Pre-existing, bu turdan BAĞIMSIZ doğrulanan flake: `support/admin-session.ts` başlığında
   ÖNCEDEN belgelenmiş GERÇEK UI login zaman aşımı (refresh-token rotasyon yarışı) — 4 izole
   koşumdan 1'inde `beforeAll` bu yüzden başarısız oldu (dosyadaki TÜM testler o koşumda
   çalışmadı), hemen ardından yeniden çalıştırılınca 9/9 yeşil döndü. Yeni bir bulgu DEĞİL,
   `retries: 1` ile kısmen telafi ediliyor; kalıcı düzeltme `admin-session.ts` başlığında zaten
   frontend-agent'a yönlendirilmiş durumda.

### Bulunan ve raporlanan bug — backend-agent'a yönlendirilecek (qa-agent DÜZELTMEDİ)

**ORTA-YÜKSEK öncelik — `Page.slug` 48 karakterden uzun olduğunda SESSİZCE kırpılıyor (galeriye
özgü değil, genel bir `slugify()` davranışı).** `backend/src/modules/pages/pages.routes.ts`
(`POST /admin/pages` satır ~193: `slug: slug ? slugify(slug) : slugify(title)`; `PATCH` satır
~277'de de aynı desen) istemcinin AÇIKÇA gönderdiği, zaten geçerli/URL-güvenli bir `slug` değerini
BİLE `slugify()`'dan geçiriyor — bu fonksiyon (`backend/src/lib/slug.ts` satır 14) `.slice(0, 48)`
ile SESSİZCE 48 karaktere kırpıyor. Reprodüksiyon: `POST /admin/pages` gövdesinde 49+ karakterlik
bir `slug` gönderildiğinde, dönen `Page.slug` istemcinin gönderdiğinden FARKLI (son karakter(ler)
eksik) oluyor — `GET /pages/{istemcinin-gönderdiği-orijinal-slug}` 404 veriyor, yalnızca kırpılmış
hâli çalışıyor. HİÇBİR hata/uyarı YOK (422 DEĞİL, sessiz veri değişikliği). qa-agent bunu galeri
public-render testleri hazırlanırken kendi 49-51 karakterlik fixture slug'larıyla YANLIŞLIKLA
tetikledi (standalone bir Node betiğiyle izole tekrar üretildi ve doğrulandı — `backend/src/lib/
slug.ts` ile `pages.routes.ts` okunarak kök nedene ulaşıldı). **Galeri özelliğine ÖZGÜ değil**,
`slugify()`'ı aynı desenle kullanan TÜM `Page` slug işlemlerini (muhtemelen blog/portföy/ürün de
benzer bir yol izliyorsa onları da) etkileyen genel bir davranış. Önerilen düzeltmelerden biri:
(a) istemci `slug` alanını AÇIKÇA gönderdiyse `slugify()` TEKRAR uygulanmasın (yalnızca `title`'dan
TÜRETİLİYORSA normalize edilsin), veya (b) 48 karakteri aşan bir `slug` sessizce kırpmak YERİNE
422 ile REDDEDİLSİN. Ek risk: aynı 48-karakterlik önek paylaşan iki FARKLI uzun slug bu şekilde
AYNI değere kırpılıp anlaşılmaz bir `409 CONFLICT`'e yol açabilir. qa-agent kendi testini bu
davranışa karşı SAĞLAM hale getirdi (yukarıdaki "flaky kaynakları" madde 2) — bu, backend
davranışını DÜZELTMEZ, yalnızca qa-agent'ın kendi test sonucunu bu bug'dan İZOLE eder.

## §10.19 Sayfa içerik bloklarında hiyerarşik konteyner (`container`) mimarisi — unit kapsamı (Dalga 1/2, önceki turda eklendi)

Kaynak: `.claude/design-notes-page-builder-containers.md` (Dalga 1.3/2.5 görev tanımları),
`ARCHITECTURE.md` §10.19. **Not (kapsam netliği):** bu bölüm backend-agent/frontend-agent'ın
Dalga 1–2'de eklediği **unit** test tabanını belgeler — documentation-agent tarafından
dosya/senaryo envanteri olarak yazılmıştır (testler bizzat çalıştırılmadı, yalnızca kaynak
okunarak doğrulandı). **Dalga 3 (qa-agent, e2e) bu turda TAMAMLANDI** — bkz. aşağıdaki
"§10.19 Dalga 3.3" bölümü.

| # | Kapsam | Dosya | Not |
|---|---|---|---|
| 1 | Derinlik sınırı (`MAX_CONTAINER_DEPTH=4`): tam sınırda kabul, +1 seviyede 422, **10.000 seviyelik patolojik payload'da `RangeError` FIRLAMADAN temiz 422** (imza regresyon testi, security-agent §13.1) | `backend/tests/unit/pages-container-schema.test.ts` | Yeni |
| 2 | Konteyner başına çocuk sınırı (`MAX_CHILDREN_PER_CONTAINER=24`), toplam düğüm (`MAX_TOTAL_PAGE_NODES=300`), gövde-boyutu (256 KB) tavanları | `backend/tests/unit/pages-container-schema.test.ts` | Yeni |
| 3 | Legacy `columns` → kanonik `container` dönüşümü (v1 `ratio`, v2 `width`, `gap`/`verticalAlign` eşlemesi) — v3'te bu dosya TAMAMEN yeniden yazıldı ("columns" artık hiç üretilmiyor, yalnızca kabul ediliyor) | `backend/tests/unit/pages-columns-schema.test.ts` | Yeniden yazıldı |
| 4 | `container.children` içindeki `text` bloklarının sanitize edilmesi (§10.17.4 stored-XSS'in v3'te tekrar açılmaması regresyonu) + legacy `columns` dalının korunması | `backend/tests/unit/sanitize-page-blocks.test.ts` | Güncellendi |
| 5 | Ağaç işlemleri: `findNode`/`findParentId`/`getContainerChildren`/`isDescendant` (kritik guard — bir konteyneri kendi torununa taşımayı/bırakmayı reddi), `containerDepth`/`subtreeDepth`, `countNodes`, `insertNode`/`removeNode`/`moveNode` (kök `MAX_CHILDREN_PER_CONTAINER`'a TABİ DEĞİL, gerçek konteynerler TABİ — mimarın §13.2 netleştirmesi doğrudan test ediliyor) | `frontend/tests/unit/page-builder-containers.test.ts` | Yeni (47 test) |
| 6 | `normalizePageNodes` — v1/v2/v3 girdileri, eksik `settings` alanlarının `DEFAULT_CONTAINER_SETTINGS`'ten tamamlanması, bozuk/tanınmayan veri | `frontend/tests/unit/page-builder-normalize.test.ts` | Yeni (17 test) |

Bu tur backend'de `backend/tests/unit/pages-container-schema.test.ts` (yeni) +
`pages-columns-schema.test.ts` (yeniden yazıldı) + `sanitize-page-blocks.test.ts`
(güncellendi) ile, frontend'de `page-builder-containers.test.ts` + `page-builder-normalize.test.ts`
(ikisi de yeni) ile genişledi. Orkestratörün bildirdiği toplam koşum sayıları: **backend 306
test, frontend 517 test** (bu turdan ÖNCEKİ turların birikimli toplamı dahil) — qa-agent bir
sonraki oturumda gerçek bir koşumla bu sayıları teyit etmeli, documentation-agent bunu
DOĞRULAMADAN aktarmaktadır.

### Eksik bırakılanlar (Dalga 1/2 turu için bilinçli, gerekçeli)

- **E2E (Dalga 3, qa-agent)** — bu turda (Dalga 1/2 turunda) YAPILMADI, sonraki turda (Dalga 3.3,
  bkz. aşağıdaki bölüm) TAMAMLANDI.
- **`presets.ts` (`createContainerFromPreset` × 7 ön ayar) ve editör tarafı bileşenleri
  (`container-settings-panel.tsx`, `layout-picker.tsx`, `builder-canvas.tsx`'in özyinelemeli
  hâli)** için component-seviyesi unit test bu envanterde GÖRÜLMEDİ — frontend-agent'a
  Dalga 2.5'in geri kalanı olarak devredilir (bu bölüm yalnızca `types.ts`/`normalize.ts`/
  `containers.ts` saf mantığını kapsayan dosyaları listeler).
- **`scanPageNodeStructure`/`flattenPageBlocks`'un kendi doğrudan unit testleri**
  (`backend/tests/unit/page-blocks.test.ts` gibi ayrı bir dosya) bu envanterde bulunamadı —
  bu iki fonksiyon şu an yalnızca `pages-container-schema.test.ts`/`sanitize-page-blocks.test.ts`
  üzerinden DOLAYLI olarak kapsanıyor; backend-agent'a doğrudan bir birim test dosyası
  eklemesi önerilir (özellikle `flattenPageBlocks`'un `container.children`'ı derinlikten
  bağımsız düzleştirdiğinin izole bir kanıtı için).

## §10.19 Dalga 3.3 — hiyerarşik konteyner (`container`) mimarisi, e2e kapsamı (bu turda eklendi)

Kaynak: `.claude/design-notes-page-builder-containers.md` §10 satır ~1027 "Dalga 3 (PR #3) — 3.3
qa-agent" görev tanımı (bağlayıcı, birebir 6 senaryo) + `.claude/design-notes-page-builder-
container-ui.md` (ui-designer spesifikasyonu, editör tarafı locator'ların kaynağı). Yukarıdaki
"Eksik bırakılanlar" notunun kapattığı boşluk. Gerçek backend + Postgres'e (`saas_e2e`) karşı,
gerçek tarayıcıda; dosya: `frontend/tests/e2e/admin-page-builder-containers.spec.ts` (YENİ).

| # | Senaryo (mimarın bağlayıcı listesi) | Durum |
|---|---|---|
| 1 | Boş-durum hero'sundaki "Yeni Konteyner Ekle" popover'ından 50/50 ("İki Eşit Sütun") ekle → her sütuna blok koy (Görsel + Metin) → kaydet → public'te doğrula (sol/sağ konum + genişlik eşitliği) | ✅ Geçiyor |
| 2 | 4 seviye iç içe konteyner kurulabilir, 5. seviyeyi denerken preset grid'i TAMAMEN devre dışı (`disabled` + doğru `title`) — editör `MAX_CONTAINER_DEPTH=4`'ü ÖNLEYİCİ olarak uygular | ✅ Geçiyor |
| 3 | Konteyneri kendi çocuğunun (boş) içine sürüklemeyi dene → `isDescendant` guard reddeder, ağaç DEĞİŞMEDEN kalır, editör KİLİTLENMEZ/çökmez (sürüklemenin bizzat gerçekten TETİKLENDİĞİ `DragOverlay` görünürlüğüyle kanıtlanır — aksi halde "değişmedi" iddiası sahte-pozitif olurdu) | ✅ Geçiyor |
| 4 | Legacy fixture — v1 (`ratio`) + v2 (`width`) şeklinde DB'ye ham yazılmış (`setRawPageBlocksDirectly`, bkz. aşağıdaki not) bir sayfa: dokunmadan public render → piksel oranı korunur (görsel bounding-box genişlik oranı, v1 ~2:1, v2 ~3:1, toleranslı); sonra editör ÜZERİNDEN kaydedilince API yanıtı TAMAMEN `type: "container"` (6/6 düğüm, `columns` sıfır) | ✅ Geçiyor |
| 5 | Unwrap onay diyaloğu — "Vazgeç" → hiçbir şey değişmez (içerik + konteyner SAĞLAM); "Konteyneri Kaldır" (onay) → konteyner kalkar, içerik (görsel URL/alt) KAYBOLMADAN üst seviyeye düzleşir, kalıcılık sayfa yeniden açılınca da korunur | ✅ Geçiyor |
| 6 | Mobil viewport'ta (`375px`) `direction:"row"` konteyner alt alta yığılır (`flex-col` taban, masaüstünde `md:flex-row` yan yana) — konteyner şekli `patchPageBlocks` ile GERÇEK bir yazma yolundan (normal API) kurulur | ✅ Geçiyor |

**6/6 senaryo yeşil** — dosya tek başına 3 kez, `admin-page-builder-gallery.spec.ts` ile birlikte
(regresyon kontrolü) 1 kez olmak üzere ardışık 4 koşumda tutarlı geçti (senaryo 3'ün dnd-kit
`PointerSensor` tabanlı adımı dahil — bkz. aşağıdaki flaky-kaynağı notu, gerçek bir kararsızlık
DEĞİL, bir defalık bir test-tasarımı hatasıydı ve düzeltildi).

### GÜNCELLEME (bu turda) — sabit "DÜZEN" panelinin kaldırılıp dinamik/pozisyonel konteyner
ekleme mekanizmasına (Elementor/Gutenberg tarzı) geçilmesi (frontend-agent, `.claude/design-notes-
page-builder-dynamic-container-insertion.md`)

`block-list.tsx`/`layout-picker.tsx` silindi; yerine `container-inserter.tsx`
(`NewContainerInserter` — canvas sonu/boş-durum, `BetweenContainersInserter` — dikey listelerde
kardeşler arası, `ContainerCard`'ın kontrol barındaki "+Alta") geldi. Preset karolarının
(`LayoutPresetTile`) `aria-label` semantiği DEĞİŞMEDİ, yalnızca artık bir `Popover` içinde —
bu yüzden `getByRole("button", { name: preset.label })` sorgusu tek başına hâlâ çalışıyor, ama
ÖNCE ilgili tetikleyiciye (`"Yeni Konteyner Ekle"` / `"Aralarına yeni konteyner ekle"` / `"Alta
yeni konteyner ekle"`) tıklanıp popover açılmalı. `"Ekleniyor: Konteyner (Seviye N)"` bağlam
satırı TAMAMEN kaldırıldı (pozisyonel modelde artık gerek yok) — bu metne dayanan tüm
assertion'lar kaldırıldı.

**Bulunan işlevsel boşluk (frontend-agent'a rapor edildi, qa-agent DÜZELTMEDİ):** yeni modelde
BOŞ bir konteynerin (`children.length === 0`) İÇİNE tek tıkla yeni bir KONTEYNER eklemenin yolu
YOK — `EmptyContainerDropZone` yalnızca İÇERİK BLOĞU ekletir (`PaletteBlockType`, `"container"`
İÇERMEZ), `BetweenContainersInserter` yalnızca 2+ çocuklu dikey listelerde belirir, kontrol
barındaki "+Alta" her zaman KARDEŞ ekler (aynı seviye, hedef konteynerin kendisi değil onun
ebeveyni). Eski modelde "bir konteyneri seç, panelden preset'e tıkla → seçili konteynerin İÇİNE
eklenir" akışı bunu çözüyordu; bu akış TAMAMEN kaldırıldı. Sonuç: sıfırdan derinlik inşa etmek
(örn. tek-sütun konteynerleri art arda iç içe geçirmek) artık YALNIZCA (a) çok-sütunlu bir
preset'in kendiliğinden ürettiği hazır alt konteynerler ÜZERİNDEN, (b) mevcut bir konteynerin
içine önce 2 içerik bloğu ekleyip between-inserter'ı kullanarak, veya (c) sürükle-bırakla mümkün
— tek tıkla "boş konteynerin içine boş bir konteyner ekle" YOK. `admin-page-builder-
containers.spec.ts` senaryo 2 (derinlik sınırı) ve senaryo 3 (`isDescendant` guard) bu yüzden
1-3. seviyelerin iskeletini `patchPageBlocks` fixture'ıyla kurup yalnızca senaryonun asıl iddiasını
(4. seviyenin UI'dan eklenebilirliği / sürükle-bırak reddi) gerçek tıklama/sürüklemeyle doğruluyor
— bu bir test-tasarımı ödünü, uygulamadaki bir bug'ı MASKELEMİYOR (yalnızca test kurulumunu
fixture'a taşıyor), ama gerçek bir kullanıcının da aynı sınırlamayla karşılaşacağı anlamına gelir;
frontend-agent'ın bunu kasıtlı bir tasarım kararı olarak mı yoksa kapatılması gereken bir boşluk
olarak mı değerlendireceğine karar vermesi gerekir.

### `frontend/tests/e2e/support/api.ts` genişletmesi (geriye dönük uyumlu, mevcut kullanımlar KIRILMADI)

- **`getPage(token, pageId)`** — `GET /admin/pages/{id}`, senaryo 4'ün "önce/sonra" API-seviyesi
  doğrulaması için.
- **`setRawPageBlocksDirectly(pageId, blocks)`** — senaryo 4'ün TEK zor kısmı: mimarın §2.1
  kararı gereği `PATCH /admin/pages/{id}` (dolayısıyla mevcut `patchPageBlocks`) her zaman
  backend'in yazma-anındaki `z.preprocess`'inden geçer ve `columns`'ı ANINDA `container`'a çevirip
  ÖYLE YAZAR — yani **normal API akışıyla "DB'de hâlâ columns duran" bir satır ÜRETİLEMEZ**
  (qa-agent bunu bizzat, elle bir `curl`/`fetch` deneyiyle doğruladı: yalnızca `blocks` içeren bir
  `PATCH` bile anında `container`'a dönüşüyor). v3 migration'ından ÖNCE kaydedilmiş, o zamandan
  beri hiç dokunulmamış GERÇEK bir tarihi satırı simüle etmenin tek yolu, backend'in ZATEN kurulu
  `prisma` CLI'ını (`npx prisma db execute --stdin --url=...`, **yeni npm bağımlılığı YOK**)
  `child_process.execFileSync` ile çağırıp `Page.blocks` (`pages` tablosu) kolonuna ham SQL
  `UPDATE ... SET blocks = '...'::jsonb` ile YAZMAKTIR — Zod şemasından hiç geçmeden. İçerik
  tamamen bu test dosyasının kendi ürettiği veridir (kullanıcı girdisi değil), tek tırnak kaçışı
  (`'` → `''`) bu bağlamda yeterlidir. `E2E_DATABASE_URL` ortam değişkeniyle override edilebilir
  (CI'da devops-agent farklı bir host/port kullanabilir).

### Bulunan ve DÜZELTİLEN bug'lar — qa-agent'ın KENDİ test tasarımında (uygulama kodu DEĞİL)

Kural gereği (proje kökü CLAUDE.md madde 3) flaky/yanlış-pozitif testler tolere edilmedi, kaynağı
bulunup düzeltildi — **ikisi de qa-agent'ın kendi locator seçimindeydi, `ContainerCard`/
`ContainerSettingsPanel` kodunda DEĞİL**:

1. **`getByRole("button", { name: "Konteyner ayarları" })` / `{ name: "Düzen" }` YANLIŞ-POZİTİF
   ikinci eşleşme üretiyordu.** `builder-canvas.tsx::ContainerCard`'ın başlık şeridi (seçim için
   tıklanabilir alan) kendisi de `role="button"` taşır ve kendi `aria-label`'ı YOKTUR — W3C
   erişilebilir-ad-hesaplama algoritması bu durumda İÇERİĞİNDEN (tüm alt metin/etiketler, iç içe
   butonların KENDİ `aria-label`'ları DAHİL) bir ad türetir. Sonuç: `getByRole` varsayılan alt-dize
   eşleşmesi hem DIŞ seçim `div`'ini (adı "...Konteyner ayarları Düzen...") HEM de İÇ "Ayarlar"/
   "Düzen" ikon butonunu birlikte yakalıyordu (`toHaveCount(1)` beklenirken `2` dönüyordu). Düzeltme:
   `page.locator('button[aria-label="..."]')` öz-nitelik seçicisine geçildi (mevcut `Sürükle: X`
   drag-handle deseniyle AYNI, kanıtlanmış yaklaşım).
2. **`getByText("Seviye 1"/"Seviye 2")` (exact olmadan) iki AYRI (iç içe olmayan) eşleşme
   üretebiliyordu** — bir konteyner SEÇİLİYKEN Layout Picker'ın "Ekleniyor: Konteyner (Seviye N)"
   bağlam satırı da alt-dize olarak "Seviye N"i içeriyor. Düzeltme: `exact: true`. Ayrıca, bir
   konteyner seçiliyken sağ panel (`ContainerSettingsPanel`) KENDİ "Seviye N" rozetini AYRICA
   render ettiği için (canvas kartındakiyle birebir aynı metin/sınıf) `.first()` de eklendi —
   bu ikinci durum bug DEĞİL, iki panelin bilinçli olarak aynı bilgiyi göstermesi.

Bu ikisi dışında **uygulama kodunda bug BULUNMADI** — 6 senaryonun hepsi ilk mantıksal
denemede (locator düzeltmeleri sonrası) beklenen davranışı sergiledi; `isDescendant` guard'ı,
derinlik/çocuk sınırları, unwrap onay akışı, legacy fixture piksel-parite'si ve mobil yığılma
mimarın/ui-designer'ın dokümante ettiği gibi çalışıyor.

### `admin-page-builder-columns.spec.ts` retirement — ayrıntı

Yukarıdaki "§10.16/§10.17" bölümündeki nota bkz. — bu dosya `git rm` ile SİLİNDİ (v2 UI'ın
supersede edilmesiyle 3 gerçek testinin TAMAMI çalıştırıldığında (bu turda doğrulandı) DOM'da
artık var olmayan elemanları arıyordu: "2 Sütun" `menuitem`'i, "Satıra blok ekle" butonu,
"Tam Genişlik" butonu — hiçbiri v3 `LayoutMenu`/`LayoutPicker`'da YOK). Kapsadığı senaryolar bu
bölümdeki yeni dosyaya taşındı/genişletildi.

### A11y (axe-core) durumu — mevcut jest-axe deseni içinde KISMİ kapsam

Proje a11y otomasyonu için Playwright `@axe-core/playwright` YERİNE bilinçli olarak **component-
seviyesi `jest-axe`** deseni kullanıyor (bkz. `frontend/tests/unit/a11y-*.test.tsx`, ~20 dosya) —
qa-agent bu turda yeni bir e2e-seviyesi axe bağımlılığı EKLEMEDİ (code-quality-agent'ın "yeni npm
bağımlılığı beklenmiyor" kuralına saygıyla, ve mevcut mimariyle tutarlılık için). Doğrulandı:
`frontend/tests/unit/a11y-content-editor.test.tsx` ZATEN `BlockList` (yeni `LayoutPicker`'ın 7
ön ayar karosu DAHİL) ve `BuilderCanvas`'ı (v3'ün özyinelemeli hâli) kapsıyor ve bu turda yeniden
koşulup 6/6 yeşil doğrulandı. **Boşluk:** `ContainerSettingsPanel` (Düzen/Boşluk/Arka Plan
bölümleri, segmented toggle'lar, `SpacingBoxControl`, `BackgroundControl`) ve iç içe geçmiş bir
`container` düğümünü (derinlik rozetleri, seçili-konteyner `ring` vurgusu) render eden
`BuilderCanvas` senaryosu için ÖZEL bir a11y testi YOK — bu, unit-test katmanına ait olduğu için
(frontend-agent'ın alanı, bkz. proje kökü CLAUDE.md ajan sınırları) qa-agent DÜZELTMEDİ,
**frontend-agent'a önerilir**: `a11y-content-editor.test.tsx`'e (veya yeni bir
`a11y-page-builder-containers.test.tsx`'e) `ContainerSettingsPanel` + iç içe `container` içeren
bir `BuilderCanvas` senaryosu eklensin.

## CI entegrasyonu (devops-agent'a not)

`frontend/playwright.config.ts` `webServer` ile frontend'i otomatik başlatır (`reuseExistingServer:
!process.env.CI`). Backend + `saas_e2e` veritabanı CI'da AYRI bir adım gerektirir — önerilen
şablon `backend`'in mevcut `ci.yml` job'ındaki `saas_test`/Postgres servisi deseninin birebir
kopyası (bkz. `.github/workflows/ci.yml` `backend` job'ı ve `backend/tests/setup/global-setup.ts`),
yalnızca veritabanı adı `saas_e2e` ve backend `DOTENV_CONFIG_PATH=backend/.env.e2e` ile ayrı
portta (4001) başlatılmalı. Test adımı **lint/build'den SONRA, deploy'dan ÖNCE** koşmalı (bkz.
proje kökü CLAUDE.md kural #5). Bu, qa-agent'ın önerisidir — `ci.yml`'i düzenlemek
devops-agent'ın sorumluluğundadır.

**Ek not (§10.19 Dalga 3.3, bu turda eklendi):** `admin-page-builder-containers.spec.ts::
setRawPageBlocksDirectly` çalışma zamanında `backend`'in `prisma` CLI'ını `npx prisma db execute
--stdin` ile, `cwd` olarak `../backend`'i (frontend köküne göre GÖRECELİ) kullanarak çağırır —
CI runner'ında `frontend/` ve `backend/` dizinlerinin AYNI checkout'ta, kardeş dizinler olarak
bulunması ve `backend/node_modules` (dolayısıyla `prisma` devDependency'si) kurulu olması
GEREKİR (zaten backend'in kendi test adımı için kurulu olacaktır, EK bir kurulum adımı
gerekmez). `E2E_DATABASE_URL` ortam değişkeni (varsayılan `postgresql://postgres:postgres@
localhost:5432/saas_e2e?schema=public`) CI'nin Postgres servisi farklı bir host/port
kullanıyorsa override edilmelidir.

## On-demand revalidation webhook (backend↔frontend) + "Metin" bloğu düzeltmeleri — bu turda eklendi

Kaynak: backend-agent'ın `triggerPublicPageRevalidation()` (`backend/src/lib/revalidate.ts`,
`pages.routes.ts`'teki 7 çağrı noktası: create/update/trash/restore/bulk/revision-restore) ve
frontend-agent'ın `POST /api/revalidate` webhook'u (`frontend/src/app/api/revalidate/route.ts`)
+ page-builder "Metin" bloğu düzeltmeleri (boş başlangıç içeriği, placeholder, çift-fokus-halkası
düzeltmesi). Her iki backend-agent/frontend-agent tarafı da bu turda **kendi geçici script'leriyle
(curl / ad-hoc Playwright) doğrulamış ama kalıcı bir test dosyası BIRAKMAMIŞTI** — qa-agent'ın
görevi buydu.

| # | Senaryo | Dosya | Durum |
|---|---|---|---|
| 1 | PUBLISHED sayfa oluşturma → doğru URL/`x-revalidate-secret` header/`{paths}` gövdesiyle webhook tetiklenir | `backend/tests/integration/revalidate.test.ts` | ✅ Geçiyor (yeni) |
| 2 | DRAFT sayfa → webhook TETİKLENMEZ; DRAFT→DRAFT güncelleme → TETİKLENMEZ | `backend/tests/integration/revalidate.test.ts` | ✅ Geçiyor (yeni) |
| 3 | DRAFT→PUBLISHED ve PUBLISHED→DRAFT (her iki yön) `PATCH` ile tetiklenir; zaten PUBLISHED bir sayfanın yalnızca içerik güncellemesi de tetikler | `backend/tests/integration/revalidate.test.ts` | ✅ Geçiyor (yeni) |
| 4 | Çevirisi (en) olan yayındaki sayfa için TÜM etkin dillerin path'leri (`/tr/x`, `/en/y`) gönderilir; boş/silinmiş çeviri için path ÜRETİLMEZ | `backend/tests/integration/revalidate.test.ts` | ✅ Geçiyor (yeni) |
| 5 | `SiteSettings.homePageId` ise path slug'sız (`/tr`) üretilir | `backend/tests/integration/revalidate.test.ts` | ✅ Geçiyor (yeni) |
| 6 | Bulk trash/restore/publish aksiyonları (yalnızca yayındaki/geçiş yapan öğeler için) tetikler; bulk trash TASLAK sayfa için tetiklemez | `backend/tests/integration/revalidate.test.ts` | ✅ Geçiyor (yeni) |
| 7 | Revizyon geri yükleme, sayfa YAYINDAYSA tetikler | `backend/tests/integration/revalidate.test.ts` | ✅ Geçiyor (yeni) |
| 8 | Frontend webhook'u 500 dönse VEYA ağ hatası (ECONNREFUSED) verse dahi asıl admin isteği (create/update) BAŞARIYLA tamamlanır (best-effort tolerans) | `backend/tests/integration/revalidate.test.ts` | ✅ Geçiyor (yeni) |
| 9 | `REVALIDATE_SECRET` yapılandırılmamışsa (boş) özellik SESSİZCE no-op — fetch hiç çağrılmaz | `backend/tests/integration/revalidate.test.ts` (ayrı `describe`, `vi.resetModules()` + taze `buildApp()` ile) | ✅ Geçiyor (yeni) |
| 10 | `POST /api/revalidate` — doğru secret + geçerli path(ler) → 200 + `revalidatePath` her path için çağrılır | `frontend/tests/unit/api-revalidate-route.test.ts` | ✅ Geçiyor (yeni) |
| 11 | Eksik/yanlış/farklı-uzunluktaki secret → 401, `revalidatePath` ÇAĞRILMAZ; `REVALIDATE_SECRET` env boşsa da 401 (fail-closed) | `frontend/tests/unit/api-revalidate-route.test.ts` | ✅ Geçiyor (yeni) |
| 12 | Boş `paths`, `/` ile başlamayan bir path (karışık dizide bile TÜMÜ reddedilir), eksik/yanlış tip, bozuk JSON → 400 | `frontend/tests/unit/api-revalidate-route.test.ts` | ✅ Geçiyor (yeni) |
| 13 | Yeni bir Metin bloğu GERÇEKTEN boş başlar ("0 karakter"), placeholder (`data-placeholder="Metin girin…"` + `is-editor-empty`) DOM'da görünür ve görsel olarak render edilir (`::before` computed style) | `frontend/tests/e2e/admin-page-builder-text-block.spec.ts` | ✅ Geçiyor (yeni) |
| 14 | Editöre fokus verildiğinde `.ProseMirror`'ın KENDİ outline'ı `none` — tek görünür gösterge sarmalayıcının `focus-within:ring`'i (çift-halka düzeltmesi) | `frontend/tests/e2e/admin-page-builder-text-block.spec.ts` | ✅ Geçiyor (yeni) |
| 15 | Editörün boş alt boşluğuna (min-height dolgu alanı) tıklamak editörü fokuslar | `frontend/tests/e2e/admin-page-builder-text-block.spec.ts` | ✅ Geçiyor (yeni) |
| 16 (regresyon) | Blog yazı editörü hâlâ "İçeriğinizi buraya yazın…" placeholder'ını, 200px min-height'ı KULLANIR ve AYNI çift-halka düzeltmesinden (global `.ProseMirror` seçicisi) faydalanır | `frontend/tests/e2e/admin-page-builder-text-block.spec.ts` | ✅ Geçiyor (yeni) |

**17 yeni backend entegrasyon testi + 10 yeni frontend unit testi + 5 yeni Playwright e2e senaryosu
— hepsi yeşil.** Ayrıca regresyon: backend'in TAM suite'i (85 dosya / 818 test) ve frontend'in TAM
`vitest` suite'i (86 dosya / 517 test, bu turdan ÖNCEKİ hâliyle baseline) bu turda yeniden koşuldu,
kırılan YOK. Backend/frontend `tsc --noEmit` ve `eslint` (yeni dosyalar) temiz.

### Yöntem notu — `REVALIDATE_SECRET` testte NEDEN gerçek `fetch()` çağrısına yol açıyordu

`backend/.env.test` bu turda `REVALIDATE_SECRET=test-revalidate-secret` (boş değil) olarak
eklendi — yani `revalidate.test.ts` DIŞINDAKİ TÜM backend entegrasyon testlerinde (`pages.test.ts`
dahil) `triggerPublicPageRevalidation()` her PUBLISHED işlemde GERÇEK bir `fetch()` çağrısı
deniyor, frontend test sırasında ayakta olmadığı için (`ECONNREFUSED`) bu her seferinde
başarısız oluyor — ama `try/catch` içinde best-effort olduğu için testleri KIRMIYOR (yalnızca
`app.log.warn`). qa-agent bunu doğruladı (`pages.test.ts` izole çalıştırıldı — 26/26 yeşil, ~6s,
gözle görülür bir yavaşlama YOK, Windows'ta ECONNREFUSED hızlı döndüğü için). Bu bir **bug
DEĞİL** — davranış dosya başlığındaki yorumla (`.env.test`) tutarlı ve bilinçli — ama gerçek bir
ağ çağrısının testlerde sessizce denenmesi ideal değil; **backend-agent'a bilgi amaçlı not**:
ileride bu testler yavaşlarsa (CI'da farklı bir ağ/DNS davranışı, ör. `ECONNREFUSED` yerine
timeout) `tests/setup/env.ts`'e global bir `vi.stubGlobal("fetch", ...)` no-op mock'u eklemek
(yalnızca `revalidate.test.ts` `vi.restoreAllMocks()` ile kendi spy'ını üstüne koyar) bu riski
sıfıra indirir. Şu an için gözlemlenen bir performans/kararlılık sorunu YOK, bu yüzden qa-agent
kendi başına böyle bir global değişiklik yapmadı (backend `tests/setup/` altyapısı backend-agent'ın
alanı).

### Uygulama kodunda bug BULUNMADI

Hem backend'deki (`lib/revalidate.ts`, `pages.routes.ts` 7 çağrı noktası) hem frontend'deki
(`app/api/revalidate/route.ts`) implementasyon incelendi ve yukarıdaki 17+10+5 test senaryosuyla
doğrulandı: path formatı (`/${locale}` ana sayfa, `/${locale}/${slug}` diğerleri) doğru, secret
karşılaştırması `timingSafeEqual` ile sabit-zamanlı (uzunluk uyuşmazlığında erken dönüş güvenli —
sır uzunluğu gizli bilgi değildir), best-effort try/catch asıl admin isteğini hiçbir senaryoda
etkilemiyor. "Metin" bloğu düzeltmelerinde de (boş `html`, placeholder prop'ları, `.ProseMirror:
focus-visible` override'ı) davranış tam olarak dosya başlıklarındaki gerekçeyle eşleşiyor.

### Regresyon taraması — TAM Playwright suite'i bu turda koşuldu, 1 GERÇEK kırılma bulundu ve qa-agent'ın KENDİ testinde düzeltildi (uygulama kodu DEĞİL)

`npx playwright test` (18 dosya, tam suite) bu turda çalıştırıldı: **74 geçti, 4 kesin başarısız,
2 "flaky" (retry sonrası geçti)**. Tek tek izole edilip kök nedenleri doğrulandı:

1. **`admin-page-builder-containers.spec.ts` senaryo 1 — GERÇEK kırılma, qa-agent'ın KENDİ testi
   düzeltildi.** Bu test, "İki Eşit Sütun" konteynerinin ikinci sütununa DOKUNULMAMIŞ (varsayılan)
   bir Metin bloğu ekleyip public sayfada `getByText("Metin girin…")` arıyordu — bu, Metin
   bloğunun ESKİ varsayılan içeriğiydi (`registry.ts`'in eski `<p>Metin girin…</p>`'i, GERÇEK
   yayınlanan içerikti, yalnızca bir editör placeholder'ı DEĞİLDİ). frontend-agent'ın bu turki
   düzeltmesiyle (`createBlock("text")` artık `html: ""`) dokunulmamış bir blok public'te ARTIK
   hiçbir görünür metin ÜRETMİYOR — bu KASITLI ve DOĞRU (eski davranış, düzenlenmemiş bir bloğun
   placeholder-benzeri metnini gerçek içerik gibi yayınlıyordu, gerçek bir UX kusuruydu). Test,
   yalnızca eski (artık geçersiz) bir varsayılan-içerik varsayımına dayandığı için **qa-agent
   tarafından güncellendi**: ikinci sütuna artık GERÇEK bir metin YAZILIYOR (`pressSequentially`),
   public sayfada O metin aranıyor — testin asıl amacı (iki sütunun yan yana/eşit genişlikte
   render olduğunun görsel doğrulaması) DEĞİŞMEDİ. Düzeltme sonrası dosyanın 7 testi de tek başına
   yeşil (`31.4s`). **frontend-agent'a yönlendirilecek bir bug YOKTUR** — davranış kasıtlı ve
   doğru, kırılan yalnızca eski bir test varsayımıydı.
2. **`admin-blog-tags.spec.ts` madde 3 + madde 4 — pre-existing, bu turdan BAĞIMSIZ, ilgisiz bir
   flake.** Hızlı Düzenle popover'ındaki "... etiketini kaldır" butonuna tıklarken "element is not
   stable" / bir kart `div`'inin "intercepts pointer events" hatası (55+ retry denemesi sonrası
   timeout) — dnd-kit `PointerSensor` için önceden belgelenmiş, bu depoda TEKRARLANAN bir Windows/
   Playwright sentetik-pointer-olayı sınırlamasıyla AYNI kategori. Bu turun değişiklikleri (backend
   revalidation webhook'u, page-builder Metin bloğu/CSS) blog listesi Hızlı Düzenle UI'ına HİÇ
   dokunmuyor — izole tekrar koşulduğunda AYNI şekilde başarısız oldu (bu turdan bağımsız
   doğrulandı). Kapsam/zaman kısıtı nedeniyle bu turda DÜZELTİLMEDİ — **qa-agent'ın kendi
   backlog'una not**: ilgili "kaldır" butonu locator'ı için `admin-page-builder-containers.spec.ts`
   §2'deki `attemptDragOntoAndConfirmStarted` retry-sarmalayıcı desenine benzer bir "gerçekten
   stabil hale gelene kadar yeniden dene" yardımcısı eklenmeli.
3. **`admin-locale-management.spec.ts` "madde 7" — pre-existing, ÖNCEDEN belgelenmiş, bu turdan
   BAĞIMSIZ flake.** Bu dosyanın kendi bölümündeki ("Bilinen ortam sınırlaması — madde 7", yukarı
   bkz.) tarayıcı-süreç-çökmesi sınırlamasıyla BİREBİR aynı hata (izole tekrar koşulduğunda aynı
   noktada, `getByLabel('Kod')` doldurulurken çöktü). Bu turda dosyaya HİÇ dokunulmadı.
4. **`admin-blog-pagination.spec.ts` + `admin-page-builder-widgets.spec.ts` (2 "flaky", retry'de
   geçti) — giriş formu `waitForURL(/\/dashboard/)` zaman aşımı.** `support/admin-session.ts`
   başlığında ÖNCEDEN belgelenmiş, refresh-token rotasyon yarışıyla ilişkili bilinen bir
   sınırlama (`retries: 1` zaten telafi ediyor). İzole tekrar koşulduğunda HER İKİ dosya da (12/12
   test) sorunsuz geçti — bu turun değişiklikleriyle İLGİSİZ.

**Sonuç: bu turun değişiklikleri (revalidation webhook + Metin bloğu) yüzünden kırılan TEK gerçek
test `admin-page-builder-containers.spec.ts` idi ve düzeltildi; geri kalan 3 kırılma/flake bu
depoda ÖNCEDEN belgelenmiş, ilgisiz, ortam kaynaklı sorunlardır.**
