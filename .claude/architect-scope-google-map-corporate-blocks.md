# Architect Scope: Google Harita + Kurumsal Blok Genişletmesi (Page Builder)

Ajan: **architect** · Durum: **karar verildi, bağlayıcı** · Tarih: 2026-08-31
Branş: `feature/page-builder-map-corporate-blocks` · Tek commit: `feat(page-builder): add google-map block and extend five corporate blocks`

Bu doküman **kod içermez**. Veri modeli, isimlendirme, doğrulama ve ajan görev dağılımının TEK
doğru kaynağıdır. Aşağı akıştaki her ajan (db-agent → backend-agent → ui-designer →
frontend-agent → seo-agent → qa-agent) bu dokümana uyar; çelişki olursa bu doküman + `openapi.yaml`
kazanır (bkz. `.claude/CLAUDE.md` "Çakışma Çözümü").

---

## 0) Kodbaz keşfi — orkestratörün ön bulgularının DOĞRULANMASI

Orkestratörün ilettiği tespitlerin tamamı **doğrulandı**. Ek/düzeltici bulgular:

| Blok | Mevcut durum (doğrulandı) | Sonuç |
|---|---|---|
| `google-map` | **YOK** — `ContentBlockType` union'ında (`types.ts:14-39`) hiçbir harita tipi yok | **YENİ BLOK** |
| `accordion` | `types.ts:384` — `{ items: {id,question,answer}[]; allowMultipleOpen }`. FAQPage JSON-LD **ZATEN VAR** (`site/blocks/accordion-block.tsx:7-21,42`) | GENİŞLETME |
| `before-after-slider` | `types.ts:224` — `beforeUrl/afterUrl/beforeLabel/afterLabel/orientation`. Render `useState(50)` ile sabit %50'den başlıyor (`before-after-slider-block.tsx:14`) | GENİŞLETME |
| `pricing-table` | `types.ts:471` — `plans[]` (`highlighted`/`buttonLabel`/`buttonHref` ZATEN var) | GENİŞLETME |
| `logo-marquee` | `types.ts:246` — yalnızca marquee. **`grayscale` bugün KOD İÇİNDE SABİT** (`logo-marquee-block.tsx:7` — `grayscale hover:grayscale-0` sınıfı hard-code) | GENİŞLETME |
| `video` | `types.ts:364` — `provider/url/autoplay/muted`. `video-embed.ts` "yapılandırılmış embed" güvenlik deseninin referans örneği | GENİŞLETME |

**Ek doğrulanmış gerçekler (aşağı akış için kritik):**

1. **DB migration GEREKMİYOR.** `backend/prisma/schema.prisma:460` → `Page.blocks Json @default("[]")`. Şema serbest JSON; tüm yeni alanlar opsiyonel → backfill YOK, migration YOK.
2. **`normalize.ts` içerik bloklarını DEĞİŞTİRMEDEN geçirir** (`normalize.ts:90-91`, `{...node, id}` spread). Yalnızca `container` düğümleri alan-alan normalize edilir. → **Yeni alanlar için `normalize.ts`'e DOKUNULMAZ.** (Bu, geçmişte `reveal` ve `topDivider`'da yaşanan "sessizce kaybolma" hatasının bu turda TEKRARLANMAYACAĞININ garantisidir.)
   > **db-agent düzeltmesi:** Bu maddede/§7.1'de aşağıda geçen `PageRevision.blocks (~satır 1491)` referansı YANLIŞ — böyle bir model yok. Doğrusu: `ContentRevision.snapshot` (`schema.prisma:1432-1448`, polymorphic `entityType`/`entityId` + tüm sayfa/blog alan setini tutan tek bir `snapshot Json` alanı; `blocks` ayrı bir sütun değil, bu `snapshot` JSON'ının içine gömülü). Sonuç değişmiyor: `snapshot` da şemasız `Json`, index/constraint/trigger yok, eski kayıtlar sorunsuz geri yüklenir.
3. **`sanitize-blocks.ts` değişmez.** Yalnızca `text`/`custom-html` bloklarının `data.html`'ini temizler; bu turdaki hiçbir yeni alan HTML taşımaz.
4. **CSP KAPALI** — `backend/src/plugins/security.ts:12` → `contentSecurityPolicy: false`. Yani `frame-src` gibi bir tarayıcı-seviyesi savunma katmanı YOK; iframe kaynak güvenliği %100 uygulama katmanına düşüyor (§3'ün önemi bu yüzden yüksek).
5. **Admin editörü blok başına AYRI bir çekmece (drawer) KULLANMAZ.** Sağdan açılan `Sheet` yalnızca **konteyner** ayarları içindir (`.claude/design-notes-page-builder-sticky-panel-and-toolbar.md` §1). İçerik blokları `builder-canvas.tsx::ContentBlockCard` içinde **satır içi kart** olarak düzenlenir (`builder-canvas.tsx:485-550`). → Kullanıcının "canlı önizlemeli ayar çekmecesi" isteği §4.3'te yeniden yorumlandı.
6. **`AddContentMenu` araması YALNIZCA `meta.label` üzerinde çalışır** (`add-content-menu.tsx:104-106`). Kullanıcının istediği `map`/`faq`/`fiyat` gibi terimler bugün **hiçbir sonuç döndürmez**. → §4.2'de `keywords` alanı eklenir.
7. **`TEMPLATE_EDITABLE_FIELDS` iki yerde AYNADIR** ve fail-closed'dır: `backend/src/lib/page-template-fields.ts` (otorite) + `frontend/src/lib/page-builder/template-fields.ts` (ayna).
8. **`openapi.yaml` `PageBlock.type` enum'u BAYAT** (`docs/architecture/openapi.yaml:9679-9690` — yalnızca 9 tip listeli, gerçekte 25 tip var). Bu turda düzeltilecek (§7.2).

---

## 1) BAĞLAYICI MİMARİ KARAR — yeni tip mi, genişletme mi?

**Karar: 1 YENİ blok tipi + 5 MEVCUT blok tipinin AYNI `type` adıyla genişletilmesi.**

| Kullanıcının istediği ad | Uygulanacak `type` | Karar |
|---|---|---|
| `google-map` | `"google-map"` | **YENİ** |
| `accordion`/`faq` | `"accordion"` | Genişletme — `faq` diye İKİNCİ bir tip **AÇILMAZ** |
| `before-after` | `"before-after-slider"` | Genişletme — tip adı **DEĞİŞMEZ** |
| `pricing-table` | `"pricing-table"` | Genişletme |
| `logo-cloud` | `"logo-marquee"` | Genişletme — tip adı **DEĞİŞMEZ** (`displayMode: "grid"` ile "logo cloud" davranışı elde edilir) |
| `video-player` | `"video"` | Genişletme |

**Gerekçe (bağlayıcı):** `Page.blocks` şemasız bir JSON sütunudur ve DB'de **halihazırda yayınlanmış
sayfalar** bu tip adlarını taşır. Yeni tip adları açmak (`faq`, `logo-cloud`, `video-player`) veri
modelini ikiye böler, `BlockRenderer`'da çift kod yolu, `normalize.ts`'te bir migrasyon dalı ve
`TEMPLATE_EDITABLE_FIELDS`'te çift kayıt gerektirirdi — hiçbir kullanıcı-görünür fayda karşılığı
olmadan. Ayrıca `logo-marquee`/`before-after-slider` tip adları e2e testlerinde ve demo şablon
JSON'larında geçer.

### 1.1 Alan adı uzlaştırma tablosu (BAĞLAYICI — aşağı akış bunu TAHMİN ETMEZ)

Kullanıcının isteğindeki adlar, kodbazın yerleşik isimlendirmesine şöyle eşlenir. **Hiçbir mevcut
alan YENİDEN ADLANDIRILMAZ** (rename = tüm eski kayıtları kırar).

| Kullanıcı isteği | Kodbazda kullanılacak ad | Not |
|---|---|---|
| `iframeEmbedUrl` | `embedUrl` | `getVideoEmbedUrl`/`video-embed.ts` isimlendirmesiyle uyumlu |
| `apiKey` | **YOK — REDDEDİLDİ** | bkz. §3.1 |
| `mapStyle` | `mapStyle` | aynen |
| `height` (px/vh) | `height: { value: number; unit: "px" \| "vh" }` | `ContainerLength` deseniyle BİREBİR (`types.ts:533`) — serbest CSS string ASLA |
| `items[].title` / `.content` | `items[].question` / `.answer` | MEVCUT, değişmez |
| `items[].isOpenDefault` | `items[].isOpenDefault` | YENİ, opsiyonel |
| `isPopular` | `highlighted` | MEVCUT, değişmez |
| `buttonText` / `buttonUrl` | `buttonLabel` / `buttonHref` | MEVCUT, değişmez |
| `logos[].imageUrl` | `items[].url` | MEVCUT, değişmez |
| `displayMode: 'marquee-slider'` | `displayMode: "marquee"` | değer adı kısaltıldı ("slider" burada `advanced-slider` ile karışırdı) |
| `videoType` | `provider` | MEVCUT, değişmez |
| `videoUrl` | `url` | MEVCUT, değişmez |
| `coverImageUrl` | `coverUrl` | `photoUrl`/`avatarUrl`/`beforeUrl` desenine uyumlu |
| `playStyle: 'lightbox-popup'` | `playStyle: "lightbox"` | mevcut `ImageBlock.lightbox` / `gallery-lightbox.tsx` terminolojisiyle uyumlu |

### 1.2 Geriye dönük uyumluluk sözleşmesi (ihlal edilemez)

- **TÜM yeni alanlar OPSİYONELDİR** (`?:`) ve backend Zod'unda `.optional()`, **`.default()` DEĞİL** — mevcut `CtaBlock`/`ImageBlock` deseni (`pages.schemas.ts:546-548` yorumundaki gerekçe: default'lar eski kayıtları şişirir; varsayılana düşme **render tarafında** `??` ile yapılır).
- Bir alanın **hiç olmaması** ile bugünkü davranış **BİREBİR AYNI** olmak zorundadır. Özellikle:
  - `logo-marquee`: `grayscale ?? true` (bugün hard-code grayscale), `displayMode ?? "marquee"`.
  - `video`: `playStyle ?? "inline"`, `loop ?? false`.
  - `accordion`: `layoutStyle ?? "bordered"` ve `"bordered"` **bugünkü görünümle piksel-eş** olmalıdır.
  - `before-after-slider`: `initialSliderPosition ?? 50`.
  - `pricing-table`: `billingInterval` yoksa hiçbir ek etiket render EDİLMEZ.
- `createBlock()` yeni blokta bu alanları **açıkça yazabilir** (varsayılan değerle), ama URL/href türü opsiyonel alanları **hiç EKLEMEZ** (boş string `SafeHrefSchema.min(1)`'e takılır — bkz. `registry.ts:99-103` yorumundaki 422 tuzağı).

---

## 2) Veri modelleri (BAĞLAYICI)

### 2.1 `google-map` — YENİ

```
GoogleMapStyle = "standard" | "dark" | "silver" | "retro"
GoogleMapHeight = { value: number; unit: "px" | "vh" }

GoogleMapBlock extends BaseNode {
  type: "google-map";
  data: {
    /** Mod A. Google'ın "Haritayı paylaş → Harita yerleştir" iframe src'i. §3.2 beyaz listesinden
     *  geçmek ZORUNDA. Doluysa `address`/`zoom` URL inşasında KULLANILMAZ. */
    embedUrl?: string;
    /** Mod B (TERCİH EDİLEN). Serbest adres metni — embed URL'i render anında `map-embed.ts`
     *  tarafından SABİT bir şablondan İNŞA EDİLİR (video-embed.ts ile AYNI desen). */
    address?: string;
    /** Yalnızca Mod B'de anlamlıdır (Mod A'da zoom, `pb=` parametresinin içine gömülüdür). */
    zoom?: number;                 // 1..20, yoksa 15
    height?: GoogleMapHeight;      // yoksa { value: 400, unit: "px" }
    mapStyle?: GoogleMapStyle;     // yoksa "standard"
    markerTitle?: string;          // iframe `title` niteliği + görsel etiket
  };
}
```

**Sabitler** (`types.ts` §5 bloğuna eklenir, backend `pages.schemas.ts` ile **sayısal olarak birebir aynı**):
```
GOOGLE_MAP_MIN_ZOOM = 1
GOOGLE_MAP_MAX_ZOOM = 20
GOOGLE_MAP_DEFAULT_ZOOM = 15
GOOGLE_MAP_MIN_HEIGHT_PX = 120
GOOGLE_MAP_MAX_HEIGHT_PX = 2000
GOOGLE_MAP_DEFAULT_HEIGHT_PX = 400
GOOGLE_MAP_MAX_HEIGHT_VH = 100
GOOGLE_MAP_MAX_ADDRESS_LENGTH = 300
GOOGLE_MAP_MAX_MARKER_TITLE_LENGTH = 120
```

`createBlock("google-map")` varsayılanı:
```
{ id, type: "google-map", data: { address: "", zoom: 15, height: { value: 400, unit: "px" }, mapStyle: "standard" } }
```
> `embedUrl` ve `markerTitle` **hiç eklenmez** (undefined) — `.min(1)` doğrulamasına takılmamak için (`advanced-slider`/`cta` ile AYNI desen).

**İki kaynak modu (bağlayıcı davranış):**
- `embedUrl` DOLU ve §3.2 regex'inden GEÇİYORSA → aynen kullanılır.
- Aksi halde `address` DOLU ise → `map-embed.ts::getMapEmbedUrl` şu **sabit** şablonu inşa eder:
  `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=${zoom}&hl=${locale}&output=embed`
- İkisi de boş / `embedUrl` beyaz listeyi geçemiyor → **hiçbir şey render edilmez** (`return null`), hata fırlatılmaz. (`video-embed.ts`'in `null` dönme deseniyle birebir.)

### 2.2 `accordion` — genişletme

```
AccordionLayoutStyle = "bordered" | "card" | "minimal"

AccordionQAItem += { isOpenDefault?: boolean }
AccordionBlock.data += { layoutStyle?: AccordionLayoutStyle }
```
- `layoutStyle ?? "bordered"` → bugünkü görünüm.
- `allowMultipleOpen === false` iken birden fazla `isOpenDefault` işaretliyse **yalnızca İLKİ** açılır (`Accordion defaultValue` tek elemanlı dizi alır). Editör bunu **uyarı** ile bildirir, engellemez (`pricing-table`'ın "birden fazla highlighted" uyarısıyla AYNI desen).

### 2.3 `before-after-slider` — genişletme

```
BeforeAfterSliderBlock.data += { initialSliderPosition?: number }  // 0..100 (tam sayı), yoksa 50
```
- Render: `useState(block.data.initialSliderPosition ?? 50)`.
- **`orientation` semantiği DEĞİŞMEZ** (`types.ts:217-221` yorumu bağlayıcı: `horizontal` = sol-sağ sürüklenir).

### 2.4 `pricing-table` — genişletme

```
PricingBillingInterval = "monthly" | "yearly"
PricingTableBlock.data += { billingInterval?: PricingBillingInterval }
```
- **v1'de SALT GÖRSEL bir etikettir** (ızgaranın üstünde "Aylık" / "Yıllık" rozeti). İnteraktif aylık/yıllık **geçiş anahtarı KAPSAM DIŞIDIR** ve uydurulmayacaktır.
- **Gerekçe (aşağı akış bunu tartışmasın):** gerçek bir toggle, plan BAŞINA ikinci bir fiyat (`plans[].priceYearly`) gerektirir. Kullanıcı bunu istemedi; tek `price` alanıyla bir toggle yapmak ya sahte bir hesaplama (fiyat serbest metin — "Ücretsiz"/"Bize Sorun" da olabilir, `types.ts:455` yorumu) ya da hiçbir şey yapmayan bir kontrol üretirdi. İhtiyaç doğarsa ayrı bir turda `plans[].priceYearly` eklenir.

### 2.5 `logo-marquee` — genişletme

```
LogoDisplayMode = "marquee" | "grid"
LogoMarqueeBlock.data += { displayMode?: LogoDisplayMode; grayscale?: boolean }
```
- `displayMode ?? "marquee"`, `grayscale ?? true` → bugünkü davranış birebir.
- `displayMode: "grid"` iken `speedSeconds`/`pauseOnHover` **anlamsızdır**; veri modelinde KALIR (mod değiştirip geri dönünce ayar kaybolmasın), editörde yalnızca `marquee` modunda GÖSTERİLİR.
- Grid düzeni (kolon sayıları/responsive kırılımlar) **ui-designer'ın kararıdır**, veri modeline yeni alan EKLENMEZ.

### 2.6 `video` — genişletme

```
VideoPlayStyle = "inline" | "lightbox"
VideoBlock.data += { coverUrl?: string; playStyle?: VideoPlayStyle; loop?: boolean }
```
- `playStyle ?? "inline"` (bugünkü), `loop ?? false`.
- `coverUrl` yalnızca `playStyle: "lightbox"` iken zorunlu-benzeri anlam taşır; yoksa lightbox tetikleyicisi düz siyah bir kutu + oynat simgesi olur (boş render EDİLMEZ).
- **`loop` sağlayıcıya göre farklı uygulanır** (frontend-agent için not): YouTube `loop=1` **TEK BAŞINA ÇALIŞMAZ**, `playlist=<videoId>` de gerekir; Vimeo `loop=1`; `mp4` → `<video loop>`. Bu mantık `video-embed.ts::getVideoEmbedUrl` içine, mevcut `autoplay`/`muted` deseninin yanına eklenir.
- **`video-embed.ts`'in güvenlik sözleşmesi KIRILAMAZ:** ham `url` asla `<iframe src>`e yazılmaz; yalnızca regex ile çıkarılan id'den sabit domainde URL inşa edilir.

---

## 3) GÜVENLİK — `google-map` iframe (security-agent'a DEVREDİLECEK)

> **security-agent devri:** §3.1, §3.2 ve §3.4 kararları **security-agent onayına tabidir**.
> backend-agent bu politikayı UYGULAR, kendi başına gevşetemez/sıkılaştıramaz. Orkestratöre not:
> zincire security-agent eklenmeli (bu tur bir iframe kaynak yüzeyi açıyor, CSP de kapalı).

### 3.1 `apiKey` alanı — REDDEDİLDİ (mimar kararı)

Kullanıcının istediği ayrı `apiKey` alanı **veri modeline EKLENMEYECEKTİR**. Gerekçeler:
1. `Page.blocks` **public `GET /pages/:slug` yanıtında ham JSON olarak döner** — alan, blok
   görünmese bile API'den okunabilir hale gelirdi (sadece HTML'de değil).
2. `Page.blocks`'u **her EDITOR rolü** yazabilir/okuyabilir; bir sır bu yüzeyde tutulamaz.
3. Sırların doğru yeri ortam değişkeni / site ayarı katmanıdır, içerik JSON'u değildir.

**Kullanıcının gerçek ihtiyacı yine karşılanır:** anahtar gerektiren Google Maps Embed API
URL'leri (`/maps/embed/v1/...&key=...`) `embedUrl` alanına yapıştırılabilir — anahtar zaten tanım
gereği public bir "referrer-restricted" anahtardır. Admin editörü bu durumda **görünür bir uyarı**
gösterir: *"Bu bağlantı bir API anahtarı içeriyor. Google Cloud Console'da anahtarı mutlaka HTTP
referrer kısıtı ile sınırlandırın."*

### 3.2 `embedUrl` domain beyaz listesi (BAĞLAYICI)

Tek regex, **backend Zod'da VE frontend `map-embed.ts`'te AYNEN** (savunma derinliği; ikisi de
uygular, ikisi de kaynağı bu dokümandır):

```
GOOGLE_MAP_EMBED_URL_RE =
  /^https:\/\/(?:www\.)?google\.com\/maps\/embed(?:\/v1\/(?:place|view|directions|search|streetview))?\?[^\s"'<>]+$/
```

Kurallar:
- Şema **yalnızca `https:`** (http dahi değil).
- Host **yalnızca** `google.com` veya `www.google.com`. Bölgesel domain'ler (`google.com.tr`,
  `google.de`), `maps.google.com`, `goo.gl/maps`, kısaltılmış linkler **REDDEDİLİR** (kullanıcı
  Google'ın verdiği kanonik "Harita yerleştir" kodunu kullanmalıdır).
- Yol **`/maps/embed` ile başlamak zorunda**; `/maps/embed/v1/<mod>` yalnızca listelenen 5 mod.
- Boşluk, `"`, `'`, `<`, `>` karakterleri **yasak** (nitelik/HTML bağlamından kaçış yüzeyi).
- Uzunluk `min(1).max(2048)` — `SafeHrefSchema` ile aynı tavan.
- **`SafeHrefSchema` BURADA YETERSİZDİR ve TEK BAŞINA KULLANILMAZ**: o şema `https://evil.com/x`i
  kabul eder; bir iframe src'si için relative yol ve keyfi https host'u **kabul edilemez**. Yeni,
  bloğa özgü `GoogleMapEmbedUrlSchema` tanımlanır.
- Doğrulama başarısız → **422** (sessizce düşürme YOK; kullanıcı yanlış bir link yapıştırdığını
  öğrenmeli). Render tarafı ise (eski/bozuk kayıt ihtimaline karşı) **sessizce `null`** döner.

### 3.3 Mod B (adres) URL inşası — enjeksiyon yüzeyi yok

`address` **hiçbir zaman ham olarak** URL'e yazılmaz; `encodeURIComponent` ile kodlanır ve sabit
şablona yerleştirilir. `zoom` **sayıdır** ve `1..20` aralığına clamp edilir. Bu, `video-embed.ts`'in
"yapılandırılmış embed" deseninin ikinci uygulamasıdır ve **tercih edilen yoldur**.

### 3.4 iframe nitelikleri (bağlayıcı)

- `loading="lazy"` (zorunlu — performans + gereksiz 3. parti bağlantısını geciktirir)
- `referrerPolicy="no-referrer-when-downgrade"`
- `allowFullScreen`
- `title={markerTitle || address || "Harita"}` (erişilebilirlik — boş `title` YASAK)
- `allow` niteliği **verilmez** (mevcut `video-block.tsx`'teki geniş `allow` listesi harita için gereksiz)
- `sandbox` **v1'de verilmez** — `allow-same-origin` olmadan Google Maps embed çalışmaz, onunla
  birlikte sandbox anlamsızlaşır. **security-agent'ın açıkça değerlendirmesi gereken madde budur.**
- `mapStyle` → **inline `filter` değeri SABİT bir tablodan** gelir (kullanıcı girdisi ASLA CSS'e
  enterpole edilmez) — `container-block.tsx::SHAPE_DIVIDER_PATHS` / `ContainerJustify` sınıf tablosu
  deseniyle birebir.
- `height` → inline `style={{ height: `${value}${unit}` }}`; `value` sayı, `unit` kapalı enum →
  **enjeksiyon yapısal olarak imkânsız** (`ContainerLength` gerekçesi, `pages.schemas.ts:184-191`).

### 3.5 KVKK / GDPR — orkestratöre ADVISORY

Google Maps iframe'i, sayfa yüklenir yüklenmez ziyaretçinin **IP adresini Google'a (yurt dışına)
iletir** ve çerez yerleştirir. Bu, mevcut çerez/aydınlatma metni kapsamını etkileyebilir.
**Bu turun teslim şartı DEĞİLDİR**, ancak orkestratörün zincire **compliance-agent** eklemesi
önerilir (`.claude/CLAUDE.md` görev akışı adım 6). `loading="lazy"` bu riski kısmen azaltır;
tam çözüm ("tıkla-yükle" onay kapısı) ayrı bir tur konusudur.

---

## 4) Admin arayüzü kararları

### 4.1 Kategori sistemi — MEVCUT 4 kategori KORUNUR (bağlayıcı)

Kullanıcının istediği "Medya & Etkileşim" / "Kurumsal & İçerik" ayrımı için **yeni kategori
AÇILMAZ** ve **mevcut bloklar kategori değiştirmez**.

| Kullanıcının kategorisi | Mevcut karşılığı (`registry.ts:42-47`) |
|---|---|
| Medya & Etkileşim | `media` → "Medya & İnteraktif" |
| Kurumsal & İçerik | `marketing` → "Pazarlama & Sosyal Kanıt" |

**Gerekçe:** (a) etiketler zaten anlamsal olarak örtüşüyor; (b) `accordion`/`pricing-table`/
`logo-marquee` bloklarını kategori değiştirmek `admin-page-builder-marketing.spec.ts` ve
`admin-page-builder-widgets.spec.ts` içindeki "doğru kategoriden eklenir" testlerini **kullanıcı
görünür bir fayda olmadan kırar**; (c) 5. bir kategori palet sekmelerini taşırır.

**Tek kategori ataması:** `"google-map"` → `media`.

### 4.2 Arama anahtar kelimeleri — `blockRegistry`'ye `keywords` eklenir

`add-content-menu.tsx:104-106` bugün yalnızca Türkçe `label` üzerinde arıyor; kullanıcının istediği
`map`, `faq`, `fiyat`, `video` terimleri **hiç eşleşmiyor**. Çözüm:

```
blockRegistry[type] = { label, category, icon, keywords?: string[] }
```
Filtre: `normalizeSearch(label).includes(q) || keywords.some(k => normalizeSearch(k).includes(q))`
(mevcut `normalizeSearch` — `toLocaleLowerCase("tr")` — aynen kullanılır).

Minimum `keywords` seti (ui-designer genişletebilir):
| type | keywords |
|---|---|
| `google-map` | `map`, `harita`, `konum`, `adres`, `google`, `iletişim` |
| `accordion` | `faq`, `sss`, `soru`, `cevap`, `akordiyon` |
| `pricing-table` | `fiyat`, `pricing`, `paket`, `plan`, `tarife` |
| `logo-marquee` | `logo`, `referans`, `müşteri`, `marka`, `partner` |
| `video` | `video`, `youtube`, `vimeo`, `oynatıcı` |
| `before-after-slider` | `öncesi`, `sonrası`, `before`, `after`, `karşılaştır` |

### 4.3 "Canlı önizlemeli ayar çekmecesi" — YENİDEN YORUMLANDI (bağlayıcı)

**Blok başına yeni bir `Sheet`/çekmece AÇILMAZ.** Mevcut mimari: çekmece = **konteyner** ayarları
(`.claude/design-notes-page-builder-sticky-panel-and-toolbar.md` §1); içerik blokları
`ContentBlockCard` içinde satır içi düzenlenir. Blok başına ikinci bir çekmece mekanizması iki
rakip düzenleme paradigması yaratır, sürükle-bırak/`aria-label` sözleşmesini ve mevcut 4 e2e
spec'ini riske atar.

Kullanıcının "canlı önizleme" ihtiyacı **kartın İÇİNDE mini önizleme** olarak karşılanır:
- `google-map`: adres/embed URL geçerliyse editör kartında ~180px yüksekliğinde canlı iframe.
- `before-after-slider`: `initialSliderPosition` slider'ı değiştikçe küçük bir önizleme şeridi.
- `logo-marquee`: `displayMode`/`grayscale` değiştikçe logoların anlık önizlemesi.
- `video`: `coverUrl` küçük resim önizlemesi.

Nihai görsel karar **ui-designer'ındır**; mimari kısıt: *yeni bir çekmece/modal katmanı yok*.

### 4.4 İkonlar

Kullanıcının istediği eşleme uygulanır (hepsi `lucide-react`, `registry.ts` import listesine eklenir):

| type | bugünkü ikon | istenen ikon |
|---|---|---|
| `google-map` | — | `MapPin` (**yeni**) |
| `before-after-slider` | `SplitSquareHorizontal` | `Columns2` |
| `video` | `Video` | `Video` (değişmez) |
| `accordion` | `ListCollapse` | `HelpCircle` |
| `pricing-table` | `Tag` | `CreditCard` |
| `logo-marquee` | `Infinity` | `Building2` |

İkon değişiklikleri **kozmetiktir**; `label` metinleri **DEĞİŞMEZ** (e2e `getByRole("menuitem", { name })`
seçicileri label'a bağlıdır — bu sözleşme korunmalıdır). Nihai onay ui-designer'da.

### 4.5 Şablon (standart kullanıcı) modu

`"google-map": []` **her iki aynaya da AÇIKÇA eklenir** (`backend/src/lib/page-template-fields.ts`
+ `frontend/src/lib/page-builder/template-fields.ts`).

**Gerekçe:** 3. parti bir iframe kaynağını belirlemek — `custom-html` ile aynı sınıfta —
"gelişmiş" bir eylemdir (`page-template-fields.ts:50-52` istisnasıyla AYNI mantık). Haritayı
standart kullanıcıya açmak, dolaylı olarak ona bir iframe src'si yazma yetkisi verirdi.
Fail-closed kural zaten boş küme üretirdi; **açıkça yazılması** bunun bir unutkanlık değil karar
olduğunu belgeler.

Genişletilen 5 bloğun mevcut `TEMPLATE_EDITABLE_FIELDS` girdileri **DEĞİŞMEZ** — yeni alanların
hepsi "gelişmiş" ayarlardır ve `simple` bayrağı ile editörde gizlenir (mevcut `simple` deseni).
**İstisna yok.**

---

## 5) Backend doğrulama gereksinimleri (backend-agent için kesin liste)

Dosya: `backend/src/modules/pages/pages.schemas.ts`

1. **Yeni sabitler** — frontend `types.ts` ile **sayısal olarak birebir aynı** (§2.1 listesi).
   Dosya başlığındaki §5 uyarısı bağlayıcıdır.
2. **`GoogleMapEmbedUrlSchema`** — `z.string().min(1).max(2048).regex(GOOGLE_MAP_EMBED_URL_RE, "…")`.
   `SafeHrefSchema` **kullanılmaz** (§3.2 gerekçesi). Regex `OVERLAY_HEX_RE`/`CSS_URL_UNSAFE_RE`
   ile aynı bölgede, açıklayıcı yorumuyla tanımlanır.
3. **`GoogleMapHeightSchema`** — `z.object({ value: z.number().int().min(1).max(2000), unit: z.enum(["px","vh"]).default("px") })`
   + `.superRefine`: `unit === "vh"` ise `value <= 100`.
   (Mevcut `ContainerLengthSchema` **yeniden kullanılmaz** — o `min(0).max(5000)` ve `vh` tavanı yok.)
4. **`GoogleMapBlockDataSchema`** — tüm alanlar `.optional()`; `zoom: z.number().int().min(1).max(20).optional()`;
   `address: z.string().max(300).optional()`; `markerTitle: z.string().max(120).optional()`;
   `mapStyle: z.enum(["standard","dark","silver","retro"]).optional()`.
   **`.superRefine` YOK** — `embedUrl` ve `address` ikisi de boş olabilir (yeni eklenen boş blok
   anında autosave edilir; 422 üretmek `advanced-slider`'ın "seçim yapılmamış blok" desenini kırardı).
5. **`GoogleMapBlockSchema`** — `{ id, type: z.literal("google-map"), data, reveal: RevealEffectSettingsSchema.optional() }`.
6. **`PageNodeSchema` dispatch'ine yeni dal:** `if (type === "google-map") return applySubSchema(GoogleMapBlockSchema, node, ctx);`
   (`pages.schemas.ts:868-894`). **Bu satır unutulursa blok doğrulanmadan geçer.**
7. **Genişletilen 5 şemaya eklenecek alanlar** (hepsi `.optional()`, `.default()` YOK):
   - `AccordionBlockDataSchema`: `layoutStyle: z.enum(["bordered","card","minimal"]).optional()`; `items[].isOpenDefault: z.boolean().optional()`
   - `BeforeAfterSliderBlockDataSchema`: `initialSliderPosition: z.number().int().min(0).max(100).optional()`
   - `PricingTableBlockDataSchema`: `billingInterval: z.enum(["monthly","yearly"]).optional()`
   - `LogoMarqueeBlockDataSchema`: `displayMode: z.enum(["marquee","grid"]).optional()`, `grayscale: z.boolean().optional()`
   - `VideoBlockDataSchema`: `coverUrl: z.string().min(1).max(2048).optional()` (`<img src>` — `BeforeAfterSliderBlockDataSchema.beforeUrl` ile AYNI serbestlik, `SafeHrefSchema` GEREKMEZ), `playStyle: z.enum(["inline","lightbox"]).optional()`, `loop: z.boolean().optional()`
8. **`page-template-fields.ts`**: `"google-map": []` (§4.5).
9. **`sanitize-blocks.ts` DEĞİŞMEZ** (§0.3).
10. **Migration YOK** (§0.1).

---

## 6) SEO — FAQPage JSON-LD durumu (DOĞRULANDI)

**Bulgu: FAQPage JSON-LD ZATEN VAR ve uygulamadaki TEK JSON-LD'dir.**
`frontend/src/components/site/blocks/accordion-block.tsx:7-21` (`faqJsonLd`) + satır 42
(`<script type="application/ld+json">`). `grep -rn "application/ld+json"` tüm `frontend/src`'te
**yalnızca bu bir eşleşme** döndürdü. Public sayfa render'ı (`app/[lang]/(site)/[slug]/page.tsx`)
JSON-LD üretmez; `generateMetadata` yalnızca `buildContentMetadata` ile OG/canonical üretir.

Mevcut uygulama **doğru** yapılmış: `</` kaçışı var (OWASP "JSON in HTML"), yalnızca soru **ve**
cevabı dolu öğeler dahil ediliyor.

→ **seo-agent'ın görevi "SIFIRDAN EKLEME" DEĞİL, "DOĞRULA + GENİŞLET"tir.** Kapatılacak 4 boşluk §7.5'te.

---

## 7) Ajan görev listeleri (sıralı — bu sıra bağlayıcı)

### 7.1 db-agent — **NO-OP (doğrulama görevi)**

1. `backend/prisma/schema.prisma:449-460` — `Page.blocks Json @default("[]")` olduğunu ve bu turda
   **migration/indeks/backfill GEREKMEDİĞİNİ** teyit et.
2. `PageRevision.blocks` (satır ~1491) için de aynı teyit — eski snapshot'lar yeni alanlar olmadan
   geri yüklenebilmeli (`??` varsayılanları bunu zaten karşılıyor).
3. Yazılı teyidi release-coordinator'a ilet; **kod değişikliği yapma**.

### 7.2 backend-agent

1. `backend/src/modules/pages/pages.schemas.ts` — §5'in 1-7. maddelerinin tamamı (yeni sabitler,
   `GoogleMapEmbedUrlSchema`, `GoogleMapBlockSchema`, `PageNodeSchema` dispatch dalı, 5 şema genişletmesi).
2. `backend/src/lib/page-template-fields.ts` — `"google-map": []` (gerekçe yorumuyla).
3. `docs/architecture/openapi.yaml` — `PageBlock.type` enum'unu (satır ~9679-9690) **güncel 26 tipin
   tamamıyla** yenile (bugün 9 tip listeli, bayat) ve `google-map` `data` şemasını + §3.2 beyaz liste
   kuralını `description` içine yaz. Kontrat = tek doğru kaynak; bu adım atlanamaz.
4. Yeni/genişletilen şemalar için birim testleri: geçerli/geçersiz `embedUrl` (bölgesel domain,
   `maps.google.com`, `goo.gl`, `http://`, `javascript:` → **hepsi 422**), `vh > 100` → 422,
   `zoom = 0/21` → 422, alanların hiçbiri olmayan eski blokların **hâlâ geçtiği** (regresyon).

### 7.3 ui-designer

1. `google-map` blok görsel dili: yükseklik/köşe yuvarlaklığı, `mapStyle` için **4 sabit CSS
   `filter` değeri** tablosu (standard/dark/silver/retro) — mevcut token sistemine oturmalı, ham
   renk değeri üretilmemeli.
2. `accordion.layoutStyle` üç varyantın (`bordered`/`card`/`minimal`) sınıf tablosu —
   **`bordered` bugünkü render ile piksel-eş** olmak zorunda.
3. `logo-marquee` **grid modu** düzeni (responsive kolon kırılımları) + `grayscale` açık/kapalı
   görsel davranışı; `video` lightbox tetikleyici kartı (kapak + oynat rozeti) ve modal kabuğu.
4. §4.4 ikon eşlemesi ve §4.3 kart-içi mini önizleme yerleşimi hakkında nihai karar.
   **Kod yazmaz; `.claude/ui-designer-scope-*.md` formatında token/sınıf tablosu üretir.**

### 7.4 frontend-agent

1. `frontend/src/lib/page-builder/types.ts` — `ContentBlockType` union'a `"google-map"`,
   `GoogleMapBlock` arayüzü, `ContentBlock` union'a ekleme, §2.1 sabitleri, §2.2-2.6 alan eklemeleri.
2. `frontend/src/lib/page-builder/map-embed.ts` (**YENİ**) — `video-embed.ts`'in birebir deseni:
   `GOOGLE_MAP_EMBED_URL_RE`, `getMapEmbedUrl(data, locale): string | null`, `MAP_STYLE_FILTER` tablosu.
3. `frontend/src/lib/page-builder/registry.ts` — `keywords` alanı (§4.2), `blockRegistry`'ye
   `google-map` kaydı + ikon güncellemeleri (§4.4), `createBlock("google-map")` varsayılanı (§2.1).
4. `frontend/src/components/site/blocks/google-map-block.tsx` (**YENİ**) + `index.tsx`
   `renderNodeBody` switch'ine `case "google-map"`. **Sıfır CLS:** sarmalayıcı `style={{ height }}`
   ile *önceden* rezerve edilir, iframe `loading="lazy"`.
5. Genişletilen 5 site bileşeni: `accordion-block.tsx` (layoutStyle + `defaultValue`),
   `before-after-slider-block.tsx` (`useState(initialSliderPosition ?? 50)`),
   `pricing-table-block.tsx` (billingInterval etiketi), `logo-marquee-block.tsx`
   (grid/marquee dallanması + `grayscale ?? true`), `video-block.tsx` (`coverUrl`/lightbox/`loop`)
   + `video-embed.ts`'e `loop` parametresi (YouTube'da `playlist=<id>` şartı!).
6. Admin editörleri: `components/admin/page-builder/blocks/google-map-block.tsx` (**YENİ**,
   API anahtarı uyarısı dahil — §3.1) + 5 mevcut editöre yeni alanlar (`simple` bayrağı arkasında)
   + `builder-canvas.tsx::ContentBlockBody` switch'ine `case "google-map"`.
7. `frontend/src/lib/page-builder/template-fields.ts` — `"google-map": []` (backend aynası).
8. **`normalize.ts`'e DOKUNMA** (§0.2) — dokunmak gerekiyorsa mimari bir hata yapılmıştır, architect'e eskale et.

### 7.5 seo-agent

1. **Doğrula:** `accordion-block.tsx`teki mevcut FAQPage JSON-LD'nin `layoutStyle`/`isOpenDefault`
   eklemelerinden sonra **bozulmadığını** (JSON-LD, görsel varyanttan bağımsız olmalı).
2. **Boşluk 1 — çoklu FAQPage:** bir sayfada 2+ `accordion` bloğu varsa bugün **2 ayrı `FAQPage`
   script'i** basılıyor. Google sayfa başına tek `FAQPage` bekler. Kararı ver ve uygula
   (sayfa seviyesinde tek toplayıcı, veya yalnızca sayfadaki ilk accordion bloğunun üretmesi).
3. **Boşluk 2 — `noIndex`:** JSON-LD, `page.noIndex === true` iken de basılıyor. İndekslenmeyen bir
   sayfada yapılandırılmış veri yayınlamak gereksiz/çelişkilidir; bastırmayı değerlendir.
4. **Boşluk 3 — `google-map` için `LocalBusiness`/`Place` yapılandırılmış verisi:** `address`
   doluyken faydalı olabilir. **Karar seninde**, ancak sahte/uydurma alan (telefon, açılış saati)
   ÜRETME — yalnızca blokta gerçekten var olan veriden türet. Yoksa hiç ekleme.
5. **KAPSAM DIŞI (yapma):** `pricing-table` için `Product`/`Offer` JSON-LD. Fiyat serbest metindir
   ("Ücretsiz"/"Bize Sorun"), geçerli bir `Offer` üretilemez.

### 7.6 qa-agent

Yeni spec: `frontend/tests/e2e/admin-page-builder-corporate-blocks.spec.ts` —
`admin-page-builder-widgets.spec.ts`'in **iki katmanlı desenini birebir izle**
(1: admin UI'da kategori/menü kaydı, 2: `patchPageBlocks` ile gerçek backend+Postgres'e yazıp
public URL'de render doğrulaması).

1. **Admin katmanı:** `google-map` bloğunun "Medya & İnteraktif" kategorisinden eklendiği; palet
   aramasında `map`, `harita`, `faq`, `fiyat`, `video` sorgularının doğru bloğu döndürdüğü (§4.2).
2. **Round-trip:** her 6 blok için `patchPageBlocks` → editörü yeniden yükle → yeni alanların
   **kaybolmadığı** (geçmişte `reveal`/`topDivider` bu şekilde sessizce kayboldu — regresyon riski).
3. **Public render:** harita iframe'inin doğru `src` ve **rezerve edilmiş yükseklikle** (CLS=0)
   çıktığı; SSS/fiyatlandırma/logo bandı/öncesi-sonrası bloklarının konsol hatası olmadan render
   edildiği; FAQPage JSON-LD'nin geçerli JSON olarak parse edilebildiği.
4. **Geriye dönük uyumluluk (ZORUNLU test):** yeni alanların **HİÇBİRİNİ içermeyen** eski şekilli
   5 blok JSON'u kaydedilebilmeli ve public'te **bugünküyle aynı** render edilmeli.
5. **Güvenlik (negatif):** `embedUrl` olarak `https://evil.com/maps/embed?x=1`,
   `http://www.google.com/maps/embed?x=1`, `https://maps.google.com/…`, `javascript:alert(1)`
   gönderildiğinde API'nin **422** döndüğü.

---

## 8) Definition of Done

- [ ] Yeni alanların hiçbiri olmayan **mevcut yayınlanmış sayfalar** birebir aynı render ediliyor (§1.2)
- [ ] frontend `types.ts` sabitleri ↔ backend `pages.schemas.ts` sabitleri **sayısal olarak birebir**
- [ ] `PageNodeSchema` dispatch'inde `google-map` dalı var (yoksa blok doğrulanmıyor demektir)
- [ ] `TEMPLATE_EDITABLE_FIELDS` iki aynada da `"google-map": []` içeriyor
- [ ] `openapi.yaml` `PageBlock.type` enum'u güncel + `google-map` beyaz listesi dokümante
- [ ] security-agent §3.1/§3.2/§3.4'ü onayladı
- [ ] `normalize.ts` **değiştirilmedi**
- [ ] Lint/format geçiyor, e2e spec (§7.6) yeşil
- [ ] CHANGELOG.md güncellendi

---

## 9) Riskler

| # | Risk | Etki | Azaltma |
|---|---|---|---|
| R1 | `logo-marquee`'de `grayscale` bugün **kodda sabit**; `grayscale ?? false` yazılırsa tüm mevcut logo bantlarının görünümü değişir | Yüksek (sessiz görsel regresyon) | `grayscale ?? **true**` — §1.2'de bağlayıcı, §7.6/4'te test edilir |
| R2 | `PageNodeSchema` dispatch dalının unutulması → `google-map` **hiç doğrulanmadan** DB'ye yazılır, iframe beyaz listesi baypas edilir | Kritik (güvenlik) | §5/6, §8 checklist maddesi, §7.6/5 negatif testi |
| R3 | `mapStyle`'ın Google Maps Embed ile **gerçekten yapılamayacağı** yanılgısı — iframe içeriği restyle EDİLEMEZ | Orta (yanlış implementasyon) | §3.4: sabit CSS `filter` tablosu ile sarmalayıcı üzerinden uygulanır, harita API'siyle değil |
| R4 | `zoom`'un Mod A'da (hazır `embedUrl`) **etkisiz** olduğunun fark edilmemesi → "ayar çalışmıyor" bug raporu | Orta | §2.1: `zoom` yalnızca Mod B'de anlamlı; editör Mod A'da bu alanı **gizler/pasifleştirir** |
| R5 | YouTube `loop=1`in tek başına çalışmaması (`playlist=<id>` şart) | Düşük | §2.6'da açıkça yazıldı |
| R6 | Blok başına yeni bir çekmece/modal katmanı eklenmesi → 4 mevcut e2e spec'in `aria-label`/DOM sözleşmesinin kırılması | Yüksek | §4.3 bağlayıcı yasak |
| R7 | Mevcut blokların kategori/label'ının değiştirilmesi → `admin-page-builder-marketing/widgets` spec'leri kırılır | Orta | §4.1 (kategori değişmez) + §4.4 (label değişmez, yalnızca ikon) |
| R8 | KVKK: harita iframe'i ziyaretçi IP'sini Google'a iletir | Orta (uyum) | §3.5 — compliance-agent'a advisory, `loading="lazy"` kısmi azaltma |
| R9 | 256 KB `MAX_PAGE_BLOCKS_BYTES` tavanı | İhmal edilebilir | Yeni alanlar blok başına birkaç on bayt |
