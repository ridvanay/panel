design-notes: `google-map` bloğu + 5 kurumsal blok genişletmesi — ui-designer tasarım tokenleri

**Durum:** BAĞLAYICI tasarım kararı. Kapsam: `.claude/architect-scope-google-map-corporate-blocks.md`
§7.3'te ui-designer'a devredilen madde: (1) `google-map` görsel dili (yükseklik kontrolü, köşe
yuvarlaklığı, `mapStyle` filter tablosu), (2) `accordion.layoutStyle` üç varyant sınıf tablosu,
(3) `logo-marquee` grid modu düzeni + `grayscale` davranışı, (4) `video` lightbox tetikleyici +
modal kabuğu, (5) ikon eşlemesi onayı, (6) kart-içi mini önizleme yerleşimi. **Kod implementasyonu
YOK** — bu doküman token/sınıf tablosu + "nerede nasıl kullanılır" eşlemesidir, uygulayan
frontend-agent'tır.

**Girdi dokümanları (baştan sona okundu):**
`.claude/architect-scope-google-map-corporate-blocks.md` (özellikle §2 veri modelleri, §4 admin
kararları, §7.3 görev listesi) ve `.claude/security-review-google-map-corporate-blocks.md` (§4.3
`mapStyle` kısıtı — sabit `Record<GoogleMapStyle, string>` look-up, ASLA template-literal).

**Görsel yön:** Proje **Minimal/Flat** (bkz. `.claude/ui-designer-scope-advanced-slider.md` —
"düz `bg-surface`/`border-border` kartlar, yüksek kontrast, sade border'lar"). Bu doküman o kararı
KIRMAZ. Yeni bir glassmorphism/glow estetiği İCAT EDİLMEDİ; tek "koyu zemin" istisnası
(video lightbox modalı) zaten projede onaylı olan `gallery-lightbox.tsx`'in AYNI deseninin ikinci
uygulamasıdır (tam ekran medya görüntüleyicileri her zaman siyah zemin kullanır — bu evrensel bir
lightbox konvansiyonudur, mevcut emsalin dışına çıkmaz).

**Önemli sınır (mimar §2.1 doğrulaması — ham backend şeması okundu):** `GoogleMapBlockDataSchema`
(`backend/src/modules/pages/pages.schemas.ts:952-958`) içinde bir **köşe yuvarlaklığı/`radius`
alanı YOKTUR** — yalnızca `embedUrl`/`address`/`zoom`/`height`/`mapStyle`/`markerTitle`. Yani
"köşe yuvarlaklığı" kullanıcının seçtiği bir ayar DEĞİL, ui-designer'ın **sabit** bir render kararı
(§1.2 aşağıda) — veri modeline yeni alan EKLENMEZ, mimar dokümanına aykırı bir alan icat edilmedi.

---

## §1 `google-map` görsel dili

### 1.1 Yükseklik kontrolü (editör — `GoogleMapBlockEditor`, YENİ dosya)

Backend `GoogleMapHeightSchema` teknik olarak `value.min(1).max(2000)` kabul eder (eski/bozuk
kayıt savunması) ama editördeki input **UI seviyesinde** 120-2000px (veya 10-100vh) aralığını
zorlar — kullanıcıyı kullanılamaz bir harita üretmekten korumak (görev talimatındaki nüans).

**Kontrol düzeni** (`LogoMarqueeBlockEditor`'daki `speedSeconds` `InputGroup` deseniyle AYNI aile):

```
Alan grubu "Yükseklik"
├─ SegmentedToggle (birim): [ "px" | "vh (ekran yüksekliği)" ]   — segmented-toggle.tsx, mevcut
└─ InputGroup (sayı):
     unit === "px" → min=120 max=2000 step=10, varsayılan 400
     unit === "vh" → min=10  max=100  step=1,  varsayılan 50
   InputGroupAddon (align="inline-end") → "px" / "vh"
```

- Backend'in `min(1)` tavanı yalnızca eski kayıtları render edebilmek içindir; editör input'unun
  `min` attribute'u **120** (px) / **10** (vh) olarak set edilir, blur/onChange'de
  `Math.max(...).min(...)` ile clamp edilir (`LogoMarqueeBlockEditor::speedSeconds` clamp
  deseniyle birebir — `Number.isFinite` kontrolü dahil).
- `vh` UI-alt-sınırı (`10`) backend'de tanımlı bir sabit DEĞİLDİR — bu, ui-designer'ın önerdiği
  **yeni bir UI-only sabittir**: `GOOGLE_MAP_UI_MIN_HEIGHT_VH = 10` adıyla, `GOOGLE_MAP_MIN_HEIGHT_PX`
  gibi backend-yansımalı sabitlerden AYRI bir yerde (`types.ts` içinde "UI-only" yorumuyla)
  tanımlanmalı — 800px tipik görünüm yüksekliğinde ~80px'e denk gelir, 120px px-tabanının
  orantısal karşılığı.
- Birim değiştirildiğinde (px→vh veya tersi) değer **dönüştürülmez** — ilgili birimin
  varsayılanına (400px / 50vh) sıfırlanır. Gerekçe: piksel↔vh dönüşümü viewport'a bağlıdır,
  editörde yanıltıcı bir "sahte dönüşüm" yapmaktansa öngörülebilir bir varsayılana düşmek
  `RADIUS_OPTIONS`/`PROVIDER_OPTIONS` gibi mevcut "seçenek değişince state sıfırlanır" desenleriyle
  tutarlıdır.

### 1.2 Köşe yuvarlaklığı — SABİT karar, kullanıcı ayarı DEĞİL

`google-map` public render sarmalayıcısı (`google-map-block.tsx`, YENİ) **her zaman**:

```
rounded-lg overflow-hidden
```

kullanır — `ImageRadius` tipinin `"md"` değeriyle SAYISAL olarak aynı sınıf (`image-block.tsx:11`,
`--radius-lg` = `0.625rem`/10px). Bu değer icat edilmedi: `video-block.tsx:12`
(`overflow-hidden rounded-lg`) ve `before-after-slider-block.tsx:53` (`overflow-hidden rounded-lg`)
zaten AYNI sınıfı kullanıyor — "medya bloğu köşe yuvarlaklığı" için projede zaten yerleşik,
tutarlı bir kural var; harita üçüncüsü olarak buna katılıyor. Kullanıcıya bir radius seçici
SUNULMAZ (veri modelinde alan yok, §0 notu).

### 1.3 `mapStyle` — 4 sabit CSS `filter` değeri (Record look-up, ASLA template-literal)

Google Maps Embed iframe'inin İÇERİĞİ restyle edilemez (mimar R3) — dört "stil" tamamen
sarmalayıcı/`iframe` elemanının **kendi üzerine** uygulanan bir CSS `filter` zinciridir (klasik
"dark mode iframe" tekniği). `map-embed.ts` içinde **sabit** bir obje olarak tanımlanır
(security-review §4.3 zorunlu kılıyor — `mapStyle` değeri hiçbir template-literal'e enterpole
EDİLMEZ, yalnızca bu tablodan anahtar-değer okunur):

```ts
export const MAP_STYLE_FILTER: Record<GoogleMapStyle, string> = {
  standard: "none",
  dark: "invert(90%) hue-rotate(180deg) brightness(95%) contrast(90%)",
  silver: "grayscale(85%) brightness(1.08) contrast(0.95)",
  retro: "sepia(55%) saturate(140%) hue-rotate(-8deg) brightness(1.02) contrast(0.92)",
};
```

| `mapStyle` | Görsel etki | Uygulama noktası |
|---|---|---|
| `standard` | Google'ın varsayılan haritası, filtre YOK | `filter: "none"` |
| `dark` | Koyu-tema hissi (ters çevrilmiş parlaklık + hue düzeltme) — admin koyu temasıyla (`.dark .admin-shell`) görsel bir aile oluşturur ama ondan BAĞIMSIZ, blok verisine bağlı bir seçimdir | `invert` + `hue-rotate` ile yol/su renklerini yaklaşık doğru hue'ya geri döndürüp arka planı koyulaştırır |
| `silver` | Desatüre, gümüşi-nötr harita (Snazzy Maps "Silver" temasının yaklaşık CSS karşılığı) | ağırlıklı `grayscale` + hafif parlaklık/kontrast düzeltmesi |
| `retro` | Sıcak sepya tonlu "vintage harita" hissi | `sepia` + `saturate` + hafif `hue-rotate` |

**Uygulama kuralı (bağlayıcı, security-review §4.3):** `filter` değeri doğrudan `iframe` elemanının
inline `style.filter`'ına yazılır — `MAP_STYLE_FILTER[block.data.mapStyle ?? "standard"]` şeklinde
**yalnızca anahtar-değer okuma**; `` `filter: ${x}` `` gibi bir string enterpolasyonu YASAK.

**Editör kontrolü:** `SegmentedToggle` — 4 seçenek, etiketler: "Standart" / "Koyu" / "Gümüş" /
"Retro" (Türkçe kullanıcı metinleri, mevcut `RADIUS_OPTIONS`/`PROVIDER_OPTIONS` deseniyle aynı
`{ value, label }[]` şekli).

### 1.4 Diğer alanlar (editör düzeni)

`GoogleMapBlockEditor` (YENİ, `image-block.tsx`/`video-block.tsx` editör desenleriyle aynı iskelet
— `space-y-3` kök, `!simple &&` ile gelişmiş alanları sarmalama):

1. Mod seçici — `SegmentedToggle`: **"Adres" (varsayılan/ilk sekme, TERCİH EDİLEN mod — mimar
   §2.1)** / **"Yerleştirme Kodu"** (Mod A, `embedUrl`).
2. Mod "Adres" iken: `Field label="Adres"` (`Input`, `maxLength=300`) + `Field label="Yakınlaştırma
   (zoom)"` (`InputGroup` sayı, min=1 max=20, varsayılan 15). **Mod "Yerleştirme Kodu" iken zoom
   alanı TAMAMEN GİZLENİR** (disabled değil, DOM'dan kaldırılır) — mimar R4: bu modda zoom
   etkisizdir, görünür ama pasif bir alan "neden çalışmıyor" bug raporuna yol açar.
3. Mod "Yerleştirme Kodu" iken: `Field label="Google Haritayı Yerleştir kodu"` (`Textarea` veya
   `Input`, hint: "Google Haritalar → Paylaş → Haritayı yerleştir panelinden alınan bağlantı").
   Değer `key=` içeriyorsa (basit `.includes("key=")` kontrolü, regex değil — yalnızca UI uyarısı,
   güvenlik doğrulaması değil) **uyarı banner'ı** gösterilir:
   ```
   <div className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
     <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
     <span>Bu bağlantı bir API anahtarı içeriyor. Google Cloud Console'da anahtarı mutlaka
     HTTP referrer kısıtı ile sınırlandırın.</span>
   </div>
   ```
   Bu, `custom-html-block.tsx:11` ile **birebir aynı** sınıf/ikon (`ShieldAlert`) — yeni bir uyarı
   dili icat edilmedi, mevcut "güvenlik uyarısı" bileşen deseni tekrar kullanıldı (mimar §3.1'in
   istediği admin uyarısı bu).
4. §1.1'deki yükseklik kontrolü.
5. §1.3'teki `mapStyle` kontrolü.
6. `Field label="Harita başlığı (opsiyonel)"` (`Input`, `maxLength=120`, hint: "Erişilebilirlik
   için önerilir; boş bırakılırsa adres kullanılır.").

---

## §2 `accordion.layoutStyle` — üç varyant sınıf tablosu

**KRİTİK KISIT (doğrulandı — `accordion-block.tsx` ve `ui/accordion.tsx` okundu):** `bordered`
bugünkü render ile **piksel-eş** olmak zorunda. Bugünkü kod HİÇBİR className override'ı
GEÇMİYOR — yani `bordered` = `ui/accordion.tsx`'in kendi VARSAYILAN sınıflarının aynen
kullanılması (aşağıdaki tabloda `bordered` satırı bu yüzden "override yok" diyor).

Ortak (layoutStyle'dan bağımsız, DEĞİŞMEZ): dış sarmalayıcı `<section>` + `<div className="mx-auto
max-w-3xl">` — genişlik/hizalama üç varyantta da aynı kalır.

| Katman | `bordered` (varsayılan, piksel-eş) | `card` | `minimal` |
|---|---|---|---|
| `Accordion` (liste) | `flex flex-col gap-1` *(override yok — bileşenin kendi varsayılanı)* | `flex flex-col gap-3` | `flex flex-col divide-y divide-border/60` |
| `AccordionItem` | `overflow-hidden rounded-lg border border-border/60` *(override yok)* | `overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md` | `overflow-hidden` |
| `AccordionTrigger` ek class | *(override yok — `px-3 py-2.5 text-sm font-medium ... hover:bg-surface-muted`)* | `px-4 py-3.5 text-sm font-semibold` | `px-1 py-3 text-sm font-medium hover:bg-transparent` |
| `AccordionPanel` iç `<p>` | `px-3 pb-3 text-foreground/70` *(override yok)* | `px-4 pb-4 text-foreground/70` | `px-1 pb-3 text-foreground/60` |

**Uygulama notu (frontend-agent için):** `AccordionTrigger`'ın taban class'ı
(`ui/accordion.tsx:37-40`) `cn(baseClasses, className)` ile birleşiyor ve proje `tailwind-merge`
kullanıyor (`lib/utils.ts::cn`) — yani `minimal`'deki `hover:bg-transparent` taban class'taki
`hover:bg-surface-muted`'ı **doğru şekilde ezer** (aynı utility grubu, tailwind-merge çakışmayı
çözer), elle bir "hover'ı kaldır" hack'i gerekmez. `card`/`minimal` için `AccordionTrigger`'a
`className={ACCORDION_LAYOUT_CLASSES[layoutStyle].trigger}` geçilir; `bordered` için
`className` hiç geçilmez (undefined) — `cn(base, undefined)` taban class'ı aynen bırakır, bu
piksel-eş garantiyi kod seviyesinde de sağlar.

**Önerilen sabit tablo ismi:** `ACCORDION_LAYOUT_CLASSES: Record<AccordionLayoutStyle, { list: string; item: string; trigger: string; panelText: string }>` (`accordion-block.tsx` içinde, `RADIUS_CLASS`
(`image-block.tsx:8`) deseniyle aynı yerde/şekilde tanımlanır).

**Editör kontrolü:** `AccordionBlockEditor`'a `!simple` bloğunda bir `SegmentedToggle` eklenir —
`{ value: "bordered", label: "Çerçeveli" } | { value: "card", label: "Kart" } | { value: "minimal", label: "Minimal" }`.

---

## §3 `logo-marquee` grid modu + `grayscale` davranışı

### 3.1 Grid düzeni (responsive kolon kırılımları)

Veri modeline yeni alan EKLENMEZ (mimar §2.5) — kolon sayıları **sabit** bir Tailwind sınıf
zinciridir, `pricing-table-block.tsx::gridColsClass` desenine benzer ama burada dinamik değil
(logo sayısına göre DEĞİL, ekran genişliğine göre kırılır — "logo duvarı" bu şekilde beklenir):

```
grid grid-cols-2 items-center justify-items-center gap-8
sm:grid-cols-3 sm:gap-10
md:grid-cols-4
lg:grid-cols-6
mx-auto max-w-5xl
```

| Kırılım | Kolon | Gap |
|---|---|---|
| mobil (taban) | 2 | `gap-8` (32px) |
| `sm` (≥640px) | 3 | `gap-10` (40px) |
| `md` (≥768px) | 4 | `gap-10` |
| `lg` (≥1024px) | 6 | `gap-10` |

Her hücre: `flex h-14 w-full items-center justify-center` (dikey hizalama için sabit yükseklik
kutusu — farklı en-boy oranlı logoların taban çizgisi kaymasın diye, `pricing-table` kartlarındaki
`items-stretch` mantığıyla aynı "tutarlı hizalama" amacı). İçindeki `<LogoItem>` DEĞİŞMEZ (aynı
bileşen, `marquee`/`grid` her ikisinde de kullanılır — kod tekrarını önler).

`max-w-5xl` mevcut `marquee` sarmalayıcısıyla (`logo-marquee-block.tsx:31`) AYNI genişlik tavanı —
iki mod arasında geçişte içerik aniden çok daha geniş/dar görünmesin diye.

### 3.2 `grayscale` açık/kapalı görsel davranışı

Bugünkü hard-code (`logo-marquee-block.tsx:7`): `grayscale hover:grayscale-0 transition-all`.
Bu davranış **`grayscale ?? true` iken, HEM `marquee` HEM `grid` modunda AYNEN korunur** (görev
talimatı: "aynı hover davranışını grid modunda da koru"). `grayscale === false` olduğunda ise iki
mod da renkli gösterilir — ama tamamen etkisiz/cansız durmaması için hafif bir etkileşim ipucu
eklenir (yeni bir renk/ton İCAT EDİLMEDİ, mevcut opacity dilinden — bkz. `button.tsx`'in
`ghost`/disabled varyantlarında zaten kullanılan opacity-tabanlı hover dili):

| `grayscale` | Sınıf (hem `marquee` hem `grid`) |
|---|---|
| `true` / `undefined` (varsayılan, bugünkü) | `grayscale hover:grayscale-0 transition-all` |
| `false` | `opacity-90 hover:opacity-100 transition-opacity` |

`LogoItem`'ın `className` prop'u parametrik hale getirilir:
`cn("h-10 w-auto object-contain", grayscaleClass)` — `h-10 w-auto object-contain` sabit kalır
(logo boyutu moddan/`grayscale`'den bağımsız).

**Editör kontrolü:** `LogoMarqueeBlockEditor`'a `!simple` bloğunda: `SegmentedToggle`
(`displayMode`: "Bant (kayan)" / "Izgara") + `Switch` (`grayscale`, varsayılan `true`, label
"Siyah-beyaz göster"). `displayMode: "grid"` iken `speedSeconds`/`pauseOnHover` alanları
**gizlenir** (mimar §2.5 — veri KALIR, yalnızca UI'da gösterilmez), `SegmentedToggle`'ın hemen
altında koşullu render ile.

---

## §4 `video` lightbox — tetikleyici kart + modal kabuğu

Görsel/etkileşim dili `gallery-lightbox.tsx` ile TUTARLI: siyah zemin, beyaz kontrol butonları,
`base-ui` `Dialog` primitifleri, aynı `data-open:animate-in`/`data-closed:animate-out` geçiş
sınıfları. Yeni bir modal deseni İCAT EDİLMEDİ — mevcut lightbox'ın ikinci uygulaması.

### 4.1 Tetikleyici kart (`playStyle: "lightbox"`, `video-block.tsx` genişlemesi)

```tsx
<button
  type="button"
  aria-label="Videoyu oynat"
  className="group relative block w-full overflow-hidden rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
>
  <div className="relative aspect-video w-full bg-black">
    {coverUrl && (
      // eslint-disable-next-line @next/next/no-img-element -- image-block.tsx ile AYNI gerekçe
      <img
        src={coverUrl}
        alt=""
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
    )}
    <div className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/30" />
    <span className="absolute inset-0 flex items-center justify-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-foreground shadow-lg transition-transform duration-200 group-hover:scale-110 group-hover:bg-white">
        <Play className="h-6 w-6 translate-x-0.5 fill-current" />
      </span>
    </span>
  </div>
</button>
```

| Öğe | Değer | Kaynak/gerekçe |
|---|---|---|
| Dış köşe | `rounded-lg` | §1.2'deki "medya bloğu = `rounded-lg`" kuralıyla tutarlı (video/before-after/harita üçlüsü) |
| Odak halkası | `focus-visible:ring-3 focus-visible:ring-ring/50` | `image-block.tsx:36` lightbox tetikleyicisiyle BİREBİR aynı — yeni bir odak dili icat edilmedi |
| Oynat rozeti boyutu | `h-16 w-16` (64px) daire, ikon `h-6 w-6` (24px) | WCAG 2.5.8 hedef boyutu tavsiyesinin (24px asgari) üzerinde, `image-block.tsx`'in radius ölçeğiyle orantılı |
| İkon | `Play` (lucide-react), `fill-current`, `translate-x-0.5` ile optik ortalama | Projede zaten yerleşik "oynat" ikonu (`advanced-slider.tsx`, `hero-studio/timeline.tsx`, `social-platform-icons.ts::YOUTUBE`) — yeni bir ikon icat edilmedi |
| Kapak yoksa | Görsel YOK, yalnızca `bg-black` + ortadaki oynat rozeti | mimar §2.6: "boş render EDİLMEZ" |

### 4.2 Modal kabuğu

`gallery-lightbox.tsx`'in `Backdrop`/`Popup`/`Close` üçlüsünün ikinci uygulaması — prev/next YOK
(tek video), `Backdrop`/`Close` sınıfları BİREBİR kopya:

```tsx
<DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
<DialogPrimitive.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none sm:p-10 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0">
  <DialogPrimitive.Title className="sr-only">Video</DialogPrimitive.Title>
  <DialogPrimitive.Close
    aria-label="Kapat"
    className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black text-white shadow-sm outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:right-6 sm:top-6"
  >
    <X className="h-5 w-5" />
  </DialogPrimitive.Close>
  <div className="aspect-video w-full max-w-4xl overflow-hidden rounded-lg bg-black shadow-2xl">
    {/* iframe (provider) veya <video> (mp4) — video-block.tsx'in mevcut embed mantığı aynen kullanılır */}
  </div>
</DialogPrimitive.Popup>
```

| Öğe | Değer | Kaynak/gerekçe |
|---|---|---|
| Backdrop | `bg-black` + aynı `data-open`/`data-closed` geçişleri | `gallery-lightbox.tsx:92` ile BİREBİR |
| Kapat butonu | `gallery-lightbox.tsx`'teki `CONTROL_BUTTON_CLASS` ile BİREBİR aynı sınıf dizisi | tutarlılık — frontend-agent bu sabiti `gallery-lightbox.tsx`'ten **export edip yeniden kullanmalı** (kopyalamak yerine), iki ayrı kaynak drift riskini önler |
| İçerik genişlik tavanı | `max-w-4xl` (896px) | görsel lightbox'ın aksine (`max-h-full max-w-full` — görsel kendi oranında büyür), video `aspect-video` ile sabit orana kilitli olduğu için sınırsız genişlik aşırı büyük/bulanık görünürdü; `max-w-4xl` tipik `<iframe>` embed önerilen genişliğiyle (1280x720 kaynak çözünürlüğüne yakın) orantılı |
| Köşe | `rounded-lg` | §1.2 kuralı ile tutarlı |
| `Title` | `sr-only` "Video" | `gallery-lightbox.tsx:97-99`'un erişilebilirlik gerekçesiyle aynı — görünmez ama ekran okuyucu için zorunlu diyalog başlığı |

`autoplay` kuralı (görsel değil davranış kararı, ama not düşülüyor): modal açıldığında video
otomatik oynatılması **beklenir** (`playStyle: "lightbox"`in tüm amacı budur) — bu,
`video-embed.ts`'e eklenecek `loop` parametresiyle aynı yerde, `autoplay`/`muted` parametreleriyle
uygulanır (frontend-agent implementasyon detayı, ui-designer kapsamı dışı).

---

## §5 İkon eşlemesi — ONAYLANDI

Mimar §4.4'ün önerdiği eşleme aynen onaylanıyor, değişiklik YOK:

| type | ikon | Gerekçe (ui-designer notu) |
|---|---|---|
| `google-map` | `MapPin` | Standart, evrensel "konum" piktogramı — alternatif aranmadı |
| `before-after-slider` | `Columns2` | `SplitSquareHorizontal`'dan daha sade/okunur "iki sütun" ikonografisi, aynı semantik alanda |
| `accordion` | `HelpCircle` | "SSS" kullanım amacını `ListCollapse`'dan (jenerik akordiyon) daha doğrudan iletiyor |
| `pricing-table` | `CreditCard` | Ödeme/fiyatlandırma semantiği `Tag`'dan (jenerik etiket) daha güçlü |
| `logo-marquee` | `Building2` | "Kurumsal/marka referansları" semantiği `Infinity`dan (yalnızca "sürekli akış" ima ediyordu) daha net |
| `video` | `Video` | Değişmez |

Tüm ikonlar `lucide-react` — tek kaynak korunuyor, farklı bir ikon seti karıştırılmadı. Türkçe
`label` metinleri (`registry.ts:49-75`) DEĞİŞMEZ — yalnızca `icon` alanı güncellenir.

---

## §6 Kart-içi mini önizleme yerleşimi (§4.3 mimar kararı — yeni çekmece/modal YOK)

**Ortak görsel dil (4 blok için de aynı "önizleme kutusu" kalıbı):** proje zaten
`ImageUploadField`'da (`image-upload-field.tsx:84-97`) bu deseni kullanıyor —
`rounded-md border border-border bg-muted` kutusu, içerik yokken hiç render edilmez
(`{value && <preview/>}`). Dört blok da bu **aynı kutu diline** oturtulur, yalnızca yükseklik
farklılaşır. Konum kuralı: önizleme her editörün **en üstünde**, form alanlarından ÖNCE
(`ImageUploadField`'ın "önce önizleme, sonra kontrol" sırasıyla tutarlı).

| Blok | Kutu boyutu | İçerik | Koşul |
|---|---|---|---|
| `google-map` | `h-[180px] w-full` | Canlı `<iframe>` (aynı `mapStyle` filter + güvenlik nitelikleriyle — §1.3/security-review §4.1) | `embedUrl` (geçerli) VEYA `address` doluyken |
| `before-after-slider` | `p-3` içinde ince şerit | Pozisyon göstergesi (aşağıda §6.1) | her zaman (varsayılan %50) |
| `logo-marquee` | `h-20 w-full` | Küçültülmüş logo şeridi, güncel `grayscale`/`displayMode` sınıflarıyla (aşağıda §6.2) | `items.length > 0` |
| `video` | `h-32 w-full` | `coverUrl` küçük resmi | `ImageUploadField`'ın KENDİ önizlemesi ZATEN bunu sağlıyor — `coverUrl` alanı `ImageUploadField` ile toplanırsa AYRI bir önizleme bileşeni GEREKMEZ |

Ortak sınıf: `overflow-hidden rounded-md border border-border bg-muted` (`google-map`/`logo-marquee`
için `h-[180px]`/`h-20` yükseklik farkı dışında birebir aynı kutu — `ImageUploadField`'ın
`rounded-md` (değil `rounded-lg`) kullanması BİLİNÇLİ: admin önizleme kutuları her zaman
`rounded-md` (mevcut admin konvansiyonu), public render'daki blok gövdeleri `rounded-lg` (§1.2) —
iki farklı bağlamın kasıtlı farklı token'ları, tutarsızlık değil).

### 6.1 `before-after-slider` pozisyon şeridi

```tsx
<div className="space-y-1.5 rounded-md border border-border bg-muted p-3">
  <p className="text-xs font-medium text-foreground/60">Başlangıç pozisyonu: %{position}</p>
  <div className="relative h-2 w-full overflow-hidden rounded-full bg-border/60">
    <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width]" style={{ width: `${position}%` }} />
  </div>
</div>
```
`position = block.data.initialSliderPosition ?? 50`. Bar/dolgu dili `skill-bar` bloğunun
`--pb-skill-percent` dolum çubuğuyla AYNI görsel aile (ince çubuk + `bg-primary` dolgu), yeni bir
"progress" bileşeni icat edilmedi.

### 6.2 `logo-marquee` anlık önizleme

```tsx
<div className="flex h-20 w-full items-center gap-4 overflow-x-auto overflow-y-hidden rounded-md border border-border bg-muted px-3">
  {items.map((item) => (
    // eslint-disable-next-line @next/next/no-img-element -- AYNI gerekçe
    <img key={item.id} src={item.url} alt="" className={cn("h-8 w-auto shrink-0 object-contain", grayscaleClass)} />
  ))}
</div>
```
`grayscaleClass` §3.2 tablosundaki AYNI değişken — önizleme kutusu gerçek render sınıflarını
(küçültülmüş `h-8` ölçeğinde, `h-10` yerine) kullanır ki `grayscale` anahtarının etkisi editörde
gerçek zamanlı görülsün. `displayMode` bu önizlemeyi DEĞİŞTİRMEZ (marquee/grid ayrımı yalnızca
genel düzeni etkiler, tek satır önizleme her iki modda da yeterlidir — animasyon/grid simülasyonu
GEREKMEZ, amaç yalnızca `grayscale` görsel etkisini doğrulamaktır).

### 6.3 `google-map` canlı önizleme

180px'lik kutu, `map-embed.ts::getMapEmbedUrl` çıktısı geçerliyse gerçek bir `<iframe>` render
eder — `loading="lazy"` **verilmez** burada (görünür/aktif bir editör alanı, ertelemenin faydası
yok), diğer TÜM güvenlik nitelikleri (`sandbox`, `referrerPolicy`, `title`) security-review §4.1
uyarınca public render ile **AYNEN** kullanılır (security-review §4.1 "iki ayrı kod yolu farklı
sandbox'la yazılamaz" kuralı burada da geçerli). `mapStyle` filtresi de uygulanır — kullanıcı stil
değiştirdiğinde önizleme anında değişir.

### 6.4 `video` kapak önizlemesi

Ayrı bir bileşen GEREKMEZ: `VideoBlockEditor`'daki `coverUrl` alanı `ImageUploadField` ile
toplanırsa (§1.4'teki `Field`+`Input` yerine), `image-upload-field.tsx:84-97`'nin KENDİ
`h-32 w-full ... rounded-md border border-border bg-muted` önizlemesi otomatik olarak devreye
girer — mimar §4.3'ün istediği "kart içi mini önizleme" burada sıfır ek kod ile karşılanmış olur.

---

## §7 Özet — frontend-agent'ın uygulaması gereken somut isimler

- `MAP_STYLE_FILTER: Record<GoogleMapStyle, string>` (`map-embed.ts`)
- `GOOGLE_MAP_UI_MIN_HEIGHT_VH = 10` (yeni UI-only sabit, `types.ts`)
- `google-map-block.tsx` (public) sarmalayıcı: `rounded-lg overflow-hidden`
- `ACCORDION_LAYOUT_CLASSES: Record<AccordionLayoutStyle, {list,item,trigger,panelText}>` (`accordion-block.tsx`) — `bordered` alanları `undefined`/override'sız
- `logo-marquee` grid: `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-8 sm:gap-10 items-center justify-items-center mx-auto max-w-5xl`
- `grayscale` sınıf çifti: `grayscale hover:grayscale-0 transition-all` / `opacity-90 hover:opacity-100 transition-opacity`
- video lightbox tetikleyici + modal sınıfları (§4.1/§4.2) — `CONTROL_BUTTON_CLASS`'ı `gallery-lightbox.tsx`'ten export edip yeniden kullan
- İkonlar: `MapPin`/`Columns2`/`HelpCircle`/`CreditCard`/`Building2`/`Video` (`registry.ts`)
- Mini önizleme ortak kutu sınıfı: `overflow-hidden rounded-md border border-border bg-muted`
