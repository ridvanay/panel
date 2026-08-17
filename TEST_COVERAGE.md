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

### Kapsam dışı bırakılan — Öncelik 3 (galeri bloğu e2e)

Zaman kısıtı nedeniyle "Galeri Ekle" → MediaPicker çoklu seçim → içerikte render → kaydet/yeniden
aç → korunma akışının TAM Playwright e2e'si eklenmedi. Bunun yerine `MediaPicker`'ın çoklu seçim
davranışı (seçili işaret, "Seç (N)", maxSelection) component-seviyesinde (`tests/unit/
media-picker-multiple.test.tsx`) doğrulandı; galeri bloğunun TipTap içine doğru serialize/
deserialize edildiği ise frontend-agent'ın kendi unit testlerine bırakıldı (bu tur qa-agent
tarafından ayrıca doğrulanmadı). **Sonraki tur için önerilir**: tam editörde "Galeri Ekle" →
2-3 görsel seç → kaydet → sayfa yenile → galerinin korunduğunu doğrulayan bir Playwright testi.

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

## CI entegrasyonu (devops-agent'a not)

`frontend/playwright.config.ts` `webServer` ile frontend'i otomatik başlatır (`reuseExistingServer:
!process.env.CI`). Backend + `saas_e2e` veritabanı CI'da AYRI bir adım gerektirir — önerilen
şablon `backend`'in mevcut `ci.yml` job'ındaki `saas_test`/Postgres servisi deseninin birebir
kopyası (bkz. `.github/workflows/ci.yml` `backend` job'ı ve `backend/tests/setup/global-setup.ts`),
yalnızca veritabanı adı `saas_e2e` ve backend `DOTENV_CONFIG_PATH=backend/.env.e2e` ile ayrı
portta (4001) başlatılmalı. Test adımı **lint/build'den SONRA, deploy'dan ÖNCE** koşmalı (bkz.
proje kökü CLAUDE.md kural #5). Bu, qa-agent'ın önerisidir — `ci.yml`'i düzenlemek
devops-agent'ın sorumluluğundadır.
