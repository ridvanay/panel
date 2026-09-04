# Tasarım Notu — Ürün Katalogu (`/products` filtreleme/sıralama + `/products/[slug]` PDP)

**Kapsam:** `.claude/architect-scope-products-catalog.md` §5.3 — filtre kenar çubuğu, üst
toolbar, ürün kartı (ızgara + liste), profesyonel PDP. Kod YAZMIYORUM — frontend-agent bu
dosyayı okuyup uygular. Bu doküman **[DNS]**'i (`.claude/design-notes-ecommerce-storefront.md`)
**GENİŞLETİR, hiçbir kararını değiştirmez** — DNS §1/§2 (swatch/beden), §3 (indirim rozeti/
`right-2 top-2` çakışma kuralı), §4 (düşük stok), §7 (sticky sepete ekle barı), §8 (PDF kartı)
buradan sonra da BİREBİR bağlayıcıdır; bu doküman bunlara referans verir, yeniden tanımlamaz.
Aşağıdan sonra bu doküman **[DNS-katalog]** olarak anılır.

**Görsel yön:** DEĞİŞMİYOR — Minimal/Flat (bkz. DNS giriş notu). Yeni "buzlu cam" yüzeyi
İCAT EDİLMEZ; mevcut istisna (yüzen kontrollerde `backdrop-blur-sm`) bu dokümanda yalnızca
mobil filtre alt sayfasının (bottom sheet) `SheetOverlay`'inde zaten var olan
`supports-backdrop-filter:backdrop-blur-xs` ile aynı ölçüde kullanılır — sistemik bir
"cam" estetiği DEĞİL.

**Token kaynağı (SAPMA YOK):** DNS'teki aynı `.site-scope` bloğu
(`--site-primary/…/--site-radius`) ve kök `--danger/--warning/--success` (WCAG AA
doğrulanmış, `globals.css:16-45`). **Yeni renk İCAT EDİLMEZ** — bu dokümandaki her ton
kararı mevcut 5 semantik token'dan (`primary`/`success`/`danger`/`warning`/`neutral`,
paylaşılan `Badge` bileşeninin tonları) birini yeniden kullanır. `--site-radius` override
kuralı ([DNS] giriş notu) bu dokümandaki TÜM yeni interaktif yüzeylerde (`rounded-[var(--site-radius)]`)
zorunludur; swatch gibi dairesel istisnalar (madde 1.4) DNS §1'in kendi gerekçesini miras alır.

**Bileşen kaynağı (SAPMA YOK):** Yeni birincil bileşen İCAT EDİLMEZ. Bu doküman şu mevcut
`components/ui/*` primitiflerini (hepsi `@base-ui/react/*` üzerine ince sarmalayıcı, admin ve
storefront'ta zaten ortak) yeniden kullanır: `Badge`, `Button`, `Input`, `InputGroup`/
`InputGroupAddon`/`InputGroupInput`/`InputGroupButton`, `Select`, `Sheet`/`SheetContent`,
`Accordion`/`AccordionItem`/`AccordionTrigger`/`AccordionPanel`, `Checkbox`, `Switch`,
`Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `Tooltip`, `EmptyState`. **TEK yeni primitif**
gerekiyor: `components/ui/slider.tsx` (madde 1.3) — `@base-ui/react/slider` zaten proje
bağımlılığı (`node_modules/@base-ui/react/slider`, `sliders` modülünün bir başka
özelliği için kurulu), yeni bir kütüphane EKLENMEZ, yalnızca `Switch`/`Checkbox` ile AYNI
"primitife ince sarmalayıcı" deseninde bir dosya açılır.

---

## 0. Sayfa iskeleti (üst düzey yerleşim)

```
/products
┌─────────────────────────────────────────────────────────────────┐
│ PageHeader (mevcut, DEĞİŞMEDEN)                                  │
├──────────────┬──────────────────────────────────────────────────┤
│ CatalogSidebar│ CatalogToolbar (arama · sonuç sayısı · sırala ·   │
│ (lg:w-64,     │ ızgara3/ızgara4/liste · mobilde "Filtrele" btn)  │
│ lg:sticky     ├──────────────────────────────────────────────────┤
│ lg:top-24)    │ ActiveFilterChips (yalnızca aktif filtre varsa)   │
│               ├──────────────────────────────────────────────────┤
│ (lg:hidden altında│ Ürün ızgarası/listesi                        │
│  Sheet içinde)│ CatalogPagination                                 │
└──────────────┴──────────────────────────────────────────────────┘
```

`CatalogSidebar` **TEK bir bileşendir** — hem masaüstü `<aside>` içinde hem mobil `Sheet`
içinde AYNI içerik render edilir (madde 1.7). İki ayrı "mobil filtre" bileşeni YAZILMAZ.

---

## 1. Sol Sidebar Filtre Paneli

### 1.1 Kapsayıcı ve bölüm çerçevesi

Masaüstü: `<aside className="hidden lg:block lg:w-64 lg:shrink-0 lg:sticky lg:top-24 lg:self-start">`
— `top-24` galeri ile AYNI sticky ofseti (madde 4.2) kullanır, sayfada iki farklı sticky
ofset değeri OLMAZ.

Her filtre grubu (Kategori, Fiyat Aralığı, her varyasyon ekseni) mevcut `Accordion` ailesiyle
render edilir — `AccordionItem` zaten `rounded-lg border border-border/60` taşıyor, YENİ bir
kart çerçevesi İCAT EDİLMEZ:

```
<Accordion type="multiple" defaultValue={["category","price", ...tümEksenler]}>
  <AccordionItem value="category">
    <AccordionTrigger>Kategori</AccordionTrigger>
    <AccordionPanel>…</AccordionPanel>
  </AccordionItem>
  …
</Accordion>
```

**Varsayılan açık/kapalı:** TÜM gruplar varsayılan AÇIK (`defaultValue` tüm `value`'ları
içerir) — bir katalog kenar çubuğunda kullanıcı ilk bakışta neyin filtrelenebilir olduğunu
görmeli; kapanma yalnızca kullanıcı tercihidir, ilk yüklemede içerik gizlenmez. "Stok Durumu"
(madde 1.5) accordion DIŞINDA, panelin en üstünde sabit bir satırdır (tek `Switch`, açılır-
kapanır bir grup gerektirmeyecek kadar basit).

**Panel başlığı:** `<AccordionTrigger>` içeriği `flex w-full items-center justify-between`
— sol: grup adı, sağ (varsa) toplam seçili sayısı `text-xs text-foreground/60 tabular-nums`
(ör. "Renk (2)") — `ChevronDown` zaten `AccordionTrigger`'ın kendi ikonu, tekrar EDİLMEZ.

**Sidebar üst başlığı:** `<div className="mb-4 flex items-center justify-between">` içinde
sol `h2` "Filtrele" (`text-sm font-semibold text-foreground`), sağ — yalnızca en az bir
filtre aktifken — "Filtreleri Temizle" bağlantısı (madde 1.6, AYNI bileşen chip satırıyla
paylaşılır).

### 1.2 Kategori filtresi (hiyerarşik, 2 seviye, ürün sayısı)

`category-filter-tree.tsx` — **tekli seçim** (backend `category` parametresi tek slug alır,
DNS'teki swatch/beden'in ÇOKLU seçiminden FARKLI semantik — burada `role="radio"`/basit link
listesi, checkbox DEĞİL).

```
<ul className="space-y-0.5 text-sm">
  <li>
    <Link href="?…category kaldırılmış…" className={cn(
      "flex items-center justify-between rounded-md px-2 py-1.5 transition-colors",
      !selectedCategory ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-surface-muted"
    )}>Tümü</Link>
  </li>
  {rootCategories.map(root => (
    <li key={root.id}>
      <div className="flex items-center">
        {root.children.length > 0 && (
          <button aria-label={expanded ? "Alt kategorileri gizle" : "Alt kategorileri göster"}
                  className="grid h-6 w-6 shrink-0 place-items-center text-foreground/40 hover:text-foreground">
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
        )}
        <Link href="…" className={cn(
          "flex flex-1 items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
          root.children.length === 0 && "ml-6", // ok yoksa girinti hizası korunur
          selected ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-surface-muted"
        )}>
          <span className="truncate">{root.title}</span>
          <span className="ml-2 shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/60 tabular-nums">
            {root.count}
          </span>
        </Link>
      </div>
      {expanded && root.children.length > 0 && (
        <ul className="ml-3 space-y-0.5 border-l border-border/60 pl-3">
          {root.children.map(child => (/* AYNI satır deseni, saymaç aynı */))}
        </ul>
      )}
    </li>
  ))}
</ul>
```

- Sayaç rozeti **`Badge` bileşeni DEĞİL** (Badge şu an `className` almıyor, kompakt bir liste
  içinde `px-2.5 py-0.5 text-xs` çok büyük kalır) — Badge'in `neutral`/`soft` renk çiftiyle
  (`bg-surface-muted`/`text-foreground/60`, DNS'in `text-foreground/60` — AA doğrulanmış,
  bkz. §5) AYNI renk, yalnızca boyutu küçültülmüş (`text-[11px] px-1.5`) inline bir span.
  **Not (frontend-agent'a):** `Badge`'e opsiyonel `className` eklenip bu span'in ORADAN
  türetilmesi tercih edilir (tek renk kaynağı) — zorunlu değil, ama Badge'in tonlarıyla
  SAPMA olmaması gerekir.
- Kök kategori sayacı **kendi + tüm çocukları** (backend facet zaten bu şekilde toplar,
  §3.4 architect kararı) — ayrı bir istemci-taraflı toplama YAPILMAZ.
- 2. seviyeden derin çocuk YOK (architect §2.1 tavanı) — ok/girinti yalnızca 1 kademe.
- Seçili kategori: `bg-primary/10 text-primary font-medium` — PDP'deki beden butonu "seçili"
  tonuyla (`border-primary bg-primary/5 text-primary`) AYNI aile, farklı bir vurgu rengi
  İCAT EDİLMEDİ.

### 1.3 Fiyat aralığı — slider + manuel giriş

**Yeni primitif (madde giriş notu):** `components/ui/slider.tsx`, `@base-ui/react/slider`
üzerine `Switch`/`Checkbox` ile AYNI sarmalama deseninde:

```
<SliderPrimitive.Root className="relative flex w-full items-center py-2">
  <SliderPrimitive.Control className="relative flex w-full items-center">
    <SliderPrimitive.Track className="h-2 w-full rounded-full bg-muted">
      {/* Track/fill DNS §5 ücretsiz kargo çubuğuyla AYNI `h-2 rounded-full bg-muted` — iki
          farklı "ray" görseli İCAT EDİLMEDİ. */}
      <SliderPrimitive.Indicator className="h-full rounded-full bg-[var(--site-primary)]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-primary bg-surface shadow-sm outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50 data-dragging:scale-110" />
    <SliderPrimitive.Thumb className="…AYNI sınıf, ikinci tutamak…" />
  </SliderPrimitive.Control>
</SliderPrimitive.Root>
```

- İki tutamaklı (min/max) tek `Slider`, `Track`/`Indicator` DNS §5'in `h-2 rounded-full
  bg-muted` ray'iyle BİREBİR aynı — yeni bir "ray" tonu İCAT EDİLMEDİ.
- Tutamak: `h-4 w-4` (16px, 4px ölçeğinin katı), `border-2 border-primary bg-surface` —
  PDP renk swatch'ının "seçili" halkasıyla AYNI `--primary` kaynağını kullanır ama swatch'la
  KARIŞTIRILMAZ (bu bir sürükleme tutamağı, bir varyasyon seçici DEĞİL).
  `focus-visible:ring-3 focus-visible:ring-ring/50` — `Input`/`Checkbox` ile AYNI odak
  halkası token'ı (proje genelinde TEK bir odak halkası dili).
- **Manuel giriş kutuları** (`mt-3 flex items-center gap-2`): iki `Input type="number"
  inputMode="numeric"` (`Min`/`Max` etiketli, `aria-label="Minimum fiyat"`/`"Maksimum
  fiyat"`), aralarında `text-foreground/40` bir `—` ayracı. Slider ile YATAYDA hizalı
  (aynı `w-full` kapsayıcı, `gap-2` = 8px).
- **Commit zamanlaması (bağlayıcı, URL spam'i önler):** slider `onValueCommitted`
  (sürükleme BIRAKILDIĞINDA, her piksel hareketinde DEĞİL) URL'i günceller; manuel giriş
  kutuları `onBlur`/`Enter` tuşunda commit eder (her tuş vuruşunda DEĞİL) — architect §5.4
  madde 3'teki 300ms arama debounce'ından FARKLI bir mekanizma, çünkü fiyat aralığı ara
  değerleri (`"1"`, `"15"`) geçerli bir filtre DEĞİLDİR, debounce ile bile gereksiz istekler
  üretir.
- Slider min/max sınırları backend facet'inden gelir (`ProductCatalogFacets.price.min/max`,
  architect §3.4 madde 2) — sabit `0-10000` gibi bir aralık İCAT EDİLMEZ.

### 1.4 Varyasyon filtreleri — 24px çoklu-seçim swatch + kompakt beden çipi

**Renk swatch (çoklu seçim, `role="checkbox"`):** DNS §1'in **kompakt (`w-6 h-6`, 24px)**
boyutu — DNS zaten bu boyutu "sepet çekmecesi satır özeti" için tanımlamıştı, burada AYNI
24px ölçek, farklı bir bağlamda (filtre) yeniden kullanılır. Görsel duruma (pasif/hover/
stoksuz-teknik) **DOKUNULMAZ** — DNS §1'deki `-45deg` `bg-danger` çizgi tekniği, 2 katmanlı
nötrleştirme, `ring-2 ring-offset-2 ring-offset-surface ring-primary` seçili hâli BİREBİR
aynen uygulanır. **Tek fark semantik:** PDP'de `role="radio"` (tekli seçim, bir eksende bir
değer), kenar çubuğunda `role="checkbox"` + `aria-checked` (bir eksende BİRDEN FAZLA değer
seçilebilir — architect §3.3 "eksen içi OR" kuralının arayüz karşılığı). Grup kapsayıcı
`role="group" aria-label="{eksen adı} filtresi"` (radiogroup DEĞİL, checkbox grubu).

- **Facet sayacı `0` olan değer:** DNS'in "stoksuz" görsel tekniğiyle AYNI (diagonal çizgi +
  `cursor-not-allowed`) ama anlamı FARKLI ("bu filtreyle seçilirse 0 sonuç" — disjunctive
  facet, architect §3.4). Aynı teknik iki farklı anlam için kullanılır (üründe stok yok / bu
  kombinasyonda sonuç yok) — bu bilinçli bir tutarlılık kararıdır, kullanıcı için "bu seçenek
  şu an seçilemez" görsel dili her iki bağlamda da aynı kalır.
- **Değer adı + sayaç:** 24px'te sığmayan sayaç bilgisi mevcut `Tooltip` bileşeniyle
  gösterilir (`Tooltip` içeriği `"{Değer} · {count} ürün"`) — hover'da görünür, ekran
  okuyucu için zaten `aria-label="{Değer} — {count} ürün ({stoktaysa boş, değilse '0 sonuç'})"`.
- Grup içi boşluk `gap-2` (8px) — DNS §1'in swatch boşluğuyla AYNI.

**Beden/ölçü çipi (çoklu seçim, kompakt):** DNS §2'nin dikdörtgen beden butonuyla AYNI görsel
dil (`rounded-[var(--site-radius)]`, seçili `border-2 border-primary bg-primary/5 text-primary
font-semibold`, stoksuz `-45deg` çizgi tekniği) ama **kenar çubuğuna özgü kompakt yükseklik:**
`h-8 min-w-8 px-2.5 text-xs` (PDP'nin `h-10 min-w-10` "birincil satın alma yüzeyi" boyutundan
BİLİNÇLİ olarak küçük — burada filtre yenileme/rafine etme ikincil bir eylemdir, WCAG 2.5.5
AAA hedefi PDP'ye özel bir tercihti; `h-8`=32px yine de WCAG 2.5.8 AA (≥24px) eşiğinin
üzerindedir). **Çoklu seçim farkı görünür kılınır:** seçili çipte metnin ÖNÜNE `Check`
(lucide, `h-3 w-3`) ikonu eklenir — PDP'deki tekli-seçim (radio) beden butonunda bu ikon
YOKTUR; bu, aynı renk paletini kullanan iki bileşenin "tek seçim" / "çoklu seçim" ayrımını
yalnızca renkle DEĞİL (WCAG 1.4.1) bir ikonla da işaretler.

```
role="checkbox" aria-checked={selected} aria-label={`${value}${available ? "" : " — 0 sonuç"}`}
className={cn(
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-[var(--site-radius)] px-2.5 text-xs transition-colors duration-150",
  available ? (selected
    ? "border-2 border-primary bg-primary/5 font-semibold text-primary"
    : "border border-border bg-surface text-foreground hover:border-foreground/40 hover:bg-muted")
    : "cursor-not-allowed border border-border/60 text-foreground/30"
)}
```

### 1.5 Stok durumu

Accordion DIŞINDA, sidebar'ın en üstünde (Kategori grubunun üstünde), mevcut `Switch`
bileşeni:

```
<div className="flex items-center justify-between py-2">
  <span className="text-sm text-foreground">Sadece stoktakiler</span>
  <Switch checked={inStock} onCheckedChange={…} />
</div>
```

`Switch`'in kendi token'ları (`data-checked:bg-primary`) DEĞİŞTİRİLMEZ.

### 1.6 Seçili filtre çipleri (Active Filter Chips)

**Konum:** sidebar'da DEĞİL — ana içerik kolonunda, toolbar'ın hemen altında, ızgaranın
üstünde (bkz. madde 0 iskelet). Gerekçe: sidebar zaten kendi içinde seçili durumu gösteriyor
(accordion içi vurgu); chip satırı kullanıcının "şu an aktif olan TÜM filtreleri tek bakışta"
görmesi ve HIZLI kaldırması için ayrı bir yatay şerittir — ızgaranın hemen üstünde olduğu
için sonuçlarla görsel bağlantı daha güçlüdür.

```
<div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-4">
  {chips.map(chip => (
    <span key={chip.key} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-3 pr-1.5 text-xs font-medium text-primary">
      {chip.label}
      <button type="button" aria-label={`${chip.label} filtresini kaldır`} onClick={…}
              className="grid h-4 w-4 place-items-center rounded-full text-primary/70 hover:bg-primary/20 hover:text-primary">
        <X className="h-3 w-3" />
      </button>
    </span>
  ))}
  <button type="button" onClick={clearAll} className="ml-auto text-xs font-medium text-foreground/60 hover:text-foreground hover:underline">
    Filtreleri Temizle
  </button>
</div>
```

- Renk: `bg-primary/10 text-primary` — `Badge tone="primary"` `soft` tonuyla AYNI çift
  (yeni bir renk kombinasyonu İCAT EDİLMEDİ), yalnızca kapatma düğmesi eklendiği için
  `Badge`'in kendisi DEĞİL, aynı token'ları taşıyan küçük bir kompozit.
- **Çip granülerliği (bağlayıcı kural):** her SEÇİLİ DEĞER kendi çipini alır (ör. iki renk
  seçiliyse "Renk: Antrasit" VE "Renk: Lacivert" AYRI çipler) — tek istisna **fiyat aralığı**,
  TEK bir birleşik çip olarak gösterilir ("150₺ – 500₺"): aralığın parçalara bölünmesi
  ("Min: 150₺" + "Max: 500₺" ayrı çipleri) kullanıcıya biri kaldırılınca diğerinin ne
  olacağı konusunda YANLIŞ bir zihinsel model verir (aralığın tek ucu kaldırılamaz, ikisi
  birlikte sıfırlanır).
- Bu satır, sidebar'daki "Filtreleri Temizle" (madde 1.1) ile AYNI `clearAll` fonksiyonunu
  çağıran TEK bir bağlantı bileşenidir — iki farklı davranışlı "temizle" YAZILMAZ.
- Hiç aktif filtre yoksa satırın TAMAMI render edilmez (boş `border-b` çizgisi bırakılmaz).

### 1.7 Mobil "Filtrele" — bottom sheet

Task'taki "drawer/bottom-sheet" ikilisinden **TEK** karar: **bottom sheet** (aşağıdan açılan,
`side="bottom"`) — mobilde filtre listesi dikey uzun bir liste olduğu için yandan dar bir
drawer yerine ekranın büyük bölümünü kaplayan bir alt sayfa daha doğal bir okuma genişliği
verir; sepet çekmecesi (DNS §6, sağdan) ile GÖRSEL OLARAK KARIŞTIRILMAMASI için de bilinçli
bir ayrım (iki farklı "slide-over" aynı yönden gelmez).

```
<Sheet>
  <SheetTrigger render={<Button variant="outline" className="lg:hidden rounded-[var(--site-radius)]" />}>
    <SlidersHorizontal className="h-4 w-4" />
    Filtrele
    {activeCount > 0 && <Badge tone="primary" size="sm">{activeCount}</Badge>}
  </SheetTrigger>
  <SheetContent side="bottom" className="h-[85vh] rounded-t-[var(--site-radius)]">
    <SheetHeader>
      <SheetTitle>Filtrele</SheetTitle>
    </SheetHeader>
    <div className="flex-1 overflow-y-auto px-4">
      {/* AYNI CatalogSidebar içeriği — Stok Durumu + Accordion grupları, masaüstüyle
          BİREBİR aynı bileşen, yalnızca kapsayıcı değişiyor. */}
    </div>
    <SheetFooter className="flex-row gap-2 border-t border-border">
      <Button variant="ghost" className="flex-1" onClick={clearAll}>Filtreleri Temizle</Button>
      <SheetClose render={<Button className="flex-1 rounded-[var(--site-radius)]" />}>
        {totalKnown ? `${total} Ürünü Gör` : "Sonuçları Gör"}
      </SheetClose>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

**Neden "Uygula" adımı/ara tampon state YOK (bilinçli, architect §5.4 madde 1-2 ile
tutarlılık gerekçesi):** URL zaten TEK durum kaynağı ve her filtre değişimi `router.replace`
ile ANINDA uygulanıyor (masaüstünde de öyle) — mobilde ayrı bir "önce seç, sonra Uygula'ya
bas" tamponlu akışı YAZMAK, iki farklı durum yönetimi deseni (URL-anlık / yerel-tamponlu)
üretir ve architect'in "URL tek durum kaynağıdır" kuralını ikiye böler. Sheet açıkken her
dokunuş ARKA PLANDAKİ ızgarayı da anında günceller (Next.js kısmi RSC yeniden render'ı);
alt çubuktaki buton yalnızca sheet'i KAPATIR, ikinci bir "uygula" işlemi YAPMAZ.

---

## 2. Üst Toolbar

```
<div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
  <InputGroup className="rounded-[var(--site-radius)] sm:w-72">
    <InputGroupAddon><Search className="h-4 w-4" /></InputGroupAddon>
    <InputGroupInput placeholder="Ürün ara…" />
    {query && (
      <InputGroupAddon align="inline-end">
        <InputGroupButton aria-label="Aramayı temizle" onClick={clear}><X /></InputGroupButton>
      </InputGroupAddon>
    )}
  </InputGroup>

  <div className="flex items-center gap-3">
    <span className="hidden text-sm text-foreground/60 sm:inline">{total} ürün</span>
    <Select className="rounded-[var(--site-radius)] w-44" value={sort} onChange={…}>
      <option value="newest">En Yeniler</option>
      <option value="price_asc">Fiyat: Artan</option>
      <option value="price_desc">Fiyat: Azalan</option>
      <option value="bestselling">Çok Satanlar</option>
      <option value="discount">İndirim Oranı</option>
    </Select>
    <div className="inline-flex items-center rounded-[var(--site-radius)] border border-border p-0.5">
      {/* 3 durum: ızgara-3, ızgara-4, liste — tek segmented control */}
      <ViewToggleButton icon={Grid2x2} active={view === "grid3"} aria-label="3 sütun ızgara" />
      <ViewToggleButton icon={Grid3x3} active={view === "grid4"} aria-label="4 sütun ızgara" />
      <ViewToggleButton icon={List}    active={view === "list"}  aria-label="Liste görünümü" />
    </div>
    <Button variant="outline" className="lg:hidden rounded-[var(--site-radius)]">…Filtrele (madde 1.7)…</Button>
  </div>
</div>
```

- `Select` seçenek DEĞERLERİ `CatalogSort` enum'una (openapi.yaml) bağlıdır — yukarıdaki
  liste yalnızca Türkçe etiket eşlemesidir, kontrat esastır.
- **Görünüm durumu (`grid3`/`grid4`/`list`) URL'de yaşar** (`?view=`) — architect §5.4
  madde 1'in "filtre/sıralama/sayfa/GÖRÜNÜM `searchParams`'ta yaşar" kuralı burada
  BİREBİR uygulanır, `localStorage`/cookie İLE SAKLANMAZ (paylaşılabilir URL önceliklidir).
- `ViewToggleButton`: `size-8` (32px), aktif `bg-primary/10 text-primary`, pasif
  `text-foreground/50 hover:bg-muted hover:text-foreground`, `rounded-[calc(var(--site-radius)-2px)]`
  (dış çerçeveden 2px küçük iç radius, "nested rounded" tutarlılığı için).
- Arama input'u debounce/URL senkronizasyonu **frontend-agent'ın** işi (architect §5.4
  madde 3, 300ms) — burada yalnızca görünüm tanımlanır.

---

## 3. Ürün Kartı

### 3.1 Hover'da ikincil görsel geçişi

Kartın kapak görseli katmanı iki `<img>`/`next/image` üst üste (`absolute inset-0`):

```
<div className="relative aspect-square w-full overflow-hidden bg-surface-muted">
  <img className="h-full w-full object-cover transition-opacity duration-300 ease-out group-hover:opacity-0" /> {/* kapak */}
  {secondaryUrl && (
    <img className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100" />
  )}
</div>
```

`duration-300 ease-out` — PDP galerisinin mevcut `hover:scale-105 transition-transform
duration-300` ana görsel zoom'uyla AYNI süre/eğri (madde 4.2), projede "hover görsel
geçişi" için TEK bir zamanlama dili. İkinci görsel yoksa (`secondaryUrl` yok) yalnızca kapak
görseli kalır, kart yine de `group-hover:scale-[1.03] transition-transform duration-300`
alır (hafif bir "canlılık" sinyali — PDP zoom'un `scale-105`'inden BİLİNÇLİ olarak daha
küçük, kart daha kompakt bir yüzey olduğu için aşırı hareket dikkat dağıtır).

### 3.2 Rozet istifleme — `right-2 top-2` slotu (DNS §3 çakışma kuralı AYNEN geçerli)

**Öncelik sırası (bağlayıcı, DNS §3'ün mutually-exclusive kuralının genişlemesi):**

1. **Tükendi** → TEK BAŞINA gösterilir, aşağıdaki TÜM pazarlama rozetleri (indirim, çok
   satan, yeni) GİZLENİR. Gerekçe: satılamayan bir ürünü "yeni"/"çok satan"/"indirimde" diye
   öne çıkarmak DNS §3'ün "indirimli ama satılamayan ürünü reklam etmek yanıltıcıdır"
   ilkesinin doğal uzantısıdır.
2. Tükenmemişse, üstten alta **en fazla 2 rozet** istiflenir (3'ün tamamı AYNI ANDA
   gösterilmez — DNS §4'ün "üçüncü bir uyarı köşe kirliliği üretir" gerekçesiyle AYNI
   disiplin): **İndirim** > **Çok Satan** > **Yeni** — bu sırayla ilk ikisi (varsa) render
   edilir, üçüncüsü (genelde Yeni) DÜŞER.

```
<div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
  {soldOut ? (
    <Badge tone="danger" solid>Tükendi</Badge>
  ) : (
    <>
      {hasDiscount && <Badge tone="danger" solid>%{discountPercent}</Badge>}
      {isBestseller && !(hasDiscount && isNew) && <Badge tone="primary">Çok Satan</Badge>}
      {isNew && !(hasDiscount && isBestseller) && <Badge tone="neutral">Yeni</Badge>}
    </>
  )}
</div>
```

(Yukarıdaki `!(...)` koşulları "en fazla 2" kuralının basit bir uygulamasıdır — indirim HER
ZAMAN gösterilir (var olduğunda en yüksek öncelik), Çok Satan ikinci sıradadır, Yeni yalnızca
diğer ikisi birlikte DOLU değilse üçüncü slotu alır.)

- **İndirim:** DNS §3 — `Badge tone="danger" solid`, DEĞİŞMEDİ.
- **Çok Satan:** `Badge tone="primary"` **soft** (solid DEĞİL) — mağaza sahibinin
  özelleştirebildiği `primaryColor` solid rozet zemininde beyaz metinle her paletle 4.5:1
  garanti VERMEZ (appearance panelinin yalnızca `buttonColor`/`buttonTextColor` çiftini
  denetlediği emsal, DNS giriş notu §"Neden --site-accent DEĞİL"); `soft` tonda ise metin
  DOĞRUDAN `primaryColor`'ın kendisi olduğu için appearance panelinin ecommerce-pro örnek
  paletinde zaten doğrulanmış `primaryColor`/arka plan çiftleriyle (9.91:1/10.36:1, madde
  9 tablosu) AYNI garantiyi miras alır — solid yerine soft seçimi budur.
- **Yeni:** `Badge tone="neutral"` (varsayılan soft, `bg-surface-muted text-foreground/70`)
  — bilinçli olarak EN SESSİZ ton (bilgilendirici, ticari değer taşımaz), zaten proje
  genelinde `Badge tone="neutral"` olarak kullanılan mevcut kombinasyon
  (`design-notes-appearance-panel.md:190`), yeni bir ton İCAT EDİLMEDİ.
- **Eşikler (yeni tanımlanan, sabit sabitler — `LOW_STOCK_THRESHOLD = 3` emsaliyle AYNI
  desende):** `isNew = daysSince(publishedAt) <= 14` (architect'in verdiği eşik).
  `isBestseller`: architect bir sayısal eşik VERMEDİ (yalnızca `salesCount` kolonunu
  kapsama aldı) — ui-designer kararı: **`salesCount >= BESTSELLER_BADGE_THRESHOLD` (öneri:
  `20`)**, `product-purchase-panel.tsx`'teki `LOW_STOCK_THRESHOLD` sabitiyle AYNI yerde
  (`lib/product-badges.ts`, YENİ küçük dosya) tanımlanan, mağaza verisine göre
  AYARLANABİLİR bir sabit — kesin sayı işletme kararı değildir, frontend-agent/architect
  gerçek katalog boyutuna göre ayarlayabilir.

### 3.3 Hızlı sepete ekle + favori — üçüncü köşe İCAT EDİLMEDİ

DNS §3'ün "üçüncü bir köşe icat edilmez" kuralı harfiyen korunur: favori **sol-üst**
(DEĞİŞMEDEN, madde 3.2'nin üstünde), rozet istifi **sağ-üst**. Hızlı sepete ekleme bir KÖŞE
İKONU DEĞİL, görselin ALT KENARINA yaslı, tam genişlikte kayan bir çubuktur — bu, mevcut
2-köşe sözleşmesini İHLAL ETMEZ (köşe değil, kenar) ve küçük bir köşe ikonundan çok daha
büyük/erişilebilir bir dokunma hedefi sağlar:

```
<div className={cn(
  "absolute inset-x-0 bottom-0 border-t border-border bg-surface/95 p-2 backdrop-blur-sm transition-transform duration-200 ease-out",
  "lg:translate-y-full lg:group-hover:translate-y-0" // masaüstü: hover'da yukarı kayar; dokunmatik: HER ZAMAN görünür
)}>
  {hasVariants ? (
    <Link href={productHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full rounded-[var(--site-radius)]")}>
      Seçenekleri Gör <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  ) : (
    <QuickAddToCartButton productId={product.id} className="w-full rounded-[var(--site-radius)]" size="sm" />
  )}
</div>
```

- **Masaüstü (`lg:` ve üstü):** `translate-y-full` (gizli) → `group-hover:translate-y-0`
  (hover'da yukarı kayar), `duration-200 ease-out`.
- **Dokunmatik (mobil/tablet, `<lg`):** hover kavramı yok — çubuk HER ZAMAN `translate-y-0`
  (statik, görselin altında sabit durur) — `sticky-add-to-cart-bar.tsx`'in `lg:hidden`
  kırılım noktasıyla AYNI mantık, tersine (orada mobilde GÖRÜNÜR/masaüstünde GİZLİ; burada
  masaüstünde hover'a BAĞLI/mobilde HER ZAMAN görünür — ikisi de "dokunmatikte hover'a
  güvenilmez" ilkesinin doğru uygulamasıdır).
- **Varyasyonlu üründe** buton "Sepete Ekle" DEĞİL **"Seçenekleri Gör"** olur ve PDP'ye
  yönlendirir (architect §5.4 madde 4) — `variant="outline"` (ikincil görünüm: bu bir
  COMMIT eylemi değil, bir YÖNLENDİRME'dir; solid "Sepete Ekle" ile görsel olarak
  AYIRT EDİLİR).
- `QuickAddToCartButton`, mevcut `AddToCartButton`'ın `variantId` GEÇİRİLMEDEN (varyasyonsuz
  ürün) çağrılan haliyle AYNI bileşen — ikinci bir sepete-ekleme mantığı YAZILMAZ.

### 3.4 Tıklanabilir renk noktaları

Başlığın HEMEN ALTINDA (fiyattan ÖNCE), kart gövdesinde — görsel ÜZERİNDE DEĞİL (görsel
alanı yalnızca rozet/favori/hızlı-ekle çubuğuna ayrılmıştır, dördüncü bir katman
EKLENMEZ):

```
<div className="mt-2 flex items-center gap-2">
  {visibleColors.map(c => (
    <button key={c.value} type="button" aria-label={`${c.value} rengini önizle`}
            onMouseEnter={() => setPreview(c.media?.url)} onFocus={() => setPreview(c.media?.url)}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPreview(c.media?.url); }}
            className={cn(
              "h-4 w-4 shrink-0 rounded-full border transition-transform duration-150",
              preview === c.media?.url ? "ring-2 ring-offset-1 ring-offset-surface ring-primary border-transparent" : "border-border hover:scale-110"
            )}
            style={{ backgroundColor: c.swatchHex ?? undefined }} />
  ))}
  {overflowCount > 0 && (
    <span className="grid h-4 w-4 place-items-center rounded-full bg-surface-muted text-[10px] font-medium text-foreground/60">
      +{overflowCount}
    </span>
  )}
</div>
```

- Boyut `h-4 w-4` (16px) — PDP/filtre swatch'larından (32px/24px) BİLİNÇLİ olarak daha
  küçük: bu bir seçim kontrolü değil, hızlı bir önizleme mikro-etkileşimidir. 4px ölçeğinin
  katı.
- **A11y/DOM konumu (kritik):** bu noktalar `<Link>` (kart linki) ile AYNI etkileşim alanına
  gömülmez — `product-card.tsx`'in mevcut yorumundaki gerekçeyle (satır 23-27, "bir `<a>`
  içine interaktif bir `<button>` gömmek geçersiz iç içe etkileşim üretir") BİREBİR aynı
  ilke: renk noktaları satırı `<Link>`'in **kardeşi** olarak (kart gövdesinin `Link`'ten
  SONRA gelen ayrı bir bloğu, `FavoriteButton` deseniyle AYNI) render edilir,
  `preventDefault`/`stopPropagation` FavoriteButton'daki ile AYNI teknik.
  **Performans notu (performance-agent'a devir):** bu, kartın görsel gösterimini
  (hangi resmin göründüğünü) bir istemci state'ine bağlar — kartın TAMAMI `"use client"`
  YAPILMAZ, yalnızca görsel+nokta satırını saran küçük bir alt bileşen (`product-card-media.tsx`
  gibi) client olur (§5.5 "gereksiz use client yayılmaması" ilkesi).
- En fazla **5** nokta gösterilir, fazlası `+N` ile özetlenir (kart genişliği sabit kalır).
- Renk-körü güvenliği: DNS §1 ile AYNI ilke — `aria-label` HER ZAMAN renk adını taşır,
  sadece dolgu rengine güvenilmez.

### 3.5 Izgara yoğunluğu ve liste görünümü

- **Izgara-3:** `grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3`
- **Izgara-4:** `grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4`
- **Liste:** `flex flex-col gap-3` — her satır kart YATAY:

```
<div className="group flex gap-4 rounded-lg border border-border p-3 transition-colors hover:border-primary/30">
  <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-[var(--site-radius)] bg-surface-muted sm:h-40 sm:w-40">
    {/* AYNI hover ikincil görsel geçişi (3.1), rozet istifi (3.2) `size="sm"`, favori sol-üst — küçük ölçekte AYNI kurallar */}
  </div>
  <div className="flex min-w-0 flex-1 flex-col">
    <div className="flex items-start justify-between gap-2">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <FavoriteButton className="shrink-0" /> {/* ızgarada görsel üzerinde, listede burada — görsel küçük olduğu için üstüne binmez */}
    </div>
    {excerpt && <p className="mt-1 line-clamp-2 text-sm text-foreground/60">{excerpt}</p>}
    <div className="mt-1">{/* renk noktaları (3.4), AYNI */}</div>
    <div className="mt-auto flex items-end justify-between pt-2">
      <div>{/* fiyat bloğu, AYNI product-card fiyat markup'ı */}</div>
      <div className="w-40">{/* hızlı sepete ekle / Seçenekleri Gör — çubuk DEĞİL, doğrudan görünür buton (liste satırında kayan çubuk gereksiz, yer zaten var) */}</div>
    </div>
  </div>
</div>
```

Liste görünümünde hızlı-ekle çubuğu (3.3) **kayan/gizli DEĞİL** — satırda zaten yeterli yatay
alan olduğu için buton doğrudan görünür durur (hover'a bağlı gösterme/gizleme, mobilde
zorunlu her-zaman-görünür istisnasını YOK EDER, sadeleşir).

---

## 4. Ürün Detay Sayfası (PDP)

### 4.1 İskelet ve kapsayıcı

Architect §4.2'deki iskelet BİREBİR uygulanır; buradaki eklemeler yalnızca GÖRSEL değerlerdir:

- Kapsayıcı: `mx-auto max-w-6xl px-4 sm:px-6` (yatay boşluk `PageHeader`'ın
  `DEFAULT_CONTAINER_CLASS_NAME`'iyle AYNI `px-4 sm:px-6` — yeni bir kapsayıcı dili İCAT
  EDİLMEDİ).
- Izgara: `grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10 lg:items-start` (`items-start`
  ZORUNLU — aksi halde `lg:sticky` sol kolon, sağ kolonun yüksekliğine göre `stretch`
  edilip sticky davranışı bozulur).
- Breadcrumb, ızgaranın ÜSTÜNDE, tam genişlik: `mb-4 flex items-center gap-1 text-sm
  text-foreground/60` — ayraç `ChevronRight` (`h-3.5 w-3.5 text-foreground/30 shrink-0`),
  son kırıntı (ürün adı) `text-foreground font-medium` + `aria-current="page"`, link
  DEĞİL.

### 4.2 Sol kolon — Galeri

`lg:sticky lg:top-24 lg:self-start` — `top-24` (96px), site header'ın altından temiz bir
boşluk bırakacak şekilde (tam değer frontend-agent'ın header yüksekliğine göre
DOĞRULAMASI gereken bir varsayılan, sabit `96px` yerine ölçekli `top-24` seçildi ki
`--spacing` ölçeğinin katı kalsın).

**Görselsiz ürün — yer tutucu (kök neden #2 düzeltmesi):** `ProductGallery`'nin `images.length
=== 0 && !highlightUrl` dalında artık `null` DEĞİL, `PageHeader`'ın **SPLIT** layout'undaki
görsel-yok yer tutucusuyla AYNI dil (`page-header.tsx:119`, `ImageIcon` + `bg-muted`),
PDP'nin birincil görsel yüzeyi olduğu için biraz daha büyük:

```
<div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-muted text-foreground/40">
  <ImageIcon className="h-10 w-10" aria-hidden="true" />
  <span className="text-sm text-foreground/60">Görsel mevcut değil</span>
</div>
```

(İkon `text-foreground/40` — dekoratif/`aria-hidden`, metin AA-doğrulanmış `text-foreground/60`.)

**Zoom/büyüteç (yeni, mevcut lightbox'a EK — yerine DEĞİL):** ana görsel üzerinde imleç
hareketiyle takip eden bir büyütme — AYRI bir "lup" kutusu İCAT EDİLMEZ, doğrudan görselin
kendisi `transform-origin` imleç konumuna bağlanıp `scale(2)` olur:

```
<div className="relative overflow-hidden rounded-lg" onMouseMove={handleMove} onMouseLeave={reset}>
  <img style={{ transformOrigin: `${x}% ${y}%`, transform: zoomed ? "scale(2)" : "scale(1)" }}
       className="w-full object-cover transition-transform duration-200 ease-out" />
</div>
```

- Yalnızca `scale(1→2)` GEÇİŞİ animasyonludur (`duration-200`); `transformOrigin`
  konumlandırması imleç hareketiyle BİRLİKTE (transitionsız) güncellenir — pozisyona da
  geçiş uygulanırsa imleçten GERİ KALIR, rahatsız edici bir gecikme hissi verir.
  **Yalnızca ince işaretçili cihazlar** (`onMouseMove` zaten dokunmatikte tetiklenmez, ek
  bir medya sorgusu GEREKMEZ).
  Tıklama davranışı DEĞİŞMEDİ — halen mevcut `GalleryLightbox`'ı açar (`cursor-zoom-in`
  korunur), hover-zoom ve click-to-open birbirini ENGELLEMEZ.
- Thumbnail şeridi (`grid grid-cols-4 gap-2 sm:grid-cols-5`) DEĞİŞMEDİ.

### 4.3 Sağ kolon — Satın alma paneli

**Sıralama (yukarıdan aşağı, DNS'in bağlayıcı konumlandırmasıyla ÇATIŞMAYACAK şekilde
çözümlendi — bkz. not altta):**

1. `<h1 className="text-2xl font-semibold text-foreground sm:text-3xl">{title}</h1>` —
   kök neden #1 düzeltmesi: `PageHeader` PDP'de HİÇ render edilmez, başlık DOĞRUDAN sayfa
   içinde.
2. SKU/kategori satırı: `mt-1 text-sm text-foreground/60` — `"{category.title} · SKU:
   {sku}"`, kategori adı `/products?category={slug}`'a link (`hover:text-foreground
   hover:underline`).
3. Fiyat bloğu — mevcut `product-purchase-panel.tsx` markup'ı DEĞİŞMEDEN, YANINA "kazanç
   rozeti" eklenir (yalnızca indirim varken): `<Badge tone="success">
   {formatPriceFromCents(priceCents - discountPriceCents, currency)} kazanın</Badge>`,
   fiyat bloğunun `mt-2`'sinde. `success` tonu DNS §5'in "isFree" başarı sinyaliyle AYNI
   kaynak — "kazanç/olumlu sonuç" anlamı için tek semantik renk.
4. **Düşük stok rozeti** — DNS §4'ün BAĞLAYICI konumu (fiyatın hemen altı, varyasyon
   seçicinin ÜSTÜ) KORUNUR, DEĞİŞTİRİLMEZ.
5. Varyasyon seçiciler — DEĞİŞMEDİ (DNS §1/§2 BİREBİR).
6. **Kargo/teslimat tahmini bildirimi** (YENİ — `product-shipping-notice.tsx`):
   ```
   {shippingEstimatedDaysMin !== null && shippingEstimatedDaysMax !== null && (
     <div className="mt-4 flex items-center gap-1.5 text-sm text-foreground/70">
       <Truck className="h-4 w-4 text-foreground/50" aria-hidden="true" />
       {shippingEstimatedDaysMin}-{shippingEstimatedDaysMax} iş günü içinde kargoda
     </div>
   )}
   ```
   İkisi de `null` iken bileşen HİÇ render edilmez (architect §2.5 bağlayıcı kuralı — bir
   ticari taahhüt icat edilmez).
7. Adet seçici + Sepete Ekle + Favori — tek satır, `mt-6 flex items-center gap-3`.

**Not — sıralama çelişkisi çözümü:** architect §4.2'nin düzyazı listesi "varyasyon
seçiciler · stok/kargo bildirimi · adet seçici" sırasını verir; ANCAK DNS §4 düşük stok
rozetinin konumunu "fiyatın hemen altı, varyasyon seçicinin ÜSTÜ" olarak BAĞLAYICI şekilde
kilitlemiştir ve bu doküman DNS'i DEĞİŞTİREMEZ (giriş notu). Çözüm: DNS'in bağladığı **düşük
stok** rozeti eski konumunda kalır; architect'in yeni listesindeki **kargo/teslimat**
bildirimi (DNS'te hiç yoktu, bu turda YENİ) architect'in verdiği sırayla varyasyon
seçicilerin ALTINA yerleştirilir. İki kural da harfiyen uygulanmış olur, çelişki
YOKTUR.

**Adet seçici (`quantity-selector.tsx`, YENİ):**

```
<div className="inline-flex h-9 items-center divide-x divide-border rounded-[var(--site-radius)] border border-border">
  <Button variant="ghost" size="icon-sm" className="h-9 w-9 rounded-none rounded-l-[var(--site-radius)]" disabled={qty <= 1} aria-label="Azalt">
    <Minus className="h-3.5 w-3.5" />
  </Button>
  <span className="w-10 text-center text-sm font-medium tabular-nums">{qty}</span>
  <Button variant="ghost" size="icon-sm" className="h-9 w-9 rounded-none rounded-r-[var(--site-radius)]" disabled={qty >= stockQuantity} aria-label="Artır">
    <Plus className="h-3.5 w-3.5" />
  </Button>
</div>
```

`h-9` — `Button`'ın `size="lg"` (`h-9`) tokenıyla AYNI yükseklik, yanına gelecek "Sepete
Ekle" ile hizalı; sayı GİRİLEMEZ (salt stepper) — geçersiz elle-yazım kenar durumlarından
kaçınmak için bilinçli basitleştirme.

**Sepete Ekle + Favori satırı:**

```
<div className="mt-6 flex items-center gap-3">
  <AddToCartButton size="lg" className="flex-1" … />
  <FavoriteButton productId={product.id} variant="outline" size="icon-lg"
                   className="h-9 w-9 shrink-0 rounded-[var(--site-radius)] border border-border" />
</div>
```

**Frontend-agent'a iki küçük, geriye-uyumlu bileşen genişletmesi gerekir (yeni davranış
İCAT EDİLMİYOR, sadece parametrik hale getiriliyor):**
- `AddToCartButton` şu an sabit varsayılan `Button` boyutunu kullanıyor — opsiyonel `size`
  prop'u (PDP'de `"lg"`, kartta halihazırdaki varsayılan) eklenir.
- `FavoriteButton` şu an sabit `variant="ghost" size="icon"` — PDP'de görsel ağırlığı
  kart-üstü yüzen halinden FARKLI (kenarlıklı, `icon-lg`) olması için opsiyonel
  `variant`/`size` override eklenir; **ikon-only kalır** (metin etiketi EKLENMEZ — mevcut
  `aria-label` zaten erişilebilir ad sağlıyor, geniş "Sepete Ekle" CTA'sının yanında ikinci
  bir metin butonu görsel dengesizlik yaratır, Nike/Adidas PDP emsalindeki "geniş birincil +
  ikon ikincil" düzeni izlenir).

**Büyük "sticky" CTA:** bu ihtiyaç zaten DNS §7 `StickyAddToCartBar` ile TAM olarak
karşılanıyor (mobil/tablet, `lg:hidden`, statik buton viewport'tan çıkınca belirir) —
masaüstünde sol kolon zaten `lg:sticky` olduğu için sağ kolona İKİNCİ bir sticky konteyner
EKLENMEZ (DNS §7'nin kendi gerekçesi). Bu doküman yalnızca statik (akış içi) butonun
`size="lg"` ile "büyük" görünmesini sağlar (yukarı bakınız).

### 4.4 Alt sekmeler

Mevcut `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` (`variant="line"`) — bu varyant zaten
aktif/pasif/odak durumlarının HEPSİNİ taşıyor (`data-active:text-primary` + alt çizgi
`after:bg-primary`, `focus-visible:ring-3`), YENİ bir sekme tasarımı İCAT EDİLMEZ:

```
<Tabs defaultValue="description" className="mt-12">
  <TabsList variant="line" className="border-b border-border">
    <TabsTrigger value="description">Açıklama & Özellikler</TabsTrigger>
    {product.documents.length > 0 && <TabsTrigger value="documents">Teknik Dökümanlar</TabsTrigger>}
    <TabsTrigger value="returns">İade & Garanti</TabsTrigger>
  </TabsList>
  <TabsContent value="description" className="mt-6 text-sm leading-relaxed text-foreground/80">
    {/* mevcut descriptionHtml render deseni — blog gövdesiyle AYNI tipografi, yeni ölçek İCAT EDİLMEZ */}
  </TabsContent>
  {product.documents.length > 0 && (
    <TabsContent value="documents" className="mt-6">
      <ProductDocuments documents={product.documents} /> {/* DNS §8 — DEĞİŞMEDEN, başlık `h3` KALDIRILIR (sekme başlığı zaten aynı bilgiyi taşıyor, çift başlık YAZILMAZ) */}
    </TabsContent>
  )}
  <TabsContent value="returns" className="mt-6 text-sm text-foreground/80">
    <p>İade ve garanti koşulları hakkında detaylı bilgi için:</p>
    <Link href={legalPageHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-3 rounded-[var(--site-radius)]")}>
      İade & Garanti Politikası <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  </TabsContent>
</Tabs>
```

- **"Teknik Dökümanlar" sekmesi `documents.length === 0` iken HİÇ render edilmez** —
  architect §4.2 bağlayıcı kuralı (boş sekme gösterilmez).
- **"İade & Garanti" statik hukuki metin İÇERMEZ** — yalnızca `Page.isLegalDocument`
  sayfasına link (architect §4.2, compliance gerekçesi — [EPT] §7.3).
- **Frontend-agent'a doğrulama notu (mimari kural, ui-designer'ın kapsamı DIŞINDA ama
  görsel sonucu etkiler):** architect §4.2 sekme paneli DOM'dan KALDIRILMAMALI (`hidden`
  ile gizlenmeli, arama motoru/`Ctrl+F` erişebilsin) — `@base-ui/react/tabs`'ın panel
  unmount/`keepMounted` davranışı frontend-agent tarafından doğrulanmalı; gerekirse
  `TabsContent`'e `keepMounted` prop'u geçirilir. Bu bir DAVRANIŞ kararıdır, yukarıdaki
  görsel token'ları ETKİLEMEZ.
- `role="tablist"`/`role="tab"`/`role="tabpanel"` + ok tuşu gezinmesi `@base-ui/react/tabs`
  primitifinin YERLEŞİK davranışıdır (admin panelinde zaten aynı primitif kullanılıyor) —
  yeniden YAZILMAZ.

---

## 5. WCAG AA kontrast notları (bu doküman kapsamında yeni eklenen her yüzey)

| Yüzey | Değer | Doğrulama |
|---|---|---|
| Slider tutamağı odak halkası | `focus-visible:ring-3 ring-ring/50` | `Input`/`Checkbox`/`Button` ile AYNI token — proje genelinde zaten tek bir odak dili, tekrar hesaplanmadı, MEVCUT kabul devralındı. |
| Slider ray/dolgu | `bg-muted` / `bg-[var(--site-primary)]` | DNS §5 kargo çubuğuyla (`h-2 rounded-full bg-muted`, dolgu `--site-primary`) AYNI çift, ORADA zaten "marka rengi ne olursa olsun okunabilir" gerekçesiyle kabul edilmişti — yinelenmedi. |
| 24px çoklu-seçim swatch (pasif/seçili/stoksuz) | DNS §1 BİREBİR | DNS'in kendi 6.47:1 (`--danger`/`--surface`) doğrulaması AYNEN geçerli, boyut değişikliği kontrastı ETKİLEMEZ. |
| Kompakt beden çipi (`h-8`) | DNS §2 BİREBİR + `Check` ikonu | Renk çifti DEĞİŞMEDİ, yalnızca boyut küçüldü — kontrast SABİT kalır. |
| "Çok Satan" rozeti | `Badge tone="primary"` **soft** (solid DEĞİL) | `primaryColor`/arka plan çifti appearance-panelinin ecommerce-pro örnek paletinde 9.91:1/10.36:1 (madde 3.2 gerekçesi) — solid seçilseydi `buttonTextColor`/`primaryColor` çifti appearance panelinde DENETLENMİYOR, garantisiz olurdu; bu yüzden soft. |
| "Yeni" rozeti | `Badge tone="neutral"` (varsayılan) | Mevcut `text-foreground/70` üzerine `bg-surface-muted` — `design-notes-contrast-fixes.md` §"Badge neutral kompozit" analiziyle zaten GEÇER olarak doğrulanmış (`text-foreground/60`'tan bile daha koyu, `/60` her iki temada 5.25-6.25:1 arası doğrulanmıştı). |
| "Kazanç rozeti" | `Badge tone="success"` | Kök `--success` (`#166534`, 7.13:1 düz metin) — DNS §5 "isFree" kullanımıyla AYNI token, yeniden hesaplanmadı. |
| Kargo/teslimat bildirimi metni | `text-foreground/70` üstte, ikon `text-foreground/50` | Metin `text-foreground/60` eşiğinin ÜSTÜNDE (`/70` > `/60`, daha koyu → daha yüksek kontrast, güvenli); ikon dekoratif/`aria-hidden`, metinle birlikte anlam taşıdığı için tek başına AA'ya tabi DEĞİL. |
| PDP görselsiz yer tutucu metni | `text-foreground/60` | Doğrulanmış eşik (bkz. yukarı), ikon `/40` dekoratif. |
| Renk noktası (16px) seçili halkası | `ring-2 ring-offset-1 ring-primary` | `primary`/`surface` çifti madde yukarıdaki gibi ≥9.91:1, WCAG 1.4.11 (3:1 non-text) eşiğinin çok üstünde. |
| Aktif filtre çipi | `bg-primary/10 text-primary` | `Badge tone="primary"` `soft` ile AYNI çift — appearance panelinde zaten doğrulanmış. |
| Kategori sayaç rozeti | `bg-surface-muted text-foreground/60` | Doğrulanmış `/60` eşiği. |

---

## Özet — Uygulanacak Somut Değerler

| Öğe | Değer |
|---|---|
| Sidebar genişliği/sticky | `lg:w-64 lg:sticky lg:top-24` |
| Filtre grubu çerçevesi | mevcut `AccordionItem` (`rounded-lg border border-border/60`) |
| Kategori satırı seçili | `bg-primary/10 text-primary font-medium` |
| Kategori sayaç rozeti | `bg-surface-muted text-foreground/60 text-[11px] px-1.5` |
| Fiyat slider ray/dolgu/tutamak | `h-2 rounded-full bg-muted` / `bg-[var(--site-primary)]` / `h-4 w-4 border-2 border-primary` |
| Fiyat slider yeni primitif | `components/ui/slider.tsx` (`@base-ui/react/slider`, mevcut bağımlılık) |
| Renk swatch (filtre, çoklu seçim) | DNS §1 kompakt `w-6 h-6` (24px) + `role="checkbox"` |
| Beden çipi (filtre, çoklu seçim) | `h-8 min-w-8 px-2.5 text-xs` + seçili öncesi `Check` ikonu |
| Stok toggle | mevcut `Switch`, accordion dışı sabit satır |
| Aktif filtre çipi | `bg-primary/10 text-primary rounded-full` + `X` kaldır |
| Fiyat çipi granülerliği | tek birleşik çip ("150₺ – 500₺"), diğer eksenler değer-başına ayrı çip |
| Mobil filtre paterni | `Sheet side="bottom" h-[85vh]`, "Uygula" adımı YOK (URL anlık) |
| Toolbar arama | `InputGroup` + `Search`/`X` ikon, `rounded-[var(--site-radius)]` |
| Görünüm anahtarı | `?view=grid3\|grid4\|list`, URL state |
| Kart hover ikincil görsel | `opacity-0→100`, `duration-300 ease-out` (galeri zoom'uyla AYNI) |
| Rozet istif sırası | Tükendi (tek başına) > İndirim > Çok Satan > Yeni, **en fazla 2** |
| Çok Satan rozeti | `Badge tone="primary"` **soft**, eşik önerisi `salesCount >= 20` |
| Yeni rozeti | `Badge tone="neutral"`, eşik `publishedAt` ≤ 14 gün (architect verdi) |
| Hızlı sepete ekle | görsel KENARINDA kayan çubuk (köşe DEĞİL), `lg:` hover / `<lg` her zaman görünür |
| Varyasyonlu kart CTA | "Seçenekleri Gör" + `ArrowRight`, `variant="outline"` |
| Renk noktaları (kart) | `h-4 w-4`, en fazla 5 + `+N`, `Link` DIŞINDA sibling |
| PDP kolon ızgarası | `grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10 lg:items-start`, `max-w-6xl` |
| Galeri sticky ofset | `lg:top-24` |
| Görselsiz PDP yer tutucusu | `PageHeader` SPLIT boş-durum dili, `ImageIcon h-10 w-10` |
| Hover zoom | `transform-origin` imleç takibi, `scale(2)`, yalnızca konum geçişsiz |
| Kazanç rozeti | `Badge tone="success"`, "{tutar} kazanın" |
| Kargo/teslimat bildirimi | `Truck` ikon + `{min}-{max} iş günü içinde kargoda`, ikisi `null` ise render YOK |
| Adet seçici | `h-9`, `divide-x divide-border`, salt stepper (elle giriş YOK) |
| Sepete Ekle + Favori satırı | `AddToCartButton size="lg" flex-1` + `FavoriteButton variant="outline" size="icon-lg"` |
| PDP sekmeleri | mevcut `Tabs variant="line"`, "Teknik Dökümanlar" `documents.length===0` iken YOK, "İade & Garanti" yalnızca link |
| Liste görünümü satırı | `flex gap-4`, görsel `h-32 w-32 sm:h-40 sm:w-40`, hızlı-ekle çubuğu YOK (buton doğrudan görünür) |
