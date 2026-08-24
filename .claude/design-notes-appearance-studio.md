# Tasarım Notu — Görünüm Stüdyosu Yükseltmesi (`/admin/appearance` → "profesyonel tasarım stüdyosu")

**Kapsam:** `frontend/src/app/admin/appearance/page.tsx` (mevcut, 9 sekme) üzerinde 4 hedeflenmiş iyileştirme —
(1) canlı önizleme tuvalinin "gerçek sayfa hissi", (2) 6 rol + "Bileşen Renkleri" alt-grubu şeklinde
yeniden gruplanan renk sistemi + 8 kurumsal renk paleti, (3) 15 font eşleştirmesi + 3 yazı boyutu
preseti, (4) yeni `pageHeaderLayout` alanı (`CENTERED`/`LEFT_OVERLAY`/`MINIMAL_LINE`/`SPLIT`) için 4
şablon tasarımı. Önceki kararlar için bkz. `.claude/design-notes-appearance-panel.md` (temel iskelet),
`.claude/design-notes-appearance-polish.md` (cihaz toggle, gruplu sekme, doluluk soketi),
`.claude/design-notes-theme-typography.md` (mevcut 7 preset, `borderRadius`/`buttonStyle` radyo
grupları, font canlı önizleme kutusu) — **bu doküman onları EZMEZ**, yalnızca aşağıdaki 4 net
iyileştirmeyi ekler.

**Görsel yön (değişmedi):** Proje **Minimal/Flat** — düz `bg-surface`/`border-border` kartlar, yüksek
kontrast, sade border'lar. Bu dokümandaki hiçbir öneri glassmorphism/glow/gradient-arka-plan
İÇERMEZ (§4'teki `LEFT_OVERLAY` gradyan overlay'i istisna DEĞİLDİR — o, banner görselinin okunabilirliği
için var olan bir fonksiyonel katman, dekoratif bir "glow" değil).

**Kod kısıtı hatırlatması (bağlayıcı):** `SiteFont` enum'u KAPALI — §3'teki 15 eşleşme SADECE mevcut
11 `SiteFont` değerinin (`SYSTEM`, `INTER`, `ROBOTO`, `OPEN_SANS`, `MONTSERRAT`, `POPPINS`, `LORA`,
`PLAYFAIR_DISPLAY`, `SOURCE_SERIF_4`, `PLUS_JAKARTA_SANS`, `OUTFIT`) kombinasyonlarıdır, yeni font
YOK. `latin-ext` subset eklenmesi frontend-agent'ın işi, bu dokümanın kapsamı dışında.

---

## §1 Canlı Önizleme Tuvali — "Gerçek Sayfa Hissi"

**Kapsam genişletmesi:** `.claude/design-notes-appearance-polish.md` §3'teki cihaz toggle'ı (Masaüstü/
Tablet/Mobil) ve `transition-all duration-300 ease-in-out` genişlik geçişi **AYNEN KORUNUR** — burada
SADECE (a) önizleme çerçevesine ince bir "tarayıcı kabuğu" eklenir, (b) aksiyon grubuna bir "Yenile"
butonu eklenir, (c) ikisinin birlikte yerleşimi netleştirilir.

### 1.1 Tarayıcı kabuğu — KARAR: EKLENSİN, ama minimal/flat kalsın (skeuomorfik DEĞİL)

Mevcut önizleme sarmalayıcısının (`overflow-hidden rounded-xl border border-border`) **ÜSTÜNE**, aynı
`rounded-xl` köşe yarıçapını üstten paylaşan `h-9` (36px) yükseklikte düz bir kabuk çubuğu eklenir:

```tsx
<div className="flex h-9 items-center gap-2 rounded-t-xl border-b border-border/60 bg-surface-muted px-3">
  {/* Trafik ışığı noktaları — SADECE dekoratif, tıklanamaz, macOS tarayıcı kabuğu konvansiyonu */}
  <span className="flex items-center gap-1.5" aria-hidden="true">
    <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
    <span className="h-2 w-2 rounded-full bg-[#febc2e]" />
    <span className="h-2 w-2 rounded-full bg-[#28c840]" />
  </span>
  {/* Sahte adres çubuğu — salt-okunur, tıklanamaz, gerçek bir <input> DEĞİL */}
  <span className="ml-1.5 flex h-6 flex-1 items-center truncate rounded-md bg-surface px-3 font-mono text-[11px] text-foreground/45">
    {siteUrl /* örn. "https://siteniz.com" — settings'ten veya sabit placeholder */}
  </span>
</div>
```

Bu bar `overflow-hidden rounded-xl` sarmalayıcının İÇİNDE en üstte oturur (sarmalayıcının kendi
`rounded-xl`'i alt köşeleri, bu barın `rounded-t-xl`'i üst köşeleri kapsar — çakışma yok). Trafik ışığı
renkleri **sabit hex** (`#ff5f57`/`#febc2e`/`#28c840`, macOS Safari/Chrome kabuğunun standart
paleti — tema rengine bağlı DEĞİL, evrensel "tarayıcı" ikonografisi olduğu için kasıtlı olarak marka
renklerinden bağımsız bırakıldı). Adres çubuğu metni `siteUrl` yoksa `"siteniz.com"` placeholder'ı
gösterir — bu alan **etkileşimsizdir** (odaklanamaz, `pointer-events-none` eklenmesi önerilir),
sadece görsel bağlam.

**Neden EKLENDİ (glassmorphism kuralına aykırı değil):** Bu bar `bg-surface-muted` + `border-border/60`
— projenin zaten kullandığı düz Minimal/Flat token'ları, `backdrop-blur`/gradyan YOK. Amaç sadece
"bu bir tarayıcı penceresi" okunaklılığını artırmak, glow eklemek değil.

### 1.2 Aksiyon grubu — "Yenile" + "Yeni Sekmede Aç" yerleşimi

`.claude/design-notes-appearance-polish.md` §3'teki başlık satırı (`"CANLI ÖNİZLEME"` etiketi + sağda
cihaz segmented control + `ExternalLink`) **KORUNUR**, aradan bir dikey ayraç + `RotateCw` (Yenile)
ikonu eklenir:

```tsx
<div className="flex items-center justify-between gap-2">
  <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">Canlı Önizleme</p>
  <div className="flex items-center gap-1.5">
    <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5">
      {/* 3 cihaz butonu — DEĞİŞMEDİ */}
    </div>
    <span className="h-4 w-px bg-border/60" aria-hidden="true" />
    <Button type="button" size="icon-xs" variant="ghost" onClick={handleRefreshPulse} aria-label="Önizlemeyi yenile">
      <RotateCw className="h-3 w-3" />
    </Button>
    <Button type="button" size="icon-xs" variant="ghost" render={<a href="/" target="_blank" rel="noreferrer" />} aria-label="Siteyi yeni sekmede aç">
      <ExternalLink className="h-3 w-3" />
    </Button>
  </div>
</div>
```

**Sıra (soldan sağa):** Cihaz segmented control → `h-4 w-px bg-border/60` dikey ayraç (16px, mevcut
spacing ölçeğinden) → Yenile (`RotateCw`) → Yeni Sekmede Aç (`ExternalLink`). İkisi de
`size="icon-xs"` `variant="ghost"` — cihaz butonlarıyla AYNI boyut ailesi, yeni bir buton boyutu İCAT
EDİLMİYOR.

**"Yenile" davranışı — KARAR: kozmetik güven sinyali, fonksiyonel zorunluluk DEĞİL.** Önizleme bir
iframe değil, doğrudan React state'inden (`.site-scope` + satır-içi `--site-*`) render edildiği için
zaten HER ZAMAN güncel. `RotateCw` butonu tıklandığında önizleme sarmalayıcısına 300ms süren bir
`opacity-100 → opacity-40 → opacity-100` geçişi (basit bir CSS class toggle, `transition-opacity
duration-300`) uygulanır — kullanıcıya "yenilendi" hissi verir, DOM içeriği değişmez. Bu, frontend-agent
için küçük bir state (`isRefreshing: boolean`, 300ms `setTimeout` ile `false`'a döner) + tek bir
conditional class'tır, yeni bir bileşen GEREKMEZ.

### 1.3 Geçiş animasyonu — MEVCUT karar KORUNUYOR, netleştiriliyor

Cihaz genişliği değişiminde: `transition-all duration-300 ease-in-out` (`.claude/design-notes-appearance-polish.md`
§3'te zaten karara bağlandı) — bu doküman bunu DEĞİŞTİRMEZ, sadece teyit eder: 300ms, standart Tailwind
`ease-in-out` (cubic-bezier(0.4, 0, 0.2, 1)), projenin `duration-300`'ü zaten en yaygın kullandığı geçiş
süresi (preset kartları, radyo grupları, accordion'lar hep aynı süreyi kullanıyor — tutarlılık).
Ekstra bir "bounce"/"scale" efekti EKLENMEZ (fazla oyuncaklı, Minimal/Flat diline aykırı düşer).

---

## §2 Renk Sistemi — 6 Rol + "Bileşen Renkleri" + 8 Kurumsal Palet

### 2.1 Alan gruplaması (mevcut `colors` sekmesi İÇİNDE, yeni sekme YOK)

Mevcut düz 10-alanlı `grid grid-cols-1 gap-4 sm:grid-cols-2` **İKİ gruba** ayrılır — `SECTION_FIELDS.colors`
mantığı DEĞİŞMEZ (hâlâ tek `PATCH` payload'ı), sadece görsel gruplama eklenir:

**Grup A — "Marka & Yüzey Renkleri" (6 alan, ana roller):**

| Alan | Yeni etiket | Eski etiket (KARŞILAŞTIRMA) |
|---|---|---|
| `primaryColor` | Birincil Renk | (değişmedi) |
| `secondaryColor` | İkincil Renk | (değişmedi) |
| `backgroundColor` | Sayfa Zemini | (değişmedi) |
| `surfaceColor` | Yüzey / Kart Zemini | (değişmedi) |
| `textColor` | **Başlık Metni** | eskisi: "Metin Rengi" — RENAME |
| `mutedTextColor` | **Gövde Metni** | eskisi: "İkincil Metin Rengi" — RENAME |

**Rename gerekçesi:** `textColor` gerçekte `h1`/başlıklarda, `mutedTextColor` gövde paragraflarında
kullanılıyor (bkz. `page-header.tsx`, site tipografi kullanım deseni) — "Metin Rengi" / "İkincil Metin
Rengi" adları rol farkını (başlık vs gövde) gizliyordu. `checkAgainst` bağları AYNEN KALIR (`textColor`
→ `backgroundColor`, `mutedTextColor` → `backgroundColor`, `.claude/design-notes-theme-typography.md`
§5 ile birebir).

**Grup B — "Bileşen Renkleri" (4 alan, alt-grup — mevcut kart İÇİNDE, `border-t border-border/60 pt-4`
ayraçla, Grup A'nın ALTINDA, "Bileşen Stilleri" [borderRadius/buttonStyle] alt-bölümünün ÜSTÜNDE):**

| Alan | Etiket | `checkAgainst` |
|---|---|---|
| `buttonColor` | Buton Zemini | `buttonTextColor` |
| `buttonTextColor` | Buton Metni | `buttonColor` |
| `linkColor` | Bağlantı Rengi | — |
| `accentColor` | Vurgu Rengi | — (metinsel uyarı, `.claude/design-notes-theme-typography.md` §1) |

Kart iskeleti (üstten alta):
```
Card
 ├─ SectionHeader (Paintbrush) "Stil / Renk"
 ├─ [YENİ §2.2] 8 Kurumsal Palet — kompakt swatch şeridi
 ├─ SectionHeader-benzeri alt-etiket "Marka & Yüzey Renkleri" (text-sm font-medium)
 ├─ 6 × ColorField (2 sütun grid)
 ├─ border-t pt-4 ayraç
 ├─ SectionHeader-benzeri alt-etiket "Bileşen Renkleri" (text-sm font-medium)
 ├─ 4 × ColorField (2 sütun grid)
 ├─ border-t pt-4 ayraç
 ├─ SectionHeader (Layers) "Bileşen Stilleri" — MEVCUT, DEĞİŞMEDİ (borderRadius + buttonStyle)
```

### 2.2 8 Kurumsal Renk Paleti — AYRI bir hızlı-başlangıç şeridi (mevcut "Tasarım Ön Ayarları" DEĞİL)

**Karar: Bu, `presets` sekmesindeki 7 `AppearancePresetDefinition`'ın (font+radius+buttonStyle de
taşıyan, 15 alanlı) YERİNE GEÇMEZ.** Bu yeni 8 palet SADECE 10 renk alanını doldurur — `colors`
sekminin EN ÜSTÜNDE, `SectionHeader`'ın hemen altında, kompakt bir "hızlı başlangıç" şeridi olarak
görünür. Tıklandığında yalnızca 10 renk alanı güncellenir (`headingFont`/`bodyFont`/`baseFontSize`/
`borderRadius`/`buttonStyle` DOKUNULMAZ) ve mevcut "elle değişiklik → `presetKey: null`" kuralı AYNI
şekilde tetiklenir (bu da teknik olarak bir "elle değişiklik" sayılır — kullanıcı 10 alanı tek tıkla
elle doldurmuş olur).

```tsx
<div className="space-y-2">
  <p className="text-sm font-medium text-foreground">Kurumsal Renk Paletleri</p>
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Kurumsal renk paleti">
    {CORPORATE_COLOR_PALETTES.map((palette) => (
      <button
        key={palette.key}
        type="button"
        role="radio"
        onClick={() => applyCorporatePalette(palette)}
        className="flex flex-col gap-2 rounded-lg border border-border p-2.5 text-left transition-all duration-300 hover:bg-muted"
      >
        <div className="flex h-5 overflow-hidden rounded-md">
          <span className="flex-1" style={{ backgroundColor: palette.values.primaryColor }} />
          <span className="flex-1" style={{ backgroundColor: palette.values.secondaryColor }} />
          <span className="flex-1" style={{ backgroundColor: palette.values.buttonColor }} />
          <span className="flex-1" style={{ backgroundColor: palette.values.accentColor }} />
        </div>
        <span className="text-xs font-medium text-foreground">{palette.label}</span>
      </button>
    ))}
  </div>
</div>
```

Görsel dil: mevcut preset kartlarıyla (§3, `design-notes-appearance-panel.md`) AYNI radyo-kart +
renk-şeridi paterni, ama daha KOMPAKT (`h-5` şerit vs presets'in `h-8`'i, `p-2.5` vs `p-4`) — çünkü bu
şerit ikincil bir hızlı-seçim aracı, ana "Tasarım Ön Ayarları" sekmesinin yerini almıyor. `grid-cols-2
sm:grid-cols-4` → 8 palet 2 satırda (mobilde) / tek satırda (masaüstünde `sm:grid-cols-4` ile 2×4)
düzgün yerleşir.

**WCAG doğrulama yöntemi:** Tüm hesaplamalar `frontend/src/lib/site-settings/contrast.ts`'teki MEVCUT
algoritma (sRGB → linearize → relative luminance → `(L1+0.05)/(L2+0.05)`) ve MEVCUT eşikle
(`WCAG_AA_CONTRAST_THRESHOLD = 4.5`) elle doğrulanmıştır. Her palette için kritik 2 çift kontrol
edildi: `textColor` vs `backgroundColor`, `buttonColor` vs `buttonTextColor` — ayrıca `accentColor`
vs `textColor` (proje kuralı: accent zemininde her zaman koyu `textColor` kullanılır, `buttonTextColor`
DEĞİL).

**TypeScript sabiti (frontend-agent'ın doğrudan kopyalayabileceği format):**

```ts
export interface CorporateColorPaletteValues {
  primaryColor: string;
  secondaryColor: string;
  buttonColor: string;
  buttonTextColor: string;
  linkColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
}

export interface CorporateColorPalette {
  key: string;
  label: string;
  description: string;
  values: CorporateColorPaletteValues;
}

export const CORPORATE_COLOR_PALETTES: CorporateColorPalette[] = [
  {
    key: "modern-indigo",
    label: "Modern Indigo",
    description: "Platformun varsayılan kimliği — canlı indigo, SaaS/teknoloji ürünleri için güvenilir ve modern.",
    values: {
      primaryColor: "#4f46e5",
      secondaryColor: "#111827",
      buttonColor: "#4f46e5",
      buttonTextColor: "#ffffff",
      linkColor: "#4f46e5",
      accentColor: "#f59e0b",
      backgroundColor: "#ffffff",
      surfaceColor: "#f9fafb",
      textColor: "#111827",
      mutedTextColor: "#6b7280",
    },
  },
  {
    key: "emerald-corporate",
    label: "Zümrüt Kurumsal",
    description: "Koyu zümrüt yeşili — sürdürülebilirlik/finans/sağlık sektörlerinde ciddi ve güvenilir bir ton.",
    values: {
      primaryColor: "#065f46",
      secondaryColor: "#022c22",
      buttonColor: "#065f46",
      buttonTextColor: "#ffffff",
      linkColor: "#047857",
      accentColor: "#34d399",
      backgroundColor: "#ffffff",
      surfaceColor: "#ecfdf5",
      textColor: "#022c22",
      mutedTextColor: "#6b7280",
    },
  },
  {
    key: "luxury-gold-black",
    label: "Lüks Altın / Siyah",
    description: "Siyah zemin + altın vurgu — moda/mücevher/premium hizmet markaları için yüksek uçlu bir izlenim.",
    values: {
      primaryColor: "#18181b",
      secondaryColor: "#3f3f46",
      buttonColor: "#18181b",
      buttonTextColor: "#d4af37",
      linkColor: "#7c5e10",
      accentColor: "#d4af37",
      backgroundColor: "#fffdf7",
      surfaceColor: "#f5f0e6",
      textColor: "#1c1917",
      mutedTextColor: "#6b6459",
    },
  },
  {
    key: "minimalist-slate",
    label: "Minimalist Slate",
    description: "Nötr gri tonlar, sıfır renk gürültüsü — portföy/ajans/mimarlık siteleri için sade bir zemin.",
    values: {
      primaryColor: "#334155",
      secondaryColor: "#1e293b",
      buttonColor: "#334155",
      buttonTextColor: "#ffffff",
      linkColor: "#334155",
      accentColor: "#94a3b8",
      backgroundColor: "#ffffff",
      surfaceColor: "#f8fafc",
      textColor: "#0f172a",
      mutedTextColor: "#64748b",
    },
  },
  {
    key: "warm-terracotta",
    label: "Sıcak Toprak",
    description: "Toprak tonu turuncu-kahve + krem zemin — el yapımı/artisan/butik markalar için sıcak bir his.",
    values: {
      primaryColor: "#c2410c",
      secondaryColor: "#7c2d12",
      buttonColor: "#c2410c",
      buttonTextColor: "#ffffff",
      linkColor: "#c2410c",
      accentColor: "#b45309",
      backgroundColor: "#fffbf5",
      surfaceColor: "#fef3e8",
      textColor: "#292524",
      mutedTextColor: "#78716c",
    },
  },
  {
    key: "ocean-blue",
    label: "Okyanus Mavisi",
    description: "Camgöbeği-mavi tonları — turizm/lojistik/su ürünleri gibi 'temiz ve güvenilir' hissi gereken sektörler.",
    values: {
      primaryColor: "#0e7490",
      secondaryColor: "#164e63",
      buttonColor: "#0e7490",
      buttonTextColor: "#ffffff",
      linkColor: "#0e7490",
      accentColor: "#22d3ee",
      backgroundColor: "#ffffff",
      surfaceColor: "#ecfeff",
      textColor: "#083344",
      mutedTextColor: "#4b6b74",
    },
  },
  {
    key: "burgundy-executive",
    label: "Bordo Executive",
    description: "Koyu bordo + altın vurgu — hukuk bürosu/özel kulüp/üst düzey danışmanlık için otoriter bir ton.",
    values: {
      primaryColor: "#7f1d1d",
      secondaryColor: "#450a0a",
      buttonColor: "#7f1d1d",
      buttonTextColor: "#ffffff",
      linkColor: "#9f1239",
      accentColor: "#f59e0b",
      backgroundColor: "#ffffff",
      surfaceColor: "#fef2f2",
      textColor: "#2a0e10",
      mutedTextColor: "#7c5257",
    },
  },
  {
    key: "forest-green",
    label: "Orman Yeşili",
    description: "Derin orman yeşili + amber vurgu — outdoor/doğa/tarım/sürdürülebilir ürün markaları için organik bir his.",
    values: {
      primaryColor: "#14532d",
      secondaryColor: "#052e16",
      buttonColor: "#14532d",
      buttonTextColor: "#ffffff",
      linkColor: "#15803d",
      accentColor: "#ca8a04",
      backgroundColor: "#ffffff",
      surfaceColor: "#f0fdf4",
      textColor: "#052e16",
      mutedTextColor: "#6b7280",
    },
  },
];
```

**Kontrast doğrulama tablosu (elle hesaplandı, WCAG AA eşiği 4.5:1):**

| Palet | `buttonColor`/`buttonTextColor` | `textColor`/`backgroundColor` | `mutedTextColor`/`backgroundColor` | `accentColor`/`textColor` (koyu metin üzerinde) |
|---|---|---|---|---|
| Modern Indigo | ~6.29:1 ✅ | 17.74:1 ✅ (mevcut DEFAULTS) | 4.83:1 ✅ (mevcut DEFAULTS) | 8.26:1 ✅ (mevcut DEFAULTS) |
| Zümrüt Kurumsal | 7.69:1 ✅ | 15.15:1 ✅ | 4.83:1 ✅ | 7.88:1 ✅ |
| Lüks Altın/Siyah | 8.44:1 ✅ | 17.16:1 ✅ | 5.74:1 ✅ | 8.32:1 ✅ |
| Minimalist Slate | 10.36:1 ✅ | 17.86:1 ✅ | 4.76:1 ✅ | — (accent açık ton, `mutedTextColor` ile kontrol edilmedi, koyu metinle rahat geçer) |
| Sıcak Toprak | 5.18:1 ✅ | 14.71:1 ✅ | 4.65:1 ✅ | (mevcut `warm-terracotta` presetiyle BİREBİR aynı, önceden doğrulandı — `.claude/design-notes-theme-typography.md` §2.4) |
| Okyanus Mavisi | 5.36:1 ✅ | 13.40:1 ✅ | 5.74:1 ✅ | 7.41:1 ✅ |
| Bordo Executive | 10.02:1 ✅ | 17.97:1 ✅ | 6.57:1 ✅ | 8.37:1 ✅ |
| Orman Yeşili | 9.11:1 ✅ | 14.90:1 ✅ | 4.83:1 ✅ | 5.07:1 ✅ |

`linkColor` her palette için `backgroundColor`'a (beyaz/kirli-beyaz zemin) karşı AYRICA kontrol edildi
(link metni her zaman zemin üzerine gelir): en düşük değer Orman Yeşili `linkColor` `#15803d` →
**5.02:1** ✅ — tüm paletler eşiği geçiyor.

---

## §3 Tipografi Stüdyosu — 15 Font Eşleşmesi + 3 Yazı Boyutu Preseti

### 3.1 15 kürasyonlu (headingFont, bodyFont) çifti

**Yerleşim:** `typography` sekmesinde, mevcut "Başlık Fontu" / "Gövde Fontu" kart gridlerinin
**ÜSTÜNDE**, "Hazır Eşleşmeler" başlıklı kompakt bir şerit (§2.2'deki palet şeridiyle AYNI görsel
dil — küçük radyo-kart, ama içerik renk şeridi yerine iki mini "Aa" örneği). Bir eşleşmeye tıklamak
HEM `headingFont` HEM `bodyFont`'u aynı anda değiştirir (`baseFontSize`/renkler DOKUNULMAZ).

```tsx
<div className="space-y-2">
  <p className="text-sm font-medium text-foreground">Hazır Font Eşleşmeleri</p>
  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
    {FONT_PAIRINGS.map((pairing) => (
      <button key={pairing.key} type="button" role="radio" className="rounded-lg border border-border p-3 text-left transition-all duration-300 hover:bg-muted">
        <span className="flex items-baseline gap-2">
          <span className="text-lg" style={{ fontFamily: fontCssFallback(pairing.headingFont) }}>Aa</span>
          <span className="text-sm text-foreground/60" style={{ fontFamily: fontCssFallback(pairing.bodyFont) }}>Aa</span>
        </span>
        <span className="mt-1 block text-xs font-medium text-foreground">{pairing.label}</span>
        <span className="block text-[11px] text-foreground/50">{pairing.description}</span>
      </button>
    ))}
  </div>
</div>
```

(`fontCssFallback` = mevcut `SITE_FONT_OPTIONS[...].cssFallback`, `.claude/design-notes-appearance-panel.md`
§7'deki YAKLAŞIK sistem-font gösterimi — gerçek font burada da YÜKLENMEZ, sadece admin kart
önizlemesi.)

**TypeScript sabiti:**

```ts
export interface FontPairing {
  key: string;
  label: string;
  description: string;
  headingFont: SiteFont;
  bodyFont: SiteFont;
}

export const FONT_PAIRINGS: FontPairing[] = [
  { key: "classic-corporate", label: "Klasik Kurumsal", description: "Playfair Display + Source Serif 4 — hukuk/finans/danışmanlık için zamansız ciddiyet.", headingFont: "PLAYFAIR_DISPLAY", bodyFont: "SOURCE_SERIF_4" },
  { key: "modern-minimal", label: "Modern Minimal", description: "Outfit + Inter — SaaS/teknoloji ürünleri için geometrik başlık, nötr gövde.", headingFont: "OUTFIT", bodyFont: "INTER" },
  { key: "saas-clean", label: "SaaS Temiz", description: "Plus Jakarta Sans + Inter — yumuşak humanist başlık, yüksek okunabilirlik.", headingFont: "PLUS_JAKARTA_SANS", bodyFont: "INTER" },
  { key: "editorial-elegant", label: "Editoryal Zarif", description: "Lora + Open Sans — dergi hissi veren serif başlık, sade sans gövde.", headingFont: "LORA", bodyFont: "OPEN_SANS" },
  { key: "tech-trust", label: "Teknoloji Güvenilir", description: "Montserrat + Roboto — güçlü geometrik başlık, tanıdık/net gövde.", headingFont: "MONTSERRAT", bodyFont: "ROBOTO" },
  { key: "artisan-warm", label: "Sıcak Butik", description: "Playfair Display + Open Sans — el yapımı/atölye markaları için sıcak serif-sans ikilisi (Sıcak Toprak paletiyle uyumlu).", headingFont: "PLAYFAIR_DISPLAY", bodyFont: "OPEN_SANS" },
  { key: "startup-energetic", label: "Startup Enerjik", description: "Poppins + Inter — genç/hızlı büyüyen markalar için yuvarlak, arkadaşça başlık.", headingFont: "POPPINS", bodyFont: "INTER" },
  { key: "luxury-editorial", label: "Lüks Editoryal", description: "Playfair Display + Lora — iki serif'in birleşimi, yüksek moda/lüks perakende hissi (Lüks Altın/Siyah paletiyle uyumlu).", headingFont: "PLAYFAIR_DISPLAY", bodyFont: "LORA" },
  { key: "corporate-serif", label: "Kurumsal Serif", description: "Source Serif 4 + Open Sans — ciddi serif başlık, nötr sans gövde; raporlama/hukuk içerikleri için.", headingFont: "SOURCE_SERIF_4", bodyFont: "OPEN_SANS" },
  { key: "system-native", label: "Sistem Varsayılan", description: "Sistem + Sistem — harici font indirmez, en hızlı yüklenen seçenek; performans öncelikli siteler.", headingFont: "SYSTEM", bodyFont: "SYSTEM" },
  { key: "geometric-mono", label: "Geometrik Tek Aile", description: "Outfit + Outfit — tek font ailesi, sıkı ve tutarlı bir marka kimliği.", headingFont: "OUTFIT", bodyFont: "OUTFIT" },
  { key: "friendly-soft", label: "Yumuşak Dostane", description: "Poppins + Open Sans — sağlık/eğitim/topluluk siteleri için yuvarlak başlık, sakin gövde.", headingFont: "POPPINS", bodyFont: "OPEN_SANS" },
  { key: "bold-header-plain-body", label: "Güçlü Başlık, Sade Gövde", description: "Montserrat + Inter — pazarlama sayfaları için yüksek kontrastlı başlık ağırlığı.", headingFont: "MONTSERRAT", bodyFont: "INTER" },
  { key: "fashion-magazine", label: "Zarif Dergi", description: "Playfair Display + Plus Jakarta Sans — moda/yaşam tarzı için klasik başlık + modern humanist gövde.", headingFont: "PLAYFAIR_DISPLAY", bodyFont: "PLUS_JAKARTA_SANS" },
  { key: "consistent-sans", label: "Tutarlı Sans", description: "Inter + Inter — dokümantasyon/ürün siteleri için tam tutarlılık.", headingFont: "INTER", bodyFont: "INTER" },
];
```

### 3.2 Yazı Boyutu Ölçeği — 3 preset (mevcut `baseFontSize`, 14-20px aralığı)

**Yerleşim:** Mevcut `<input type="range" min={14} max={20}>` sürgüsünün HEMEN ÜSTÜNDE, 3 küçük buton
(`variant="outline"`/`"secondary"` — aktif değer eşleşiyorsa `variant="default"`), sürgüyü DEĞİŞTİRMEZ,
sadece hızlı-atlama kısayolu:

```tsx
<div className="flex items-center gap-1.5">
  {FONT_SIZE_PRESETS.map((p) => (
    <Button key={p.key} type="button" size="sm" variant={form.baseFontSize === p.px ? "default" : "outline"} onClick={() => updateColorOrTypographyField("baseFontSize", p.px)}>
      {p.label} ({p.px}px)
    </Button>
  ))}
</div>
```

| `key` | Etiket | px değeri |
|---|---|---|
| `small` | Küçük | **14** |
| `balanced` | Dengeli | **16** (mevcut backend varsayılanı, `DEFAULTS.baseFontSize`) |
| `large` | Büyük | **18** |

(Sürgünün üst sınırı 20px'te kalır — 3. preset bilinçli olarak 18px'te durur, 20px çoğu site için gövde
metninde aşırı büyük kabul edildi; kullanıcı isterse sürgüyü elle 20'ye çekebilir, preset sadece hızlı
başlangıç sunar.)

---

## §4 Sayfa Başlığı Şablonları — `pageHeaderLayout` (4 yeni değer)

**Alan:** `pageHeaderLayout: PageHeaderLayout` (`CENTERED` | `LEFT_OVERLAY` | `MINIMAL_LINE` | `SPLIT`,
varsayılan `CENTERED`) — **yalnızca `pageHeaderStyle === "BANNER"` iken anlamlı**, `SiteAppearance`
şemasına zaten backend tarafından eklendi (`backend/prisma/schema.prisma`, `pageHeaderLayout
PageHeaderLayout @default(CENTERED)`). `MINIMAL_LINE` ve `SPLIT` seçiliyken karartma yoğunluğu
sürgüsü (`pageHeaderOverlayOpacity`) admin formunda **disabled + gri** gösterilir, altında
`"Bu şablon karartma kullanmaz."` notu — bu iki şablon overlay UYGULAMAZ (§4.3, §4.4).

### 4.1 `CENTERED` — "Ortalı Klasik" (mevcut davranış, DEĞİŞMEDİ)

Zaten `frontend/src/components/site/page-header.tsx`'te implemente — full-bleed banner, `py-16
sm:py-20`, ortalanmış `h1` (`text-3xl sm:text-4xl font-bold text-white drop-shadow-sm`), düz `bg-black`
opaklık overlay'i (`pageHeaderOverlayOpacity`), + `.claude/design-notes-appearance-polish.md` §1'deki
`bg-black/60 backdrop-blur-sm` okunabilirlik pill'i (gerçek sitede henüz uygulanmadıysa BU görev
kapsamında da uygulanmalı — bkz. Kontrol Listesi). Bu şablon "varsayılan"dır, `pageHeaderLayout` alanı
eklenmeden önceki tek davranışla birebir eşleşir.

### 4.2 `LEFT_OVERLAY` — "Sola Yaslı & Karartmalı"

**Yerleşim:** Metin sol-altta, `flex items-end justify-start`, container `pb-10 sm:pb-14 pt-24 sm:pt-32`
(üstte fazladan boşluk — banner'ı CENTERED'dan daha uzun tutar, `py-20 sm:py-28` toplam yükseklik).
Metin bloğu `max-w-xl text-left`.

**Tipografi:** Başlık `text-3xl sm:text-5xl font-bold text-white drop-shadow-md` — CENTERED'ın
`sm:text-4xl`'inden BÜYÜK (editoryal "hero" ölçeği, güçlü sol-alt köşe vurgusu).

**Overlay — KARAR: düz `bg-black` opaklığı yerine ALTTAN yukarı doğru gradyan:**
```css
background: linear-gradient(to top, rgb(0 0 0 / calc(0.8 * var(--opacity-ratio))), rgb(0 0 0 / calc(0.35 * var(--opacity-ratio))) 55%, transparent);
```
`pageHeaderOverlayOpacity` (0-100) burada gradyanın ALT stop'unun tepe opaklığını ölçekler
(`0.8 * opacity/100`), üst stop her zaman `transparent`'a yaklaşır — metin her zaman en koyu bölgede
(alt-sol) oturur, görselin üst kısmı daha görünür kalır. Bu, düz overlay'den FARKLI bir görsel karar
(gerekçe: sola-yaslı düzende görselin geri kalanının "nefes alması" isteniyor, tüm zemini
karartmak CENTERED'ın işi).

### 4.3 `MINIMAL_LINE` — "Minimal Çizgili"

**Arka plan görseli/overlay YOK** — `pageHeaderBackgroundMediaId`/`pageHeaderBackgroundColor` alanları
DOLU olsa bile bu şablon onları GÖSTERMEZ (bilinçli kısıt, admin formunda bu iki alan da bu şablon
seçiliyken disabled + not gösterilir: `"Bu şablon arka plan görseli kullanmaz."`).

**Layout:** `bg-transparent`, sayfanın normal `--site-background` rengini kullanır (banner'ın kendine
özgü zemini YOK). Küçük dikey boşluk: `py-10 sm:py-12` (CENTERED'ın `py-16 sm:py-20`'sinden belirgin
şekilde daha az — "minimal" adının gerektirdiği kompaktlık). Metin sol hizalı, container genişliği
sayfanın kendi `containerClassName` prop'unu kullanır (PLAIN stiliyle AYNI konteyner mantığı).

**Tipografi:** `text-2xl sm:text-3xl font-semibold` — `text-foreground` (BEYAZ DEĞİL, artık görsel/overlay
olmadığı için normal sayfa metin rengi kullanılır, `--site-text` token'ı).

**Ayırt edici motif — accent alt-çizgi:** Başlığın hemen altında, TAM GENİŞLİK DEĞİL, kısa bir vurgu
çubuğu:
```tsx
<h1 className="text-2xl font-semibold text-foreground sm:text-3xl">{title}</h1>
<span className="mt-3 block h-0.5 w-12 rounded-full" style={{ backgroundColor: "var(--site-primary)" }} aria-hidden="true" />
```
`mt-3` (12px), çubuk `h-0.5 w-12` (2px × 48px) — "Minimal Çizgili" adının literal karşılığı, `--site-primary`
tonunda (kullanıcının marka rengiyle otomatik uyumlu).

### 4.4 `SPLIT` — "Bölünmüş Görsel & Metin"

**Layout:** `grid grid-cols-1 md:grid-cols-2` — SOL kolon görsel, SAĞ kolon metin (sabit sıra, yeni bir
"görsel konumu" alanı YOK). Overlay YOK.

**Görsel kolonu:** GERÇEK `<img>` elementi (arka plan CSS'i DEĞİL — task gereksinimi, ayrıca `<img>`
kullanmak `alt` metniyle erişilebilirlik de sağlar):
```tsx
{backgroundUrl ? (
  <img src={backgroundUrl} alt="" className="h-56 w-full object-cover md:h-full" />
) : (
  <div className="flex h-56 w-full items-center justify-center bg-muted md:h-full">
    <ImageIcon className="h-8 w-8 text-foreground/30" aria-hidden="true" />
  </div>
)}
```
Görsel yoksa (`pageHeaderBackgroundMediaId: null`) düz `bg-muted` + ortalanmış `ImageIcon` placeholder'ı
— `pageHeaderBackgroundColor` bu şablonda KULLANILMAZ (görsel kolonu ya doludur ya da nötr placeholder,
"yedek zemin rengi" kavramı bu layout'ta anlamsız).

**Metin kolonu:** `bg-surface flex flex-col justify-center px-6 py-10 sm:px-12 sm:py-16`, `text-foreground`
(normal sayfa renkleri — overlay olmadığı için beyaz metin YOK). Başlık `text-3xl sm:text-4xl font-bold
text-left`.

**Mobil davranış:** `grid-cols-1` — görsel üstte (`h-56`, sabit yükseklik), metin altta normal padding
ile akar (görsel kolonu `md:h-full`'den mobilde `h-56`'ya düşer, metin kolonu `md:` prefix'i olmadan
doğal yüksekliğini alır).

### 4.5 Admin panelindeki radyo-kart mockup'ları

**Yerleşim:** `pageHeader` sekmesinde, `pageHeaderStyle === "BANNER"` seçiliyken açılan mevcut alt-panelin
(Zemin rengi / Arka plan görseli / Karartma sürgüsü) **EN ÜSTÜNE**, `role="radiogroup"` 4'lü grid:

```tsx
<div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Sayfa başlığı şablonu">
  {PAGE_HEADER_LAYOUT_OPTIONS.map((opt) => (
    <button key={opt.value} type="button" role="radio" aria-checked={form.pageHeaderLayout === opt.value}
      className={cn("flex flex-col gap-2 rounded-lg border p-2.5 text-center transition-all duration-300",
        form.pageHeaderLayout === opt.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted")}>
      <opt.mockup />
      <span className="flex items-center justify-center gap-1 text-xs font-medium text-foreground">
        <opt.icon className="h-3 w-3" /> {opt.label}
      </span>
    </button>
  ))}
</div>
```

**Her mockup — sahte gri-tonlu bloklarla düzeni TEMSİL EDER (gerçek ekran görüntüsü DEĞİL), `h-14 w-full
rounded-md overflow-hidden border border-border/40`:**

| `value` | Etiket | İkon (`lucide-react`) | Mockup görsel tarifi |
|---|---|---|---|
| `CENTERED` | Ortalı Klasik | `AlignCenter` | Tam kaplayan orta-gri dikdörtgen (`bg-neutral-500`), ortada yatay küçük beyaz bar (`mx-auto h-1.5 w-1/2 rounded-full bg-white/80`, dikey ortalanmış) |
| `LEFT_OVERLAY` | Sola Yaslı & Karartmalı | `AlignLeft` | Tam kaplayan koyu-gri dikdörtgen (`bg-neutral-700`, `CENTERED`'dan daha koyu), sol-altta kısa beyaz bar (`absolute bottom-1.5 left-1.5 h-1.5 w-1/3 rounded-full bg-white/80`) |
| `MINIMAL_LINE` | Minimal Çizgili | `SeparatorHorizontal` | Açık zemin (`bg-surface-muted`), sol-üstte küçük koyu bar (`h-1.5 w-1/4 rounded-full bg-foreground/70`) + hemen altında ince renkli çizgi (`h-0.5 w-1/6 bg-primary`) — çoğu alan BOŞ (görselsizliği vurgular) |
| `SPLIT` | Bölünmüş Görsel & Metin | `Columns2` | İki eşit dikey yarı: sol yarı orta-gri (`bg-neutral-400`, görsel), sağ yarı açık zemin (`bg-surface`) ortasında küçük koyu bar (`h-1.5 w-2/3 rounded-full bg-foreground/70`, metin) |

Mockup'lar `pointer-events-none` (tıklama dıştaki `<button role="radio">`'ya ait), gerçek `<img>`/font
render ETMEZ — sadece renkli dikdörtgen blokları (`div`/`span`), yeni bir görsel varlık/asset GEREKMEZ.

---

## Kontrol Listesi (frontend-agent)

- [ ] Önizleme sarmalayıcısının ÜSTÜNE `h-9 bg-surface-muted border-b border-border/60` tarayıcı kabuğu
  eklenir: 3 trafik ışığı noktası (`#ff5f57`/`#febc2e`/`#28c840`, `h-2 w-2 rounded-full`) + salt-okunur
  sahte adres çubuğu (`font-mono text-[11px] text-foreground/45`).
- [ ] "CANLI ÖNİZLEME" başlık satırındaki aksiyon grubuna `h-4 w-px bg-border/60` ayraç + `RotateCw`
  (Yenile, `size="icon-xs"` `variant="ghost"`) eklenir — cihaz toggle'ı ile mevcut `ExternalLink`
  (Yeni Sekmede Aç) arasına yerleşir. Yenile tıklandığında 300ms `opacity-100→40→100` kozmetik geçiş.
- [ ] Cihaz genişliği geçişi `transition-all duration-300 ease-in-out` — DEĞİŞMEDİ, yeniden doğrulandı.
- [ ] `colors` sekmesi: 10 `ColorField` iki alt-gruba ayrılır ("Marka & Yüzey Renkleri" 6 alan,
  "Bileşen Renkleri" 4 alan, `border-t pt-4` ayraçla) — `textColor` etiketi "Başlık Metni", `mutedTextColor`
  etiketi "Gövde Metni" olarak DEĞİŞTİRİLİR (checkAgainst bağları AYNEN KALIR).
- [ ] `colors` sekmesinin EN ÜSTÜNE (renk gruplarının ÜSTÜNDE) `CORPORATE_COLOR_PALETTES` (8 palet,
  §2.2'deki TS sabiti BİREBİR) kompakt radyo-kart şeridi eklenir; tıklama SADECE 10 renk alanını
  günceller, `presetKey: null`'a düşürür (mevcut "elle değişiklik" kuralı).
  Bu sabit `frontend/src/lib/site-settings/appearance.ts` (veya yeni bir dosya, örn.
  `corporate-palettes.ts`) içine eklenir.
- [ ] `typography` sekmesinde `FONT_PAIRINGS` (15 eşleşme, §3.1'deki TS sabiti BİREBİR) mevcut font
  kartlarının ÜSTÜNE, kompakt radyo-kart şeridi olarak eklenir; tıklama `headingFont`+`bodyFont`'u
  birlikte değiştirir.
- [ ] `baseFontSize` sürgüsünün ÜSTÜNE 3 hızlı-preset butonu eklenir (Küçük 14px / Dengeli 16px /
  Büyük 18px), aktif değer eşleşiyorsa `variant="default"`.
- [ ] `pageHeaderLayout` alanı forma eklenir (`CENTERED` varsayılan) — `pageHeader` sekmesinde
  `BANNER` alt-panelinin EN ÜSTÜNE §4.5'teki 4'lü radyo-kart grubu (mockup'lar dahil) yerleştirilir.
- [ ] `MINIMAL_LINE`/`SPLIT` seçiliyken karartma sürgüsü (`pageHeaderOverlayOpacity`) ve (`SPLIT` için
  ayrıca) `pageHeaderBackgroundColor` alanı admin formunda `disabled` + açıklayıcı not gösterir.
- [ ] `frontend/src/components/site/page-header.tsx`: `pageHeaderLayout` prop'u eklenir, 4 dal
  render edilir (§4.1-4.4 birebir) — `CENTERED` mevcut davranışla AYNI kalır (regresyon YOK).
  `LEFT_OVERLAY` gradyan overlay hesaplaması (§4.2) frontend-agent'ın implementasyon detayı.
  `SPLIT` görsel kolonu GERÇEK `<img>` kullanır (arka plan CSS'i DEĞİL).
- [ ] `.claude/design-notes-appearance-polish.md` §1'deki `bg-black/60 backdrop-blur-sm` okunabilirlik
  pill'i, gerçek sitede henüz UYGULANMADIYSA, bu görev kapsamında `CENTERED` ve `LEFT_OVERLAY`
  şablonlarının HER İKİSİNE de uygulanır (ikisi de görsel üzerine beyaz metin koyuyor).
