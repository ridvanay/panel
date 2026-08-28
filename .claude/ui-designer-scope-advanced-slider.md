design-notes: Gelişmiş Slider / Hero Studio — ui-designer tasarım tokenleri

**Durum:** BAĞLAYICI tasarım kararı. Kapsam: `.claude/architect-scope-advanced-slider.md` §6.6'da
ui-designer'a devredilen 4 madde: (1) slider navigasyon kroması, (2) `SliderLayerStyle.shadow`
token tablosu, (3) katman butonu varyantlarının `--site-*` ile ilişkisi, (4) Hero Studio admin
düzeni + seçim/sürükleme göstergeleri + zaman çizelgesi görsel dili. **Kod implementasyonu YOK** —
bu doküman token adı/değeri + "nerede nasıl kullanılır" eşlemesidir, uygulayan frontend-agent'tır.

**Görsel yön:** Proje **Minimal/Flat** (bkz. `.claude/design-notes-appearance-studio.md` — "Proje
Minimal/Flat — düz `bg-surface`/`border-border` kartlar, yüksek kontrast, sade border'lar").
Bu doküman o kararı **KIRMAZ**. Aşağıdaki iki bilinçli istisna, ikisi de projede zaten var olan
emsallere dayanır, yeni bir "glow/gradient" estetiği İCAT ETMEZ:

- **Slider navigasyon kroması** (ok/bullet/progress) fotoğraf/video üzerinde durur ve okunabilirlik
  için yarı-saydam + `backdrop-blur-sm` kullanır — bu, `page-header.tsx`'in zaten onaylı
  `bg-black/60 backdrop-blur-sm` "okunabilirlik pill'i" (bkz. `design-notes-appearance-studio.md`
  §1.1) ile AYNI, tek istisnai kategori: **görsel/video üzerine duran yüzen kontroller**.
- **Hero Studio'nun tuval + zaman çizelgesi kromu** next-themes'ten bağımsız sabit koyudur —
  `accent-color-picker.tsx`'in `bg-[#14141d]` sabit-koyu popover'ıyla AYNI gerekçe (medya/renk
  değerlendirmesi yapılan araç yüzeyleri uygulama temasından etkilenmez; video/foto düzenleyicilerin
  evrensel konvansiyonu).

Geri kalan HER ŞEY (üst çubuk, slayt şeridi, sağ müfettiş sekmeleri) standart admin-shell
token'larını (`bg-surface`, `border-border`, `admin-h1/h2/h3`, next-themes açık/koyu) kullanır —
`/admin/pages/[pageId]` (page-builder) ve `/admin/appearance` ile AYNI dil.

Tüm ham CSS değerleri `frontend/src/app/globals.css`'e eklendi (dosya sonu, "Gelişmiş Slider /
Hero Studio" bloğu) — bu doküman o token'ları **tüketim yeriyle** eşler.

---

## §1 `SliderLayerStyle.shadow` token tablosu

Backend Zod: `shadow: z.enum(["none","sm","md","lg"])` (bkz. architect-scope §3.2). Katman
JSON'undan gelen dinamik değer olduğu için Tailwind class'ı ÜRETİLEMEZ — `slide-layer.tsx` bu
değeri `style.boxShadow` inline'ına yazar. Değerler Tailwind'in **projede zaten kullanılan**
`shadow-sm`/`shadow-md`/`shadow-lg` ölçeğiyle (bkz. `components/ui/card.tsx`) **BİREBİR** —
yeni bir elevation sistemi yok.

| Zod değeri | CSS custom property (`globals.css`) | Gerçek `box-shadow` |
|---|---|---|
| `"none"` | `var(--slider-layer-shadow-none)` | `none` |
| `"sm"` | `var(--slider-layer-shadow-sm)` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` |
| `"md"` | `var(--slider-layer-shadow-md)` | `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` |
| `"lg"` | `var(--slider-layer-shadow-lg)` | `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -2px rgb(0 0 0 / 0.1)` |

**Kullanım (`slide-layer.tsx`, public render):**
```ts
const SHADOW_VAR: Record<NonNullable<LayerStyle["shadow"]>, string> = {
  none: "var(--slider-layer-shadow-none)",
  sm: "var(--slider-layer-shadow-sm)",
  md: "var(--slider-layer-shadow-md)",
  lg: "var(--slider-layer-shadow-lg)",
};
// style.boxShadow = layer.style.shadow ? SHADOW_VAR[layer.style.shadow] : undefined;
```
`shadow` yalnızca `image`/`button`/`badge` katmanlarında görsel anlam taşır (heading/text
katmanlarında da teknik olarak uygulanabilir ama admin müfettişinde bu iki tip için alan
GİZLENMESİ önerilir — boş kutu gölgesi düz metinde anlamsız görünür). Bu bir öneri, Zod şeması
kısıtlamıyor.

---

## §2 Slider navigasyon kroması — `SliderNavigationTheme` LIGHT/DARK

**Kritik okuma notu:** `SliderNavigationTheme` enum'ı **slayt zemininin** açık/koyu olduğunu
söyler, kromanın kendi rengini DEĞİL (bkz. Prisma şema yorumu, architect-scope §2.5). Yani:

- `navigationTheme: "LIGHT"` → slayt zemini **açık** → kroma **KOYU** olmalı (`onlight-*` token'ları)
- `navigationTheme: "DARK"` → slayt zemini **koyu** → kroma **AÇIK** olmalı (`ondark-*` token'ları)

Tüm token'lar `globals.css` `:root`'ta tanımlı (herhangi bir sarmalayıcı gerekmez, public sayfada
doğrudan kullanılabilir).

### 2.1 Ok butonları (prev/next)

| Özellik | Değer |
|---|---|
| Boyut | `44px × 44px` (WCAG 2.5.8 hedef boyutu + gerçek `<button>`, architect §5.4) |
| Şekil | `border-radius: 9999px` (tam daire) |
| Konum | `absolute`, dikey ortalanmış (`top: 50%; transform: translateY(-50%)`) |
| Kenar boşluğu | mobil `16px` slider kenarından, `sm:` (≥640px) `24px` |
| Blur | `backdrop-filter: blur(4px)` (Tailwind `backdrop-blur-sm` ile birebir — proje emsali) |
| İkon | `lucide-react` `ChevronLeft`/`ChevronRight`, `20px` |
| Geçiş | `transition: background-color 200ms, transform 200ms` |
| Hover | `scale(1.05)` |

**LIGHT tema (açık zemin → koyu kroma):**
```css
background: var(--slider-nav-onlight-bg);       /* rgb(255 255 255 / 0.85) */
color: var(--slider-nav-onlight-fg);            /* #18181b */
border: 1px solid var(--slider-nav-onlight-border); /* rgb(0 0 0 / 0.08) */
box-shadow: var(--slider-layer-shadow-sm);
/* hover */
background: var(--slider-nav-onlight-bg-hover); /* rgb(255 255 255 / 1) */
```

**DARK tema (koyu zemin → açık kroma):**
```css
background: var(--slider-nav-ondark-bg);        /* rgb(0 0 0 / 0.35) */
color: var(--slider-nav-ondark-fg);              /* #ffffff */
border: 1px solid var(--slider-nav-ondark-border); /* rgb(255 255 255 / 0.15) */
box-shadow: var(--slider-layer-shadow-sm);
/* hover */
background: var(--slider-nav-ondark-bg-hover);   /* rgb(0 0 0 / 0.55) */
```

**Odak:** `:focus-visible { outline: none; box-shadow: var(--slider-media-focus-ring); }` — bu,
projenin global `:focus-visible { outline: 2px solid var(--primary); }` kuralından (`globals.css`
`@layer` DIŞI, ProseMirror örneğindeki AYNI teknikle) **daha spesifik bir seçiciyle** override
edilir (ör. `.advanced-slider :focus-visible`). Gerekçe: `--primary` admin/sabit indigo tonudur,
public sayfada `--site-primary`'den bağımsızdır ve fotoğraf üzerinde kaybolabilir; `--slider-
media-focus-ring` iki katmanlı (koyu iç + açık dış halka) olduğu için HER fotoğrafta görünür kalır.

### 2.2 Bullet'lar (sayfa göstergeleri)

| Durum | Boyut | Şekil |
|---|---|---|
| Pasif | `8px × 8px` | `border-radius: 9999px` (daire) |
| Aktif | `24px × 8px` | `border-radius: 9999px` (hap/pill) |

Aralık: `gap: 8px`. Geçiş: `width 250ms ease, background-color 250ms ease`.

**Renk:** Pasif bullet nötr kromadan (`onlight`/`ondark` fg rengi, düşük opaklık); **aktif bullet
markanın rengini taşır** — `advanced-slider.tsx` her zaman `.site-scope` içinde render edildiği
için `var(--site-primary, var(--slider-nav-active-fallback))` kullanılır:

```css
/* pasif — LIGHT tema */
background: rgb(0 0 0 / 0.25);
/* pasif — DARK tema */
background: rgb(255 255 255 / 0.35);
/* aktif — HER İKİ temada */
background: var(--site-primary, var(--slider-nav-active-fallback));
```

`<button>` gerçek element, `aria-label="{i}. slayta git"` + `aria-current="true"` (architect §5.4)
— odak halkası oklarla AYNI `var(--slider-media-focus-ring)`.

### 2.3 İlerleme çubuğu (autoplay progress)

| Özellik | Değer |
|---|---|
| Konum | `absolute; bottom: 0; left: 0; right: 0;` (slider'ın alt kenarına yapışık) |
| Yükseklik | `3px` |
| Köşe | `0` (tam genişlik, köşe yuvarlama YOK — kenardan kenara) |
| Track rengi (LIGHT) | `var(--slider-nav-onlight-track-bg)` → `rgb(0 0 0 / 0.12)` |
| Track rengi (DARK) | `var(--slider-nav-ondark-track-bg)` → `rgb(255 255 255 / 0.25)` |
| Dolgu rengi | `var(--site-primary, var(--slider-nav-active-fallback))` (bullet'larla AYNI kaynak) |
| Animasyon | `width` doğrusal, `Slide.durationMs ?? Slider.intervalMs` süresinde 0→100%, slayt değişince sıfırlanır |

`prefers-reduced-motion: reduce` → geçiş anlık (architect §5.5), track yine görünür kalır (yalnızca
otomatik ilerleme durur, buton üzerinden manuel geçişte dolu/boş anlık atlar).

---

## §3 Katman butonu varyantları — `--site-*` ile ilişki

Backend Zod (`button` katman tipi, architect §3.2): `variant: "solid"|"outline"|"ghost"`,
`size: "sm"|"md"|"lg"`. Bu, `frontend/src/components/site/site-header.tsx`'teki mevcut
`SiteButtonStyle` (`SOLID`/`OUTLINE`/`SOFT`, sitenin GENEL CTA/menü butonu ayarı) ile **AYNI
`--site-button`/`--site-button-text`/`--site-radius` token'larını tüketir** ama AYRI bir enum'dur
(katman başına seçilebilir, sitenin genel `buttonStyle` ayarından bağımsız) — `ghost` varyantı
`SiteButtonStyle`'da YOK, burada yeni tanımlanıyor.

**Karar: `solid`/`outline` mevcut `SITE_BUTTON_STYLE_CLASSES` (`site-header.tsx`) ile birebir aynı
görsel dili kullanır** (yeni bir renk kararı ÜRETİLMEDİ), `ghost` aynı ailenin üçüncü, daha sessiz
üyesi olarak eklenir:

```ts
// frontend/src/lib/sliders/design-tokens.ts (YENİ dosya, ui-designer kararı — frontend-agent oluşturur)
export const SLIDER_BUTTON_VARIANT_CLASS: Record<"solid" | "outline" | "ghost", string> = {
  // site-header.tsx SITE_BUTTON_STYLE_CLASSES.SOLID ile BİREBİR
  solid: "bg-[var(--site-button)] text-[var(--site-button-text)] hover:opacity-85",
  // site-header.tsx SITE_BUTTON_STYLE_CLASSES.OUTLINE ile BİREBİR
  outline:
    "border-2 border-[var(--site-button)] bg-transparent text-[var(--site-button)] hover:bg-[var(--site-button)]/10",
  // YENİ — SiteButtonStyle'da yok, aynı ailenin en sessiz üyesi (admin Button'ın `ghost`
  // varyantındaki "sadece hover'da zemin belirir" mantığıyla AYNI, bkz. components/ui/button.tsx)
  ghost: "bg-transparent text-[var(--site-button)] hover:bg-[var(--site-button)]/10",
};
```

**Köşe yuvarlaklığı — HER ÜÇÜ de `var(--site-radius)`** (site-header.tsx yorumundaki "Köşe
yuvarlaklığı her üçünde de ortak `rounded-[var(--site-radius)]`" kararıyla AYNI, yeni bir radius
kararı ÜRETİLMEDİ): `border-radius: var(--site-radius)`.

**Geçiş:** `transition: opacity 300ms, background-color 300ms` — `hover:opacity-85` deseni
projede `contact-form.tsx`/`cookie-consent-banner.tsx`/`legal-document-notice.tsx`/
`back-to-top-button.tsx`'in HEPSİNİN kullandığı `--site-button` hover konvansiyonu, burada da
AYNEN uygulanır (yeni bir hover dili İCAT EDİLMEDİ).

### 3.1 Boyut ölçeği (`sm`/`md`/`lg`)

Admin `Button`'ın `buttonVariants` ölçeği (`h-7`/`h-8`/`h-9`) BİLİNÇLİ OLARAK kullanılmaz —
o admin araç-çubuğu boyutlarıdır, katman butonu bir **hero/pazarlama CTA'sı**dır ve görsel ağırlık
gerektirir (Slider Revolution vb. araçların hero butonları admin butonlarından belirgin şekilde
büyüktür). 4/8px spacing ölçeğinde YENİ, amaca özel bir ölçek:

| `size` | Padding | Font boyutu | Font ağırlığı | Yaklaşık yükseklik | İkon boyutu (opsiyonel `icon`) |
|---|---|---|---|---|---|
| `sm` | `8px 16px` (`py-2 px-4`) | `14px` | `600` (semibold) | `~36px` | `16px`, `gap: 8px` |
| `md` | `12px 24px` (`py-3 px-6`) | `16px` | `600` | `~48px` | `18px`, `gap: 8px` |
| `lg` | `16px 32px` (`py-4 px-8`) | `18px` | `600` | `~56px` | `20px`, `gap: 8px` |

```ts
export const SLIDER_BUTTON_SIZE_CLASS: Record<"sm" | "md" | "lg", string> = {
  sm: "px-4 py-2 text-sm gap-2",
  md: "px-6 py-3 text-base gap-2",
  lg: "px-8 py-4 text-lg gap-2",
};
```

**Odak:** katman butonu da fotoğraf/video üzerinde durabilir (slaytın arka planı) — §2.1'deki AYNI
`var(--slider-media-focus-ring)` kullanılır, admin `--primary` tabanlı global `:focus-visible`
KURALINA GÜVENİLMEZ (aynı gerekçe: fotoğraf üzerinde kaybolabilir).

### 3.2 `LayerStyleSchema.fontFamily` eşlemesi (bonus netlik — Zod şemasında var, token karşılığı belirsizdi)

`fontFamily: z.enum(["inherit","heading","body"])` (architect §3.2) şu CSS'e karşılık gelir:

```ts
export const LAYER_FONT_FAMILY_VAR: Record<"inherit" | "heading" | "body", string | undefined> = {
  inherit: undefined,               // font-family YAZILMAZ, .site-scope'un body fontunu miras alır
  heading: "var(--site-heading-font)",
  body: "var(--site-body-font)",
};
```

---

## §4 Hero Studio admin düzeni — `/admin/sliders/[id]`

Architect §6.5'teki 5 bölge için somut grid/flex spesifikasyonu. Referans alınan mevcut desenler:
`frontend/src/app/admin/pages/[pageId]/page.tsx` (sticky araç çubuğu + canvas/inspector split) ve
`AdminTopbar` (global `h-14` sabit yükseklik, `sticky top-0 z-10`).

### 4.1 İskelet

```tsx
<div className="flex h-[calc(100vh-56px)] flex-col overflow-hidden"> {/* 56px = AdminTopbar (h-14) */}

  {/* BÖLGE 1 — Üst çubuk. pages/[pageId]/page.tsx ile AYNI sticky desen. */}
  <div className="sticky top-14 z-20 flex h-14 shrink-0 items-center justify-between gap-3
                  border-b border-border bg-surface/95 px-4 backdrop-blur">
    {/* sol: slider adı (admin-h3, inline-editable) */}
    {/* orta: cihaz toggle (Monitor/Tablet/Smartphone — page-builder DeviceMode, yeniden kullanılır) */}
    {/* sağ: "Önizle/Oynat" (ghost) + "Kaydet" (default) */}
  </div>

  <div className="flex flex-1 overflow-hidden">

    {/* BÖLGE 2 — Slayt şeridi. Genişlik `w-64` (256px) — appearance.tsx TabsList (`lg:w-64`) ve
        media.tsx klasör paneli (`lg:w-64`) ile AYNI sidebar ölçüsü, yeni bir genişlik İCAT EDİLMEDİ. */}
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-surface-muted/40 p-3">
      {/* @dnd-kit ile sıralanabilir slayt kartları, dikey liste, gap-2 (8px) */}
    </aside>

    <div className="flex flex-1 flex-col overflow-hidden">

      {/* BÖLGE 3 — Canlı tuval. Sabit koyu "stüdyo" kromu — bkz. §5 gerekçe. */}
      <div className="hero-studio-stage flex flex-1 items-center justify-center overflow-auto p-8"
           style={{ background: "var(--hs-stage-bg)" }}>
        {/* boyutlandırılmış slayt kutusu, §4.3 */}
      </div>

      {/* BÖLGE 5 — Zaman çizelgesi. Sabit yükseklik `h-48` (192px, 4/8px ölçeğiyle uyumlu). */}
      <div className="hero-studio-stage h-48 shrink-0 overflow-hidden border-t"
           style={{ background: "var(--hs-panel-bg)", borderColor: "var(--hs-panel-border)" }}>
        {/* §6 */}
      </div>
    </div>

    {/* BÖLGE 4 — Sekmeli müfettiş. Genişlik `380px` — pages/[pageId]/page.tsx'in
        `grid lg:grid-cols-[1fr_380px]` sağ paneliyle AYNI ölçü. */}
    <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-border bg-surface p-4">
      {/* <Tabs><TabsList variant="line">Slayt · Katman · Animasyon · Slider</TabsList></Tabs>
          variant="line" appearance/page.tsx ile AYNI tab stili */}
    </aside>
  </div>
</div>
```

### 4.2 Bölge detayları

- **Bölge 1 (Üst çubuk):** yükseklik `56px` (`h-14`), `sticky top-14` (AdminTopbar'ın hemen
  altına yapışır — `pages/[pageId]/page.tsx`'teki BİREBİR aynı `top-14 z-20` değeri, iki panel
  çakışmaz). Cihaz toggle `page-builder`'daki segmented-control deseni (`rounded-md border
  border-border/60 bg-surface-muted p-0.5`, aktif buton `bg-surface shadow-sm`).
- **Bölge 2 (Slayt şeridi):** her slayt kartı `aspect-video` (16:9) küçük önizleme + `label` +
  `isActive` anahtarı (`Switch`, admin bileşeni) + sürükleme tutamaç ikonu `GripVertical`
  (`lucide-react` — nav-tree-row.tsx/gallery-block.tsx/email-canvas.tsx'in HEPSİNİN kullandığı
  drag-handle ikonu, yeni bir ikon İCAT EDİLMEDİ). Seçili slayt: `ring-2 ring-primary
  ring-offset-2 ring-offset-background` (builder-canvas.tsx'teki container seçim deseniyle
  BİREBİR aynı — §710-734). `isActive: false` slayt: `opacity-50` + küçük "Pasif" `Badge`
  (`variant` mevcut nötr/muted tonu).
- **Bölge 3 (Tuval):** iç kutu `Slider.heightMode`'a göre boyutlanır (`aspect-ratio` veya sabit
  `px`), `rounded-lg ring-1 ring-white/10 shadow-2xl overflow-hidden` — koyu stüdyo zemininden
  ayrışması için ince bir halo (Photoshop/Figma'nın tuval-üzerinde-tuval deseni). Mobil cihaz
  modunda kutu genişliği daralır (`max-w-[375px]`, page-builder'ın `device === "mobile"` dalıyla
  AYNI yaklaşım), tablet `max-w-[768px]`.
- **Bölge 4 (Müfettiş):** 4 sekme (`Tabs` `variant="line"`, appearance sayfasıyla BİREBİR aynı
  stil) — Slayt / Katman / Animasyon / Slider. Katman sekmesi hiçbir katman seçili değilken boş
  durum gösterir ("Tuvalde bir katman seçin"). Her alan grubunun yanında (responsive override
  varsa) küçük bir "bu cihazda geçersiz kılındı" rozeti — mevcut `Badge` bileşeni, `variant`
  nötr/`accent` tonu, + "Kaldır" linki (architect §6.5 bağlayıcı UX kuralı).
- **Bölge 5 (Zaman çizelgesi):** bkz. §6.

### 4.3 Canvas iç kutu — yükseklik modları

| `heightMode` | Uygulama |
|---|---|
| `FULL_SCREEN` | tuval içinde temsili yükseklik `min(70vh, stage yüksekliği - 64px)` (gerçek `100svh` YALNIZCA public sayfada geçerli — admin tuvali stage'e sığdırılmış bir ÖNİZLEMEDİR) |
| `CUSTOM_PX` | `heightPx` değeri `min(heightPx, stage yüksekliği - 64px)` ile sınırlanarak gösterilir, taşarsa dikey scroll |
| `ASPECT_RATIO` | `aspect-ratio: {w} / {h}` — tuval genişliği cihaz moduna göre daralır, yükseklik oranla hesaplanır |

---

## §5 Katman seçim/sürükleme göstergeleri (tuval üzerinde)

### 5.1 Seçim çerçevesi

Fotoğraf/video üzerinde durduğu için (page-builder'ın nötr gri tuvalinden FARKLI olarak) tek renkli
ince bir outline her arka planda okunmayabilir — iki katmanlı "halo" (koyu hairline + parlak accent
halka) kullanılır:

```css
box-shadow: 0 0 0 1px rgb(0 0 0 / 0.45), 0 0 0 3px var(--accent-500, #6366f1);
```

`--accent-500` admin'in dinamik Vurgu Rengi sistemidir (`accent-context.tsx` — kullanıcının seçtiği
accent rengiyle otomatik uyumlu, `sidebar.tsx`'in zaten kullandığı AYNI değişken), fallback `#6366f1`
(varsayılan indigo).

### 5.2 Tutamaçlar (resize handle)

Yalnızca `position.widthPercent`/`style.maxWidthPx` alanı olan katman tiplerinde (image/button/text/
badge — heading genişlik alanını nadiren kullanır ama şema izin veriyorsa aynı davranış) 4 köşe
tutamacı:

| Özellik | Değer |
|---|---|
| Boyut | `8px × 8px` (`w-2 h-2`) kare |
| Zemin | `#ffffff` (sabit beyaz — her arka planda görünür) |
| Kenarlık | `1.5px solid var(--accent-500, #6366f1)` |
| Gölge | `var(--slider-layer-shadow-sm)` |
| Konum | 4 köşe, merkez katman kutusunun dışına `-4px` taşırılmış |
| Cursor | köşeye göre `nwse-resize`/`nesw-resize` |

Katman GÖVDESİ tamamı sürüklenebilir (`cursor: grab`, sürüklerken `cursor: grabbing`) — ayrı bir
"taşı" ikonu/tutamacı GEREKMEZ, `xPercent`/`yPercent` yazan sürükleme davranışı architect §2.3/§6.5
zaten tuvalin kendisi üzerinden tanımlıyor.

### 5.3 Hizalama kılavuz çizgileri (snap guide)

Sürükleme sırasında katman, tuvalin merkezine veya başka bir katmanın kenarına hizalandığında:

```css
/* dikey/yatay kılavuz çizgisi */
background: var(--slider-snap-guide); /* #ec4899 — pink-500, mevcut semantik renklerden AYRI */
width: 1px;   /* dikey çizgi için */
height: 1px;  /* yatay çizgi için */
```

Kesişim noktasında `4px × 4px` dolu daire (`background: var(--slider-snap-guide)`), snap eşiği
`±6px` (sürükleme mesafesi bu eşik içindeyse çizgi belirir + değer o hizaya "yapışır"). Çizgi tuvalin
tam kenarından kenarına uzanır (`position: absolute; inset: 0` içinde tam genişlik/yükseklik).

**Neden pink-500 ve accent-500 değil:** seçim halkası (§5.1) accent tonunu kullanıyor; snap
kılavuzu FARKLI bir görsel kategori (geçici, sürükleme-anı geri bildirimi) olduğu için karışmaması
adına ayrı, sabit bir ton (`--slider-snap-guide`) kullanır — accent kullanıcı tarafından
özelleştirilebilir olduğu için (`accent-context.tsx`) bazı kullanıcı temalarında snap çizgisi ile
seçim halkası AYNI renge denk gelip ayırt edilemez hale gelirdi; sabit pink-500 bu riski ortadan
kaldırır.

---

## §6 Zaman çizelgesi (timeline) görsel dili

### 6.1 Yerleşim

`hero-studio-stage` kapsamlı (§4.1 Bölge 5), sabit koyu zemin (`var(--hs-panel-bg)`). İçerik iki
bölüm: üstte zaman cetveli (ruler), altta katman çubukları (bir satır = bir katman, sırasıyla
katmanların tuvaldeki z-index/oluşturulma sırası).

```
┌─────────────────────────────────────────────────────────┐
│  0s      0.5s      1s      1.5s      2s      2.5s    3s  │  ← cetvel, text-[11px] var(--hs-text-muted)
├─────────────────────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← katman 1 çubuğu (heading, indigo)
│      ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← katman 2 çubuğu (text, sky)
│              ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← katman 3 çubuğu (button, emerald)
└─────────────────────────────────────────────────────────┘
```

### 6.2 Zaman cetveli

Toplam genişlik = slaytın efektif süresi (`Slide.durationMs ?? Slider.intervalMs`). Tick aralığı:
toplam süre ≤ 4000ms ise her `500ms`, > 4000ms ise her `1000ms`. Etiket formatı `"0.5s"`/`"1s"`,
`text-[11px]` `color: var(--hs-text-muted)`.

### 6.3 Katman çubuğu

| Özellik | Değer |
|---|---|
| Satır yüksekliği | `32px` (`h-8`) |
| Satır arası boşluk | `4px` |
| Çubuk konumu | `left: {delayMs / toplamSüre * 100}%`, `width: {durationMs / toplamSüre * 100}%` |
| Çubuk yüksekliği | `24px` (satırın içinde dikey ortalanmış, `4px` üst/alt boşluk) |
| Köşe | `border-radius: 6px` (`rounded-md`) |
| Renk | katman tipine göre — §6.4 |
| Opaklık (seçili değilse) | `0.7` |
| Opaklık (seçiliyken) | `1` + `box-shadow: 0 0 0 2px #ffffff` (beyaz vurgu halkası, koyu zemin üzerinde net) |
| Sürüklenebilirlik | çubuğun kendisi yatayda sürüklenir → `delayMs` günceller; sağ kenarından sürükleme → `durationMs` günceller (resize) |

**Opaklık-ile-de-vurgu deseni** `builder-canvas.tsx`'in nesting-depth göstergesindeki (satır
555-558, derinlik arttıkça `bg-surface-muted/30 → /10` solması) AYNI fikrin uygulamasıdır — burada
"derinlik" yerine "seçili mi" ekseninde kullanılır, yeni bir görsel dil İCAT EDİLMEDİ.

### 6.4 Katman tipi renk kodlaması

Tuval üzerindeki seçim etiketi (küçük pill, katman tipini gösterir) İLE zaman çizelgesi çubuğu
**AYNI kaynağı** kullanır — tek yerden yönetilir:

```ts
export const SLIDER_LAYER_TYPE_COLOR: Record<"heading" | "text" | "button" | "image" | "badge", string> = {
  heading: "var(--slider-layer-type-heading)", // #6366f1 indigo-500
  text: "var(--slider-layer-type-text)",       // #0ea5e9 sky-500
  button: "var(--slider-layer-type-button)",   // #10b981 emerald-500
  image: "var(--slider-layer-type-image)",     // #f59e0b amber-500
  badge: "var(--slider-layer-type-badge)",     // #d946ef fuchsia-500
};
```

Renkler mevcut semantik tonlardan (`--danger`/`--warning`/`--success`, kırmızı/amber/yeşil)
**kasıtlı olarak farklı** Tailwind 500 tonları — "bu katman hata veriyor" ile "bu bir buton
katmanı" anlamlarının karışmaması için.

### 6.5 Oynatma göstergesi (playhead)

"Oynat" tıklandığında (architect §6.5 madde 5) dikey bir çizgi soldan sağa süpürür:

```css
position: absolute; top: 0; bottom: 0; width: 2px;
background: #ffffff;
box-shadow: 0 0 6px rgb(255 255 255 / 0.6); /* hafif glow — koyu zeminde iz sürmesi kolaylaşır */
```

Üstte küçük bir üçgen tutamaç (`4px` taban, `var(--hs-text)` rengi) cetvel çizgisinin tepesinde.
Süpürme animasyonu `durationMs` (efektif slayt süresi) boyunca `linear`, `prefers-reduced-motion:
reduce` altında da ÇALIŞIR (bu bir admin araç önizlemesidir, ziyaretçi sitesi değildir — §5.5'teki
azaltılmış hareket kuralı yalnızca PUBLIC render'a bağlayıcıdır).

---

## Kontrol Listesi (frontend-agent)

- [ ] `frontend/src/lib/sliders/design-tokens.ts` (YENİ dosya) — §3'teki
  `SLIDER_BUTTON_VARIANT_CLASS`, `SLIDER_BUTTON_SIZE_CLASS`, `LAYER_FONT_FAMILY_VAR`, §1'deki
  `SHADOW_VAR`, §6.4'teki `SLIDER_LAYER_TYPE_COLOR` sabitleri BİREBİR kopyalanır.
- [ ] `advanced-slider.tsx`/`slide-layer.tsx`: nav ok/bullet/progress §2'deki CSS custom
  property'leri (`--slider-nav-onlight-*` / `--slider-nav-ondark-*`) `Slider.navigationTheme`'e
  göre seçer; odak halkası HER YERDE `var(--slider-media-focus-ring)` (global `:focus-visible`
  kuralına GÜVENİLMEZ, `.advanced-slider :focus-visible` scoped override eklenir).
- [ ] `button` katman tipi `SLIDER_BUTTON_VARIANT_CLASS[variant]` + `SLIDER_BUTTON_SIZE_CLASS[size]`
  + `border-radius: var(--site-radius)` kullanır; `icon` alanı varsa `lucide-react`'ten
  `content.icon` string'i dinamik import/whitelist ile çözülür (bu kısım frontend-agent'ın
  implementasyon detayı, ui-designer yalnızca boyut/gap tanımlar).
- [ ] `layers` render'ında `style.shadow` → §1'deki `SHADOW_VAR` map'i ile `boxShadow` inline
  style'ına yazılır.
- [ ] Hero Studio sayfası (`/admin/sliders/[id]`) §4.1'deki 5 bölgeli iskeleti (BİREBİR class
  isimleri/genişlikler: `w-64` slayt şeridi, `w-[380px]` müfettiş, `h-48` zaman çizelgesi,
  `top-14 z-20` üst çubuk) uygular.
- [ ] Tuval + zaman çizelgesi kök sarmalayıcıları `hero-studio-stage` class'ını taşır (next-themes
  `.dark`'tan bağımsız sabit koyu kroma, §4.1/§4.2/§6.1).
- [ ] Slayt şeridi kartlarında seçim `ring-2 ring-primary ring-offset-2 ring-offset-background`
  (builder-canvas.tsx container seçim deseniyle BİREBİR), sürükleme tutamacı `GripVertical`
  ikonu.
- [ ] Tuval üzerinde seçili katman §5.1'deki iki-katmanlı `box-shadow` halo'yu, uygunsa §5.2'deki
  4 köşe tutamacını (8×8px beyaz kare + accent kenarlık) alır.
- [ ] Sürükleme sırasında hizalama tuttuğunda §5.3'teki `var(--slider-snap-guide)` (pink-500)
  çizgisi + 4px kesişim noktası gösterilir, snap eşiği ±6px.
- [ ] Zaman çizelgesi çubukları §6.3/§6.4'teki boyut/renk/opaklık kurallarına uyar; "Oynat"
  sırasında §6.5'teki playhead soldan sağa süpürür.
- [ ] `frontend/src/app/globals.css`'teki yeni `:root` blok (`--slider-layer-shadow-*`,
  `--slider-nav-*`, `--slider-media-focus-ring`, `--slider-snap-guide`, `--slider-layer-type-*`)
  ve `.hero-studio-stage` blok DEĞİŞTİRİLMEDEN kullanılır — yeni ham renk/gölge değeri İCAT
  EDİLMEZ, hepsi bu iki kaynaktan (`globals.css` + bu doküman) gelir.

---

## §7 Hero Studio'yu "tam görsel katman/animasyon stüdyosu"na genişletme (2026-08-28, ui-designer)

Kapsam: kullanıcı isteği "Slider Revolution düzeyinde tam görsel katman yönetimi ve animasyon
stüdyosu". Bu bölüm §4-§6'yı KIRMAZ — orada tanımlı Hero Studio iskeleti/tuval/zaman çizelgesi
kromu AYNEN korunur; burada yalnızca YENİ etkileşim kalıpları eklenir.

### §7.1 "Katman Ekle" çubuğu — tuvalin HEMEN ÜSTÜ, tek ve DAİMA görünür yer

Sağ panelin "Katman" sekmesine gömülü quick-add butonları KALDIRILIR — yalnızca o sekme açıkken
görünür olmaları keşfedilebilirliği düşürüyordu. Tek konum: orta sütunda, tuvalin (Bölge 3) HEMEN
ÜSTÜNDE, `border-b border-border bg-surface` (standart admin-shell chrome — `hero-studio-stage`
sabit-koyu kroma DEĞİL, çünkü bu bir ARAÇ ÇUBUĞU, tuvalin kendisi değil). Aynı çubukta, sağda,
hizalama butonları (§7.2) yer alır — ikisi "tuvalle ilgili DAİMA erişilebilir eylemler" ailesindedir.

Katman tipi butonları §6.4'teki `SLIDER_LAYER_TYPE_COLOR` ikonlarını KORUR (`outline` varyant,
`sm` boyut) — yalnızca YERİ değişti, görsel dili AYNI.

### §7.2 Hizalama butonları

4 buton (kullanıcının istediği BİREBİR küme): Sola Yasla, Yatayda Ortala, Sağa Yasla, Dikeyde
Ortala. `lucide-react`: `AlignHorizontalJustifyStart/Center/End`, `AlignVerticalJustifyCenter`
(v1.28'de MEVCUT). `variant="ghost" size="icon-sm"`, seçili katman YOKKEN `disabled` (tamamen
gizlemek yerine görünür-ama-pasif — kullanıcı "neden yok" değil "neden pasif" sorar, ikincisi
daha az şaşırtıcıdır). Bir dikey ayraç (`h-4 w-px bg-border`) yatay/dikey grupları ayırır.

Davranış: seçili katmanın `position.origin`'inin YALNIZCA ilgili ekseni değişir (diğer eksen
KORUNUR — `layer-render.ts::splitOrigin`/`joinOrigin`), `xPercent`/`yPercent` buna eşlenir
(`left→0`, `center→50`, `right→100`; `top→0`, `middle→50`, `bottom→100`). Cihaz override kuralı
(§6.5 architect, mevcut) AYNEN geçerlidir — tablet/mobil görünümdeyken yalnızca `responsive.
<device>.position` yazılır.

### §7.3 Tuval artık WYSIWYG — gerçek stilli içerik, etiket-pilli DEĞİL

Önceki tuval her katmanı küçük renkli bir "etiket pili" (yalnızca tip rengi + kısaltılmış metin)
olarak gösteriyordu. Artık katmanın GERÇEK stilini (`buildLayerContentStyle` — font boyutu/
rengi/kalınlığı/hizalaması/padding/gölge, `frontend/src/lib/sliders/layer-render.ts`, public
render ile PAYLAŞILAN kaynak) taşıyan gerçek `h1-3`/`p`/`span`/`img` render edilir — kullanıcı
tuvalde GERÇEKTEN nasıl görüneceğini görür. Buton/rozet public render'daki AYNI
`SLIDER_BUTTON_VARIANT_CLASS`/`SLIDER_BUTTON_SIZE_CLASS` sınıflarını kullanır (ama admin'de
gerçek `<a>` DEĞİLDİR — tıklanınca sayfadan çıkılmasın diye salt görsel bir `<span>`).

**Site teması sadakati:** tuval `.site-scope` class'ı içinde render edilir — bu, `globals.css`
`.site-scope` bloğundaki VARSAYILAN (`--site-primary: #4f46e5` vb.) değerleri devreye sokar.
Kullanıcının GERÇEK `SiteAppearance` ayarlarını canlı çekmek (appearance önizlemesinin yaptığı
gibi) BİLİNÇLİ OLARAK kapsam DIŞI bırakıldı — Hero Studio zaten "stage'e sığdırılmış bir
önizleme" (§4.3), pozisyon/tipografi/animasyon DOĞRULUĞU asıl amaç; marka rengi sadakati mevcut
"Önizle" (gerçek `AdvancedSlider` bileşeniyle tam ekran) modunda zaten sağlanıyor. İkisini
birleştirmek (SiteAppearance fetch'i) yeni bir admin API çağrısı + yükleme durumu eklerdi —
kazancı (tuvalde marka rengi doğru görünür) bu turun kapsamına göre orantısız.

### §7.4 Seçim halosu + yeniden boyutlandırma tutamaçları

§5.1/§5.2'de ZATEN speslenmiş halo (`0 0 0 1px rgb(0 0 0/0.45), 0 0 0 3px var(--accent-500,
#6366f1)`) ve 4 köşe tutamacı (8×8px beyaz kare, 1.5px accent kenarlık) AYNEN kullanılır — yeni
bir görsel dil YOK, yalnızca artık gerçek içerik kutusunun etrafında (etiket pili yerine).

**Yeniden boyutlandırma davranışı (basitleştirilmiş, bağlayıcı):** şema yalnızca `widthPercent`
taşır (bkz. architect §2.3, YENİ bir yükseklik/sol-sağ-ofset alanı EKLENMEZ). 4 tutamaç da AYNI
davranır — "merkezden simetrik yeniden boyutlandırma": tutamaç konumdan (`xPercent`) uzaklaştıkça
`widthPercent = |fare_x% - xPercent| × 2` olur. Bu, Figma/Photoshop'un tam serbest 2 eksenli
yeniden boyutlandırmasından BASİTTİR ama mevcut şemayla (tek `widthPercent` alanı) tutarlıdır —
yeni alan eklemek migration/API kontrat değişikliği gerektirirdi, bu turun kapsamı DIŞINDA.

### §7.5 Çift tıklama ile yerinde metin düzenleme

`heading`/`text`/`badge`/`button` (etiket) katmanları çift tıklamada `<input>`/`<textarea>`
(çok satırlı yalnızca `text` tipi) overlay'ine döner — overlay `buildLayerContentStyle` ile AYNI
tipografi stilini taşır (düzenleme sırasında da görsel tutarlılık) + `border border-dashed
border-white` (düzenleme modunu işaretleyen tek ek çizgi). Odaklanınca metin TAMAMI seçili
(hızlı değiştirme). **Enter** (çok satırlı `text` HARİÇ) veya **blur** COMMIT eder, **Escape**
İPTAL eder (blur'u tetikler ama değeri YAZMAZ — orijinal içerik korunur). `image` katmanının
`content.url`u inline düzenlenemez (serbest metin değil, URL) — çift tıklama yalnızca seçer
(sağ panelin "Katman" sekmesi zaten o anda otomatik açılır, bkz. §7.6).

### §7.6 Akıllı sağ panel — otomatik sekme geçişi

Tam "arka plan ⇄ katman müfettişi" moduna GEÇİŞ değil (4 sekme YAPISI korunur — Slayt/Katman/
Animasyon/Slider, mevcut zengin animasyon sekmesini tek bir dev sekmeye eritmek riskli bir
yeniden yazımdı, kazancı düşük) — bunun yerine SEÇİM ANINDA otomatik yönlendirme: bir katman
seçilince müfettiş aktif sekmesi ANINDA "Katman"a, seçim kalkınca (tuval boşluğuna tıklama,
katman silme, slayt değiştirme) "Slayt"a döner. Kullanıcı sonrasında "Animasyon"/"Slider"
sekmesine ELLE geçebilir — bu yalnızca seçim DEĞİŞTİĞİ ANDA bir kerelik yönlendirmedir, sekmeyi
manuel olarak kilitlemez.

**Cihaz Görünürlüğü:** "Katman" sekmesine, Stil grubunun ALTINA, tablet/mobil görünümdeyken
görünen yeni bir bölüm eklendi — `Eye`/`EyeOff` ikonlu tek bir `Switch` ("{Cihaz}'de göster").
Bu, ZATEN var olan `layer-mutations.ts::isLayerHiddenOnDevice`/`setLayerHidden` fonksiyonlarının
(daha önce yalnızca tuvalde soluk gösterge olarak TÜKETİLİYORDU, YAZMA arayüzü YOKTU) ilk gerçek
UI kontrolüdür — yeni bir veri alanı EKLENMEDİ, yalnızca eksik kalan kontrol tamamlandı.

### §7.7 "Esnek Sıçrama" (Elastic Bounce) — yeni giriş efekti

`SliderLayerInEffect` enum'ına (frontend `types.ts`, backend `layers.ts` Zod, openapi.yaml —
ÜÇÜ de) `elastic-bounce` eklendi — `Slide.layers` JSON alanı olduğu için bu bir Postgres
migration'ı GEREKTİRMEZ, salt kod-seviyeli bir Zod enum genişlemesidir (bkz. architect §2.5
"JSON alanı — şema evrimi migration gerektirmez" gerekçesiyle AYNI).

**`easing` alanıyla KARIŞTIRILMAZ:** `easing` bir TRANSITION eğrisidir (mevcut giriş şeklinin
NASIL hareket ettiği), `elastic-bounce` bir giriş ŞEKLİDİR (`fade-up`/`zoom-in` ailesinin yeni
bir üyesi — büyük ölçekten taşarak oturma: `initial: {opacity:0, scale:0.3}` →
`animate: {opacity:1, scale:1}`). Seçildiğinde render katmanı `easing` alanını NE OLURSA OLSUN
yüksek "bounce" (0.6) değerli bir `spring` transition'a zorlar — aksi halde "esnek" hissi
kaybolurdu. Admin müfettişinde (`animation-tab.tsx`) bu net olsun diye `easing` seçici
`elastic-bounce` seçiliyken `disabled` + açıklayıcı `hint` gösterir.

### §7.8 Zaman çizelgesi "Oynat" artık tuvali de canlandırır

Önceden "Oynat" yalnızca zaman çizelgesindeki beyaz playhead çizgisini süpürüyordu — tuval
DEĞİŞMİYORDU. Artık `playing`/`playKey` durumu `HeroStudio`'ya TAŞINDI (Timeline'ın kendi yerel
state'i DEĞİL) ve HEM playhead'i HEM tuvali besler: "Oynat" tıklanınca tuvaldeki HER katman aynı
anda (public render'daki `IN_EFFECT_VARIANTS`/`buildLayerTransition` — §7.3'teki AYNI paylaşılan
kaynak) kendi `delayMs`'i kadar bekleyip giriş animasyonuyla belirir — "tuval sıfırlanıp
zamanlamalara göre akması" budur. Oynatma SÜRESİNCE tuval etkileşimi (sürükleme/yeniden
boyutlandırma/çift-tıklama) KİLİTLENİR (`pointer-events: none` + handler'larda erken çıkış) —
düzenleme ile önizleme aynı anda karışmasın diye. Zaman çizelgesindeki playhead süpürmesi bitince
(`onAnimationComplete`) `playing` `false`'a döner, tuval otomatik olarak düzenlenebilir/statik
görünüme geri döner.
