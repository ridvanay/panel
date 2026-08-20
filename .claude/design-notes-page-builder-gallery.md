# Tasarım Notları: Page-Builder "Galeri" Bloğu (WordPress-tarzı çoklu görsel)

Ajan: ui-designer
Kapsam: Sadece tasarım/UX kararları — component-seviyesi kesin spesifikasyon. Kod implementasyonu **frontend-agent**'a aittir (`GalleryBlockEditor`, `GalleryBlockView`, `types.ts`, `registry.ts` dahil).
Görsel yön: Bu proje **Minimal/Flat** çizgide (`bg-card`/`border-border`/düz yüzeyler, `MediaPicker` ve admin panelin tamamıyla birebir — bkz. `design-notes-media-picker.md` header'ı). Galeri bloğu da bu çizgiyi korur: **glassmorphism/glow YOK** — thumbnail üzerindeki ikon rozetleri bile şeffaf/`backdrop-blur` DEĞİL, OPAK yüzeyler kullanır (gerekçe: madde A.3'te).

---

## 0. Veri modeli (frontend-agent'ın `types.ts`'e ekleyeceği alan)

```ts
// frontend/src/lib/page-builder/types.ts
export type GalleryLayout = "grid" | "carousel" | "masonry";

export interface GalleryBlock extends BaseBlock {
  type: "gallery";
  data: {
    images: { url: string; alt: string }[]; // MEVCUT şekil DEĞİŞMEZ — geriye dönük uyumluluk
    layout: GalleryLayout; // YENİ alan
  };
}
```

- `images[].{url,alt}` şekli **aynen korunur** (kontrat kırılmaz, eski kayıtlı sayfalar bozulmaz).
- `layout` yoksa (eski kayıtlı bloklar) hem editör hem public render `?? "grid"` ile varsayılana düşer — ayrı bir migration GEREKMEZ (bu bir DB kolonu değil, sayfa içeriğinin JSON'unda yaşayan bir alan; `ColumnsBlock`'un eski `ratio` şeklini `resolveColumnWidth` ile geriye dönük okuduğu desenle AYNI mantık).
- `registry.ts`'teki `createBlock("gallery")` varsayılanı: `{ images: [], layout: "grid" }`.
- **dnd-kit sıralama id'si:** `useSortable` stabil bir `id` ister, `images[]`'in kendisinde `id` alanı YOK. **Persisted şekli değiştirmeyin** — `GalleryBlockEditor` içinde SADECE editör state'i için, her satıra `crypto.randomUUID()` ile atanan geçici bir yerel id tutulur (ör. `useState<string[]>` — index'e paralel, `images` her değiştiğinde eşlenir), `onChange` ile `block.data`'ya yazılırken bu id'ler STRIPLENIR. Bu, API kontratını/veri şeklini bozmadan sürüklenebilir listeyi mümkün kılan pragmatik çözümdür.

---

## A) Admin editör — `GalleryBlockEditor` yeniden tasarımı

### A.0 Genel iskelet

```
<div className="space-y-3">
  {images.length === 0
    ? <EmptyState .../>                         // madde A.1
    : <>
        <Toolbar />                              // madde A.2 (stil seçici + sayaç + ekle butonu)
        <ThumbnailGrid />                         // madde A.3-A.6 (sürüklenebilir grid)
      </>}
  <MediaPicker ... />                             // her zaman DOM'da, sadece açık/kapalı
</div>
```

Bu blok, `builder-canvas.tsx` içinde bir kart gövdesi olarak render edilir; genişliği **sabit değildir** — üst düzeyde tam satır genişliği kadar olabileceği gibi bir `ColumnsBlock` içinde %20 genişliğinde dar bir sütun da olabilir. Bu yüzden aşağıdaki tüm grid/flex kararları **breakpoint'e değil konteyner genişliğine** tepki verecek şekilde (`auto-fill`/`flex-wrap`) tasarlanmıştır — sabit `sm:`/`md:` breakpoint'leri panel dar bir sütundayken yanıltıcı olur.

### A.1 Boş durum

Mevcut `EmptyState` component'i **birebir** kullanılır:

```tsx
<EmptyState
  icon={Images}
  title="Henüz görsel eklenmedi"
  description="Galeriye eklemek için kütüphaneden görsel seçin veya yeni bir görsel yükleyin."
  action={
    <Button type="button" onClick={openPicker}>
      <Images className="h-4 w-4" />
      Görsel Ekle
    </Button>
  }
/>
```

- İkon: `Images` (çoğul/yığın ikonu) — `MediaPicker`'ın kendi iç boş durumunda kullandığı `ImageIcon` (tekil) ile **bilinçli olarak farklı**: burası "kütüphane boş" değil "bu galeriye henüz hiç görsel eklenmedi" anlamına geliyor.
- Bu durumda **stil seçici (Grid/Carousel/Masonry) gösterilmez** — 0 görselken düzen seçimi anlamsız, gereksiz bilişsel yük. İlk görsel eklenir eklenmez Toolbar belirir.

### A.2 Toolbar (görsel ≥ 1 iken)

```tsx
<div className="flex flex-wrap items-center justify-between gap-2">
  <GalleryLayoutControl value={layout} onChange={...} />   {/* sol */}
  <div className="flex items-center gap-2">                {/* sağ */}
    <span className={cn("text-xs tabular-nums", nearLimit ? "text-warning" : "text-foreground/60")}>
      {images.length} / {GALLERY_MAX_IMAGES}
    </span>
    <Button type="button" variant="secondary" size="sm" disabled={atLimit}
      title={atLimit ? "En fazla 30 görsel eklenebilir." : undefined} onClick={openPicker}>
      <Images className="h-3.5 w-3.5" />
      Görsel Ekle
    </Button>
  </div>
</div>
```

**Stil seçici — karar: icon-toggle-group, `Field`+`Select` DEĞİL.**

Projede iki emsal var:
- `Field`+`Select` (`email-editor/block-settings-panel.tsx`): metinsel, güçlü bir ikon karşılığı olmayan seçenekler için (ör. başlık boyutu H1-H6).
- Icon-toggle-group (`email-editor/style-controls.tsx` — `AlignControl`, `ButtonRadiusControl`, `DividerThicknessControl`, ve `builder-canvas.tsx`'teki dikey hizalama kontrolü): az sayıda (2-4), **güçlü görsel/ikon kimliği olan** blok-stili seçenekleri için.

Grid/Carousel/Masonry tam olarak ikinci kategori — üç seçenek, her biri net bir ikonla temsil edilebilir. Bu yüzden `style-controls.tsx`'teki **birebir aynı görsel dil** kullanılır:

```tsx
const GALLERY_LAYOUT_OPTIONS: { value: GalleryLayout; label: string; icon: LucideIcon; hint: string }[] = [
  { value: "grid",     label: "Izgara",     icon: LayoutGrid,       hint: "Eşit boyutlu sütun ızgarası" },
  { value: "carousel", label: "Kaydırmalı", icon: GalleryHorizontal, hint: "Yatay kayan slayt görünümü" },
  { value: "masonry",  label: "Masonry",    icon: LayoutDashboard,   hint: "Pinterest tarzı, farklı yükseklikte serbest düzen" },
];

<div className="inline-flex flex-wrap items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5">
  {GALLERY_LAYOUT_OPTIONS.map(({ value, label, icon: Icon, hint }) => (
    <Button
      key={value}
      type="button"
      size="sm"
      variant={layout === value ? "secondary" : "ghost"}
      aria-pressed={layout === value}
      title={hint}
      onClick={() => onChange(value)}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  ))}
</div>
```

Not: `AlignControl` gibi salt-ikon (`size="icon-xs"`) değil, **ikon + kısa metin** (`size="sm"`) kullanılır — hizalama okları evrensel olarak tanınan semboller iken "masonry" gibi bir kavram TEK BAŞINA ikonla yeterince açık olmayabilir; metin etiketi belirsizliği giderir. `title` (hint) her buton için ek açıklama sağlar. İkon adları (`LayoutGrid`, `GalleryHorizontal`, `LayoutDashboard`) `lucide-react@^1.28` sürümünde doğrulanmalı; birebir eşleşmezse en yakın kavramsal eşdeğer kullanılabilir — bu bir tasarım detay notudur, ikon SEÇİMİ (grid/carousel/masonry ayrımının ikonla anlatılması) zorunludur.

**Sayaç/limit uyarısı — karar:**

- `GALLERY_MAX_IMAGES = 30` (`types.ts`'e `MAX_BLOCKS_PER_COLUMN` gibi diğer sabitlerle aynı üslupta eklenir).
- `nearLimit = images.length >= GALLERY_MAX_IMAGES - 5` (son 5 slotta uyarı rengi, yani 25/30'dan itibaren).
- Renk kararı: **HER ZAMAN `warning` tonu, asla `danger`.** Gerekçe: `builder-canvas.tsx`'teki `COLUMN_READABILITY_WARNING_THRESHOLD` uyarısı ("çok fazla blok var") da aynı şekilde `bg-warning/10 text-warning` kullanıyor — proje idiomu, sert/engelleyici limitlerde bile `danger` DEĞİL `warning` kullanmak (danger, gerçek hata/başarısızlık durumları için ayrılmış — bkz. `Alert`/`Badge` tone tabloları).
- Limite ulaşıldığında (`images.length >= 30`): "Görsel Ekle" butonu `disabled`, `title="En fazla 30 görsel eklenebilir."`. Bu, engelleyici bir modal/toast DEĞİL — buton sessizce pasifleşir, sayaç `30 / 30` uyarı renginde kalır. Var olan görseller etkilenmez, kullanıcı silmeden ekleyemez.
- `MediaPicker` her açıldığında `maxSelection={Math.max(1, GALLERY_MAX_IMAGES - images.length)}` geçilir — böylece kullanıcı TEK bir seçim oturumunda kalan kapasiteden fazlasını seçemez (bu, `MediaPicker`'ın zaten sahip olduğu `disabledByLimit` davranışıyla ÜCRETSİZ elde edilir, yeni bir kısıtlama UI'ı gerekmez).
- Seçilen medyalar galeriye eklenirken `alt: media.altText ?? ""` ile önceden doldurulur (`Media.altText` zaten kütüphanede varsa) — bu, madde A.5'teki "alt metin eksik" uyarılarının önden azaltılmasını sağlar.

### A.3 Thumbnail grid — düzen ve responsive davranış

```tsx
<div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-3">
  {images.map((image, index) => <GalleryImageCard key={localIds[index]} ... />)}
</div>
```

- `repeat(auto-fill, minmax(88px, 1fr))`: sabit `sm:`/`md:` breakpoint'i YOK — konteyner (panel) genişliğine göre kendiliğinden sütun sayısı belirler. Çok dar bir `ColumnsBlock` sütununda (~180px) 2 sütun, tam genişlik bir panelde (~500-700px) 4-6 sütun sığar. Bu, görevde sorulan "mobil admin panelde nasıl daralacak" sorusunun cevabıdır: **breakpoint yerine intrinsic responsive davranış** — `blog-gallery--grid`'in public tarafta zaten kanıtlanmış `auto-fit/minmax` tekniğinin editör tarafındaki eşdeğeri (aynı "hayalet boş hücre" bug'ından kaçınma mantığı).
- `gap-3` (12px) — thumbnail'lerin üzerindeki hover ikon rozetleri için biraz daha nefes payı, `MediaPicker`'ın `gap-3`'ü ile tutarlı.

### A.4 Tek bir thumbnail kartı (`GalleryImageCard`)

```tsx
<div ref={setNodeRef} style={style} className={cn("group space-y-1", isDragging && "opacity-50")}>
  <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={image.url} alt="" loading="lazy" className="h-full w-full object-cover" />

    {/* sürükleme tutamacı — sol üst */}
    <button
      type="button"
      {...attributes} {...listeners}
      aria-label={`Sürükle: Görsel ${index + 1}`}
      className={cn(
        "absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-md border border-border/60",
        "bg-background text-foreground/60 shadow-sm cursor-grab active:cursor-grabbing",
        "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
      )}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>

    {/* kaldır — sağ üst */}
    <button
      type="button"
      aria-label={`Görseli kaldır: Görsel ${index + 1}`}
      onClick={onRemove}
      className={cn(
        "absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border/60",
        "bg-background text-foreground/60 shadow-sm transition-opacity",
        "hover:border-danger/40 hover:bg-danger/10 hover:text-danger",
        "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
      )}
    >
      <X className="h-3.5 w-3.5" />
    </button>

    {/* alt metin eksik rozeti — sol alt, HER ZAMAN görünür (hover'a bağlı DEĞİL) */}
    {!image.alt.trim() && (
      <span
        className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-warning text-warning-foreground shadow-sm"
        title="Alt metin eksik"
      >
        <AlertTriangle className="h-3 w-3" />
      </span>
    )}
  </div>

  <Input
    aria-label={`Görsel ${index + 1} alt metni`}
    className="h-7 text-xs"
    placeholder="Alt metin…"
    value={image.alt}
    onChange={(e) => onAltChange(e.target.value)}
  />
</div>
```

Kararların gerekçeleri:

- **Sürükleme kapsamı:** `ref`/`style`/`isDragging` DIŞ konteynerde (görsel + alt input birlikte tek birim olarak taşınır — `contact/field-editor-row.tsx` ile aynı desen); `{...attributes} {...listeners}` SADECE tutamaç butonunda (tüm karta değil — yanlışlıkla alt-input'a tıklarken sürüklemeyi tetiklememek için).
- **Opak rozetler, şeffaflık YOK:** Tutamaç ve kaldır butonları `bg-background` (düz/opak), `bg-background/80 backdrop-blur` GİBİ yarı saydam bir "cam" efekti KULLANILMAZ. Gerekçe iki yönlü: (1) görsel yön kararı Flat'i zorunlu kılıyor — bu küçük dekoratif değil, fonksiyonel bir kontrol chip'i, glow/blur estetiği projeye hiç girmemeli; (2) rastgele kullanıcı fotoğrafları her renkte olabilir, opak yüzey + `shadow-sm` her arka planda garanti okunabilirlik sağlar, yarı saydam olsaydı açık renkli bir fotoğraf üzerinde ikon kaybolabilirdi.
- **A11y — sadece hover'a bağımlı DEĞİL:** Butonlar HER ZAMAN DOM'da ve tab-sırasındadır (`display:none`/`visibility:hidden` KULLANILMAZ) — `opacity-0` yalnızca GÖRSEL gizler. `group-focus-within:opacity-100` + butonun kendi `focus-visible:opacity-100`'ü sayesinde Tab ile gezen klavye kullanıcısı odaklandığında buton görünür hâle gelir. Dokunmatik cihazlarda gerçek `:hover` durumu güvenilir tetiklenmediği için `max-sm:opacity-100` ile **640px altında butonlar her zaman görünür** bırakılır (mobilde "önce dokun sonra gör" sürtünmesi olmasın diye).
- **Alt-eksik rozeti hover'a bağlı DEĞİL, her zaman görünür** — çünkü bu bir AKSİYON değil, bir DURUM göstergesidir (o anda hover edilmiyor olsa da editör kullanıcısının hangi görsellerde eksik olduğunu bir bakışta taraması gerekir). Renk: `bg-warning text-warning-foreground` — `Badge`'in `solid` warning tonuyla BİREBİR aynı token kombinasyonu (`badge.tsx`: `warning: { solid: "bg-warning text-warning-foreground" } }`).
- **Alt input kompakt:** `h-7 text-xs` — standart `Input` (`h-8`) yerine bir tık daha küçük, çünkü bu satır başına 88-140px genişliğinde bir hücrede yaşıyor; `contact/field-editor-row.tsx`'teki seçenek satırlarının `h-8` küçük input deseniyle aynı ölçek ailesinde ama grid yoğunluğu için bir kademe daha kompakt. `aria-label` kullanılır (görünür `<label>` YOK — grid yoğunluğu için), WCAG 3.3.2 için yeterli (görünür etiket olmasa da programatik etiket mevcut — `gallery-block.tsx`'in eski `sr-only label` desenine kıyasla `aria-label` burada daha az DOM gürültüsü verir, işlevsel olarak eşdeğerdir).
- Alt-input'un kendisi validasyon rengi (kırmızı/`aria-invalid`) ALMAZ — eksik alt metin bir hata değil, bir öneridir; sinyal SADECE görsel üzerindeki rozetle verilir (çifte sinyal/gürültü istenmiyor).

### A.5 Sürükle-bırak altyapısı

- `@dnd-kit/sortable` zaten proje bağımlılığı (yeni paket YOK). Grid düzeni için `verticalListSortingStrategy` DEĞİL, **`rectSortingStrategy`** kullanılır (dnd-kit'in çok-sütunlu/grid diziler için önerdiği strateji — `contact` sayfasındaki dikey liste tek-sütun olduğu için `verticalListSortingStrategy` kullanıyordu, burası farklı).
- Collision detection: `closestCenter` (dnd-kit'in rect-sortable grid'ler için standart önerisi).
- Sürükleme geri bildirimi: SADECE `isDragging ? "opacity-50" : ""` (madde A.4) — `contact/field-editor-row.tsx` ile birebir aynı, ayrı bir `DragOverlay` portalı GEREKMEZ (küçük kare thumbnail'ler için opacity yeterli, `builder-canvas.tsx`'in üst-düzey blok sürüklemesindeki `DragOverlay` karmaşıklığı burada gereksiz).
- Klavye ile sıralama: `KeyboardSensor` + `sortableKeyboardCoordinates` (proje genelinde zaten kullanılan sensor kurulumu, `builder-canvas.tsx`'teki `DndContext` sensor tanımıyla aynı).

### A.6 Toolbar/Grid örnek genişlik senaryosu (mobil admin panel)

- ≤ ~200px konteyner (dar sütun): Toolbar `flex-wrap` ile stil seçici üstte, sayaç+buton altta iki satıra düşer; grid 2 sütuna düşer.
- ~350-500px (tipik mobil admin ekranı, tam genişlik blok): Toolbar tek satırda sığar, grid 3-4 sütun.
- ≥ 600px (masaüstü panel): grid 5-6 sütun.

Bu geçişler **elle breakpoint yazılmadan** `flex-wrap` + `auto-fill/minmax` ile kendiliğinden oluşur — frontend-agent ekstra medya sorgusu eklemek ZORUNDA DEĞİLDİR.

---

## B) Public site render — 3 stil varyantı

Ortak kurallar (üçü için de geçerli):
- `images.length === 0` ise bileşen `null` döner (boş bir grid/flex konteyner DOM'a hiç girmez — mevcut kodda bu koruma YOK, eklenmeli).
- Her `<img>` **`loading="lazy"`** taşır (mevcut davranış korunur).
- `layout = block.data.layout ?? "grid"` (eski kayıtlar için geriye dönük varsayılan).
- Bu bileşen düz TSX (JSX) render'ıdır, `dangerouslySetInnerHTML` DEĞİLDİR (blog galerisinin aksine) — yani Tailwind'in JIT taraması class'ları normal şekilde görür; `globals.css`'e YENİ hiçbir hand-written CSS kuralı EKLENMESİ GEREKMEZ, tamamı Tailwind utility sınıflarıyla (gerekirse arbitrary value ile) ifade edilir. `.blog-gallery*` sınıfları KONTRAT PARÇASI olduğu için (sanitizer allow-list'e bağlı) bu bloğa DOKUNULMAZ/yeniden kullanılmaz — page-builder galerisi kendi bağımsız Tailwind sınıflarını kullanır, sadece SAYISAL değerler (140/180/160px, 8px gap, `rounded-lg`) blog galerisiyle **görsel tutarlılık için** bilinçli olarak birebir aynı seçildi.

### B.1 Grid (varsayılan)

```tsx
{images.length > 0 && layout === "grid" && (
  <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2 px-4 py-8 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] sm:px-6 md:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
    {images.map((image, i) => (
      <figure key={i} className="aspect-square overflow-hidden rounded-lg border border-border/50 bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt={image.alt} loading="lazy" className="h-full w-full object-cover" />
      </figure>
    ))}
  </div>
)}
```

- `auto-fit/minmax(140px→180px→160px, 1fr)` breakpoint değerleri **`blog-gallery--grid` ile birebir aynı sayılar** (140/base, 180/sm≥640px, 160/md≥768px) — sayfa içeriği de tipik olarak aynı `max-w-3xl` konteynerde yaşadığından (`[slug]/page.tsx`), site genelinde blog ve sayfa galerileri **piksel-tutarlı** görünür.
- Eskisinden fark: sabit `grid-cols-2 md:grid-cols-3` (görsel sayısından bağımsız sabit N sütun, "hayalet" boş hücre riski) yerine `auto-fit` — track sayısı gerçek görsel sayısını AŞMAZ.
- **Yeni:** `rounded-lg border border-border/50 bg-muted` eklendi (eskiden yoktu, çıplak `<img>`) — hem yükleme sırasında flaş/boşluk için nötr bir zemin hem de `MediaPicker`/thumbnail estetiğiyle tutarlı hafif bir çerçeve.
- Tek görsel durumu: `auto-fit` ile TEK item tüm satır genişliğini (1fr) doldurur — `aspect-square` oranı korunduğu için görsel BOZULMAZ, sadece büyük bir kare olarak görünür (WordPress'in de yaptığı, kabul edilebilir davranış — "bozulma" değil, beklenen sonuç).

### B.2 Carousel

**Karar: CSS-only (native `scroll-snap`), yeni npm bağımlılığı EKLENMEZ.**

Değerlendirme (görev gereği ikisi de tartıldı):
- *embla-carousel-react* (veya keen-slider) sonsuz döngü/otomatik oynatma/sürükleme-inertia gibi ekstra cila sağlar, ama: (1) projede bugün **hiçbir carousel kütüphanesi yok** (`package.json`'da yok), (2) proje genelinde `overflow-x-auto` tabanlı native scroll zaten kullanılan bir desen (`locale-tabs.tsx`, `content-list-tabs.tsx`), (3) görev bu bileşen için sonsuz döngü/otomatik oynatma İSTEMİYOR — sadece yatay kaydırma + ok butonları. Bu kapsam için native `scroll-snap` teknik olarak YETERLİ ve daha az bağımlılık riski taşıyor (bundle boyutu, bakım yükü, blog galerisinin "carousel bilinçli olarak reddedildi" kararındaki gerekçeyle aynı ihtiyat).
- **Sonuç: CSS-only.** Eğer ileride sonsuz döngü/otomatik oynatma gibi native scroll'un karşılayamayacağı bir istek gelirse, embla-carousel-react (~5kb, bağımlılıksız, headless) o zaman değerlendirilebilir — bu spesifikasyonun kapsamı DIŞINDA, frontend-agent/architect'in ileride vereceği ayrı bir karar.

```tsx
{images.length > 0 && layout === "carousel" && (
  <div className="relative px-4 py-8 sm:px-6">
    <div
      role="region"
      aria-label="Galeri, kaydırmalı görünüm"
      tabIndex={0}
      className="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {images.map((image, i) => (
        <figure
          key={i}
          className="aspect-[4/3] w-[78%] shrink-0 snap-center overflow-hidden rounded-lg border border-border/50 bg-muted sm:w-[46%] md:w-[31%]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt={image.alt} loading="lazy" className="h-full w-full object-cover" />
        </figure>
      ))}
    </div>

    {images.length > 1 && (
      <>
        <button
          type="button"
          aria-label="Önceki görsel"
          onClick={() => scrollByOneItem(-1)}
          className="absolute left-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-foreground/70 shadow-md hover:bg-background hover:text-foreground sm:flex"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Sonraki görsel"
          onClick={() => scrollByOneItem(1)}
          className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-foreground/70 shadow-md hover:bg-background hover:text-foreground sm:flex"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </>
    )}
  </div>
)}
```

- **Genişlikler** (`w-[78%] sm:w-[46%] md:w-[31%]`): mobilde bir sonraki karenin küçük bir dilimi kasıtlı olarak görünür bırakılır (78% = tam %100 değil) — "burada daha fazla içerik var" ipucu, klasik mobil carousel affordance'ı. `sm`'de ~2, `md`'de ~3 kart görünür.
- **Ok butonları SADECE `sm:` ve üzerinde** (`hidden ... sm:flex`) — mobilde birincil etkileşim swipe/scroll'dur, parmakla kaydırma alanının üzerine buton koymak gürültü yaratır; masaüstü/tablette ise fare/trackpad kullanıcıları için ok butonları standart beklentidir. İkonlar: `ChevronLeft`/`ChevronRight` (lucide-react).
- Buton yüzeyi burada **`bg-background/90`** (hafif yarı saydam) kullanılıyor — bu madde A.4'teki "şeffaflık yok" kararıyla ÇELİŞMİYOR: orada küçük bir fotoğraf thumbnail'i üzerindeki mikro-kontrol chip'i söz konusuydu (okunabilirlik riski yüksek), burada büyük, sabit boyutlu, sayfanın kendi arka planına (`bg-background` sayfa zemini) oturan bir navigasyon butonu — `/90` sadece altındaki galeri kenarının hafif sızmasına izin veren kozmetik bir detay, glow/blur estetiği DEĞİL. Tercih edilirse frontend-agent tamamen opak (`bg-background`) da kullanabilir, ikisi de bu spesifikasyonla uyumludur.
- `images.length > 1` koşulu: **tek görselde ok butonları hiç render edilmez** — "boş/tek görsel durumunda bozulmamalı" gereksinimine karşılık gelir.
- `role="region"` + `tabIndex={0}`: fare/dokunmatik olmayan kullanıcılar için — odaklanan bir `overflow-x-auto` konteyner çoğu tarayıcıda ok tuşlarıyla native kaydırılabilir, bu asgari bir klavye erişilebilirlik ağıdır.
- `scrollByOneItem(dir)` fonksiyonunun implementasyonu (ref + `scrollBy({ left: dir * container.clientWidth * 0.8, behavior: "smooth" })` gibi) frontend-agent'ın iş mantığı kararıdır, bu spesifikasyon sadece görsel/etkileşim SONUCUNU tanımlar.

### B.3 Masonry

**Karar: CSS multi-column (`columns-*`), CSS Grid `grid-template-rows: masonry` DEĞİL** (tarayıcı desteği hâlâ sadece Firefox'ta deneysel — pratik değil).

```tsx
{images.length > 0 && layout === "masonry" && (
  <div className="columns-2 gap-2 px-4 py-8 [column-fill:balance] sm:columns-3 sm:px-6">
    {images.map((image, i) => (
      <figure key={i} className="mb-2 break-inside-avoid overflow-hidden rounded-lg border border-border/50 bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt={image.alt} loading="lazy" className="block h-auto w-full" />
      </figure>
    ))}
  </div>
)}
```

Kritik farklar (grid varyantından bilinçli sapmalar, gözden kaçırılmamalı):

- **`aspect-square`/`object-cover` KULLANILMAZ.** Masonry'nin bütün amacı her görselin KENDİ doğal en-boy oranını koruyup farklı yüksekliklerde bir "Pinterest" dokusu yaratmaktır — `object-cover`/`aspect-square` bunu grid'e dönüştürüp masonry'yi anlamsızlaştırır. Bunun yerine `h-auto w-full` (intrinsic yükseklik).
- **`gap-2` sütunlar ARASI boşluğu verir, satır arası boşluğu VERMEZ** (CSS multi-column'ın doğası) — bu yüzden her `<figure>`'a `mb-2` (8px, `gap-2` ile aynı birim) elle eklenir, aksi halde sütun içinde üst üste yığılan görseller birbirine yapışır. Bu, CSS columns'ın bilinen bir tuzağıdır, frontend-agent'ın gözden kaçırmaması için özellikle not edildi.
- `break-inside-avoid`: bir görselin sütun sonu/başı sınırında ikiye "kesilmesini" engeller.
- Sütun sayısı: `columns-2` (mobil) → `sm:columns-3` (≥640px), `md`/`lg` için AYRICA artırılmıyor — konteyner `max-w-3xl` (768px) ile sınırlı olduğundan 3 sütun üzeri (~240px/sütun altına düşer) Pinterest hissi yerine sıkışık/okunaksız bir doku üretir.
- "Hayalet hücre" riski YOK: CSS Grid'in aksine multi-column layout'ta sabit "track" kavramı olmadığından, az sayıda (ör. 1) görselle bile tıklanabilir boş bir alan oluşmaz — tek görsel sadece 1. sütunu doldurur, 2. sütun sessizce boş kalır, DOM'da fazladan bir kutu YOKTUR.

---

## C) `registry.ts` / palet önizlemesi (varsa)

Eğer blok paletinde (`blockRegistry`) galeri için bir ikon/önizleme tanımlıysa, DEĞİŞTİRİLMEZ — bu spesifikasyon sadece editör içi/public render kapsamındadır.

---

## Frontend-agent için kontrol listesi (özet)

1. `types.ts`: `GalleryLayout` tipi + `GalleryBlock.data.layout` alanı eklenir; `registry.ts`'te varsayılan `{ images: [], layout: "grid" }`.
2. `GalleryBlockEditor`: `EmptyState` → Toolbar (`GalleryLayoutControl` + sayaç + "Görsel Ekle") → `rectSortingStrategy` ile sürüklenebilir thumbnail grid (madde A).
3. `GalleryLayoutControl`: 3 seçenekli icon-toggle-group (`LayoutGrid`/`GalleryHorizontal`/`LayoutDashboard`), `style-controls.tsx` görsel dili.
4. `GalleryImageCard`: opak hover/focus-visible rozetleri (sürükle + kaldır), her zaman görünür alt-eksik rozeti (`bg-warning text-warning-foreground`), kompakt `h-7 text-xs` alt input.
5. `MediaPicker` `multiple` modda, `maxSelection = 30 - mevcut sayı`, seçilen medyaların `altText`'i galeriye ön-doldurulur.
6. `GalleryBlockView`: `layout` alanına göre 3 ayrı render dalı (madde B.1/B.2/B.3), `images.length === 0` ise `null`, tümünde `loading="lazy"`.
7. Yeni npm bağımlılığı YOK (carousel CSS-only `scroll-snap`, masonry CSS-only `columns`).
8. `GALLERY_MAX_IMAGES = 30` sabiti `types.ts`'te tanımlanır, uyarı tonu HER ZAMAN `warning` (asla `danger`).
