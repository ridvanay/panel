# Tasarım Notu — Özelleştirilebilir Header/Menü Renk Sistemi

**Kapsam:** `/admin/appearance` → "Stil / Renk" (`colors`) sekmesine yeni "Header & Menü Renkleri"
alt-bölümü + `frontend/src/components/site/site-header.tsx`'in bu token'ları tüketmesi. Görev sırası
**ui-designer (bu doküman) → backend-agent → frontend-agent → qa-agent**; backend-agent Prisma/Zod
alan adlarını §1'den, frontend-agent CSS değişken adlarını §2'den ve admin UI'ı §5'ten **birebir**
alır — isim/değer DEĞİŞTİRİLMEZ.

**Görsel yön (değişmedi, PİVOT DEĞİL):** Proje **Minimal/Flat**. Header'daki `backdrop-blur`
mevcut kod tabanında ZATEN vardı (`bg-surface/80 backdrop-blur`, bkz. `site-header.tsx` satır 111,
bu görevden ÖNCE de oradaydı) — bu doküman glassmorphism'e YENİ bir "B" pivotu YAPMIYOR, sadece
zaten var olan **fonksiyonel** okunabilirlik katmanını (kayan sayfa içeriğinin üzerinde duran bir
header için bulanıklaştırma) parametrik hale getiriyor. `design-notes-appearance-studio.md`'nin
"Görsel yön" bölümündeki `LEFT_OVERLAY` gradyanı için çizdiği AYNI ayrım burada da geçerli:
dekoratif "glow" DEĞİL, işlevsel bir katman.

---

## §1 Prisma alan adları (backend-agent — `SiteAppearance` modeli)

Mevcut "--- Renkler ---" bloğunun (`mutedTextColor`'dan hemen sonra) ALTINA, "--- Yazı Tipi ---"
bloğundan ÖNCE, yeni bir yorum bloğu olarak eklenir:

```prisma
// --- Header & Menü Renkleri (site header'ına özel — genel Marka & Yüzey renk
// paletinden BAĞIMSIZ, kullanıcı header'ı sitenin geri kalanından farklı
// renklendirebilir). `headerLinkColor`/`headerLinkHoverColor`/`headerBgColor`/
// `headerStickyBgColor` `#rrggbb` VEYA `#rrggbbaa` (alfa kanallı) kabul eder —
// `ContainerBackground.value` (page-builder) ile AYNI regex paterni. ---
headerBgColor            String  @default("#ffffffcc")
headerStickyBgColor      String  @default("#fffffff2")
// Yapışkan (sticky) durumdayken backdrop-blur uygulanır mı — CSS DEĞİŞKENİ DEĞİL,
// `buttonStyle` ile AYNI yapısal karar (design-notes-theme-typography.md §3.2 emsali).
// Normal (kaydırılmamış) durumda blur HER ZAMAN uygulanır — geriye dönük uyumluluk
// için ayrı bir toggle YOK (bkz. §3).
headerStickyBlurEnabled  Boolean @default(true)
headerLinkColor          String  @default("#111827b3")
headerLinkHoverColor     String  @default("#111827")
headerLinkActiveColor    String  @default("#4f46e5")
```

**Alan tipi/varsayılan gerekçesi (kesin, değiştirilmez):**

| Alan | Tip | Varsayılan | Neden bu değer |
|---|---|---|---|
| `headerBgColor` | `String` (hex, alfa kanallı) | `#ffffffcc` | Bugünkü `bg-surface/80` (`--surface: #ffffff` kökte, `/80` = %80 opaklık = `0xCC`) ile **piksel-birebir aynı** — geriye dönük uyumluluk garantisi. |
| `headerStickyBgColor` | `String` (hex, alfa kanallı) | `#fffffff2` | Bugün hiç var olmayan yeni bir durum (sticky implementasyonu yok) — %95 opaklık (`0xF2`) seçildi: idle durumdan (`%80`) daha OPAK, çünkü kaydırılmış haldeyken header artık rastgele sayfa içeriğinin üzerinde durur, okunabilirlik için idle'dan biraz daha "solid" olması Vercel/Linear paterniyle tutarlı bir varsayılan. |
| `headerStickyBlurEnabled` | `Boolean` | `true` | Varsayılanda idle ile sticky arasında görsel fark minimal (ikisi de bulanık) — kullanıcı özelleştirmeden hiçbir regresyon yok. |
| `headerLinkColor` | `String` (hex, alfa kanallı) | `#111827b3` | Bugünkü `text-foreground/70` — `--foreground` `.site-scope` içinde `--site-text`'e köprülenir (varsayılan `#111827`), `/70` = `0xB3` (179/255 ≈ %70.2) — **piksel-birebir aynı**. |
| `headerLinkHoverColor` | `String` (hex, OPAK, alfa YOK) | `#111827` | Bugünkü `hover:text-foreground` = tam opaklıkta `--site-text` — **piksel-birebir aynı**. Hover/focus bilinçli olarak TAM OPAK (idle'ın aksine) — daha güçlü bir etkileşim geri bildirimi. |
| `headerLinkActiveColor` | `String` (hex, OPAK, alfa YOK) | `#4f46e5` | Bugün hiç var olmayan yeni bir durum (aktif sayfa vurgusu yok) — `primaryColor`'ın varsayılanıyla AYNI hex (marka rengiyle tutarlı ilk izlenim), ama **bağımsız bir alan** (canlı bağ YOK — `buttonColor`'ın da `primaryColor`'dan bağımsız aynı varsayılanı taşıması emsaliyle tutarlı). |

**Zod (backend-agent, `appearance.schema.ts` veya eşdeğeri):**
- `headerBgColor`, `headerStickyBgColor`, `headerLinkColor` → alfa-kanallı hex regex, `ContainerBackground.value`'daki (page-builder Zod şeması) MEVCUT paterni **birebir aynı şekilde** yeniden kullan (`#rgb|#rrggbb|#rrggbbaa`, örn. `/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i`) — yeni bir regex İCAT ETME.
- `headerLinkHoverColor`, `headerLinkActiveColor` → diğer tüm `SiteAppearance` renk alanlarının (`primaryColor` vb.) kullandığı MEVCUT düz 6-haneli hex regex.
- `headerStickyBlurEnabled` → `z.boolean()`.

**İlişki notu — `stickyHeaderEnabled` (mevcut alan) ile çakışmaz:** `stickyHeaderEnabled` (Ekstra
Özellikler sekmesi) header'ın kaydırmada sabitlenip sabitlenmeyeceğini (yapısal davranış) kontrol
eder; `headerStickyBgColor`/`headerStickyBlurEnabled` bu davranışın SADECE görselini tanımlar.
`stickyHeaderEnabled=false` iken bu iki alan yine de veritabanında SAKLANIR (cookie
banner/maintenance alanlarıyla AYNI desen, §10.12.5) — yalnızca render'da hiçbir görsel etkileri
olmaz (sticky durumu hiç tetiklenmediği için).

---

## §2 CSS custom property adları (`--site-header-*` — frontend-agent)

`layout.tsx`'teki `siteScopeStyle` VE `page.tsx`'teki `previewCssVars`'a eklenir, `globals.css`'teki
`.site-scope` fallback bloğuna da (§1'deki DEFAULTS ile **birebir**) eklenir:

| Token | Kaynak alan | Not |
|---|---|---|
| `--site-header-bg` | `headerBgColor` | Idle (kaydırılmamış) header arka planı |
| `--site-header-bg-sticky` | `headerStickyBgColor` | Sticky (kaydırılmış) header arka planı |
| `--site-header-link` | `headerLinkColor` | Nav link / hesap-sepet-favori ikon rengi (idle) |
| `--site-header-link-hover` | `headerLinkHoverColor` | Hover VE focus-visible (aynı token, ayrı alan YOK) |
| `--site-header-link-active` | `headerLinkActiveColor` | Geçerli sayfayla eşleşen nav linki |

`headerStickyBlurEnabled` **CSS değişkeni DEĞİLDİR** — bkz. §3.

`globals.css` `.site-scope` fallback bloğuna (satır ~479-493 civarı, mevcut `--site-primary` vb.
ile aynı hizada) eklenecek satırlar (§1 DEFAULTS ile birebir):
```css
--site-header-bg: #ffffffcc;
--site-header-bg-sticky: #fffffff2;
--site-header-link: #111827b3;
--site-header-link-hover: #111827;
--site-header-link-active: #4f46e5;
```

---

## §3 `site-header.tsx` — token kullanım planı

**Yeni prop:** `SiteHeader`'a `headerStickyBlurEnabled?: boolean` eklenir (varsayılan `true` —
`buttonStyle = "SOLID"` paterniyle AYNI geriye-dönük-uyumlu varsayılan). Sticky durumun kendisinin
NASIL tespit edileceği (scroll-direction state) bu görevin kapsamı DIŞINDA — frontend-agent ayrı
olarak implemente ediyor; ui-designer sadece o state'in ÜRETTİĞİ boolean'ın hangi sınıfları
seçmesi gerektiğini tanımlıyor.

**1) Header kök elementi (satır 111):**
```tsx
// ÖNCE: className="border-b border-border bg-surface/80 backdrop-blur"
// SONRA (idle):
className={cn(
  "border-b border-border backdrop-blur transition-colors duration-300",
  "bg-[var(--site-header-bg)]"
)}
// SONRA (sticky — isSticky true iken):
className={cn(
  "border-b border-border transition-colors duration-300",
  "bg-[var(--site-header-bg-sticky)]",
  headerStickyBlurEnabled && "backdrop-blur"
)}
```
**Karar — idle durumda blur KOŞULSUZ kalır** (`headerStickyBlurEnabled` yalnızca sticky durumu
etkiler): `headerBgColor` zaten alfa kanallı olduğu için kullanıcı isterse `#ffffffff` (tam opak)
girip blur'un görsel etkisini fiilen sıfırlayabilir — idle için AYRI bir toggle alanı GEREKSİZ
(gereksiz alan çoğaltmaktan kaçınıldı). `transition-colors duration-300` — projenin standart geçiş
süresi (bkz. `design-notes-appearance-studio.md` §1.3), sticky/idle geçişini ani sıçrama yerine
yumuşatır.

**2) Nav dropdown tetikleyicisi (satır 149) + düz nav linki (satır 165):**
```tsx
// ÖNCE: "text-foreground/70 ... hover:text-foreground focus-visible:text-foreground"
// SONRA:
"text-[var(--site-header-link)] ... hover:text-[var(--site-header-link-hover)] focus-visible:text-[var(--site-header-link-hover)]"
```
**Aktif sayfa durumu (YENİ):** Geçerli `pathname`, linkin (localize edilmiş) `href`'iyle eşleştiğinde
(kök `/` için TAM eşleşme, alt sayfalar için `startsWith` — tam eşleştirme algoritması
frontend-agent'ın implementasyon detayı, `usePathname()` zaten import edilmiş ama şu an
KULLANILMIYOR, bu görev onu devreye sokuyor) metin rengi `text-[var(--site-header-link-active)]`
olur (hover/idle yerine, `aria-current="page"` da eklenir — erişilebilirlik). Dropdown tetikleyicisi
(satır 149), herhangi bir alt öğesinin href'i eşleştiğinde de aktif sayılır.

**3) Hesap dropdown tetikleyicisi (satır 198), "Giriş Yap" linki (satır 222), favoriler ikonu
(satır 235), sepet ikonu (satır 245):**
```tsx
// ÖNCE: "... text-foreground/70 ... hover:bg-surface-muted hover:text-foreground ..."
// SONRA:
"... text-[var(--site-header-link)] ... hover:bg-surface-muted hover:text-[var(--site-header-link-hover)] ..."
```
**`hover:bg-surface-muted` (dairesel ikon buton hover arka planı) DEĞİŞMEZ** — bu görevin kapsamı
SADECE metin/ikon rengi ("Menü Bağlantı Rengi"), ikon butonlarının hover ARKA PLANI kapsam dışı
(hâlâ `.site-scope`'un `--muted` köprüsünden gelir). Bu 4 öğeye `headerLinkActiveColor` UYGULANMAZ
(hesap/sepet/favori "sayfa navigasyonu" kavramı değil, aktif durum kavramı buraya taşınmaz).

**4) CTA butonu (satır 175-183) ve sepet rozeti (satır 251) DEĞİŞMEZ** — `--site-button`/
`--site-button-text` token'larını kullanmaya devam eder, bu görevin kapsamı dışında.

**5) `DropdownMenuContent` (mobil/nav alt menü paneli) DEĞİŞMEZ** — `.site-scope`'un `--popover`
köprüsünden (`--site-surface`'e bağlı) gelmeye devam eder; header arka plan token'larından
ETKİLENMEZ (ayrı bir yüzey, karıştırılmamalı).

---

## §4 `ColorField` bileşeninde gerekli küçük davranış düzeltmesi (frontend-agent — ZORUNLU, bug önleyici)

**Sorun:** Native `<input type="color">` ASLA alfa kanalı döndürmez — `onChange` her zaman 7
karakterlik (`#rrggbb`) bir değer verir. `ColorField` şu an bu değeri OLDUĞU GİBİ `onChange`'e
geçiriyor (`color-field.tsx` satır 51) — kullanıcı `headerBgColor` gibi alfa-kanallı bir alanda
native swatch'ı açıp bir renk seçtiği an, mevcut `cc`/`f2` alfa son eki SESSİZCE `ff`'e (tam opak)
düşer. Bu gerçek bir regresyon tuzağı, sadece bu 3 header alanını değil, alfa-kanallı HERHANGİ bir
`ColorField` kullanımını etkiler.

**Düzeltme (zaten paylaşılan `ColorField` bileşenine, `maxLength > 7` iken):**
```tsx
function handleSwatchChange(newHex: string) {
  // newHex her zaman 7 karakter (#rrggbb) — native <input type="color"> alfa DÖNDÜRMEZ.
  if (maxLength > 7 && value.length === 9) {
    onChange(newHex + value.slice(7)); // mevcut alfa son ekini KORU
  } else {
    onChange(newHex);
  }
}
```
Native `<input type="color">` elemanının `value` prop'u da `value.slice(0, 7)` olmalı (9 karakterli
bir `value` attribute'u tarayıcının native rengini bozabilir/reddedebilir) — hex metin `<Input>`'u
DEĞİŞMEDEN tam `value`'yu gösterip düzenlemeye devam eder (kullanıcı orada 9 haneyi elle
görür/yazar).

---

## §5 WCAG kontrast rozeti — `contrast.ts` genişletmesi (frontend-agent — ZORUNLU)

**Sorun:** `contrast.ts::hexToRgb` şu an SADECE tam 6 haneli hex kabul ediyor
(`/^#([0-9a-fA-F]{6})$/`). Alfa kanallı `headerBgColor`/`headerStickyBgColor`/`headerLinkColor`
`checkAgainst`'a verildiğinde `contrastRatio` sessizce `null` döner, `ContrastBadge` HİÇBİR ŞEY
göstermez (`color-field.tsx` satır 14) — en kritik çift (link rengi vs header zemini) için rozet
tamamen kaybolur.

**Düzeltme (tek satırlık, geriye dönük uyumlu regex genişletmesi):**
```ts
// ÖNCE: /^#([0-9a-fA-F]{6})$/
// SONRA: /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/
```
Yakalama grubu 1 (RGB) DEĞİŞMEDEN aynı pozisyonda kalır — alfa (grup 2, varsa) hesaplamaya
KATILMAZ, göz ardı edilir. **Bilinçli yaklaşım notu (dokümante edilmeli):** bu, saydamlık
öncesi ham RGB karşılaştırmasıdır — gerçek render edilen kontrast (arkadaki içeriğe göre)
biraz DAHA DÜŞÜK olabilir. Rozet zaten engellemeyen (non-blocking) bir "ipucu" olduğu için
(§10.12.4, mevcut proje kararı) bu yaklaşım kabul edilebilir bir yaklaşıklıktır, YENİ bir
istisna değildir.

**Kontrast doğrulama (varsayılan değerlerle, alfa göz ardı edilerek — hepsi geçiyor):**

| Çift | Ham RGB (alfa yok sayılır) | Sonuç |
|---|---|---|
| `headerLinkColor` (`#111827`) vs `headerBgColor` (`#ffffff`) | **17.74:1** | ✅ AA |
| `headerLinkColor` (`#111827`) vs `headerStickyBgColor` (`#ffffff`) | **17.74:1** | ✅ AA |
| `headerLinkHoverColor` (`#111827`) vs `headerBgColor` (`#ffffff`) | **17.74:1** | ✅ AA |
| `headerLinkActiveColor` (`#4f46e5`) vs `headerBgColor` (`#ffffff`) | **6.29:1** | ✅ AA |

---

## §6 Admin UI — "Header & Menü Renkleri" alt-bölümü (Stil / Renk sekmesi içinde)

**Yerleşim — YENİ sekme AÇILMAZ.** `frontend/src/app/admin/appearance/page.tsx`'teki mevcut
`TabsContent value="colors"` Card'ının İÇİNDE, "Bileşen Renkleri" (Grup B, `accentColor`'dan
sonra) grubunun ALTINA, "Bileşen Stilleri" (borderRadius/buttonStyle) grubunun ÜSTÜNE eklenir —
`design-notes-theme-typography.md` §6'daki "aynı Card içinde `border-t` ayraçla alt-bölüm" paterni
BİREBİR tekrarlanır:

```
Card ("Stil / Renk")
 ├─ Kurumsal Renk Paletleri (mevcut, değişmedi)
 ├─ "Marka & Yüzey Renkleri" (6 alan, mevcut)
 ├─ "Bileşen Renkleri" (4 alan, mevcut)
 ├─ border-t pt-4 ayraç
 ├─ [YENİ] SectionHeader (icon: PanelTop) "Header & Menü Renkleri"
 │         description: "Site üst menüsünün arka plan ve bağlantı renkleri."
 ├─ [YENİ] alt-etiket "Normal Durum" — grid-cols-1 sm:grid-cols-2
 │    ├─ ColorField headerBgColor "Menü Arka Planı" (maxLength=9)
 │    └─ ColorField headerLinkColor "Bağlantı Rengi (Menü)" (maxLength=9, checkAgainst=headerBgColor)
 │         DÜZELTME (qa-agent regresyonu, frontend-agent uygulaması, İKİ AŞAMALI) — orijinal
 │         etiket "Bağlantı Rengi" idi; bu, AYNI sekmedeki mevcut "Bileşen Renkleri" grubunun
 │         `linkColor` alanıyla (o da "Bağlantı Rengi") `ColorField`'in
 │         `aria-label={`${label} — hex kod`}` deseni yüzünden BİREBİR AYNI erişilebilir isme
 │         yol açıyordu (a11y regresyonu + `admin-appearance-studio.spec.ts`'in
 │         `getByLabel('Bağlantı Rengi — hex kod')` çağrısını çakışmayla kırıyordu).
 │         1. deneme "Menü Bağlantı Rengi" YETERSİZ ÇIKTI: Playwright'in `getByLabel(string)`'i
 │         varsayılan olarak TAM eşleşme DEĞİL, alt-dize (substring) eşleşmesi yapar — "Menü
 │         Bağlantı Rengi — hex kod" hâlâ "Bağlantı Rengi — hex kod"ı bir alt-dize olarak
 │         İÇERDİĞİ için çakışma AYNEN sürdü (öneki DEĞİL, sonek/gövde çakışması önemli).
 │         Nihai düzeltme: sonek yerine mevcut Hover/Aktif alanlarıyla (`"Bağlantı Rengi (Üzerine
 │         Gelince)"`, `"Bağlantı Rengi (Aktif Sayfa)"`) AYNI "parantez içi ayırt edici" deseni
 │         kullanılarak `"Bağlantı Rengi (Menü)"` yapıldı — parantez, `"Bağlantı Rengi — hex
 │         kod"` alt-dizesinin bitişikliğini kırar (araya `" (Menü)"` girer), bu yüzden artık ne
 │         tam ne de alt-dize eşleşmesi çakışmaz. §3/§6'daki diğer tüm referanslar (kod, id,
 │         davranış) DEĞİŞMEDİ, yalnızca görünen `label` metni.
 ├─ [YENİ] alt-etiket "Hover / Aktif Sayfa" — grid-cols-1 sm:grid-cols-2
 │    ├─ ColorField headerLinkHoverColor "Bağlantı Rengi (Üzerine Gelince)"
 │    └─ ColorField headerLinkActiveColor "Bağlantı Rengi (Aktif Sayfa)"
 ├─ border-t border-border/60 pt-4 (iç ayraç)
 ├─ [YENİ] alt-etiket "Yapışkan Header (Kaydırma Sonrası)"
 │    ├─ ColorField headerStickyBgColor "Yapışkan Menü Arka Planı" (maxLength=9)
 │    ├─ <p className="text-xs text-foreground/50">Bağlantı rengiyle kontrastı:</p>
 │    ├─ <ContrastBadge foreground={form.headerLinkColor} background={form.headerStickyBgColor} />
 │    └─ Switch satırı: "Bulanıklık (Backdrop Blur)" — headerStickyBlurEnabled
 ├─ border-t pt-4 ayraç
 ├─ SectionHeader (Layers) "Bileşen Stilleri" — MEVCUT, DEĞİŞMEDİ
```

**Kod iskeleti (Switch satırı, mevcut "Ekstra Özellikler" satır deseniyle AYNI — `PanelTop` ikonu
`stickyHeaderEnabled` togglesindeki ile AYNI ikon, kavramsal bağı görsel olarak da kurar):**
```tsx
<div className="flex items-center gap-2 rounded-lg border border-border/60 p-3">
  <PanelTop className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
  <div className="min-w-0 flex-1">
    <p className="text-sm font-medium text-foreground">Bulanıklık (Backdrop Blur)</p>
    <p className="text-xs text-foreground/60">
      Yapışkan haldeyken menü arkasındaki içerik hafifçe bulanıklaşır.
    </p>
  </div>
  <Switch
    checked={form.headerStickyBlurEnabled}
    onCheckedChange={(checked) => updateColorOrTypographyField("headerStickyBlurEnabled", Boolean(checked))}
    aria-label="Yapışkan header bulanıklığı"
  />
</div>
```

**Çapraz-sekme bağımlılık uyarısı — "Yapışkan Header" mini-grubu için:** `form.stickyHeaderEnabled`
(Ekstra Özellikler sekmesindeki toggle) `false` iken bu alt-grup (`headerStickyBgColor` +
`ContrastBadge` + blur `Switch`'i) `opacity-50 pointer-events-none` ile GÖRSEL OLARAK devre dışı
gösterilir (disabled input'lar DEĞİL — `pageHeaderOverlayOpacity`'nin `MINIMAL_LINE`/`SPLIT`'te
devre dışı bırakılma paterniyle AYNI), altına küçük bir not eklenir:
```tsx
<p className="text-xs text-foreground/50">
  Bu ayarları etkin kılmak için <Button variant="link" size="sm" onClick={() => setActiveTab("features")}>Ekstra Özellikler</Button>{" "}
  sekmesinden &quot;Yapışkan Header&quot;ı açın.
</p>
```

**`accentColor`'daki metinsel-uyarı deseninin AYNISI `headerLinkColor` alanına da bir alt not
olarak eklenir** (opsiyonel ama önerilir, tutarlılık için):
```tsx
<p className="text-xs text-foreground/50">
  Bu renk header&apos;daki tüm bağlantı ve ikonlara (sepet, favoriler, hesap) uygulanır.
</p>
```

**Canlı önizleme:** Sağdaki mevcut `SiteHeader` önizlemesi zaten `previewCssVars`'ı (§2'deki 5
token eklenince) `.site-scope`'a satır-içi yazdığı için renk alanları ANINDA yansır — EK bir kod
gerekmez. **Sticky durumun kendisi ÖNİZLEMEDE SİMÜLE EDİLMEZ** (önizleme kutusu kaydırılabilir
değil, sabit yükseklikte statik bir kutu) — bu bilinen/kabul edilen bir sınırlama, `pageHeaderStyle`
önizlemesinin de gerçek sayfa navigasyonunu simüle etmemesiyle AYNI kapsam kısıtı.

---

## §7 `SECTION_FIELDS.colors` genişletmesi (frontend-agent, uygulama detayı — netlik için burada listelenir)

`frontend/src/app/admin/appearance/page.tsx`'teki `COLOR_FIELDS` dizisinin YANINA (birleştirilmeden,
ayrı bir sabit olarak — semantik netlik için) eklenecek 6 alan:
```ts
const HEADER_COLOR_FIELDS = [
  "headerBgColor",
  "headerStickyBgColor",
  "headerStickyBlurEnabled",
  "headerLinkColor",
  "headerLinkHoverColor",
  "headerLinkActiveColor",
] as const;
```
`SECTION_FIELDS.colors` → `["presetKey", ...COLOR_FIELDS, ...HEADER_COLOR_FIELDS, ...COMPONENT_STYLE_FIELDS]`.
`DEFAULT_APPEARANCE` (client), `FULLNESS_DEFAULTS`, `formFromDto`/`toRequestValue` eşlemelerine
§1'deki 6 varsayılan değer eklenir — bunlar backend `DEFAULTS`'uyla (appearance.routes.ts) BİREBİR
aynı tutulmalıdır (mevcut proje kuralı, `DEFAULT_APPEARANCE`'ın kendi dosya başı yorumunda zaten
belirtiliyor).

---

## Özet — backend-agent'a devredilecek işler

1. §1'deki 6 alanı `SiteAppearance` modeline ekle (migration).
2. Zod şemasına 6 alanı ekle — 3'ü (`headerBgColor`/`headerStickyBgColor`/`headerLinkColor`)
   alfa-kanallı hex regex, 2'si (`headerLinkHoverColor`/`headerLinkActiveColor`) düz 6-haneli hex,
   1'i (`headerStickyBlurEnabled`) boolean.
3. `appearance.routes.ts` DEFAULTS objesine §1'deki 6 varsayılan değeri ekle.
4. `openapi.yaml`'daki `SiteAppearance`/`UpdateSiteAppearanceRequest` şemalarına 6 alanı ekle.

## Özet — frontend-agent'a devredilecek işler

1. `layout.tsx` `siteScopeStyle` + `page.tsx` `previewCssVars` + `globals.css` `.site-scope`
   fallback bloğuna §2'deki 5 CSS değişkenini ekle.
2. `site-header.tsx`: §3'teki tüm class/prop değişiklikleri (`headerStickyBlurEnabled` prop'u,
   aktif sayfa tespiti, 4 farklı öğe grubunun token eşlemesi).
3. `ColorField`'e §4'teki alfa-koruma düzeltmesini uygula (paylaşılan bileşen, tüm alfa-kanallı
   kullanım noktalarını etkiler).
4. `contrast.ts`'e §5'teki tek satırlık regex genişletmesini uygula.
5. `page.tsx`: §6'daki admin UI bölümünü ekle (çapraz-sekme disabled durumu dahil), §7'deki
   `SECTION_FIELDS`/`DEFAULT_APPEARANCE` genişletmelerini yap.
