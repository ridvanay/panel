# Tasarım Notları: Medya Kütüphanesi — Klasör Ağacı (FileBird-tarzı)

Ajan: ui-designer
Kapsam: Sadece tasarım/UX kararları. Kod implementasyonu **frontend-agent**'a aittir.
Kontrat referansı (bağlayıcı, değiştirilemez): `docs/architecture/ARCHITECTURE.md` §10.11 + `docs/architecture/openapi.yaml`
(`Media`/`MediaFolder` şemaları). Bu doküman kontratla ÇELİŞMEZ — özellikle: maksimum derinlik **2** (kök + 1 alt),
"Kategorisiz" bir klasör KAYDI DEĞİL (`folderId IS NULL`), `mediaCount` alt klasörleri saymaz (rollup yok), klasör
arama **frontend-only**, taşıma tek uç (`POST /admin/media/move`, tekil = tek elemanlı dizi), klasör silme yalnızca
ADMIN + hiçbir şey kaskad silinmez.

Referans (oku, tekrar icat etme): `frontend/src/app/admin/media/page.tsx` (mevcut grid/list/seçim/araç çubuğu —
BÜYÜK ÖLÇÜDE KORUNUYOR, sadece 2 sütunlu bir kabuğa taşınıyor), `frontend/src/components/admin/navigation/nav-tree-editor.tsx`
+ `nav-tree-row.tsx` (projede zaten var olan TEK ağaç UI'ı — girinti/derinlik/drop-indicator dilinin kaynağı),
`.claude/design-notes-navigation-menu-editor.md` (bu projenin görsel yönünü **Minimal/Flat** olarak teyit eden
doküman — Karar 4/9), `.claude/design-notes-media-picker.md` (mevcut `MediaPicker` modalının iskeleti — bu doküman
onu GENİŞLETİYOR, yeniden yazmıyor), `frontend/src/components/admin/media/media-list-table.tsx` (mevcut
`DropdownMenu` satır-aksiyonu deseni).

**Görsel yön: Minimal/Flat.** `admin/media/page.tsx` ve `nav-tree-row.tsx` zaten bu çizgide (`bg-surface`,
`border-border/60`, `hover:bg-surface-muted`, `--primary` odaklı vurgular, `backdrop-blur-xl` sadece `Card`'ın
KENDİSİNDE — hafif bir cam yüzey, ama gradyan/ambient glow YOK). `AdminSidebar` (glow/gradient/motion-pill) bu
kuralın **istisnasıdır** — proje genelinde zaten böyle belgelenmiş (bkz. navigasyon notları Karar 4 önsözü), global
navigasyon kromuna özgüdür ve klasör paneline TAŞINMAZ. Yeni hiçbir bileşen `blur-xl`/gradient arka plan/ambient
glow kullanmaz; hepsi mevcut `--primary/--border/--surface/--surface-muted` token'larına bağlanır.

---

## Karar 1 — Sayfa layout'u: iki sütun, sol panel 256px sabit, mobilde Sheet (drawer)

`admin/media/page.tsx`'in üst gövdesi (`PageHeading` → hata → dropzone) **DEĞİŞMEZ**. Onun ALTINDAKİ blok
(araç çubuğu + seçim çubuğu + grid/liste + sayfalama) artık iki sütunlu bir kabuğa alınır:

```tsx
<div className="flex flex-col gap-6 lg:flex-row lg:items-start">
  {/* Sol panel — masaüstü */}
  <div className="hidden lg:block lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
    <MediaFolderTree ... />
  </div>
  {/* Sağ panel — mevcut araç çubuğu + seçim çubuğu + grid/liste + sayfalama BİREBİR BURAYA taşınır */}
  <div className="min-w-0 flex-1 space-y-6">
    ...
  </div>
</div>
```

- **Genişlik: `lg:w-64` (256px), sabit — arbitrary değer değil, Tailwind'in native ölçeğinden.** Nav editörünün
  340px'lik sol paneliyle (`design-notes-navigation-menu-editor.md` Karar 2) KARIŞTIRILMAMALI: o panel bir
  accordion + checkbox listesiydi, bu panel yalnızca tek satırlık ağaç düğümleri + sayaç rozeti + hover'da beliren
  bir `⋮` aksiyon butonu taşıyor — 256px bu içerik için yeterli, daha dar (WP FileBird'ün kendi varsayılanına
  yakın), sağ tarafa ızgara için daha fazla yer bırakır.
- **`lg:sticky lg:top-6`** — nav editörüyle AYNI kararın gerekçesi: panel bir "seçim kaynağı", grid uzun sürede
  kayarken panelin sabit kalması kullanıcının sürekli yukarı kaydırmasını engeller.
- **Kırılım noktası: `lg` (1024px)** — mevcut kodda zaten `lg:grid-cols-4`/`sm:` gibi kırılımlar bu eşiği
  kullanıyor (bkz. sayfa genelindeki `sm:`/`md:`/`lg:` kullanımı), tutarlılık için aynı eşik.
- **Mobil/tablet (`< lg`): panel `Sheet` (mevcut `components/ui/sheet.tsx`, `side="left"`) içine taşınır, ayrı bir
  bileşen İCAT EDİLMEZ.** Araç çubuğunun (mevcut filtre satırı) EN SOLUNA, tür filtresinden ÖNCE bir tetikleyici
  buton eklenir:
  ```tsx
  <Button type="button" variant="outline" size="sm" className="lg:hidden" onClick={() => setFolderSheetOpen(true)}>
    <FolderTree className="h-4 w-4" />
    {activeFolderLabel}
    <Badge tone="neutral" size="sm">{activeFolderCount}</Badge>
  </Button>
  <Sheet open={folderSheetOpen} onOpenChange={setFolderSheetOpen}>
    <SheetContent side="left" className="w-3/4 sm:max-w-xs p-0">
      <SheetHeader className="border-b border-border"><SheetTitle>Klasörler</SheetTitle></SheetHeader>
      <div className="flex-1 overflow-y-auto p-3">
        <MediaFolderTree ... onSelect={(id) => { onSelectFolder(id); setFolderSheetOpen(false); }} />
      </div>
    </SheetContent>
  </Sheet>
  ```
  Klasör seçildiğinde Sheet **otomatik kapanır** (`onSelect` içinde `setFolderSheetOpen(false)`) — mobilde seçim
  sonrası ekstra bir "kapat" adımı istenmez, MediaPicker'ın "seç-ve-kapat" felsefesiyle (bkz.
  `design-notes-media-picker.md` madde 3) tutarlı.
  **Neden `Sheet`, "sayfa akışında collapse" değil:** Ağaç uzun olabilir (~200 klasöre kadar, §10.11.2), mobilde
  sayfanın en üstüne devasa bir katlanır liste koymak grid'i aşağı iter; `Sheet` zaten projede var olan, kanıtlanmış
  bir örtüşen-katman deseni (yeni bağımlılık yok).
  **Tek bileşen, iki konteyner:** `MediaFolderTree` component'i HEM masaüstü `<div>` içinde HEM `SheetContent`
  içinde AYNI instance-şekliyle render edilir (props aynı, sadece saran konteyner farklı) — iki ayrı ağaç
  implementasyonu YAZILMAZ.

---

## Karar 2 — Klasör ağacı satırı tasarımı

**Girinti: derinlik 0 → `pl-3` (12px), derinlik 1 → `pl-8` (32px).** Fark 20px ama iki değer de Tailwind'in
native spacing ölçeğinden (`pl-3`/`pl-8`) — rastgele piksel değeri yok. `pl-8`, nav editöründeki 32px/seviye
birimiyle (Karar 4, `design-notes-navigation-menu-editor.md`) aynı büyüklük ailesinde, projede zaten "bir seviye
= 32px" hissi yerleşik.

**Genişletme/daraltma ikonu: YOK — ağaç her zaman tam açık render edilir.** Gerekçe: maksimum derinlik 2 olduğu
için bir "chevron ile aç/kapat" mekanizması ekstra bir tıklama katmanı ekler ama karmaşıklığı gerçekten azaltmaz
(en fazla 1 seviye çocuk var); panel zaten bir **filtre/navigasyon** yüzeyi — kullanıcının bir alt klasöre
ulaşmak için önce üst klasörü "açması" gerekmesi sürtünme yaratır. Kullanıcının orijinal isteğindeki "açık/kapalı
ikon gerekiyor mu" sorusuna yanıt: **hayır, gerekmiyor.**

**Satır yapısı (`h-9`, `px-2` sağda/solda hariç yukarıdaki `pl-*`, `gap-2`, `rounded-md`):**
```tsx
<button
  type="button"
  className={cn(
    "group flex h-9 w-full items-center gap-2 rounded-md pr-2 text-sm transition-colors",
    depth === 0 ? "pl-3" : "pl-8",
    isActive
      ? "bg-primary/10 font-medium text-primary"
      : "text-foreground/80 hover:bg-surface-muted hover:text-foreground"
  )}
>
  {isActive ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0 text-foreground/40" />}
  <span className="flex-1 truncate text-left">{folder.name}</span>
  <Badge tone="neutral" size="sm">{folder.mediaCount}</Badge>
  {/* ⋮ aksiyon butonu — Karar 7 */}
</button>
```

- **Aktif/seçili vurgu: `bg-primary/10 text-primary font-medium`** — `Badge`'in `tone="primary" soft` sınıfıyla
  (`badge.tsx` satır 9) AYNI token kombinasyonu, yeni bir renk üretilmedi. Sol kenarlıkta ekstra bir "accent bar"
  YOK (WP FileBird'de var ama bu projenin flat diline gereksiz bir ek katman; arka plan + ikon + font-weight
  değişimi zaten üç ayrı sinyal veriyor, dördüncüsü gürültü).
- **Hover (aktif değilken): `hover:bg-surface-muted hover:text-foreground`** — `nav-tree-row.tsx`'in satır
  hover'ıyla (`hover:border-border hover:bg-surface-muted`) BİREBİR aynı token.
- **İkon:** aktif satırda `FolderOpen`, diğerlerinde `Folder` (ikisi de lucide-react, `text-foreground/40` pasif
  tonda — sayfanın diğer yerlerindeki `text-foreground/40/50` ikon tonlama alışkanlığıyla aynı, örn.
  `nav-tree-row.tsx` sürükle tutamacı, `page.tsx` boş durum ikonu).
- **`mediaCount` rozeti: `Badge tone="neutral" size="sm"`** — mevcut bileşen aynen kullanılır, yeni bir rozet
  varyantı YAZILMAZ. 0 değeri de gösterilir (gizlenmez) — "bu klasör boş" bilgisi tarama sırasında faydalı.
- **`⋮` aksiyon butonu (Karar 7):** varsayılan `opacity-0`, `group-hover:opacity-100 focus-within:opacity-100` —
  `page.tsx`'teki grid kartı kopyala/checkbox ikonlarının AYNI görünürlük deseni (satır 577-599).

---

## Karar 3 — Sabit girişler: "Tüm Dosyalar" ve "Kategorisiz"

Görsel olarak kullanıcı klasörlerinden **üç sinyalle** ayrışır: (1) farklı ikon, (2) altlarında ince bir ayraç
çizgisi, (3) aksiyon menüsü (`⋮`) YOK (silinemez/yeniden adlandırılamaz kayıtlar oldukları için — §10.11.1).

```tsx
<div className="space-y-0.5">
  <FolderRow icon={Images} label="Tüm Dosyalar" count={totalCount} depth={0} noActions />
  <FolderRow icon={FolderMinus} label="Kategorisiz" count={uncategorizedCount} depth={0} noActions />
</div>
<div className="my-2 border-t border-border/60" />
{/* kullanıcı klasörleri ağacı buradan başlar */}
```

- **İkonlar:** "Tüm Dosyalar" → `Images` (lucide, çoklu görsel yığını — filtre yok, TÜM kütüphane), "Kategorisiz"
  → `FolderMinus` (lucide, "klasörden çıkarılmış/klasörsüz" çağrışımı — `Folder`/`FolderOpen`'dan bilinçli olarak
  farklı, ikisi de gerçek klasör olmadığı mesajını taşır).
- **Ayraç:** `border-t border-border/60`, `my-2` (8px) — 4/8px ölçeğinden, projede zaten `border-border/60`
  yaygın (Card, nav-tree-row).
- **Varsayılan seçili: "Tüm Dosyalar"** — sayfa ilk açıldığında bugünkü davranışla (klasör kavramı yokken tüm
  medya listeleniyordu) birebir aynı, geriye dönük görsel süreklilik.
- **`totalCount`/`uncategorizedCount`:** bunlar birer `MediaFolder` DEĞİL, hesaplama frontend-agent'ın veri
  katmanı kararı (örn. toplam sayım için mevcut liste meta'sı, "Kategorisiz" için `folderId: null` filtresiyle
  bir sayım) — bu doküman sadece rozetin GÖRÜNMESİ gerektiğini ve `Badge tone="neutral" size="sm"` ile
  render edileceğini belirtir.

---

## Karar 4 — "+ Yeni Klasör" ve inline oluşturma

**Konum: panel başlığının sağında, ikon-only buton.**
```tsx
<div className="mb-3 flex items-center justify-between">
  <h2 className="admin-h2">Klasörler</h2>
  <Button type="button" variant="ghost" size="icon-sm" aria-label="Yeni klasör" onClick={startCreateAtRoot}>
    <FolderPlus className="h-4 w-4" />
  </Button>
</div>
```
- **Stil: `variant="ghost" size="icon-sm"`** — panelin diğer tüm etkileşimleri de düşük-ağırlıklı (ghost/ikon)
  olduğu için birincil bir dolgulu buton (`variant="default"`) panel başlığında ORANSIZ ağır dururdu; bu buton
  zaten en görünür/en sık kullanılan aksiyon değil.
- **Modal/prompt YOK — inline satır oluşturma.** Tıklanınca ağacın EN ÜSTÜNE (sabit girişlerin altına, kullanıcı
  klasörlerinin başına) geçici bir satır eklenir:
  ```tsx
  <div className="flex h-9 items-center gap-2 rounded-md border border-primary/40 bg-primary/5 pr-2 pl-3">
    <FolderPlus className="h-4 w-4 shrink-0 text-primary" />
    <Input
      autoFocus
      className="h-7 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
      placeholder="Klasör adı"
      onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") cancel(); }}
      onBlur={cancel}
    />
  </div>
  ```
  Gerekçe: proje genelinde küçük metin girişleri için zaten `window.prompt`/modal yerine **satır-içi düzenleme**
  paterni yerleşik (`nav-tree-row.tsx`'in "satır-içi accordion" düzenlemesi, `design-notes-navigation-menu-editor.md`
  Karar 3). Modal, tek bir metin alanı için orantısız bir ağırlık katardı.
- **Enter → oluştur** (`POST /admin/media/folders`, `parentId: null`), **Escape veya blur → iptal** (satır
  kaybolur, hiçbir istek gitmez) — kazara boş/yarım isim kaydını önlemek için blur'da SESSİZCE iptal edilir,
  otomatik kaydetme YOK.
- **409 (isim çakışması) durumunda:** satır AÇIK kalır, `sonner`'ın `toast.error("Bu isimde bir klasör zaten var.")`
  ile (mevcut `friendlyErrorMessage` + `toast` deseni, `page.tsx`'in geri kalanıyla birebir aynı), input odakta
  kalır, kullanıcı ismi düzeltip tekrar Enter'a basabilir.
- **Alt klasör oluşturma AYRI bir giriş noktasından gelir (Karar 7 — `⋮` menüsü → "Alt Klasör Ekle"), bu üstteki
  `+` butonu HER ZAMAN kök seviyede (`parentId: null`) oluşturur.** Aynı inline satır deseni, sadece
  `depth === 1`'e denk gelen girintiyle (`pl-8`) ve ilgili ebeveyn klasörün ÇOCUKLARININ SONUNA eklenerek render
  edilir.

---

## Karar 5 — Klasör adı arama kutusu

**Konum: panel başlığının hemen altında, ağacın ÜSTÜNDE — sabit girişlerden de önce** (kullanıcı hangi klasörü
arıyorsa "Tüm Dosyalar"/"Kategorisiz" sonuçların arasına karışmasın, arama SADECE gerçek klasör kayıtlarını
filtreler).

```tsx
<InputGroup className="mb-3">
  <InputGroupAddon><Search /></InputGroupAddon>
  <InputGroupInput placeholder="Klasör ara…" aria-label="Klasör ara" value={query} onChange={...} />
</InputGroup>
```
Mevcut `InputGroup`/`InputGroupAddon`/`InputGroupInput` üçlüsü — `page.tsx`'teki dosya adı arama kutusuyla
BİREBİR aynı bileşen deseni, sadece placeholder farklı. **Frontend-only** (§10.11.2 — `GET /admin/media/folders`
arama parametresi almıyor), `>` eşik yok, klasör sayısı az olsa bile kutu HER ZAMAN görünür (tutarlılık, ağaç
büyüdükçe fayda artar).

**Arama aktifken filtreleme kuralı (kontrat dışı, saf UX kararı):**
- Kendi adı eşleşen bir kök klasör → tam opaklıkta gösterilir, normal şekilde tıklanabilir.
- Sadece bir ÇOCUĞU eşleşen kök klasör → yine gösterilir ama **bağlam için soluk** (`opacity-60`), tıklanabilirliği
  KORUNUR (kullanıcı yine de o kök klasöre gidebilir).
- Eşleşen çocuk → normal opaklıkta, kendi girintisinde (`pl-8`).
- Hiçbir eşleşmesi olmayan kök klasör ve eşleşmeyen çocuklar tamamen gizlenir.
- "Tüm Dosyalar"/"Kategorisiz" de arama sorgusuna karşı (kendi etiketleriyle) test edilir — özel bir istisna
  YOK, tek bir tekdüze kural.
- Hiçbir sonuç yoksa: mevcut `EmptyState` (`icon={Search}`, `title="Sonuç bulunamadı"`,
  `description={\`"${query}" ile eşleşen bir klasör yok.\`}`, `className="border-none p-6"` — modal içindeki
  kullanımla aynı sınırsız varyant, panel zaten kendi sınırına sahip).

---

## Karar 6 — Seçim çubuğu + "Klasöre Taşı"

Mevcut seçim çubuğu (`page.tsx` satır 492-508, `Card` içinde "N seçili" + Toplu Sil + CSV Dışa Aktar + Seçimi
Temizle) **birebir korunur**, araya SADECE bir buton eklenir — sıralama: **Toplu Sil, Klasöre Taşı, CSV Dışa
Aktar** (yıkıcı → organizasyonel → dışa aktarma, mevcut soldan-sağa mantıksal öncelik sırası).

```tsx
<DropdownMenu>
  <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
    <FolderInput className="h-4 w-4" />
    Klasöre Taşı
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start">
    <DropdownMenuItem onClick={() => moveTo(null)}>
      <FolderMinus className="h-4 w-4" /> Kategorisiz
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    {flatFolders.map((f) => (
      <DropdownMenuItem key={f.id} onClick={() => moveTo(f.id)} className={f.depth === 1 ? "pl-6" : undefined}>
        <Folder className="h-4 w-4" /> {f.name}
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

- **Bileşen: mevcut `DropdownMenu`** (`media-list-table.tsx`'teki `⋮` menüsüyle AYNI aile) — yeni bir popover
  implementasyonu YAZILMAZ.
- **Buton stili: `variant="outline" size="sm"`** — mevcut "CSV Dışa Aktar" butonuyla (`variant="outline" size="sm"`)
  AYNI ağırlık, "Toplu Sil"in (`variant="destructive"`) yanında görsel olarak daha düşük öncelikli, doğru.
- **Hedef listede alt klasörler `pl-6` ile girintili** (menü içi kısaltılmış girinti, menü genişliği tam ağaç
  genişliği kadar geniş olmadığı için `pl-8` yerine `pl-6` — küçük ölçek farkı kasıtlı, menü bağlamında yeterli).
- **Aktif klasör hedef listede DIŞLANMAZ** — kullanıcı zaten o klasördeki öğeleri görüntülüyor olsa bile "aynı
  klasöre taşı" bir no-op'tur, API zaten sorunsuz kabul eder; UI'da özel bir devre dışı bırakma mantığı EKLENMEZ
  (gereksiz karmaşıklık, backend zaten idempotent).
- **Taşıma sonrası:** `toast.success` ("N görsel taşındı." — mevcut toplu silme/yükleme toast diliyle aynı kalıp),
  seçim TEMİZLENİR (mevcut toplu silme davranışıyla tutarlı), liste yeniden yüklenir.
- **Sticky DEĞİL.** Mevcut seçim çubuğu bugün de sticky değil, bu görev onu sticky yapmaz. Gerekçe: proje
  `admin/layout.tsx`'in `<main>`'i `overflow-hidden` taşıyor ve bu ortamda sadece `sticky bottom-*` deseni
  (settings/nav editörünün "Kaydet" barı) DOĞRULANMIŞ durumda; `sticky top-*` bir seçim çubuğu için burada
  denenmemiş bir risktir (bkz. `design-notes-navigation-menu-editor.md` Karar 7'nin aynı gerekçesi). Mevcut
  akışta zaten çubuk seçildiği anda ekranın üst kısmında beliriyor, kullanıcı fazla kaydırmadan görüyor —
  sorunu çözmeyen bir riski almaya gerek yok.

---

## Karar 7 — Boş klasör durumu ve satır aksiyon menüsü

**Sağ panelde boş klasör (grid alanı):** mevcut `EmptyState` yeniden kullanılır, klasöre özel kopya:
```tsx
<EmptyState
  icon={FolderOpen}
  title="Bu klasörde görsel yok"
  description="Görselleri buraya yükleyerek veya başka bir klasörden taşıyarak ekleyebilirsiniz."
  action={<Button type="button" onClick={() => fileInputRef.current?.click()}>Görsel Yükle</Button>}
/>
```
"Henüz görsel yüklenmedi" (kütüphane TAMAMEN boş) metninden BİLEREK farklı — kullanıcı burada kütüphanenin boş
olmadığını, sadece bu klasörün boş olduğunu anlamalı. Bu klasördeyken yüklenen görsel, seçili klasörün `id`'siyle
yüklenir (§10.11.4 — `POST /admin/media` opsiyonel `folderId` kabul eder), bu yüzden aksiyon butonu ekstra bir
"sonra taşı" adımı gerektirmez.

**Satır aksiyon menüsü (`⋮`, yalnızca gerçek kullanıcı klasörlerinde — sabit girişlerde YOK):**
```tsx
<DropdownMenu>
  <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={`${folder.name} için işlemler`} />}>
    <MoreVertical className="h-3.5 w-3.5" />
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onClick={() => startRename(folder.id)}>
      <Pencil className="h-4 w-4" /> Yeniden Adlandır
    </DropdownMenuItem>
    {depth === 0 && (
      <DropdownMenuItem onClick={() => startCreateChild(folder.id)}>
        <FolderPlus className="h-4 w-4" /> Alt Klasör Ekle
      </DropdownMenuItem>
    )}
    <DropdownMenuItem onClick={() => startMoveFolder(folder.id)}>
      <FolderInput className="h-4 w-4" /> Taşı
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive" onClick={() => setPendingFolderDelete(folder)}>
      <Trash2 className="h-4 w-4" /> Sil
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```
- **"Alt Klasör Ekle" SADECE `depth === 0` satırlarında görünür** — derinlik 2 sınırının UI'da görsel olarak
  zorlanması (backend zaten reddeder ama kullanıcıya seçeneği hiç göstermemek daha iyi bir UX).
- **"Yeniden Adlandır"** satırın kendisini Karar 4'teki AYNI inline-input desenine çevirir (`FolderPlus` yerine
  `Pencil`/mevcut `Folder` ikonu sabit kalır, sadece isim metni `Input`'a döner), Enter kaydeder
  (`PATCH .../folders/{id}`), Escape/blur iptal eder.
- **"Taşı"** (klasörün KENDİSİNİN ebeveynini değiştirmesi — Karar 6'daki MEDYA taşımasıyla KARIŞTIRILMAMALI, o
  ayrı bir akış) alt-menü açar, geçerli hedefler: **"Kök Düzeye Taşı"** (yalnızca klasör zaten `depth === 1`
  ise gösterilir) + **diğer TÜM kök klasörlerin listesi** (yalnızca klasör `depth === 0` ise gösterilir, kendisi
  hariç — derinlik-2 sınırı bir kök klasörün başka bir kök klasörün İÇİNE taşınabilmesini, bir alt klasörün ise
  sadece köke çıkabilmesini/başka bir köke geçebilmesini ima eder, torun oluşturulamaz):
  ```tsx
  <DropdownMenuContent align="end">
    {folder.depth === 1 && (
      <DropdownMenuItem onClick={() => moveFolder(folder.id, null)}>Kök Düzeye Taşı</DropdownMenuItem>
    )}
    {folder.depth === 0 && rootFolders.filter((f) => f.id !== folder.id).map((f) => (
      <DropdownMenuItem key={f.id} onClick={() => moveFolder(folder.id, f.id)}>{f.name} altına taşı</DropdownMenuItem>
    ))}
  </DropdownMenuContent>
  ```
  Kök klasörlerin listesi boşsa (başka kök klasör yoksa) menü öğesi hiç render edilmez, sadece boş bir
  `DropdownMenuContent` kalmasın diye `depth === 0 && rootFolders.length > 1` koşulu eklenir.
- **"Sil"** `ConfirmDialog` (mevcut bileşen) açar, `destructive` prop'u `true`, açıklama METNİ §10.11.3'teki
  ETKİYİ SAYISAL olarak yazar — kontratın kendi önerdiği cümle kalıbı BİREBİR kullanılır:
  ```tsx
  <ConfirmDialog
    open={pendingFolderDelete !== null}
    title="Klasörü sil"
    description={`"${pendingFolderDelete?.name}" klasörünü silmek istediğinize emin misiniz? ${pendingFolderDelete?.mediaCount ?? 0} görsel Kategorisiz'e taşınacak${childCount > 0 ? `, ${childCount} alt klasör en üst seviyeye çıkacak` : ""}.`}
    confirmText="Sil"
    destructive
    onConfirm={handleFolderDelete}
  />
  ```
  `childCount` yalnızca `depth === 0` klasörler için > 0 olabilir (derinlik-1 klasörün çocuğu yok).

---

## Karar 8 — Sürükle-bırak (bonus, opsiyonel) — bırakma hedefi token'ı

Frontend-agent zorlanırsa atlanabilir (kullanıcı onayı) ama hazır token: medya ızgarasındaki bir kartın (mevcut
`page.tsx` grid `Card`'ları) bir klasör satırının ÜZERİNE sürüklenmesi durumunda, o satıra:

```tsx
className={cn(
  baseRowClasses,
  isDropTarget && "bg-primary/10 ring-2 ring-inset ring-primary/60"
)}
```

Bu, dropzone'un mevcut sürükleme-aktif stiliyle (`page.tsx` satır 399: `border-primary bg-primary/5
shadow-md shadow-primary/10`) AYNI aile — yeni bir renk/efekt İCAT EDİLMEDİ, sadece `ring` ile "buraya bırak"
netliği eklendi (satır zaten `rounded-md` olduğu için `ring-inset` kenarlıkların taşmasını önler). Sürüklenen
kartın kendisi `opacity-60` alır (mevcut `nav-tree-row` sürükleme `opacity-50`'sine yakın, tam aynı değil çünkü
bu context bir liste-içi yeniden sıralama değil bir hedefe bırakma — hafif farklı ama aynı "taşınıyor" hissi).
Bırakıldığında `POST /admin/media/move` (§10.11.4) tek elemanlı `mediaIds` dizisiyle çağrılır, seçili birden
fazla öğe varsa (checkbox ile) VE sürüklenen kart seçili öğelerden biriyse TÜM seçim taşınır (mevcut toplu
seçim state'iyle entegrasyon, kontrat zaten bunu destekliyor).

---

## Karar 9 — `MediaPicker` modalı içinde kompakt varyant

**Modal genişliği `max-w-3xl` → `max-w-4xl`'e çıkar** (768px → 896px) — yeni bir sol sütun eklendiği için grid'in
sıkışmaması adına. Diğer tüm modal iskeleti (`design-notes-media-picker.md` madde 1) DEĞİŞMEZ: header, ardından
araç çubuğu (arama + yükle), ardından içerik alanı — sadece içerik alanı artık YATAY olarak ikiye bölünür.

```tsx
<div className="flex min-h-[320px] flex-1 overflow-hidden">
  <div className="w-44 shrink-0 overflow-y-auto border-r border-border p-2">
    <MediaFolderTree compact ... />
  </div>
  <div className="flex-1 overflow-y-auto p-4">
    {/* mevcut grid/EmptyState mantığı DEĞİŞMEDEN, sadece seçili klasöre göre filtrelenmiş `filteredItems` */}
  </div>
</div>
```

- **Genişlik: `w-44` (176px)** — masaüstündeki `w-64`'ten (256px) BİLEREK daha dar; modal zaten sınırlı, `⋮`
  aksiyon menüsü ve "+ Yeni Klasör" burada YOK (aşağıya bkz.), bu yüzden satırların ihtiyaç duyduğu yatay alan
  daha az.
- **`compact` prop'u ne demek — salt-okunur navigasyon, YÖNETİM YOK:**
  - "+ Yeni Klasör" butonu YOK.
  - Satırlarda `⋮` aksiyon menüsü YOK (yeniden adlandırma/silme/taşıma burada sunulmaz).
  - Arama kutusu YOK — modalın kendi arama kutusu zaten var (`design-notes-media-picker.md` madde 4), dosya adı
    aramasıyla klasör aramasını AYNI toolbar'da iki ayrı arama kutusu olarak göstermek kafa karıştırıcı olurdu;
    ~200 klasör sınırı içinde `w-44` genişlikte dikey scroll yeterli.
  - Sürükle-bırak (Karar 8) modalda YOK — modal zaten tek-tık-seç akışı, sürüklemenin faydası burada marjinal.
  - Kalan tek etkileşim: **satıra tıklamak = o klasöre filtrelemek** (grid'i günceller, modalı KAPATMAZ — mevcut
    "bir görsele tıklamak seçer ve kapatır" davranışından FARKLI, çünkü klasöre tıklamak bir seçim değil bir
    filtre).
  - Aynı `MediaFolderTree` component'i, `mode="picker"` (veya eşdeğer bir prop) ile bu davranışları kapatır —
    Karar 1'deki "tek bileşen, birden fazla konteyner" ilkesinin devamı, ayrı bir component YAZILMAZ.
- **Sabit girişler ("Tüm Dosyalar"/"Kategorisiz") modalda da AYNEN bulunur** — kullanıcı yükleme yaptığı an
  hangi klasörde olduğunu (varsayılan: "Tüm Dosyalar") görebilmeli; modal `open` olduğunda varsayılan seçili
  klasör HER ZAMAN "Tüm Dosyalar"dır (modal önceki açılıştaki filtre state'ini hatırlamaz — mevcut modalın
  zaten her açılışta `query`'yi sıfırlayan davranışıyla tutarlı, `design-notes-media-picker.md` "Modal her
  açıldığında güncel listeyi getirir" ilkesi).

---

## Token/Bileşen Özeti — yeni renk YOK, hepsi mevcut token'lara bağlı

| Öğe | Token/Bileşen |
|---|---|
| Panel arka planı | panel ayrı bir `Card` DEĞİL — sayfanın kendi `bg-background`i, satırlar `bg-transparent`/`hover:bg-surface-muted` |
| Aktif klasör satırı | `bg-primary/10 text-primary font-medium` (Badge `tone="primary"` ile AYNI aile) |
| Hover (pasif satır) | `hover:bg-surface-muted hover:text-foreground` |
| İkon (pasif) | `text-foreground/40` |
| Sayaç rozeti | mevcut `Badge tone="neutral" size="sm"` |
| Ayraç (sabit girişler altı) | `border-t border-border/60` |
| İnline oluşturma/yeniden adlandırma satırı | `border-primary/40 bg-primary/5`, ikon `text-primary` |
| Sürükle-bırak hedef vurgusu | `bg-primary/10 ring-2 ring-inset ring-primary/60` (dropzone'un `border-primary bg-primary/5` ailesiyle aynı) |
| Arama/aksiyon menüleri | mevcut `InputGroup`/`DropdownMenu`/`ConfirmDialog`/`EmptyState`/`Sheet` — YENİ bileşen YOK |

Hiçbir yeni `--*` CSS custom property tanımlanmaz; `.dark .admin-shell` bloğu zaten tüm bu token'ları kapsıyor,
bu yüzden ek bir dark-mode kontrol adımı gerekmez.

---

## Özet — frontend-agent için uygulama kontrol listesi

1. Paylaşılan `MediaFolderTree` component'i (öneri: `frontend/src/components/admin/media/media-folder-tree.tsx`)
   — props: `folders` (düz dizi, `parentId`/`mediaCount` ile, API'nin döndüğü sıra), `selectedFolderId`,
   `onSelectFolder`, `totalCount`, `uncategorizedCount`, `mode?: "manage" | "picker"` (default `"manage"`).
   `mode="picker"` iken `⋮`/"+ Yeni Klasör"/arama/sürükle-bırak GİZLENİR (Karar 9).
2. `/admin/media/page.tsx`: `flex flex-col gap-6 lg:flex-row` kabuğu, sol panel `hidden lg:block lg:w-64
   lg:sticky lg:top-6`, mobilde `Sheet side="left"` + tetikleyici buton (Karar 1). Girinti `pl-3`/`pl-8`
   (Karar 2), sabit girişler + ayraç (Karar 3), inline "+ Yeni Klasör" (Karar 4), arama kutusu (Karar 5).
3. Seçim çubuğuna `DropdownMenu` tabanlı "Klasöre Taşı" eklenir (Karar 6), STICKY YAPILMAZ.
4. Satır `⋮` menüsü: Yeniden Adlandır (inline), Alt Klasör Ekle (yalnızca `depth===0`), Taşı (alt-menü), Sil
   (`ConfirmDialog`, §10.11.3 metniyle) — Karar 7.
5. Boş klasör durumu: `EmptyState` özel kopyayla (Karar 7).
6. (Opsiyonel) Sürükle-bırak: `ring-2 ring-inset ring-primary/60` hedef vurgusu (Karar 8).
7. `MediaPicker`: `max-w-3xl` → `max-w-4xl`, içerik alanı `flex` ile `w-44` `MediaFolderTree mode="picker"` +
   mevcut grid (Karar 9).
8. Hiçbir yeni renk token'ı tanımlanmaz — Token Özeti tablosundaki mevcut değerler kullanılır.
