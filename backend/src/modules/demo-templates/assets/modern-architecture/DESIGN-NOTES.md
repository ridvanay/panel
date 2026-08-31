# `modern-architecture` — Tasarım Notları (ui-designer, BAĞLAYICI)

## v2 değişiklik notu (bu tur — kontrast düzeltme + gerçek fotoğraf)

Bu tur şu üç şeyi değiştirir, gerekçeleriyle birlikte aşağıda:

1. **§0 artık ERTELENMEDİ.** Sayfa-builder yaprak bloklarının (`heading`/`icon-box`/`text` değil,
   aşağıda düzeltildi — `text` blok zaten etkilenmiyordu, bkz. §0.1 düzeltme notu/`icon-box`/
   `button`/`cta`/`counter`/`contact-form`/`portfolio-card`) `SiteAppearance` renklerini
   OKUMAMASI kök-neden hatası **bu turda düzeltiliyor** — CSS köprüsü (`.site-scope` içinde admin
   token override'ı), bkz. §0.
2. **Gerçek stok mimari fotoğraf** (Unsplash, özgür lisans) kullanımına geçildi — hero, hizmet
   kartları, portföy kapakları, CTA banner ve "Ofisimiz" paneli artık düz renk/SVG illüstrasyon
   DEĞİL, gerçek fotoğraf taşır. Bu, `.claude/architect-scope-demo-template-import.md` §9 madde 3'ün
   ("yalnızca bu depoda üretilen PNG'ler... stok görsel YOK") **açık bir istisnasıdır** —
   orkestratörün bu tur için verdiği görev talimatıyla YETKİLENDİRİLMİŞTİR (bkz. araştırma notu
   `modern-architecture-fix-research.md`: "GENEL stok mimari fotoğraf kullanımı KABUL EDİLEBİLİR,
   gerçek marka/logo/kişi YOK"). **Bu bir kapsam genişletmesidir, architect'e bilgi olarak
   iletilmeli** (orkestratör zaten bu kararı önceden temizlemiştir, ama mimari doküman §9 madde 3
   metninin kendisi güncellenmedi — gelecekte "SVG/PNG-only" kuralına bakan biri bu istisnayı
   burada bulmalı).
3. **Hizmet kartı + portföy kartı kompozisyonu** yeniden tasarlandı (fotoğraf + rozet/pill +
   ok butonu) — mevcut blok sözlüğüyle, §0'ın yeni bulgusuna (bloklar LOKAL koyu zemine göre metin
   rengini DEĞİŞTİREMEZ, yalnızca SİTE GENELİ tek bir metin rengi okuyabilir) uyumlu şekilde.

---

Kaynak karar dokümanı: `.claude/architect-scope-demo-template-import.md` (özellikle §4, §7,
§8, §9). Bu dosya, backend-agent'ın `templates/modern-architecture.ts` içindeki
`DemoTemplateDefinition`'ı yazarken kullanacağı **TEK** tasarım referansıdır. Renk/ikon/stil
değerleri burada verilenlerin **dışına çıkılmaz**; sayı/hex/px değerleri aynen kopyalanır.

Kurgusal firma adı: **"Kütle Yapı"**. Görsel yön: **A) Minimal/Flat + sıcak-krem/koyu-antrasit
kontrastı** (glassmorphism/blur YOK — referans site düz renk blokları + ince çizgi motif kullanıyor).
Bu tur **gerçek fotoğraf** eklenmesiyle "flat" yön "flat + fotoğrafik" olarak genişler — fotoğraflar
üzerinde HİÇBİR blur/cam efekti kullanılmaz (still no glassmorphism); yalnızca düz renk overlay
katmanları (opaklık ayarlı tek renk) kullanılır.

---

## 0. KÖK NEDEN — sayfa-builder yaprak blokları `SiteAppearance` renklerini OKUMUYORDU (bu turda DÜZELTİLDİ)

### 0.1 Doğrulanmış bulgu (kod okunarak, birebir dosya/satır ile)

`frontend/src/app/providers.tsx`'teki `<ThemeProvider attribute="class" defaultTheme="system"
enableSystem>` TÜM uygulamayı (admin + public site) sarar. Ziyaretçinin OS/tarayıcı tercihi koyuysa
next-themes `<html>`'e `class="dark"` ekler. `frontend/src/app/globals.css`'teki `.dark { --foreground:
oklch(0.985 0 0); ... }` (neredeyse beyaz) `:root`'un `--foreground: oklch(0.145 0 0)` (neredeyse
siyah) değerini EZER. `.site-scope` (`frontend/src/app/[lang]/(site)/layout.tsx`) yalnızca KENDİ
`--site-*` özel özelliklerini satır-içi yazıyordu; `--foreground`/`--primary`/`--border`/vb. admin
token'larını hiç override ETMİYORDU. Sonuç: OS/tarayıcı koyu moddaysa, bu admin token'larını
kullanan bloklar beyaza yakın/silik metin render ediyordu — konteynerin arka planı (ham hex
kullandığı için) hâlâ açık krem/beyaz kalıyordu → okunamaz kontrast.

**Düzeltme notu (bu tur, kod inceleyerek DOĞRULANDI — önceki araştırma özetinin tek hatası):**
`frontend/src/components/site/blocks/text-block.tsx` (`prose` sınıfı) **BU HATADAN ETKİLENMİYOR** —
depoda `@tailwindcss/typography` paketi **YÜKLÜ DEĞİL** (`package.json`, `node_modules/@tailwindcss/
typography` yok, `shadcn/dist/tailwind.css` içinde `prose`/`typography` eşleşmesi yok). Yani `prose`
sınıfı hiçbir CSS kuralı üretmiyor (sıfır etki), `RichContentWithShortcodes`'un ürettiği `<p>`/`<span>`
etiketleri kendi `color` kuralı taşımıyor ve dolayısıyla `.site-scope`'un KENDİ `color: var(--site-text)`
kuralından (aşağıda, zaten var olan bir CSS kuralı) **inherit** ediyor — bu doğru/istenen davranış.
`text` bloğu bu yüzden aşağıdaki düzeltme listesinde YOKTUR (dokunulacak bir şey yok, zaten doğru).

### 0.2 Etkilenen dosyalar — TAM liste (bağlayıcı, backend-agent/frontend-agent bilgi için, bu dosyaların HİÇBİRİ bu turda DEĞİŞMEZ — düzeltme yalnızca globals.css'te)

| Dosya | Kırık sınıf(lar) | Tükettiği `--*` değişken(ler) |
|---|---|---|
| `heading-block.tsx:25,27` | `text-foreground`, `border-primary` (underline) | `--foreground`, `--primary` |
| `icon-box-block.tsx:15,18,19` | `bg-primary/10 text-primary`, `text-foreground`, `text-foreground/70` | `--primary`, `--foreground` |
| `button-block.tsx` → `LinkButton` → `components/ui/button.tsx` | `default`: `bg-primary text-primary-foreground hover:bg-primary-hover`; `outline`: `border-border bg-background hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30`; `ghost`: `hover:bg-muted hover:text-foreground`; `secondary`: `bg-secondary text-secondary-foreground hover:bg-[color-mix(...,var(--foreground)_5%)]`; `link`: `text-primary`; hepsi: `focus-visible:ring-ring/50` | `--primary`, `--primary-foreground`, `--primary-hover`, `--border`, `--background`, `--muted`, `--foreground`, `--input`, `--secondary`, `--secondary-foreground`, `--ring` |
| `cta-block.tsx:22-31` | `WRAPPER_STYLE_CLASS.outline` (`border-border`), `HEADING_TEXT_CLASS.{plain,soft,outline}` (`text-foreground`), `DESCRIPTION_TEXT_CLASS.{plain,soft,outline}` (`text-foreground/70`) — `solid` zaten `text-primary-foreground` kullanır (Button ile aynı zincir) | `--foreground`, `--border`, (dolaylı: `--primary`, `--primary-foreground` Button üzerinden) |
| `counter-block.tsx:22,27` | `text-primary`, `text-foreground/70` | `--primary`, `--foreground` |
| `contact-form-block.tsx:21-22` | `text-foreground`, `text-foreground/60` | `--foreground` |
| `contact-form.tsx` (`ContactFormClient`, `contact-form-block.tsx`'in gerçek form gövdesi) | `FIELD_CLASSES`: `border-border bg-background text-foreground placeholder:text-foreground/40` (buton/link zaten doğru — `bg-[var(--site-button)]`/`text-[var(--site-primary)]` KULLANIYOR, bunlar DOKUNULMAZ); label `text-foreground`; hint `text-foreground/50`; consent label `text-foreground/80` | `--border`, `--background`, `--foreground` |
| `portfolio-card.tsx:20,34-36` | `border-border`, `hover:bg-surface-muted`, `text-foreground` (×2, `text-foreground/60`) | `--border`, `--surface-muted`, `--foreground` |

`--surface-muted` **stabildir/dokunulmaz** — yalnızca `:root`'ta tanımlı, `.dark .admin-shell`
dışında hiçbir yerde override edilmiyor (public site'ta hep aynı açık gri `#f8fafc`); WCAG açısından
sorun değil, yalnızca marka rengiyle uyumsuz — bu tur kapsamı dışında (kozmetik drift, backlog).
`--danger`/`--success`/`--warning` de aynı şekilde stabildir (yalnızca `:root`), dokunulmaz.

### 0.3 Bağlayıcı düzeltme — CSS köprüsü (Seçenek A, TEK dosya: `globals.css`, `.site-scope` bloğu)

**Karar: Seçenek A** (araştırma notundaki A/B'den). Gerekçe: (1) 8 dosyanın/bileşenin HİÇBİRİNE
dokunmadan TÜM şablonları/manuel sayfaları aynı anda düzeltir; (2) `.dark` sınıfının `<html>`'de
olup olmamasından TAMAMEN bağımsızdır (bir elementin KENDİ eşleşen kuralı, atasından inherit edilen
değerden her zaman önceliklidir — `.site-scope` div'i kendi `--primary`'sini tanımladığında, bu,
`.dark`'ın `<html>` üzerinde tanımladığı `--primary`'den bağımsız olarak KAZANIR); (3) gelecekteki
her yeni şablon/sayfa için sıfır ek iş.

**Semantik karar (araştırma notunun bırakılmış tek boşluğu, burada KAPATILIYOR):** `--primary`
Tailwind zincirinde İKİ farklı anlamda kullanılıyor — (a) "vurgu/link/ikon rengi" (`heading` altı
çizgi, `icon-box` ikon halkası, `counter` rakamları, `LinkButton variant="link"`) ve (b) "dolgu buton
rengi" (`LinkButton variant="default"`, yani `cta` bloğunun `style: "plain"/"soft"` birincil butonu).
`SiteAppearance` bu ikisini AYRI slotlara ayırır (`primaryColor` vs `buttonColor`). Tek bir CSS
değişkenle ikisi AYNI ANDA doğru olamaz. **Karar: `--primary` → `var(--site-primary)` (koyu yeşil
`#1C4B42`) bağlanır** — çünkü kullanım SAYISI (a) tarafında daha fazladır (4 dosya) ve `heading`/
`icon-box`/`counter`'ın DESIGN-NOTES §1'de zaten "primaryColor: ikon/vurgu/başlık rengi" olarak
tanımlanmış rolüyle birebir örtüşür. **Kabul edilen sonuç:** `ma-cta-banner-cta` ve
`ma-newsletter-cta` bloklarının ("Bize Ulaşın" / "İletişim Formuna Git") birincil butonu artık
`buttonColor` (antrasit `#1F2124`, header/footer/iletişim formu gönder butonuyla AYNI) DEĞİL,
`primaryColor` (koyu yeşil `#1C4B42`) dolgulu render eder. Bu, WCAG açısından güvenlidir (beyaz metin
`#1C4B42` üzerinde ≈ 8.9:1, bol payla geçer) ve görsel olarak siteye İKİNCİ bir marka tonu katar
(tek-düze antrasit yerine); kabul edilebilir, DOKÜMANTE edilmiş bir tasarım kararıdır — hata DEĞİL.

Aşağıdaki blok, `globals.css`'teki MEVCUT `.site-scope { ... }` kuralının (satır ~459-479) İÇİNE,
zaten tanımlı `--site-primary` vb. satırlarından SONRA eklenir (frontend-agent implementasyonu —
bu dosyanın kapsamı yalnızca DEĞERLERİ/eşlemeyi tanımlamaktır):

```css
.site-scope {
  /* ...mevcut --site-* satırları DEĞİŞMEDEN kalır... */

  /* Admin/dark-mode token köprüsü — bkz. DESIGN-NOTES.md §0.3. `.dark` atasından TAMAMEN
     bağımsız: bu div'in KENDİ --* tanımı, inherit edilen değerden her zaman önceliklidir. */
  --foreground: var(--site-text);
  --primary: var(--site-primary);
  --primary-foreground: var(--site-button-text);
  --primary-hover: color-mix(in oklch, var(--site-primary) 85%, black 15%);
  --secondary: var(--site-surface);
  --secondary-foreground: var(--site-text);
  --muted: color-mix(in oklch, var(--site-text) 6%, var(--site-background) 94%);
  --muted-foreground: var(--site-muted-text);
  --accent: var(--site-accent);
  --accent-foreground: var(--site-text);
  --card: var(--site-surface);
  --card-foreground: var(--site-text);
  --popover: var(--site-surface);
  --popover-foreground: var(--site-text);
  --border: color-mix(in oklch, var(--site-text) 15%, transparent);
  --input: color-mix(in oklch, var(--site-text) 20%, transparent);
  --background: var(--site-background);
  --ring: var(--site-primary);
}
```

`color-mix(...)` kullanan üç satır (`--primary-hover`, `--muted`, `--border`, `--input`) için
`SiteAppearance`'ta AYRI bir slot yoktur (`primaryColor`'ın "hover" tonu, `mutedTextColor`'dan farklı
bir "muted background" tonu, `border` rengi için hiçbir alan tanımlı değildir) — bu üçü, MEVCUT
tokenlerden TÜRETİLİR (yeni bir `SiteAppearance` alanı EKLEMEK bu turun kapsamı dışıdır, architect
onayı gerektirir). `color-mix` tarayıcı desteği: tüm modern tarayıcılarda (Chrome 111+, Safari 16.2+,
Firefox 113+) mevcut — projede zaten `components/ui/button.tsx:16`'da `secondary` varyantında
KULLANILAN AYNI CSS fonksiyonu, yeni bir bağımlılık/teknik DEĞİL.

**Bu düzeltmenin KAPSADIĞI ve KAPSAMADIĞI şey (kritik ayrım, §6.4/§6.7 kararları için — bkz. aşağı):**
Bu köprü, "ziyaretçinin OS'u koyu mod tercih ediyorsa metin rastgele beyazlaşıyor" hatasını düzeltir
— artık HER ZAMAN `--site-text` (`#1F2124`, tek bir sabit koyu değer) kullanılır. **Bu köprü, bir
`heading`/`icon-box`/`counter`/`text` bloğunun LOKAL olarak bulunduğu konteynerin arka planına göre
metin rengini DEĞİŞTİRMESİNİ sağlamaz** — bu bloklar hiçbir zaman "açık zeminde koyu metin, koyu
zeminde açık metin" gibi bağlama duyarlı bir yetenek kazanmaz (`HeadingBlock.data`/`IconBoxBlock.data`/
`CounterBlock.data` şemalarında bir renk alanı YOKTUR, bu turda da EKLENMEZ). Sonuç: bu blokları
DOĞRUDAN barındıran bir `container`, **hâlâ** gerçek koyu dolgu (`secondaryColor #1F2124`)
KULLANAMAZ — metin her zaman `#1F2124` (koyu) render eder ve koyu zeminde görünmez olurdu. Bu, §6.4/
§6.7'nin eski "backlog notu"nun **YANLIŞ bir varsayıma dayandığını** ortaya koyar — bkz. §6.4/§6.7
altındaki güncellenmiş karar.

---

## 1. Renk paleti — NİHAİ (onaylandı, değişiklik yok) + WCAG AA raporu

Architect'in §7.3 başlangıç değerlerinin **hepsi onaylanmıştır**, hiçbir hex değişmedi:

| `SiteAppearance` alanı | Hex | Kullanım |
|---|---|---|
| `primaryColor` | `#1C4B42` | koyu yeşil — linkler, başlık vurgusu, ikon rengi, **ve bu turdan itibaren §0.3 kararı gereği `plain`/`soft` CTA butonlarının dolgusu** |
| `secondaryColor` | `#1F2124` | antrasit — header, footer, slider gradyanı, hero/CTA banner/servis kartı fotoğraf overlay'i |
| `buttonColor` | `#1F2124` | dolgu buton (SOLID) — header CTA, hero slider butonu, iletişim formu gönder butonu (bunlar `--site-button`'ı DOĞRUDAN okur, §0.3 köprüsünden ETKİLENMEZ) |
| `buttonTextColor` | `#FFFFFF` | buton metni |
| `linkColor` | `#1C4B42` | metin içi bağlantı |
| `accentColor` | `#C9A227` | altın aksan — ikon/çizgi/border/rozet dolgusu (bkz. §4 yeni `.pb-badge-pill` sınıfı) |
| `backgroundColor` | `#F6F5F2` | sayfa zemini (sıcak krem) |
| `surfaceColor` | `#FFFFFF` | kart yüzeyi |
| `textColor` | `#1F2124` | gövde/başlık metni |
| `mutedTextColor` | `#6B6F76` | ikincil/gri metin |

`presetKey`: `null` (değişmedi).

### 1.1 Kontrast raporu (WCAG 2.1, sRGB relative luminance formülü ile hesaplandı) — değişmedi

| Çift | Oran | Eşik | Sonuç |
|---|---|---|---|
| `textColor` (#1F2124) / `backgroundColor` (#F6F5F2) | **14.80:1** | 4.5:1 | ✅ |
| `textColor` / `surfaceColor` (#FFFFFF) | **16.14:1** | 4.5:1 | ✅ |
| `buttonTextColor` (#FFFFFF) / `buttonColor` (#1F2124) | **16.14:1** | 4.5:1 | ✅ |
| `buttonTextColor` (#FFFFFF) / `primaryColor` (#1C4B42) — **yeni, §0.3 gereği kontrol edildi** | **~8.9:1** | 4.5:1 | ✅ |
| `linkColor` (#1C4B42) / `backgroundColor` | **9.03:1** | 4.5:1 | ✅ |
| `linkColor` / `surfaceColor` | **9.84:1** | 4.5:1 | ✅ |
| `mutedTextColor` (#6B6F76) / `backgroundColor` | **4.63:1** | 4.5:1 | ✅ (sınırda) |
| `mutedTextColor` / `surfaceColor` | **5.04:1** | 4.5:1 | ✅ |
| `accentColor` (#C9A227) metin olarak / `backgroundColor` | **2.22:1** | 3:1 | ❌ |
| `accentColor` metin olarak / `secondaryColor` (#1F2124) | **6.67:1** | 4.5:1 | ✅ |
| `textColor` (#1F2124) metin olarak / `accentColor` dolgu üstünde (rozet/pill — bkz. §4) | **6.67:1** | 4.5:1 | ✅ |
| beyaz metin / `accentColor` dolgu üstünde | **2.42:1** | 4.5:1 | ❌ |
| beyaz metin (%100) / fotoğraf üstü `secondaryColor` overlay (`opacity: 55-58`, §5/§6.2/§6.6) | pratik ~4.6-6:1 (fotoğraf içeriğine göre değişir, overlay bilerek CTA banner'ın halihazırda kanıtlanmış 55'inden YÜKSEK tutulur — güvenlik payı) | 4.5:1 | ✅ (bkz. §5 gerekçesi) |

### 1.2 Bağlayıcı kullanım kuralları — değişmedi + bir madde eklendi

1. **`accentColor` asla açık zemin üstünde düz metin rengi olarak kullanılmaz.** Yalnızca: (a)
   ikon/stroke, (b) `border`, (c) koyu zemin üstünde metin/ikon, (d) rozet/pill arka planı —
   üstüne **`textColor` yazılır, beyaz DEĞİL**.
2. Koyu zeminler (`secondaryColor`) üstüne **yalnızca kendi arka planı VE kendi metin rengini
   BİRLİKTE, aynı yerde tanımlayan** öğeler güvenlidir: slider katmanları, header/footer,
   fotoğraf+overlay konteynerleri (metin YOKSA veya `.pb-badge-pill` gibi kendi renk çiftini
   taşıyan bir öğe varsa), `cta` bloğunun `style: "solid"` tonu (`bg-primary` + `text-primary-
   foreground` birlikte gelir). **`heading`/`icon-box`/`counter`/`text` bloğu TEK BAŞINA asla**
   (bkz. §0.3 son paragraf).
3. `mutedTextColor` sınırda (4.63:1) — küçük yardımcı metinlerde kullan, ana gövde için `textColor`.
4. **YENİ:** Fotoğraf arka planlı bir konteynerin İÇİNDE `heading`/`icon-box`/`text`/`counter`
   render EDİLMEZ (metin rengi fotoğrafa göre uyum sağlamaz, kontrast garanti edilemez). Fotoğraflı
   konteynerler ya (a) metin TAŞIMAZ (yalnızca `.pb-badge-pill` gibi kendi kapalı renk çiftine sahip
   bir rozet), ya da (b) `secondaryColor` opaklıklı overlay + üstünde YALNIZCA slider katmanı /
   `cta style="soft|solid"` gibi kendi rengini kendi taşıyan bir blok barındırır.

---

## 2. Tipografi ve `borderRadius` — değişmedi

| Alan | Değer |
|---|---|
| `headingFont` | `PLUS_JAKARTA_SANS` |
| `bodyFont` | `INTER` |
| `baseFontSize` | `16` |
| `borderRadius` | `MD` (8px) |
| `buttonStyle` | `SOLID` |

**Not (bu tur doğrulandı, kod okunarak):** `frontend/src/components/site/blocks/container-block.tsx`
konteyner `<div>`'ine **hiçbir köşe yuvarlama (`border-radius`) uygulamaz** — `--site-radius`
token'ı konteynerlere HİÇ bağlı değildir (yalnızca `Button`/kart gibi bileşen-seviyesi öğelerde
kullanılır). Yani sayfa bloklarındaki fotoğraflı/renkli konteynerler HER ZAMAN keskin köşelidir —
bu bir hata değil, mevcut render motorunun bir sınırıdır; §6'daki hiçbir kompozisyon köşe
yuvarlama VARSAYMAZ.

Pill görünüm yalnızca slider katmanlarında (`SliderLayerStyle.borderRadius: 100`) VE bu turda
eklenen **`.pb-badge-pill`** CSS sınıfında (§4) elde edilir — ikisi de "blok/katman seviyesinde
zaten var olan bir alan" ya da "text bloğunun html'ine gömülü, önceden tanımlı bir CSS sınıfı"
üzerinden çalışır, global `borderRadius` token'ını DEĞİŞTİRMEZ (`.blog-gallery`/`.pb-reveal-*`
sınıflarıyla AYNI, halihazırda projede var olan "text/html içine gömülü, sabit CSS sınıfı" deseni
— yeni bir icat DEĞİL).

---

## 3. Spacing ölçeği — değişmedi

**8, 16, 24, 32, 48, 64, 80, 96, 120** (px).

---

## 4. İkon seçimleri + YENİ: `ArrowUpRight` ve `.pb-badge-pill`

### 4.1 İkon tablosu (allowlist'ten, değişmedi + 1 satır eklendi)

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
| **YENİ** — Hizmet/portföy kartı "İncele" butonu | `ArrowUpRight` | (ikon-yalnız veya kısa etiketle, bkz. §4.2) |

### 4.2 `ArrowUpRight` allowlist'e eklenmesi — ONAYLANDI

`frontend/src/lib/page-builder/icon-options.ts::ICON_OPTIONS`'a tek satır eklenir:
```ts
import { ArrowUpRight, /* ...mevcut importlar... */ } from "lucide-react";
// ICON_OPTIONS Record'una:
ArrowUpRight,
```
Düşük risk (mevcut bir seçim listesine eleman ekleme, blok şemasını/API kontratını DEĞİŞTİRMEZ),
architect onayı GEREKMEZ (araştırma notunda zaten doğrulandı, `lucide-react`'te mevcut).

### 4.3 Dairesel-yalnız-ikon buton kısıtı — DOĞRULANDI, kompromis BAĞLAYICI

`frontend/src/lib/page-builder/types.ts:334-337`: `ButtonBlock.data.label: string` **ZORUNLU**
(opsiyonel değil, boş string a11y açısından da kabul edilmez — etiketsiz bir buton ekran okuyucu
için isimsiz kalır). **Tam piksel-birebir "yalnızca ikon, dairesel" buton bu turda desteklenmez.**

**Kompromis (bağlayıcı):** Hizmet kartlarındaki "İncele" eylemi `button` bloğu ile, **`style: "ghost"`,
`size: "sm"`, `icon: "ArrowUpRight"`, `label: "İncele"`, `align: "right"`** olarak uygulanır — ikon
+ kısa etiket, dairesel DEĞİL (global `borderRadius: MD` 8px miras alınır, §7.2 architect kararı
gereği `!rounded-full` gibi tek seferlik sınıf EKLENMEZ). Bu, sayfa-builder JSON'undan üretilen
butonlar İÇİN geçerlidir.

**`PortfolioCard` bileşeni İSTİSNADIR (§6.3'te detay):** bu, page-builder JSON'undan üretilen bir
`button` bloğu DEĞİL, sabit bir React bileşenidir (`frontend/src/components/site/portfolio-card.tsx`)
— `ButtonBlock.data.label` zorunluluğuna TABİ DEĞİLDİR. Orada gerçek dairesel, yalnızca-ikon bir
rozet (`ArrowUpRight`, `lucide-react`'ten doğrudan import, allowlist mekanizmasının DIŞINDA — bu
bileşen zaten kullanıcı JSON'undan icon adı okumuyor) frontend-agent tarafından eklenir; `aria-hidden`
+ kartın kendisi zaten `<Link>` olduğu için (tüm kart tıklanabilir) bu ikon salt DEKORATİF sayılır,
ayrı bir erişilebilir isme ihtiyaç duymaz.

### 4.4 YENİ — `.pb-badge-pill` CSS sınıfı (rozet/pill, `text` bloğu html'i içinde kullanılır)

**Sorun:** `backend/src/lib/html-sanitize.ts::SANITIZE_OPTIONS.allowedAttributes["*"] = ["id",
"class"]` — `style` özniteliği İZİN LİSTESİNDE DEĞİL (bilerek, CSS enjeksiyon yüzeyini kapatmak
için). Yani `text` bloğunun html'i içine `<span style="...">` İLE renkli bir rozet YAZILAMAZ.
`class` özniteliği İSE izinlidir — ama sanitizer sınıf ADINI keyfi kabul eder, GERÇEK GÖRSEL EFEKTİ
yalnızca `globals.css`'te GERÇEKTEN TANIMLI bir sınıf üretir. Proje bunun için zaten bir emsale
sahiptir: `.blog-gallery`/`.blog-gallery__item` (`globals.css:154-198`) — ham HTML/
`dangerouslySetInnerHTML` içine düşen, Tailwind JIT'in TARAYAMADIĞI ama önceden `globals.css`'e
YAZILMIŞ sabit bir sınıf.

**Karar (bağlayıcı, frontend-agent `globals.css`'e ekler — bu SITE GENELİ, yalnızca
`modern-architecture`'a özel DEĞİL bir tasarım tokenidir, TÜM şablonlar/manuel sayfalar
kullanabilir):**

```css
/*
 * Metin bloğu (`text`) html'i içinde gömülü "rozet/pill" — sanitizer yalnızca `class`
 * özniteliğine izin verdiği için (`html-sanitize.ts`, `style` YASAK) renk/boşluk DEĞERLERİ
 * burada, sabit bir sınıfta tanımlanır. `.blog-gallery` ile AYNI desen. `var(--site-*)`
 * kullanır — o an aktif SiteAppearance'a göre otomatik uyarlanır, tek bir şablona ÖZEL DEĞİLDİR.
 */
.pb-badge-pill {
  display: inline-flex;
  align-items: center;
  padding: 8px 18px;
  border-radius: 999px;
  background-color: var(--site-accent);
  color: var(--site-text);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 1;
}
```

Kullanım: `data.html: "<span class=\"pb-badge-pill\">HİZMETLERİMİZ</span>"` (bkz. §6.2). WCAG:
`textColor` / `accentColor` çifti §1.1'de zaten **6.67:1** ile doğrulanmıştır — bu sınıf o çifti
birebir kullanır, YENİ bir kontrast hesaplaması gerekmez. Bu, `container`'ın `background.type:
"image"` fonuna bakılmaksızın HER ZAMAN opak/okunaklıdır (kendi arka planını taşır) — §1.2 madde 4
istisnasının somut örneğidir.

---

## 5. Hero — `Slider` + `Slide[].layers` — GERÇEK FOTOĞRAF (değişti)

### 5.1 Slider ayarları (değişmedi)

```
widthMode: "full-width"
heightMode: "aspect-ratio", aspectRatioWidth: 16, aspectRatioHeight: 9, heightPx: null
autoplay: true, intervalMs: 6000, loop: true, pauseOnHover: true
transitionEffect: "fade", transitionDurationMs: 600
showArrows: true, showBullets: true, showProgressBar: false
navigationTheme: "dark"
```

### 5.2 KARAR — arka plan artık `bgType: "gradient"` DEĞİL, `"image"`

Architect §4.4 madde 1'in "hero arka planı görsel DEĞİL, gradient'tır" kararının gerekçesi ("referans
sitenin fotoğrafını KOPYALAYAMIYORUZ") bu tur GEÇERSİZDİR — artık genel stok mimari fotoğraf
kullanımı YETKİLİDİR (bkz. dosya başı v2 notu madde 2). Gradyan yerine gerçek fotoğraf, "Vercel/
Linear/Stripe kalitesinde" istenen sinematik/zengin görünüme doğrudan katkı sağlar ve LCP maliyeti
(3 adet 1920×1080 JPEG, `MAX_TEMPLATE_ASSET_BYTES` 512KB altına sıkıştırılmış — q75 JPEG'de
1920×1080 tipik 150-280KB) kabul edilebilir bir bedeldir (yalnızca AKTİF slayt yüklenir, `Slider`
zaten `loading="lazy"` olmayan yalnızca ilk slaydı öncelikli render eder — bu render detayı
frontend-agent'ın mevcut `advanced-slider` implementasyonunda zaten çözülü, burada YENİDEN
TARTIŞILMAZ).

**Her slayt için:**
```
bgType: "image"
bgAssetKey: "hero-bg-1" | "hero-bg-2" | "hero-bg-3"
bgPositionX: 50, bgPositionY: 50
bgOverlayColor: "#1F2124", bgOverlayOpacity: 58
bgGradientFrom: null, bgGradientTo: null, bgGradientAngle: 0
bgKenBurns: true   // YENİ — durağan fotoğrafa hafif sinematik hareket, `Slide` modelinde zaten var olan bir alan
durationMs: null, linkHref: null, linkNewTab: false
```

**Overlay opaklığı neden 58 (CTA banner'ın 55'inden biraz yüksek):** hero fotoğrafları CTA
banner'dan FARKLI olarak parlak gökyüzü/cam cephe/beton içerebilir (fotoğraf seçimi backend-agent'a
bırakılıyor, önceden göremiyoruz) — 3 puanlık ek pay, olası açık tonlu fotoğraflarda bile beyaz
metnin WCAG AA'yı korumasını garanti eder (bkz. §1.1 son satır).

### 5.3 3 slayt — fotoğraf yönü (Unsplash arama önerisi, backend-agent gerçek URL/ID'yi seçer)

| Slayt | Asset key | Unsplash arama/kategori önerisi | Kompozisyon/kırpma | Rozet | Başlık | Buton |
|---|---|---|---|---|---|---|
| 1 | `hero-bg-1` | `"modern architecture building facade"` / `"minimalist concrete building exterior"` | 16:9 yatay, geniş açı, binanın ALT SOL çeyreği görece sade (metin orada, `xPercent:8`) | "Mimarlık & İnşaat" | "Mekanı Anlamlı Yapıya Dönüştürüyoruz" | "Projelerimizi İnceleyin" → `/portfolio` |
| 2 | `hero-bg-2` | `"construction site scaffolding architecture"` / `"architect blueprint construction"` | 16:9 yatay, şantiye/iskele veya mimarlık ofisi plan masası | "Proje Yönetimi" | "Yapısal Bütünlük, Zamanında Teslim" | "Süreci Nasıl Yönetiyoruz?" → `/` |
| 3 | `hero-bg-3` | `"sustainable green building glass facade"` / `"modern glass office building daylight"` | 16:9 yatay, cam cephe/doğal ışık, sürdürülebilirlik hissi | "Sürdürülebilir Tasarım" | "Çağdaş ve Sürdürülebilir Mimari" | "Bize Ulaşın" → `/` |

Ortak `bgOverlayColor:"#1F2124"`, `bgOverlayOpacity:58` yukarıdaki tabloya EK olarak her üç slaytta
da geçerlidir. Metin gövdesi (her slaytta): "Kütle Yapı; konut, ticari ve endüstriyel projelerde
tasarımdan anahtar teslime uzanan bütünsel bir yaklaşım sunar." (değişmedi).

### 5.4 Katman stilleri — değişmedi (bkz. eski §5, kod zaten uygulanmış, `templates/modern-architecture.ts::buildHeroLayers`)

Katman JSON'u (`badge`/`heading`/`text`/`button`) BU TUR DEĞİŞMEZ — yalnızca `Slide` seviyesindeki
`bgType`/`bgAssetKey`/`bgOverlayColor`/`bgOverlayOpacity`/`bgKenBurns` alanları güncellenir.

---

## 6. Sayfa bölümleri — `ContainerSettings`

> Genel kural: `layout: "boxed"` konteynerlerde `customWidth` belirtilmez (1170 varsayılan). Tüm
> `margin` değerleri aksi belirtilmedikçe `{top:0,right:0,bottom:0,left:0}`.

### 6.1 Bölüm 2 — Hero — değişmedi (§5'e bkz.)

### 6.2 Bölüm 3 — 3'lü hizmet kartları — YENİDEN TASARLANDI (fotoğraf + rozet + "İncele" butonu)

**Neden yeniden tasarlandı:** Eski kompozisyon (düz renk kart + `icon-box`) mevcut kalır ama görsel
zenginlik için her kart artık ÜSTTE bir fotoğraf + rozet, ALTTA (beyaz zeminde, GÜVENLİ) ikon+başlık+
açıklama+"İncele" butonu taşır. §1.2 madde 4 gereği fotoğraf ALANI hiçbir `heading`/`icon-box`/`text`
barındırmaz — yalnızca kendi renk çiftini taşıyan `.pb-badge-pill` (§4.4).

Dış konteyner (değişmedi):
```
layout: "boxed", direction: "row", justifyContent: "center", alignItems: "stretch", gap: 32,
padding: {top:96,right:24,bottom:96,left:24}
background: { type: "color", value: "#F6F5F2" }
```
Üstte ortak başlık (mevcut kodda zaten var, `ma-services-heading`, "Hizmetlerimiz", level 2, center)
— DEĞİŞMEDİ.

3 × kart konteyner (her biri `widthFr: 1`, **artık HER ÜÇÜ DE `#FFFFFF`** — fotoğraflar zaten
birbirinden farklı olduğu için `#EFE6CE` ile alternatif renklendirme kaldırıldı, gereksiz/keyfi
bir görsel fark yaratıyordu):
```
layout: "full-width", direction: "column", justifyContent: "start", alignItems: "stretch",
gap: 0, padding: ZERO_SPACING, background: { type: "color", value: "#FFFFFF" }, widthFr: 1
```
Her kartın İKİ çocuğu:

**Çocuk 1 — fotoğraf şeridi (metin YOK, yalnızca rozet):**
```
layout: "full-width", direction: "row", justifyContent: "start", alignItems: "start",
gap: 0, padding: {top:24,right:24,bottom:24,left:24},
minHeight: { value: 220, unit: "px" },
background: { type: "image", value: "asset:service-<n>", position: "center", size: "cover", repeat: "no-repeat" }
```
  → `text` bloğu: `data.html: "<span class=\"pb-badge-pill\">MİMARİ TASARIM</span>"` (kart 2:
  "İNŞAAT & UYGULAMA", kart 3: "PROJE YÖNETİMİ" — rozet metni `icon-box`'ın `heading` alanının
  BÜYÜK HARFLİSİ, ayrı bir çeviri/metin değil).

**Çocuk 2 — içerik paneli (beyaz zemin, GÜVENLİ):**
```
layout: "full-width", direction: "column", justifyContent: "start", alignItems: "start",
gap: 16, padding: {top:32,right:32,bottom:32,left:32}, background: { type: "none" }
```
  → `icon-box` (mevcut veri AYNEN korunur — `Compass`/"Mimari Tasarım"/açıklama, vb., §4.1 tablosu)
  → `button`: `{ label: "İncele", href: "/", style: "ghost", size: "sm", icon: "ArrowUpRight", align: "right" }`

**Fotoğraf yönü (Unsplash arama önerisi):**

| Kart | Asset key | Arama önerisi | Kompozisyon |
|---|---|---|---|
| 1 — Mimari Tasarım | `service-design` | `"architectural model design studio"` / `"architect blueprint drafting table"` | yatay ~5:3, masa üstü plan/maket, sıcak ışık |
| 2 — İnşaat & Uygulama | `service-construction` | `"construction site crane building"` / `"construction workers building site"` | yatay ~5:3, aktif şantiye, gündüz |
| 3 — Proje Yönetimi | `service-management` | `"architecture team meeting blueprint office"` / `"architects reviewing plans office"` | yatay ~5:3, ofis/toplantı, plan incelemesi |

Hedef boyut: 1200×720 (yaklaşık 5:3, `minHeight:220px` bant için `size:"cover"` ile kırpılır).

### 6.3 Bölüm 4 — 4 sütunlu proje portföyü — kompozisyon AYNI, `PortfolioCard` GÖRSEL OLARAK ZENGİNLEŞTİRİLDİ

Sayfa-builder tarafı (`heading` → `featured-portfolio` → `button`) **DEĞİŞMEDİ**:
```
layout: "boxed", direction: "column", justifyContent: "center", alignItems: "center", gap: 40,
padding: {top:96,right:24,bottom:96,left:24}, background: { type: "color", value: "#FFFFFF" }
```
`heading` (level 2, center, "Öne Çıkan Projelerimiz") → `featured-portfolio` (`data.limit: 8`) →
`button` (align center, style outline, size md, "Tüm Projeleri Gör", href `/portfolio`).

**`PortfolioCard` bileşeni (`frontend/src/components/site/portfolio-card.tsx`) — görsel karar
(implementasyon frontend-agent'a ait, bu bir sabit React bileşeni, page-builder JSON'u DEĞİL):**

1. **Dikey en-boy oranı:** `aspect-square` → `aspect-[4/5]` (dikey, "dikey bina fotoğrafı" hissi;
   referans sitenin portföy kartlarıyla aynı yön).
2. **Hover mikro-etkileşimi:** kapak görseline `transition-transform duration-300
   group-hover:scale-105` (kart `<Link>`e `group` sınıfı eklenir, resim sarmalayıcısına
   `overflow-hidden` zaten var); başlığa `group-hover:text-[var(--site-primary)] transition-colors`.
3. **Dairesel yönlendirme rozeti (§4.3 istisnası):** kapak görselinin sağ-üst köşesine `absolute
   top-4 right-4` (16px), `size-10` (40px), `rounded-full`, `bg-[var(--site-surface)]/90`,
   `text-[var(--site-text)]`, içinde `ArrowUpRight` (lucide-react, DOĞRUDAN import — bu bileşen
   `icon-options.ts` allowlist mekanizmasını KULLANMAZ, kullanıcı JSON'undan ikon adı okumaz).
   `aria-hidden` (kart zaten tek bir `<Link>`, bu ikon dekoratif).
4. **Kart yüzeyi:** mevcut `rounded-lg border border-border` (artık §0.3 köprüsüyle GÜVENLİ) korunur,
   `shadow-sm hover:shadow-md transition-shadow` eklenir (hafif elevation — glassmorphism DEĞİL, düz
   gölge, minimal/flat yönle uyumlu).
5. **Metin bloğu:** mevcut yapı (başlık, `clientName`, `summary`, hepsi `text-foreground`/
   `text-foreground/60` zaten §0.3'le düzeltildi) DEĞİŞMEZ, yalnızca madde 2'deki hover rengi
   eklenir.

**ÖNEMLİ — kapsam notu:** Bu, `PortfolioCard`'ın TEK bileşeni olarak TÜM site genelinde (bu şablon
DIŞINDAKİ portföy sayfaları/diğer şablonlar DAHİL) kullanıldığı için, yukarıdaki değişiklikler
`modern-architecture`'a özel değildir — SITE GENELİ bir görsel iyileştirmedir (`var(--site-*)`
token'larını kullandığı için her şablonun kendi paletine otomatik uyar). `ArrowUpRight` rozeti VE
`aspect-[4/5]` her portföy görünümünde görünür olacaktır — bu kabul edilebilir/istenen bir yan
etkidir (genel bir kart iyileştirmesi), ama frontend-agent bunu bilerek ADMIN önizlemesinde/diğer
şablonlarda da test etmelidir.

**Portföy kapak fotoğrafı yönü (4 adet, Unsplash arama önerisi — SVG illüstrasyon yerine):**

| `key` | Arama önerisi | Kompozisyon |
|---|---|---|
| `portfolio-cover-1` | `"modern residential building twin towers"` / `"apartment complex modern architecture"` | dikey kırpım, bina cephesi alttan-yukarı açı |
| `portfolio-cover-2` | `"modern commercial office building"` / `"stepped terrace building architecture"` | dikey kırpım, kademeli/teraslı cephe |
| `portfolio-cover-3` | `"corporate headquarters building columns"` / `"colonnade building facade"` | dikey kırpım, kolonlu giriş/cephe |
| `portfolio-cover-4` | `"mixed use building complex skyline"` / `"modern building cluster architecture"` | dikey kırpım, farklı yükseklikte yapı kümesi |

Hedef boyut: 960×1200 (4:5 dikey, `PortfolioCard`'ın yeni `aspect-[4/5]`'iyle birebir kırpım
oranı — `object-cover` zaten var, tam eşleşme zorunlu değil ama gereksiz kırpımı azaltır).

### 6.4 Bölüm 5 — "Farkımızla Tanışın" paneli — KARAR TEYİT EDİLDİ (gold-tint KALIYOR, gerekçe DÜZELTİLDİ)

**Eski gerekçe YANLIŞTI, DÜZELTME:** Eski dokümanın "backlog notu" ("§0 düzeltmesinden SONRA gerçek
koyu zemin kullanılabilir") **hatalı bir varsayıma** dayanıyordu — §0.3'ün son paragrafında
açıklandığı gibi, kök-neden düzeltmesi blokların LOKAL zemine duyarlı hale gelmesini SAĞLAMAZ,
yalnızca "hangi sabit rengi kullanacakları" konusunda OS/tarayıcı tercihinden bağımsız, TUTARLI
hale getirir. `heading`/`icon-box` bu panelde HÂLÂ `textColor` (`#1F2124`, koyu) render eder —
gerçek `secondaryColor` (`#1F2124`) zemin üstünde bu, **koyu metin koyu zeminde, görünmez** olurdu.
**Karar: `#EFE6CE` (gold-tint) zemin KALIR**, DEĞİŞMEZ:
```
layout: "full-width", direction: "column", justifyContent: "center", alignItems: "center",
gap: 56, padding: {top:96,right:24,bottom:96,left:24}
background: { type: "color", value: "#EFE6CE" }
topDivider: { type: "curve", color: "#FFFFFF", height: 100, flip: false }
```
İçerik (4 × `icon-box`: `Award`/`Clock`/`Handshake`/`ShieldCheck`) DEĞİŞMEDİ.

**Gerçek koyu zemin isteniyorsa (backlog, bu tur KAPSAM DIŞI):** `feature/page-builder-block-local-
text-color` — `HeadingBlock`/`IconBoxBlock`/`CounterBlock`/`TextBlock` şemalarına opsiyonel bir
`textTone: "auto" | "light" | "dark"` alanı eklenmesi (architect onayı + backend Zod şeması + 4
bileşen dosyasında küçük bir değişiklik gerektirir — bu turun "yeni blok yeteneği YOK" kısıtına
girer, YAPILMAZ).

### 6.5 Bölüm 6 — Sayaç bandı — DAVRANIŞ DEĞİŞTİ (kod DEĞİŞMEDİ), doğrulama

Sayfa JSON'u (`templates/modern-architecture.ts::countersSection`) **DEĞİŞMEZ**:
```
layout: "boxed", direction: "row", justifyContent: "evenly", alignItems: "center", gap: 32,
padding: {top:64,right:24,bottom:64,left:24}, background: { type: "color", value: "#F6F5F2" }
```
`counter` bloğu 4 öğe (15+/120+/45/%98) — DEĞİŞMEDİ. **Kullanıcı isteği ("sayaç tipografisinin
belirgin koyu yeşil/siyah olması") §0.3 düzeltmesiyle OTOMATİK karşılanır** — `counter-block.tsx:22`
`text-primary` artık (köprü sayesinde) HER ZAMAN `var(--site-primary)` (`#1C4B42`, koyu yeşil,
`font-bold text-4xl` ile zaten kalın/büyük) render eder; hiçbir veri/kod değişikliği GEREKMEZ, bu
madde yalnızca doğrulama notudur.

### 6.6 Bölüm 7 — Koyu CTA banner — fotoğraf yönü güncellendi, yapı AYNI

Konteyner yapısı DEĞİŞMEDİ (zaten §1.2 madde 4'ün "güvenli" örneğiydi — `cta` bloğu `style: "soft"`
kendi renk çiftini taşır):
```
layout: "full-width", direction: "column", justifyContent: "center", alignItems: "start",
gap: 24, padding: {top:96,right:48,bottom:96,left:48}, minHeight: { value: 480, unit: "px" }
background: {
  type: "image", value: "asset:cta-banner", position: "center", size: "cover", repeat: "no-repeat",
  overlay: { color: "#1F2124", opacity: 55 }
}
```
`cta` bloğu (`style: "soft"`, `align: "left"`, "Projenizi Birlikte Hayata Geçirelim" / "Bize Ulaşın"
→ `/`) DEĞİŞMEDİ.

**Fotoğraf yönü (değişti — SVG siluet illüstrasyonu yerine gerçek fotoğraf):** Unsplash arama
önerisi: `"modern building exterior dusk golden hour"` / `"large architecture office building night
lights"`. Kompozisyon: 1920×720 panoramik yatay kırpım, binanın SOL/ALT bölgesi görece sade (metin
orada, `align:"left"`, konteyner `padding-left:48`). Overlay opaklığı **55 KALIR** (kanıtlanmış
mevcut değer, değiştirilmedi).

### 6.7 Bölüm 8 — Bölünmüş iletişim formu — sağ panel YENİDEN TASARLANDI (fotoğraf + pill rozetler)

Sol panel (form) **DEĞİŞMEDİ**:
```
layout: "full-width", direction: "column", justifyContent: "center", alignItems: "start",
gap: 24, padding: {top:96,right:64,bottom:96,left:64}, background: { type: "color", value: "#F6F5F2" }, widthFr: 1
```
`heading` ("Bize Ulaşın") → `text` (tanıtım cümlesi) → `contact-form` (`showTitle:false`) — AYNI.

**Sağ panel — KARAR (gerçek koyu zemin YİNE KULLANILMAZ, gerekçe §6.4 ile AYNI) ama görsel olarak
zenginleştirildi:** `about-image` varlığı (eskiden hiçbir bloğa bağlı DEĞİLDİ, §7 eski tablosunda
not edilmişti) artık BU panelin arka planı olarak KULLANILIR — ağır bir AÇIK overlay ile (metin
güvenliği İÇİN, §1.2 madde 4'ün "fotoğraflı konteyner metin taşımaz" kuralının bir GEVŞETMESİ
DEĞİL, aksine ZORLANMASI: overlay o kadar yüksek opaklıkta ki efektif zemin pratik olarak
`backgroundColor`'a eşdeğerdir, fotoğraf yalnızca hafif bir doku/motif olarak sızar):

```
layout: "full-width", direction: "column", justifyContent: "center", alignItems: "start",
gap: 24, padding: {top:96,right:64,bottom:96,left:64}, widthFr: 1
background: {
  type: "image", value: "asset:about-image", position: "center", size: "cover", repeat: "no-repeat",
  overlay: { color: "#F6F5F2", opacity: 85 }
}
```

İçerik (DEĞİŞMEDİ + rozet formatı eklendi):
- `icon-box` (`Building2`, heading "Ofisimiz", description "Örnek Mah. Örnek Cad. No: 1, Kadıköy /
  İstanbul") — güvenli (efektif zemin krem, §1.1'deki `textColor`/`backgroundColor` 14.80:1 ile
  pratik olarak aynı).
- **YENİ format** — `text` bloğu, telefon/e-posta artık düz `<p>` yerine `.pb-badge-pill` (§4.4)
  ile "dairesel rozet/kutu" görünümünde:
  `data.html: "<span class=\"pb-badge-pill\">+90 212 000 00 00</span> <span class=\"pb-badge-
  pill\">info@example.com</span>"` (iki ayrı pill, yan yana `inline-flex` sardığı için doğal
  olarak satır sarar; `flex-wrap` gerekmiyor, `span`lar `inline-flex` olduğu için akış İÇİNDE
  yan yana dizilir).

**Fotoğraf yönü (`about-image`):** Unsplash arama önerisi: `"architecture office interior workspace
natural light"` / `"architectural blueprint floor plan close-up"`. Hedef boyut: 1200×900 (4:3),
yatay, kompozisyonun ORTA-ALT bölgesi görece sade doku (yoğun detay değil) tercih edilir — %85
opaklıklı krem overlay zaten çoğu detayı yumuşatacaktır.

### 6.8 Bölüm 9 — Bülten çubuğu — DEĞİŞMEDİ

```
layout: "boxed", direction: "column", justifyContent: "center", alignItems: "center", gap: 16,
padding: {top:64,right:24,bottom:64,left:24}, background: { type: "color", value: "#FFFFFF" }
```
`cta` bloğu (`style: "plain"`, "Projenizi Konuşalım" / "İletişim Formuna Git" → `/`) DEĞİŞMEDİ.

### 6.9 Bölüm 1 (header) / 10 (footer) — değişmedi

`site-header.tsx`/`site-footer.tsx` zaten `var(--site-button)`/`var(--site-link)` OKUYOR, §0.3
köprüsünden bağımsız olarak zaten doğruydu — dokunulmaz.

---

## 7. Varlıklar (`DemoTemplateAsset[]`) — TAMAMEN YENİDEN TANIMLANDI (SVG→PNG yerine gerçek fotoğraf)

### 7.1 Karar — `_source/*.svg` + `build-template-assets.ts` script'i BU VARLIKLAR İÇİN ARTIK KULLANILMAZ

Architect §4.3'ün "SVG kaynak → `node:zlib` ile PNG üret" akışı, düz renk/gradyan illüstrasyonlar
İÇİNDİ. Gerçek fotoğraf bu akışla ÜRETİLEMEZ (bir SVG deseninden fotogerçekçi bir bina fotoğrafı
render edilemez). **Karar:** backend-agent, aşağıdaki 12 varlık için Unsplash'ten (özgür lisans)
gerçek JPEG indirir, `imageSize()`ten geçirir, `MAX_TEMPLATE_ASSET_BYTES` (512KB) altına sıkıştırır
(gerekirse yeniden kodlar — bu bir backend-agent implementasyon detayıdır, bu doküman yalnızca
YÖNÜ/boyutu belirler). Eski `_source/*.svg` dosyaları (`portfolio-cover-*.svg`, `cta-banner.svg`,
`about-image.svg`) **depoda KALABİLİR** (tarihsel referans/geri dönüş planı B — eğer network erişimi
olmayan bir CI/geliştirme ortamında import test edilmek istenirse) ama `assets[]` TANIMINDA
ARTIK REFERANS EDİLMEZ.

### 7.2 `assets[]` — TAM liste (12 varlık, `MAX_TEMPLATE_ASSETS: 24` sınırının altında)

| `key` | Boyut (hedef) | Unsplash arama önerisi | `altText` |
|---|---|---|---|
| `hero-bg-1` | 1920×1080 | `"modern architecture building facade"` | "Kütle Yapı — modern mimari bina cephesi, hero görseli 1" |
| `hero-bg-2` | 1920×1080 | `"construction site scaffolding architecture"` | "Kütle Yapı — inşaat sahası, hero görseli 2" |
| `hero-bg-3` | 1920×1080 | `"sustainable green building glass facade"` | "Kütle Yapı — sürdürülebilir cam cephe bina, hero görseli 3" |
| `service-design` | 1200×720 | `"architectural model design studio"` | "Kütle Yapı — mimari tasarım stüdyosu" |
| `service-construction` | 1200×720 | `"construction site crane building"` | "Kütle Yapı — inşaat sahası uygulama çalışması" |
| `service-management` | 1200×720 | `"architecture team meeting blueprint office"` | "Kütle Yapı — proje yönetimi ekip toplantısı" |
| `portfolio-cover-1` | 960×1200 | `"modern residential building twin towers"` | "Kütle Yapı — konut projesi kapak görseli" |
| `portfolio-cover-2` | 960×1200 | `"modern commercial office building"` | "Kütle Yapı — ticari proje kapak görseli" |
| `portfolio-cover-3` | 960×1200 | `"corporate headquarters building columns"` | "Kütle Yapı — kurumsal proje kapak görseli" |
| `portfolio-cover-4` | 960×1200 | `"mixed use building complex skyline"` | "Kütle Yapı — karma kullanım proje kapak görseli" |
| `cta-banner` | 1920×720 | `"modern building exterior dusk golden hour"` | "Kütle Yapı — akşam ışığında bina cephesi, iletişim çağrısı görseli" |
| `about-image` | 1200×900 | `"architecture office interior workspace natural light"` | "Kütle Yapı — mimarlık ofisi iç mekan görseli" |

Tüm görseller: (a) gerçek marka/logo/kişi/tanınabilir yüz İÇERMEZ (Unsplash'te "mimari/bina/şantiye"
odaklı arama zaten bunu doğal olarak sağlar, backend-agent seçim yaparken bu kritere göz atmalı,
insan yüzü belirgin olan fotoğraflardan kaçınılır), (b) özgür lisanslı (Unsplash License, atıf
gerektirmez ama backend-agent isterse `Media.altText`'e fotoğrafçı adı EKLEMEZ — KVKK/telif
gerekçesiyle sade tutulur), (c) `detectImageMimeType`'tan geçen gerçek JPEG.

### 7.3 `MAX_TEMPLATE_ASSET_BYTES` (512KB) notu

1920×1080/1920×720 JPEG q75-80 tipik 150-300KB üretir — sınırın altında, ekstra sıkıştırma
genelde gerekmez. Eğer bir görsel sınırı aşarsa backend-agent kaliteyi q65'e düşürebilir (görsel
kalite kaybı gözle fark edilmeyecek düzeydedir) — bu bir implementasyon detayıdır, tasarım kararı
DEĞİLDİR.

---

## 8. `preview.svg`/`preview.webp` — devir teslim, DÜŞÜK ÖNCELİK (backlog, bu tur zorunlu DEĞİL)

Mevcut `frontend/public/demo-templates/modern-architecture/preview.svg` (kompozit mockup, gerçek
metin İÇERMEZ) yeni fotoğraf yönünü YANSITMIYOR — teknik olarak GÜNCEL DEĞİL. **Karar: bu tur
ZORUNLU değil, backlog'a alınır.** Gerekçe: `previewImageUrl` yalnızca admin galerisinde şablon
seçim kartı için kullanılır (kullanıcı deneyimini doğrudan etkilemez, canlı siteyi ETKİLEMEZ);
gerçek fotoğraflı bir `preview.webp` üretmek (ekran görüntüsü alma + WEBP encode, ui-designer'ın
implementasyon kapsamı dışı, §8 eski notu) ayrı bir küçük görev olarak `documentation-agent`/
`devops-agent` tarafından, import gerçek fotoğraflarla test edildikten SONRA yapılabilir. Şimdilik
`previewImageUrl` **DEĞİŞMEZ** (`"/demo-templates/modern-architecture/preview.svg"`, mevcut
istisna notu geçerliliğini korur).

---

## 9. Kontrol listesi (backend-agent bu dosyayı uyguladıktan sonra)

- [ ] `globals.css::.site-scope` bloğuna §0.3'teki 15 satır (`--foreground` … `--ring`) EKLENDİ
- [ ] `globals.css`'e `.pb-badge-pill` sınıfı (§4.4) EKLENDİ
- [ ] `icon-options.ts::ICON_OPTIONS`'a `ArrowUpRight` EKLENDİ (§4.2)
- [ ] `portfolio-card.tsx` görsel güncellemeleri (§6.3 madde 1-5) UYGULANDI
- [ ] 9 renk hex'i §1 tablosuyla birebir
- [ ] Hiçbir `heading`/`icon-box`/`text`/`counter`/`button` bloğu fotoğraflı VEYA gerçek koyu dolgu
      bir `container`'ın DOĞRUDAN çocuğu DEĞİL (§1.2 madde 4) — yalnızca `.pb-badge-pill` (kendi
      renk çiftini taşıyan `text` içeriği) istisnadır
- [ ] Slider katman `button` stilinde `borderRadius: 100` (pill) — değişmedi
- [ ] Sayfa bloğu butonlarında `!rounded-full` gibi tek seferlik sınıf YOK
- [ ] Kullanılan tüm ikonlar §4.1 tablosundaki 9 isimden biri (8 eski + `ArrowUpRight`)
- [ ] `assets[]` §7.2 tablosundaki 12 `key`/boyut/arama-önerisi ile birebir, hepsi gerçek JPEG
- [ ] `previewImageUrl` `"/demo-templates/modern-architecture/preview.svg"` (değişmedi, §8 backlog)
- [ ] Hero 3 slaytın `bgType: "image"`, `bgOverlayColor:"#1F2124"`, `bgOverlayOpacity:58`,
      `bgKenBurns:true` (§5.2/§5.3)
- [ ] CTA banner overlay opaklığı 55 (değişmedi), "Ofisimiz" paneli overlay opaklığı 85 (yeni, §6.7)
