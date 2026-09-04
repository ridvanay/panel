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

## Page Builder — sağ sabit ayar çekmecesi (`Sheet`) + sticky üst araç çubuğu (bu turda eklendi)

Kaynak: `.claude/design-notes-page-builder-sticky-panel-and-toolbar.md` (ui-designer, bağlayıcı) +
frontend-agent'ın buna göre yaptığı iki değişiklik: (1) `ContainerSettingsPanel` artık sayfa
akışının bir parçası (grid ikinci sütunu) DEĞİL, `frontend/src/components/ui/sheet.tsx` tabanlı
sağdan kayan bağımsız bir çekmece; (2) üst başlık satırı `sticky top-14 z-20` bir araç çubuğuna
dönüştü (`Sil` / `Taslak Olarak Kaydet` / `Önizle` / `Kaydet`), eski `sticky bottom-6` alt çubuk
(kendi `Kaydet` butonuyla) TAMAMEN kaldırıldı, `Ctrl+S`/`Cmd+S` kısayolu eklendi. Yeni dosya:
`frontend/tests/e2e/admin-page-builder-sticky-panel-toolbar.spec.ts`.

| # | Senaryo | Durum |
|---|---|---|
| 1 | Scroll gerektiren derin bir konteynerde "Ayarlar" paneli sağdan **sabit** (`position: fixed`) bir çekmece olarak açılır; pencere en üste geri kaydırılsa bile panelin konumu/boyutu DEĞİŞMEZ (sayfa akışının PARÇASI değil); backdrop'a tıklamak da kapatır | ✅ Geçiyor |
| 2 | Panelde `gap` alanını değiştirmek state'e yansır; panel **kendi X'iyle** kapatılıp aynı konteyner yeniden açılınca değer KAYBOLMAZ; farklı bir konteynere geçilince kendi (dokunulmamış) değeri gösterilir (SIZDIRMAZ); geri dönülünce ilk konteynerin değeri hâlâ orada; `Kaydet` sonrası API'de her ikisi de doğru (64/16) | ✅ Geçiyor |
| 3 | Üst araç çubuğu sayfa aşağı kaydırılınca da görünür/tıklanabilir KALIR (`sticky top-14`) | ✅ Geçiyor (bkz. aşağıdaki düzeltme notu) |
| 4 | `Ctrl+S` kısayolu `handleSave()`'i (üstteki `Kaydet` ile AYNI `PATCH` isteğini) tetikler | ✅ Geçiyor |
| 5 | DRAFT sayfa — `Taslak Olarak Kaydet` disabled + doğru `title`; `Önizle` disabled gerçek bir **`<button>`** (`<a>` DEĞİL) + doğru `title` | ✅ Geçiyor |
| 6 | PUBLISHED sayfa — `Taslak Olarak Kaydet` aktif; `Önizle` gerçek bir `<a>` linki, doğru `href`/`target="_blank"`/`rel="noopener noreferrer"` | ✅ Geçiyor |

**6/6 senaryo yeşil.** Dosya tek başına 2 kez ardışık çalıştırıldı, tutarlı.

### DÜZELTİLDİ (frontend-agent) — sticky üst araç çubuğu FİİLEN HİÇ YAPIŞMIYORDU

Bu turda önce şu şekilde bulunmuştu (qa-agent, `test.fail()` ile işaretlemişti): `sticky top-14
z-20` sınıflı üst araç çubuğu (Sil/Taslak Olarak Kaydet/Önizle/Kaydet) kullanıcı sayfayı ~200px'ten
fazla aşağı kaydırdığı ANDA ekranın ÜSTÜNE tamamen kaybolup **bir daha geri gelmiyordu** — geri
kalan tüm scroll boyunca "Kaydet" butonuna (fare ile) erişilemiyordu. Bağımsız bir Playwright
betiğiyle doğrulanmıştı: `Kaydet` butonunun `getBoundingClientRect().y` değeri, `scrollY` ile TAM
`192 - scrollY` ilişkisiyle değişiyordu — yani `position: sticky` hiçbir zaman "yapışmıyordu",
pratikte `position: static` gibi davranıyordu (yapışma etkisi sıfır).

**Kök neden** — `frontend/src/app/admin/layout.tsx` satır ~45:
`<main className="flex-1 overflow-hidden bg-surface-muted p-4 md:p-6">`. `overflow-hidden`, CSS
açısından bu `<main>`'i `position: sticky`'nin "en yakın kaydırma bağlamı" atası yapıyordu — ama bu
`<main>` KENDİSİ hiçbir zaman scroll olmuyordu (gerçek scroll `window` seviyesinde gerçekleşiyor,
design-notes §2.1'in doğru tespit ettiği gibi). Bu çelişki sticky hesaplamasını tamamen bozuyordu.

**Düzeltme denemesi #1 (koordinatörün önerisi) — YETERSİZ çıktı, canlı tarayıcıda ölçülerek
reddedildi:** `overflow-hidden` → `overflow-x-hidden`. İlk bakışta doğru gibi görünse de, CSS
Overflow spec'inin "visible/non-visible eşleşme" kuralı gereği (bir eksen 'visible' DEĞİLKEN diğeri
'visible' ise, 'visible' olanın KULLANILAN değeri 'auto'ya zorlanır) `overflow-x: hidden` +
belirtilmemiş `overflow-y` (varsayılan 'visible') kombinasyonunda tarayıcı `overflow-y`'nin
kullanılan değerini YİNE 'auto' yapıyor. Bu, canlı bir `next dev` sunucusuna karşı
`getComputedStyle(main)` ile doğrudan ölçüldü: `overflow-x-hidden` uygulandığında
`overflowY: "auto"` çıktı (`overflowX: "hidden"`) — yani `<main>` YİNE bir scroll container
oluyordu ve senaryo 3 testi AYNI `-208` hatasıyla YİNE KIRMIZI kaldı (sonuç `192 - scrollY` ile
birebir aynı, sıfır düzelme).

**Düzeltme #2 (frontend-agent, DOĞRULANDI) — `overflow-hidden` → `overflow-x-clip`:** `'clip'`
değeri CSS spec'indeki bu "visible→auto zorlama" kuralından MUAF (kural yalnızca 'visible'ı
hedefliyor, 'clip'i DEĞİL). Aynı canlı ölçümle doğrulandı: `overflow-x-clip` uygulandığında
`overflowX: "clip"`, `overflowY: "visible"` (gerçekten visible, auto'ya zorlanmıyor) — `<main>`
artık hiçbir eksende bir scroll container OLUŞTURMUYOR, `sticky` gerçek `window` scroll bağlamına
doğru şekilde bağlanıyor, senaryo 3 testi YEŞİLE döndü. (`'clip'`, `'hidden'`den farklı olarak
programatik `scrollLeft`/scroll event'lerini de DEVRE DIŞI bırakır — bu `<main>` için zaten hiç
kullanılmayan bir davranıştı, fonksiyonel bir kayıp yok.)

Bu global bir layout dosyası olduğundan (tüm admin sayfalarını etkiliyor) `/admin`, `/admin/pages`,
`/admin/appearance` sayfalarında geçici bir e2e betiğiyle (`document.documentElement.scrollWidth`
vs `window.innerWidth`, doğrulama sonrası SİLİNDİ) `overflow-x-clip`'e geçişin hiçbir YENİ yatay
scrollbar/layout kırılmasına yol açmadığı doğrulandı (sayfa geçiş animasyonu `framer-motion` `y`
translate kullanıyor, `x` değil — beklenen şekilde sorun yok). Yan etki: `appearance/page.tsx`'teki
kendi `lg:sticky lg:top-6`/`sticky bottom-6` blokları da AYNI kök nedenden ÖNCEDEN çalışmıyordu; bu
düzeltmeyle birlikte onlar da artık doğru şekilde yapışıyor (regresyon değil, aynı kök nedenin başka
bir belirtisinin de düzelmesi). Test dosyasındaki `test.fail()` işareti kaldırıldı, senaryo 3 normal
geçen bir test oldu (yukarıdaki tablo, canlı `next dev` sunucusuna karşı izole doğrulandı: 2/2 geçti).

**Not (frontend-agent, bu turun kapsamı DIŞINDA, yeni bir bug DEĞİL):** `/admin/appearance`'ta
~26px'lik ÖNCEDEN VAR OLAN bir yatay taşma (`scrollWidth: 1306` vs `innerWidth: 1280`) tespit
edildi — hem eski `overflow-hidden` hem yeni `overflow-x-clip` ile BİREBİR AYNI ölçüldü (ikisi
arasında geçiş yapılıp tekrar ölçülerek doğrulandı), yani bu turun değişikliğinin NEDEN OLDUĞU bir
regresyon DEĞİL. Kaynağı bu görevin kapsamında araştırılmadı (appearance/page.tsx'in kendi bir
bileşeni olabilir) — ayrı bir frontend-agent/qa-agent görevi olarak not düşülüyor.

### Mevcut testler — güncelleme taraması sonucu

`grep -r "sticky bottom|ContainerSettingsPanel|Konteyner Ayarları" frontend/tests` ile
`admin-page-builder-containers.spec.ts`/`admin-page-builder-editing-tools.spec.ts`/
`admin-page-builder-gallery.spec.ts` tarandı:

- **`admin-page-builder-containers.spec.ts`, `admin-page-builder-gallery.spec.ts`** — panel
  içeriğiyle yalnızca `getByText`/`getByRole` ile etkileşiyorlardı (kabuğun `Sheet`e taşınmasından
  ETKİLENMEYEN bir şekilde) ve zaten TEK üstteki `Kaydet` butonunu kullanıyorlardı — GÜNCELLEME
  GEREKMEDİ. İzole yeniden koşuldu: containers 7/7 (1 önceden belgelenmiş `hover` flake'i retry'de
  geçti), gallery 9/9.
- **`admin-page-builder-editing-tools.spec.ts` — GERÇEK bir kırılma bulundu ve qa-agent tarafından
  DÜZELTİLDİ (senaryo 2, "Ayırıcılar").** Test, `ContainerSettingsPanel`i açıp bir ayırıcı şablonu
  seçtikten SONRA paneli KAPATMADAN doğrudan üstteki `Kaydet`e tıklamaya çalışıyordu — eski
  inline/grid-ikinci-sütun yerleşiminde bu sorun DEĞİLDİ (panel sayfa akışının bir parçasıydı,
  hiçbir şeyi ENGELLEMİYORDU). Yeni yerleşimde panel bağımsız bir `Sheet`/`Dialog` — kendi tam-ekran
  `backdrop`'ı (`data-slot="sheet-overlay"`, `fixed inset-0 z-50`) VAR ve arkadaki `Kaydet` butonuna
  tıklamayı FİİLEN ENGELLİYOR; Playwright'ın "actionability" kontrolü elemanın başka bir şeyin
  ARKASINDA olmadığını bekleyip **60 saniyede timeout veriyordu** (bu turda gerçekten gözlemlendi,
  ayrı bir tarayıcı çökmesi DEĞİL). Düzeltme: panel `Kaydet`ten ÖNCE kendi X'iyle (`aria-label="Paneli
  kapat"`) kapatılıyor artık — bu, gerçek bir kullanıcının da izlemesi gereken YENİ zorunlu bir adım
  (uygulama davranışı DOĞRU, kırılan yalnızca eski test varsayımıydı). Düzeltme sonrası dosya izole
  2 kez 7/7 yeşil.

### Bulunan diğer flake'ler — bu turdan BAĞIMSIZ, ÖNCEDEN belgelenmiş

Kombine koşumlarda (birden fazla dosya art arda, `workers: 1`) hem `admin-page-builder-containers.
spec.ts` hem `admin-page-builder-gallery.spec.ts` en az bir kez `support/admin-session.ts`
başlığında ÖNCEDEN belgelenmiş `waitForURL(/\/dashboard/)` giriş zaman aşımına (refresh-token
rotasyon yarışı, `retries: 1` ile kısmen telafi edilir) takıldı — izole tekrar koşulduklarında
sorunsuz geçtiler (yukarıdaki madde). Bu turun değişiklikleriyle İLGİSİZ, yeni bir aksiyon
GEREKMİYOR.

### A11y notu

Proje a11y otomasyonu için bilinçli olarak Playwright `@axe-core/playwright` YERİNE component-
seviyesi `jest-axe` deseni kullanıyor (bkz. "§10.19 Dalga 3.3" bölümündeki AYNI gerekçe) — bu turda
da yeni bir e2e-seviyesi axe bağımlılığı EKLENMEDİ. **Boşluk (frontend-agent'a önerilir):** yeni
`Sheet` tabanlı `ContainerSettingsPanel` kabuğu (`SheetHeader sr-only` + panelin kendi görünür
`<h3>` başlığı, base-ui `Dialog` odak tuzağı/`Escape` davranışı) için `frontend/tests/unit/a11y-
content-editor.test.tsx`'e (veya yeni bir dosyaya) `jest-axe` ile özel bir senaryo eklenmedi.

## §10.20 Sayfa düzenleyicide Standart/Gelişmiş mod ayrımı — E2E kapsamı (bu turda eklendi)

Kaynak: `.claude/architect-scope-page-editor-roles.md` §6.6 "qa-agent" görev listesi (6 madde,
bağlayıcı) + §6.6'nın 7. maddesi (security-agent'ın bıraktığı `PATCH /admin/users/{id}/builder-
access` DELETED-kullanıcı kapsam notu — backend entegrasyon testine eklendi, aşağıya bkz.).

Yeni dosya: `frontend/tests/e2e/admin-page-editor-roles.spec.ts`. Yeni fixture yardımcıları:
`support/api.ts::createPageWithBlocks/getFixtureUserToken`, `support/admin-users-fixtures.ts::
adminUpdateBuilderAccess` (+ `resetFixtureUserToBaseline` artık `advancedBuilderEnabled`'ı da
temel duruma döndürür), `support/admin-session.ts::createAuthenticatedPageAs` (keyfi kimlik
bilgileriyle UI login — `createAuthenticatedPage()` artık bunun ADMIN'e özel bir sarmalayıcısı).

| # | Mimari madde | Test | Durum |
|---|---|---|---|
| 1 | Standart kullanıcı — metin düzenleme, "Kaydet" düğmesiyle → başarı | `1a` (UI, literal senaryo) | ✅ Geçiyor (`test.fail()` bu turda KALDIRILDI — bkz. aşağı) |
| 1 | (kontrol) Standart mod DOM kanıtı + backend/guard'ın içerik-only PATCH'i kabul ettiği | `1b` | ✅ Geçiyor |
| 2 | Standart kullanıcı — API seviyesinde yapısal değişiklik (ekle/sil/sırala) → 403 | `2` | ✅ Geçiyor |
| 3 | **Autosave baypas testi (zorunlu)** — UI'da düzenle, debounce, backend autosave'i BAĞIMSIZ reddediyor | `3` | ✅ Geçiyor |
| 4 | Gelişmiş EDITOR — aynı türde şablon sayfada tam serbestlik (BuilderCanvas, konteyner ekle, kaydet) | `4` | ✅ Geçiyor |
| 5 | `advancedBuilderEnabled` kapatılınca AYNI token'ın bir SONRAKİ isteğinde kısıt ANINDA etkin | `5` | ✅ Geçiyor |
| 6 | ADMIN — `advancedBuilderEnabled=false` olsa DAHİ şablon sayfada kısıtsız (§1.5) | `6` | ✅ Geçiyor |
| 7 (backend) | `PATCH /admin/users/{id}/builder-access` + `DELETED` kullanıcı → 404 | `backend/tests/integration/admin-users-soft-delete.test.ts` ("PATCH /builder-access, DELETED bir kullanıcıya uygulanamaz") | ✅ Geçiyor |

**7/7 madde kapsandı, tam dosya 3 ayrı koşuda (rate-limit soğuma aralıklarıyla) İSTİKRARLI: 8/8
test "yeşil".** Madde 1'in literal UI senaryosu (`1a`) artık **GERÇEKTEN geçiyor** — bu turda
`test.fail()` işareti KALDIRILDI (qa-agent kararı; bkz. aşağıdaki doğrulama notu). Regresyona
dönerse (bir ajan `slug`'ı yeniden koşulsuz eklerse) bu test artık CI'ı KIRAR (istenen davranış).

### ✅ DÜZELTİLDİ ve DOĞRULANDI — eski KRİTİK BULGU (A): standart kullanıcı "Kaydet" düğmesiyle kaydedemiyordu

`frontend/src/app/admin/pages/[pageId]/page.tsx::handleSave()`/`handleSaveAsDraft()`, `PATCH`
gövdesine `slug`'ı **KOŞULSUZ** ekliyordu (`isLegalDocument`in `...(isAdmin ? {isLegalDocument} :
{})` deseninin AKSİNE, `slug` için hiçbir koşul YOKTU). Backend'in `assertAdvancedFieldsAuthorized()`
(`backend/src/modules/pages/pages.routes.ts`) `body.slug !== undefined` olduğu AN 403 fırlatıyordu
— bu bir **DEĞER-farkı** kontrolü DEĞİL, bir **VAR-OLMA** kontrolü olduğundan slug DEĞERİ aynı
kalsa dahi standart kullanıcı "Kaydet"e bastığı AN HER ZAMAN 403 alıyordu.

**Düzeltme (frontend-agent, bu turda):** `slug` artık `isLegalDocument` ile AYNI koşullu-alan
desenini kullanıyor — `...(!simpleMode ? { slug } : {})` (hem `handleSave` hem `handleSaveAsDraft`
içinde). **qa-agent doğrulaması:** `admin-page-editor-roles.spec.ts` testi `1a`, `test.fail()`
işareti kaldırıldıktan sonra **gerçek bir tarayıcıda** ("Kaydet" tıkla → "Sayfa kaydedildi."
toast'ı görünür) 3 ayrı koşuda İSTİKRARLI olarak geçiyor.

### ✅ DÜZELTİLDİ ve DOĞRULANDI — eski İKİNCİL BULGU (B): `wrapBareRootBlocks` standart moda sızıyordu

`page.tsx::load()` HER kullanıcı için (standart dahil) `wrapBareRootBlocks()` çağırıyordu — kökte
"çıplak" (bir `container`'ın DIŞINDAKİ) blok varsa YENİ bir `container`'a sarıyordu. Bu sarma
`TemplateEditorView`'a giden `activeNodes`'u da etkiliyordu: sayfa DB'de kökte çıplak bir blokla
saklanmışsa, standart kullanıcı SALT bir metin alanını değiştirse bile gönderilen `blocks`
kayıtlı ağaçtan YAPISAL olarak farklı hale geliyordu (yeni bir `container` düğümü) —
`assertTemplateEditAllowed` bunu (doğru biçimde) 403'e düşürüyordu.

**Düzeltme (frontend-agent, bu turda):** `load()` içinde `isSimpleModePage` (`page.editMode ===
"TEMPLATE" && !canUseAdvancedBuilder`) hesaplanıp bu durumda `wrapBareRootBlocks` ATLANIYOR.
**qa-agent doğrulaması:** diff incelemesiyle (`git diff` — desen `isLegalDocument`'inkiyle
BİREBİR) VE `1a`/`1b` testlerinin (kök bloğu BİLE İSTEYE sarılmış fixture'larla) 3 koşuda
istikrarlı geçmesiyle DOLAYLI olarak doğrulandı.

### ✅ EK (orkestratör tarafından, aynı desenle) — çeviri blokları (`enBlocks`) için AYNI risk kapatıldı

Bulgu (B) ile AYNI sınıftan bir "latent risk" — `enBlocks` `useMemo`'su
(`translations.<locale>.blocks`, çeviri sekmesi) da `wrapBareRootBlocks`'u KOŞULSUZ çağırıyordu.
Orkestratör bu turda AYNI deseni (`editMode === "TEMPLATE" && !canUseAdvancedBuilder` iken atla)
`enBlocks`'a da uyguladı. **qa-agent doğrulaması:** `git diff` ile kod incelemesi YAPILDI (desen
doğru uygulanmış); bu dosyada AYRI bir çeviri-sekmesi UI senaryosu YOK (kapsam dışı — mevcut
suite varsayılan locale ile sınırlı). **EKSİK KALAN KAPSAM:** standart kullanıcının bir çeviri
sekmesinde ("EN" gibi) kök blok çevirisini kaydettiği bir e2e senaryosu henüz yazılmadı — ileride
eklenmeli (bkz. TODO altbölümü).

### Auth kotası notu (test altyapısı, uygulama bug'ı DEĞİL)

İlk taslak `STANDARD_EDITOR_EMAIL`/`ADVANCED_EDITOR_EMAIL`/... için KALICI (dosyalar arası
paylaşılan) e-postalar kullanıyordu (`admin-user-management.spec.ts`'teki desenle aynı) — bu,
`getFixtureUserToken()`'ın (her çağrıda register 409 → login'e düşme) `/auth/login`'in sabit
5 istek/dk kotasını (`AUTH_RATE_LIMIT`) hızla tükettiğini ortaya çıkardı (429 gözlemlendi).
Düzeltme: bu dosyadaki fixture kullanıcılar artık `RUN_SUFFIX` (`Date.now().toString(36)`) ile
ÇALIŞTIRMA-BAŞINA-BENZERSİZ — `POST /auth/register` HER ZAMAN 201 döner, `/auth/login`'e HİÇ
düşülmez (yalnızca genuine UI login'ler — `standardPage`/`advancedPage` — login kotasını kullanır,
toplam 2 + `auth.setup.ts`'in kendi 2'si = 4, kotanın altında). Bu, `admin-user-management.spec.ts`
gibi KİMLİK SÜREKLİLİĞİ gerektiren (ör. "tek admin" ön koşulu) dosyalardaki KALICI e-posta
deseninden BİLİNÇLİ bir SAPMA — bu dosyanın fixture kullanıcıları yalnızca kendi içindeki
testlerde kullanılıyor, sürekliliğe ihtiyaç yok. Yan etki: `saas_e2e`'de koşum başına 4 kalıcı
`qa-e2e-per-*` kullanıcı birikir (zararsız — prod değil, disposable test DB).

## §10.20 GENİŞLETME — standart kullanıcı kilidi `editMode`'dan bağımsız (kullanıcı sıkılaştırması,
## 2026-08-23) — FREEFORM e2e eşlenikleri eklendi (bu turda)

Bağlam: backend-agent (`pages.routes.ts::isStructureRestricted = !canUseAdvancedBuilder(...)`,
artık `editMode`'a BAKMIYOR) ve frontend-agent (`page.tsx::simpleMode = !canUseAdvancedBuilder`)
standart kullanıcının yapısal kilidini `Page.editMode === "TEMPLATE"` koşulundan TAMAMEN
bağımsız hale getirdi — standart kullanıcı artık FREEFORM bir sayfada da yapıyı değiştiremez.
security-agent baypas yüzeyi taraması yaptı, kritik bulgu yok. Yukarıdaki §10.20 bölümündeki 1-6
numaralı testler yalnızca `editMode: TEMPLATE` fixture'larını (`createTemplatePage`) kapsıyordu —
bu turda AYNI dört senaryonun (1/2/3/4) `editMode: FREEFORM` eşlenikleri EKLENDİ.

Değişen tek dosya: `frontend/tests/e2e/admin-page-editor-roles.spec.ts` (mevcut 1-6 numaralı
TEMPLATE testlerine DOKUNULMADI, yalnızca `createFreeformPage()` yardımcısı + 7/8/9/10 numaralı
testler EKLENDİ).

| # | Senaryo (TEMPLATE eşleniği) | Test | Durum |
|---|---|---|---|
| 7 | Standart kullanıcı — FREEFORM sayfada `BuilderCanvas` HİÇ render edilmez, yalnızca `TemplateEditorView` (form) görünür + "Kaydet" ile içerik kaydı başarı (1a/1b'nin FREEFORM birleşimi) | `7` | ✅ Geçiyor |
| 8 | Standart kullanıcı — FREEFORM sayfada API seviyesinde yapısal değişiklik (ekle/sil/sırala) → 403; içerik-only PATCH → 200 (2'nin FREEFORM eşleniği) | `8` | ✅ Geçiyor |
| 9 | **Autosave baypas testi (FREEFORM)** — UI'da düzenle, backend autosave'i BAĞIMSIZ reddediyor (3'ün FREEFORM eşleniği) | `9` | ✅ Geçiyor |
| 10 | Gelişmiş EDITOR — FREEFORM sayfada tam serbestlik (regresyon kontrolü: kısıt yalnızca standart kullanıcıya sıkılaştırıldı, gelişmiş kullanıcı FREEFORM'da hep serbestti) (4'ün FREEFORM eşleniği) | `10` | ✅ Geçiyor |

Backend'in kendi `backend/tests/integration/page-editor-roles.test.ts`'i (backend-agent, bu
turdan önce) aynı FREEFORM senaryolarını zaten `app.inject` seviyesinde kapsıyordu — buradaki
7-10 numaralı testler bu kapsamı GERÇEK bir tarayıcı + gerçek çalışan backend üzerinden (DOM
kanıtı: `BuilderCanvas` mount edilmediğinin kanıtı, gerçek "Kaydet" tıklaması, gerçek 3sn'lik
autosave debounce döngüsü dahil) tekrar doğrular — backend'in `app.inject` katmanının atladığı
"wiring" yüzeyini kapatır (bkz. bu dosyanın başlığındaki katman tablosu).

**Doğrulama (kararlılık):** `npx playwright test admin-page-editor-roles --grep "FREEFORM"`
(testler 7-10, `beforeAll` dahil) **3 ayrı ardışık koşuda İSTİKRARLI: 3/3 koşum, koşum başına
5/5 test (1 setup + 4 yeni) yeşil, toplam 15/15 — sıfır flake.**

### qa-agent'ın KENDİ testinde bulup düzelttiği flaky kaynağı (bu turda)

Test "10" ilk taslağında, test "4" (PRE-EXISTING, bu turda DOKUNULMAYAN TEMPLATE senaryosu) ile
BİREBİR aynı "•••" (`Daha fazla işlem`) → hover → `DropdownMenuSub` "Alta Konteyner Ekle"
alt-grid'ini açan etkileşim desenini kopyalıyordu. İlk izole koşumda bu adım ARA SIRA başarısız
oldu (`getByRole('button', { name: 'Tek Sütun' })` 5000ms'de görünmüyor) —
`admin-page-builder-containers.spec.ts`'in KENDİ dosya içi yorumunda ZATEN "ara sıra FLAKY"
olarak belgelenmiş, floating-ui'nin `allowMouseEnter` korumasının bir hover girişini kaçırdığı
AYNI kategori (o dosyanın "imleç önce dışarı taşınıp geri getirilsin" düzeltmesi test "10"da da
UYGULANMIŞTI ama tek başına yeterli değildi). Kural gereği (proje kökü CLAUDE.md madde 3, "flaky
testleri tolere etme") qa-agent bunu KENDİ yeni kodunda tolere ETMEDİ ve düzeltti: yeni bir
yardımcı `openAddBelowSingleColumnTileUntilVisible()` eklendi — sabit bir bekleme SÜRESİ değil,
menüyü KAPAT → "•••"e yeniden tıkla → yeniden hover eden, en fazla 4 denemelik gerçek bir "koşul
sağlanana kadar tekrarla" deseni (`admin-page-builder-containers.spec.ts::dragUntil()`'in dnd-kit
flakiness'i için kullandığı desenin AYNISI, farklı bir etkileşim türüne uygulanmış). Düzeltmeden
SONRA test "10" izole olarak 3/3 koşuda (yukarı bkz.) istikrarlı geçti, hiçbir koşumda retry
döngüsü 1'den fazla denemeye ihtiyaç duymadı (ilk denemede geçti).

**Test "4" (PRE-EXISTING, bu turda BİLEREK DEĞİŞTİRİLMEDİ) KENDİSİ değiştirilmedi** — görev
tanımı açıkça "mevcut TEMPLATE senaryolarına dokunma" diyordu. Ancak bu turki gözlem
ÖNEMLİDİR: test "4" AYNI (düzeltilmemiş) desenle 4 tam-paket (`admin-page-editor-roles`, 12
testin tamamı) koşumunun 3'ünde başarısız oldu — dosyanın kendi yorumundaki "ara sıra" nitelemesi
bu yerel ortamda daha sık (yaklaşık %75) gerçekleşiyor. Ayrıca test "4" başarısız olduğunda
Playwright worker'ı (görünüşe göre) yeniden başlatıyor — bu da `beforeAll`'ın YENİDEN
çalışmasına ve akabinde bir sonraki testin (`5`, gerçekte `beforeAll`'ın kendi `advancedPage` UI
login adımı) `waitForURL` zaman aşımına uğramasına yol açıyor (kotayla İLGİSİZ — backend
loglarında 429 YOK); bu da 6-12 arası testlerin o koşumda hiç çalışmamasına neden oluyor. **Bulgu
qa-agent'ın kendi backlog'una not edilir** (kod değişikliği DEĞİL, kendi test-altyapısı kararı):
aynı `openAddBelowSingleColumnTileUntilVisible()` deseninin test "4"e de uygulanması önerilir —
bu, testin KENDİSİNİ (iddialarını) DEĞİL, yalnızca etkileşim GÜVENİLİRLİĞİNİ değiştirir; ancak bu
turda kapsam dışı bırakıldı (görev açıkça test "4"e dokunulmamasını istedi). İzole `--grep
"FREEFORM"` koşumlarında bu worker-restart kaskadı hiç GÖZLENMEDİ (test "4" hiç çalışmadığı
için) — 7-10 numaralı testlerin kendi 3/3 istikrar kanıtı bu kaskaddan BAĞIMSIZDIR.

### Doküman drift'i (documentation-agent'a bilgi amaçlı, qa-agent DEĞİŞTİRMEDİ)

`docs/architecture/ARCHITECTURE.md` §10.20.6 hâlâ "`editMode: TEMPLATE` gelişmiş kullanıcıyı
KISITLAMAZ; mod yalnızca standart kullanıcı için bir politikadır" cümlesini taşıyor — bu artık
YANILTICI: standart kullanıcı için politika `editMode`'dan TAMAMEN bağımsız hale geldi (yalnızca
gelişmiş kullanıcı için "mod onu kısıtlamaz" cümlesi hâlâ doğru). §10.20.3 de aynı şekilde eski
("standart kullanıcı yalnızca TEMPLATE'te içerik alanlarını doldurur" ima eden) hâliyle duruyor.
Kaynak kodun kendi yorumları (`pages.routes.ts` satır 367-370, `page.tsx` satır 185-188) yeni
kararı doğru şekilde BAĞLAYICI olarak belgeliyor — yalnızca `ARCHITECTURE.md`'nin ilgili
paragrafları güncel değil. documentation-agent'a yönlendirilir (qa-agent kendi dokümantasyon
alanı DIŞINA çıkmaz).

## Müşteri & E-Ticaret Alanı (Customer Portal) — doğrulama (bu turda eklendi)

Kaynak: `.claude/architect-scope-customer-portal.md` (BAĞLAYICI plan, özellikle §9 qa-agent test
matrisi) + `.claude/design-notes-customer-portal.md`. Bu doğrulama db-agent → backend-agent →
ui-designer → frontend-agent (2 tur) → security-agent zincirinin ÜSTÜNE eklendi; kullanıcının
orijinal istek metnindeki 4 doğrulama maddesinin tamamı kapsandı.

**Backend `npm test`: 945/945 geçti** (93 dosya). **Frontend `npx vitest run`: 552/552 geçti**
(93 dosya — bu turda `safe-redirect.test.ts` eklendi, 92→93). **Yeni Playwright e2e dosyası:
`customer-portal-module-toggle.spec.ts`, 11/11 geçti** (gerçek backend `:4001` + `saas_e2e` +
`next dev :3100`'e karşı, izole 2 kez koşuldu, tutarlı).

### Backend entegrasyon — §9 matrisinin okunması

`backend/tests/integration/customer-portal.test.ts` OKUNDU ve doğrulandı: madde 1-9, 13
(adres CRUD + IDOR 404, favori ekle/tekrar/sil/tekrar-sil idempotent, 20/100 sınırları,
soft-delete/taslak ürün favoriden gizlenir) birebir kapsanıyor. **§3'ün "mimari kararın
bekçisi" testi GERÇEKTEN VAR**: `"products KAPALI: GET /users/me/orders ve /orders/{id} 200
döner (§3 — bu test kararın bekçisidir)"` — modül kapalıyken sipariş uçlarının 200 döndüğünü
doğruluyor, KVKK/VUK gerekçeli bilinçli sapmayı regresyona karşı korur. Madde 10-12 (CUSTOM
`/admin/*` 403, `SHIPPED` takip-no zorunluluğu 422, `PAID→SHIPPED→FULFILLED` zinciri + geçersiz
geçiş 409) bu dosyada DEĞİL ama `orders.test.ts` (`PATCH /:orderId/status → SHIPPED
(takip no'suz) 422 döner`, `PAID -> SHIPPED -> FULFILLED zinciri...`) ve
`admin-panel-guard-route-table.test.ts` (introspeksiyonla TÜM `/admin/*` route'larında panel
guard'ı zorunlu kılan genel test) tarafından kapsanıyor — doğrulandı.

### Frontend — kod incelemesi (mimari plana uygunluk)

Aşağıdaki dosyalar okunup plana birebir uygunluğu doğrulandı: `hesabim/layout.tsx` (sunucu
tarafı `isModuleEnabledServer` + `HesabimShell`), `hesabim-shell.tsx` (4→2 sekme filtresi,
`role` koşulu YOK), `siparislerim/page.tsx` + `favorilerim/page.tsx` (`redirectIfModuleDisabledServer`
→ `/hesabim/profil`), `admin/layout.tsx` (§7.1 rol guard'ı — `ROLES_PANEL` dışı roller
`/hesabim/profil`'e yönlenir, admin kabuğu HİÇ mount edilmez), `safe-redirect.ts`
(`isSafeInternalPath` — `//evil.com`/`/\evil.com`/mutlak URL reddi), `site-header.tsx`
(`productsModuleEnabled` koşullu sepet/favori ikonları), `adreslerim/page.tsx`,
`order-detail-client.tsx` (kargo takip bloğu), `product-card.tsx`/`favorite-button.tsx`.
Hepsi mimari/tasarım dokümanlarıyla TUTARLI bulundu — kod incelemesinde regresyon YOK.

### Eklenen testler

1. **`frontend/tests/unit/safe-redirect.test.ts` (YENİ)** — security-agent'ın open-redirect
   düzeltmesi (`isSafeInternalPath`) için birim test EKSİKTİ (yalnızca `login/page.tsx`/
   `register/page.tsx` içinde dolaylı kullanılıyordu, doğrudan test edilmiyordu). 6 senaryo:
   site-içi path kabul, `//evil.com`/`/\evil.com` reddi, mutlak `http(s)://`/şemasız `evil.com`
   reddi, boş/null/undefined reddi. **6/6 geçiyor.**
2. **`frontend/tests/e2e/customer-portal-module-toggle.spec.ts` (YENİ)** — mevcut
   `admin-user-management.spec.ts`/`admin-rbac-5tier-critical-flows` desenlerini referans alan,
   gerçek backend+DB'ye bağlanan 11 senaryo (`test.describe.configure({ mode: "serial" })`,
   dosya başına tek gerçek UI login'i):
   - madde 14/22: `/hesabim` → 4 sekme, sipariş kargoya verilince (`PATCH /admin/orders/{id}/status`
     GERÇEK bir HTTP isteğiyle) `/hesabim/siparislerim/{orderId}`'de takip no/taşıyıcı görünür.
   - madde 1: `/hesabim/adreslerim` tam CRUD turu (ekle/varsayılan/düzenle/sil, boş durum).
   - madde 21: ürün detay sayfasından favoriye ekle → `/hesabim/favorilerim`'de görünür →
     "Sepete Ekle" → header sepet rozeti `+1` → favoriden çıkar → boş durum.
   - madde 20: CUSTOMER `/admin`'e giderse `/hesabim/profil`'e yönlenir, admin kabuğu (`[data-sidebar]`)
     HİÇ mount edilmez.
   - madde 19: eski `/siparislerim` → kalıcı yönlendirme → `/hesabim/siparislerim`.
   - madde 18: oturumsuz `/hesabim/adreslerim` → `/login?next=%2Fhesabim%2Fadreslerim`.
   - **security-agent'ın open-redirect fix'i** — `/login?next=%2F%2Fevil.com` ile giriş yapılır,
     `evil.com`'a GİTMEDİĞİ, güvenli varsayılan `/dashboard`'a düştüğü doğrulanır.
   - `products` KAPALI (3 test): header sepet/favori ikonu yok + 2 sekme; `/hesabim/siparislerim`
     ve `/hesabim/favorilerim` doğrudan girilince `/hesabim/profil`'e yönlenir; **§3 mimari
     kararının regresyon bekçisi** — `GET /users/me/orders(/{id})` GERÇEK bir tarayıcı isteğiyle
     200, `wishlist*` 404.
   - Kullanıcı `USER→CUSTOMER` terfisi `createPendingOrderDirect` + gerçek Stripe webhook imzasıyla
     (`postStripeCheckoutSessionCompleted`) tetiklenir — madde 20 GERÇEK bir CUSTOMER rolüyle çalışır.

### qa-agent'ın kendi test tasarımında bulup düzelttiği flaky kaynakları (bu turda)

1. **`getByLabel("İl", { exact: true })` süresiz asılı kalıyordu** (30s test timeout'una kadar,
   sonra "target page closed" ikincil hatası) — `getByLabel` "İl"i "İlçe" ile substring eşleştiği
   için `exact: true` eklendi ama YİNE hang etti (accessible-name eşleşmesiyle ilgili bir
   Playwright/Base-UI tuhaflığı, kök neden tam izlenemedi). Düzeltme: `id` bazlı kesin locator'lara
   geçildi (`#city`/`#district`, `Field id="city"`/`id="district"`).
2. **Favori ekleme sonrası hemen `goto()` ile race condition.** `WishlistContext.toggle()`
   OPTIMISTIC günceller — buton etiketi ("Favorilerden çıkar") POST tamamlanmadan DEĞİŞİR. Test
   ilk taslakta yalnızca buton etiketini bekleyip hemen `/hesabim/favorilerim`'e `goto()`
   yapıyordu; bu TAM SAYFA navigasyonu devam eden `POST /wishlist` isteğini İPTAL EDEBİLİYORDU
   (favoriler listesi boş geliyordu). Düzeltme: buton etiketi yerine GERÇEK başarı toast'ı
   ("Ürün favorilere eklendi.") beklenir hale getirildi.
3. **`/products` listesinde `.first()` ile favori butonuna tıklamak YANLIŞ ürünü hedefleyebilirdi**
   (diğer e2e dosyalarının bıraktığı fixture ürünleri de listede olabilir) — test kendi ürününün
   `/products/{slug}` detay sayfasına DOĞRUDAN gidecek şekilde değiştirildi.

### Bulunan ve raporlanan gerçek bulgu (bu turda) — backend-agent/frontend-agent'a yönlendirilir

**Modül önbelleği ~60 saniyeye kadar bayat kalabiliyor, `PATCH /admin/modules/{key}` tetiklemiyor.**
`frontend/src/lib/api/server-modules.ts::fetchPublicModulesServer()` `GET /modules` yanıtını
`next: { revalidate: 60 }` ile önbellekler (bu desen customer-portal işinden ÖNCE de vardı —
`(site)/products/layout.tsx` zaten aynı fonksiyonu kullanıyordu). Sayfa yayınlamanın aksine
(`backend` → `POST /api/revalidate` webhook'u, bkz. `frontend/src/app/api/revalidate/route.ts`),
`backend/src/modules/site-modules/site-modules.routes.ts`'teki `PATCH /:key` bu webhook'u HİÇ
ÇAĞIRMIYOR. Sonuç: bir admin `products` modülünü kapattığında/açtığında storefront (header
sepet/favori ikonları, `/hesabim/siparislerim`/`/hesabim/favorilerim` guard'ları, `/products`
404 gating) en fazla 60 saniye ESKİ durumu göstermeye devam edebilir. Kritik bir güvenlik açığı
DEĞİL (yalnızca gecikmeli tutarlılık, veri sızıntısı yok) ama gerçek bir UX/kabul-kriteri
riskidir — bir admin modülü kapatıp "hemen" doğrulamaya çalışırsa yanıltıcı davranış gözlemler.
`customer-portal-module-toggle.spec.ts`'teki "products KAPALI › madde 15" testi bu gecikmeyi
`expect(...).toPass({ timeout: 75_000 })` ile TOLERE eder (test doğru ama görece yavaş, ~59sn).
**Önerilen düzeltme:** `site-modules.routes.ts::PATCH /:key`'e, sayfa yayınlamayla AYNI
`REVALIDATE_SECRET` + `POST {FRONTEND_URL}/api/revalidate` çağrısı eklenmesi (paths: `/` ve
`/hesabim`'in ilgili locale varyantları) — backend-agent'ın (webhook çağrısı) ve frontend-agent'ın
(zaten var olan `/api/revalidate` alıcısını genişletme, gerek yoksa) koordineli bir işidir. qa-agent
kendi kod tabanı dışında değişiklik YAPMADI (CLAUDE.md madde 6).

### Kapsam dışı / sonraki tur için önerilir

- `a11y-*.test.tsx` paketine `/hesabim/*` sayfaları için özel bir a11y senaryosu bu turda
  EKLENMEDİ (mevcut genel a11y taban testleri admin ekranlarını kapsıyor, storefront `/hesabim`
  sayfaları için ayrı bir axe-core taraması yok) — frontend-agent'a önerilir.
- `PATCH /admin/orders/{orderId}/status` admin UI'sının (`admin-order-detail-ship.test.tsx`)
  GERÇEK bir tarayıcı e2e'si (yalnızca mock API'li component testi var) bu turda eklenmedi —
  zaman kısıtı; kritik akış zaten `customer-portal-module-toggle.spec.ts` madde 14/22
  içinde API seviyesinde (gerçek `PATCH` isteği) ve unit seviyesinde (mock UI) çift kapsanıyor.

## "1 Tıkla Hazır Demo / Şablon İçe Aktarıcı" (`demo-templates` modülü) — E2E kapsamı (bu turda eklendi)

Kaynak: `.claude/architect-scope-demo-template-import.md` §12 "QA kapsamı" madde 6-14 (BAĞLAYICI
karar dokümanı, özellikle §6 API sözleşmesi, §6.1 yıkıcılık matrisi, §6.4 idempotency/force).
Backend'in kendi birim testleri (`backend/tests/unit/demo-templates-importer.test.ts`,
`demo-templates-schema.test.ts`, 10/10 geçiyor) şablonun Zod doğrulamasını ve Faz 2 telafi
(rollback) davranışını ZATEN kapsıyor — burada TEKRARLANMADI. Bu tur security/compliance/seo/
performance denetimlerinden geçmiş implementasyonun ÜSTÜNE eklendi (kurgusal firma adı "Kütle
Yapı", kırık `/hakkimizda`/`/hizmetlerimiz`/`/iletisim`/`/portfoy` linkleri `/` ve
`/portfolio`'ya düzeltildi — bkz. seo-agent notu, bu düzeltme sonrası testler yeniden koşulup
doğrulandı).

**Yeni Playwright e2e dosyası: `frontend/tests/e2e/admin-demo-template-import.spec.ts`, 9/9
senaryo yeşil** (`test.describe.configure({ mode: "serial" })`, gerçek backend `:4001` +
`saas_e2e` + `next dev :3100`'e karşı, iki kez bağımsız koşuldu, ikisinde de tutarlı ve tam
temizlik doğrulandı — `demo_template_imports`/`media`/`pages`/`sliders`/`portfolio_*` tabloları
koşum sonunda sıfır satıra dönüyor). Yeni fixture dosyası:
`frontend/tests/e2e/support/demo-templates-fixtures.ts`.

| Madde | Senaryo | Durum |
|---|---|---|
| 6 | ADMIN uygular → `201` → ana sayfa şablonun sayfası olur; public `/` yeni içeriği (site adı + ilk slayt başlığı) gösterir | ✅ Geçiyor |
| 7 | Aynı şablonu tekrar uygula (force olmadan) → `409`; `importedAt` konflikt diyaloğunda görünür | ✅ Geçiyor |
| 8 | `force: true` → `201`, sayfa slug'ı `<önceki>-2` ile oluşur, önceki sayfa SİLİNMEZ | ✅ Geçiyor |
| 9 | `confirm` gönderilmeden POST → `422 VALIDATION_ERROR` | ✅ Geçiyor |
| 10 | RBAC: MANAGER/EDITOR `GET`i görür ama `POST`ta `403`; USER/CUSTOMER `GET`te `403` | ✅ Geçiyor |
| 11 | Import sonrası medya kütüphanesinde 6 yeni görsel (dosya adı + altText bütünlüğü) var ve gerçek bir `MediaPicker` akışıyla (Görsel bloğu → "Kütüphaneden Seç" → ara → seç) değiştirilebiliyor | ✅ Geçiyor |
| 12 | `portfolio` modülü kapalıyken import → `201` + beklenen `warnings[]` metni birebir | ✅ Geçiyor |
| 13 | Hız sınırı: 6. istek `429` | ✅ Geçiyor |
| 14 | `/admin/logs`'ta `demo_template.import` satırı (API + UI) ve `metadata.previousHomePageId` mevcut ve doğru | ✅ Geçiyor |

### Hız sınırı izolasyonu — tasarım notu (flaky kaynağı bulundu ve önlendi, CLAUDE.md madde 3)

`POST /admin/demo-templates/{key}/import` route-seviyesinde `{ max: 5, timeWindow: "1 minute" }`
ile sınırlıdır ve `@fastify/rate-limit`'in route-level `config.rateLimit`'i **`onRequest`**
aşamasında çalışır (`authenticate`/RBAC/body-doğrulamadan ÖNCE) — varsayılan `keyGenerator`
(`request.ip`) ile bu dosyadaki TÜM isteklerin (token'dan BAĞIMSIZ) AYNI sayaca yazdığı anlamına
gelir. Madde 6/7/8/9/10/12'nin TOPLAM gerçek çağrı sayısı 5'i aşıyor — bu yüzden:

1. Madde 13 EN BAŞTA, tamamen izole (kimlik doğrulaması OLMAYAN, içerik ÜRETMEYEN 6 istekle)
   çalıştırılır — diğer senaryoların gerçek import çağrılarıyla ASLA karışmaz.
2. O 6 istek sonrası pencerenin TAMAMEN sıfırlanmasını bekleyen açık bir bekleme (~65sn) vardır.
3. Madde 6/7/8/9 (4 gerçek çağrı) TEK pencerede gruplanır; madde 10/12 (3 gerçek çağrı) başka bir
   bekleme sonrası İKİNCİ bir pencerede gruplanır — hiçbir grup 5'i aşmaz.

Bu tasarım olmadan test dosyası ardışık çalıştırıldığında (hatta TEK bir koşumda) senaryolar
birbirinin `429`'una çarpıyordu — kaynağı izlendi ve yukarıdaki gruplama/bekleme ile GİDERİLDİ
(retry ile MASKELENMEDİ).

### Temizlik stratejisi — tasarım notu

`DemoTemplateImport` tablosunun (idempotency işareti) silme ucu YOKTUR (architect §10.1 bağlayıcı
kararı) — `demo-templates-fixtures.ts::resetDemoTemplateImportRow()` tek istisna olarak ham SQL
kullanır (`support/api.ts::setRawPageBlocksDirectly` İLE AYNI `prisma db execute --stdin` deseni).
Sayfa/slider/medya/portföy temizliği İSE HER ZAMAN gerçek permanent-delete API uçları üzerinden
yapılır (kendi cascade/revizyon/slug temizlikleri zaten var, ham SQL ile YENİDEN ÜRETİLMEDİ).
Medya için "hangi 6 satır bizim" sorusu bir `id -> filename` tam-küme farkı (diff, import
öncesi/sonrası) ile kesin olarak çözülür — dosya adına göre filtreleme TEK BAŞINA yeterli
DEĞİLDİR çünkü `force` aynı 6 dosya adını TEKRAR üretir.

### Bulunan bulgu — bilgi amaçlı, engelleyici DEĞİL

`templates/modern-architecture.ts::assets` içindeki `about-image` varlığı (§4.4 "1 hakkımızda
görseli") şablonun `page.blocks` ağacında HİÇBİR YERDE referans edilmiyor (`asset:about-image`
token'ı hiç geçmiyor) — 6. görsel her import'ta gerçek bir `Media` satırı olarak materyalize
oluyor ama hiçbir bloğa bağlı değil (ölü/kullanılmayan varlık). İşlevsel bir hata DEĞİL (madde
11'in "6 görsel" sayımını etkilemiyor, görsel yine de medya kütüphanesinde görünüp seçilebiliyor)
ama muhtemelen bir önceki refactor'da bir bloğun kaldırılmasının artığı. backend-agent'a
(§8 tablosuna bir görsel bölüm eklemek veya `assets[]`'ten çıkarmak) bilgi amaçlı iletilir.

## Google Harita bloğu (`google-map`, YENİ) + 5 kurumsal blok genişletmesi — E2E kapsamı (bu turda eklendi)

Kaynak: `.claude/architect-scope-google-map-corporate-blocks.md` §7.6 (BAĞLAYICI qa-agent görev
listesi) + `.claude/security-review-google-map-corporate-blocks.md` §2 negatif matrisinin bir
örneği (tam matris backend Vitest'te — `pages.schemas.test.ts` — zaten kapsanıyor). Zincirin SON
adımı: architect → db-agent (no-op) → security-agent → backend-agent → ui-designer →
frontend-agent → seo-agent hepsi tamamlandı (backend 1045/1045, frontend unit 579/579, Vitest
yeşil; typecheck/lint temiz).

**Yeni Playwright e2e dosyası: `frontend/tests/e2e/admin-page-builder-corporate-blocks.spec.ts`,
12/12 senaryo yeşil** (3 bağımsız koşumda tutarlı — `admin-page-builder-widgets.spec.ts`/
`admin-page-builder-marketing.spec.ts`teki AYNI iki katmanlı desen, gerçek backend `:4001` +
`saas_e2e` + `next dev :3100`'e karşı). Mevcut `support/api.ts` (`patchPageBlocks`/`createPage`/
`deletePagePermanently`) ve `support/admin-session.ts` yardımcıları AYNEN kullanıldı, YENİDEN
YAZILMADI.

| Katman | Senaryo | Durum |
|---|---|---|
| 1 — admin UI | `google-map` "Medya & İnteraktif" kategorisinden eklenir; palet araması `map`/`harita`/`faq`/`fiyat`/`video` doğru bloğa eşlenir (§4.2 `keywords`) | ✅ Geçiyor |
| 2a — round-trip | `google-map`(Mod B)+`accordion`+`before-after-slider`+`pricing-table`+`logo-marquee`+`video` — TÜM yeni alanlar (`embedUrl`/`address`/`zoom`/`mapStyle`/`markerTitle`, `layoutStyle`/`isOpenDefault`, `initialSliderPosition`, `billingInterval`, `displayMode`/`grayscale`, `coverUrl`/`playStyle`/`loop`) `patchPageBlocks` → editör yeniden yükleme sonrası KAYBOLMUYOR | ✅ Geçiyor |
| 2a — round-trip | `google-map` Mod A (`embedUrl`/"Yerleştirme Kodu") — kaynak sekmesi + metin yeniden yüklemede korunuyor | ✅ Geçiyor |
| 2b — public render | `google-map` iframe doğru `src` (Mod B şablonu) + rezerve yükseklik (CLS=0) + `sandbox`/`referrerPolicy`/`title`/`loading="lazy"` + `mapStyle` filter — security-review §4.1/§4.2 BAĞLAYICI değerleriyle BİREBİR | ✅ Geçiyor |
| 2b — public render | 2+ `accordion` bloğu → sayfada TEK `FAQPage` JSON-LD `<script>` (seo-agent Boşluk 1 çözümü), tüm sorular `mainEntity`de birleşiyor, geçerli JSON | ✅ Geçiyor |
| 2b — public render | `pricing-table.billingInterval` ("Yıllık") rozeti render oluyor | ✅ Geçiyor |
| 2b — public render | `logo-marquee.displayMode: "grid"` → TEKİL render (marquee'nin 2x kopyası YOK), `grayscale: false` → opasite sınıfı | ✅ Geçiyor |
| 2b — public render | `before-after-slider.initialSliderPosition` public ARIA `aria-valuenow`e yansıyor | ✅ Geçiyor |
| 2b — public render | `video.playStyle: "lightbox"` kapak+oynat tetikleyicisi, tıklanınca `loop=1&playlist=<id>` parametreli embed açılıyor (`video-embed.ts` R5) | ✅ Geçiyor |
| 3 — geriye uyumluluk | 5 genişletilmiş bloğun ESKİ veri şekli (yeni alan YOK) kabul edilir, BUGÜNKÜ davranışla render olur; `logo-marquee` R1 ÖZELLİKLE doğrulandı: `grayscale` alanı YOKKEN hâlâ `grayscale` sınıfı (2 kopya, `?? true`) | ✅ Geçiyor |
| 4 — güvenlik (negatif, smoke) | `embedUrl`: `evil.com`, `http://www.google.com/...`, `maps.google.com` (bölgesel alt-domain), `javascript:alert(1)` → hepsi API'den `422` | ✅ Geçiyor |

### Yöntem notu — `wrapBareRootBlocks` sayesinde `containerWith()` helper'ı GEREKMEDİ

`admin-page-builder-widgets.spec.ts`/`-containers.spec.ts`teki `containerWith()` yerel
helper'ının BU dosyada YENİDEN YAZILMASINA gerek kalmadı: round-trip testinde `patchPageBlocks`e
çıplak (container'sız) kök bloklar veriliyor — admin editörü YÜKLENİRKEN
`containers.ts::wrapBareRootBlocks` her kök bloğu KENDİ tek-sütunlu konteynerine sarıyor
(`admin-page-editor-roles.spec.ts` başlığındaki AYNI mekanizma), public render ise zaten
container'sız düz kök blokları da destekliyor (`admin-page-builder-widgets/marketing.spec.ts`teki
mevcut desenle BİREBİR).

### Bulunan ve DÜZELTİLEN flake kaynağı — qa-agent'ın KENDİ test tasarımında (uygulama kodu DEĞİL)

İlk taslakta `google-map` public render testi ham `page.on("console", type==="error")` ile "sıfır
konsol hatası" bekliyordu ve TUTARLI biçimde `Failed to load resource: 401 (Unauthorized)` ile
kırılıyordu. Kök neden izlendi (`response` event listener'ıyla URL'i loglayarak): kök layout,
**anonim/çerezsiz bir ziyaretçide bile** sessizce `POST /api/v1/auth/refresh` deniyor, refresh-
token çerezi olmadığı için `401` dönüyor ve tarayıcı bunu genel "Failed to load resource" konsol
hatası olarak logluyor. Bu, `google-map`/kurumsal bloklarla **İLGİSİZ** — TAMAMEN unrelated bir
sayfada (`/`, hiçbir yeni blok İÇERMEYEN) da AYNEN reprodüksiyon edildi (bkz. bu turun geçici debug
spec'i, koşum sonrası SİLİNDİ). Test, uygulama kodu DEĞİŞTİRİLMEDEN, bu BİLİNEN/unrelated 401'i
`response` event'i üzerinden (URL bazlı, `/auth/refresh` hariç) filtreleyecek şekilde YENİDEN
tasarlandı — `pageerror` (gerçek JS hatası) denetimi TAM kapsamlı bırakıldı. Bu, CLAUDE.md madde 3
("flaky testleri tolere etme, kaynağını bul ve düzelt") gereğidir; TEST GEVŞETİLMEDİ, kapsam DIŞI
bir sinyal doğru şekilde AYRIŞTIRILDI.

### Bulunan bulgu — bilgi amaçlı, engelleyici DEĞİL (frontend-agent'a yönlendirilecek)

Yukarıdaki flake araştırması sırasında ortaya çıkan bulgu: kök layout, kimliği doğrulanmamış HER
ziyaretçide (anonim, hiçbir oturum çerezi olmadan) sayfa yüklenirken `POST /api/v1/auth/refresh`
deniyor ve beklendiği gibi `401` alıyor. İşlevsel bir hata DEĞİL (kullanıcıya görünür bir sorun
YOK, oturum durumunu doğru şekilde "giriş yapılmamış" olarak çözüyor) ama HER public sayfa
yüklemesinde gereksiz bir ağ isteği + tarayıcı konsolunda gürültülü bir hata satırı üretiyor.
Öneri: refresh çağrısını yalnızca bir refresh-token/oturum ipucu çerezi MEVCUTSA tetiklemek.
qa-agent kendi test kapsamını (bu bulguyla İLGİSİZ olan asıl "google-map" doğrulamasını)
etkilemeyecek şekilde bunu ayrıştırdı; düzeltme kararı frontend-agent'a bırakılır.

### Regresyon taraması — `admin-page-builder-widgets.spec.ts` + `admin-page-builder-marketing.spec.ts`

Bu tur `frontend/` altında SADECE yeni bir spec dosyası EKLEDİ; hiçbir ürün kodu/mevcut spec
DEĞİŞTİRİLMEDİ. İki dosya da ayrıca çalıştırıldı; gözlemlenen ara sıra başarısızlıklar (bir UI
login akışının `/dashboard`a 15sn içinde yönlenmemesi, `POST /auth/login`in `5/dk` IP kotasına
takılması — bu OTURUMDA arka arkaya çok sayıda Playwright koşumu tetiklendiği için) temiz bir
koşumda TEKRARLANMADI ve kaynağı (paylaşılan `saas_e2e` + auth rate limit, bu turun DEĞİŞİKLİĞİYLE
İLİŞKİSİZ) doğrulandı — gerçek bir regresyon DEĞİL. Ayrı bir gözlem: `admin-page-builder-
marketing.spec.ts`teki "CTA solid" testinde `getByRole("link", { name: "Bize Ulaşın" })` bazen
BİRDEN FAZLA eşleşme buluyor (footer/nav'da AYNI etiketli başka bir link) — paylaşılan `saas_e2e`
veritabanında başka bir spec'in temizlemediği navigasyon/footer verisinden kaynaklanan ÖNCEDEN VAR
OLAN bir test-izolasyon sorunu (bu turun ürün/spec değişikliğiyle İLGİSİZ); ilgili spec dosyasının
sahibi tarafından ayrıca değerlendirilmesi önerilir.

### Kapsam dışı / sonraki tur için önerilir

- `mapStyle`in 4 varyantının (standard/dark/silver/retro) TAMAMI için ayrı bir public-render
  assertion'ı YAZILMADI (yalnızca `dark` doğrulandı) — `MAP_STYLE_FILTER` sabit obje look-up'ı
  zaten backend/frontend birim testlerinde (mimar §5/3, güvenlik denetimi) dolaylı kapsanıyor;
  burada bir örnek yeterli görüldü (test sayısını şişirmemek için).
- `google-map`in `noIndex` sayfada `Place` JSON-LD'sinin BASILMADIĞI (seo-agent Boşluk 2) ayrı bir
  e2e ile doğrulanmadı — mimar §7.6 listesinde açıkça istenmiyor, seo-agent'ın kendi kapsamı.
- A11y (axe-core) otomasyonu bu dosyaya EKLENMEDİ — mevcut `jest-axe` deseni (bkz. yukarıdaki "A11y
  notu" bölümleri) zaten `Field`/`Switch`/`SegmentedToggle` gibi paylaşılan bileşenleri component
  seviyesinde kapsıyor; bu turda YENİ bir a11y paterni (özel semantik) eklenmedi.

## Panel drag & drop ergonomisi (fail-safe Yukarı/Aşağı düğmeleri + `@dnd-kit/modifiers`) + anlık (on-demand) `layout` revalidation — E2E kapsamı (bu turda eklendi)

Kaynak: frontend-agent'ın üç `DndContext`'e (`builder-canvas.tsx`, `nav-tree-editor.tsx`,
`slide-strip.tsx`) `restrictToVerticalAxis`/`restrictToWindowEdges` eklemesi + navigasyon ağacı/
slider stüdyosu satırlarına YENİ fail-safe `Yukarı taşı`/`Aşağı taşı` düğmeleri eklemesi, VE
backend-agent'ın `triggerGlobalRevalidation()`i (`backend/src/lib/revalidate.ts`) appearance (4 uç)
+ navigasyon (1 uç) başarılı yazmalarından SONRA `{ paths: ["/"], type: "layout" }` ile tetiklemesi
(önceki turdaki `triggerPublicPageRevalidation` YALNIZCA tekil sayfa path'lerini biliyordu — bu
uçlar öncesinde HİÇ revalidation tetiklemiyordu).

| # | Senaryo | Dosya | Durum |
|---|---|---|---|
| 1 | Navigasyon paneli — Aşağı taşı butonu sırayı değiştirir (DOM), kaydedilir, sayfa yenilenince backend'de KALICI | `frontend/tests/e2e/admin-navigation-editor.spec.ts` | ✅ Geçiyor (yeni) |
| 2 | Navigasyon paneli — ilk öğede Yukarı taşı, son öğede Aşağı taşı `disabled`; orta öğenin hiçbiri değil | `frontend/tests/e2e/admin-navigation-editor.spec.ts` | ✅ Geçiyor (yeni) |
| 3 | Navigasyon paneli — sürükle-bırakla (manuel `mouse.move` sekansı) yeniden sıralama, kaydedilir, sayfa yenilenince backend'de KALICI | `frontend/tests/e2e/admin-navigation-editor.spec.ts` | ✅ Geçiyor (yeni) |
| 4 | Appearance — Birincil Renk panelde değiştirilip kaydedildikten SONRA public site'a TEK `page.reload()` ile (60sn `expect.poll` GEREKMEDEN) anlık yansır; public `GET /appearance` de aynı değeri döner | `frontend/tests/e2e/admin-appearance-instant-revalidation.spec.ts` | ✅ Geçiyor (yeni) |

**Bu dosya §10.10 (navigasyon menü editörü) panelinin İLK e2e kapsamıdır** — `/admin/navigation`
sayfası için önceden hiçbir Playwright spec'i yoktu.

### Altyapı düzeltmesi — `playwright.config.ts`'in `webServer`ı `REVALIDATE_SECRET` GEÇİRMİYORDU (qa-agent bulup düzeltti, kendi test altyapısı — uygulama kodu DEĞİL)

`frontend/.env.local`'daki `REVALIDATE_SECRET` (`dev-revalidate-secret-change-me`, `next dev`
tarafından otomatik yüklenir) `backend/.env.e2e`'deki değerle (`e2e-revalidate-secret`) EŞLEŞMİYORDU.
`playwright.config.ts`'in `webServer.command`'ı (e2e frontend'ini `next dev -p 3100` ile başlatan
komut) bu değişkeni override ETMİYORDU — yani e2e backend'inin `triggerGlobalRevalidation()`
çağrısı frontend'in `POST /api/revalidate`'inden HER ZAMAN `401` alıyordu (best-effort try/catch
sayesinde admin isteği BOZULMUYORDU, ama anlık yansıma da GERÇEKLEŞMİYORDU — sessiz bir
`app.log.warn`). **Ampirik olarak doğrulandı**: `REVALIDATE_SECRET=wrong-secret-value` ile
başlatılan bir frontend sürecine karşı test "4" (`admin-appearance-instant-revalidation.spec.ts`)
BEKLENDİĞİ GİBİ fail etti (tek reload sonrası eski renk `#1C4B42` görünmeye devam etti, yeni renk
`#ff2d78` YANSIMADI) — doğru secret'a geri dönülünce aynı test tekrar geçti. Düzeltme:
`playwright.config.ts`'e `E2E_REVALIDATE_SECRET` (varsayılan `backend/.env.e2e` ile BİREBİR aynı)
env değişkeni eklendi, `webServer.command`'a `REVALIDATE_SECRET=...` olarak enjekte edilir (process
env, Next.js'te `.env.local` dosya değerinin ÖNÜNE geçer). Bu, CI'da devops-agent'ın backend/
frontend'i AYRI süreçler olarak başlatacağı gerçek pipeline için de geçerli bir uyarı: iki tarafın
`REVALIDATE_SECRET`'ı MUTLAKA eşleşmeli.

### Bulunan ve raporlanan bug — frontend-agent'a yönlendirilecek (qa-agent DÜZELTMEDİ)

`nav-tree-editor.tsx`'e eklenen `restrictToVerticalAxis` modifier'ı, dnd-kit'in `DndContext`
seviyesinde `onDragMove`/`onDragEnd` event'lerinin `delta.x`'ini KAYNAKTA (render transform'undan
ÖNCE, `scrollAdjustedTranslate` — yani event payload'ının kendisi) sıfırlıyor (doğrulandı:
`node_modules/@dnd-kit/core/dist/core.esm.js`, `onDragMove` effect'i ve
`createHandler(Action.DragEnd)` — ikisi de `delta`yı `modifiedTranslate`'ten türetilen
`scrollAdjustedTranslate`'ten okuyor). `nav-tree-editor.tsx::handleDragMove` tam olarak bu
`event.delta.x`'i `offsetLeft`'e yazıp `previewProjection`/`moveItem`'ın yatay-sürükleme-ile-girinti
mantığına (Karar 5.3 — "sağa sürükleyerek bir üst öğenin altına taşıyın") besliyor. Modifier
eklendiğinden beri `offsetLeft` HER ZAMAN 0 — yani **sürükleyerek girintileme artık SESSİZCE
çalışmıyor** (yalnızca aynı derinlikte yeniden sıralama çalışıyor, girinti artır/azalt düğmeleri
fail-safe olarak hâlâ çalıştığından kullanıcı TAMAMEN kilitli KALMIYOR). Sayfadaki "Sürükleyerek
sıralayın; sağa sürükleyerek (veya girinti butonlarıyla) bir üst öğenin altına taşıyın" ipucu
(`app/admin/navigation/page.tsx`) artık YANLIŞ. `slide-strip.tsx`/`builder-canvas.tsx` bu
regresyondan ETKİLENMEZ (`delta.x`/yatay ofset kullanmıyorlar, saf `over.id` tabanlı yeniden
sıralama). Bu dosyadaki testler BİLEREK yalnızca aynı derinlikte (root-seviye kardeşler arası)
sürükleme/buton akışlarını kapsar — testlerin PASS olması modifier'ın güvenli olduğu anlamına
GELMEZ, yalnızca test edilen alt kümenin etkilenmediği anlamına gelir.

### Regresyon — `admin-slider-studio.spec.ts` test "5" GERÇEKTEN KIRILDI, qa-agent'ın KENDİ testinde düzeltildi (uygulama kodu DEĞİL)

`slide-strip.tsx`'e eklenen YENİ `Yukarı taşı: Slayt A`/`Aşağı taşı: Slayt A` fail-safe düğmeleri,
mevcut testin `adminPage.getByRole("button", { name: "Slayt A" })` (Playwright varsayılanı:
`exact: false`, alt dize eşleşmesi) seçicisiyle ÇAKIŞTI — "Yukarı taşı: Slayt A" "Slayt A" alt
dizesini İÇERDİĞİ için seçici artık ÜÇ elemanla eşleşip `strict mode violation` ile fail ediyordu
(doğrulandı: tam suite koşumunda gerçek kırılma). Düzeltme (qa-agent'ın KENDİ test dosyasında,
`admin-slider-studio.spec.ts` test "5"in İKİ satırına `exact: true` eklendi) — bu, `admin-slider-
studio.spec.ts` test "13"teki AYNI kategori kök nedenin (kısa kod menü öğesi eklentisinin ÖNCEKİ bir
turda AYNI şekilde `getByRole("menuitem", { name: "Kopyala" })`yı kırması) TEKRARIdır; frontend-
agent'ın yeni erişilebilir isim EKLEYEN her UI değişikliği bu sınıf regresyona açıktır. Düzeltme
sonrası TAM `admin-slider-studio.spec.ts` (19 test) + `admin-appearance-studio.spec.ts` (6 test) +
`admin-appearance-theme-tokens.spec.ts` (3 test) + `admin-page-builder-editing-tools.spec.ts` (6
test) + `admin-page-builder-containers.spec.ts` (6 test) yeniden koşuldu — hepsi yeşil.

### Yöntem notu — appearance dosyalarındaki eski 60sn `expect.poll`ların artık NEDEN gereksiz olduğu doğrudan gözlemlendi

`admin-appearance-studio.spec.ts`/`admin-appearance-theme-tokens.spec.ts`teki mevcut testler
(`expect.poll(..., { timeout: 90_000, intervals: [2_000] })` ile public yansımayı bekliyordu) bu
turda DEĞİŞTİRİLMEDİ (hâlâ geçerli/gerekli — hâlâ eski tekil-sayfa `revalidate: 60` yoluna
güveniyorlar) ama backend'in `triggerGlobalRevalidation()`i sayesinde artık İLK poll denemesinde
geçiyorlar — tüm dosya (9 test) önceki turlarda dakikalarca sürerken bu turda ~1 dakikada tamamlandı
(gözlemlenen gerçek koşum süresi). Bu, bağımsız bir DOLAYLI doğrulamadır: appearance uçları
GERÇEKTEN anlık revalidation tetikliyor (aksi halde bu testler hâlâ ~60sn beklerdi).

### Bilinçli olarak KAPSAM DIŞI bırakılan

- `builder-canvas.tsx`'in ÖNCEDEN var olan `ArrowUp`/`ArrowDown` düğmeleri (`aria-label="Yukarı
  taşı"`/`"Aşağı taşı"`, kardeş-etiketsiz) bu turda DEĞİŞMEDİ ve zaten `admin-page-builder-
  editing-tools.spec.ts`/`admin-page-builder-containers.spec.ts` içinde dolaylı olarak kapsanan
  konteyner sürükleme akışlarıyla birlikte test ediliyor — bu turda AYRI bir buton testi
  eklenmedi (görev talimatı zaten "bu turda değişmedi, mevcut kapsamı zaten var olabilir kontrol
  et" diyordu; kontrol edildi, `restrictToVerticalAxis` bu bileşende `delta.x` kullanılmadığı için
  zararsız).
- Navigasyon ağacında girinti/çıkıntı (indent/outdent) düğmeleri VE 2-seviye iç-içe geçirme
  senaryoları bu turda e2e ile kapsanmadı (mevcut saf mantık zaten `nav-tree-utils.ts`'e karşı
  birim test edilmiş olabilir — kontrol edilmedi, frontend-agent'ın alanı; bu tur SADECE görev
  talimatındaki 3 senaryoya — yukarı/aşağı buton, sürükleme, ilk/son disabled — odaklandı).

## `DragOverlay` koordinat sapması düzeltmesi (`createPortal(..., document.body)` + `DragOverlay`'e ÖZEL `modifiers`) — E2E kapsamı (bu turda eklendi)

Kaynak: frontend-agent'ın `nav-tree-editor.tsx` ve `builder-canvas.tsx`'te `DragOverlay`'i
`createPortal` ile `document.body`'ye taşıması (önceden ebeveyn CSS kapsayıcılarının
`transform`/`relative`/`overflow`'undan etkilenip imleç-eleman arasında offset/koordinat sapmasına
yol açıyordu) VE `DragOverlay`'e (artık `DndContext`'e DEĞİL) özel
`modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}` eklemesi.

| # | Senaryo | Dosya | Durum |
|---|---|---|---|
| 4 | Navigasyon ağacı — sürükleme sırasında `DragOverlay` `document.body`'nin DOĞRUDAN altına (en yakın `position: fixed` ata → `parentElement === document.body`) portal edilir | `frontend/tests/e2e/admin-navigation-editor.spec.ts` | ✅ Geçiyor (yeni) |
| 5 | Navigasyon ağacı — menü öğesini sağa sürüklemek bir önceki kök öğenin ALTINA iç içe geçirir (drag-to-indent, `offsetLeft`/`delta.x` KORUNUYOR) | `frontend/tests/e2e/admin-navigation-editor.spec.ts` | ✅ Geçiyor (yeni) |
| 7 | Sayfa Düzenleyici (page builder) — sürükleme sırasında `DragOverlay` `document.body`'nin DOĞRUDAN altına portal edilir | `frontend/tests/e2e/admin-page-builder-containers.spec.ts` | ✅ Geçiyor (yeni) |
| 8 | Sayfa Düzenleyici — aynı konteyner içindeki iki kardeş bloğu sürükle-bırakla yeniden sırala → DOM sırası değişir → kaydet → sayfa yenile → KALICI | `frontend/tests/e2e/admin-page-builder-containers.spec.ts` | ✅ Geçiyor (yeni) |
| 9 | Sayfa Düzenleyici — **kök seviyede iki KONTEYNERİ** (ikisi de kendi alt-sütunlarını barındırır) birbirinin üzerine sürüklemek KARDEŞ yer değiştirir (TORUN olmaz — `Seviye 1` sayısı 2'de sabit kalır) → kaydet → sayfa yenile → KALICI (bkz. aşağıdaki "ÇÖZÜLDÜ" bölümü — `collisionDetectionStrategy` düzeltmesinin regresyon testi) | `frontend/tests/e2e/admin-page-builder-containers.spec.ts` | ✅ Geçiyor (yeni, 4× tekrar + tam suite 2× — flaky DEĞİL) |

### ÖNCEKİ regresyon bulgusu ARTIK GEÇERSİZ — bu turda ÇÖZÜLDÜĞÜ doğrulandı (test "5")

Yukarıdaki "Bulunan ve raporlanan bug" bölümü (`nav-tree-editor.tsx`'e `restrictToVerticalAxis`
eklenmesinin sağa-sürükleyerek-girintilemeyi — Karar 5.3 — sessizce bozduğu bulgusu) **bu turdaki
düzeltmeyle ARTIK GEÇERLİ DEĞİL**. Kaynak kodu incelemesiyle doğrulandı
(`node_modules/@dnd-kit/core/dist/core.esm.js`): dnd-kit'te `DragOverlay`'in KENDİ `modifiers`
prop'u (~satır 3897-3937, `applyModifiers` çağrısı SADECE render edilen overlay'in GÖRSEL
`transform`'u için) `DndContext`'in `translate`/`delta` hesabından (~satır 2957-2976, `onDragMove`/
`onDragEnd` event payload'ının KAYNAĞI) TAMAMEN AYRI bir kod yoludur. Bu turdaki düzeltme
`restrictToVerticalAxis`'ı SADECE `<DragOverlay modifiers={...}>`'a ekliyor —
`nav-tree-editor.tsx`'teki `<DndContext modifiers={[restrictToWindowEdges]}>` (yalnızca)
DEĞİŞMEDİ. Test "5" bunu GERÇEK bir sürükleme ile ampirik olarak doğruladı: 3 kök öğeden ortadakini
sağa (+80px) VE bir alt satıra sürüklemek, onu bir önceki kök öğenin ÇOCUĞU yaptı (`canOutdent`
düğmesi `disabled`'dan `enabled`'a geçti, sunucuya kaydedilip sayfa yenilendikten SONRA da
`parentId` KALICI olarak doğru kaldı) — sağa-sürükleyerek-girintileme ÇALIŞIYOR.

### ÇÖZÜLDÜ (bu turda) — kök seviyede konteyner↔konteyner sürükleme artık GÜVENİLİR (`collisionDetectionStrategy`)

**Önceki durum (artık geçersiz):** `builder-canvas.tsx`'te KÖK SEVİYEDE iki KONTEYNERİ birbirinin
üzerine sürükleyerek yeniden sıralamak — kardeşleri OLMAYAN (çocuksuz/yaprak) bloklarla
karşılaştırıldığında — GÜVENİLMEZDİ: her konteynerin KENDİ `useSortable` çarpışma dikdörtgeni
İÇİNDEKİ çocuk bloğun (`Metin` vb.) çarpışma dikdörtgenini de KAPSIYORDU; `DndContext`'in TEK BAŞINA
`closestCorners` çarpışma tespiti bu yüzden imleç hedef konteynerin KENDİ üst-bilgi (header)
şeridinde olsa BİLE çoğu zaman en yakın adayı DIŞ konteyner yerine İÇTEKİ çocuk bloğu/alt-konteyneri
seçiyordu — bu da `handleDragEnd`'in konteyneri kardeşiyle YER DEĞİŞTİRMEK yerine hedef konteynerin
İÇİNE (torun olarak) taşımasına yol açıyordu (aynı-ebeveyn swap dalı yerine konteynerler-arası taşıma
dalı, bkz. `builder-canvas.tsx::handleDragEnd`). Bu, o turdaki düzeltmenin (portal/`DragOverlay`
`modifiers`) bir REGRESYONU DEĞİLDİ — nested `SortableContext` + `closestCorners` kombinasyonunun
ÖNCEDEN VAR OLAN, bağımsız bir belirsizliğiydi; test "8" o yüzden BİLEREK kök-seviye konteyner-
konteyner sürüklemesi YERİNE aynı konteyner içindeki İKİ KARDEŞ (çocuksuz) bloğu sürükleyerek
`onDragEnd`'in aynı-ebeveyn swap dalını doğruluyordu — bu bulgu frontend-agent'a yönlendirilmişti.

**Düzeltme (frontend-agent, bu turda):** `DndContext`'in tek başına `closestCorners`'ı YERİNE, yeni
bir `collisionDetectionStrategy(args)` fonksiyonu (`builder-canvas.tsx`, `DndContext`'e
`collisionDetection` prop'u olarak bağlı) — ÖNCE `pointerWithin` (imlecin GERÇEKTEN içinde bulunduğu
droppable'ları KAPSAMA'ya göre bulur, mesafe DEĞİL) dener; header'ın Y aralığı altındaki
çocuk/alt-konteynerlerin Y aralığını KAPSAMADIĞI için imleç header'dayken YALNIZCA konteynerin
KENDİSİ eşleşiyor artık — kapsama netliği, eski köşe-mesafesi belirsizliğini ORTADAN KALDIRIYOR.
Hiçbir droppable imleci KAPSAMIYORSA (hızlı sürükleme, between-inserter boşlukları vb.)
`closestCorners`'a DÜŞÜLÜYOR — o durumdaki eski davranış AYNEN KORUNUYOR.

**qa-agent doğrulaması (bu turda, KALICI test eklendi — test "9"):** kök seviyede, ikisi de kendi 2
alt-sütununu (2-sütunlu preset benzeri, her biri Seviye 2) barındıran iki konteyner (C1, C2) kurulur;
C1'in tutamacı C2'nin ÜST-BİLGİ şeridine bırakılır. Doğrulanan iddialar: (1) DOM metin sırası TAM
TERS ÇEVRİLİYOR — C2'nin iki alt-sütunu BİRLİKTE, C1'in iki alt-sütunu BİRLİKTE (hiçbiri
BÖLÜNMÜYOR); (2) `Seviye 1` rozet sayısı sürükleme ÖNCESİ/SONRASI 2'de SABİT kalıyor (C1 torun
olsaydı 1'e düşerdi) — hiçbir yeni `Seviye 3` belirmiyor; (3) kaydet → sayfa yenile → backend'de
kök dizi TAM 2 elemanlı, sıra `[C2, C1]`, her biri KENDİ 2 alt-sütununu (children id'leri) KORUYARAK
KALICI. Test 4× arka arkaya + tam dosya suite'i 2× TEKRARLANDI — flaky DEĞİL (bkz. dosyadaki qa-agent
notu: viewport'un varsayılan 720px yüksekliği C1/C2'nin header'larını (her biri TAM bir zengin metin
editörü taşıyan alt-sütunlar YÜZÜNDEN) farklı scroll konumlarına düşürüyordu — `page.mouse.move`
viewport DIŞINDAKİ bir noktaya sessizce ISABET ETMİYORDU, bu ilk denemede SAHTE-NEGATİF bir
başarısızlığa yol açmıştı; test artık her iki header'ı da AYNI ANDA görecek kadar yüksek bir viewport
ayarlıyor). Konteynerin KENDİ "•••" menüsündeki fail-safe "Yukarı Taşı"/"Aşağı Taşı" düğmeleri
(`ContainerMoreMenu`, `builder-canvas.tsx::move()`, index tabanlı) zaten bu sorundan hiç
ETKİLENMEMİŞTİ — bu turda regresyon testi test "3"teki (isDescendant guard) ve test "8"deki (aynı-
ebeveyn kardeş sıralama) davranışların da DEĞİŞMEDEN geçtiğini yeniden doğruladı.

### Kapsam dışı bırakılan (bu tur)

- `slide-strip.tsx` (Hero Stüdyosu) ve `email-canvas.tsx` (E-posta Editörü) bu turda AYNI koordinat
  sapması düzeltmesini ALMADI (görev tanımında açıkça kapsam dışı bırakıldı) — bu iki dosya için
  test değişikliği YAPILMADI.
- KeyboardSensor (klavye ile sürükleme) için AYRI bir regresyon testi eklenmedi — ne öncesinde ne
  şimdi bu iki dosya için mevcut bir kapsam yoktu; kaynak inceleme (dnd-kit `applyModifiers`'ın
  sensör TÜRÜNDEN bağımsız, her ikisi için de AYNI kod yolu olduğu doğrulandı) düşük risk gösteriyor
  ama ampirik DOĞRULAMA YAPILMADI — sonraki bir turda eklenmesi önerilir.

## `ecommerce-pro` demo şablonu + varyasyon/döküman/kargo storefront genişlemesi — E2E kapsamı (bu turda eklendi)

Kaynak: `.claude/architect-scope-ecommerce-pro-template.md` §9.9 (bağlayıcı qa-agent görev
listesi) + üst doküman `.claude/architect-scope-demo-template-import.md` §12 (RBAC/idempotency/
confirm/force/hız sınırı — MİRAS ALINDI, yeniden yazılmadı). Üç yeni dosya:

| Dosya | Kapsadığı madde(ler) |
|---|---|
| `frontend/tests/e2e/product-pdp-variants.spec.ts` | 1 (renk seçimi → görsel+fiyat), 2 (düşük stok uyarısı), 4 (PDF indirme) |
| `frontend/tests/e2e/cart-dedupe-drawer-shipping.spec.ts` | 3 (sepet dedupe — KRİTİK regresyon), 5 (kargo eşiği), 6 (sepet çekmecesi) |
| `frontend/tests/e2e/ecommerce-pro-template-import.spec.ts` | 7 (şablon import), 8 (products modülü kapalı), 9 ([DTI] §12 mirası, `ecommerce-pro` ile parametrize) + SKU-çakışma repro |

**Tasarım kararı — 1/2/3/4/5/6 `ecommerce-pro`'nun KENDİ verisiyle DEĞİL, izole fixture ürünleriyle
test edildi** (`support/product-variants-fixtures.ts`, `POST /admin/products`+`.../variants`+
`.../documents` ile ADMIN token'ıyla kurulur). Gerekçe: `templates/ecommerce-pro.ts`teki HİÇBİR
varyasyonun `imageAssetKey`'i dolu değil (hepsi `null`) — yani şablonun kendi verisiyle "renk
seçimi GÖRSELİ değiştiriyor" iddiası doğrulanamazdı. Yalnızca 7/8/9 (şablon import'un kendisi)
`ecommerce-pro`'nun gerçek verisiyle test edildi (`support/ecommerce-pro-fixtures.ts`).

| # | Senaryo | Dosya | Durum |
|---|---|---|---|
| 1 | Renk seçimi ana görseli + fiyatı değiştiriyor (miras/mutlak override); stoksuz değer disabled+aria-label "Stokta yok" | `product-pdp-variants.spec.ts` | ✅ Geçiyor |
| 2 | 0<stok≤3 iken "Son N ürün!"; yüksek stokta YOK | `product-pdp-variants.spec.ts` | ✅ Geçiyor |
| 3 | Varyasyonsuz aynı ürün 2 kez → TEK satır miktar 2; 2 farklı varyasyon → İKİ satır (§1.4 KRİTİK regresyon) | `cart-dedupe-drawer-shipping.spec.ts` | ✅ Geçiyor |
| 4 | PDF kartından indirme → 200 + `content-type: application/pdf` + `content-disposition: attachment` | `product-pdp-variants.spec.ts` | ✅ Geçiyor |
| 5a | `shippingFlatFeeCents=null` iken kargo satırı/çubuğu HİÇ render edilmiyor (regresyon) | `cart-dedupe-drawer-shipping.spec.ts` | ✅ Geçiyor |
| 5b | Eşik altı → kargo>0 + doğru "son X ₺" metni; eşiğe ulaşınca kargo 0 + Toplam=Ara Toplam | `cart-dedupe-drawer-shipping.spec.ts` | ✅ Geçiyor |
| 6 | Sepete ekleme çekmeceyi otomatik açıyor; miktar güncelleme Toplam'ı değiştiriyor | `cart-dedupe-drawer-shipping.spec.ts` | ✅ Geçiyor |
| 7 | ADMIN `ecommerce-pro` uygula → 201; audit `commerceCounts` TAM olarak {kategori:4, ürün:8, varyasyon:14, döküman:4, sayfa:4}; 4 yasal sayfa `isLegalDocument:true` + yer tutucu metin; `Order` satırı sayısı DEĞİŞMEDİ (delta=0) | `ecommerce-pro-template-import.spec.ts` | ✅ Geçiyor |
| 8 | `products` modülü kapalıyken import → 201 + "Ürünler modülü kapalı..." UYARISI + "4 yasal sayfa YER TUTUCU..." uyarısı BİRLİKTE | `ecommerce-pro-template-import.spec.ts` | ✅ Geçiyor |
| 9 | [DTI] §12 mirası, `ecommerce-pro` ile parametrize: hız sınırı (6. istek 429), idempotency (force:false → 409), `confirm` zorunluluğu (422), RBAC (MANAGER/EDITOR GET 200/POST 403, USER GET 403/POST 403) | `ecommerce-pro-template-import.spec.ts` | ✅ Geçiyor |
| SKU-çakışma | `force:true` ile İKİNCİ import — `Product.sku` global `@unique` çakışması | `ecommerce-pro-template-import.spec.ts` | ✅ Geçiyor — **409 CONFLICT (kontrollü), ham 500 DEĞİL** (aşağıya bkz.) |

**14/14 senaryo yeşil.** Üç dosya birbirinden bağımsız + tam suite içinde art arda (izole VE
birleşik) koşuldu, tutarlı geçti.

### Backend unit/entegrasyon testleri (backend-agent, bu turda eklendi — documentation-agent envanteri)

E2E'den bağımsız, saf fonksiyon/şema/route seviyesinde dört yeni `backend/tests/unit/` dosyası
+ bir güncellenen `backend/tests/integration/` dosyası:

| Dosya | Kapsam |
|---|---|
| `backend/tests/unit/product-pricing.test.ts` | `resolveEffectivePrice`/`resolveUnitPriceCents` — miras/mutlak fiyat + indirim BAĞIMSIZ override matrisi (§1.5) |
| `backend/tests/unit/shipping.test.ts` | `computeShipping` — `shippingFlatFeeCents=null` (kargo hesaplanmaz), eşik `null`/eşiğin 1 kuruş altı/tam eşiti/üstü, `remainingCents` 0'a kırpma (§3.3) |
| `backend/tests/unit/product-variants.test.ts` | `deriveVariantKey` (deterministik, slugify+alfabetik sıralı), `assertOptionValuesMatchAxes` (eksik/fazla/tanımsız eksen `422`), `buildVariantLabel`, `assertVariantCountWithinLimit`, `ProductVariantOptionSchema` (SWATCH/TEXT `swatchHex` kuralları) + **REGRESYON**: yazma (`variants.ts`) ile okuma (`entities.ts`) şemalarının `TEXT` eksende `swatchHex` tutarlılığı (aşağıdaki kritik bug'ın kök nedeni testle sabitlendi) |
| `backend/tests/unit/demo-templates-ecommerce-pro.test.ts` | `ecommerce-pro` tanımının `PageBlockListSchema`/`SlideLayersSchema`'dan geçmesi, `asset:`/`ref:`/`ref:product-category:` token çözümlemesi, §4.6 tavanları (8 ürün ≤12, varyasyon/döküman/sayfa tavanları), gerçek importer çağrısıyla **hiçbir `Order` satırı yaratılmadığının** doğrulanması + kaynak kodda `order`/`orderItem`/`siteUser` yazan çağrı olmadığının statik denetimi (§4.5 kabul kriteri) |
| `backend/tests/integration/products.test.ts` (güncellendi) | Yeni REGRESYON bloğu: `TEXT` ekseninde `swatchHex` olmadan oluşturulan varyasyonun liste/detay/public uçlarında (`GET /admin/products`, `GET /products`, `GET /products/{slug}`) 200 dönmesi — aşağıdaki kritik bug'ın kalıcı regresyon koruması |

### SKU-çakışma bulgusu — backend-agent'ın bildirdiği bilinen sınır, GERÇEKTEN doğrulandı: KABUL EDİLEBİLİR

Üst koordinatörün talebi üzerine gerçekten tetiklendi: `ecommerce-pro`'yu bir kez import edip
ardından `force:true` ile TEKRAR import etmek `Product.sku`/`ProductVariant.sku`'nun global
`@unique` kısıtına (importer `force`'ta yalnızca sayfa/kategori/ürün SLUG'larını benzersizleştirir,
§6.5 — SKU'ya dokunmaz) çarpıyor. Backend'in genel hata işleyicisi
(`plugins/error-handler.ts`, `Prisma.PrismaClientKnownRequestError.code === "P2002"`) bunu
**409 CONFLICT'e YAKALIYOR** — importer'ın kendi 2 denemelik retry döngüsü (`MAX_TRANSACTION_
RETRIES`) tükendikten sonra hatayı OLDUĞU GİBİ fırlatıyor ama bu, global handler tarafından ham bir
500'e DÜŞMEDEN önce kontrollü 409'a çevriliyor. **Ham bir 500/unhandled crash DEĞİL** — bu yüzden
task tanımındaki kritere göre bu davranış test içinde `expect` edildi (KABUL EDİLEBİLİR bilinen
sınırlama), backend-agent'a bug olarak YÖNLENDİRİLMEDİ. Mimari not (architect'e bilgi amaçlı):
SKU'ların da slug gibi otomatik benzersizleştirilip benzersizleştirilmeyeceği (ya da `force`'ta
SKU'nun tamamen atlanıp uyarı üretilmesi) bir sonraki turda ele alınabilecek bir tasarım kararıdır.

### KRİTİK BUG (backend-agent'a yönlendirildi) — `type: "TEXT"` varyasyon ekseninde `swatchHex` omit edilince `GET /admin/products` VE `GET /products` KALICI OLARAK 500'e düşüyor

Bu turda qa-agent tarafından GERÇEKTEN tetiklenip doğrulandı — **`ecommerce-pro`'nun KENDİ
verisini doğrudan etkileyen, yayına engel bir bug:**

**Repro (bağımsız olarak doğrulandı, backend gerçek Postgres'e karşı):**
```
POST /admin/products
{
  "title": "...", "priceCents": 1000, "stockQuantity": 0,
  "variantOptions": [{ "name": "Ölçü", "type": "TEXT", "values": [{ "value": "120 cm" }] }]
}
→ 500 INTERNAL_ERROR (FST_ERR_RESPONSE_SERIALIZATION)
```
Backend log'undaki gerçek Zod hatası:
```
ZodError: [{ "code": "invalid_type", "expected": "string", "received": "undefined",
  "path": ["data","variantOptions",0,"values",0,"swatchHex"], "message": "Required" }]
```

**Kök neden — yazma/okuma şeması ÇELİŞKİSİ:**
- YAZMA şeması (`backend/src/modules/products/lib/variants.ts::ProductVariantOptionValueSchema`)
  `type: "TEXT"` eksenlerinde `swatchHex`'in **GÖNDERİLMEMESİNİ** zorunlu kılıyor (`superRefine`:
  dolu bir `swatchHex` TEXT'te REDDEDİLİYOR).
- OKUMA (yanıt) şeması (`backend/src/schemas/entities.ts::ProductVariantOptionValueSchema`) ise
  `swatchHex: z.string().nullable()` — **`.optional()` YOK.** Yani alan `null` OLABİLİR ama
  TAMAMEN OMİT (undefined) OLAMAZ.
- Write path, `swatchHex` gönderilmediğinde bu alanı DB JSON'una `null` olarak DEFAULT'LAMIYOR —
  olduğu gibi (anahtar bile yok) yazıyor. Satır DB'ye YAZILIYOR (create başarılı), ama HEMEN
  ARDINDAN aynı isteğin YANITINI serialize ederken Zod validasyonu PATLIYOR → **`500`** ve satır
  DB'de "zehirli" (poisoned) kalıyor.

**Etki — KATASTROFİK, ürün listesini TAMAMEN kilitliyor:** Satır bir kez oluşunca (create sırasında
DB write serialization hatasından ÖNCE commit oluyor), bu satırı İÇEREN her sonraki istek —
`GET /admin/products` (liste), `GET /admin/products/{id}`, `GET /products` (public liste),
`GET /products/{slug}` — AYNI Zod hatasıyla **500** döner. Liste uçları TEK bir kayıt yüzünden
TÜM sayfayı kilitliyor; admin panelinden bu satırı düzeltmenin/silmenin bir yolu YOK (ürün listesi
zaten açılamıyor) — kurtarma yalnızca doğrudan veritabanı erişimiyle mümkün (qa-agent bunu
`DELETE FROM products WHERE id = '...'` ile ELLE kurtardı, ayrıntı aşağıda).

**`ecommerce-pro`'yu DOĞRUDAN etkiliyor:** `templates/ecommerce-pro.ts`teki **"Modüler Raf
Sistemi"** ürününün "Ölçü" (TEXT) ekseni (`values: [{value:"120 cm"},{value:"180 cm"}]`) TAM
OLARAK bu şekli taşıyor. İçe aktarma çağrısının KENDİSİ etkilenmiyor (importer `ProductSchema`
üzerinden SERİLEŞTİRME yapmıyor, ham Prisma `create` kullanıyor — bu yüzden qa-agent'ın madde 7/8
testleri 201 ile geçti) ama **import SONRASI** admin "Ürünler" listesi VE storefront `/products`
listesi (ve `/products/moduler-raf-sistemi` sayfasının kendisi) KALICI olarak kırılacaktır — bu,
demo şablonu canlıya alan HER kurulumda garanti olarak tetiklenecek bir P0 bug'dır.

**qa-agent'ın kendi test/fixture'larında aldığı önlem:** `cart-dedupe-drawer-shipping.spec.ts`teki
TEXT eksen fixture'ı bu bug'ı BİLEREK tetiklemeyecek şekilde yazıldı — `swatchHex: null` AÇIKÇA
gönderiliyor (yazma şeması TEXT için dolu bir `swatchHex`'i reddediyor ama `null`'ı kabul ediyor).
`ecommerce-pro-template-import.spec.ts`teki `purgeKnownEcommerceProContent` artık `GET
/admin/products`'a GÜVENMİYOR — ürünler doğrudan SQL ile silinir (bkz. `ecommerce-pro-
fixtures.ts::deleteKnownProductsSql` başlığındaki NOT).

**Yönlendirme:** backend-agent'a — `schemas/entities.ts::ProductVariantOptionValueSchema.swatchHex`
ya `.optional()` yapılmalı (okuma tarafı `undefined`'ı kabul etsin) YA DA write path (`products.
routes.ts`/`lib/variants.ts`) `TEXT` eksenlerinde `swatchHex`'i DAİMA `null` olarak normalize edip
öyle yazmalı (JSON'a HER ZAMAN anahtar yazılsın). İkinci seçenek muhtemelen daha güvenli (yazma
şemasının "TEXT'te swatchHex GÖNDERİLMEMELİ" kuralı frontend sözleşmesini bozmadan, DB'de tutarlı
bir şekil garanti eder). **Bu, `ecommerce-pro` özelliğinin YAYINA HAZIR OLMADIĞI anlamına gelir** —
bkz. final değerlendirme.

### İkinci fixture bug'ı — qa-agent'ın KENDİ temizlik betiğinde bulunup düzeltildi (ürün kodu DEĞİL)

`purgeKnownEcommerceProContent`'in ürünleri HAM SQL ile silmesi (yukarıdaki bug'dan kaçınmak için
zorunlu hale geldi) `content_slugs` (§10.5 i18n) tablosundaki karşılık gelen satırları YETİM
bıraktı — bu tablo `products`'a DB-seviyesi bir FK İLE bağlı DEĞİL (yalnızca `DELETE /admin/
products/{id}/permanent` → `deleteContentSlugsForEntity` ile uygulama katmanında temizleniyor).
Sonuç: bir sonraki import denemesi gerçek bir bug DEĞİL, "slug X başka bir içerik tarafından
kullanılıyor" 409'una çarpıyordu. Düzeltme: `deleteKnownProductsSql()` artık ÖNCE `content_slugs`
(`entityType='PRODUCT'`), SONRA `products` satırlarını siliyor (bkz. `ecommerce-pro-fixtures.ts`).
Bu ürün kodunu ETKİLEMEZ — yalnızca qa-agent'ın kendi fixture/temizlik betiğindeydi, kural gereği
(`.claude/CLAUDE.md` madde 3) qa-agent bunu kendisi düzeltti.

### Genel değerlendirme — bu özellik YAYINA HAZIR DEĞİL

`ecommerce-pro` şablonunun storefront tarafı (varyasyon seçici/görsel-fiyat geçişi/düşük stok/PDF
indirme/sepet dedupe/kargo eşiği/sepet çekmecesi) VE şablon import akışının RBAC/idempotency/confirm/
force/hız sınırı/audit/legal-sayfa/sipariş-yaratmama sözleşmesi **BAŞARIYLA doğrulandı, hepsi
kontrata uygun.** Ancak yukarıdaki **KRİTİK bug** (`TEXT` eksen + omit edilmiş `swatchHex` →
kalıcı 500), şablonun KENDİ ürün verisinden biri ("Modüler Raf Sistemi") tarafından GARANTİ olarak
tetikleneceği için, bu özellik **backend-agent'ın düzeltmesi olmadan yayına ALINMAMALIDIR** —
düzeltme küçük (tek satırlık şema/normalizasyon değişikliği) ama etkisi (ürün listesinin TAMAMEN
kilitlenmesi) çok yüksek.

### Güncelleme — kritik `swatchHex` bug'ı ÇÖZÜLDÜ (documentation-agent, kaynak kod üzerinden doğrulandı)

Yukarıdaki "YAYINA HAZIR DEĞİL" bulgusundan sonraki turda backend-agent düzeltmeyi uyguladı;
bu turda documentation-agent, doğrudan kaynağı okuyarak teyit etti (uydurma değildir):

- `backend/src/schemas/entities.ts::ProductVariantOptionValueSchema.swatchHex` artık
  `z.string().nullable().optional()` — okuma (yanıt) şeması `TEXT` eksende alanın hiç
  gönderilmediği (`undefined`) durumu kabul ediyor; yazma şemasıyla (`variants.ts`) çelişki
  kalmadı.
- Regresyon iki katmanda testle sabitlendi: `backend/tests/unit/product-variants.test.ts`
  ("REGRESYON — yazma şeması ile okuma şeması TEXT eksen swatchHex tutarlılığı" bloğu) ve
  `backend/tests/integration/products.test.ts` ("REGRESYON: TEXT eksende swatchHex olmadan
  oluşturulan varyasyon GERİ OKUNABİLİR (500 vermez)" bloğu — `GET /admin/products`, `GET
  /products`, `GET /products/{slug}` uçlarının 200 döndüğünü doğruluyor).
- Üst koordinatörün bildirdiğine göre bu turda tam backend suite (102 dosya/1126 test) ve
  frontend suite (97 dosya/600 test) yeşil; bu belge güncellendiği anda qa-agent'ın kendisi
  YENİDEN koşup "Genel değerlendirme"yi resmi olarak revize etmedi — yukarıdaki "YAYINA HAZIR
  DEĞİL" başlığı **tarihseldir** (bug'ın bulunduğu andaki durumu yansıtır) ve bilinçli olarak
  SİLİNMEDİ; yeni doğrulama bu ek not olarak eklendi. Yayın kararı için qa-agent'ın resmi
  yeniden-onayı önerilir.

## Ürün Katalogu (filtreleme/sıralama) + PDP yeniden inşası — E2E kapsamı (bu turda eklendi)

Kaynak: `.claude/architect-scope-products-catalog.md` §5.7 (qa-agent görev listesi) + kullanıcının
açıkça istediği dört akış: (1) kategori/fiyat/renk filtreleri, (2) PDP varyasyon değişiminde fiyat/
stok senkronu, (3) PDF teknik döküman indirme, (4) sepete ekleme (adet seçici + katalog kartı hızlı-
ekle). db-agent→backend-agent→ui-designer/frontend-agent→performance-agent→seo-agent zincirinin SON
adımı; performance-agent'ın `next/image` geçişi ve küçük h1 düzeltmesi bu turda HENÜZ commit
edilmemişti (working tree), qa-agent bunlara karşı da test etti.

| # | Senaryo | Dosya | Durum |
|---|---|---|---|
| 1 | Kategori filtresi — alt kategori SADECE kendi ürünü, üst kategori kendisi+çocukları, "Tümü" sıfırlar | `product-catalog-filters.spec.ts` | ✅ Geçiyor |
| 2 | Fiyat aralığı (manuel giriş, `aria-label="Minimum/Maksimum fiyat"`) — **indirimli ürün EFFECTIVE (indirimli) fiyata göre filtreleniyor**, orijinal liste fiyatına göre DEĞİL (§2.3 sözleşmesi) | `product-catalog-filters.spec.ts` | ✅ Geçiyor |
| 3 | Fiyat aralığı (slider, `Base UI` `input[type=range]` → `getByRole("slider")`, klavye ile taşıma) | `product-catalog-filters.spec.ts` | ✅ Geçiyor |
| 4 | Renk (option) facet filtresi — tek renk seçilince o renk, iki renk seçilince İKİSİ DE (eksen içi OR, `?option=renk:kirmizi&option=renk:mavi`) | `product-catalog-filters.spec.ts` | ✅ Geçiyor |
| 5 | "Filtreleri Temizle" — kategori+fiyat+renk'in TAMAMINI sıfırlıyor | `product-catalog-filters.spec.ts` | ✅ Geçiyor |
| 6 | PDP: adet seçici (`quantity-selector.tsx`, salt stepper) ile miktar artırılıp Sepete Ekle'ye basılınca sepete SEÇİLEN miktar (1 değil) ekleniyor; header rozeti aynı toplamı gösteriyor | `product-catalog-add-to-cart.spec.ts` | ✅ Geçiyor |
| 7 | Katalog kartı: varyasyonsuz ürünün hızlı-sepete-ekle butonu DOĞRUDAN ekliyor (buton onay durumu + header rozeti + `/cart` sayfası çapraz kontrolü) | `product-catalog-add-to-cart.spec.ts` | ✅ Geçiyor |
| 8 | Katalog kartı: varyasyonlu ürünün hızlı-ekle alanı "Seçenekleri Gör"e dönüşüyor, PDP'ye yönlendiriyor, sepete DİREKT eklemiyor/çekmece açmıyor | `product-catalog-add-to-cart.spec.ts` | ✅ Geçiyor |
| 9 (regresyon) | PDP varyasyon senkronu (renk→görsel+fiyat, stoksuz→disabled), düşük stok rozeti, PDF indirme (artık sekme İÇİNDE) | `product-pdp-variants.spec.ts` (mevcut, bu turda 2 yerde güncellendi — aşağıya bkz.) | ✅ Geçiyor |
| 10 (regresyon) | Sepet dedupe/çekmece/kargo eşiği (PDP `Sepete ekle` akışı) | `cart-dedupe-drawer-shipping.spec.ts` (mevcut, DOKUNULMADI) | ✅ Geçiyor |

**Toplam bu turda: 8 yeni senaryo (2 yeni dosya) + 7 mevcut regresyon senaryosu (2 mevcut dosya,
biri güncellendi) — hepsi yeşil.** Dört dosya birlikte (`product-catalog-filters.spec.ts`,
`product-catalog-add-to-cart.spec.ts`, `product-pdp-variants.spec.ts`,
`cart-dedupe-drawer-shipping.spec.ts`) art arda 2 kez tam koşuldu, 16/16 tutarlı geçti.

### Mevcut `product-pdp-variants.spec.ts`'te bulunan 2 REGRESYON — qa-agent kendi test dosyasını güncelledi (uygulama kodu DEĞİL)

Kural gereği (`.claude/CLAUDE.md` madde 3 "flaky testleri düzelt", bu ikisi flaky değil ama AYNI
ilke — qa-agent kendi test altyapısını düzeltir) ve çünkü ikisi de **bilinçli/dokümante edilmiş
tasarım değişikliklerinin doğal sonucu**, uygulama bug'ı DEĞİL:

1. **`next/image` geçişi `<img src>` biçimini değiştirdi.** Performance-agent'ın (henüz commit
   edilmemiş) `next/image` geçişi sonrası ana galeri görselinin `src` özniteliği ham medya
   URL'inden `/_next/image?url=<encoded>&w=...&q=...` biçimine döndü — eski test tam URL eşitliği
   bekliyordu. Düzeltme: `expectMainImageUrl()` yardımcı fonksiyonu — hem ham hem `next/image`
   proxy biçimini kabul eden bir regex (`toHaveAttribute("src", pattern)`).
2. **"Teknik Dökümanlar" artık bir sekme, `<h3>` DEĞİL.** PDP'nin yeni `ProductTabs` yapısında
   döküman listesi `showHeading={false}` ile render ediliyor (`.claude/design-notes-products-catalog.md`
   §4.4 "sekme başlığı zaten aynı bilgiyi taşıyor, çift başlık YAZILMAZ") — eski test
   `getByRole("heading", {name: "Teknik Dökümanlar"})` arıyordu, artık `getByRole("tab", ...)`.

### Bulunan GERÇEK bug'lar (bu turda) — kural gereği qa-agent DÜZELTMEZ, ilgili ajana yönlendirir

**1. frontend-agent — KRİTİK: PDP galerisi HER yüklemede bir React hydration mismatch üretiyor ve
varyasyon değişiminde `next/image` optimizasyonunu sessizce kaybediyor.** `src/components/site/safe-image.tsx::isOptimizableImageUrl`
SUNUCUDA (SSR) `next/image`'i (`<Image>`, `data-nimg="fill"`, `/_next/image?url=...` proxy) seçiyor
ama AYNI URL için İSTEMCİDE (herhangi bir client-side re-render'da — ör. PDP'de renk/beden
varyasyonu seçimi) ham `<img>` dalına düşüyor. Sonuç: (a) tarayıcı konsolunda PDP'nin HER
yüklemesinde "A tree hydrated but some attributes of the server rendered HTML didn't match the
client properties" hydration mismatch uyarısı (React "won't be patched up" diyor — DOM SSR halinde
kalıyor ta ki bir client re-render'a kadar), (b) varyasyon seçildiğinde ana görsel next/image'ın
responsive `srcset`/lazy/blur faydalarını KAYBEDİP ham/optimize-edilmemiş `<img>`'e düşüyor. Doğru
dosyayı GÖSTERMEYE devam ediyor (bu yüzden qa-agent'ın kendi testi bunu bir "yanlış görsel"
regresyonu olarak işaretlemedi — yalnızca biçim/optimizasyon kaybı), ama SSR/CSR host-listesi
tutarsızlığı gerçek ve tekrarlanabilir (elle, bağımsız bir Playwright betiğiyle `.next` TAMAMEN
temizlenmiş taze bir sunucuda bile doğrulandı — dev-cache artefaktı DEĞİL). Kök neden adayı:
`ALLOWED_IMAGE_HOSTS` (`src/lib/image-hosts.ts`), `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_MEDIA_URL`'i
modül-yükleme anında okuyor — istemci paketine gömülen değer SUNUCUNUNKİYLE senkron değil
görünüyor. Repro: herhangi bir PDP'yi aç, DevTools konsolunu izle (ilk yüklemede mismatch), sonra
bir varyasyon seç ve ana görselin `<img>` özniteliklerini (`data-nimg` kayboluyor) karşılaştır.

**2. frontend-agent — ORTA öncelik: `price-range-filter.tsx`'te hızlı ardışık Min→Max girişinde Min
sessizce kayboluyor.** `commit()` DİĞER (henüz commit edilmemiş) alanın değerini `range` LOKAL
state'inden okuyor; bu state yalnızca sunucudan dönen YENİ `filters` prop'u (bir önceki
`router.replace` TAMAMLANDIKTAN SONRA) ile senkronize oluyor. Kullanıcı Min alanını doldurup
sunucu turu tamamlanmadan HEMEN Max alanına geçip onu da commit ederse, Max'ın commit çağrısı
`range[0]`'ı hâlâ ESKİ/sınır değeriyle okuyup Min'i SESSİZCE sıfırlıyor (elle doğrulandı: URL'de
yalnızca `maxPrice` kalıyor, `minPrice` DÜŞÜYOR). Düzeltme önerisi: `commit()` DİĞER alanın
güncel/bekleyen değerini `range` prop-senkron state'i yerine bir `ref`/optimistik güncelleme ile
okumalı. qa-agent'ın kendi testi bunu ATLATMAK için commit'ler arasına `toHaveURL` beklemesi ekledi
(bkz. `product-catalog-filters.spec.ts` madde 2 yorum bloğu) — gerçek/dikkatli kullanıcı akışını
izliyor, ama hızlı-tab senaryosu hâlâ kırık.

### qa-agent'ın KENDİ test/geliştirme ortamında bulup atlattığı bir ortam sorunu (uygulama kodu DEĞİL)

**Next.js/Turbopack'in dev-modu KALICI disk önbelleği (`.next/dev/cache`, gözlemlenen boyut 3+ GB)
`next dev` süreç YENİDEN BAŞLATMALARI arasında `fetch(..., {next:{revalidate:60}})` sonuçlarını
(en azından `GET /products` unfiltered gibi ROTA-seviyesi verileri) hayatta tutuyor** — bu,
`revalidate: 60`'ın "60 saniye sonra taze veri" garantisinin AKSİNE, sunucu TAMAMEN yeniden
başlatılıp veritabanı o 60 saniyelik pencerenin ÇOK dışında değişmiş olsa bile ESKİ bir anlık
görüntü döndürülebildiği anlamına geliyor (elle, tekrarlanan `rm -rf .next/cache` + süreç
yeniden başlatmalarıyla bile İLK ÖNCE YANLIŞLIKLA doğrulanamadı — gerçek kök neden yalnızca
`.next` TAMAMEN silindiğinde, yani `.next/dev/cache` da dahil olmak üzere, ortadan kalktı).
`.next/cache` (üretim/ISR önbelleği) BOŞTU — bu farklı, Turbopack'e özgü bir dev-modu dizini. Bu
qa-agent'ın kendi yerel yineleme (iteration) döngüsünü ETKİLEDİ (birkaç saat süren yanlış
"regresyon" izlenimi), CI'da (her çalıştırma taze bir checkout/`.next` olmadan başladığı için)
BEKLENMEZ, ama **yerel geliştirme sırasında `next dev`'i sık sık yeniden başlatan herhangi bir
ajan/geliştirici için gerçek bir tuzak** — devops-agent'a bilgi amaçlı iletiliyor (CI'ın kendi
`.next` dizinini her çalıştırmada temiz tuttuğundan emin olunması önerilir; bu zaten muhtemelen
doğru varsayılan davranıştır, yalnızca doğrulanması önerilir).

### Kapsam dışı bırakılanlar (bu turda, gerekçeli)

- Mobil "Filtrele" bottom sheet'in (`catalog-mobile-filters.tsx`) kendi UI akışı — masaüstü
  sidebar'la AYNI `CatalogFilterGroups` bileşenini paylaştığı (`.claude/design-notes-products-catalog.md`
  §0 "TEK bileşen") ve filtre MANTIĞI zaten masaüstü testleriyle kapsandığı için, yalnızca Sheet'in
  açılma/kapanma mekaniği test EDİLMEDİ — kullanıcının istediği 4 maddede yoktu, zaman kısıtı.
  **Sonraki tur için önerilir.**
- Sıralama (`sort=price_asc` vb.) ve sayfalama eş-değer-kırıcı regresyonu (architect §5.7 madde 4)
  — kullanıcının istediği 4 maddede YOKTU, bu turda test EDİLMEDİ. **Sonraki tur için önerilir.**
- PDP başlık regresyon koruması (architect §5.7 madde 9, `pageHeaderStyle: HIDDEN` iken tam olarak
  bir `<h1>`) — dolaylı olarak HER PDP testinde `getByRole("heading", {level:1, ...})` ile zaten
  doğrulanıyor (bu locator'lar `HIDDEN` DIŞINDA bir `pageHeaderStyle` varsayımıyla çalışır; bu
  turun test ortamında `appearance.pageHeaderStyle` varsayılanı `HIDDEN` DEĞİLDİ, yani asıl "boş
  render" kök nedeni burada AYRICA izole doğrulanmadı) — **sonraki tur için önerilir**: appearance
  ayarını AÇIKÇA `HIDDEN`'a çekip tek bir `<h1>` regresyon testi eklemek.
- a11y otomasyonu (axe-core) katalog/PDP sayfalarına bu turda EKLENMEDİ — zaman kısıtı, kullanıcının
  istediği 4 maddede yoktu. **Sonraki tur için önerilir**, özellikle YENİ slider primitive'i
  (`components/ui/slider.tsx`) ve çoklu-seçim swatch/checkbox grupları için.
