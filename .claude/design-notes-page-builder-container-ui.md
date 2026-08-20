# Tasarım Notları: Hiyerarşik Konteyner Editörü — Görsel/UX Katmanı

Ajan: **ui-designer** · Durum: **v1 (spesifikasyon, implementasyon bekliyor)** · Sahibi: ui-designer
Kapsam: **yalnızca §10.17→v3 (`.claude/design-notes-page-builder-containers.md`) Dalga 2.1'in görev tanımı.** Bu doküman kod İÇERMEZ; `frontend-agent` bunu okuyup `container-settings-panel.tsx` ve `layout-picker.tsx` (+ `builder-canvas.tsx` genişletmesi) dosyalarını buna göre kodlar.

Bağlayıcı kaynak (bu dokümanın ÜZERİNDE): `.claude/design-notes-page-builder-containers.md` — veri modeli, sayısal sabitler (`MAX_CONTAINER_DEPTH=4`, `MAX_CHILDREN_PER_CONTAINER=24`, `ROW_CHILDREN_READABILITY_WARNING_THRESHOLD=6`, `DEFAULT_CONTAINER_MAX_WIDTH=1170`, `MIN/MAX_CONTAINER_MAX_WIDTH=320/1920`), flexbox kararı, `chrome: "page"|"bare"` sözleşmesi. Bu dokümanda bu değerler **tekrar edilir ama YENİDEN KARARLAŞTIRILMAZ.**

## 0. Görsel yön (mevcut idiomun devamı — yeni bir dil İCAT EDİLMEDİ)

Proje zaten **Minimal/Flat** bir idiom kullanıyor: düz `bg-card`/`bg-surface-muted` yüzeyler, `border` (çoğunlukla `border-dashed` konteyner/sürükle-bırak alanlarında), `rounded-lg`/`rounded-xl`, opaklık-tonlamalı metin (`text-foreground/40..70`), `shadow-sm` (buzlu cam/`backdrop-blur` YOK). Bu doküman **aynı dili sürdürür**:

- Yeni renk tokenı **eklenmez** — yalnızca mevcut `primary`, `warning`, `danger`, `foreground/N`, `border`, `surface-muted` kullanılır.
- Blur/glow/gradient efekti **kullanılmaz.**
- Tüm ikonlar `lucide-react`'ten (bu dokümanda adı geçen her ikon `frontend/node_modules/lucide-react` içinde doğrulandı — frontend-agent import hatası almaz).
- Tüm etkileşimli kontroller mevcut primitiflerden kurulur: `Button`, `DropdownMenu`, `ConfirmDialog`, `Field`, `Input`/`InputGroup`, `Select`, `Accordion` YOK bu panelde (bkz. §2.1 gerekçesi) — bunun yerine email-editor'ın kanıtlanmış **`StyleSection`** deseni yeniden kurulur (aynı sınıflar, page-builder'a local kopya — bkz. §2.1).

---

## 1. (a) Layout Picker — 7 ön ayar + Palette "Düzen"/"İçerik" ayrımı

### 1.1 Palette'in iki bölümü

Mevcut `block-list.tsx` (`flex flex-wrap gap-2` + `<Button variant="secondary" size="sm">+ Label</Button>` çipleri) **İçerik bölümü olarak birebir korunur** — hiçbir sınıf değişmez. Palette'e yalnızca **üstüne** yeni bir "Düzen" bölümü eklenir. Palette kapsayıcısı (muhtemelen sağ panel veya canvas üstü — frontend-agent mevcut yerleşimi korur) şu iskeleti alır:

```
┌ Palette ──────────────────────────────────────┐
│  DÜZEN                              (uppercase, text-[11px]  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐              tracking-wide      │
│  │▮▮▮▮│ │▮ ▮│ │▮ ▮▮│ │▮▮ ▮│  …            text-foreground/40) │
│  └────┘ └────┘ └────┘ └────┘                                 │
│                                                                │
│  İÇERİK                                                       │
│  [+ Hero] [+ Metin] [+ Görsel] [+ Galeri] …  (DEĞİŞMEDİ)      │
└─────────────────────────────────────────────────────────────┘
```

İki bölüm arasında email panelindeki `StyleSection` ayracı kullanılır: `border-t border-border/60 pt-4` (ikinci bölümün üstünde), başlık `text-[11px] font-semibold tracking-wide text-foreground/40 uppercase` — bu iki sınıf zaten `style-controls.tsx::StyleSectionLabel`'de var, page-builder'a **aynı sınıflarla** yeni bir küçük yerel bileşen olarak taşınır (bkz. §2.1, cross-feature import YAPILMAZ — `admin/page-builder` kendi kopyasını tutar, `admin/email-editor`'a bağımlı olmaz).

Palette geneli **her zaman görünür** (mevcut blok listesi gibi), bir sekme/tab arkasına gizlenmez — iki başlık aynı anda görünür, kullanıcı "önce yapı sonra içerik" akışını görsel olarak öğrenir.

### 1.2 7 ön ayar — ızgara önizlemesi (custom mini-preview, ikon DEĞİL)

`weights: number[]` (§8.2, mimarın dokümanı) doğrudan görsel orana çevrilebildiği için, her ön ayar bir **lucide ikonu değil**, gerçek oranı yansıtan **mini flex önizlemesi** ile temsil edilir (Gutenberg'in sütun-varyant seçicisiyle aynı prensip — ikon setinde `33/66` gibi oranları temsil eden hazır bir ikon YOK, uydurma bir ikon kullanmak yanıltıcı olur).

**Tek bir "preset tile" bileşeni** (`LayoutPresetTile`), her ön ayar için:

```
<button type="button" aria-label="{label}" title="{label}"
  className="flex flex-col items-center gap-1.5 rounded-lg border border-border/60
             bg-surface-muted p-2 transition-colors hover:border-primary/50
             hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-3
             focus-visible:ring-ring/50 outline-none">
  {/* mini önizleme kutusu */}
  <span className="flex h-8 w-14 items-stretch gap-0.5 rounded-md border border-border/50 bg-background p-1">
    {weights.map((w, i) => (
      <span key={i} style={{ flexGrow: w }} className="rounded-[2px] bg-primary/25" />
    ))}
  </span>
  <span className="text-[11px] font-medium text-foreground/70">{label}</span>
</button>
```

- Izgara: `grid grid-cols-4 gap-2` (7 öğe → 4+3 satır; dar sağ panelde `grid-cols-3` de kabul edilebilir, frontend-agent viewport genişliğine göre seçer).
- Hover: `border-primary/50 bg-primary/5` (mevcut `AddColumnMenu`/palette hover diliyle tutarlı — proje zaten `aria-expanded:bg-muted` gibi tonlamalar kullanıyor).
- Aktif/basılı durum yok (bunlar birer "ekle" eylemi, toggle değil — tıklanınca `createContainerFromPreset(preset)` çağrılır ve seçili konteynere/köke eklenir, buton kendi durumunu tutmaz).
- `"100"` (Tek Sütun) önizlemesi **tek bir dolu blok** gösterir (`weights: [1]` zaten bunu üretir, özel durum kodu gerekmez).

7 karonun etiketleri ve `weights`'i mimarın `LAYOUT_PRESETS` sabitiyle **birebir aynı sırada**:

| Sıra | id | Etiket (buton altı) | Mini önizleme oranı |
|---|---|---|---|
| 1 | `100` | Tek Sütun | `[1]` — tek dolu blok |
| 2 | `50-50` | İki Eşit Sütun | `[1,1]` — iki eşit blok |
| 3 | `33-66` | Dar + Geniş | `[1,2]` — dar/geniş |
| 4 | `66-33` | Geniş + Dar | `[2,1]` — geniş/dar |
| 5 | `33-33-33` | Üç Eşit Sütun | `[1,1,1]` |
| 6 | `25-50-25` | Dar + Geniş + Dar | `[1,2,1]` |
| 7 | `25-25-25-25` | Dört Eşit Sütun | `[1,1,1,1]` |

### 1.3 Ekleme hedefi göstergesi

Mimarın kararı: "Ekleme hedefi: **seçili konteyner** (yoksa kök dizi)." Kullanıcının nereye eklediğini bilmesi için, Palette'in üstünde (Düzen bölümünün üstünde, tüm palette'in başlığı olarak) küçük bir bağlam satırı gösterilir:

```
<p className="mb-2 flex items-center gap-1.5 text-xs text-foreground/50">
  <CornerDownRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
  Ekleniyor: <span className="font-medium text-foreground/80">{selectedLabel ?? "Sayfa (kök)"}</span>
</p>
```

`CornerDownRight` lucide-react'te doğrulanmalı — yoksa `ArrowRight` kullanılır (her ikisi de sette mevcut standart isimlerdir). Bu satır zorunlu değildir ama **şiddetle önerilir**: mimarın "boş konteyner ekleyip doldurma" akışı (§8.1) hedefsiz hissettirmeye çok müsaittir.

---

## 2. (b) Konteyner Ayar Paneli — bilgi mimarisi

### 2.1 İskelet: `StyleSection` deseninin page-builder'a taşınması

`block-settings-panel.tsx`'teki (email-editor) `StyleSection`/`StyleSectionLabel` **davranışsal olarak aynısı**, `frontend/src/components/admin/page-builder/container-settings-panel.tsx` içinde **yerel** olarak yeniden tanımlanır (import EDİLMEZ — iki feature klasörü birbirine bağımlı olmamalı, bu proje genelinde zaten böyle: email-editor kendi `style-controls.tsx`'ini tutuyor). Sınıflar **birebir aynı**:

```tsx
function SettingsSectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold tracking-wide text-foreground/40 uppercase">{children}</p>;
}
function SettingsSection({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={cn("space-y-2.5", !first && "border-t border-border/60 pt-4")}>
      <SettingsSectionLabel>{title}</SettingsSectionLabel>
      {children}
    </div>
  );
}
```

Panel gövdesi üç `SettingsSection` içerir, **bu sırayla**: **Düzen → Boşluk → Arka Plan** (mimarın 2.1 görev tanımındaki sıra ile birebir).

### 2.2 Bölüm 1 — "Düzen" (`layout`, `customWidth`, `minHeight`, `direction`, `justifyContent`, `alignItems`, `gap`)

Alt gruplar, üstten alta:

**2.2.1 Kutulu / Tam Genişlik (`layout`)**

İki seçenekli segmented toggle (mevcut `ButtonRadiusControl`/`DividerThicknessControl` deseniyle birebir — `flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5 w-fit`, her seçenek `Button size="xs" variant={active ? "secondary" : "ghost"}`):

```
[ Minimize2  Kutulu ]  [ Maximize2  Tam Genişlik ]
```

- `layout: "boxed"` → `Minimize2` ikonu, etiket "Kutulu".
- `layout: "full-width"` → `Maximize2` ikonu, etiket "Tam Genişlik".
- `aria-pressed` ile mevcut değer işaretlenir (AlignControl deseniyle aynı).

**2.2.2 Genişlik slider'ı — YALNIZCA `layout === "boxed"` iken render edilir**

`appearance/page.tsx`'teki kanıtlanmış "range input + label içinde canlı değer" deseni **birebir** kullanılır (yeni bir Slider primitifi İCAT EDİLMEZ — projede yok, native `<input type="range">` zaten idiom):

```tsx
<div className="space-y-1.5">
  <label htmlFor="container-width" className="block text-sm font-medium text-foreground">
    Genişlik ({customWidth ?? 1170}px)
  </label>
  <input
    type="range"
    id="container-width"
    min={320}
    max={1920}
    step={10}
    value={customWidth ?? 1170}
    onChange={(e) => onChange({ customWidth: Number(e.target.value) })}
    className="w-full accent-primary"
  />
  <p className="text-xs text-foreground/60">Varsayılan: 1170px. 320–1920px arası.</p>
</div>
```

`step={10}` — 320-1920 arası 160 adım, sürükleme ile makul hassasiyet sağlar; tam piksel gerekiyorsa kullanıcı klavye ok tuşlarıyla (`step` kadar) ince ayar yapar. Ekstra bir sayısal `Input` **eklenmez** — mevcut idiom (appearance sayfası) hiçbirinde slider yanına ayrı sayı kutusu koymuyor, tutarlılık için aynı yalınlık korunur.

**2.2.3 `minHeight` (opsiyonel değer + birim)**

Nullable alan deseni (`NullableColorField`'daki "X ile temizle" fikri, alan tipi değişse de aynı UX): kapalıyken küçük bir "Ekle" butonu, açıkken sayı + birim toggle + temizle.

Kapalı durum (`minHeight === undefined`):
```tsx
<Button type="button" variant="ghost" size="sm" onClick={() => onChange({ minHeight: { value: 400, unit: "px" } })}>
  <Plus className="h-3.5 w-3.5" /> Minimum yükseklik ekle
</Button>
```

Açık durum:
```tsx
<div className="space-y-1.5">
  <div className="flex items-center justify-between">
    <label className="text-sm font-medium text-foreground">Minimum yükseklik</label>
    <Button type="button" variant="ghost" size="icon-xs" aria-label="Minimum yüksekliği kaldır" onClick={() => onChange({ minHeight: undefined })}>
      <X className="h-3.5 w-3.5" />
    </Button>
  </div>
  <InputGroup>
    <InputGroupInput
      type="number" min={0} max={5000}
      value={minHeight.value}
      onChange={(e) => onChange({ minHeight: { ...minHeight, value: Number(e.target.value) } })}
    />
    <InputGroupAddon align="inline-end" className="gap-0.5 pr-1">
      {(["px", "vh"] as const).map((u) => (
        <Button key={u} type="button" size="xs" variant={minHeight.unit === u ? "secondary" : "ghost"}
                aria-pressed={minHeight.unit === u} onClick={() => onChange({ minHeight: { ...minHeight, unit: u } })}>
          {u}
        </Button>
      ))}
    </InputGroupAddon>
  </InputGroup>
</div>
```

`InputGroup`/`InputGroupInput`/`InputGroupAddon` mevcut primitiflerdir (`components/ui/input-group.tsx`), email editörünün "Genişlik (px)" alanıyla aynı desen (§`block-settings-panel.tsx` `image-width` alanı) — burada tek fark `px` sabit metin yerine `px`/`vh` arası **seçilebilir** iki buton olması.

**2.2.4 Yön (`direction`)**

Segmented toggle, 2.2.1 ile aynı görsel dil:

```
[ Rows2  Dikey (Sütun) ]  [ Columns2  Yatay (Satır) ]
```

- `direction: "column"` → `Rows2` ikonu, "Dikey (Sütun İstifleme)".
- `direction: "row"` → `Columns2` ikonu, "Yatay (Satır)".

Yardımcı not (küçük, `text-xs text-foreground/50`): *"Yatay konteynerler mobilde otomatik olarak alt alta dizilir."* — mimarın §6.2 "mobil davranış" kararının kullanıcıya çevirisi (kod DEĞİL, sadece bilgilendirme metni).

**2.2.5 `justifyContent` / `alignItems` — icon-toggle-group (mevcut `AlignControl`/`VerticalAlignControl` deseni)**

Bu iki kontrol **eksen-duyarlıdır**: `direction`'a göre hangi ikon setinin kullanılacağı değişir (ana eksen `justifyContent`'in, çapraz eksen `alignItems`'in davrandığı yön). Mimarın flexbox kararının (§6.1) doğal sonucu.

| `direction` | `justifyContent` ikon seti (ana eksen) | `alignItems` ikon seti (çapraz eksen) |
|---|---|---|
| `row` | yatay: `AlignHorizontalJustifyStart/Center/End`, `AlignHorizontalSpaceBetween`, `AlignHorizontalSpaceAround`, `AlignHorizontalDistributeCenter` | dikey: `AlignVerticalJustifyStart/Center/End`, stretch: `StretchVertical` |
| `column` | dikey: `AlignVerticalJustifyStart/Center/End`, `AlignVerticalSpaceBetween`, `AlignVerticalSpaceAround`, `AlignVerticalDistributeCenter` | yatay: `AlignHorizontalJustifyStart/Center/End`, stretch: `StretchHorizontal` |

`justifyContent` (6 değer) — tek satırda 6 ikon buton, `AlignControl` ile birebir sınıf (`flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5`, her biri `Button size="icon-xs" variant={active ? "secondary" : "ghost"} aria-pressed`):

```
start · center · end · between · around · evenly
```

`evenly` için özel bir lucide ikonu yok — `AlignHorizontalDistributeCenter` (yatay) / `AlignVerticalDistributeCenter` (dikey) kullanılır; `around` ile görsel benzerliği `title`/`aria-label` metniyle netleştirilir: `title="Eşit dağıt (kenar boşluğu yarım)"` (around) vs `title="Eşit dağıt (kenar boşluğu tam)"` (evenly) — tooltip zorunlu, ikon tek başına ayırt edici değildir.

`alignItems` (4 değer) — aynı segmented desen, `stretch` **her zaman ilk seçenek** (varsayılan):

```
stretch · start · center · end
```

Her iki kontrolün üstünde `text-xs font-medium text-foreground/70` etiket ("Ana eksen hizalama" / "Çapraz eksen hizalama") — email editöründeki `ButtonRadiusControl` üstü `<p className="text-xs font-medium text-foreground/70">Köşe yarıçapı</p>` deseniyle birebir.

**2.2.6 `gap`**

Tek bir sayısal alan, `InputGroup` + `px` addon (email'in `image-width` alanıyla birebir aynı desen):

```tsx
<Field id="container-gap" label="Öğeler arası boşluk">
  {(p) => (
    <InputGroup>
      <InputGroupInput {...p} type="number" min={0} max={128} value={gap} onChange={(e) => onChange({ gap: Number(e.target.value) })} />
      <InputGroupAddon align="inline-end">px</InputGroupAddon>
    </InputGroup>
  )}
</Field>
```

### 2.3 Bölüm 2 — "Boşluk" (`padding`, `margin`)

4-kenar giriş, "4 ayrı `Field`" yerine **kompakt 2×2 ızgara** (Üst/Sağ/Alt/Sol), her biri küçük etiketli `InputGroupInput` + `px`:

```tsx
<div className="space-y-3">
  <div className="flex items-center justify-between">
    <SettingsSectionLabel>İç Boşluk (Padding)</SettingsSectionLabel>
    <LinkedSidesToggle linked={paddingLinked} onToggle={setPaddingLinked} />
  </div>
  <div className="grid grid-cols-2 gap-2">
    {(["top", "right", "bottom", "left"] as const).map((side) => (
      <div key={side} className="space-y-1">
        <label className="text-[11px] text-foreground/50">{SIDE_LABEL[side]}</label>
        <InputGroup>
          <InputGroupInput type="number" min={0} max={200}
            value={padding[side]}
            onChange={(e) => onChangeSide("padding", side, Number(e.target.value))} />
          <InputGroupAddon align="inline-end">px</InputGroupAddon>
        </InputGroup>
      </div>
    ))}
  </div>
</div>
```

`SIDE_LABEL = { top: "Üst", right: "Sağ", bottom: "Alt", left: "Sol" }`.

`margin` **aynı ızgara**, alt bölümde tekrarlanır (aynı `SettingsSection` içinde, `border-t border-border/40 pt-3` ile ayrılmış — Boşluk bölümü içinde iki alt-grup: "İç Boşluk (Padding)" + "Dış Boşluk (Margin)").

**`LinkedSidesToggle` (yeni, küçük, isteğe bağlı ama önerilir):** `Link2`/`Unlink2` ikonlu tek bir `Button size="icon-xs" variant={linked ? "secondary" : "ghost"}` — açıkken 4 kenardan birine yazılan değer **hepsine** uygulanır (yalnızca editör state mantığı, `frontend-agent`'ın `containers.ts`'inde `updateContainerSettings` çağrısı içinde ele alınır — bu doküman yalnızca butonun görünümünü/varlığını tanımlar, state mantığı frontend-agent'ındır). Varsayılan: **kapalı** (`unlinked`) — mimarın şeması zaten 4 bağımsız alan tanımlıyor, "linked" yalnızca bir editör kolaylığıdır, veri modelini etkilemez.

`margin` alanları için **negatif değer girişi arayüzde de engellenir** (`min={0}`) — mimarın §5.2/§13.4 kararı (negatif margin yasağı, hem UX tuzağı hem public-render spoofing riski) UI seviyesinde de yansıtılır; input `min=0 max=200` ile zaten native olarak sınırlanır, ek bir uyarı gerekmez.

### 2.4 Bölüm 3 — "Arka Plan" (`background`)

Üç seçenekli segmented toggle (2.2.1 ile aynı görsel dil), 3 buton:

```
[ Ban  Yok ]  [ Palette  Renk ]  [ ImageIcon  Görsel ]
```

`Ban` (yok/none simgesi için — lucide'de standart), `Palette` (renk seçimi simgesi — lucide'de standart, e-posta rengi kontrolünde kullanılmıyor ama sette mevcut), `Image` (lucide'de `Image` adıyla doğrulandı, `ImageIcon` diye import edilmeli çünkü global `Image` DOM tipiyle çakışır — frontend-agent zaten projede bu takma adı kullanıyor olmalı, örn. `import { Image as ImageIcon } from "lucide-react"`).

**`type: "none"`** seçiliyken alt alanlar hiç render edilmez.

**`type: "color"`** seçiliyken: mevcut `ColorField` (`components/admin/appearance/color-field.tsx`) **birebir aynı şekilde** kullanılır (native `type=color` swatch + hex `Input`, `maxLength={7}`) — ancak `background.value` regex'i `#rgb|#rrggbb|#rrggbbaa` kabul ettiği için (mimar §5.2), `ColorField`'ın `maxLength={7}`'si 8-haneli alfa varyantını (`#rrggbbaa`, 9 karakter) kabul edemez; frontend-agent bu alan için `ColorField`'ı **kopyalamadan**, `maxLength` prop'unu `9`'a çıkaracak şekilde genişletmesi gerekir (bu bir **davranış** notudur, `ColorField`'a opsiyonel bir `maxLength` prop'u eklenmesi yeterlidir — kod detayı frontend-agent'a bırakılır, burada yalnızca gereksinim belirtilir).

**`type: "image"`** seçiliyken: `ImageUploadField` (`components/admin/media/image-upload-field.tsx`, zaten cross-feature kullanılan genel bileşen — hero/image blok editörlerinde de kullanılıyor) `value`/`onChange` ile `background.value`'ya bağlanır. Altında 3 küçük `Select` (mevcut `components/ui/select.tsx`, email'in "Boyut" alanındaki `<Field><Select>` deseniyle birebir aynı):

```tsx
<Field id="bg-position" label="Konum">
  {(p) => (
    <Select {...p} value={background.position} onChange={(e) => onChange({ position: e.target.value })}>
      <option value="center">Orta</option>
      <option value="top">Üst</option>
      <option value="bottom">Alt</option>
      <option value="left">Sol</option>
      <option value="right">Sağ</option>
    </Select>
  )}
</Field>
<Field id="bg-size" label="Boyutlandırma">
  {(p) => (
    <Select {...p} value={background.size} onChange={(e) => onChange({ size: e.target.value })}>
      <option value="cover">Kapla (cover)</option>
      <option value="contain">Sığdır (contain)</option>
      <option value="auto">Otomatik</option>
    </Select>
  )}
</Field>
<Field id="bg-repeat" label="Tekrar">
  {(p) => (
    <Select {...p} value={background.repeat} onChange={(e) => onChange({ repeat: e.target.value })}>
      <option value="no-repeat">Tekrarsız</option>
      <option value="repeat">Tekrarlı</option>
    </Select>
  )}
</Field>
```

### 2.5 Panel yerleşimi (mevcut editörle ilişki)

Panel, seçili konteynerin kart başlığındaki bir "Ayarlar" (dişli) butonuyla açılır — mevcut `builder-canvas.tsx`'in konteyner kartı başlığına (bkz. §3.2 aşağıda) `Settings2` ikonlu bir `Button variant="ghost" size="icon-sm"` eklenir. Panel, `Sheet` (mevcut `components/ui/sheet.tsx`, sağdan açılan panel — projede zaten var, ör. `MediaPicker`/appearance akışlarında kullanılan desenle tutarlı) **veya** sağ sabit sidebar olarak açılabilir; kesin yerleşim frontend-agent'ın mevcut sayfa builder layout'una bağlıdır — bu doküman yalnızca panel **içeriğinin** bilgi mimarisini bağlar, konteyner (Sheet vs sabit panel) seçimi frontend-agent'a bırakılır. **Öneri:** `Sheet` — çünkü email-editor'daki `EmailBlockSettingsPanel` de benzer şekilde ayrı bir sütun/panel olarak render ediliyor (bu projede kanıtlanmış ikinci bir örnek), tutarlılık için aynı desen (sabit sağ panel, `Sheet` değil) tercih edilmelidir — **kesin karar: sabit sağ panel** (email-editor ile birebir tutarlılık, modal/sheet YOK).

---

## 3. (c) İç içe konteynerlerin görsel hiyerarşisi (4 seviye derinlik)

### 3.1 Derinlik göstergesi — kenarlık yoğunluğu + sol vurgu çubuğu + rozet

Renk paleti **genişletilmez** (§0) — `primary` tonunun artan opaklığı + artan girinti (`padding`) + numaralı rozet üçlüsü ile 4 seviye ayırt edilir:

| Derinlik | Dış kenarlık | Sol vurgu çubuğu | Arka plan | İç padding | Rozet |
|---|---|---|---|---|---|
| 1 (kök altı ilk konteyner) | `border-2 border-dashed border-border/70` | `border-l-4 border-l-primary/20` | `bg-surface-muted/30` | `p-4` | `Seviye 1` |
| 2 | `border-2 border-dashed border-border/60` | `border-l-4 border-l-primary/40` | `bg-surface-muted/20` | `p-3.5` | `Seviye 2` |
| 3 | `border-2 border-dashed border-border/50` | `border-l-4 border-l-primary/60` | `bg-surface-muted/15` | `p-3` | `Seviye 3` |
| 4 (maksimum, `MAX_CONTAINER_DEPTH`) | `border-2 border-dashed border-border/40` | `border-l-4 border-l-primary/80` | `bg-surface-muted/10` | `p-2.5` | `Seviye 4 · Maks.` |

Rozet, mevcut `ColumnsContainerCard` başlığındaki `<span className="text-sm font-medium text-foreground">{columns.length} Sütun</span>` deseninin yanına eklenir, küçük `Badge` (mevcut `components/ui/badge.tsx`, `tone="neutral" size="sm"`) ile:

```tsx
<Badge tone="neutral" size="sm">Seviye {depth}</Badge>
```

`Seviye 4 · Maks.` rozetinde ek olarak Palette'teki Layout Picker karoları **bu konteynerin içinde devre dışı** görünür (`opacity-50 pointer-events-none` + `title="Maksimum iç içe geçme derinliğine ulaşıldı (4)"`) — mimarın derinlik sınırının editörde **önleyici** (yalnızca backend 422'sine güvenmeden) yansıması budur.

Bu tablo yalnızca dış çerçeve/rozet ile ilgilidir; kartın kendi iç yapısı (başlık şeridi, GripVertical tutamacı, ArrowUp/ArrowDown/Trash2 butonları) **mevcut `ColumnsContainerCard` başlık şeridiyle birebir aynı kalır** — yalnızca `ColumnIcon` yerine yön/preset bilgisine göre `Rows2`/`Columns2`/`Columns3`/`Columns4` arasından seçilen bir ikon kullanılır (children sayısına ve `direction`'a göre: `direction: "column"` → `Rows2`; `direction: "row"` → children sayısı 2/3/4+ → `Columns2`/`Columns3`/`Columns4`).

### 3.2 Girinti — ekstra `ml-*` YOK, doğal padding-içi-padding yeterli

Her konteyner kendi `p-4/p-3.5/p-3/p-2.5`'i ile çocuklarını sarmaladığı için, 4 seviye iç içe geçtiğinde toplam sol girinti kümülatif olarak zaten oluşur (`p-4` + `p-3.5` + `p-3` + `p-2.5` ≈ 52px toplam) — ayrıca bir `ml-N` eklenmesi **redundant** olur ve dar ekranlarda taşmayı artırır. Sol vurgu çubuğu (`border-l-4`, §3.1) tek başına yeterli bir "bu bir alt seviye" ipucu sağlar.

### 3.3 Seçili konteynerin vurgusu

Seçili (ayar paneli açık olan) konteyner kartının **başlık şeridi** (dış kenarlık değil — dış kenarlık zaten derinlik göstergesi olarak kullanılıyor, ikisini karıştırmak sinyali zayıflatır):

```
bg-primary/5 + üstte ince bir "seçili" işareti: ring-1 ring-inset ring-primary/40 (yalnızca başlık şeridinde)
```

Somut sınıf: konteyner kartının **tamamına** `ring-2 ring-primary ring-offset-2 ring-offset-background` uygulanır (mevcut `DragOverlay` önizlemesindeki `ring-2 ring-primary/40` deseninin biraz daha belirgin hali — seçili durum sürüklenen-önizlemeden daha güçlü bir vurgu hak eder, bu yüzden opaklık `/40` değil tam `primary`). Bu, derinlik göstergesinin (`border-l-4`, kenarlık opaklığı) üstüne biner ve çakışmaz (`ring` kutunun dışına taşan ayrı bir katmandır, `border`'ı değiştirmez).

Tıklama hedefi: kartın başlık şeridinin **boş alanı** (buton/tutamaç olmayan kısmı) tıklanınca o konteyner "seçili" olur ve ayar paneli açılır — `GripVertical` tutamacı ve aksiyon butonları (`ArrowUp`/`ArrowDown`/`Trash2`/yeni `Settings2`) kendi `onClick`'lerini `stopPropagation` ile korur (mevcut kartlarda zaten buton bazlı ayrık tıklama alanları var, bu davranış genişletilir, bozulmaz).

### 3.4 Boş konteyner bırakma alanı

Mevcut `EmptyColumnDropZone` (`min-h-24 border-2 border-dashed border-border/50`, `isOver` → `border-primary bg-primary/5 text-primary`) **davranışsal olarak korunur**, ancak v3'te konteynerler doğrudan eklenebildiği için (§8.1, mimar) boş bir konteynerin içi **yalnızca** "buraya sürükleyin" değil, aynı zamanda **doğrudan ekleme** imkânı da sunmalıdır:

```tsx
<div className={cn(
  "flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed",
  "border-border/50 text-center text-xs text-foreground/40 transition-colors",
  isOver && "border-primary bg-primary/5 text-primary"
)}>
  <p>Buraya blok sürükleyin</p>
  <span className="text-foreground/30">veya</span>
  <AddColumnMenu onAdd={...} />  {/* mevcut bileşen, DEĞİŞMEDEN yeniden kullanılır */}
</div>
```

Bu, mevcut `AddColumnMenu`'nün (Plus ikonlu `DropdownMenu`) birebir yeniden kullanımıdır — yeni bir bileşen İCAT EDİLMEZ, yalnızca boş-durum şablonuna eklenir.

---

## 4. (d) `ROW_CHILDREN_READABILITY_WARNING_THRESHOLD` (6) — dil ve ton

**Kesin kural: `warning` tonu, `danger`/`destructive` KESİNLİKLE KULLANILMAZ.** Mevcut `ColumnsContainerCard`'daki uyarı rozeti **birebir taşınır**, yalnızca metin `container`'a genelleştirilir:

```tsx
{isRowDirection && children.length >= ROW_CHILDREN_READABILITY_WARNING_THRESHOLD && (
  <span className="flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
    <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
    Bu satırda {children.length} öğe var — okunabilirlik azalabilir.
  </span>
)}
```

- Yalnızca `direction: "row"` konteynerlerde gösterilir (dikey istiflemede okunabilirlik sorunu yoktur).
- Eşik **6 ve üzeri** için görünür, **engelleyici değildir** — Layout Picker/AddColumnMenu ile ekleme **24'e (`MAX_CHILDREN_PER_CONTAINER`) kadar** serbesttir.
- **24'te** (hard cap) davranış mevcut `atMaxColumns` deseniyle aynı: `AddColumnMenu` `disabled`, `title="Bir konteynerde en fazla 24 öğe olabilir"` — bu tek nokta **`danger` değildir**, sadece devre dışı bırakma (disabled state zaten kendi görsel dilini taşır, ek bir kırmızı vurguya gerek yok).
- Konteyner ayar panelinde de aynı rozet **tekrar gösterilir** (panel başlığında, konteynerin genel bilgisiyle birlikte) — kullanıcı paneli açtığında da uyarıyı görür, yalnızca canvas'ta değil.
- `ConfirmDialog` **bu uyarı için asla açılmaz** — 6 eşiği tamamen pasif/bilgilendirici bir rozettir, hiçbir eylemi engellemez veya onay istemez (mimarın "engelleyici DEĞİL" notuyla birebir).

---

## 5. (e) `chrome: "bare"` yaprak bloklarının editördeki temsili

Editör **public render'ın `chrome: "page"` vs `"bare"` piksel farkını simüle ETMEYE ÇALIŞMAZ** — editör kartları zaten kendi tutarlı "editör çerçevesini" taşıyor (başlık şeridi, tutamaç, aksiyon butonları — bu, hangi `chrome` değerine sahip olursa olsun HER zaman görünür, çünkü düzenleme affordance'ıdır, public gutter'ın kendisi değildir). Bunun yerine, editör kullanıcıya **durumsal bir bilgi** verir: "bu blok şu an bir konteynerin içinde, kendi dış boşluğunu konteynerden alıyor."

**Uygulama:** bir yaprak bloğun editör kartı, **kökte** (`chrome: "page"`) İKEN başlık şeridinde hiçbir ek işaret taşımaz (mevcut davranış, DEĞİŞMEZ). **Bir konteynerin içindeyken** (`chrome: "bare"`), başlık şeridindeki blok etiketinin yanına küçük, sessiz bir ikon+tooltip eklenir:

```tsx
{chrome === "bare" && (
  <span title="Dış boşluk konteynerden geliyor (bu bloğun kendi sayfa dolgusu yok)">
    <PanelTop className="h-3.5 w-3.5 shrink-0 text-foreground/30" aria-hidden />
  </span>
)}
```

- İkon **pasif bilgi** amaçlıdır, tıklanamaz, `text-foreground/30` (mevcut `Info` ikonunun kolon gap açıklamasındaki `text-foreground/35` tonuyla aynı aile — bkz. `builder-canvas.tsx` satır 421-423, `title="Mobilde bu sütunlar alt alta sıralanır"` deseninin birebir devamı).
- Renk/ton **warning/danger DEĞİL** — bu bir uyarı değil, nötr bir bilgi notudur (mevcut `Info` ikonu deseniyle aynı nötr aile).
- Ek olarak, `chrome: "bare"` bloklar için kart **dış boşluğu görsel olarak biraz daha sıkı** tutulur: kart `padding` mevcut `p-4`/`p-3` yerine bir tık daha kompakt gösterilebilir (`p-3` yerine `p-2.5`) — bu tamamen editöre özgü bir *ipucu* olup gerçek public render boşluğunu YANSITMAZ, yalnızca "bu blok kendi büyük dış boşluğunu taşımıyor" hissini pekiştirir. **Zorunlu değildir**, frontend-agent mevcut kart boyutlandırmasını değiştirmemeyi tercih ederse (basitlik için) bu adımı atlayabilir — tek **zorunlu** öğe yukarıdaki `PanelTop` ipucu ikonudur.

---

## 6. Bileşen/dosya eşleme tablosu (frontend-agent için hızlı referans)

| UI parçası | Mevcut primitif | Yeni yerel bileşen (isim önerisi) | Hedef dosya |
|---|---|---|---|
| Palette "Düzen"/"İçerik" ayracı | `Button` (İçerik, değişmez) | `LayoutPickerSection`, `SettingsSectionLabel` (yerel kopya) | `frontend/src/components/admin/page-builder/layout-picker.tsx` |
| 7 ön ayar karosu | — | `LayoutPresetTile` | `layout-picker.tsx` |
| Kutulu/Tam Genişlik, Yön toggle'ları | `Button` (segmented, `AlignControl` deseni) | `SegmentedToggle` (genel amaçlı, 2-4 seçenekli) | `container-settings-panel.tsx` |
| Genişlik slider | native `<input type="range">` (appearance/page.tsx deseni) | — | `container-settings-panel.tsx` |
| `minHeight` | `InputGroup`/`InputGroupInput`/`InputGroupAddon`, `Button` | `MinHeightField` | `container-settings-panel.tsx` |
| `justifyContent`/`alignItems` | `Button` (icon-toggle-group, `AlignControl`/`VerticalAlignControl` deseni) | `JustifyContentControl`, `AlignItemsControl` | `container-settings-panel.tsx` |
| `gap` | `Field` + `InputGroup` | — | `container-settings-panel.tsx` |
| Padding/Margin 4-kenar | `Field` + `InputGroup`, `Button` (Link2/Unlink2) | `SpacingBoxControl`, `LinkedSidesToggle` | `container-settings-panel.tsx` |
| Arka plan tipi toggle | `Button` (segmented) | — | `container-settings-panel.tsx` |
| Arka plan renk | `ColorField` (mevcut, `maxLength` genişletmesiyle) | — | `components/admin/appearance/color-field.tsx` (küçük prop eklentisi) |
| Arka plan görsel | `ImageUploadField` (mevcut, değişmeden) | — | — |
| Arka plan konum/boyut/tekrar | `Field` + `Select` | — | `container-settings-panel.tsx` |
| Panel iskeleti (3 bölüm) | — | `SettingsSection`, `SettingsSectionLabel` (yerel kopya) | `container-settings-panel.tsx` |
| Derinlik rozeti | `Badge` (mevcut) | — | `builder-canvas.tsx` (konteyner kartı) |
| Seçili vurgu | `ring-2 ring-primary ring-offset-2` (yeni sınıf, mevcut `DragOverlay` deseninin güçlendirilmişi) | — | `builder-canvas.tsx` |
| Okunabilirlik uyarısı (6 eşiği) | mevcut `bg-warning/10 text-warning` rozet (birebir taşınır) | — | `builder-canvas.tsx`, `container-settings-panel.tsx` |
| Boş konteyner alanı | `EmptyColumnDropZone` + `AddColumnMenu` (ikisi de mevcut, birleştirilir) | — | `builder-canvas.tsx` |
| `chrome: "bare"` ipucu | `PanelTop` ikonu + `title` (mevcut `Info` deseni) | — | `builder-canvas.tsx` |

**Doğrulanmış `lucide-react` ikon adları (bu dokümanda kullanılan, hepsi pakette mevcut):** `Minimize2`, `Maximize2`, `Rows2`, `Rows3`, `Rows4`, `Columns2`, `Columns3`, `Columns4`, `AlignHorizontalJustifyStart/Center/End`, `AlignVerticalJustifyStart/Center/End`, `AlignHorizontalSpaceBetween/Around`, `AlignVerticalSpaceBetween/Around`, `AlignHorizontalDistributeCenter`, `AlignVerticalDistributeCenter`, `StretchHorizontal`, `StretchVertical`, `Link2`, `Unlink2`, `Plus`, `X`, `Settings2`* , `PanelTop`, `Image` (→ `ImageIcon` takma adıyla import edilmeli), `Ban`* , `Palette`* , `AlertTriangle`, `GripVertical`, `ArrowUp`, `ArrowDown`, `Trash2`.

*`Settings2`, `Ban`, `Palette` bu oturumda dosya-içi doğrulanmadı (standart lucide setinde bilinen isimler) — frontend-agent implementasyon sırasında `lucide-react` tip tanımlarında (`node_modules/lucide-react/dist/lucide-react.d.ts`) hızlı bir `grep` ile teyit etmeli; yoksa sırasıyla `Sliders`/`CircleSlash`/`Paintbrush` gibi en yakın standart isimlere düşülür.

---

## 7. Kapsam dışı (tekrar, netlik için)

Bu doküman şunları TANIMLAMAZ (mimarın kararıdır, değiştirilmedi): veri şeması/alan adları, `MAX_*` sayısal sabitleri, `md` kırılma noktası, flexbox kararı, Tailwind sınıf/inline-style bölüşümü (§6.2 mimarın dokümanı), `chrome` prop'unun render motorundaki implementasyonu. Bu doküman yalnızca **editör UI'ının görsel/etkileşim katmanını** tanımlar; `container-settings-panel.tsx` ve `layout-picker.tsx`'in state/mantık kısmı (`onChange` imzaları, `containers.ts` ağaç işlemleri, `presets.ts`) **frontend-agent**'ın 2.2/2.3/2.4 görevidir.
