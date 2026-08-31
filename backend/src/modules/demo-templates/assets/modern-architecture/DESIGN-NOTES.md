# `modern-architecture` — Tasarım Notları (ui-designer, BAĞLAYICI)

Kaynak karar dokümanı: `.claude/architect-scope-demo-template-import.md` (özellikle §4, §7,
§8, §9). Bu dosya, backend-agent'ın `templates/modern-architecture.ts` içindeki
`DemoTemplateDefinition`'ı yazarken kullanacağı **TEK** tasarım referansıdır. Renk/ikon/stil
değerleri burada verilenlerin **dışına çıkılmaz**; sayı/hex/px değerleri aynen kopyalanır.

Kurgusal firma adı: **"Kütle Yapı"**. Görsel yön: **A) Minimal/Flat + sıcak-krem/koyu-antrasit
kontrastı** (glassmorphism/blur YOK — referans site düz renk blokları + ince çizgi motif kullanıyor).

---

## 0. KRİTİK BULGU — sayfa-builder yaprak blokları `SiteAppearance` renklerini OKUMAZ (bağlayıcı kısıtlama, bu dokümanın tüm renk kararlarını şekillendirir)

Kod incelemesiyle doğrulandı (bu turda **düzeltilmez** — kapsam dışı, architect'e ayrı bir
bulgu olarak bildirilmeli):

- `frontend/src/components/site/blocks/heading-block.tsx`, `icon-box-block.tsx`,
  `text-block.tsx` (`prose` sınıfı) ve `cta-block.tsx`'in `plain`/`soft`/`outline` tonları,
  metin rengini **Tailwind'in genel `text-foreground`/`text-primary` sınıflarıyla** boyar.
  Bu sınıflar `frontend/src/app/globals.css`'teki **admin-varsayılan `:root` token'larına**
  (`--foreground: oklch(0.145 0 0)` ≈ neredeyse siyah, `--primary: #4f46e5` indigo) bağlıdır.
- `.site-scope` (`frontend/src/app/[lang]/(site)/layout.tsx`) yalnızca `--site-*` adında AYRI
  bir CSS değişken seti yazar (`--site-text`, `--site-primary`, `--site-button`…) — `globals.css`
  içinde HİÇBİR yerde `--foreground`/`--primary`'yi `--site-text`/`--site-primary`'ye bağlayan bir
  kural YOK. `.dark` sınıfı da yalnızca admin panelinin next-themes anahtarıyla gelir, public
  sitede hiç uygulanmaz.
- Sonuç: `heading`/`icon-box`/`text`/`button-block`/`cta(plain|soft|outline)` blokları **her
  zaman sabit koyu metin** render eder (yalnızca `cta(solid)` beyaza yakın metin verir, ama o da
  sabit indigo bir kutu içindedir — marka rengimiz değil). **Container'ın kendi `background`'ı**
  (`container-block.tsx::backgroundStyle`) ise doğrudan verilen hex'i kullanır ve bu yüzden
  **güvenilirdir** — sorun yalnızca konteynerin İÇİNDEKİ yaprak blokların metin rengidir.
- **Bağlayıcı kural (bu şablon için):** `heading`, `text`, `icon-box`, `counter`, `button`
  bloklarını doğrudan barındıran hiçbir `container`, **gerçek koyu dolgu** (`secondaryColor
  #1F2124` veya `primaryColor #1C4B42` düz `background.type:"color"`) KULLANMAZ — çünkü metin
  rengi buna uyum sağlamaz ve WCAG kontrastı ~1:1'e düşer (okunamaz). Bunun yerine bu şablonda
  **açık gold-tint zemin `#EFE6CE`** (bkz. §1.1) kullanılır. Gerçek koyu zeminler yalnızca
  **slider katmanları** (bunlar `advanced-slider`/`slide-layer.tsx` üzerinden `--site-*`'ı
  doğru okur) ve **CTA banner'ın kendi `image` arka planı + `cta` bloğunun `style:"soft"`
  tonu** (kendi kutusu içinde zaten okunabilir) için kullanılır.
- **Escalation notu (backend-agent → architect):** Bu bulgu `feature/page-builder-block-theming`
  gibi ayrı bir işe konu olmalı — `heading-block.tsx`/`icon-box-block.tsx`/`text-block.tsx`/
  `button-block.tsx`/`cta-block.tsx`'in `text-foreground`/`bg-primary` yerine `var(--site-text)`/
  `var(--site-primary)`/`var(--site-button)`/`var(--site-button-text)` okuması gerekir. **Bu
  şablonun teslimi bu düzeltmeyi BEKLEMEZ** — aşağıdaki değerler bu kısıt İÇİNDE, bugün doğru
  render edecek şekilde seçilmiştir.

---

## 1. Renk paleti — NİHAİ (onaylandı, değişiklik yok) + WCAG AA raporu

Architect'in §7.3 başlangıç değerlerinin **hepsi onaylanmıştır**, hiçbir hex değişmedi:

| `SiteAppearance` alanı | Hex | Kullanım |
|---|---|---|
| `primaryColor` | `#1C4B42` | koyu yeşil — linkler, başlık vurgusu, ikon rengi (blok ikon halkası dahil, bkz. §0 kısıtı) |
| `secondaryColor` | `#1F2124` | antrasit — header, footer, buton dolgusu, slider gradyanı |
| `buttonColor` | `#1F2124` | dolgu buton (SOLID) |
| `buttonTextColor` | `#FFFFFF` | buton metni |
| `linkColor` | `#1C4B42` | metin içi bağlantı |
| `accentColor` | `#C9A227` | altın aksan — **YALNIZCA ikon/çizgi/border/rozet dolgusu**, asla açık zemin üstünde düz metin rengi olarak kullanılmaz (bkz. madde 1.2) |
| `backgroundColor` | `#F6F5F2` | sayfa zemini (sıcak krem) |
| `surfaceColor` | `#FFFFFF` | kart yüzeyi |
| `textColor` | `#1F2124` | gövde/başlık metni |
| `mutedTextColor` | `#6B6F76` | ikincil/gri metin |

`presetKey`: `null` (bkz. architect §7.3 son paragraf — değişmedi).

### 1.1 Kontrast raporu (WCAG 2.1, sRGB relative luminance formülü ile hesaplandı)

| Çift | Oran | Eşik | Sonuç |
|---|---|---|---|
| `textColor` (#1F2124) / `backgroundColor` (#F6F5F2) | **14.80:1** | 4.5:1 (normal metin) | ✅ Geçti (bol payla) |
| `textColor` / `surfaceColor` (#FFFFFF) | **16.14:1** | 4.5:1 | ✅ Geçti |
| `buttonTextColor` (#FFFFFF) / `buttonColor` (#1F2124) | **16.14:1** | 4.5:1 | ✅ Geçti |
| `linkColor` (#1C4B42) / `backgroundColor` | **9.03:1** | 4.5:1 | ✅ Geçti |
| `linkColor` / `surfaceColor` | **9.84:1** | 4.5:1 | ✅ Geçti |
| `mutedTextColor` (#6B6F76) / `backgroundColor` | **4.63:1** | 4.5:1 | ✅ Geçti (sınıra yakın — 14px altına küçültme, ince/300 ağırlık kullanma) |
| `mutedTextColor` / `surfaceColor` | **5.04:1** | 4.5:1 | ✅ Geçti |
| `accentColor` (#C9A227) metin olarak / `backgroundColor` | **2.22:1** | 3:1 (büyük metin) | ❌ GEÇMEDİ |
| `accentColor` metin olarak / `secondaryColor` (#1F2124, koyu zemin) | **6.67:1** | 4.5:1 | ✅ Geçti |
| `textColor` (#1F2124) metin olarak / `accentColor` dolgu üstünde (rozet/chip) | **6.67:1** | 4.5:1 | ✅ Geçti |
| beyaz metin / `accentColor` dolgu üstünde | **2.42:1** | 4.5:1 | ❌ GEÇMEDİ |

### 1.2 Bağlayıcı kullanım kuralları (kontrast raporunun sonucu)

1. **`accentColor` asla açık zemin (`backgroundColor`/`surfaceColor`) üstünde düz metin rengi
   olarak kullanılmaz** (2.22:1, başarısız). Yalnızca: (a) ikon/stroke rengi, (b) `border`,
   (c) koyu zemin (`secondaryColor`) üstünde metin/ikon (6.67:1, geçti), (d) rozet/chip
   arka planı — üstüne **`textColor` (#1F2124) yazılır, beyaz DEĞİL** (beyaz 2.42:1 ile başarısız).
2. Koyu zeminler (`secondaryColor`) üstüne **yalnızca zaten `--site-*` okuyan bileşenler**
   (slider katmanları, header, footer) beyaz/krem metin koyabilir — bkz. §0.
3. `mutedTextColor` sınırda (4.63:1) — küçük yardımcı metinlerde (ör. tarih, meta bilgi) kullan,
   ana gövde paragrafı için `textColor` tercih edilir.

---

## 2. Tipografi ve `borderRadius` (architect §7.1/§7.2 — onaylandı, değişiklik yok)

| Alan | Değer |
|---|---|
| `headingFont` | `PLUS_JAKARTA_SANS` |
| `bodyFont` | `INTER` |
| `baseFontSize` | `16` |
| `borderRadius` | `MD` (8px) |
| `buttonStyle` | `SOLID` |

**Pill görünüm** yalnızca slider katmanlarında `SliderLayerStyle.borderRadius: 100` ile elde
edilir (bkz. §5 Hero). Sayfa bloklarındaki (`button`, `cta`) butonlar global 8px'i miras alır —
bu kabul edilmiş bir sapmadır, backend-agent/frontend-agent bunu telafi etmek için ekstra sınıf
EKLEMEZ (architect §7.2).

---

## 3. Spacing ölçeği (ui-designer kararı — 8px taban)

Tüm `ContainerSettings.padding`/`margin`/`gap` değerleri bu ölçekten seçilir:
**8, 16, 24, 32, 48, 64, 80, 96, 120** (px). Aşağıdaki bölüm tablosunda rastgele değer yok.

---

## 4. İkon seçimleri — `frontend/src/lib/page-builder/icon-options.ts` allowlist'inden (YENİ İKON EKLENMEZ)

| Bağlam | İkon adı | Etiket (TR) |
|---|---|---|
| Hizmet kartı 1 — Mimari Tasarım | `Compass` | "Mimari Tasarım" |
| Hizmet kartı 2 — İnşaat & Uygulama | `Wrench` | "İnşaat & Uygulama" |
| Hizmet kartı 3 — Proje Yönetimi | `Target` | "Proje Yönetimi" |
| Farkımız 1 — Kalite Güvencesi | `Award` | "Kalite Güvencesi" |
| Farkımız 2 — Zamanında Teslim | `Clock` | "Zamanında Teslim" |
| Farkımız 3 — Şeffaf İşbirliği | `Handshake` | "Şeffaf İşbirliği" |
| Farkımız 4 — Güvenilir Uygulama | `ShieldCheck` | "Güvenilir Uygulama" |
| İletişim paneli — şirket/ofis vurgusu | `Building2` | "Ofisimiz" |

**Not:** allowlist'te ok/chevron ikonu YOK — buton katmanlarında/bloklarında `icon` alanı
**boş bırakılır** (yeni ikon eklenmez).

---

## 5. Hero — `Slider` + `Slide[].layers` (`frontend/src/lib/sliders/types.ts::SliderLayer` ile birebir)

### Slider ayarları
```
widthMode: "full-width"
heightMode: "aspect-ratio", aspectRatioWidth: 16, aspectRatioHeight: 9, heightPx: null
autoplay: true, intervalMs: 6000, loop: true, pauseOnHover: true
transitionEffect: "fade", transitionDurationMs: 600
showArrows: true, showBullets: true, showProgressBar: false
navigationTheme: "dark"   // slayt zemini koyu
```

### 3 slayt (bullet'lar §8.1'deki eksik "sekme şeridi"nin yerini tutar — her slayt farklı bir
mesaj/odak taşır, aynı yerleşim/stil tekrar eder)

Ortak `bgType: "gradient"`, `bgOverlayColor: null`, `bgOverlayOpacity: 0`, `bgPositionX/Y: 50/50`,
`bgKenBurns: false`, `durationMs: null`, `linkHref: null`, `linkNewTab: false`.

| Slayt | `bgGradientFrom` | `bgGradientTo` | `bgGradientAngle` | Rozet metni | Başlık | Buton |
|---|---|---|---|---|---|---|
| 1 | `#1C4B42` | `#1F2124` | 135 | "Mimarlık & İnşaat" | "Mekanı Anlamlı Yapıya Dönüştürüyoruz" | "Projelerimizi İnceleyin" → `/portfolio` |
| 2 | `#1F2124` | `#1C4B42` | 225 | "Proje Yönetimi" | "Yapısal Bütünlük, Zamanında Teslim" | "Süreci Nasıl Yönetiyoruz?" → `/hakkimizda` |
| 3 | `#1C4B42` | `#1F2124` | 315 | "Sürdürülebilir Tasarım" | "Çağdaş ve Sürdürülebilir Mimari" | "Bize Ulaşın" → `/iletisim` |

Metin gövdesi (her slaytta): "Kütle Yapı; konut, ticari ve endüstriyel projelerde tasarımdan
anahtar teslime uzanan bütünsel bir yaklaşım sunar."

### Katman stilleri (her 3 slaytta AYNI — yalnızca `content` değişir)

**`badge`** (type: "badge"):
```
position: { xPercent: 8, yPercent: 62, origin: "bottom-left" }
style: { color: "#C9A227", backgroundColor: "#C9A227", backgroundOpacity: 15,
         fontFamily: "body", fontSize: 13, fontWeight: 600, letterSpacing: 1.5,
         textTransform: "uppercase", padding: {top:8,right:18,bottom:8,left:18},
         borderRadius: 100, shadow: "none" }
animation: { inEffect: "fade-down", delayMs: 0, durationMs: 500, easing: "ease-out" }
```

**`heading`** (level: 1):
```
position: { xPercent: 8, yPercent: 70, origin: "bottom-left", widthPercent: 55 }
style: { color: "#FFFFFF", fontFamily: "heading", fontSize: 52, fontWeight: 700,
         lineHeight: 1.15, textAlign: "left", maxWidthPx: 640,
         padding: {top:0,right:0,bottom:0,left:0} }
animation: { inEffect: "fade-up", delayMs: 150, durationMs: 600, easing: "ease-out" }
```

**`text`**:
```
position: { xPercent: 8, yPercent: 83, origin: "bottom-left", widthPercent: 42 }
style: { color: "#F6F5F2", fontFamily: "body", fontSize: 17, lineHeight: 1.6,
         fontWeight: 400, opacity: 90 }
animation: { inEffect: "fade-up", delayMs: 300, durationMs: 600, easing: "ease-out" }
```

**`button`** (variant: "solid", size: "lg", **PILL**):
```
position: { xPercent: 8, yPercent: 92, origin: "bottom-left" }
style: { color: "#FFFFFF", backgroundColor: "#1F2124", borderRadius: 100,
         padding: {top:16,right:32,bottom:16,left:32}, fontWeight: 600, fontSize: 16,
         shadow: "md" }
animation: { inEffect: "fade-up", delayMs: 450, durationMs: 600, easing: "ease-out" }
icon: (belirtilmez — allowlist'te ok ikonu yok)
```

---

## 6. Sayfa bölümleri — `ContainerSettings` (§8 tablosuyla birebir sıra)

> Genel kural: `layout: "boxed"` konteynerlerde `customWidth` belirtilmez (varsayılan 1170
> kullanılır). Tüm `margin` değerleri aksi belirtilmedikçe `{top:0,right:0,bottom:0,left:0}`.

### 6.1 Bölüm 2 — Hero
Blok DEĞİL, doğrudan `advanced-slider` (`data.sliderId: "ref:slider"`) — sarmalayan `container`
YOK. Bkz. §5.

### 6.2 Bölüm 3 — 3'lü hizmet kartları

**Yorum notu (ui-designer):** Architect tablosundaki "icon-box + heading + text" ifadesi, tek bir
`icon-box` bloğunun kendi `heading`/`description` alanlarıyla karşılanır (ayrı `heading`/`text`
blokları EKLENMEZ — mükerrer başlık üretirdi).

Dış konteyner:
```
layout: "boxed", direction: "row", justifyContent: "center", alignItems: "stretch", gap: 32,
padding: {top:96,right:24,bottom:96,left:24}
background: { type: "color", value: "#F6F5F2" }
```

3 × iç konteyner (kart), her biri `widthFr: 1`:
```
layout: "full-width", direction: "column", justifyContent: "start", alignItems: "center",
gap: 16, padding: {top:40,right:32,bottom:40,left:32}
```
- Kart 1 arka planı: `{ type: "color", value: "#FFFFFF" }` — `icon-box`: `Compass` / "Mimari Tasarım" / "Konsept tasarımdan uygulama projesine, mekanın ihtiyaçlarına özel bütünsel bir mimari yaklaşım."
- Kart 2 arka planı: `{ type: "color", value: "#EFE6CE" }` (accentColor'ın açık tonu — §0 kısıtı gereği gerçek koyu DEĞİL, görsel farklılaşma bununla sağlanır) — `icon-box`: `Wrench` / "İnşaat & Uygulama" / "Sahada disiplinli süreç yönetimi ve kaliteli işçilikle projeyi eksiksiz hayata geçiriyoruz."
- Kart 3 arka planı: `{ type: "color", value: "#FFFFFF" }` — `icon-box`: `Target` / "Proje Yönetimi" / "Bütçe ve takvime bağlı kalarak, tasarımdan teslime tüm süreci uçtan uca yönetiyoruz."

### 6.3 Bölüm 4 — 4 sütunlu proje portföyü
```
layout: "boxed", direction: "column", justifyContent: "center", alignItems: "center", gap: 40,
padding: {top:96,right:24,bottom:96,left:24}
background: { type: "color", value: "#FFFFFF" }
```
Çocuklar: `heading` (level 2, align "center", underline false, text "Öne Çıkan Projelerimiz") →
`featured-portfolio` (`data.limit: 8`) → `button` (align "center", style "outline", size "md",
label "Tüm Projeleri Gör", href "/portfolio").

### 6.4 Bölüm 5 — "Farkımızla Tanışın" paneli
**§0 kısıtı nedeniyle gerçek `secondaryColor` (koyu) dolgu KULLANILMAZ** (heading/icon-box
metni bunu okuyamaz — okunamaz kontrast üretirdi). Bunun yerine aynı gold-tint (`#EFE6CE`)
kullanılır; bölüm önceki (beyaz) ve sonraki (krem) bölümlerden hâlâ net şekilde ayrışır.
```
layout: "full-width", direction: "column", justifyContent: "center", alignItems: "center",
gap: 56, padding: {top:96,right:24,bottom:96,left:24}
background: { type: "color", value: "#EFE6CE" }
topDivider: { type: "curve", color: "#FFFFFF", height: 100, flip: false }
```
Çocuklar: `heading` (level 2, align "center", text "Farkımızla Tanışın") → iç `container`
(`direction: "row"`, `justifyContent: "center"`, `alignItems: "stretch"`, `gap: 32`,
`padding: {top:0,right:0,bottom:0,left:0}`, `background: {type:"none"}`) → 4 × `icon-box`
(`widthFr: 1` gerekmez, doğrudan yaprak blok — eşit dağılım flex `row` üzerinden gelir):
`Award`/"Kalite Güvencesi", `Clock`/"Zamanında Teslim", `Handshake`/"Şeffaf İşbirliği",
`ShieldCheck`/"Güvenilir Uygulama" (açıklamalar serbest, 1 kısa cümle).

### 6.5 Bölüm 6 — Sayaç bandı
```
layout: "boxed", direction: "row", justifyContent: "evenly", alignItems: "center", gap: 32,
padding: {top:64,right:24,bottom:64,left:24}
background: { type: "color", value: "#F6F5F2" }
```
`counter` bloğu, 4 öğe:
1. `{ value: 15, suffix: "+", label: "Yıllık Tecrübe" }`
2. `{ value: 120, suffix: "+", label: "Tamamlanan Proje" }`
3. `{ value: 45, label: "Uzman Ekip Üyesi" }`
4. `{ value: 98, prefix: "%", label: "Müşteri Memnuniyeti" }`

### 6.6 Bölüm 7 — Koyu CTA banner
Bu bölümde koyu zemin **görsel olarak güvenli**: konteyner arka planı bir `image` (asset), metin
`cta` bloğunun **kendi `style: "soft"` kutusunun içinde** (kendi CSS sınıfları zaten açık zemin +
koyu metin üretir, `--site-*`'a ihtiyaç duymaz — bkz. §0).
```
layout: "full-width", direction: "column", justifyContent: "center", alignItems: "start",
gap: 24, padding: {top:96,right:48,bottom:96,left:48}
minHeight: { value: 480, unit: "px" }
background: {
  type: "image", value: "asset:cta-banner", position: "center", size: "cover", repeat: "no-repeat",
  overlay: { color: "#1F2124", opacity: 55 }
}
```
`cta` bloğu: `style: "soft"`, `align: "left"`, heading "Projenizi Birlikte Hayata Geçirelim",
description "Fikir aşamasından anahtar teslime, mimarlık ve inşaat süreçlerinizde yanınızdayız.",
`buttonLabel`: "Bize Ulaşın", `buttonHref`: "/iletisim".

### 6.7 Bölüm 8 — Bölünmüş iletişim formu
Dış konteyner:
```
layout: "full-width", direction: "row", justifyContent: "stretch", alignItems: "stretch",
gap: 0, padding: {top:0,right:0,bottom:0,left:0}
background: { type: "none" }
```
Sol iç konteyner (`widthFr: 1`):
```
layout: "full-width", direction: "column", justifyContent: "center", alignItems: "start",
gap: 24, padding: {top:96,right:64,bottom:96,left:64}
background: { type: "color", value: "#F6F5F2" }
```
Çocuklar: `heading` (level 2, align "left", text "Bize Ulaşın") → `text` (kısa tanıtım cümlesi,
HTML `<p>`) → `contact-form` (`data.showTitle: false`).

Sağ iç konteyner (`widthFr: 1`) — **§0 kısıtı gereği gerçek `secondaryColor` DEĞİL**, aynı
gold-tint kullanılır:
```
layout: "full-width", direction: "column", justifyContent: "center", alignItems: "start",
gap: 24, padding: {top:96,right:64,bottom:96,left:64}
background: { type: "color", value: "#EFE6CE" }
```
Çocuklar: `icon-box` (`Building2`, heading "Ofisimiz", description §9 yer tutucularıyla —
"Örnek Mah. Örnek Cad. No: 1, Kadıköy / İstanbul") → `text` (HTML: `+90 212 000 00 00` ve
`info@example.com`, satır satır).

**Backlog notu:** Frontend-agent §0'daki düzeltmeyi uyguladıktan SONRA bu panelin (ve §6.4'ün)
arka planı `#EFE6CE` → `#1F2124` (secondaryColor) olarak güncellenebilir; o zaman metin
`buttonTextColor`/beyaza döner. Bu turda YAPILMAZ.

### 6.8 Bölüm 9 — Bülten çubuğu (→ iletişim formuna yönlendiren `cta`, §8.2)
```
layout: "boxed", direction: "column", justifyContent: "center", alignItems: "center", gap: 16,
padding: {top:64,right:24,bottom:64,left:24}
background: { type: "color", value: "#FFFFFF" }
```
`cta` bloğu: `style: "plain"`, `align: "center"`, heading "Projenizi Konuşalım", description
"Uzman ekibimiz, ihtiyaçlarınızı dinlemek ve size özel bir yol haritası sunmak için hazır.",
`buttonLabel`: "İletişim Formuna Git", `buttonHref`: "/iletisim".

### 6.9 Bölüm 1 (header) / 10 (footer) — blok DEĞİL, kısa notlar
- `SiteAppearance.stickyHeaderEnabled: true`.
- `SiteSettings.headerCtaLabel`: "Bize Ulaşın", `headerCtaHref`: "/iletisim".
- `site-header.tsx`/`site-footer.tsx` **doğrudan `var(--site-button)`/`var(--site-link)`
  okur** (§0'daki kısıt bunlara UYGULANMAZ — bu iki bileşen zaten doğru bağlı, bkz. kod
  incelemesi `site-header.tsx:171-172`, `site-footer.tsx:74`). Footer 4 sütun koyu
  (`secondaryColor`) zeminde **güvenle** render edilir.
- `logoUrl`: `null` (architect §4.4 madde 3 — değişmedi).

---

## 7. `_source/*.svg` üretim-kaynağı varlıklar — teslim edildi

Konum: `backend/src/modules/demo-templates/assets/modern-architecture/_source/`.
**Çalışma zamanında okunmaz/servis edilmez** — yalnızca backend-agent'ın
`backend/scripts/build-template-assets.ts` içinde `node:zlib` ile PNG üretirken referans
alacağı bildirimsel gradient/geometri tanımıdır (architect §4.3).

| Dosya | Boyut | Gradyan | Motif |
|---|---|---|---|
| `portfolio-cover-1.svg` | 1200×900 | linear 135°, `#1C4B42` → `#12312B` | ikiz kule (ince çizgi, `#C9A227` %55 opaklık) |
| `portfolio-cover-2.svg` | 1200×900 | linear 135°, `#1F2124` → `#1C4B42` | kademeli/teraslı yapı |
| `portfolio-cover-3.svg` | 1200×900 | radial, `#2B2E32` (merkez) → `#1F2124` (kenar) | kolonat / sütun sırası |
| `portfolio-cover-4.svg` | 1200×900 | linear 45°, `#1C4B42` → `#1F2124` | farklı yükseklikte bina kümesi |
| `cta-banner.svg` | 1920×720 | sol/alt %100 düz `#1F2124`; sağ 1/3 linear `#1F2124`→`#2B2E32` | sağ üçte birde ince çizgi skyline, sol/alt TAMAMEN düz koyu (metin/pill buton için) |
| `about-image.svg` | 1200×900 (4:3) | linear 135°, `#F6F5F2` → `#EFE6CE` | ince çizgi cephe/kat planı (`#1C4B42`) + altın kotasyon çizgileri (`#C9A227`) + yumuşak ışık dairesi |

Tüm dosyalar yalnızca inline `<svg>`/`<defs>`/`<linearGradient>`/`<radialGradient>`/`<rect>`/
`<line>`/`<circle>`/`<title>`/`<desc>` içerir — `<script>`, harici referans veya `<style>` YOK.

`DemoTemplateAsset[]` eşlemesi (backend-agent `templates/modern-architecture.ts`'te kullanacak
`key`/`file`/`altText` üçlüsü):

| `key` | `file` (PNG çıktı) | `altText` |
|---|---|---|
| `portfolio-cover-1` | `portfolio-cover-1.png` | "Kütle Yapı — konut projesi kapak görseli, ikiz kule silueti" |
| `portfolio-cover-2` | `portfolio-cover-2.png` | "Kütle Yapı — ticari proje kapak görseli, kademeli yapı silueti" |
| `portfolio-cover-3` | `portfolio-cover-3.png` | "Kütle Yapı — kurumsal proje kapak görseli, kolonat silueti" |
| `portfolio-cover-4` | `portfolio-cover-4.png` | "Kütle Yapı — karma kullanım proje kapak görseli, yapı kümesi silueti" |
| `cta-banner` | `cta-banner.png` | "Kütle Yapı ofis binası siluet illüstrasyonu, koyu zemin üzerinde altın çizgi motif" |
| `about-image` | `about-image.png` | "Kütle Yapı — mimari kat planı çizim illüstrasyonu" |

---

## 8. `preview.svg` / `preview.webp` — devir teslim notu (KAPSAM DIŞI, açıkça devrediliyor)

`frontend/public/demo-templates/modern-architecture/preview.svg` **ui-designer tarafından
YAZILDI** (spesifikasyon + kompozit mockup — header/hero/hizmet kartları/portföy/footer
ritmini palet renkleriyle temsil eder, gerçek metin İÇERMEZ). **Bu dosya `previewImageUrl`
olarak DOĞRUDAN kullanılamaz** (architect §4.5 — admin galerisi `preview.webp` bekliyor, SVG
DEĞİL). **backend-agent veya frontend-agent bu SVG'yi referans alarak/ekran görüntüsü
alarak `preview.webp` (1200×750) üretmelidir** — bu adım ui-designer'ın implementasyon
kapsamı DIŞINDADIR (WEBP encoder yok). `DemoTemplateDefinition.previewImageUrl` alanı
`"/demo-templates/modern-architecture/preview.webp"` olarak kalır (architect'in belirlediği
yol, değişmedi).

---

## 9. Kontrol listesi (backend-agent bu dosyayı uyguladıktan sonra)

- [ ] 9 renk hex'i §1 tablosuyla birebir
- [ ] Hiçbir `heading`/`icon-box`/`text`/`counter`/`button` bloğu doğrudan `secondaryColor`/
      `primaryColor` koyu dolgu içeren bir `container`'ın çocuğu DEĞİL (§0 kısıtı)
- [ ] Slider katman `button` stilinde `borderRadius: 100` (pill)
- [ ] Sayfa bloğu butonlarında `!rounded-full` gibi tek seferlik sınıf YOK (global 8px korunuyor)
- [ ] Kullanılan tüm ikonlar §4 tablosundaki 8 isimden biri, allowlist dışına çıkılmadı
- [ ] `assets[]` §7 tablosundaki 6 `key`/`file`/`altText` ile birebir
- [ ] `previewImageUrl` `"/demo-templates/modern-architecture/preview.webp"` (SVG değil)
