# Tasarım Notu — E-Ticaret Vitrini (`ecommerce-pro` genişlemesi)

**Kapsam:** `.claude/architect-scope-ecommerce-pro-template.md` §5, §9.5, §9.6 — varyasyon
seçici, stok/kargo/PDF UI durumları (storefront'un KENDİSİ, `products/[slug]`, `cart`,
`components/site/**`) + `ecommerce-pro` demo şablonunun `SiteAppearance` paleti/font'ları +
`preview.webp` + `_source/*.svg` kaynak tarifi. Kod YAZMIYORUM — frontend-agent/backend-agent
bu dosyayı okuyup uygular.

**Görsel yön:** Proje genelinde zaten **Minimal/Flat** (`product-card.tsx`, `site-header.tsx`,
admin `appearance-panel`/`quick-edit-row` notları — düz `bg-surface`/`bg-card`, ince
`border-border`, gradyan/glow YOK). Storefront'ta TEK pragmatik istisna zaten var ve
KORUNUYOR: yalnızca **fotoğraf/değişken arka plan üzerindeki yüzen kontrollerde** hafif
`backdrop-blur-sm` (`FavoriteButton`: `bg-surface/90 shadow-sm backdrop-blur-sm`,
`gallery-lightbox.tsx` karartma perdesi). Bu doküman AYNI disiplini sürdürür — sepet
çekmecesi/sticky bar için de blur yalnızca "üzerine bindiği içerik" yüzeyinde, sistemik bir
"cam" estetiği olarak DEĞİL.

**Token kaynağı (SAPMA YOK):** `frontend/src/app/globals.css` `.site-scope` bloğu —
`--site-primary/secondary/button/button-text/link/accent/background/surface/text/muted-text`,
`--site-radius` (8px, MD — [DTI] §7.2 kararınca **pill DEĞİL**). `.site-scope` içinde
`--danger`/`--warning`/`--success` **override EDİLMEZ** — kök (`:root`) değerlerini miras
alır ve bu değerler zaten WCAG AA doğrulanmıştır (`globals.css:16-45` yorum bloğu — light:
`--danger #b91c1c` 6.47:1, `--warning #92400e` 7.09:1, `--success #166534` 7.13:1 düz metin).
`(site)` layout `.dark` sınıfı hiç uygulamıyor (doğrulandı) — bu oranlar storefront'ta HER
ZAMAN geçerlidir, ikinci bir hesaplama gerekmez.

**Neden `--site-accent` DEĞİL, `--warning`/`--danger`/`--success`:** `--site-accent` mağaza
sahibinin **istediği herhangi bir rengi** seçebildiği bir marka tokenıdır (appearance
panelinde yalnızca `buttonColor`/`buttonTextColor` çifti için kontrast rozeti VAR, `accentColor`
için YOK — `design-notes-appearance-panel.md` §5 tablosu). Düşük stok/tükendi/başarı gibi
**anlamı renkten bağımsız olması gereken** durumlar için mağaza temasına bağlı, garantisiz bir
tona güvenmek yanlıştır — `product-card.tsx`'teki mevcut "Tükendi" rozeti zaten `bg-danger`
kullanıyor (bu doküman o emsali GENİŞLETİYOR, yeni bir karar icat etmiyor).

**`--site-radius` uygulama notu (mevcut boşluk, frontend-agent'a hatırlatma):** Paylaşılan
`Button`/`Badge` bileşenleri kendi varsayılan `rounded-lg`/`rounded-full` sınıflarını taşır;
storefront'ta marka radius'unu yansıtması gereken her interaktif yüzey (`site-header.tsx:178`,
`slide-layer.tsx:82`, `hero-canvas.tsx:108` emsalindeki gibi) **açıkça**
`rounded-[var(--site-radius)]` ile override edilir. Bu dokümandaki TÜM buton/kart
tanımlarında bu override **zorunludur** — aksi halde admin 10px (`--radius-lg`), storefront
8px arasında sessiz bir tutarsızlık oluşur (`add-to-cart-button.tsx` bugün bu override'ı
YAPMIYOR — frontend-agent bu dosyaya zaten dokunacağı için aynı commit'te düzeltilmeli).

---

## 1) Varyasyon renk swatch bileşeni (`type: SWATCH`)

**Boyut:** `w-8 h-8` (32px) dairesel — PDP varsayılanı. Kompakt bağlamlarda (sepet
çekmecesi satır özeti, sepet sayfası satırı) `w-6 h-6` (24px). İkisi de 4px spacing
ölçeğinin katı.

**Durumlar:**

| Durum | Görsel |
|---|---|
| **Pasif (seçilebilir, seçili değil)** | `rounded-full border-2 border-border` dolgu = `swatchHex`; `hover:` `scale-105 border-foreground/30` (`transition-transform duration-150`) |
| **Hover** | Yukarıdaki `scale-105` + `border-foreground/30` — renk dolgusuna DOKUNULMAZ (kullanıcı gerçek rengi görmeli) |
| **Seçili** | `ring-2 ring-offset-2 ring-offset-surface ring-primary` (`--primary` = `.site-scope` içinde `--site-primary`'ye bağlı) + `border-2 border-transparent` (border'ı ring'e devret, çift kenarlık karmaşası olmasın) |
| **Stoksuz (üstü çizili, tıklanamaz)** | Aşağıdaki 3 katmanlı teknik — bkz. altındaki madde |

**Stoksuz swatch — renk-bağımsız garantili kontrast tekniği (bağlayıcı, WCAG AA gerekçeli):**

`swatchHex` ürün verisinden gelir (beyazdan siyaha her ton olabilir) — üzerine çizilecek
çizginin **her renk için** 3:1 (WCAG 1.4.11 non-text contrast) garantisi vermesi tek bir sabit
çizgi rengiyle MÜMKÜN DEĞİL. Çözüm, çizgiyi doğrudan `swatchHex` üzerine değil, önce
nötrleştirilmiş bir zemin üzerine çizmek:

1. Taban dolgu `swatchHex` kalır ama `opacity-40` (dolgu 4'te 3 oranında zemine —
   `--site-surface` — karışır, tüm renkler `--site-surface`'e yaklaşır).
2. Üzerine `absolute inset-0 rounded-full bg-surface/50` (ikinci nötrleştirme katmanı).
3. Çizgi: `::after` ile köşeden köşeye (sol-alt → sağ-üst, **-45°**) `2px` kalınlığında
   `bg-danger` — artık `--surface`'in AA-doğrulanmış `--danger` (6.47:1 light) zemini
   üzerinde, gerçek `swatchHex`'ten BAĞIMSIZ garanti kontrastta.
4. `cursor-not-allowed pointer-events-none opacity-60` (bütün buton), `aria-disabled="true"`.

**Renk-körü/ekran-okuyucu güvenliği (WCAG 1.4.1 — renge güvenme):** Her swatch
`role="radio"` + `aria-label="{Renk adı} — {stoktaysa boş, değilse 'Stokta yok'}"` (ör.
`"Antrasit — Stokta yok"`) taşır; renk ismi HER ZAMAN metin olarak (görünür ya da
`sr-only`) yanında/altında durur — sadece rengin kendisine güvenilmez.

**Grup:** eksen başlığı + `role="radiogroup" aria-label="{axis.name}"` (ör. "Renk: Antrasit").
Swatch'lar arası boşluk `gap-2` (8px).

---

## 2) Beden/ölçü seçici butonu (`type: TEXT`)

Dikdörtgen, **pill DEĞİL** — `rounded-[var(--site-radius)]` (8px, swatch'ın dairesel
şeklinden BİLİNÇLİ olarak farklı: swatch bir renk örneğidir, beden butonu bir metin
etiketidir ve marka radius kontratına tabidir). Min. boyut `h-10 min-w-10 px-3` (dokunma
hedefi ≥40px, WCAG 2.5.5 AAA ama burada bilinçli olarak uygulanıyor çünkü mobil PDP birincil
kullanım yüzeyi).

| Durum | Sınıf |
|---|---|
| **Pasif** | `border border-border bg-surface text-foreground hover:border-foreground/40 hover:bg-muted transition-colors duration-150` |
| **Seçili** | `border-2 border-primary bg-primary/5 text-primary font-semibold` (appearance panelindeki `border-primary bg-primary/5` seçili-kart deseniyle AYNI, §3/§4/§7 `design-notes-appearance-panel.md`) |
| **Stoksuz** | `border border-border/60 text-foreground/30 cursor-not-allowed pointer-events-none` + AYNI `-45°` çizgi tekniği (madde 1, madde 3) ama dikdörtgen olduğu için çizgi `::after` `inset-0` üzerinde tam köşegen (`width: 141%`, ortalanmış, `-45deg`) — swatch'takiyle BİREBİR aynı `bg-danger` rengi, tutarlılık için |

Varyasyonlu üründe **hiçbir eksen seçilmeden** "Sepete Ekle" `disabled` + buton altında
`text-xs text-foreground/60`: *"Devam etmek için {eksen adı} seçin."*

---

## 3) İndirim rozeti

**Biçim:** `%İndirim` (Türkçe yazım — yüzde işareti SAYIDAN ÖNCE, boşluksuz — ör. `%20`).
Hesap: `Math.round((1 - discountPriceCents / priceCents) * 100)`.

**Bileşen:** paylaşılan `Badge` (`components/ui/badge.tsx`) `tone="danger" solid` — YENİ
bileşen YOK, `product-card.tsx`'teki "Tükendi" rozetiyle **AYNI** görsel aile (kırmızı =
evrensel "indirim/kampanya" işareti, zaten AA-doğrulanmış token).

**Konum ve öncelik (bağlayıcı çakışma kuralı):** `product-card.tsx` şu an `absolute right-2
top-2` slotunu "Tükendi" için kullanıyor, `left-2 top-2` favori butonuna ait —
üçüncü bir köşe YOK. **Karar: indirim rozeti AYNI `right-2 top-2` slotunu paylaşır; ürün/
varyasyon tükendiyse "Tükendi" ÖNCELİKLİDİR ve indirim rozeti GİZLENİR** (indirimli ama
satılamayan bir ürünü reklam etmek yanıltıcıdır — mutually exclusive render, `soldOut ?
"Tükendi" : hasDiscount ? "%X" : null`).

PDP'de (galeri üstünde, `left-4 top-4`) aynı rozet daha büyük (`size="lg"`) render edilir —
orada favori butonu yoktur, çakışma yok.

---

## 4) Düşük stok uyarısı ("Son N ürün!")

**Eşik:** `stockQuantity > 0 && stockQuantity <= 3` (satılan seviyeden okunur — varyasyonlu
üründe seçili `ProductVariant.stockQuantity`, varyasyonsuzda `Product.stockQuantity`, §1.2
[DTI-genişleme] ile birebir). `stockQuantity === 0` ise bu rozet DEĞİL "Tükendi"/disabled
buton durumu devreye girer — mutually exclusive.

**Kapsam (qa-agent §9.9 madde 2 ile birebir):** yalnızca **PDP**. Ürün ızgarası
(`product-card.tsx`) kartında GÖSTERİLMEZ — bir kartta zaten favori + tükendi/indirim
rozetleri var, üçüncü bir uyarı köşe kirliliği ve WCAG 1.4.1 (renk+ikon+metin karmaşası)
riski üretir. Sepet çekmecesi/sayfası satırında (opsiyonel, frontend-agent kararı) AYNI
metin/renk kullanılabilir.

**Ton:** `--warning` (amber-800, AA 7.09:1 düz metin) — `--danger` DEĞİL: "alarm" değil
"aciliyet" iletisi (task tanımındaki "uyarı ama alarm değil" ayrımı budur). Paylaşılan
`Badge tone="warning"` (soft: `bg-warning/10 text-warning`):

```
<Badge tone="warning">Son {stockQuantity} ürün!</Badge>
```

Konum: fiyatın HEMEN ALTINDA, varyasyon seçicinin ÜSTÜNDE (kullanıcı seçim yapmadan önce
aciliyeti görsün). `stockQuantity` seçili varyasyona göre CANLI güncellenir (renk/beden
değişince rozet metni/varlığı yeniden hesaplanır).

---

## 5) Ücretsiz kargo ilerleme çubuğu

Yalnızca `cart.shipping.configured === true` iken render edilir (mimari karar, [DTI-genişleme]
§9.6 bağlayıcı — `shippingFlatFeeCents = null` ise komponent hiç MOUNT OLMAZ).

**Track:** `h-2 w-full rounded-full bg-muted overflow-hidden` — **`rounded-full` burada
`--site-radius` kontratını DELMİYOR**: paylaşılan `Badge` bileşeni zaten sistemde her yerde
`rounded-full` (bkz. `badge.tsx:32`) — ilerleme çubuğu track'i aynı "mikro-bileşen, buton/kart
DEĞİL" istisna sınıfındadır, `--site-radius` yalnızca buton/kart/yüzey gibi YAPISAL
elemanları kapsar ([DTI] §7.2'nin kapsamı).

**Fill:** `bg-[var(--site-primary)]` eşik altındayken; **`isFree === true` olunca renk
`--success`'e (AA 7.13:1) geçer** — marka renginden bağımsız, evrensel "başarıldı" sinyali
(slider progress/bullet aktif renginin `var(--site-primary)`'ye bağlanma emsaliyle
[globals.css:726] tutarlı, ama "tamamlandı" anında semantik yeşile devrediyor — bu bilinçli
bir sapma, gerekçesi: marka rengi ne olursa olsun kullanıcı "hedefe ulaştım" bilgisini
renkten de okuyabilmeli).

**Genişlik:** `width: {Math.min(100, (subtotalCents / (subtotalCents + remainingCents)) * 100)}%`
— **matematik SUNUCUDAN gelir** (`remainingCents`), frontend yalnızca oranı görselleştirir
(mimari karar, para hesaplamaz). `transition-[width] duration-500 ease-out` — sepet
güncellendiğinde çubuk SIÇRAMAZ, yumuşak dolar.

**Metin (çubuğun ÜSTÜNDE, tek satır, `text-sm`):**

| Durum | Metin | Renk |
|---|---|---|
| `remainingCents > 0` | `"Ücretsiz kargoya son {formatPriceFromCents(remainingCents, currency)}!"` | `text-foreground` |
| `isFree === true` | `"Ücretsiz kargo kazandınız!"` + `CheckCircle2` ikonu (lucide, `h-4 w-4 text-success`, metnin solunda) | `text-success font-medium` |

`thresholdCents === null` durumu zaten `configured === false` ile eşdeğer davranır (backend
`configured` bayrağı bunu zaten kapsıyor — ayrı bir dal YAZILMAZ).

---

## 6) Sepet çekmecesi (slide-over)

**Genişlik:** `w-full sm:max-w-[420px]` — appearance panelinin sağ önizleme sütunuyla
(`lg:w-[420px]`, `design-notes-appearance-panel.md` §0) AYNI 420px değeri, keyfi değil,
projede zaten "sağ panel" için oturmuş bir ölçü.

**Yerleşim/animasyon:** `fixed inset-y-0 right-0 z-50` (mevcut `gallery-lightbox.tsx`/
`video-block.tsx` `z-50` dialog kademesiyle AYNI, yeni bir katman İCAT EDİLMEDİ). Giriş/çıkış
yönü **sağdan**: kapalıyken `translate-x-full`, açıkken `translate-x-0`,
`transition-transform duration-300 ease-out`. Backdrop: `fixed inset-0 z-40 bg-black/40` +
`duration-150` fade (mevcut lightbox backdrop `bg-black` + `duration-150` deseninin
opaklık-yumuşatılmış hali — tam siyah bir çekmece için fazla ağır, `/40` sepetin arkasındaki
sayfayı hâlâ okunur bırakıyor).

**İç düzen (üç sabit bölge, ortadaki KAYAR):**

```
┌ Header: "Sepetiniz (N)" + X kapat butonu ──────────────┐  ← sabit
├ Ücretsiz kargo çubuğu (madde 5) — sadece configured ───┤  ← sabit, İÇERİK LİSTESİNİN ÜSTÜNDE
├ Ürün satırları (scroll) ───────────────────────────────┤  ← flex-1 overflow-y-auto
├ Ara toplam / kargo satırı / toplam + "Ödemeye Geç" CTA ┤  ← sabit, alt (sticky bottom-0, border-t)
└─────────────────────────────────────────────────────────┘
```

Kargo çubuğu her zaman header'ın hemen altında, ürün listesinin **üstünde** ve scroll'dan
BAĞIMSIZ (kullanıcı listeyi kaydırırken hedefi gözden kaçırmasın).

**Boş durum:** ortalanmış, `ShoppingCart` ikonu (`h-12 w-12 text-foreground/20`) +
`"Sepetiniz boş"` (`text-base font-medium`) + `"Ürünlere göz atıp favorilerinizi ekleyin."`
(`text-sm text-foreground/60`) + `Button` "Alışverişe Başla" (`/products`'a link,
`rounded-[var(--site-radius)]`). Bu durumda alt CTA çubuğu (ara toplam/toplam) RENDER
EDİLMEZ.

**Satır (item) düzeni:** `flex gap-3 p-4 border-b border-border/60` → sol: ürün görseli
`h-16 w-16 rounded-[var(--site-radius)] object-cover`; orta: başlık + seçili varyasyon
etiketi (`variantLabel`, `text-xs text-foreground/60`, ör. `"Antrasit / L"`) + adet
stepper; sağ: satır toplamı + `X` (kaldır, `ghost` ikon buton).

---

## 7) Sticky "Sepete Ekle" barı

**Ne zaman görünür:** PDP'deki statik (sayfa akışındaki) "Sepete Ekle" bölümü viewport'tan
ÇIKTIĞINDA (`IntersectionObserver`, frontend-agent implemente eder). **Yalnızca `lg:hidden`**
— masaüstünde PDP'nin sağ sütunu (fiyat/varyasyon/buton) zaten `lg:sticky` kaldığı için ikinci
bir sabit bar gereksiz/çift; bu bar mobil + tablet'e özeldir.

**Konum/z-index:** `fixed inset-x-0 bottom-0 z-40` — **`z-50` DEĞİL**, çünkü
`cookie-consent-banner.tsx` zaten `z-50` ile aynı `fixed inset-x-0 bottom-0` slotunu
kullanıyor (madde başlangıcında bulundu). İki taban çubuğu aynı anda görünürse çerez bandı
(`z-50`, oturum başına bir kez, geçici) sticky bar'ın (`z-40`, PDP boyunca kalıcı) ÜSTÜNDE
durur — bilinçli öncelik: yasal/onay bildirimleri ticari CTA'nın önüne geçer. Bu iki
bileşen aynı `bottom-0`'ı paylaştığı için frontend-agent çerez bandı açıkken sticky bar'a
`mb-{çerezBandıYüksekliği}` gibi bir ofset eklemeyi değerlendirebilir — bu ÇALIŞMA ZAMANI
koordinasyonudur, görsel karar z-sırası ile burada VERİLMİŞTİR.

**Görsel:** `h-16 bg-surface/95 backdrop-blur-sm border-t border-border shadow-[0_-2px_12px_rgba(0,0,0,0.08)]`
(yukarı doğru gölge — bar altta olduğu için `shadow-lg`'nin varsayılan aşağı-gölgesi YANLIŞ
yönde, bu yüzden `arbitrary value` ile ters gölge). `backdrop-blur-sm` burada da §0'daki
"yüzen kontrol" istisnasına girer (sayfa içeriğinin üzerine sabitlenmiş bar).

**İçerik (tek satır, `px-4 gap-3 items-center`):** fiyat (`formatPriceFromCents`, indirimliyse
madde 3'teki üstü-çizili biçim küçük ölçekte) solda, `flex-1` boşluk, `Button`
"Sepete Ekle" (`rounded-[var(--site-radius)]`, `size="lg"`) sağda. Varyasyonlu üründe hiçbir
seçim yapılmamışsa buton metni **"Seçenek Seç"** olur ve tıklanınca sayfa yukarı, varyasyon
seçiciye scroll eder (satın alma akışını KIRMADAN yönlendirir) — disabled YAPILMAZ, çünkü
disabled bir buton kullanıcıyı "neden tıklanamıyor" sorusunda bırakır.

---

## 8) PDF döküman kartı

```
┌──────────────────────────────────────────────┐
│ [FileText]  Teknik Çizim — PDF                │
│  ikon kutu   2.4 MB                 [İndir ↓] │
└──────────────────────────────────────────────┘
```

`flex items-center gap-3 rounded-[var(--site-radius)] border border-border p-4
hover:border-primary/40 transition-colors duration-150`.

- **İkon:** `FileText` (lucide) içinde `flex h-10 w-10 shrink-0 items-center justify-center
  rounded-[var(--site-radius)] bg-accent/10 text-accent` (site'ın `--site-accent` markasını
  KULLANIR — bu dekoratif bir vurgu, semantik bir uyarı DEĞİL, o yüzden §0'daki
  "accentColor'a güvenme" kısıtı burada uygulanmaz).
- **Başlık:** `ProductDocument.title` (boşsa `media.filename`), `text-sm font-medium
  text-foreground truncate`.
- **Boyut:** `Media.sizeBytes` biçimlendirilmiş — `formatBytes()` yardımcı (YENİ, küçük,
  `lib/format-bytes.ts`): `< 1024 → "{n} B"`, `< 1024² → "{n/1024 (1 ondalık)} KB"`, üstü
  `"{n/1024² (1 ondalık)} MB"`. `text-xs text-foreground/60`.
- **Buton:** `Button variant="secondary" size="sm" rounded-[var(--site-radius)]` +
  `Download` ikonu, `href={media.url}` `download` attribute (backend zaten
  `Content-Disposition: attachment` dönüyor — [DTI-genişleme] §2.2 madde 3, frontend ek bir
  şey YAPMAZ, native link davranışı yeterli).

Birden fazla döküman varsa kartlar `space-y-2` ile alt alta, PDP'de "Teknik Dökümanlar"
başlığı altında (`icon-box` DEĞİL, düz `h3`).

---

## 9) `ecommerce-pro` — `SiteAppearance` paleti (WCAG AA doğrulanmış)

**Yön:** kurumsal/temiz/güven veren bir e-ticaret vitrini — koyu lacivert marka rengi
("güvenli ödeme" hissi, bankacılık/ödeme sektöründe evrensel çağrışım), canlı ama tek bir
mavi CTA tonu (aksiyon netliği), zümrüt yeşili aksan (indirim/güven rozetleri, "onay" hissi),
neredeyse-beyaz zemin (temiz/ferah, ürün fotoğraflarının öne çıkması için).

| Alan | Hex | Kaynak/Not |
|---|---|---|
| `primaryColor` | `#1E3A8A` (blue-900) | Marka lacivert — logo/başlık vurgusu |
| `secondaryColor` | `#0F172A` (slate-900) | Koyu header/footer zemini |
| `buttonColor` | `#2563EB` (blue-600) | CTA — primary'den daha canlı, tıklanabilirliği net ayırır |
| `buttonTextColor` | `#FFFFFF` | — |
| `linkColor` | `#2563EB` | Buton ile aynı ton — marka tek bir "aksiyon mavisi" kullanır, ikinci bir mavi tonu İCAT EDİLMEDİ |
| `accentColor` | `#047857` (emerald-700) | İndirim/güven rozetleri, ikon vurguları — bkz. gerekçe altında |
| `backgroundColor` | `#F8FAFC` (slate-50) | Sayfa zemini |
| `surfaceColor` | `#FFFFFF` | Kart/yüzey zemini |
| `textColor` | `#0F172A` (slate-900) | — |
| `mutedTextColor` | `#64748B` (slate-500) | İkincil metin (fiyat altı açıklama, tarih) |

**WCAG AA kontrast tablosu (4.5:1 eşik, normal metin — `design-notes-appearance-panel.md`
§5'teki AYNI eşik/formül, tek eşik kuralı burada da geçerli):**

| Çift | Oran | Sonuç |
|---|---|---|
| `textColor` / `backgroundColor` | **17.06:1** | Geçer (AAA) |
| `textColor` / `surfaceColor` | **17.85:1** | Geçer (AAA) |
| `mutedTextColor` / `backgroundColor` | **4.55:1** | Geçer (AA, sınırda — kabul edilebilir, ikincil metin için yeterli) |
| `mutedTextColor` / `surfaceColor` | **4.76:1** | Geçer (AA) |
| `buttonTextColor` / `buttonColor` | **5.17:1** | Geçer (AA) |
| `linkColor` / `backgroundColor` | **4.94:1** | Geçer (AA) |
| `linkColor` / `surfaceColor` | **5.17:1** | Geçer (AA) |
| `primaryColor` (başlık metni) / `backgroundColor` | **9.91:1** | Geçer (AAA) |
| `primaryColor` / `surfaceColor` | **10.36:1** | Geçer (AAA) |
| `accentColor` (düz metin) / `backgroundColor` | **5.24:1** | Geçer (AA) |
| beyaz metin / `accentColor` (solid rozet zemini) | **5.48:1** | Geçer (AA) |

**`accentColor` neden `emerald-600` (`#059669`) DEĞİL, `emerald-700` (`#047857`):**
`emerald-600` HEM düz metin olarak arka plan üzerinde (3.60:1) HEM solid rozet zemininde
beyaz metinle (3.77:1) AA eşiğinin (4.5:1) ALTINDA kalıyor — task talebindeki "her biri için
zemin/metin WCAG AA kontrast oranını hesapla" gereğini karşılamıyordu. Bir kademe koyu
(`emerald-700`) HER İKİ kullanımda da (metin-üzerinde-zemin VE beyaz-metin-üzerinde-zemin)
AA'yı geçiyor — tek bir hex, iki kullanım şekli, tek doğrulama.

**Font/ölçü (kapalı `SiteFont` enum'undan seçildi, enum'a EKLEME yapılmadı — [DTI] §7.1
kararı aynen geçerli):**

| Slot | Değer | Gerekçe |
|---|---|---|
| `headingFont` | **`MONTSERRAT`** | Geometrik, kendinden emin, modern e-ticaret/kurumsal marka karakterine (`modern-architecture`'ın `PLUS_JAKARTA_SANS`'ından BİLİNÇLİ olarak farklı — iki şablon aynı yazı karakterini paylaşmasın, vitrin ayırt edilebilir kalsın) |
| `bodyFont` | **`INTER`** | Küçük fiyat/açıklama metninde nötr, ekran-optimize, tam Türkçe diakritik desteği — [DTI] §7.1'in `modern-architecture` için verdiği AYNI gerekçe, burada da geçerli |
| `baseFontSize` | **16** | Varsayılan, gövde okunabilirliği |

**Diğer `SiteAppearance` alanları ([DTI] §7.2/§7.3 ile TUTARLI, backend-agent'a netleştirme):**
`borderRadius: MD` (8px, pill DEĞİL), `buttonStyle: SOLID`, `presetKey: null` (şablon bir ön
ayar değildir, iki registry birbirine bağlanmaz — [DTI] §7.3 gerekçesiyle birebir aynı).

---

## 10) `previewImageUrl` kompozisyon tarifi

Yol: `frontend/public/demo-templates/ecommerce-pro/preview.webp`, **1200×750** ([DTI] §4.3
ölçüsüyle aynı). Admin panelinin kendi kromu — şablon galerisindeki kart görseli, üç bölüm
dikey istiflenir:

```
┌────────────────────────────────────────────┐  0%
│  HERO (koyu lacivert→zümrüt gradyan zemin,  │
│  sol-alt kısa başlık + pill-benzeri CTA      │  ~0-35%
│  ipucu dikdörtgeni — gerçek metin OKUNAKLI    │
│  olmak ZORUNDA DEĞİL, kompozisyon önemli)    │
├────────────────────────────────────────────┤
│  4 KATEGORİ KARTI (yatay sıra, madde 11'deki │  ~35-55%
│  duotone motiflerin küçük önizlemesi)        │
├────────────────────────────────────────────┤
│  ÜRÜN IZGARASI (2×3 kart, backgroundColor    │
│  zemin, her kartta açık gri placeholder      │  ~55-100%
│  görsel + başlıkişerit + fiyat + KÖŞEDE       │
│  KÜÇÜK bir "%20" indirim rozeti — özelliği    │
│  ÖNİZLEMEDE bile sergiler)                    │
└────────────────────────────────────────────┘
```

Renkler doğrudan madde 9'daki palet hex'lerinden (`primaryColor`/`secondaryColor` gradyan,
`accentColor` rozet, `backgroundColor` zemin) — önizleme görseli şablonun GERÇEK göründüğü
gibi bir izlenim vermeli, farklı bir renk seti İCAT EDİLMEZ.

---

## 11) `_source/*.svg` kaynak tarifi — kategori kartı arkaplanları

**Rozet ikonları için SVG ÇİZİLMEZ (bilinçli, [DTI] §4.4 emsaliyle aynı karar):** güvenlik/
kargo/iade rozet barı `icon-box` bloğu + **lucide-react** ikonlarıyla karşılanır (`ShieldCheck`
— Güvenli Ödeme, `Truck` — Hızlı Kargo, `RotateCcw` — Kolay İade, `Headphones` — 7/24 Destek).
Bir vektör rozeti PNG'ye rasterize etmek yerine mevcut ikon setini kullanmak hem daha keskin
hem sıfır varlık maliyetlidir — [DTI]'nin "ince çizgi bina motifi" için verdiği kararın
BİREBİR aynısı, burada da geçerli.

**Kategori kartı arkaplanları — 4 adet, `[DTI] §9` telif kısıtına uygun (soyut geometrik,
GERÇEK ürün fotoğrafı DEĞİL):** her biri 1200×900 (4:3, [DTI] §4.3 portföy kapağı ölçüsüyle
aynı), zemin `backgroundColor → surfaceColor` arası çok hafif (neredeyse düz) bir gradyan,
üzerinde `primaryColor`/`accentColor` tonunda **%15-25 opaklıkta** ince çizgi (1-2px) motif —
kart üzerine sonradan binecek başlık/CTA metninin okunabilirliğini bozmayacak kadar sessiz.
[DTI] §7.1'deki örnek kategori adlarıyla (`Aydınlatma`, `Oturma Grubu`, `Depolama`,
`Aksesuar`) eşleşen 4 motif:

| Kategori | Motif | Ton |
|---|---|---|
| Aydınlatma | Merkezden dışa yayılan ince eşmerkezli daireler (ışın soyutlaması) | `accentColor` |
| Oturma Grubu | Yumuşak, tek bir kesintisiz eğri çizgi (koltuk sırtı silüetinin soyutlanmışı) | `primaryColor` |
| Depolama | Düzenli ızgara/raf çizgileri (istiflenmiş dikdörtgen modül deseni) | `secondaryColor` |
| Aksesuar | Dağınık küçük nokta/eşkenar dörtgen kümesi (minimal "confetti" dokusu) | `accentColor` |

Üretim zinciri [DTI] §4.3 ile AYNI: bu dosyalar `assets/ecommerce-pro/_source/*.svg` olarak
**yalnızca üretim kaynağıdır**, çalışma zamanında okunmaz/servis edilmez;
`backend/scripts/build-template-assets.ts` bunları `node:zlib` ile PNG'ye çevirir (yeni
bağımlılık YOK — [DTI] §4.3 kararı aynen).

---

## Özet — Uygulanacak Somut Değerler

| Öğe | Değer |
|---|---|
| Swatch boyutu | PDP `w-8 h-8` (32px), kompakt `w-6 h-6` (24px) |
| Swatch seçili | `ring-2 ring-offset-2 ring-offset-surface ring-primary` |
| Swatch stoksuz | 2 katman nötrleştirme (`opacity-40` + `bg-surface/50`) + `-45deg` `bg-danger` çizgi |
| Beden butonu | `rounded-[var(--site-radius)]`, seçili `border-2 border-primary bg-primary/5 text-primary` |
| Beden stoksuz | `text-foreground/30` + aynı `-45deg` `bg-danger` çizgi tekniği |
| İndirim rozeti | `Badge tone="danger" solid`, `%X`, "Tükendi" ile aynı slot/öncelikli |
| Düşük stok eşiği | `0 < stockQuantity <= 3`, yalnızca PDP, `Badge tone="warning"`, `"Son {n} ürün!"` |
| Kargo çubuğu fill | `--site-primary` → eşik aşılınca `--success` |
| Kargo çubuğu track | `h-2 rounded-full bg-muted` |
| Sepet çekmecesi genişliği | `w-full sm:max-w-[420px]`, sağdan `translate-x-full → 0`, `duration-300` |
| Sepet çekmecesi z-index | panel `z-50`, backdrop `z-40 bg-black/40` |
| Sticky sepete ekle barı | `lg:hidden`, `fixed bottom-0 z-40`, `h-16`, ters gölge `shadow-[0_-2px_12px_rgba(0,0,0,0.08)]` |
| PDF kartı | `FileText` ikon kutusu (`bg-accent/10 text-accent`) + başlık + `formatBytes()` + `Button variant="secondary"` indir |
| `primaryColor` | `#1E3A8A` |
| `secondaryColor` | `#0F172A` |
| `buttonColor` / `buttonTextColor` | `#2563EB` / `#FFFFFF` (5.17:1) |
| `linkColor` | `#2563EB` (4.94:1 / 5.17:1) |
| `accentColor` | `#047857` (5.24:1 metin / 5.48:1 rozet) |
| `backgroundColor` / `surfaceColor` | `#F8FAFC` / `#FFFFFF` |
| `textColor` / `mutedTextColor` | `#0F172A` (17.06:1) / `#64748B` (4.55:1) |
| `headingFont` / `bodyFont` / `baseFontSize` | `MONTSERRAT` / `INTER` / `16` |
| `borderRadius` / `buttonStyle` / `presetKey` | `MD` / `SOLID` / `null` |
| `previewImageUrl` kompozisyonu | Hero (35%) + 4 kategori kartı (20%) + 2×3 ürün ızgarası (45%) |
| `_source/*.svg` | 4 kategori arkaplanı (soyut çizgi motif) — rozet ikonları SVG DEĞİL, lucide `icon-box` |
