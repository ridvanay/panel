# design-notes: Global Tema & Tipografi Yöneticisi — ui-designer kararları

Kapsam: `.claude/architect-scope-theme-typography.md`'nin sıraladığı ui-designer görevi
(madde 3). Kod YAZILMADI — bu dosya frontend-agent (ve `appearance-presets.ts` için
backend-agent) tarafından uygulanacak somut değerleri tanımlar. Tüm hesaplamalar
`frontend/src/lib/site-settings/contrast.ts`'teki MEVCUT algoritma ve MEVCUT eşikle
(`WCAG_AA_CONTRAST_THRESHOLD = 4.5`, tek eşik — büyük metin istisnası yok, bu dosyada
o kararı KORUYORUM, aşağıya bkz. §5) yapılmıştır.

Görsel yön notu: Bu görev **site tarafını** (ziyaretçinin gördüğü `.site-scope`)
kapsıyor, admin panelinin kendi görsel dilini DEĞİL. Admin panelinin mevcut Minimal/Flat
dili (`--primary`/`--ring`, `.admin-shell`) bu kapsamın dışında ve değişmiyor.

---

## 1) 5 yeni rengin varsayılan hex değerleri — backend'in geçici değerleri ONAYLANDI

Backend'in `appearance.routes.ts` DEFAULTS + Prisma `@default`'ta kullandığı 5 değer
hesaplanıp doğrulandı, DEĞİŞTİRİLMEDİ:

| Alan | Hex | Kontrast (vs karşılaştığı renk) | Sonuç |
|---|---|---|---|
| `backgroundColor` | `#ffffff` | — (referans) | — |
| `surfaceColor` | `#f9fafb` | vs `textColor` → **16.97:1** | ✅ AA (>4.5) |
| `textColor` | `#111827` | vs `backgroundColor` → **17.74:1** | ✅ AA |
| `mutedTextColor` | `#6b7280` | vs `backgroundColor` → **4.83:1** | ✅ AA (eşiğin hemen üstü, güvenli) |
| `accentColor` | `#f59e0b` | vs `#ffffff` (beyaz metin) → **2.15:1** | ❌ beyaz metinle KULLANILMAZ |
| `accentColor` | `#f59e0b` | vs `textColor` (`#111827`, koyu metin) → **8.26:1** | ✅ AA |

**Karar:** 5 değer olduğu gibi kalır. Tek ek gereksinim — `accentColor` alanının UI'da
(admin panelinde, `ColorField`'in altında) şu **kullanım notu** gösterilmesi (ColorField
bileşenine `checkAgainst` VERİLMEZ, çünkü accent'in üstüne hangi metnin bineceği bağlama
göre değişir — otomatik kontrast rozeti yanıltıcı olur):

> "Bu renk genellikle rozet/vurgu zemini olarak kullanılır. Üzerine metin koyarken **Metin
> Rengi**'ni (koyu) tercih edin; **Buton Metni** (genelde beyaz) accent zemininde düşük
> kontrast oluşturabilir."

## 2) 4 yeni ön ayar paleti — Modern Mavi / Kurumsal Lacivert / Zümrüt Yeşili / Sıcak Toprak

**Karar: EKLE, mevcut 3'ü SİLME.** `classic`/`modern`/`minimal` kalır (kayıtlı
`presetKey` referansları kırılmasın, `getAppearancePreset` zaten `undefined` döndüğünde
güvenli davranıyor ama riske gerek yok). 4 yeni preset **ayrı key'lerle** eklenir, toplam
7 preset olur.

**İsim çakışması notu:** Mevcut `modern` preset'i (indigo `#4f46e5`) ile yeni "Modern
Mavi" (gerçek mavi `#2563eb`) admin listesinde yan yana kafa karıştırabilir. Öneri
(opsiyonel, backend-agent uygulayabilir): mevcut `modern` preset'in `label`'ını
`"Modern"` → `"İndigo"` olarak değiştir (key/renkler AYNI kalır, sadece görünen isim).
Bu bir zorunluluk değil, netlik önerisidir.

Aşağıdaki 4 preset, `AppearancePresetValues` interface'inin **15 alanının tamamını**
(5 eski renk + 5 yeni renk + `headingFont`/`bodyFont`/`baseFontSize` + `borderRadius` +
`buttonStyle`) doldurur. Her palette kendi içinde AA doğrulandı (hesap notları altta).

### 2.1 `modern-blue` — "Modern Mavi"

```
description: "Canlı, güvenilir mavi — SaaS/teknoloji ürünleri için temiz ve modern."
primaryColor:     #2563eb
secondaryColor:   #1e3a8a
buttonColor:      #2563eb
buttonTextColor:  #ffffff
linkColor:        #2563eb
accentColor:      #38bdf8
backgroundColor:  #ffffff
surfaceColor:     #eff6ff
textColor:        #0f172a
mutedTextColor:   #64748b
headingFont:      PLUS_JAKARTA_SANS
bodyFont:         INTER
baseFontSize:     16
borderRadius:     LG
buttonStyle:      SOLID
```
Kontrast: `buttonColor`/`buttonTextColor` **5.17:1** ✅ · `textColor`/`backgroundColor`
**17.85:1** ✅ · `mutedTextColor`/`backgroundColor` **4.76:1** ✅.

### 2.2 `corporate-navy` — "Kurumsal Lacivert"

```
description: "Lacivert + altın vurgu — finans/hukuk/kurumsal kimlikler için ciddi ton."
primaryColor:     #1e3a8a
secondaryColor:   #0f172a
buttonColor:      #1e3a8a
buttonTextColor:  #ffffff
linkColor:        #1e40af
accentColor:      #ca8a04
backgroundColor:  #ffffff
surfaceColor:     #f1f5f9
textColor:        #0f172a
mutedTextColor:   #475569
headingFont:      INTER
bodyFont:         INTER
baseFontSize:     16
borderRadius:     SM
buttonStyle:      SOLID
```
Kontrast: `buttonColor`/`buttonTextColor` **10.36:1** ✅ · `mutedTextColor`/
`backgroundColor` (slate-600) ≈ **7.6:1** ✅ (Tailwind referans değeri, formülle
doğrulanabilir marj çok yüksek) · `accentColor` (`#ca8a04`) vs `textColor` (koyu metin
accent üzerinde) **6.08:1** ✅ — accentColor yine yalnızca koyu metinle kullanılmalı
(aynı §1 notu geçerli).

### 2.3 `emerald` — "Zümrüt Yeşili"

```
description: "Büyüme/doğa/sürdürülebilirlik temalı zümrüt yeşili, sıcak amber vurgu."
primaryColor:     #047857
secondaryColor:   #065f46
buttonColor:      #047857
buttonTextColor:  #ffffff
linkColor:        #047857
accentColor:      #f59e0b
backgroundColor:  #ffffff
surfaceColor:     #f0fdf4
textColor:        #052e16
mutedTextColor:   #6b7280
headingFont:      OUTFIT
bodyFont:         INTER
baseFontSize:     16
borderRadius:     LG
buttonStyle:      SOLID
```
**Uyarı — açık yeşil KULLANMA:** `#059669` (emerald-600) beyaz metinle yalnızca
**3.77:1** verir, AA'yı GEÇEMEZ. Bu yüzden `primaryColor`/`buttonColor`/`linkColor` için
daha koyu `#047857` (emerald-700) seçildi → **5.48:1** ✅. `textColor` marka rengiyle
uyumlu koyu yeşil-siyah (`#052e16`) — kontrast beyaz zeminde çok yüksek (~17:1
mertebesinde, `#111827`'e çok yakın luminans). `mutedTextColor` bilinçli olarak nötr
slate (`#6b7280`, §1'de doğrulanmış **4.83:1**) — yeşil tonlu bir muted renk denenmedi,
çünkü ek risk taşımadan garanti AA istiyoruz.

### 2.4 `warm-terracotta` — "Sıcak Toprak"

```
description: "Toprak tonu turuncu-kahve + krem zemin — sıcak, el yapımı/artisan hissi."
primaryColor:     #c2410c
secondaryColor:   #7c2d12
buttonColor:      #c2410c
buttonTextColor:  #ffffff
linkColor:        #c2410c
accentColor:      #b45309
backgroundColor:  #fffbf5
surfaceColor:     #fef3e8
textColor:        #292524
mutedTextColor:   #78716c
headingFont:      LORA
bodyFont:         OPEN_SANS
baseFontSize:     16
borderRadius:     SM
buttonStyle:      SOFT
```
Bu tek preset **kirli-beyaz zemin** kullanıyor (`#fffbf5`), diğerlerinin hepsi saf
`#ffffff`. Bu yüzden AYRICA doğrulandı: `textColor`/`backgroundColor` **14.71:1** ✅ ·
`mutedTextColor`/`backgroundColor` **4.65:1** ✅ (sınıra yakın ama geçiyor) ·
`buttonColor`/`backgroundColor` **5.02:1** ✅ (bu preset `buttonStyle: SOFT` kullandığı
için önemli — SOFT varyantında buton metni `buttonColor`'ın kendisi, açık/yarı-saydam
bir zemin üzerine biner; `buttonColor`'ın zemine karşı da AA geçmesi gerekiyordu, geçti)
· `buttonColor`/`buttonTextColor` (SOLID ihtimaline karşı) **5.18:1** ✅ — yani bu renk
hem SOLID hem SOFT'ta güvenli.

## 3) `borderRadius` (5) ve `buttonStyle` (3) görsel radyo buton tasarımı

Referans patern: mevcut `PAGE_HEADER_STYLE_OPTIONS` radyo grubu (`page.tsx` ~847-868) —
`role="radiogroup"`, her seçenek bir `<button role="radio" aria-checked>`, aktifte
`border-primary bg-primary/5`, pasifte `border-border hover:bg-muted`,
`transition-all duration-300`. Bu iki yeni grup AYNI aktif/pasif sınıflarını kullanır —
sadece içerik (ikon yerine gerçek önizleme parçacığı) değişir. **Bu iki grup "Stil /
Renk" (`colors`) sekmesinin İÇİNE, renk alanlarının ALTINA, "Bileşen Stilleri" alt
başlığıyla eklenir** (bkz. §6).

### 3.1 Köşe Yuvarlaklığı (`borderRadius`) — 5 seçenek, tek satır grid

`grid grid-cols-5 gap-3` (mevcut `grid-cols-3`'ün 5 sütunluk hali — kart genişliği aynı
oranda daralır, sorun yok, hepsi kısa etiket). Her seçenek: **ikon YOK**, bunun yerine
küçük bir kare önizleme parçacığı — `h-8 w-8` boyutunda, `bg-primary/15 border
border-primary/40`, köşe yarıçapı **o seçeneğin GERÇEK px değeriyle** inline
(`style={{ borderRadius: PX }}`) çizilir. Etiketin altında px değeri küçük gri metinle:

| value | px (architect'in `SITE_BORDER_RADIUS_PX` map'i) | label | alt metin |
|---|---|---|---|
| `NONE` | `0px` | Yok | 0px |
| `SM` | `4px` | Küçük | 4px |
| `MD` | `8px` | Orta | 8px (varsayılan) |
| `LG` | `16px` | Büyük | 16px |
| `FULL` | `9999px` | Tam Yuvarlak | pill |

Buton içi düzen: `flex flex-col items-center gap-2 rounded-lg border p-3` (dikey,
`PAGE_HEADER_STYLE_OPTIONS` ile aynı iskelet), üstte önizleme karesi, ortada label
(`text-sm font-medium`), altta px metni (`text-xs text-foreground/60`).

### 3.2 Buton Stili (`buttonStyle`) — 3 seçenek, tek satır grid

`grid grid-cols-3 gap-3`. Her seçenek bir **gerçek mini buton mockup'ı** gösterir —
`primaryColor`'ın canlı form değerini (`form.buttonColor` veya `form.primaryColor`)
kullanarak üç varyantı GERÇEKTEN render eder (statik ikon değil, canlı — kullanıcı renk
değiştirdiğinde bu üç örnek de anında güncellenir, ekstra sadelik/tutarlılık sağlar):

| value | mockup görünümü | label |
|---|---|---|
| `SOLID` | dolu zemin, beyaz/`buttonTextColor` metin — `"Örnek"` yazan küçük pill/buton | Dolu |
| `OUTLINE` | 2px kenarlıklı, şeffaf zemin, `buttonColor` metin | Anahat |
| `SOFT` | `buttonColor` %10 opaklıkta zemin, `buttonColor` metin | Yumuşak |

Mockup butonu gerçek boyutunda değil, küçültülmüş (`text-xs px-3 py-1`) statik (tıklanamaz,
`pointer-events-none`) bir örnek — dıştaki `role="radio"` kart seçilebilir kalır, içteki
mockup sadece görsel. Kart iskeleti 3.1 ile aynı (dikey flex, üstte mockup, altta label).
Kart köşe yarıçapı da (kartın kendisi, mockup değil) `form.borderRadius`'un o anki
değerine göre GÜNCEL gösterilirse (`style={{ borderRadius: PX }}` kartın kendisine de
uygulanır) iki alt-bölüm arasında görsel bir bağ kurulur — opsiyonel ama önerilir.

## 4) Font canlı önizleme kutusu — Tipografi sekmesi

Mevcut font seçici kartları (mini "Aa" + label, `cssFallback` ile) KALIR — bunlar seçim
arayüzü. Bunun ALTINA, TÜM tipografi bölümünün en altına (baseFontSize slider'ından
sonra), tek bir **canlı önizleme kutusu** eklenir. Bu kutu `cssFallback` DEĞİL, gerçek
yüklü fontu kullanır (`SITE_FONT_FAMILY[form.headingFont]` / `SITE_FONT_FAMILY[form.bodyFont]`
— zaten `page.tsx`'e import edilmiş, `SITE_FONT_VARIABLES` sınıfları önizleme
sarmalayıcısına eklenmeli ki CSS custom property'ler aktif olsun).

**Kapsayıcı:** `rounded-lg border border-border bg-surface-muted/30 p-6 space-y-3`,
üstte küçük etiket `"Canlı Önizleme"` (`text-xs font-medium text-foreground/50
uppercase tracking-wide`).

**İçerik (Türkçe karakter testi için tüm nokta/kesme/şapkalı harfleri kapsayan cümleler):**

- Başlık (`form.headingFont`, `text-2xl font-bold` boyutunda, `form.baseFontSize`'dan
  bağımsız sabit — başlık her zaman kendi ölçeğinde gösterilir):
  `"Iğdır'da çığ, üşüyen köpekler"`
- Paragraf (`form.bodyFont`, `style={{ fontSize: form.baseFontSize }}`, gövde metni
  canlı `baseFontSize` slider'ıyla BİRLİKTE büyüsün/küçülsün — kullanıcı slider'ı
  oynatırken kutunun tepki verdiğini görsün):
  `"Pijamalı hasta yağız şoföre çabucak güvendi. Bu örnek paragraf, seçtiğiniz gövde
  fontunun Türkçe karakterlerde (ç, ğ, ı, ö, ş, ü) nasıl göründüğünü gösterir."`

Boşluk/tipografi ölçeği: başlık ile paragraf arası `space-y-3` (12px, mevcut spacing
skalasıyla uyumlu — 4/8/12/16/24/32 skalasının 12px basamağı), kutunun kendi `p-6`
(24px) iç boşluğu diğer `Card` bileşenleriyle tutarlı.

## 5) WCAG uyarı eşiği/metni — yeni renk çiftleri için

**Eşik: MEVCUT tek eşiği KORU — 4.5:1, büyük metin/ikincil metin istisnası YOK.**
Gerekçe: `contrast.ts`'teki mevcut yorum zaten bunu bilinçli bir karar olarak
belgeliyor ("büyük metin 3:1 istisnası KULLANILMAZ, tek eşik daha güvenli/basit") ve §1
hesaplarında `mutedTextColor` varsayılanı zaten 4.5'i geçiyor (4.83:1) — istisna için
pratik bir gerekçe yok, tutarlılığı bozmaya değmez. Yeni çiftler AYNI `ContrastBadge`
bileşenini, AYNI metni kullanır:

- ✅ geçti: `"Kontrast yeterli (X.XX:1)"` (tone: success/yeşil rozet)
- ❌ geçmedi: `"Düşük kontrast (X.XX:1) — AA eşiği 4.5:1"` (tone: warning/turuncu rozet)

**Hangi alan hangi `checkAgainst`'ı alır** (yeni `ColorField` kullanım noktaları):

| Alan | `checkAgainst` |
|---|---|
| `textColor` | `backgroundColor` |
| `mutedTextColor` | `backgroundColor` |
| `accentColor` | **verilmez** (§1'deki metinsel uyarı yeterli, otomatik rozet yanıltıcı olur) |
| `surfaceColor` | **verilmez** (zemin rengi kendi başına metinle eşleşmez; `surfaceColor` üzerine
  binen metin zaten `textColor`/`mutedTextColor` rozetleriyle kapsanmış sayılır) |
| `backgroundColor` | **verilmez** (referans renk, kendine karşı kontrol anlamsız) |

## 6) "Bileşen Stilleri" alt-bölümünün yerleşimi

**Karar: yeni bir sekme AÇILMAZ** (architect kararıyla uyumlu — bu bir "alt-bölüm").
Mevcut **"Stil / Renk" (`colors`) sekmesinin İÇİNE**, 5+5=10 `ColorField`'in hemen
ALTINA, aynı `Card` içinde bir `<hr>`/`border-t` ayraçtan sonra ikinci bir
`SectionHeader` (`icon: Layers` veya `Shapes` — `lucide-react`'te ikisi de mevcut,
`Layers` önerilir) ile eklenir:

```
Card
 ├─ SectionHeader (Paintbrush) "Stil / Renk"
 ├─ 10 × ColorField (2 sütun grid)
 ├─ border-t pt-4 (ayraç)
 ├─ SectionHeader (Layers) "Bileşen Stilleri" — "Buton ve kart köşelerinin görünümü."
 ├─ Köşe Yuvarlaklığı radyo grubu (§3.1)
 └─ Buton Stili radyo grubu (§3.2)
```

Gerekçe: `borderRadius`/`buttonStyle` renk değil ama "genel görsel stil" şemsiyesine
girer, sekme adı zaten `"Stil / Renk"` (yalnızca "Renk" değil) — yeni bir sekme açmadan
mevcut adlandırmaya doğal biçimde oturuyor. `SECTION_FIELDS.colors` dizisine
`"borderRadius"`, `"buttonStyle"` eklenmesi frontend-agent'ın implementasyon detayı
(kaydetme/dirty-tracking mantığı bu notun kapsamı dışında).

## 7) `SITE_FONT_OPTIONS`'a yeni 2 font girdisi (frontend-agent için)

`frontend/src/lib/site-settings/appearance.ts`'teki `SITE_FONT_OPTIONS` dizisine, mevcut
9 girdinin SONUNA eklenecek satırlar (mevcut Montserrat/Poppins ile aynı `cssFallback`
kararı — geometrik/grotesk fontlar için Verdana/Geneva sistem yaklaşığı kullanılıyor,
Segoe UI ise Windows'ta Plus Jakarta Sans'ın humanist karakterine daha yakın bir
Türkçe-glif-uyumlu sistem fontu):

```ts
{ value: "PLUS_JAKARTA_SANS", label: "Plus Jakarta Sans", cssFallback: '"Segoe UI", ui-sans-serif, sans-serif' },
{ value: "OUTFIT", label: "Outfit", cssFallback: "Verdana, Geneva, sans-serif" },
```

---

## Özet — backend-agent'a devredilecek işler

1. `appearance-presets.ts`: mevcut 3 preset'in 5 yeni alanı zaten geçici değerlerle
   doldurulmuş — §1 onayına göre `modern` preset'inin (indigo) yeni-alan değerleri
   olduğu gibi kalabilir (zaten AA geçiyor), `classic`/`minimal`'in yeni-alan
   değerlerini de hızlıca AA kontrolünden geçirmesi önerilir (bu görev kapsamında
   detaylı hesaplanmadı, mevcut değerler makul görünüyor — `#111827`/`#0f172a` tarzı
   koyu textColor'lar zaten güvenli aralıkta). §2'deki 4 yeni preset objesi BİREBİR bu
   dosyadaki değerlerle eklenir.
2. (Opsiyonel) mevcut `modern` preset `label`'ı `"Modern"` → `"İndigo"`.

## Özet — frontend-agent'a devredilecek işler

§3 (borderRadius/buttonStyle radyo grupları), §4 (font canlı önizleme kutusu), §5
(checkAgainst eşlemesi + accentColor metinsel uyarısı), §6 (yerleşim), §7
(SITE_FONT_OPTIONS 2 yeni satır) — hepsi `frontend/src/app/admin/appearance/page.tsx`
ve `frontend/src/lib/site-settings/appearance.ts` içinde uygulanır.
