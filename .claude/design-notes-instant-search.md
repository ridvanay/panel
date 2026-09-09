# Tasarım Notu — Header Canlı Ürün Arama (Instant Search) Popover

**Kapsam:** `.claude/architect-scope-search-and-order-emails.md` §1 (BAĞLAYICI kontrat) ve orada §1.6
"ui-designer" paragrafı. Bu doküman, `frontend-agent`'ın `frontend/src/components/site/site-header.tsx`
+ yeni `header-search.tsx` içinde birebir uygulayacağı görsel spesifikasyondur. Kod yazılmadı; aşağıdaki
`tsx`/class parçacıkları **örnektir** (`design-notes-header-colors.md` ve
`ui-designer-navigation-flyout-spec.md`'deki AYNI üslup) — state/veri mantığı frontend-agent'ındır.

**Okunan referanslar:** `site-header.tsx` (mevcut header, `NAV_LINK_TEXT_CLASSES`/`ICON_LINK_TEXT_CLASSES`,
`md:hidden`/`md:flex` deseni), `design-notes-header-colors.md` (Görsel yön: **Minimal/Flat**, header'daki
`backdrop-blur` işlevsel — dekoratif glow DEĞİL — ve `--site-header-*` token seti), `ui-designer-navigation-flyout-spec.md`
(z-index `z-50` kararı, `collisionPadding={8}`, hover-intent gecikmeleri), `components/ui/popover.tsx`
(Base UI `@base-ui/react/popover`, YENİ primitif İCAT EDİLMEDİ — bu doğrudan kullanılır), `components/ui/input.tsx`,
`components/ui/skeleton.tsx`, `components/site/product-card.tsx` + `product-purchase-panel.tsx` (indirimli
fiyat gösterim konvansiyonu — üstü çizili eski fiyat `text-foreground/40 line-through`, indirimli fiyat
**renk DEĞİŞTİRMEZ**, `text-foreground` kalır), `globals.css` `.site-scope` bloğu (satır ~479-526: `--popover`
→ `--site-surface`, `--border`/`--input`/`--ring`/`--muted`/`--muted-foreground` hepsi site temasına
köprülü — yani standart `bg-popover`/`border-border`/`focus-visible:ring-ring`/`text-muted-foreground`
sınıfları storefront'ta OTOMATİK doğru renklere çözülür, yeni token GEREKMEZ).

**Görsel yön (pivot YOK):** Proje **Minimal/Flat**. Bu popover glassmorphism/glow KULLANMAZ — mevcut
`PopoverContent`in düz `bg-popover` + `ring-1 ring-foreground/10` + `shadow-md` dilini aynen sürdürür.

---

## 0. Primitif kararı (bağlayıcı)

**`Popover` / `PopoverContent` (`components/ui/popover.tsx`, Base UI `@base-ui/react/popover`) KULLANILIR.**
`Command`/`cmdk` (`components/ui/command.tsx`, `admin/command-palette.tsx`) KULLANILMAZ — o primitif
ekranın ortasında açılan **modal** bir command palette'tir (`overlayClassName` ile arka planı karartır),
buradaki ihtiyaç ise "input'un **altında** açılan, sayfayı KARARTMAYAN, konumlanmış (anchored)" bir
panel — bu tam olarak `Popover`'ın (overlay/backdrop bileşeni YOK, `components/ui/popover.tsx`'te hiç
tanımlı değil — doğası gereği non-modal) tasarlandığı senaryo. Yeni bir primitif İCAT EDİLMEZ.

- `Popover` kök bileşeni **kontrollü** (`open`/`onOpenChange` frontend-agent'ın state'i) kullanılır.
- `PopoverContent` **varsayılan görsel dili değişmeden** (`bg-popover text-popover-foreground shadow-md
  ring-1 ring-foreground/10 rounded-lg`, açılış/kapanış `data-open:animate-in data-open:fade-in-0
  data-open:zoom-in-95` / `data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95`,
  `duration-100`) yalnızca `className` prop'uyla **genişlik/max-height override** edilir (bkz. §2).
- İçerik gruplama (kategori/ürün başlıkları, satırlar, footer) için `PopoverHeader`/`PopoverTitle`
  KULLANILMAZ (onlar tek başlıklı basit popover'lar içindir) — düz `div`/`Link` ile §3'teki sınıflar
  kullanılır.

---

## 1. Header'daki yerleşim

### (a) Yerleşim noktası (masaüstü + mobil ORTAK)

`site-header.tsx` satır 499-501 arası: masaüstü nav-link `div`inin (`hidden items-center ... md:flex`,
satır 458) **kapanışından HEMEN SONRA**, sağ ikon kümesi `div`inin (`flex flex-wrap items-center gap-x-5
...`, satır 501) **AÇILIŞINDAN ÖNCE** yeni bir `<HeaderSearch />` bileşeni eklenir — kendi flex-child'ı
olarak `<nav>`in DOĞRUDAN çocuğu (CTA/dil/hesap/favori/sepet kümesinin İÇİNDE DEĞİL). Gerekçe: arama
"içerik keşfi" kategorisidir (nav-link'lere kavramsal olarak yakın), "hesap eylemleri" kümesinden
(CTA/dil/hesap/favori/sepet) ayrı tutulur — Stripe/Linear dokümantasyon header'larındaki yerleşimle
aynı mantık.

**Koşul (bağlayıcı):** `HeaderSearch` yalnızca `productsModuleEnabled` `true` iken render edilir —
sepet/favori ikonlarıyla AYNI koşul (`{productsModuleEnabled && <HeaderSearch ... />}`). Arama
`products` modülüne bağımlı bir uçtur (§1.1 architect kararı), modül kapalıyken header'da hiçbir iz
bırakmaz.

### (b) GÜNCELLEME (frontend-agent, storefront header tek-satır düzeltmesi) — breakpoint ayrımı KALDIRILDI

**Önceki karar** (ayrı `lg:hidden` ikon-buton + `hidden lg:block` sabit-genişlikte kalıcı input) TERK
EDİLDİ. Kök sorun: `<nav>`in `flex-wrap` davranışı + masaüstünde HER ZAMAN görünen `w-56 xl:w-72` sabit
genişlikte bir input, çok linkli menü + CTA + dil seçici + hesap/favori/sepet ikonlarıyla toplam
genişlik sınırlı masaüstü çözünürlüklerde (1280-1440px) taşmaya ve `<nav>`in ikinci satıra bölünmesine
yol açıyordu.

**Yeni karar — TEK bir davranış, tüm genişliklerde:** Mobil/tablet/masaüstü ayrımı olmadan tek bir
`Search` (lucide) ikon-buton tetikleyici — sepet/favori ikonlarıyla BİREBİR aynı kalıp
(`inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--site-header-link)]
transition-colors hover:bg-surface-muted hover:text-[var(--site-header-link-hover)]`, ikon `h-5 w-5`) —
`<nav>`in sağ eylem ikonları grubunun İÇİNDE, EN SOLDA (arama ikonu → CTA → dil seçici → hesap →
favori → sepet sıralaması). Tıklanınca §1(d)'deki panel açılır/kapanır (`aria-expanded` bu duruma
bağlı, `aria-label` "Ara" ↔ "Aramayı kapat" arasında geçiş yapar).

**Gerekçe:** Kalıcı (persistent) bir masaüstü input KALDIRILDI — panel yalnızca kullanıcı isteyince
açılır, bu da `<nav>`in genişlik bütçesini SABİT ve ÖNGÖRÜLEBİLİR tutar (arama ikonu her zaman 36×36px,
viewport'tan bağımsız). Büyük e-ticaret sitelerindeki "kalıcı masaüstü kutusu" konvansiyonundan bu
BİLİNÇLİ sapma, `<nav>`in tek satırda kalması gerekliliğinin (bkz. görev tanımı) önceliklendirilmesidir.

### (c) GÜNCELLEME — kalıcı masaüstü input KALDIRILDI

Önceki §1(c)'deki "masaüstü kalıcı input" (`hidden lg:block`, `w-56 xl:w-72`) artık YOK — masaüstünde
de arama SADECE §1(b)'deki ikon-buton ile başlar, açılan panel (§1(d)) tüm genişliklerde AYNI
`w-full` girişi kullanır. Odak halkası/köşe yuvarlaklığı/kenarlık/ikon rengi kararları (eski §1(c)'nin
görsel dili) DEĞİŞMEDEN §1(d)'deki tek panele taşındı.

### (d) Panel — TEK genişlik, tüm ekranlarda `<nav>`in bağımsız sibling'i

İkon tetikleyiciye tıklanınca **tam-genişlik bir panel** açılır — `<nav>` içine flex-child olarak
sıkıştırılmaz, `<header>` içinde `<nav>`in DOĞRUDAN sonrasına gelen bağımsız bir sibling `<div>`:

```tsx
// İllüstratif iskelet
<header className={cn(/* mevcut header sınıfları, DEĞİŞMEZ */)}>
  <nav className="mx-auto flex h-20 max-w-5xl flex-nowrap items-center justify-between gap-4 px-4 sm:px-6">
    {/* logo, hamburger, nav-links, CTA/dil/hesap/favori/sepet grubu (arama ikon-butonu bu grubun İÇİNDE, en solda) — mevcut */}
  </nav>
  {panelOpen && (
    <div className="border-t border-border/60 px-4 py-2.5 sm:px-6 animate-in fade-in-0 slide-in-from-top-2 duration-150">
      {/* input, w-full — masaüstü/mobil AYRIMI YOK */}
    </div>
  )}
</header>
```

- Bu satır **header'ın KENDİ arka plan token'larını miras alır** (`--site-header-bg`/`-sticky`) — ayrı
  bir renk tanımlamaz, sadece `border-t border-border/60` ile üst satırdan ayrılır.
- Input `w-full h-10` (TÜM genişliklerde, artık `w-56 xl:w-72`/`w-96` masaüstüne özel sabit genişlik
  YOK), aynı `rounded-[var(--site-radius)]` ve odak halkası (eski §1(c) ile birebir aynı sınıflar).
  İkon-butonuna TEKRAR basmak veya Esc bu paneli kapatır (frontend-agent, §6) — Esc AYRICA odağı
  tetikleyici ikona geri döndürür.
  Kapanınca input değeri sıfırlanır — açık popover da otomatik kapanır (aşağı bkz. §6).
- Açılış animasyonu `animate-in fade-in-0 slide-in-from-top-2 duration-150` (`tw-animate-css`,
  proje genelinde zaten kullanılan sınıflar — bkz. `admin/appearance/page.tsx`).

---

## 2. Popover panel — boyut, konum, katman, görsel kalıp

**Konum (`align`/`side`):** `side="bottom"` `align="start"` `sideOffset={6}` `collisionPadding={8}` —
`sideOffset` mevcut `PopoverContent` varsayılanı olan `4`'ten biraz daha ferah tutulur (input kutusunun
kenarlığıyla panel arasında net bir boşluk), `collisionPadding={8}` nav flyout'uyla (§b, `ui-designer-navigation-flyout-spec.md`)
AYNI değer — proje genelinde tutarlı bir "ekran kenarı payı" konvansiyonu.

**Genişlik:**
- Masaüstü (`lg:` kalıcı input, §1c): panel input'tan BAĞIMSIZ, sabit **`lg:w-96` (384px)** —
  40×40 küçük resim + başlık + fiyat satırının rahat sığması için input'un kendisinden (224-288px)
  daha geniş olmak ZORUNDA; `align="start"` ile sol kenarlar hizalı kalır, taşma varsa Floating-UI
  otomatik `flip` uygular (nav flyout'taki AYNI davranış, ek kod gerekmez).
- Mobil açılır satır (§1d): panel **`w-(--anchor-width)`** (input'un tam genişliği, `DropdownMenuContent`'in
  `w-(--anchor-width)` deseniyle AYNI Base UI CSS değişkeni) — kenardan kenara, ekstra genişlik
  hesaplaması gerekmez.

**Yükseklik/scroll:** İçerik iki bölüme ayrılır — (1) kaydırılabilir gövde: kategori + ürün grupları,
`max-h-96` (384px) `overflow-y-auto`; (2) **kaydırılmayan, her zaman görünür** alt satır: "Tüm sonuçları
gör" (§4). 5 ürün + 3 kategori satırının HER BİRİ 56px (bkz. §3) olduğu için tam dolu durumda gövde
içeriği ~450px'i bulur — `max-h-96` bunu kaydırılabilir kılar, kısa viewport'larda (mobil yatay, düşük
çözünürlüklü dizüstü) panel asla ekran dışına taşmaz. Footer'ın gövde DIŞINDA tutulması "Tüm sonuçları
gör"ün her zaman erişilebilir kalmasını garanti eder (kullanıcı kaydırmak zorunda kalmadan çıkış yolu
bulur).

**Görsel kalıp (mevcut `PopoverContent`'in DEĞİŞMEYEN kısmı):** `rounded-lg`, `shadow-md`,
`ring-1 ring-foreground/10`, `bg-popover text-popover-foreground`. Padding `PopoverContent`'in
varsayılan `p-2.5`'i yerine **`p-0`** (gruplar kendi iç padding'ini taşır, §3) — bu tek override.

**z-index:** **Değiştirilmez, `z-50`** (`PopoverContent`'in kendi `Positioner` sınıfı `isolate z-50`).
Nav flyout'u (`DropdownMenuContent`/`DropdownMenuSubContent`) de `z-50` kullanıyor
(`ui-designer-navigation-flyout-spec.md` §b) — sticky header'ın `z-30`'unun üzerinde, İKİSİ aynı
katmanda ama ÇAKIŞMAZ: ikisi de o an klavye/işaretçi odağının bulunduğu TEK bir tetikleyiciye bağlıdır
(arama input'una odaklanmak nav flyout'unu, nav flyout'unu açmak arama popover'ını kapatır — frontend-agent
her iki `open` state'ini karşılıklı dışlayan `useState`/tek bir "hangi popover açık" state'i ile
yönetmelidir, bu bir uygulama detayıdır ama görsel sonuç garantilidir: aynı anda ikisi POINTER/FOCUS'a
sahip olamaz). Yeni bir z-index katmanı AÇILMAZ.

**Açılma/kapanma animasyonu:** `PopoverContent`'in mevcut deseni AYNEN kullanılır — `duration-100`,
`data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95`, `data-closed:animate-out
data-closed:fade-out-0 data-closed:zoom-out-95`. Yeni bir Framer Motion geçişi YAZILMAZ (mevcut CSS
tabanlı animasyon zaten yeterli, `ui-designer-navigation-flyout-spec.md`'nin "mevcut primitif zaten
animasyonlu" ilkesiyle aynı).

---

## 3. İçerik yapısı

**Grup sırası kararı (bağlayıcı, görev tanımındaki alan sıralamasından BİLİNÇLİ sapma):** Panelde
**"Ürünler" grubu ÖNCE, "Kategoriler" grubu SONRA** gösterilir. Gerekçe: kullanıcının arama niyeti
öncelikle ürün bulmaktır (5 sonuç ayrılmış, kategoriler 3 ile daha az ağırlıklı — backend limitleri
zaten bu önceliği yansıtıyor); kategoriler "arama sonucunu daraltmak isterseniz" tarzı ikincil bir
kısayoldur. Bu salt görsel bir sıralama kararıdır, API kontratını (§1.3'teki `{ products, categories }`
alan sırası) ETKİLEMEZ.

**Ortak satır ızgarası — TÜM satırlar (kategori + ürün) 40×40 + metin bloğu paylaşır:**
Gruplar arası göz sıçramasını önlemek için kategori satırları da ürün satırlarıyla AYNI 40×40
"görsel/ikon kutusu + metin" ızgarasını kullanır (kategori satırı gerçek bir görsel taşımaz, yerine
ikonlu bir `bg-muted` kutu kullanır — §3b).

### (a) "Ürünler" grubu

```
┌───────────────────────────────────────────┐
│ ÜRÜNLER                                    │  ← grup başlığı
├───────────────────────────────────────────┤
│ [40x40]  Kablosuz Kulaklık Pro             │
│  img     ~~₺1.299,00~~ ₺999,00             │  ← satır, h-14 (56px)
├───────────────────────────────────────────┤
│ [40x40]  Akıllı Saat X2                    │
│  img     ₺2.499,00                         │
└───────────────────────────────────────────┘
```

**Grup başlığı:** `<p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide
text-muted-foreground">Ürünler</p>` — `admin/command-palette.tsx`'teki `groupClassName` başlık deseniyle
(`text-xs font-medium uppercase tracking-wide`) AYNI dilde, storefront token'ına (`text-muted-foreground`
→ `.site-scope`'ta `--site-muted-text`) taşınmış hâli.

**Satır** (`Link` — `/products/{slug}`):
```tsx
<Link
  href={href}
  className="flex items-center gap-3 px-3 py-2 hover:bg-muted focus-visible:bg-muted outline-none"
  data-highlighted={isHighlighted || undefined} // klavye ok-tuşu vurgusu, bkz. §6
>
  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
    {coverMedia ? (
      <SafeImage src={coverMedia.url} alt={coverMedia.altText ?? ""} fill sizes="40px" className="object-cover" />
    ) : (
      <div className="flex h-full w-full items-center justify-center">
        <ImageOff className="h-4 w-4 text-foreground/30" aria-hidden="true" />
      </div>
    )}
  </div>
  <div className="min-w-0 flex-1">
    <p className="truncate text-sm font-medium text-foreground">{title}</p>
    <p className="mt-0.5 text-xs">
      {discountPriceCents !== null ? (
        <>
          <span className="mr-1.5 text-[11px] font-normal text-foreground/40 line-through">
            {formatPriceFromCents(priceCents, currency)}
          </span>
          <span className="font-semibold text-foreground">{formatPriceFromCents(discountPriceCents, currency)}</span>
        </>
      ) : (
        <span className="font-semibold text-foreground">{formatPriceFromCents(priceCents, currency)}</span>
      )}
    </p>
  </div>
</Link>
```

- Küçük resim: **40×40 (`h-10 w-10`)**, `rounded-md` (SABİT `--radius-md` token, `--site-radius`
  DEĞİL — gerekçe: bu üst-seviye bir etkileşim öğesi değil, ikon-ölçekli bir küçük resim; sabit ölçek
  ailesi diğer ikon-ölçekli görsellerle (avatar/thumbnail sınıfı) tutarlı kalır. `--site-radius`
  yalnızca büyük, kullanıcı-özelleştirmesi hissedilen yüzeylere — CTA butonu, PDP galerisi, kart
  görselleri — ayrılmıştır).
- `coverMedia === null` (backend `Media | null` döner, §1.3): `ImageOff` (lucide) ikonlu `bg-muted`
  kutu — kırık resim ikonu YOK, sessiz/nötr bir yer tutucu.
- Fiyat gösterimi **BİREBİR `product-card.tsx`/`product-purchase-panel.tsx` konvansiyonu** (küçültülmüş
  ölçekte): üstü çizili eski fiyat ÖNCE (`text-foreground/40 line-through`), indirimli fiyat SONRA —
  indirimli fiyat metni **renk DEĞİŞTİRMEZ** (`text-foreground` kalır, kırmızı/`text-destructive`
  KULLANILMAZ) — indirim vurgusu zaten `%X` rozetiyle site genelinde iletiliyor (burada rozet YOK,
  panel dar, sadece fiyat metni yeterli sinyal verir).
- Başlık **tek satır** (`truncate`, `line-clamp` DEĞİL) — satır yüksekliği sabit 56px kalmalı (uzun
  başlıklarda 2. satıra taşma satır ızgarasını bozar).
- Satır toplam yükseklik: `py-2` (8px+8px) + `h-10` (40px) = **56px**.

### (b) "Kategoriler" grubu

```tsx
<Link
  href={categoryHref}
  className="flex items-center gap-3 px-3 py-2 hover:bg-muted focus-visible:bg-muted outline-none"
>
  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
    <FolderOpen className="h-4 w-4 text-foreground/40" aria-hidden="true" />
  </div>
  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{name}</span>
  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/30" aria-hidden="true" />
</Link>
```

- Aynı 56px satır yüksekliği (40×40 ikon kutusu + `py-2`) — ürün satırlarıyla ızgara hizası korunur.
- `FolderOpen` ikonu (lucide) — "koleksiyon/liste sayfasına gidiyorsunuz" sinyali, ürün küçük
  resimleriyle KARIŞTIRILMAZ (gerçek görsel yok, sadece ikon).
- Trailing `ChevronRight` — "bu bir gezinme hedefi" ipucu, nav flyout'undaki chevron kullanımıyla
  (`ChevronRightIcon`, `size-4`) aynı ailede ama burada `h-3.5 w-3.5` (satır daha kompakt metin
  taşıdığı için biraz küçük).
- Grup başlığı "Ürünler" ile BİREBİR aynı sınıf (`KATEGORİLER`).

### (c) Boş grup davranışı

Backend `products: []` VEYA `categories: []` dönebilir (birbirinden bağımsız, §1.4 madde 5'teki
"toplam sonuç sayısı yok" kararıyla tutarlı). Boş bir grup **başlığıyla birlikte TAMAMEN gizlenir**
(boş "ÜRÜNLER" başlığı + hiç satır YANLIŞTIR — kullanıcıyı yanıltır). Yalnızca `products` VE
`categories` İKİSİ DE boşsa §5'teki genel "boş sonuç" durumu gösterilir.

---

## 4. Alt kısım — "Tüm sonuçları gör"

```tsx
<Link
  href={`/products?search=${encodeURIComponent(term)}`}
  className="flex items-center justify-center gap-1.5 border-t border-border/60 px-3 py-2.5 text-sm font-medium text-primary hover:underline"
>
  Tüm sonuçları gör
  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
</Link>
```

- **Her zaman render edilir** (yükleniyor/sonuç/boş-sonuç/hata — term ≥ 2 karakter olduğu SÜRECE,
  frontend'in zaten atmadığı < 2 karakter durumu hariç). Gerekçe: (1) layout kaydırıcılığı önler
  (footer'ın duruma göre görünüp kaybolması panel yüksekliğini oynatır), (2) boş/hata durumunda bile
  kullanıcıya "yine de tam katalog sayfasında dene" kaçış yolu sağlar — backend §1.4 madde 5'in zaten
  öngördüğü davranış ("Tüm sonuçları gör" koşulsuz `/products?search=` gider).
- Renk `text-primary` (`.site-scope`'ta `--site-primary`) — marka rengiyle vurgulanan TEK etkileşim
  öğesi bu panelde (satırlar nötr `text-foreground` kalır) — "bu bir eylem/link, satırlar ise
  sonuç" ayrımını renkle netleştirir.
- `border-t border-border/60` ile gövdeden (kaydırılabilir kısım) ayrılır — `max-h-96 overflow-y-auto`
  DIŞINDA olduğu için asla kaybolmaz (§2).

---

## 5. Durumlar — yükleniyor / boş / hata

### (a) Yükleniyor (skeleton)

**3 ürün satırı + 2 kategori satırı** iskeleti gösterilir (backend tavanı olan 5+3 DEĞİL — bilinçli
seçim: iskelet, nihai sonuç sayısını TAAHHÜT ETMEMELİ; 5+3'ün TAMAMINI iskeletlemek panel yüksekliğini
gereksiz büyütüp "ağır" bir yükleniyor hissi verir, 3+2 temsili/kompakt bir önizleme sağlar).
`Skeleton` bileşeni (`components/ui/skeleton.tsx`, mevcut `animate-pulse rounded-md bg-muted`) kullanılır:

```tsx
<div className="px-3 pt-2.5 pb-1"><Skeleton className="h-3 w-16" /></div> {/* "ÜRÜNLER" yer tutucu */}
{[0, 1, 2].map((i) => (
  <div key={i} className="flex items-center gap-3 px-3 py-2">
    <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
    <div className="min-w-0 flex-1 space-y-1.5">
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  </div>
))}
<div className="px-3 pt-2.5 pb-1"><Skeleton className="h-3 w-20" /></div> {/* "KATEGORİLER" yer tutucu */}
{[0, 1].map((i) => (
  <div key={i} className="flex items-center gap-3 px-3 py-2">
    <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
    <Skeleton className="h-3.5 w-1/2" />
  </div>
))}
```

- Satır iskeleti gerçek satırla AYNI 56px yüksekliği taşır (`h-10` görsel kutusu + `py-2`) — yükleniyor
  → sonuç geçişinde ani sıçrama olmaz.
- Footer ("Tüm sonuçları gör") yükleniyor sırasında da GÖRÜNÜR (§4 kuralı, "her zaman render edilir").

### (b) Boş sonuç (`products: []` VE `categories: []`)

```tsx
<div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
  <SearchX className="h-8 w-8 text-foreground/20" aria-hidden="true" />
  <p className="text-sm font-medium text-foreground">"{term}" için sonuç bulunamadı</p>
  <p className="text-xs text-muted-foreground">Farklı bir anahtar kelime deneyin.</p>
</div>
```

### (c) Hata durumu — KARAR: sessizce KAPANMAZ, panel içinde nötr mesaj gösterilir

Popover açık kalır, gövde (b)'ye görsel olarak ÇOK benzeyen ama farklı ikon/metinli bir durum gösterir:

```tsx
<div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
  <CircleAlert className="h-8 w-8 text-foreground/20" aria-hidden="true" />
  <p className="text-sm font-medium text-foreground">Arama şu anda kullanılamıyor</p>
  <p className="text-xs text-muted-foreground">Lütfen daha sonra tekrar deneyin.</p>
</div>
```

**Gerekçe:** Sessizce kapatmak, kullanıcının "yazdığım şey hiçbir şey yapmadı" hissetmesine yol açar —
ayrım koyulamaz bir başarısızlıkla "sonuç yok"u karıştırır. Nötr (kırmızı/`text-destructive` DEĞİL,
aynı soluk `text-foreground/20` ikon tonu) bir mesaj hem kullanıcıyı bilgilendirir hem de bunun bir
"suçlama" (kullanıcı hatası) olmadığını iletir. **Footer ("Tüm sonuçları gör") bu durumda da görünür
kalır** — anlık önizleme başarısız olsa bile kullanıcı tam katalog arama sayfasına geçebilir (backend
tarafında o sayfa ayrı bir istek/route olduğu için önizlemedeki hatadan etkilenmez). İkon `CircleAlert`
(genel amaçlı, "ağ hatası" gibi spesifik bir nedene işaret ETMEZ — 422/429/500 hangisi olursa olsun
aynı nötr görünüm, backend hata ayrımı frontend-agent'ın loglama/retry kararıdır, bu doküman kapsamı
dışında).

---

## 6. Klavye etkileşimi

- **Odak halkası:** input'un kendisi §1(c)/(d)'de tanımlanan `focus-visible:border-ring
  focus-visible:ring-3 focus-visible:ring-ring/50` halkasını taşır — bu proje genelindeki `Input`
  primitifiyle BİREBİR aynı, yeni bir halka stili İCAT EDİLMEZ.
- **Ok tuşlarıyla gezinme (öneri — combobox deseni):** Gerçek DOM odağı input'ta KALIR (klavye
  odağı satırlara TAŞINMAZ); ok-aşağı/yukarı bir "vurgulanan satır" index'ini değiştirir. Vurgulanan
  satır GÖRSEL olarak `hover:bg-muted` ile AYNI sınıfı alır (`bg-muted`, `text-foreground` zaten
  varsayılan) — `CommandItem`/`DropdownMenuItem`'ın `data-selected:bg-muted` konvansiyonuyla TUTARLI,
  yeni bir "seçili satır" rengi İCAT EDİLMEZ. Bu, `role="combobox"` (input) + `role="listbox"` (gövde)
  + `role="option"` (satır) + `aria-activedescendant` ARIA desenine karşılık gelir — ARIA
  kablolaması frontend-agent'ın işidir, burada yalnızca görsel sonuç (vurgu sınıfı) bağlayıcıdır.
- **Enter:** vurgulanan bir satır varsa o hedefe gider; hiçbir satır vurgulanmamışsa (kullanıcı henüz
  ok tuşuna basmadıysa) `/products?search=<term>` (footer linkiyle AYNI hedef) — bu bir ÖNERİDİR,
  frontend-agent'ın karar/uygulama alanı.
- **Esc:** popover'ı kapatır (mevcut `data-closed:*` 100ms fade+zoom-out geçişiyle — özel bir "ani
  kapama" YOK, tüm diğer popover/dropdown'larla TUTARLI); odak input'ta KALIR (kaybolmaz) — kullanıcı
  tekrar yazmaya devam edebilir. Mobil açılır satırda (§1d) Esc HEM popover'ı HEM açılır satırın
  kendisini kapatır (tek tuşla tamamen geri çekilme).

---

## 7. Erişilebilirlik notları

**Kontrast (WCAG AA, `--site-surface` varsayılanı `#f9fafb` zemine karşı, hesaplamalar
`design-notes-header-colors.md`'deki rijitlikle):**

| Öğe | Renk | Zemin | Oran | Sonuç |
|---|---|---|---|---|
| Ürün/kategori başlığı (`text-foreground`) | `#111827` | `#f9fafb` | **16.97:1** | ✅ AA |
| Grup başlığı (`text-muted-foreground`) | `#6b7280` | `#f9fafb` | **4.62:1** | ✅ AA (normal metin eşiği 4.5:1) |
| "Tüm sonuçları gör" (`text-primary`) | `#4f46e5` | `#f9fafb` | **~6.2:1** | ✅ AA (`design-notes-header-colors.md` §5'te `#4f46e5` vs beyaz için 6.29:1 doğrulanmıştı, `#f9fafb` neredeyse özdeş) |
| Üstü çizili eski fiyat (`text-foreground/40`) | `#111827`@40% | `#f9fafb` | **~2.52:1** | ⚠️ AA'yı KARŞILAMAZ — bkz. not aşağıda |

**Bilinçli istisna notu:** Üstü çizili eski fiyatın düşük kontrastı YENİ bir sorun DEĞİL — `product-card.tsx`
ve `product-purchase-panel.tsx`'te ZATEN kullanılan, proje genelinde kabul edilmiş bir dekoratif
konvansiyondur (birincil bilgi olan İNDİRİMLİ fiyat tam kontrastta kalır, "eski fiyat" ikincil/dekoratif
bir referanstır, üstü çizili olması bilgiyi salt renkle değil DEKORASYONLA da taşır — WCAG 1.4.3'ün asıl
endişe ettiği "bilgi SADECE renkle" durumu burada geçerli değil). Bu popover, mevcut app-genelindeki
tutarlılığı BOZMAMAK için AYNI `/40` opaklığını kullanır; tek başına bu ekranı `/55-60`'a çıkarmak yeni
bir tutarsızlık yaratırdı (görev tanımının "mevcut tasarım tokenleri kullanılır" ilkesiyle çelişir).

**`aria-live` önerisi (görsel gizleme deseni GEREKMEZ, ama frontend-agent'a not):** Sonuç sayısı
değiştiğinde (`"5 ürün, 2 kategori bulundu"` / `"Sonuç bulunamadı"`) ekran okuyucuya bildirmek için
görsel olarak gizli (`sr-only` — proje genelinde zaten kullanılan Tailwind yardımcı sınıfı, ör.
`SheetTitle`'ın sr-only kullanımlarına bakılabilir) bir `aria-live="polite"` bölgesi eklenmesi ÖNERİLİR.
Bu bölge YENİ bir görsel token GEREKTİRMEZ (`sr-only` zaten sıfır-boyut).

---

## Özet — frontend-agent'a devredilecek işler

1. `site-header.tsx`: `HeaderSearch` bileşenini §1(a)'daki konuma, `productsModuleEnabled` koşuluyla ekle.
2. Yeni `header-search.tsx`: `lg:` breakpoint'inde ikon-buton ↔ kalıcı input geçişi (§1b/c), mobilde
   açılır ikinci satır (§1d).
3. `Popover`/`PopoverContent` (mevcut primitif) ile §2'deki genişlik/max-height/konum override'larını uygula.
4. §3'teki grup/satır JSX iskeletini (Ürünler → Kategoriler sırası, 40×40 ortak ızgara, fiyat
   konvansiyonu) birebir uygula.
5. §4'teki footer linkini HER durumda (yükleniyor/sonuç/boş/hata) render et.
6. §5'teki üç durumu (skeleton 3+2, boş, hata) uygula; hata durumunda popover'ı KAPATMA.
7. §6'daki klavye deseni (odak input'ta sabit, ok tuşu ile vurgu, Enter/Esc davranışı) + §7'deki
   `aria-live` bölgesini ekle.
