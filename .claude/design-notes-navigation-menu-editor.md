# Tasarım Notları: `/admin/navigation` Menü Düzenleyici

Ajan: ui-designer
Kapsam: Sadece tasarım/UX kararları. Kod implementasyonu **frontend-agent**'a aittir.
Referans (oku, tekrar icat etme): `frontend/src/app/admin/settings/page.tsx` (sekme + kaydedilmemiş-değişiklik deseni),
`frontend/src/app/admin/navigation/page.tsx` (mevcut `SectionCard`/`RowActions`/`HREF_HINT` yapısı — büyük ölçüde KORUNUYOR),
`.claude/design-notes-media-picker.md` (arama/boş-durum/seçim mikro-desenleri), `.claude/design-notes-account-page.md`
(Karar 1 — proje geneli **Minimal/Flat** görsel yön teyidi).

**Görsel yön:** Bu proje **Minimal/Flat** çizgide — `Card` (`bg-surface/70 border-border/60 backdrop-blur-xl`),
`admin-h1/h2/body/text-secondary` tipografi ölçeği, `--primary/--danger/--success/--warning` CSS custom property
token'ları. Glassmorphism/glow (bento) estetiği bu sayfaya **taşınmaz** — `admin/settings/page.tsx` da zaten aynı
`Card` token sistemine geçmiş durumda (kontrol edildi, satır 306-477), o yüzden "ayarlar bento'dur" varsayımıyla
hareket eden eski notlar (`design-notes-admin-gaps.md`, `design-notes-light-theme-and-new-page.md` §J.2) bu sayfa için
**geçerli referans değil** — güncel `settings/page.tsx` esas alınmıştır.

---

## Karar 0 — ÖNCELİKLİ ESKALASYON: iç-içe (nested) menü öğeleri için API kontratı eksik

**Bu benim karar alanım değil, architect'e devrediyorum — ama frontend-agent'ın bu dokümanı uygulamaya
başlamadan ÖNCE bilmesi gereken bir blokaj olduğu için en üste yazıyorum.**

`docs/architecture/openapi.yaml` içindeki `NavigationItem` şeması (satır ~4537-4541) ve
`UpdateNavigationConfigRequest.navigationItems` (satır ~4602-4607) şu an **düz** (`id, label, href, order`) —
ebeveyn/çocuk ilişkisini taşıyacak bir `parentId`/`parentIndex` alanı YOK. `POST` tarafı da "tam değiştirme
(delete-then-recreate)" semantiğinde ve istemciden `id` göndermiyor (sunucu yeniden üretiyor) — yani mevcut
kontratla bir öğeyi başka bir öğenin **altına** kaydetmenin hiçbir yolu yok.

Bu görevde tanımladığım sürükle-bırakla iç-içe geçirme (Karar 4-5) **görsel olarak** çalışabilir ama "Kaydet"
sonrası kalıcı olamaz — architect'in `NavigationItem`'a bir alan eklemesi gerekiyor. Öneri (architect'in kararı,
ben sadece pratik bir şekil öneriyorum): request zaten dizi-index tabanlı (`order`) çalıştığı için `id` yerine
**aynı istek içindeki index'e referans veren** bir alan daha tutarlı olur:

```yaml
navigationItems:
  items:
    type: object
    properties:
      label: { type: string }
      href: { type: string }
      order: { type: integer }
      parentIndex: { type: integer, nullable: true }  # aynı navigationItems dizisi içinde ebeveynin index'i; null = kök seviye
```

**frontend-agent için:** Bu alan eklenene kadar (db-agent migration + backend-agent servis katmanı + architect
onayı), iç-içe geçirmeyi **sadece client-side local state'te** tutup kaydetmeyi engelleyebilir (örn. Kaydet
butonunu derinliği >0 olan öğe varken devre dışı bırakıp bir `Alert variant="warning"` ile açıklayabilir) YA DA
architect'ten bu alanı önce ekletebilir. Bu karar frontend-agent/architect'e ait, ben sadece görsel/etkileşim
tarafını (Karar 4-5) tanımlıyorum — o kararlar `parentIndex` alanı geldiğinde birebir uygulanabilir durumda.

---

## Karar 1 — İki sekmeli üst yapı ve içerik dağılımı

`settings/page.tsx` deseni **birebir** taşınır: `Tabs` + `TabsList variant="line"` + `activeTab` state + sekme
başlığında kirli-durum noktası (`bg-warning` dot) + sekme değişiminde `window.confirm` engeli.

```tsx
<Tabs value={activeTab} onValueChange={(value) => {
  const nextTab = String(value);
  if (hasUnsavedChangesForTab(activeTab) && nextTab !== activeTab) {
    if (!window.confirm(UNSAVED_CHANGES_WARNING)) return;
  }
  setActiveTab(nextTab);
}}>
  <TabsList variant="line">
    <TabsTrigger value="menus">
      <ListTree className="h-3.5 w-3.5" />
      Menüleri Düzenle
      {menuHasUnsavedChanges && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />}
    </TabsTrigger>
    <TabsTrigger value="locations">
      <LayoutTemplate className="h-3.5 w-3.5" />
      Konumları Yönet
      {locationsHasUnsavedChanges && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />}
    </TabsTrigger>
  </TabsList>
  ...
</Tabs>
```

**Genelleme notu (settings'ten farkı):** `settings/page.tsx`'te uyarı sadece "general" sekmesinden çıkarken
tetikleniyordu çünkü diğer iki sekme (`security`, `integrations`) salt-okunur/kendi kaydetme akışına sahip.
Burada **her iki sekme de** düzenlenebilir ve TEK bir "Kaydet" ile birlikte gönderiliyor (Karar 7) — o yüzden
kural genelleştirildi: **hangi sekmeden ayrılırsa ayrılsın, o sekmenin kendi `hasUnsavedChanges`'i true ise**
`window.confirm` tetiklenir. İki ayrı dirty-flag (`menuHasUnsavedChanges`, `locationsHasUnsavedChanges`)
tutulmalı — settings'teki tek `hasUnsavedChanges`'in ikiye bölünmüş hali, ikon rozetlerinin hangi sekmede
değişiklik olduğunu ayrı ayrı göstermesi için gerekli (kullanıcı hangi sekmede ne değiştirdiğini görsün).

İkon: `ListTree` (lucide-react, ağaç/hiyerarşi çağrışımı — "Menüleri Düzenle" için), `LayoutTemplate`
(mevcut `PageHeading` ikonuyla aynı — "Konumları Yönet" için, çünkü bu sekme eski sayfanın header/footer/logo
kapsamının devamı).

**İçerik dağılımı (kullanıcı talimatı doğrulandı):**

| Sekme | İçerik |
|---|---|
| **Menüleri Düzenle** | Yalnızca menü yapısı editörü (Karar 2-6) — başka hiçbir bölüm yok. |
| **Konumları Yönet** | Logo & Marka (`siteName` + `ImageUploadField logoUrl`), Header CTA, Footer (telif metni + Sosyal Medya Linkleri + Footer Sütunları) — mevcut `SectionCard` bloklarının **birebir aynısı**, sadece bir `TabsContent value="locations"` içine taşınıyor. |

`PageHeading`'in `actions` prop'undaki mevcut "Kaydet" butonu **kaldırılır** — Karar 7'deki sabit alt bar tek
kaydetme giriş noktası olur (bu, `settings/page.tsx`'in de PageHeading'inde `actions` OLMAMASIYLA tutarlı).

---

## Karar 2 — "Menüleri Düzenle" iki panelli layout

```
┌─ Card: "İçerik Ekle" ──────────┐  ┌─ Card: "Menü Yapısı" ──────────────────────┐
│ [Accordion: Sayfalar (12)]      │  │  Boş durum YOKSA:                          │
│ [Accordion: Blog Yazıları (4)]  │  │  ┌ [⠿] Anasayfa                    ˅ ┐    │
│ [Accordion: Ürünler (8)]*       │  │  ┌ [⠿] Hakkımızda                  ˅ ┐    │
│ [Accordion: Portföy (5)]*       │  │  │  ┊ [⠿] Ekibimiz          ˅   │        │
│ [Accordion: Özel Bağlantılar]   │  │  │  ┊ [⠿] Tarihçemiz        ˅   │        │
└──────────────────────────────────┘  │  ┌ [⠿] İletişim                     ˅ ┐    │
                                      └──────────────────────────────────────────┘
* yalnızca ilgili modül (`useModules().isModuleEnabled`) açıksa render edilir.
```

**Yerleşim:** `<div className="flex flex-col gap-6 lg:flex-row lg:items-start">`.
- Sol panel: `<div className="w-full lg:sticky lg:top-6 lg:w-[340px] lg:shrink-0">` — `340px` sabit genişlik
  (kullanıcı sınırı 320-380px içinde; 340px seçildi çünkü içerik başlığı + sayaç rozeti + chevron tek satırda
  sıkışmadan sığıyor, `Card`'ın varsayılan `p-6` iç boşluğuyla birlikte). `lg:sticky lg:top-6` — bu panel bir
  "seçim kaynağı" olduğu için sayfa kaydırılırken sabit kalması, ağaç uzadıkça kullanıcının sürekli yukarı
  kaydırmasını engeller (mevcut Canlı Önizleme panelinin de kullandığı `lg:sticky lg:top-6` deseniyle aynı).
- Sağ panel: `<div className="min-w-0 flex-1">` — kalan tüm genişlik, ağaç yapısı.
- Mobilde (`< lg`) sıralama DOM sırasıyla aynı: önce içerik seçici, sonra ağaç (kaynağı önce görmek mantıklı).

### 2.1 — Sol panel: içerik türü accordion'ları

Projede henüz bir `Accordion` bileşeni yok (`components/ui/accordion.tsx` YOK, grep ile doğrulandı) ama
`@base-ui/react/accordion` bağımlılığı zaten mevcut (`package.json`, `tabs.tsx`'in `@base-ui/react/tabs`'ı
sardığı YÖNTEMLE aynı yöntemle sarılmalı — `data-slot`, `cn`, gerekiyorsa `cva`). **frontend-agent bu wrapper'ı
`components/ui/accordion.tsx` olarak, `tabs.tsx`'teki desenin birebir aynısında oluşturmalı** (kesin
`data-*` attribute adları için `node_modules/@base-ui/react/accordion/index.d.ts` kontrol edilmeli — burada
tahmin edilen değil, doğrulanmış attribute adları kullanılmalı).

- `Accordion type="multiple"` — birden fazla bölüm aynı anda açık kalabilir (kullanıcı hem Sayfalar hem
  Blog'dan seçim yapmak isteyebilir, `type="single"` bunu engellerdi).
- Varsayılan açık bölüm: **"Sayfalar"** (en sık kullanılan içerik türü, WordPress'in "Görünüm > Menüler"
  ekranında da Sayfalar paneli varsayılan açık gelir — bilinen genel WP paterni, makul varsayım).
- Her `AccordionItem` başlığı (`AccordionTrigger`):
  ```tsx
  <span className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-foreground">
    <FileText className="h-4 w-4 shrink-0 text-foreground/50" />
    <span className="flex-1 text-left">Sayfalar</span>
    <Badge tone="neutral" size="sm">{items.length}</Badge>
    <ChevronDown className="h-4 w-4 shrink-0 text-foreground/40 transition-transform duration-200 [[data-open]_&]:rotate-180" />
  </span>
  ```
  (`[[data-open]_&]` gerçek attribute adıyla değiştirilmeli — bkz. yukarıdaki doğrulama notu.)
- İkon eşlemesi (tek kaynak `lucide-react`, sidebar'daki (`components/admin/sidebar.tsx`) ikonlarla BİREBİR
  aynı — kullanıcı aynı içerik türünü admin genelinde hep aynı ikonla tanısın):
  Sayfalar → `FileText`, Blog Yazıları → `Newspaper`, Ürünler → `ShoppingBag`, Portföy → `Briefcase`,
  Özel Bağlantılar → `Link2`.
- **Panel içeriği (Sayfalar / Blog Yazıları / Ürünler / Portföy — checkbox listesi):**
  - Yalnızca **yayındaki** (`status: "PUBLISHED"`) içerikler listelenir — mevcut `publishedPages` filtrelemesiyle
    aynı mantık, diğer üç içerik türü için de aynı kurala tabi (frontend-agent veri katmanı kararı, tasarım
    kuralı: taslak/arşiv içerik BU listede hiç görünmez, ayrı bir "taslak" rozetiyle de gösterilmez — sadeleştirme).
  - **>10 öğe varsa** arama kutusu, panel içeriğinin EN ÜSTÜNDE: `InputGroup` + `InputGroupAddon><Search/>` +
    `InputGroupInput placeholder="Ara…"` — `admin/pages/page.tsx` satır ~111-121 ile aynı bileşen deseni,
    `w-full` (sol panel zaten dar, `max-w-xs` gerekmiyor). ≤10 öğede arama kutusu YOK (gereksiz gürültü).
  - Liste alanı: `<div className="max-h-56 space-y-0.5 overflow-y-auto">` (224px ≈ 6-7 satır önce scroll
    başlar).
  - Her satır:
    ```tsx
    <label className={cn(
      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
      alreadyInMenu ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-surface-muted"
    )}>
      <Checkbox checked={alreadyInMenu || selected.has(item.id)} disabled={alreadyInMenu}
                onCheckedChange={(v) => toggle(item.id, v)} />
      <span className="flex-1 truncate text-foreground">{item.title}</span>
      {alreadyInMenu && <Badge tone="neutral" size="sm">Eklendi</Badge>}
    </label>
    ```
    `alreadyInMenu`: bu içeriğin `href`'i (`/${slug}`, `/blog/${slug}`, `/products/${slug}`, `/portfolio/${slug}`
    — `frontend/src/app/(site)/**` route yapısıyla doğrulandı) ağaçtaki (kök + alt) herhangi bir öğenin
    `href`'iyle **birebir eşleşiyorsa** true — yinelenen bağlantı eklenmesini önler, checkbox disabled + işaretli
    gösterilir, "Eklendi" rozeti (`tone="neutral"`, aynı `Badge` bileşeni, admin genelinde nötr durum rengi).
  - Boş liste (yayında hiç içerik yok): `<p className="px-2 py-3 text-xs text-foreground/50">Yayında içerik yok.</p>`
    — mevcut dosyadaki "Henüz menü öğesi yok." mikro-kopya diliyle aynı ton.
  - Bölüm altında: `<Button type="button" variant="secondary" size="sm" disabled={selected.size === 0}>
    <Plus className="h-4 w-4" /> Menüye Ekle</Button>` — tıklanınca seçili tüm öğeler **kök seviyeye, listenin
    SONUNA** yeni satırlar olarak eklenir (`label = item.title`, `href` yukarıdaki route deseni), o bölümün
    `selected` seçimi TEMİZLENİR (aynı oturumda tekrar seçim yapılabilsin diye), accordion açık kalır (kapanmaz).
- **Panel içeriği (Özel Bağlantılar — manuel giriş, checkbox YOK):**
  ```tsx
  <div className="space-y-2 px-1 py-2">
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-foreground/70">Etiket</label>
      <Input value={customLabel} onChange={...} placeholder="Ör. Kampanyalar" />
    </div>
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-foreground/70">Bağlantı</label>
      <Input value={customHref} onChange={...} placeholder="/kampanyalar" />
    </div>
    <p className="text-xs text-foreground/50">{HREF_HINT}</p>
    <Button type="button" variant="secondary" size="sm"
            disabled={!customLabel.trim() || !customHref.trim()}>
      <Plus className="h-4 w-4" /> Ekle
    </Button>
  </div>
  ```
  `HREF_HINT` mevcut dosyadaki sabitin AYNISI (satır 23-24), yeniden yazılmaz. "Ekle" (içerik bölümlerindeki
  "Menüye Ekle"den kasıtlı olarak farklı metin — burada tek bir manuel kayıt ekleniyor, "menüye" ekstra kelimesi
  gereksiz) tıklanınca kök seviyenin sonuna yeni satır eklenir VE her iki input **temizlenir** (ardışık birden
  çok özel bağlantı eklemeyi kolaylaştırır — MediaPicker'ın "yükle-ve-otomatik-seç" akışındaki gibi sürtünmesiz
  tekrar-eklenebilirlik ilkesi).

---

## Karar 3 — Sağ panel: ağaç satırı ve "satır-içi accordion" düzenleme

Mevcut düz liste editörü (label/href input'ları + `RowActions`) **kavramsal olarak korunur** ama artık her
satır varsayılan olarak DARALTILMIŞ görünür, sadece etiket gösterir; düzenleme alanları sağdaki chevron'a
tıklanınca açılır (kullanıcı talimatı: "accordion-in-row" deseni).

**Daraltılmış satır (varsayılan görünüm):**
```tsx
<div ref={setNodeRef} style={style} className={cn(
  "flex items-center gap-2 rounded-lg border border-border/60 bg-surface px-3 py-2.5 transition-colors",
  "hover:border-border hover:bg-surface-muted",
  isDragging && "opacity-50"
)}>
  <button {...attributes} {...listeners} aria-label={`Sürükle: ${item.label || "Adsız öğe"}`}
          className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/40 hover:bg-surface-muted hover:text-foreground/70 active:cursor-grabbing">
    <GripVertical className="h-4 w-4" />
  </button>
  <span className="flex-1 truncate text-sm font-medium text-foreground">{item.label || "Adsız öğe"}</span>
  <span className="hidden max-w-[160px] truncate text-xs text-foreground/40 sm:inline">{item.href}</span>
  <Button type="button" variant="ghost" size="icon-xs" aria-label="Girinti azalt (üst seviyeye taşı)"
          disabled={depth === 0} onClick={() => outdent(item.id)}>
    <ChevronLeft className="h-3.5 w-3.5" />
  </Button>
  <Button type="button" variant="ghost" size="icon-xs" aria-label="Girinti artır (alt öğe yap)"
          disabled={!canIndent} onClick={() => indent(item.id)}>
    <ChevronRight className="h-3.5 w-3.5" />
  </Button>
  <Button type="button" variant="ghost" size="icon-xs" aria-label={editOpen ? "Düzenlemeyi kapat" : "Düzenle"}
          aria-expanded={editOpen} onClick={() => setEditOpen((v) => !v)}>
    <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", editOpen && "rotate-180")} />
  </Button>
</div>
{editOpen && (
  <div className="mt-1 space-y-3 rounded-lg border border-border/60 bg-surface-muted/40 p-3">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-foreground/70">Etiket</label>
        <Input value={item.label} onChange={...} placeholder="Ör. Hakkımızda" />
      </div>
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-foreground/70">Bağlantı</label>
        <Input value={item.href} onChange={...} placeholder="/hakkimizda" />
      </div>
    </div>
    <p className="text-xs text-foreground/50">{HREF_HINT}</p>
    <Button type="button" variant="destructive" size="sm" onClick={() => remove(item.id)}>
      <Trash2 className="h-4 w-4" /> Kaldır
    </Button>
  </div>
)}
```

- **`outdent`/`indent` butonları — a11y gerekçesi (WP'de böyle bir buton YOK, bu benim eklemem):** modern
  drag-and-drop'un klavye eşdeğeri yalnızca dnd-kit'in `KeyboardSensor`'ü ile SIRALAMA (yukarı/aşağı) sağlar;
  YATAY derinlik değişimi (nesting) dnd-kit'in varsayılan klavye koordinat mantığında YOKTUR. Sürükleme
  kullanamayan (klavye/switch-control) bir kullanıcının hiçbir şekilde alt öğe oluşturamaması kabul edilemez —
  bu yüzden her satırda her zaman görünür, bağımsız `indent`/`outdent` butonları ekleniyor. Bu WCAG AA'nın
  "sürükle-bırağın klavye eşdeğeri olmalı" ilkesinin doğrudan uygulanışı.
- **`indent` kuralı:** yalnızca bir öğe kök seviyede (`depth === 0`) VE listede kendisinden önce başka bir kök
  öğe varsa aktif olur (`canIndent = depth === 0 && index > 0`); tıklanınca o öğe, **hemen üstündeki kök
  öğenin çocuk listesinin SONUNA** taşınır. Zaten `depth === 1` olan (çocuk) bir öğenin `indent` butonu HER ZAMAN
  disabled — maksimum derinlik 2 seviye (Karar 4).
- **`outdent` kuralı:** yalnızca `depth === 1` iken aktif; tıklanınca öğe kök listesine, **eski ebeveyninin kök
  listesindeki konumunun HEMEN ARDINDAN** eklenir (görsel sıçrama olmasın diye — kullanıcı öğeyi nerede
  gördüyse, un-nest sonrası da o civarda kalsın).
- Href hint metni satırda `sm:` altında gizli (`hidden sm:inline`) — dar ekranda gürültü yaratmasın, zaten
  düzenleme panelinde tam görünür.
- **Düzenleme paneli animasyonsuz, düz koşullu render** (framer-motion height/opacity YOK) — kasıtlı: bu
  panel bir dnd-kit `SortableContext` içinde, satır yüksekliği aniden değiştiğinde (accordion açılırken)
  dnd-kit'in sürükleme sırasında yaptığı layout ölçümleriyle çakışma riski var; `.claude/design-notes-light-theme-and-new-page.md`
  §H.3'teki SEO disclosure'ın aksine burada güvenlik için animasyon feda ediliyor (küçük bir UX kaybı,
  sürükle-bırak bütünlüğü için kabul edilebilir).
- **`Kaldır` = `variant="destructive"`, ONAY DİYALOĞU YOK.** Gerekçe: tüm ağaç zaten "taslak" durumda,
  sayfanın tamamı tek bir "Kaydet" ile persist ediliyor (Karar 7) — yanlışlıkla kaldırılan bir öğe, "Kaydet"e
  basılmadığı sürece geri getirilebilir/yeniden eklenebilir; mevcut dosyadaki `RowActions`'ın `Sil` butonu da
  zaten onaysız (satır 116-118) — tutarlılık korunuyor, sadece görsel ağırlık (`ghost` → `destructive`) artıyor
  çünkü artık ayrı, etiketli bir buton (ikon-only değil), "bu kalıcı bir eylem" hissi vermesi daha doğru.

---

## Karar 4 — Girinti (indent) ölçüsü ve maksimum derinlik: **32px / seviye, maksimum 2 seviye (kök + 1 alt)**

- **Maksimum derinlik: 2 seviye** (kök öğeler + onların doğrudan çocukları). Torun (3. seviye) YOK. Bu bir
  basitleştirme kararı (makul varsayım, ekran görüntüsü olmadığı için) — kullanıcının verdiği örnek
  ("Ahşap Banyo Dolapları Modelleri" gibi alt öğeler) tek seviyelik bir alt-kırılım öneriyor, üç seviye
  gereksinimi ima etmiyor. Sınırsız derinlik hem dnd-kit projeksiyon mantığını hem de görsel girintiyi
  orantısız karmaşıklaştırır; küçük/orta ölçekli site header/footer menüleri için 2 seviye yeterli.
- **Girinti birimi: 32px** (kullanıcının önerdiği `pl-8` aralığında). Uygulama şekli — tek bir satırın
  `padding-left`'i DEĞİL, bir ebeveynin TÜM çocuklarını saran ortak bir konteyner:
  ```tsx
  {item.children.length > 0 && (
    <div className="relative ml-3 space-y-2 border-l border-dashed border-border/60 pl-5">
      {item.children.map((child) => <TreeRow key={child.localId} item={child} depth={1} />)}
    </div>
  )}
  ```
  `ml-3` (12px, ebeveyn satırının sürükle tutamacı hizasından başlayan ince boşluk) + `pl-5` (20px, çizgiyle
  satır içeriği arası boşluk) = **toplam 32px** girinti — kullanıcının istediği net değer, tek bir sayı olarak
  hesaplanabilir/uygulanabilir.
- **Hiyerarşi bağlantı çizgisi:** `border-l border-dashed border-border/60` — TÜM bir ebeveynin çocuk grubunu
  saran konteynerin sol kenarında, kesikli (`dashed`), `--border` token'ının `/60` opaklığı (hem light hem
  dark temada otomatik doğru kontrast, `--border` zaten tema-duyarlı). Düz (`solid`) değil kesikli seçildi —
  WP'nin klasik "ağaç dalı" çizgisiyle görsel referansı korurken, kesikli çizgi kalıcı bir yapısal element
  değil "bu bir gruplama" ipucu hissi verir (daha hafif, daha az "kutulanmış" görünür).

---

## Karar 5 — Sürükle-bırakla iç-içe geçirme (nesting) davranışı

dnd-kit'in resmi **"Sortable Tree"** örneğindeki (`@dnd-kit/sortable` storybook / docs örneği —
`getProjection` fonksiyonu) izdüşüm (projection) mantığı referans alınır. frontend-agent bu örneği bulup
uyarlamalı; aşağıdaki kurallar o mantığın BU projeye özel (maks. derinlik 2, girinti birimi 32px) somutlaştırılmış
hâlidir:

1. **Ağaç önce düzleştirilir (flatten).** İç içe `LocalTreeNavItem[]` (kök + `children`) yapısı, render/DnD
   sırasında `{ id, label, href, depth, parentId }[]` düz bir diziye çevrilir (depth-first sıralama, kök
   öğeler `depth: 0`, çocukları hemen ardından `depth: 1`). `SortableContext` bu düz dizi üzerinde çalışır.
2. **Dikey konum → EKLEME NOKTASI.** Sürüklenen satır başka satırların üzerinden geçerken, hedef satırın üst
   yarısına mi alt yarısına mı geldiği standart dnd-kit `arrayMove` mantığıyla eklenecek sıra pozisyonunu
   belirler (bu kısım dnd-kit'in varsayılan sortable davranışı, özel bir kural gerekmiyor).
3. **Yatay sürükleme mesafesi → PROJELENEN DERİNLİK.** Sürükleme sırasında imlecin başlangıç X konumuna göre
   yatay farkı (`dragOffset.x`) izlenir; her **32px** sağa hareket projelenen derinliği +1 artırır, her 32px
   sola hareket -1 azaltır (`getProjection`'daki `indentationWidth = 32` parametresi). Bu değer şu aralıkla
   KIRPILIR (clamp):
   - **Alt sınır: 0** (kök seviyenin altına inilemez).
   - **Üst sınır:** eklenecek pozisyondan hemen ÖNCEKİ öğenin (`previousItem`) derinliği + 1, AMA hiçbir zaman
     Karar 4'teki **maksimum 1**'i (yani toplam 2 seviye) aşamaz. Yani `projectedDepth = clamp(rawProjected, 0, min(previousItem.depth + 1, 1))`.
   - Ek kural: **sürüklenen öğenin kendi çocukları varsa, projelenen derinlik her zaman 0'da sabitlenir**
     (yani bir çocuğu olan öğe hiçbir zaman başka bir öğenin altına taşınamaz) — bu, torun (3. seviye)
     oluşmasının TEK garantili engelleyicisi, yatay-mesafe kırpması tek başına yeterli değil çünkü sürüklenen
     öğenin kendi alt-ağacının derinliğini hesaba katmıyor.
4. **Bırakma göstergesi (drop indicator):** eklenecek pozisyonda, `projectedDepth`'e göre SOLA/SAĞA kayan ince
   bir çizgi:
   ```tsx
   <div
     className="pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary before:absolute before:-left-1 before:-top-[3px] before:h-2 before:w-2 before:rounded-full before:bg-primary"
     style={{ marginLeft: projectedDepth * 32 }}
   />
   ```
   — sol uçta küçük bir daire (`before:`) + yatay çizgi (Linear/Notion'da alışılan "bırakma çizgisi" dili).
   Renk `bg-primary` (proje genelinde etkileşim/odak rengi zaten bu token).
5. **Sürüklenen satırın kendisi:** liste içindeki orijinal konumunda `opacity-50` (yer tutucu gibi), gerçek
   görsel `DragOverlay` (dnd-kit) ile imleci takip eder: `rounded-lg border border-border bg-surface px-3 py-2.5
   shadow-lg ring-2 ring-primary/40` — `MediaPicker`'ın hover/seçili durumundaki `ring-2 ring-primary/50`
   diliyle tutarlı bir "kaldırılmış/aktif" hissi.
6. **Bırakıldığında:** `projectedDepth === 0` ise öğe (ve varsa TÜM alt öğeleriyle birlikte, ama Karar 5.3
   zaten çocuklu öğelerin derinlik 1'e taşınmasını engellediği için bu senaryoda alt öğe taşınmaz) kök listesine
   eklenir; `projectedDepth === 1` ise, eklenecek pozisyondan hemen önceki kök-seviye öğenin `children`
   dizisinin SONUNA eklenir.
7. **Sensörler:** `PointerSensor` (`activationConstraint: { distance: 6 }` — satırdaki `indent`/`outdent`/
   `Kaldır`/checkbox gibi tıklanabilir küçük butonlarla yanlışlıkla sürükleme başlamasını önlemek için küçük
   bir eşik) + `KeyboardSensor` (dnd-kit'in `sortableKeyboardCoordinates`'i — SADECE dikey sıralama için;
   yatay derinlik değişimi klavye kullanıcıları için Karar 3'teki `indent`/`outdent` butonlarıyla sağlanıyor,
   DnD'nin kendi klavye modundan BAĞIMSIZ).

---

## Karar 6 — Boş durum (sağ panel, hiç menü öğesi yokken)

Mevcut `EmptyState` bileşeni (`components/ui/empty-state.tsx`) KULLANILIR, yeniden icat edilmez:

```tsx
<EmptyState
  icon={ListTree}
  title="Menü öğesi yok"
  description="Soldaki panelden bir sayfa, yazı ya da özel bağlantı seçip “Menüye Ekle” butonuna tıklayın."
/>
```

`action` prop'u BOŞ bırakılır — eylemin kendisi zaten sol panelde, `EmptyState` içine ikinci bir "Ekle" butonu
koymak iki farklı yerden aynı eylemi tetikleyen kafa karıştırıcı bir kısayol yaratır (sol panel zaten birincil
giriş noktası). İkon `ListTree` — sekme başlığıyla (Karar 1) aynı ikon, "burası menü ağacı" mesajını pekiştirir.

---

## Karar 7 — Sabit "Kaydet" alt barı

`settings/page.tsx`'teki floating-card deseni (`sticky bottom-6 z-10 flex justify-end` + `Card`) **AYNEN**
kullanılır — yeni bir "tam genişlik bar" İCAT EDİLMEZ. Gerekçe: `admin/layout.tsx`'teki `<main>` elemanı
`overflow-hidden` (satır 45) taşıyor; settings sayfasındaki sticky-card deseni bu ortamda ÇALIŞTIĞI KANITLANMIŞ
tek desen (üretimde zaten çalışıyor) — tam genişlik, negatif-margin ("full-bleed") bir bar denemek doğrulanmamış
bir risk taşır ve bu görevin kapsamında bunu test edecek bir çalıştırma ortamı yok. "Sayfa altında sabit"
gereksinimi zaten `sticky bottom-*` ile karşılanıyor, "tam genişlik" olması şart değil.

```tsx
<motion.div
  initial={{ opacity: 0, y: 24 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: 0.3, duration: 0.4 }}
  className="sticky bottom-6 z-10 flex justify-end"
>
  <Card className="flex items-center gap-3 p-3 shadow-lg">
    {(menuHasUnsavedChanges || locationsHasUnsavedChanges) && !saving && (
      <span className="flex items-center gap-1.5 text-xs text-warning">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
        Kaydedilmemiş değişiklikler var
      </span>
    )}
    {saving && <span className="text-xs admin-text-secondary">Kaydediliyor…</span>}
    <Button type="button" loading={saving} onClick={handleSave}>Kaydet</Button>
  </Card>
</motion.div>
```

**settings'ten TEK fark:** bu blok `settings/page.tsx`'te SADECE `TabsContent value="general"` içindeydi
(çünkü sadece o sekme düzenlenebilirdi). Burada **her iki sekme de düzenlenebilir olduğu için bu blok
`<Tabs>`'ın DIŞINDA/ALTINDA, kardeş bir eleman olarak** render edilir — hangi sekme aktifse aktif olsun her
zaman görünür, birleşik `hasUnsavedChanges` (iki dirty-flag'in OR'u) ile tetiklenir, TEK bir `handleSave()`
her iki sekmenin verisini birlikte gönderir (mevcut dosyanın zaten yaptığı `Promise.all([updateSettings,
updateNavigationConfig])` deseni KORUNUR).

---

## Karar 8 — Canlı Önizleme'nin yeni konumu

**Yalnızca "Konumları Yönet" sekmesinde**, sağda sabit (`lg:sticky lg:top-6`) panel olarak KALIR — mevcut
`grid-cols-[1fr_420px]` iki-sütun yerleşimi, mevcut `SiteHeader`/`SiteFooter` render mantığı DEĞİŞMEDEN bu
sekmenin içine taşınır.

**"Menüleri Düzenle" sekmesinde Canlı Önizleme YOK.** Gerekçe:
- O sekme zaten iki panel kullanıyor (içerik seçici 340px + ağaç, kalan genişlik) — üçüncü bir 420px önizleme
  sütunu eklemek, tipik bir dizüstü ekranda (`1280-1440px`) üç sütunun sıkışmasına/anlamsız daralmasına yol
  açar.
- Ağacın kendisi zaten yapının "önizlemesi" — girintili/etiketli liste, header'da menünün nasıl görüneceğini
  (sıra + hiyerarşi) `SiteHeader`'ın düz metin linkler satırından DAHA AÇIK gösteriyor (`SiteHeader` şu an
  alt menüleri/dropdown'ları hiç render etmiyor — bkz. aşağıdaki not — o yüzden bu sekmede önizleme zaten
  eksik/yanıltıcı bilgi verirdi).
- **Not (bilgi amaçlı, bu görevin kapsamı DIŞINDA):** `frontend/src/components/site/site-header.tsx`'in mevcut
  `navLinks` mantığı (satır 22-25) DÜZ bir liste üretiyor, `NavigationItemDto`'da zaten `children`/`parentId`
  yok (Karar 0) — yani iç-içe menüler API'ye eklense bile, `SiteHeader`'ın bunları bir dropdown olarak
  render etmesi AYRI bir frontend-agent görevi. Bu doküman o implementasyonu KAPSAMIYOR, sadece admin
  editör tarafını tanımlıyor.

**Logo önizleme bug'ı hakkında (bilgi amaçlı, ben DÜZELTMİYORUM):** `site-header.tsx` satır 36-38 şu an
`h-8 w-8 rounded object-contain` kullanıyor, `image-upload-field.tsx` satır 77-88 önizlemesi `h-32 w-full
rounded-md ... object-cover` (kare mod) — ikisi de sınırlı/`object-fit` uygulanmış class'lara sahip, kod
okumasında bariz bir "sınırsız taşma" bug'ı GÖRÜNMÜYOR. Eğer frontend-agent hâlâ bir taşma/dev-boyut sorunu
gözlemliyorsa bu muhtemelen CSS class'ı eksikliği değil, veri kaynaklı (örn. çok büyük/orantısız bir logo
görselinin `<img>` intrinsic boyutuyla ilk boyanması → CSS uygulanana kadarki an) bir durum; token/tasarım
değişikliği gerektirmiyor, bu yüzden ek bir Karar açmıyorum.

---

## Karar 9 — Açık/Koyu tema garantisi

Bu dokümandaki HİÇBİR yeni bileşen (accordion, drag handle, girinti çizgisi, sticky Kaydet barı, drop-indicator)
sabit hex/rgb değer KULLANMAZ — hepsi mevcut token'lara bağlıdır, bu yüzden `.dark .admin-shell` bloğu
(`globals.css` satır 186-228) zaten otomatik doğru kontrastı sağlar:

| Öğe | Kullanılan token(lar) |
|---|---|
| Accordion başlık/panel arka planı | `bg-surface`, `hover:bg-surface-muted`, `text-foreground`, `text-foreground/50` |
| Checkbox | mevcut `components/ui/checkbox.tsx` — zaten `border-input`/`bg-primary` token'lı, değişiklik yok |
| "Eklendi" rozeti | `Badge tone="neutral"` → `bg-surface-muted text-foreground/70` (badge.tsx satır 8) |
| Ağaç satırı | `border-border/60`, `bg-surface`, `hover:border-border hover:bg-surface-muted` |
| Girinti çizgisi | `border-border/60` (dashed) |
| Sürükle tutamacı | `text-foreground/40`, `hover:text-foreground/70` |
| Drop-indicator | `bg-primary` (accent-bağlı, `.admin-shell`'in dinamik accent sistemiyle otomatik uyumlu) |
| DragOverlay | `bg-surface`, `border-border`, `ring-primary/40` |
| Sticky Kaydet barı | `Card` (`bg-surface/70 border-border/60`), `text-warning`, `bg-warning` — mevcut settings deseniyle birebir aynı token'lar |
| Boş durum | mevcut `EmptyState` bileşeni, değişiklik yok |

Yeni bir `--*` custom property TANIMLANMASI GEREKMİYOR — mevcut token seti (Karar 9 tablosu) yeterli.

---

## Özet — frontend-agent için uygulama kontrol listesi

1. **Önce architect'e Karar 0'ı ilet** — `NavigationItem`/`UpdateNavigationConfigRequest`'e `parentIndex`
   (veya eşdeğeri) eklenmeden nested menü KALICI OLARAK kaydedilemez.
2. `/admin/navigation/page.tsx`: `Tabs` (`menus`/`locations`) + settings'teki dirty-dot/`window.confirm`
   deseni, iki ayrı dirty-flag (`menuHasUnsavedChanges`, `locationsHasUnsavedChanges`) ile. `PageHeading`
   `actions` kaldırılır.
3. `Konumları Yönet` sekmesi = mevcut Logo/Marka + Header CTA + Footer (+Sosyal+FooterColumns) `SectionCard`'ları
   + sağda sabit Canlı Önizleme (mevcut davranış, sadece bu sekmeye taşınıyor).
4. `Menüleri Düzenle` sekmesi = sol `Card` (340px, `Accordion type="multiple"`, `@base-ui/react/accordion`
   ilk kullanımı — `tabs.tsx` deseninde sarılmalı) + sağ `Card` (dnd-kit sortable tree, ilk dnd-kit
   kullanımı — resmi "Sortable Tree" örneği referans).
5. Ağaç satırı: `GripVertical` tutamaç, girinti/outdent butonları (`ChevronLeft`/`ChevronRight`, `icon-xs`),
   sağda edit-toggle `ChevronDown`, açılınca animasyonsuz düzenleme paneli (Etiket/Bağlantı `Input` +
   `variant="destructive"` "Kaldır", onaysız).
6. Girinti: 32px/seviye (`ml-3 pl-5 border-l border-dashed border-border/60` çocuk konteynerinde), maksimum
   2 seviye (kök + 1 alt), her iki kısıt da hem drag-projection hem indent-butonunda uygulanır.
7. Boş durum: mevcut `EmptyState`, `icon={ListTree}`.
8. Sabit Kaydet barı: settings'teki `sticky bottom-6` + `Card` deseni birebir, ama `<Tabs>` DIŞINDA/altında
   (her iki sekmede de görünür), birleşik `handleSave()`.
9. Hiçbir yeni sabit renk değeri YOK — Karar 9 tablosundaki mevcut token'lar kullanılır.
