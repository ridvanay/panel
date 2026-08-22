# Tasarım Notları: Editör Araçları — Cihaz Önizleme, Şekilli Ayırıcılar, Giriş Animasyonları

> **Not:** Bu dosyanın devamı niteliğinde `.claude/design-notes-page-builder-editing-tools-v2.md` eklendi — kontrol çubuğu taşma/kompaktlık düzeltmesi, iç içe (nested) konteyner ekleme ve Giriş Animasyonu panelinin genişletilmesi (8 efekt + slider + süre + tekrar) orada tanımlanır. Bu dosyanın içeriği DEĞİŞMEDİ, yalnızca bu referans notu eklendi.

Ajan: **ui-designer** · Durum: **v1 (spesifikasyon, implementasyon bekliyor)** · Sahibi: ui-designer
Kapsam: (1) Cihaz Önizleme Çubuğu, (2) Şekilli Bölüm Ayırıcıları (`container-settings-panel.tsx`), (3) Giriş Animasyonları (Scroll Reveal) — konteyner + 23 içerik bloğu ortak kontrolü. Bu doküman kod İÇERMEZ; `frontend-agent` bunu okuyup `builder-canvas.tsx` ve `container-settings-panel.tsx`'i buna göre kodlar.

Bağlayıcı kaynaklar (bu dokümanın referans aldığı, ÜZERİNDE değiştirmediği): `.claude/design-notes-page-builder-containers.md` (veri modeli/sabit isimlendirme kuralları — `MAX_*`, `DEFAULT_CONTAINER_MAX_WIDTH` gibi), `.claude/design-notes-page-builder-container-ui.md` (`SettingsSection`, `SegmentedToggle`, `MinHeightField` nullable-alan deseni, derinlik/seçili-durum görsel dili). Bu dokümanda tanımlanan **veri alanı adları** (`revealEffect`, `topDivider` vb.) birer **öneridir** — nihai şema kararı architect'e aittir (bkz. §7); ui-designer yalnızca **görünüm/etkileşim** katmanını bağlar.

---

## 0. Görsel yön (değişmiyor)

Proje **Minimal/Flat** idiomunu sürdürüyor (bkz. önceki iki design-notes dosyasının §0'ı). Bu üç özellik için de:

- Yeni renk tokenı **eklenmez** — yalnızca `primary`, `warning`, `border`, `surface-muted`, `foreground/N`.
- Blur/glow/gradient dekоratif efekti **kullanılmaz** (gradient/animasyonlu arka plan ayarları zaten §Arka Plan bölümünde veri olarak var — bu, UI'ın kendi kabuğunun stiline karışmaz).
- Tüm ikonlar `lucide-react`; bu oturumda `frontend/node_modules/lucide-react/dist/lucide-react.d.ts` içinde tek tek doğrulandı (§8'de liste).
- Yeni bir kontrol primitifi İCAT EDİLMEZ: `Button`, `Select`, `Switch`, `Badge`, `InputGroup`, `Field`, `Popover` (mevcut, `components/ui/popover.tsx`, base-ui — `page-builder/blocks/icon-picker.tsx`'te zaten kullanılıyor), `SegmentedToggle` (mevcut **paylaşılan** yerel modül, bkz. §1.2).

---

## 1. Cihaz Önizleme Çubuğu (Device Preview Bar)

### 1.1 Konum ve state sahipliği

`BuilderCanvas`'ın kendi içinde yeni bir `device` state'i: `const [device, setDevice] = useState<DeviceMode>("desktop")` — `DeviceMode = "desktop" | "tablet" | "mobile"`. Bu state **sayfa/parent bileşene yükseltilmez** (page.tsx'in prop yükünü artırmaz); yalnızca canvas'ın kendi görsel simülasyonunu etkiler, kayıtlı veriyi (`nodes`) değiştirmez.

`DevicePreviewBar` ve `device` state'i, `builder-canvas.tsx` içinde **yerel** bir alt bileşen olarak tanımlanır — dosyanın zaten `BareChromeHint`, `ContentBlockCard`, `ContainerCard` gibi birden fazla yerel alt bileşen barındırdığı kanıtlanmış desenle tutarlı (ayrı bir dosya AÇILMASI gerekmez, bu küçüklükte bir kontrol için gereksiz dosya bölünmesi olur).

Yerleşim: `BuilderCanvas`'ın döndürdüğü fragment'ın **en üstünde**, `<DndContext>`'in **dışında ama üstünde bir kardeş** olarak:

```tsx
return (
  <>
    <DevicePreviewBar device={device} onChange={setDevice} />
    <DndContext ...>
      <div className={canvasWidthClass(device)}>
        {/* mevcut boş-durum / SortableContext içeriği DEĞİŞMEDEN buraya taşınır */}
      </div>
      <DragOverlay>...</DragOverlay>
    </DndContext>
    <ConfirmDialog ... />
  </>
);
```

`DndContext`'in **kendisi** sarmalanmaz (dnd-kit koordinat hesaplamaları etkilenmemeli) — yalnızca **içindeki** kart listesi/boş-durum bir genişlik-kısıtlı `div`e alınır. `DragOverlay` genişlik kısıtına girmez (sürüklenen kart her zaman gerçek boyutunda görünür, bu bilinçli — önizleme genişliği yalnızca yerleşik/statik kartları etkiler).

### 1.2 Buton grubu deseni — KESİN KARAR: mevcut paylaşılan `SegmentedToggle` import edilir

Projede **iki** `SegmentedToggle` var: (a) `container-settings-panel.tsx` içinde **yerel/export edilmeyen** kopya, (b) `frontend/src/components/admin/page-builder/blocks/segmented-toggle.tsx` — bu **açıkça page-builder-içi paylaşım için** yazılmış, dosyanın kendi yorumu bunu söylüyor ("page-builder İÇİ (cross-feature DEĞİL) paylaşım") ve hâlihazırda 8 farklı blok editöründe import ediliyor.

**KESİN KARAR:** Device Preview Bar, `blocks/segmented-toggle.tsx`'teki **mevcut paylaşılan** `SegmentedToggle`'ı import eder. Yeni bir yerel kopya **yazılmaz** — bu, (a)'daki (container-settings-panel'in kendi kopyası, `Button size="xs"`, ikon zorunlu) değil, (b)'deki (ikon opsiyonel, zaten `builder-canvas.tsx`'in kardeşi bir klasörde) versiyondur. İki dosya arasındaki fark yalnızca ikonun opsiyonel olması; Device Preview Bar'da ikon her zaman verileceği için görsel sonuç `container-settings-panel.tsx`'teki ile **birebir aynı** görünür.

### 1.3 İkonlar ve etiketler

Doğrulanmış `lucide-react` ikonları: `Monitor`, `Tablet`, `Smartphone`.

```tsx
<SegmentedToggle
  value={device}
  options={[
    { value: "desktop", label: "Masaüstü", icon: Monitor },
    { value: "tablet", label: "Tablet", icon: Tablet },
    { value: "mobile", label: "Mobil", icon: Smartphone },
  ]}
  onChange={onChange}
/>
```

### 1.4 Yerleşim — bar'ın kendi kabuğu

Bar, **ekstra bir dış kutu/kart içine ALINMAZ** (iki iç içe `border`+`bg-surface-muted` kutusu — `SegmentedToggle`'ın kendi kabuğu + bir dış çerçeve — aynı flat dilde gereksiz katmanlanma olur). Yalnızca ortalanmış bir flex satırı:

```tsx
function DevicePreviewBar({ device, onChange }: { device: DeviceMode; onChange: (d: DeviceMode) => void }) {
  return (
    <div className="mb-4 flex items-center justify-center gap-2">
      <SegmentedToggle value={device} options={DEVICE_OPTIONS} onChange={onChange} />
      {device !== "desktop" && (
        <Badge tone="neutral" size="sm">{device === "tablet" ? "768px" : "375px"}</Badge>
      )}
    </div>
  );
}
```

`mb-4` — mevcut `space-y-4` kart aralığıyla aynı ölçek (4px taban × 4 = 16px), yeni bir spacing değeri İCAT EDİLMEZ.

### 1.5 Aktif mod rozeti/vurgusu

Rozet **yalnızca `tablet`/`mobile`'da görünür** (`desktop` akışkan/fluid genişliktir, sabit bir px değeri yoktur — "Tam Genişlik" gibi anlamsız bir metin eklemek yerine hiç göstermemek daha temiz). `Badge tone="neutral" size="sm"` (mevcut `components/ui/badge.tsx`), aktif genişliği gösterir: `"768px"` / `"375px"`. Aktif SEGMENT'in kendisi zaten `SegmentedToggle`'ın `variant={active ? "secondary" : "ghost"}` mantığıyla vurgulanıyor (§1.2), ek bir vurgu katmanı gerekmez.

### 1.6 Tuval genişlik geçişi

**KESİN KARAR: sade `max-width` + `mx-auto`, cihaz kenarlığı/gölge simülasyonu YOK.** Gerekçe: (a) proje zaten kanıtlanmış bir "yapısal sınır = `border-dashed`" dili taşıyor (konteynerler, boş bırakma alanları) — gerçekçi bir telefon/tablet çerçevesi (köşe yuvarlama + notch + gölge) tamamen farklı, dekoratif-figüratif bir görsel dil açar ve §0'daki "Minimal/Flat, yeni görsel dil yok" kuralını ihlal eder; (b) MVP kapsamında değer üretmeyen bir detay (kullanıcı gerçek cihaz gösterimini değil, **genişlik davranışını** kontrol etmek istiyor); (c) `EmptyColumnDropZone`/konteyner kartlarının kendi `border-dashed` dili, ekstra bir "cihaz çerçevesi" ile karışırsa hangisinin yapısal (konteyner sınırı) hangisinin simülasyon (viewport sınırı) olduğu belirsizleşir.

```tsx
function canvasWidthClass(device: DeviceMode) {
  return cn(
    "mx-auto w-full transition-all duration-300",
    device === "tablet" && "max-w-[768px] border-x border-dashed border-border/40 px-2",
    device === "mobile" && "max-w-[375px] border-x border-dashed border-border/40 px-2"
  );
}
```

- `desktop`: ek sınıf yok (`max-w-none` davranışı, mevcut tam genişlik korunur).
- `tablet`/`mobile`: `border-x border-dashed border-border/40` — mevcut konteyner/boş-alan `border-dashed` diliyle **aynı aile**, yalnızca viewport sınırını ima eden ince bir ipucu (kalın bir çerçeve/gölge DEĞİL). `px-2` — sınırın içeriğe yapışmaması için minimal iç boşluk.
- `transition-all duration-300` — genişlik değişimi (`max-width`) ve kenarlık belirmesi/kaybolması tek geçişte animasyonlanır; `300ms` proje genelinde zaten kullanılan standart geçiş süresi (bkz. `hover:` durumları `transition-colors` varsayılanı `150ms`'den daha belirgin, büyük bir layout değişimi için `300ms` daha okunaklı — yeni bir süre değeri İCAT EDİLMEDİ, Tailwind'in `duration-300` sabit ölçeğinden seçildi).

---

## 2. Şekilli Bölüm Ayırıcıları (Shape Dividers)

### 2.1 Panel yerleşimi — tek yeni `SettingsSection`, iki alt-grup (sekme DEĞİL)

**KESİN KARAR:** Üst/Alt ayırıcı **iki ayrı `SettingsSection` DEĞİL**, tek bir `SettingsSection title="Ayırıcılar"` içinde **iki alt-grup** olarak yaşar — tıpkı §2.3'teki Padding/Margin ikilisinin "Boşluk" bölümü içinde `border-t border-border/40 pt-3` ile ayrılmasıyla **birebir aynı desen** (yeni bir iskelet İCAT EDİLMEZ, kanıtlanmış olan tekrar kullanılır). Sekme (`Tabs`) **kullanılmaz**: panel zaten dikey akan bir liste, bir sekme bileşeni yeni bir etkileşim primitifi ekler ve `container-settings-panel.tsx`'in "her ayar aynı anda taranabilir olsun" ilkesini bozar (kullanıcı üst ve alt ayırıcıyı **karşılaştırarak** ayarlamak isteyebilir — sekme bunu engeller).

Bu 4. `SettingsSection`, mevcut sıranın **sonuna** eklenir: **Düzen → Boşluk → Arka Plan → Ayırıcılar.** (Ayırıcılar mantıksal olarak Arka Plan'ın bir uzantısıdır — ikisi de konteynerin "kabuğu"nu tanımlar — bu yüzden ondan hemen sonra gelir.)

```tsx
<SettingsSection title="Ayırıcılar">
  <ShapeDividerField label="Üst Ayırıcı" value={settings.topDivider} onChange={(topDivider) => onChange({ topDivider })} />
  <div className="border-t border-border/40 pt-3">
    <ShapeDividerField label="Alt Ayırıcı" value={settings.bottomDivider} onChange={(bottomDivider) => onChange({ bottomDivider })} />
  </div>
</SettingsSection>
```

### 2.2 Kapalıyken (`undefined`) — `MinHeightField` deseniyle BİREBİR aynı "Ekle" butonu

**KESİN KARAR:** Nullable alan deseni §2.2.3/`MinHeightField`'dan **birebir** taşınır (yeni bir "kapalı durum" görseli İCAT EDİLMEZ):

```tsx
if (!value) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => onChange(DEFAULT_SHAPE_DIVIDER)}>
      <Plus className="h-3.5 w-3.5" />
      {label} ekle
    </Button>
  );
}
```

Bu, panelin varsayılan (hiçbir konteynerde ayırıcı yokken) uzunluğunu **iki tek-satırlık butona** indirger — §"panel zaten uzun" endişesine doğrudan cevap budur: maliyet yalnızca kullanıcı fiilen bir ayırıcı **eklediğinde** ortaya çıkar.

### 2.3 Açık durum — şablon seçimi: 4 seçenekli mini-SVG önizlemeli karo grid'i (SegmentedToggle DEĞİL)

**KESİN KARAR: `LayoutPresetTile` (§1.2, `design-notes-page-builder-container-ui.md`) ile AYNI prensip** — gerçek lucide ikonu değil, **şeklin kendisini** çizen küçük bir SVG önizlemesi. Gerekçe, o dokümandaki gerekçenin birebir aynısı: lucide setinde "dalga", "eğim", "eğri" gibi somut geometrik şekilleri temsil eden **hiçbir standart ikon yok** (uydurma bir eşleştirme — örn. `Waves` ikonunu "dalga ayırıcı" için kullanmak — kullanıcıyı yanıltır, çünkü gerçek ayırıcı şekli ikondan görsel olarak farklı olacaktır). `SegmentedToggle` (salt metin/ikon) burada **yetersizdir**; kullanıcı 4 şekli **görerek** ayırt edebilmeli.

`ShapeDividerTile` bileşeni, `LayoutPresetTile` ile birebir aynı buton kabuğu, içinde farklı bir SVG:

```tsx
<button type="button" aria-label={label} title={label}
  className="flex flex-col items-center gap-1.5 rounded-lg border border-border/60
             bg-surface-muted p-2 transition-colors hover:border-primary/50
             hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-3
             focus-visible:ring-ring/50 outline-none data-[active=true]:border-primary
             data-[active=true]:bg-primary/10"
  data-active={active}
  aria-pressed={active}
  onClick={...}>
  <svg viewBox="0 0 24 12" className="h-6 w-10 text-foreground/60" fill="none" stroke="currentColor" strokeWidth="1.5">
    {SHAPE_PATH[type]}
  </svg>
  <span className="text-[11px] font-medium text-foreground/70">{label}</span>
</button>
```

Izgara: `grid grid-cols-4 gap-1.5` (4 öğe → tek satır, `LayoutPresetTile`'ın `gap-2`sinden biraz daha sıkı — bu panel zaten dar bir sağ sütunda, 4 karo tek satıra rahat sığar).

4 şablonun mini-SVG yolu (`viewBox="0 0 24 12"`, tutarlı bir tuval — gerçek render motorundaki tam-genişlik SVG'nin sadeleştirilmiş önizlemesi, **birebir aynı path olmak zorunda değil**, yalnızca şekli tanınır kılmalı):

| id | Etiket | Mini-SVG (`<path>` içeriği) |
|---|---|---|
| `wave` | Dalga | `<path d="M0 6 Q 6 0 12 6 T 24 6" />` |
| `slant` | Eğimli Çizgi | `<path d="M0 12 L24 0" />` (tek düz diyagonal çizgi, dolgu değil — ayırıcının kendisi bu çizginin ALTINDA/ÜSTÜNDE kalan alanı doldurur, mini önizlik yalnızca çizgiyi gösterir) |
| `triangle` | Üçgen | `<path d="M0 12 L12 0 L24 12" />` |
| `curve` | Eğri | `<path d="M0 12 Q12 -2 24 12" />` |

`fill="none" stroke="currentColor"` — mini önizlemede **dolgu YOK**, yalnızca çizgi; gerçek render motorundaki ayırıcı `background.value`/seçili renkle **dolu** bir şekil olacak, ama karo seçicide dolgu rengi henüz seçilmemiş olabileceğinden (renk seçimi bu karonun ALTINDA ayrı bir adım) mini önizlemede sabit `text-foreground/60` çizgi kullanmak, karonun her zaman okunur kalmasını sağlar (kullanıcı beyaza yakın bir renk seçse bile karo görünmez hale gelmez).

Aktif/seçili şablon **vurgulanır** (`data-[active=true]:border-primary data-[active=true]:bg-primary/10`) — bu, §1.2'deki `LayoutPresetTile`'dan **farkı**: orada karo bir "ekle" eylemiydi (durumsuz), burada karo **mevcut bir alanın tipini değiştiren bir seçim** olduğu için `aria-pressed`/aktif durum göstermesi doğru (mevcut `SegmentedToggle`/`IconToggleGroup`'un `aria-pressed` diliyle tutarlı).

### 2.4 Renk — `ColorField`, varsayılan `#ffffff`

Mevcut `ColorField` (`components/admin/appearance/color-field.tsx`) **birebir aynı şekilde** kullanılır — konteyner arka plan rengiyle aynı bileşen, ek bir `maxLength` genişletmesine gerek yok (ayırıcı rengi alfa kanalı taşımaz, düz `#rrggbb`).

**Varsayılan: `#ffffff`.** Gerekçe: `container-block.tsx`'te (§`backgroundStyle`) bir konteynerin **kendi** arka planı `background.type: "none"` iken tamamen **saydamdır** — yani ayırıcının "hangi rengin üstüne oturacağı" render motorunda hesaplanamaz (komşu/kardeş bloğun rengi bilinmiyor). Bu belirsizlik karşısında endüstri standardı (Elementor/Divi gibi karşılaştırılabilir page builder'ların hepsi) **beyaz**tır — kullanıcı büyük ihtimalle ayırıcıyı bir bölümün üstüne koyacak ve o bölüm en yaygın olarak açık/beyaz zeminlidir; kullanıcı zaten `ColorField` ile tek tıkla değiştirebilir. Bu, projenin kendi emsaliyle de tutarlı: `background.type: "color"` varsayılanı `#111827` (koyu), gradient varsayılanları `#4f46e5`/`#0ea5e9` — yani "somut bir hex literal, boş bırakma" ilkesi zaten var, burada da aynı ilke uygulanır.

### 2.5 Yükseklik — mevcut range slider deseni (`container-width` ile birebir), yeni sabitler

**KESİN KARAR:** §2.2.2'deki (`customWidth` slider) **birebir aynı** desen — `InputGroup`+buton DEĞİL, native `<input type="range">` + etiket içinde canlı değer:

```tsx
<div className="space-y-1.5">
  <label htmlFor="divider-height" className="block text-sm font-medium text-foreground">
    Yükseklik ({value.height}px)
  </label>
  <input
    type="range"
    id="divider-height"
    min={MIN_DIVIDER_HEIGHT}
    max={MAX_DIVIDER_HEIGHT}
    step={5}
    value={value.height}
    onChange={(e) => onChange({ ...value, height: Number(e.target.value) })}
    className="w-full accent-primary"
  />
  <p className="text-xs text-foreground/60">Varsayılan: {DEFAULT_DIVIDER_HEIGHT}px. {MIN_DIVIDER_HEIGHT}–{MAX_DIVIDER_HEIGHT}px arası.</p>
</div>
```

Yeni sabitler, mevcut `DEFAULT_CONTAINER_MAX_WIDTH`/`MIN_CONTAINER_MAX_WIDTH`/`MAX_CONTAINER_MAX_WIDTH` isimlendirme kalıbıyla **birebir tutarlı**:

```ts
export const MIN_DIVIDER_HEIGHT = 0;
export const MAX_DIVIDER_HEIGHT = 300;
export const DEFAULT_DIVIDER_HEIGHT = 100;
```

`step={5}` — 0-300 arası 60 adım (§2.2.2'deki `step={10}`/160 adımdan daha ince, çünkü ayırıcı yüksekliği görsel olarak daha küçük bir aralıkta hassasiyet ister — 5px'lik atlamalar 300px tavanda hâlâ akıcı hissettirir, `step={10}` burada gereğinden kaba kalırdı).

### 2.6 Ters çevirme (flip) — `Switch`, mevcut `OverlayControl` deseniyle aynı

Yeni bir toggle bileşeni İCAT EDİLMEZ — `container-settings-panel.tsx::OverlayControl`'deki `Switch` kullanım deseni (§"Kaplama (overlay)") **birebir** taşınır:

```tsx
<div className="flex items-center justify-between">
  <label htmlFor="divider-flip" className="text-sm font-medium text-foreground">Ters çevir</label>
  <Switch id="divider-flip" checked={value.flip} onCheckedChange={(flip) => onChange({ ...value, flip })} />
</div>
```

`FlipVertical2` ikonu (doğrulandı, §8) **isteğe bağlı** olarak etiketin yanına eklenebilir (`Layers` ikonunun `OverlayControl` başlığındaki kullanımıyla aynı desen) — zorunlu değil, `Switch`'in kendisi zaten yeterince açık.

### 2.7 Kaldır butonu

Açık durumun üstünde, `MinHeightField`'ın "X ile temizle" ikon-butonu **birebir aynı** konumda: karoların/renk/yükseklik/flip alanlarının **üstünde**, `label` (`"Üst Ayırıcı"`/`"Alt Ayırıcı"`) ile aynı satırda sağda:

```tsx
<div className="flex items-center justify-between">
  <label className="text-sm font-medium text-foreground">{label}</label>
  <Button type="button" variant="ghost" size="icon-xs" aria-label={`${label} kaldır`} onClick={() => onChange(undefined)}>
    <X className="h-3.5 w-3.5" />
  </Button>
</div>
```

### 2.8 Veri şekli — öneri (mimarın onayı gerekir)

Bu doküman veri şemasına karar VEREMEZ (§ CLAUDE.md, ui-designer sınırı) — yalnızca UI'ın oturacağı **önerilen** şekli not eder, frontend-agent/architect nihai kararı verir:

```ts
export type ShapeDividerType = "wave" | "slant" | "triangle" | "curve";
export interface ShapeDividerSettings {
  type: ShapeDividerType;
  color: string;   // hex, ColorField ile aynı doğrulama
  height: number;  // px, MIN/MAX_DIVIDER_HEIGHT
  flip: boolean;
}
// ContainerSettings'e eklenir:
// topDivider?: ShapeDividerSettings;
// bottomDivider?: ShapeDividerSettings;
```

---

## 3. Giriş Animasyonları (Scroll Reveal)

### 3.1 Konum — paylaşılan tek kontrol, kart başlığında `Sparkles` ikonlu popover tetikleyici

23 ayrı blok editörüne (`blocks/*.tsx`) tek tek animasyon UI'ı eklemek **YAPILMAZ** — görev tanımının önerdiği gibi, kontrol `builder-canvas.tsx::ContentBlockCard` ve `::ContainerCard` seviyesinde **paylaşılan** tek bir küçük bileşen olarak yaşar (`RevealEffectControl`), her iki kart tipinin **başlık şeridinde** aynı yerde görünür.

**Somut yerleşim:** her iki kartın sağ üst buton grubunda, **mevcut ilk buton olarak** eklenir (diğer aksiyon butonlarının SOLUNDA — `Settings2`/`ArrowUp` gibi "yapısal" aksiyonlardan önce, çünkü görünüm efekti bir "sunum" ayarıdır, yapısal bir aksiyon değildir, görsel olarak ayrı gruplanmalı):

- `ContentBlockCard`: sağ buton grubunun **en başına**, `isBare` `ArrowUpToLine`'dan önce.
- `ContainerCard`: sağ buton grubunda **`Settings2`'den hemen sonra** (ikisi de "ayar açan" butonlar, yan yana durmaları mantıklı; `LayoutMenu`/`Copy`/hareket butonlarından önce).

```tsx
<Popover>
  <PopoverTrigger
    render={
      <Button
        type="button"
        variant={hasEffect ? "secondary" : "ghost"}
        size="icon-sm"
        aria-label="Görünüm Efekti"
        title="Görünüm Efekti"
      />
    }
  >
    <Sparkles className="h-4 w-4" />
  </PopoverTrigger>
  <PopoverContent className="w-64 space-y-3">
    {/* §3.2 / §3.3 */}
  </PopoverContent>
</Popover>
```

`Sparkles` (doğrulandı, §8) — tek `lucide-react` kaynağı ilkesine uygun, "efekt/animasyon" için en tanınır standart ikon. `variant={hasEffect ? "secondary" : "ghost"}` — efekt seçiliyken buton **basılı görünümde** kalır (diğer aktif-durum butonlarıyla aynı görsel dil, örn. `SegmentedToggle`'ın aktif segmenti), efektsizken sessiz `ghost`.

`Popover` bileşeni (`components/ui/popover.tsx`, base-ui) **mevcut** ve zaten `page-builder/blocks/icon-picker.tsx`'te aynı `PopoverTrigger render={<Button .../>}` deseniyle kullanılıyor — yeni bir primitif İCAT EDİLMEDİ, aynı feature klasöründeki kanıtlanmış kullanım tekrarlanıyor.

### 3.2 Efekt seçimi UI deseni — `Select` dropdown (SegmentedToggle DEĞİL)

**KESİN KARAR:** 5 seçenek (`Yok` + 4 efekt) için `Select` (mevcut `components/ui/select.tsx`, native `<select>`) kullanılır, `SegmentedToggle` **kullanılmaz**. Gerekçe: `SegmentedToggle` şu ana kadar projede en fazla 6 seçenekte (`justifyContent`) kullanıldı ama o **ikon-only** kompakt bir grid'di (`icon-xs`, tek harf genişliğinde butonlar); burada her seçeneğin **uzun Türkçe metni** var ("Yukarı Belirme (Fade Up)" gibi) — metin etiketli bir `SegmentedToggle` 5 seçenekte popover'ın `w-64` genişliğini kolayca aşar ve satır kırar, dar bir popover içinde okunaksız olur. `Select` tek satırda, popover genişliğine sığan, zaten `bg-position`/`bg-size`/`bg-repeat` alanlarında kanıtlanmış bir desen.

```tsx
<Field id="reveal-effect" label="Görünüm Efekti">
  {(p) => (
    <Select {...p} value={effect} onChange={(e) => onChange({ effect: e.target.value as RevealEffect })}>
      <option value="none">Yok</option>
      <option value="fade-in">Belirme (Fade In)</option>
      <option value="fade-up">Yukarı Belirme (Fade Up)</option>
      <option value="slide-left">Soldan Kayma (Slide In Left)</option>
      <option value="zoom-in">Yakınlaşma (Zoom In)</option>
    </Select>
  )}
</Field>
```

### 3.3 Gecikme seçimi UI deseni — `SegmentedToggle` (Select DEĞİL), yalnızca `effect !== "none"` iken görünür

**KESİN KARAR:** Gecikme, `Select` değil `SegmentedToggle` (`blocks/segmented-toggle.tsx`, §1.2'de olduğu gibi paylaşılan modül) ile seçilir — burada tam ters gerekçe geçerli: 5 değer **kısa** (`"100"`…`"500"`, 3 karakter), tek satıra rahat sığar, ve gecikme bir "sıralı/karşılaştırmalı" değer olduğu için (kullanıcı "300 mü 400 mü daha uzun" sorusuna görsel olarak tek bakışta cevap bulmalı) yan yana butonlar bir `Select`'in tek seferde tek değer gösteren açılır listesinden **daha hızlı taranır**.

```tsx
{effect !== "none" && (
  <div className="space-y-1.5">
    <p className="text-xs font-medium text-foreground/70">Gecikme</p>
    <SegmentedToggle
      value={delayMs}
      options={[100, 200, 300, 400, 500].map((ms) => ({ value: ms, label: String(ms) }))}
      onChange={(delayMs) => onChange({ delayMs })}
    />
  </div>
)}
```

Etiketlerde `"ms"` **tekrarlanmaz** (her butonda `"100ms"` yazmak yer israfı) — üstteki bölüm başlığı `"Gecikme"` zaten birimi ima eder; gerekirse `title="100 milisaniye"` tooltip'i eklenebilir (zorunlu değil).

### 3.4 Kartta görsel gösterge — `Badge`, yalnızca `effect !== "none"` iken

Efekt seçiliyken (popover kapalıyken bile), kartın başlık şeridinde **kalıcı bir gösterge** kalır — kullanıcı popover'ı her açmadan hangi bloğun animasyonlu olduğunu görebilmeli. Yerleşim: kart başlığının **sol** tarafında, blok etiketinin (`ContentBlockCard`'da `blockRegistry[block.type].label`, `ContainerCard`'da `headerLabel`) **hemen yanında** — mevcut `Badge` (Seviye N) ve `BareChromeHint` ile aynı satırda, `IsBare` göstergesinden **önce**:

```tsx
{hasEffect && (
  <Badge tone="primary" size="sm">
    {REVEAL_SHORT_LABEL[effect]} · {delayMs}ms
  </Badge>
)}
```

`tone="primary"` (`bg-primary/10 text-primary`) — bilinçli seçim: mevcut `Badge tone="neutral"` zaten "Seviye N" için kullanılıyor, `tone="warning"` okunabilirlik uyarısı için ayrılmış; `primary` üçüncü, boşta duran ton, bu göstergeyi diğer ikisinden **ayırt edilebilir** kılar (aynı zamanda "bu, sistemin bir özelliği/eklenmiş bir davranış" hissi verir, `primary` projede zaten "eklenmiş/aktif" anlamında kullanılıyor — `SegmentedToggle`'ın aktif segmenti, seçili konteyner ring'i).

Kısa rozet etiketleri (popover'daki uzun `Select` etiketlerinden **farklı**, kart üstünde yer kazanmak için):

```ts
const REVEAL_SHORT_LABEL: Record<Exclude<RevealEffect, "none">, string> = {
  "fade-in": "Belirme",
  "fade-up": "Yukarı Belirme",
  "slide-left": "Soldan Kayma",
  "zoom-in": "Yakınlaşma",
};
```

Örnek çıktı: **"Yukarı Belirme · 200ms"**.

### 3.5 Türkçe etiketler — tek kaynak tablo

| Anahtar | Popover `Select` etiketi (uzun) | Rozet etiketi (kısa) |
|---|---|---|
| `none` | Yok | — (rozet gösterilmez) |
| `fade-in` | Belirme (Fade In) | Belirme |
| `fade-up` | Yukarı Belirme (Fade Up) | Yukarı Belirme |
| `slide-left` | Soldan Kayma (Slide In Left) | Soldan Kayma |
| `zoom-in` | Yakınlaşma (Zoom In) | Yakınlaşma |

Gecikme bölüm başlığı: **"Gecikme"**. Popover tetikleyici `aria-label`/`title`: **"Görünüm Efekti"**.

### 3.6 Veri şekli — öneri (mimarın onayı gerekir)

```ts
export type RevealEffect = "none" | "fade-in" | "fade-up" | "slide-left" | "zoom-in";
export type RevealDelay = 100 | 200 | 300 | 400 | 500;
export interface RevealEffectSettings {
  effect: RevealEffect;
  delayMs: RevealDelay;
}
```

**Öneri (mimar onayı şart):** bu alan hem `ContainerSettings`'e hem her `ContentBlock`'un `data`'sına ayrı ayrı eklenmek yerine, `PageNode`'un ortak atası `BaseNode`'a (`interface BaseNode { id: string }`) **`reveal?: RevealEffectSettings`** olarak eklenirse, 23 blok tipinin `data` şemalarının **hiçbiri değişmeden** hem konteynerler hem içerik blokları bu alanı otomatik kazanır — tam olarak görev tanımının istediği "23 ayrı dosyaya dokunmadan paylaşılan kontrol" sonucu budur. Bu, veri modeli kararı olduğu için **architect onayına tabidir**; ui-designer yalnızca UI'ın bu şekle ihtiyaç duyduğunu **not eder**, şemayı bağlamaz.

---

## 4. Bileşen/dosya eşleme tablosu (frontend-agent için hızlı referans)

| UI parçası | Mevcut primitif | Yeni yerel bileşen (isim önerisi) | Hedef dosya |
|---|---|---|---|
| Cihaz seçim butonları | `SegmentedToggle` (paylaşılan, `blocks/segmented-toggle.tsx` — YENİDEN KOPYALANMAZ) | `DevicePreviewBar` | `builder-canvas.tsx` (yerel) |
| Tuval genişlik kısıtı | `cn()` + Tailwind `max-w-[…]` | `canvasWidthClass()` | `builder-canvas.tsx` |
| Ayırıcı şablon seçimi | — (yeni, `LayoutPresetTile` prensibiyle) | `ShapeDividerTile` | `container-settings-panel.tsx` |
| Ayırıcı renk | `ColorField` (mevcut) | — | `components/admin/appearance/color-field.tsx` |
| Ayırıcı yükseklik | native `<input type="range">` (§2.2.2 deseni) | — | `container-settings-panel.tsx` |
| Ayırıcı flip | `Switch` (mevcut, `OverlayControl` deseni) | — | `container-settings-panel.tsx` |
| Ayırıcı nullable kabuk | `Button`+`Plus`/`X` (`MinHeightField` deseni) | `ShapeDividerField` | `container-settings-panel.tsx` |
| Görünüm Efekti tetikleyici | `Popover`/`PopoverTrigger`/`PopoverContent` (mevcut, `icon-picker.tsx` deseni), `Sparkles` ikonlu `Button` | `RevealEffectControl` | `builder-canvas.tsx` (yerel, hem `ContentBlockCard` hem `ContainerCard` içinde kullanılır) |
| Efekt seçimi | `Select` + `Field` (mevcut) | — | `builder-canvas.tsx` |
| Gecikme seçimi | `SegmentedToggle` (paylaşılan) | — | `builder-canvas.tsx` |
| Efekt rozeti | `Badge tone="primary"` (mevcut) | — | `builder-canvas.tsx` |

---

## 5. Doğrulanmış `lucide-react` ikon adları (bu oturumda `lucide-react.d.ts` içinde tek tek doğrulandı)

`Monitor`, `Tablet`, `Smartphone`, `Sparkles`, `FlipVertical2`, `Plus` (mevcut kullanımdan zaten doğrulanmış), `X` (mevcut kullanımdan zaten doğrulanmış), `Waves`, `Triangle`, `Spline` (bu ikinci ikisi **kullanılmıyor** — §2.3 kararı gereği mini-SVG tercih edildi, yalnızca alternatif olarak burada not edilir).

---

## 6. Kapsan dışı (tekrar, netlik için)

Bu doküman şunları TANIMLAMAZ: `ShapeDividerSettings`/`RevealEffectSettings`'in **nihai** şeması ve zod doğrulaması (backend-agent + architect), render motorunun (`container-block.tsx`, `block-renderer`/`index.tsx`) tam-genişlik SVG path'lerinin gerçek implementasyonu (frontend-agent — bu doküman yalnızca **admin editör picker'ının** mini önizlemesini bağlar), scroll-reveal'ın gerçek IntersectionObserver/CSS animasyon implementasyonu (frontend-agent, `globals.css`'e yeni keyframe'ler ekleyebilir — bu doküman yalnızca **ayar UI'ını** tanımlar, animasyonun kendisinin CSS'ini değil), `DeviceMode`'un canvas dışında (örn. public site preview linki) kullanılıp kullanılmayacağı (kapsam dışı, yalnızca editör içi simülasyon).
