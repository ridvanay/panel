# Tasarım Notları: Sayfa Düzenleyici — Standart/Yazar Modu ("Sade Form Ekranı")

Ajan: **ui-designer** · Durum: **karar verildi, implementasyon frontend-agent'ta bekliyor**
Kapsam: `.claude/architect-scope-page-editor-roles.md` §6.3'teki 6 açık nokta. Bu doküman kod
İÇERMEZ — kararları, somut sınıf adlarını, prop tablolarını ve ASCII iskeletleri tanımlar.
Bağlayıcı kaynaklar: architect-scope §1.2 (rol/etiket tablosu), §3.2 (`TEMPLATE_EDITABLE_FIELDS`
haritası — bu doküman BİREBİR aynı satırları kullanır), `.claude/design-notes-page-builder-editing-tools-v2.md`
(Minimal/Flat görsel yön, ikon doğrulama deseni), `.claude/design-notes-page-builder-sticky-panel-and-toolbar.md`
(sticky toolbar/offset kuralları — bu dokümanla ÇAKIŞMAZ, üzerine inşa eder).

**Not — §6.4 madde 4'ü geçersiz kılan karar:** architect-scope §6.4 madde 4 taslak olarak
"`BuilderCanvas`'a `mode: 'advanced'|'simple'` prop'u geçir" yazıyor. Görev metninde bu satırın
ui-designer kararına TABİ olduğu açıkça belirtiliyor ("frontend-agent bu karar gelmeden kod
yazmaz"). **KESİN KARAR (Nokta 2, aşağıda detaylı): standart modda `BuilderCanvas` HİÇ
render edilmez — `mode` prop'u `BuilderCanvas`'a eklenmez.** Bunun yerine ayrı, bağımsız bir
`TemplateEditorView` bileşeni kullanılır. §6.4 madde 4'ün geri kalanı (AddContentMenu/
ContainerInserter/LayoutMenu/ContainerSettingsPanel/RevealEffectControl'ün standart modda hiç
görünmemesi) bu kararla otomatik ve inşa gereği (by construction) sağlanır — bu bileşenlerin
hiçbiri `TemplateEditorView` ağacında import bile edilmez.

---

## 0. Görsel yön (değişmiyor)

Proje **Minimal/Flat** idiomunu sürdürüyor. Yeni renk tokenı YOK. Tek ikon kaynağı
`lucide-react`; bu oturumda kullanılan TÜM yeni ikonlar `frontend/node_modules/lucide-react/dist/lucide-react.d.ts`
içinde doğrulandı: `ShieldCheck`, `PencilSparkles`, `SquarePen`, `Eye`, `LockKeyhole`, `Info`,
`Monitor`, `AlertTriangle` (zaten projede kullanılıyor). Yeni kontrol primitifi İCAT EDİLMEZ —
`Badge`, `Card`, `Field`, `Input`, `Textarea`, `Switch`, `Select`, `EmptyState`, `Alert`,
`Button`, `Tooltip` hepsi mevcut.

---

## Karar 1 — Kontrol görünürlüğü: **TAMAMEN YOK, devre dışı buton DEĞİL**

**KESİN KARAR:** Architect'in önerisi (§6.3 madde 1) benimsendi: taşı/sil/çoğalt/sar/aç araç
çubuğu, konteyner ekleme UI'ı, `RevealEffectControl`, `ContainerSettingsPanel` çekmecesi
standart moddaki bir kullanıcı için **hiç DOM'a girmez** (disabled değil, render edilmiyor).

**Gerekçe (architect'in gerekçesine ek):** Nokta 2'deki mimari kararla (`TemplateEditorView`
ayrı bir bileşen, `BuilderCanvas` hiç mount edilmiyor) bu zaten **otomatik** sağlanıyor —
"devre dışı buton" seçeneği yalnızca `BuilderCanvas`'ı simple-mode bayrağıyla YENİDEN
KULLANMAYI seçseydik gündeme gelirdi. Ayrı bileşen kararı bu soruyu pratikte ortadan kaldırıyor:
gizlenecek "bir şey" yok, çünkü o kod yolu hiç çalışmıyor. Bu hem daha güvenli (yanlışlıkla
`disabled` unutulan bir buton riski YOK — bkz. §5.1 architect notu: "gizleme bir güvenlik
önlemi değildir", ama UI'da hiç var olmayan bir kontrolün yanlışlıkla aktifleşmesi de mümkün
değildir) hem de daha az kod (BuilderCanvas'ın ~1000 satırlık dosyasına şube mantığı
eklenmiyor).

---

## Karar 2 — Standart mod paradigması (EN KRİTİK KARAR)

### 2.1 KESİN KARAR: "Sade form ekranı + salt-okunur canlı önizleme", canvas'ın YENİDEN
KULLANILMASI DEĞİL

Kullanıcının orijinal tercihi benimsendi. Yeni, bağımsız bir üst-seviye bileşen:

```
frontend/src/components/admin/page-builder/template-editor-view.tsx
  export function TemplateEditorView({ nodes, onChange }: {
    nodes: PageNode[];
    onChange: (nodes: PageNode[]) => void;
  })
```

`app/admin/pages/[pageId]/page.tsx`'teki "İçerik blokları" bölümünde (satır ~621-657), mevcut
`<BuilderCanvas>` + `<Sheet><ContainerSettingsPanel/></Sheet>` çiftinin YERİNE, koşullu olarak
render edilir:

```tsx
{simpleMode ? (
  <TemplateEditorView nodes={activeNodes} onChange={setActiveNodes} />
) : (
  <>
    <BuilderCanvas
      key={`${isDefaultLocale ? "default" : locale}-${editorGeneration}`}
      nodes={activeNodes}
      onChange={setActiveNodes}
      selectedContainerId={selectedContainer?.id ?? null}
      onSelectContainer={setSelectedContainerId}
    />
    <Sheet /* ...değişmedi... */>...</Sheet>
  </>
)}
```

`simpleMode` hesaplaması architect-scope §6.4 madde 3'teki formülle BİREBİR aynı:
`page.editMode === "TEMPLATE" && !user?.canUseAdvancedBuilder` — `isAdmin` (satır 98) deseninin
yanına, `page.tsx`'te frontend-agent tarafından eklenir (bu bir görsel karar değil, state
kablolamasıdır).

**`nodes`/`onChange` imzası `BuilderCanvas` ile BİREBİR aynı** — bu bilinçli: aynı
`activeNodes`/`setActiveNodes` state'i, aynı locale/`editorGeneration` mekanizması, aynı
autosave/`handleSave` akışı hiçbir değişiklik olmadan çalışır. Yalnızca GÖRSEL katman
değişiyor.

### 2.2 Neden "canlı tuval üzerinde inline düzenleme" DEĞİL

`ContentBlockBody`'nin (builder-canvas.tsx §402-453) çağırdığı 23 blok editörü incelendi
(`frontend/src/components/admin/page-builder/blocks/*.tsx`). Bulgu: bu editörlerin BÜYÜK
ÇOĞUNLUĞU, `TEMPLATE_EDITABLE_FIELDS`'te İZİNLİ ve YASAK alanları **TEK bir doğrusal formda
karışık** gösteriyor — örnek: `HeadingBlockEditor` `data.text` (izinli) ile `level`/`align`/
`underline` (yasak) alanlarını art arda aynı `<div className="space-y-3">` içinde render
ediyor; `ImageBlockEditor` `url`/`alt`/`caption` (izinli) ile `radius`/`lightbox` (yasak)
alanlarını aynı şekilde karıştırıyor. "Canvas'ı aynen kullan, sadece izinsiz alanları gizle"
yaklaşımı, `ContentBlockBody`'nin KENDİSİNİ (23 dosya) yasak-alan-bilgisi taşıyacak şekilde
YENİDEN YAZMAYI gerektirirdi — bu, "sade form" hedefinden UZAKLAŞIR, çünkü kullanıcı yine de
konteyner ağacını, sürükle-bırak kart kabuğunu (`rounded-xl border ... p-4 shadow-sm` + başlık
çubuğu) ve teknik "Konteyner" kelimesini görürdü.

**Sonuç:** ayrı bir bileşen + ayrı, YALIN bir kart kabuğu (Nokta 2.4) + yalnızca izinli alanları
üreten bir alan-editörü katmanı (Nokta 2.5) — kullanıcının "sade form" beklentisiyle tam
örtüşüyor.

### 2.3 Layout — iki sütun, `SeoPreview` düzeniyle AYNI desen

`page.tsx`'in SEO sekmesi (satır 660-661) zaten `grid gap-6 lg:grid-cols-[1fr_380px]` +
`lg:sticky lg:top-6 lg:self-start` + `motion.div` giriş animasyonu desenini kullanıyor. Aynı
desen BİREBİR kopyalanır — yeni bir grid/sticky değeri İCAT EDİLMEZ:

```tsx
<div className="grid gap-6 lg:grid-cols-[1fr_1fr] xl:grid-cols-[480px_1fr]">
  <div className="min-w-0 space-y-4">
    {/* §2.4 — Bölüm kartları */}
  </div>
  <div className="lg:sticky lg:top-6 lg:self-start">
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      {/* §2.6 — TemplatePreviewFrame */}
    </motion.div>
  </div>
</div>
```

`xl:grid-cols-[480px_1fr]` (form sütunu sabit 480px, önizleme kalan alanı doldurur) — `SeoPreview`
sütunundan (`380px`) biraz daha geniş, çünkü form sütunu `ImageUploadField`/dizi editörleri gibi
`SeoPreview`den daha "kalın" içerik taşıyor. `lg:` kademesinde (`1fr_1fr`, `xl` altında) ekran
daha darken iki sütun eşit paylaşılır — form hâlâ okunabilir kalır.

### 2.4 Sol sütun — "Bölüm" kartları (read-only yapısal gruplama)

**KESİN KARAR:** kullanıcıya konteyner ağacı GÖSTERİLİR (yönlendirme için gerekli — aksi halde
15 tane "Başlık" kartı hangi bölüme ait bilinmez) ama **"Konteyner" kelimesi hiç kullanılmaz**
ve `DEPTH_STYLE`'ın (builder-canvas.tsx §3.1, 4 renk/kenarlık seviyesi) tam güç görsel dili
KASITLI OLARAK kullanılmaz — bu, ileri düzey canvas'ın "düzenleme" grameri, sade formun
"okuma" grameri farklı olmalı.

Algoritma (frontend-agent, iteratif — istemci render yardımcısı olduğu için backend'in
özyineleme yasağı BURAYA UYGULANMAZ, ama `MAX_CONTAINER_DEPTH=4` zaten pratik bir tavan koyar):

1. `nodes: PageNode[]` kök listesini sırayla gez.
2. `node.type === "container"` ise: alt ağacı (children, iç içe konteynerler dahil) gez;
   **en az bir** editable-alanlı içerik bloğu içeriyorsa bu kök konteyner bir **"Bölüm"**
   kartı olur (§2.4.1). Hiç editable içerik yoksa (örn. yalnızca `divider`/`custom-html`
   içeriyor) kart TAMAMEN ATLANIR.
3. `node.type !== "container"` (kök seviyesinde "gevşek" bir blok) ise: `TEMPLATE_EDITABLE_FIELDS[node.type]`
   boş değilse, **Bölüm kartı OLMADAN**, doğal sayfa sırasında bir "gevşek alan grubu" olarak
   render edilir (zaten `chrome="page"`, kendi boşluğuna sahip — sarmalayıcı gerekmez).

#### 2.4.1 Bölüm kartı iskeleti

```tsx
<Card key={container.id} className="space-y-4">
  <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">
    Bölüm {sectionIndex}
  </p>
  {/* İçindeki editable içerik blokları, döküman sırasında, düz akış: */}
  {editableBlocksInSection.map((block, i) => (
    <div key={block.id} className={cn(i > 0 && "border-t border-border/40 pt-4")}>
      <FieldGroupHeader block={block} />
      <div className="mt-2">
        <TemplateBlockFields block={block} onChange={(next) => updateBlock(block.id, next)} />
      </div>
    </div>
  ))}
</Card>
```

`sectionIndex` yalnızca kök konteynerler arasında sayılır (1, 2, 3…) — "Bölüm 1", "Bölüm 2"
teknik olmayan, kullanıcı dostu bir sıra numarası. **İç içe konteynerler (2. seviye ve sonrası)
kendi Bölüm kartını AÇMAZ** — ebeveyn Bölüm kartının İÇİNDE, aynı düz `space-y-4`/`border-t`
akışına katılır (bir 2. seviye konteynerin ilk bloğundan önce ekstra bir `pl-3 border-l-2
border-border/30` ince girinti çizgisi ile "bu bir alt-grup" ipucu verilebilir — ZORUNLU
değil, frontend-agent estetik olarak uygun görürse ekler; `DEPTH_STYLE`'ın renk/arkaplan
setiyle KARIŞTIRILMAZ).

`FieldGroupHeader` — `blockRegistry[block.type]` (mevcut `lib/page-builder/registry.ts`,
DEĞİŞMEDEN reuse edilir) üzerinden ikon+etiket:

```tsx
function FieldGroupHeader({ block }: { block: ContentBlock }) {
  const { icon: Icon, label } = blockRegistry[block.type];
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-foreground/40" />
      <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">{label}</span>
    </div>
  );
}
```

Bu, `AccordionBlockEditor`/`TeamBlockEditor` içindeki mevcut `text-xs font-medium
text-foreground/50` eyebrow deseniyle (örn. "Soru 1", "Üye 1") AYNI görsel dil — yeni bir tipografi
tokenı İCAT EDİLMİYOR.

#### 2.4.2 Tümüyle boş sayfa (uç durum)

Sayfa yalnızca `divider`/`custom-html`/içeriksiz konteynerlerden oluşuyorsa (hiç editable alan
yoksa), sol sütun bir `EmptyState` gösterir:

```tsx
<EmptyState
  icon={LockKeyhole}
  title="Düzenlenebilir alan yok"
  description="Bu sayfada değiştirebileceğiniz bir içerik alanı bulunmuyor. Yapısal değişiklikler için gelişmiş bir düzenleyiciden destek isteyin."
/>
```

### 2.5 Alan editörü katmanı — mevcut 20 blok editörüne `simple` prop'u, YENİ ayrı bileşenler
DEĞİL

**KESİN KARAR (kod tekrarını önleyen ana karar):** `frontend/src/components/admin/page-builder/blocks/*.tsx`
içindeki editörler tek tek incelendi (23 dosyanın 23'ü). Sonuç: **hiçbir blok tipi için sıfırdan
yeni bir alan-editörü bileşeni YAZILMASI GEREKMİYOR.** İki kategori:

**A) Zaten %100 izinli (harita ile editörün TÜM alanları örtüşüyor) — DEĞİŞİKLİK YOK, aynen
import edilir:**

| Blok tipi | Bileşen | Dosya |
|---|---|---|
| `text` | `TextBlockEditor` | `blocks/text-block.tsx` |
| `hero` | `HeroBlockEditor` | `blocks/hero-block.tsx` |
| `team` | `TeamBlockEditor` | `blocks/team-block.tsx` |
| `pricing-table` | `PricingTableBlockEditor` | `blocks/pricing-table-block.tsx` |
| `contact-form` | `ContactFormBlockEditor` | `blocks/contact-form-block.tsx` |
| `counter` | `CounterBlockEditor` | `blocks/counter-block.tsx` |
| `testimonial` | `TestimonialBlockEditor` | `blocks/testimonial-block.tsx` |
| `skill-bar` | `SkillBarBlockEditor` | `blocks/skill-bar-block.tsx` |

**B) Kısmen izinli — mevcut editöre TEK bir opsiyonel prop eklenir: `simple?: boolean` (varsayılan
`false`).** `simple=true` iken, editörün kendi JSX'i İÇİNDE, yasak alana karşılık gelen —
zaten görsel olarak İZOLE (ayrı bir satır/blok) — kontrol `{!simple && (...)}` ile sarmalanır.
Bu MEKANİK bir değişikliktir (yeni state/mantık yok), her dosyada 1-3 satırlık bir sarmalama:

| Blok tipi | Bileşen/Dosya | `simple=true` iken GİZLENEN JSX bloğu | KALAN (izinli) alanlar |
|---|---|---|---|
| `heading` | `HeadingBlockEditor` / `heading-block.tsx` | `level` `Field`(Select), `align` `SegmentedToggle` bloğu, `underline` `Switch` satırı | `text` |
| `image` | `ImageBlockEditor` / `image-block.tsx` | `radius` `SegmentedToggle` bloğu, `lightbox` `Switch` satırı | `url`, `alt`, `caption` |
| `button` | `ButtonBlockEditor` / `button-block.tsx` | `style`/`size`/`align` `SegmentedToggle` blokları, `IconPickerField` | `label`, `href` |
| `cta` | `CtaBlockEditor` / `cta-block.tsx` | `align`/`style` `SegmentedToggle` blokları (dosya sonu) | `heading`, `description`, `buttonLabel`, `buttonHref`, `secondaryButtonLabel`, `secondaryButtonHref` |
| `icon-box` | `IconBoxBlockEditor` / `icon-box-block.tsx` | `IconPickerField` (dosya başı) | `heading`, `description`, `href` |
| `gallery` | `GalleryBlockEditor` / `gallery-block.tsx` | `GalleryLayoutControl` satırı (üst araç çubuğunun sol yarısı) | `images[]` (ekle/sil/sırala/alt metin) |
| `accordion` | `AccordionBlockEditor` / `accordion-block.tsx` | `allowMultipleOpen` `Switch` satırı (dosya başı) | `items[]` (soru/cevap, ekle/sil/sırala) |
| `tabs` | `TabsBlockEditor` / `tabs-block.tsx` | `orientation` `SegmentedToggle` bloğu (dosya başı) | `items[]` (etiket/içerik) |
| `video` | `VideoBlockEditor` / `video-block.tsx` | `autoplay`/`muted` `Switch` satırları | `provider`, `url` |
| `before-after-slider` | `BeforeAfterSliderBlockEditor` / `before-after-slider-block.tsx` | `orientation` `SegmentedToggle` bloğu (dosya sonu) | `beforeUrl`, `afterUrl`, `beforeLabel`, `afterLabel` |
| `logo-marquee` | `LogoMarqueeBlockEditor` / `logo-marquee-block.tsx` | Dosya sonundaki `border-t` "Hız"/"Üzerine gelince durdur" bloğu | `items[]` (url/alt/href, ekle/sil/sırala) |
| `latest-posts` | `LatestPostsBlockEditor` / `latest-posts-block.tsx` | `categoryId`, `tagId` iki `Select` `Field`'ı | `heading`, `limit` |
| `featured-products` | `FeaturedProductsBlockEditor` / `featured-products-block.tsx` | `categoryId` `Select` `Field`'ı | `heading`, `limit` |
| `featured-portfolio` | `FeaturedPortfolioBlockEditor` / `featured-portfolio-block.tsx` | `categoryId` `Select` `Field`'ı (aynı desen — frontend-agent dosyayı `featured-products-block.tsx` ile birebir karşılaştırıp teyit eder) | `heading`, `limit` |

`divider`, `custom-html`, `container` → `TEMPLATE_EDITABLE_FIELDS`'te hiç alan yok → bu blok
tipleri §2.4 algoritmasında ZATEN elenir, `TemplateBlockFields`'e hiç ulaşmazlar.

### 2.6 `TemplateBlockFields` — `ContentBlockBody`'nin sade-mod ikizi

Yeni dosya: `frontend/src/components/admin/page-builder/template-block-fields.tsx`. `ContentBlockBody`
(builder-canvas.tsx §402-453) ile AYNI switch iskeleti, ama yalnızca §2.5'teki 20 tipi kapsar
(23 - `divider` - `custom-html` - `container`in kendisi... `container` zaten bir "blok" değil,
switch'e hiç girmez) ve reuse edilen editörlere `simple` iletir:

```tsx
export function TemplateBlockFields({ block, onChange }: { block: ContentBlock; onChange: (block: ContentBlock) => void }) {
  switch (block.type) {
    case "hero": return <HeroBlockEditor block={block} onChange={onChange} />;                     // A — değişmedi
    case "text": return <TextBlockEditor block={block} onChange={onChange} />;                      // A
    case "image": return <ImageBlockEditor block={block} onChange={onChange} simple />;             // B
    case "heading": return <HeadingBlockEditor block={block} onChange={onChange} simple />;         // B
    // …§2.5 tablosundaki 20 satırın TAMAMI…
    default: return null; // divider/custom-html buraya asla ULAŞMAZ (§2.4'te elenir) — savunma amaçlı
  }
}
```

**Neden `ContentBlockBody`'nin KENDİSİ `simple` prop'u almıyor, ayrı bir dosya var:**
(a) `ContentBlockBody` gelişmiş moddaki TÜM 23 tipi kapsıyor, `TemplateBlockFields` yalnızca 20
tipi — ikisini TEK switch'te birleştirmek, gelişmiş moddaki her çağrıya kullanılmayan bir
`simple={false}` parametresi eklemeyi gerektirirdi (gürültü); (b) iki farklı tüketici
(`ContentBlockCard` vs `TemplateEditorView`) farklı bir eşleme mantığı (`default: null`) taşıyor
— ayrı dosya, sorumluluğu net tutuyor.

### 2.7 Sağ sütun — `TemplatePreviewFrame` (salt-okunur canlı önizleme)

**KESİN KARAR — sıfırdan bir önizleme render motoru YAZILMAZ, public site render katmanı AYNEN
kullanılır:** `frontend/src/components/site/blocks/index.tsx::BlockRenderer` zaten
`nodes: PageNode[]` alıp public sayfalardaki (`app/[lang]/(site)/[slug]/page.tsx` satır 118)
BİREBİR AYNI görsel çıktıyı üretiyor. `TemplateEditorView` bunu doğrudan `activeNodes` ile
besler — **gerçek, canlı, sıfır-gecikmeli WYSIWYG önizleme**, ayrı bir taslak/iframe/API
round-trip GEREKMEZ.

```tsx
function TemplatePreviewFrame({ nodes }: { nodes: PageNode[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/50">
        <Monitor className="h-3.5 w-3.5" />
        Canlı Önizleme
        <span className="text-foreground/35">— salt okunur</span>
      </div>
      <div className="max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl border border-border bg-background">
        {/* pointer-events-none YALNIZCA bu iç sarmalayıcıda — dış div'in kendi scroll'u ETKİLENMEZ */}
        <div className="pointer-events-none select-none">
          <BlockRenderer nodes={nodes} chrome="page" />
        </div>
      </div>
    </div>
  );
}
```

**Kritik uygulama notu (frontend-agent):** `pointer-events-none` **iç** sarmalayıcıya
uygulanır, **dış** `overflow-y-auto` kutusuna DEĞİL — aksi halde fare tekerleği/dokunma ile
önizlemeyi kaydırmak da imkânsız hale gelir. İç sarmalayıcı inert olunca: linkler (`button`/`cta`
blokları) tıklanamaz (yanlışlıkla sayfadan çıkış YOK), video/before-after-slider etkileşimleri
donuk kalır, `contact-form` gönderilemez — hepsi İSTENEN davranış (salt-okunur). `featured-products`/
`featured-portfolio`/`latest-posts` blokları kendi verilerini gerçek API'den çeker (public
sayfayla AYNI bileşen, AYNI davranış) — bu bir tasarım kararı DEĞİL, `BlockRenderer`'ı olduğu
gibi kullanmanın doğal bir sonucu, ayrıca not edilmesi yeterli.

`max-h-[calc(100vh-8rem)]` — `.claude/design-notes-page-builder-sticky-panel-and-toolbar.md`
§2.1'deki "başlangıç değeri, frontend-agent tarayıcıda görsel doğrulama yapmalı" ilkesiyle AYNI
statüde: kesin değil, ayarlanabilir bir başlangıç noktası (üst sticky toolbar + sayfa başlığı
yüksekliğini telafi eder). 1-2 satır fark görsel bir sorun değildir.

### 2.8 Bileşen ağacı özeti

```
page.tsx (İçerik sekmesi)
 └─ simpleMode ? TemplateEditorView : (BuilderCanvas + Sheet)

TemplateEditorView (YENİ)
 ├─ Sol sütun: Bölüm kartları (Card, YEREL — yeni bileşen değil, yerel JSX)
 │   └─ her editable blok için:
 │       ├─ FieldGroupHeader (YEREL, blockRegistry reuse)
 │       └─ TemplateBlockFields (YENİ dosya, switch)
 │           └─ mevcut 20 *BlockEditor (8'i DEĞİŞMEDEN, 12'si +`simple` prop'uyla)
 └─ Sağ sütun: TemplatePreviewFrame (YEREL)
     └─ BlockRenderer (site/blocks/index.tsx — DEĞİŞMEDEN reuse)
```

---

## Karar 3 — Rol/yetenek rozetleri (tasarım tokenleri)

**KESİN KARAR:** architect-scope §1.2 tablosundaki 4 durum, tek bir paylaşılan yardımcıda
sabitlenir: `frontend/src/lib/role-badge.ts` →
`export function getRoleBadgeInfo(user: { role: SiteRole; canUseAdvancedBuilder: boolean }): RoleBadgeInfo`.
Hem `/admin/users` (Karar 6) hem de gerekirse başka bir ekranda (örn. gelecekte bir "kimin
düzenlediği" göstergesi) AYNI kaynaktan okunur — `roleLabels`in (`admin/users/page.tsx` satır
44-48) yanına, onu DEĞİŞTİRMEDEN, EK bir yardımcı olarak eklenir (`roleLabels` çıplak rol adı
için — "Admin"/"Editor"/"Viewer" — hâlâ dropdown seçeneklerinde kullanılıyor, bu YENİ yardımcı
onun YERİNE geçmez, tamamlar).

| Durum | Etiket | İkon | `Badge` `tone` | `solid` |
|---|---|---|---|---|
| `role === "ADMIN"` | `Yönetici` | `ShieldCheck` | `primary` | `true` |
| `role === "EDITOR" && canUseAdvancedBuilder` | `Editör (Gelişmiş Düzenleyici)` | `PencilSparkles` | `primary` | `false` |
| `role === "EDITOR" && !canUseAdvancedBuilder` | `Yazar (Standart Düzenleyici)` | `SquarePen` | `neutral` | `false` |
| `role === "VIEWER"` | `İzleyici` | `Eye` | `neutral` | `false` |

**Gerekçe — ADMIN `solid`, diğerleri `soft`:** `ADMIN` sistemdeki EN yüksek yetki seviyesi ve
`canUseAdvancedBuilder`e bakılmaksızın HER ZAMAN gelişmiş (§1.5) — görsel ağırlıkta da bunu
yansıtmalı. `Editör (Gelişmiş)` ile `Yazar (Standart)` arasındaki fark İKİ tonun (primary/neutral)
ayrımıyla zaten görsel olarak net; her ikisini de `solid` yapmak "Kaydedilmemiş değişiklik"
rozeti (page.tsx satır 430, `Badge tone="primary"` — soft) gibi projedeki MEVCUT soft-varsayılan
kullanım yoğunluğunu bozar.

**İkon seçim gerekçesi:** `PencilSparkles` ("kalem + parıltı") gelişmiş/tam yetkili düzenleme
kavramını `Sparkles`in zaten `RevealEffectControl`de (editing-tools-v2 §1.2) kullanılan "gelişmiş
özellik" çağrışımıyla tutarlı taşır; `SquarePen` daha "sade/temel" bir düzenleme ikonu (parıltısız)
— iki ikon arasındaki görsel fark, iki mod arasındaki UX farkını YANSITIR (gelişmiş = "sihirli/
esnek", standart = "sade/doğrudan").

---

## Karar 4 — Şablon modu göstergesi (gelişmiş kullanıcı, `TEMPLATE` sayfa)

**KESİN KARAR — İKİ yerde, tamamlayıcı biçimde (badge + açıklayıcı alert), TEK bir yerde
DEĞİL:**

### 4.1 Sticky toolbar'da kalıcı rozet

`.claude/design-notes-page-builder-sticky-panel-and-toolbar.md` §2.2'deki sticky toolbar'ın sol
grubunda (`h1` + "Kaydedilmemiş değişiklik" rozetinin YANINA — satır 429-434 deseni), sayfa
`editMode === "TEMPLATE"` VE kullanıcı `canUseAdvancedBuilder` iken (yani SADECE gelişmiş
kullanıcı bunu görür — standart kullanıcı zaten `TemplateEditorView`'da, bu toolbar bağlamı
onun için anlamsız/gereksiz gürültü):

```tsx
{page.editMode === "TEMPLATE" && (
  <Tooltip>
    <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
      <Badge tone="warning">
        <LockKeyhole className="mr-1 h-3 w-3" />
        Şablon Modu
      </Badge>
    </TooltipTrigger>
    <TooltipContent>
      Yapısal değişiklikleriniz (konteyner, düzen, stil) bu sayfayı düzenleyen standart
      kullanıcıların formunu ETKİLER. Standart kullanıcılar yalnızca içerik alanlarını görür.
    </TooltipContent>
  </Tooltip>
)}
```

`tone="warning"` — `AlertTriangle`in autosave-hata göstergesinde (satır 450-457) zaten kullanılan
"dikkatli ol ama hata değil" semantiğiyle AYNI, yeni bir ton anlamı İCAT EDİLMİYOR.

### 4.2 İçerik sekmesinde tek satırlık açıklayıcı `Alert`

Toolbar'daki rozet YALNIZCA fare üzerine gelince (`Tooltip`) açıklama verir — bu, "yapısal
değişiklikleriniz standart kullanıcıların formunu etkiler" gibi TAM CÜMLELİK bir uyarı için
yeterince görünür değildir. Bu yüzden, "İçerik blokları" başlığının HEMEN ALTINDA (satır ~622-625,
`<BuilderCanvas>`den ÖNCE), gelişmiş kullanıcı + `TEMPLATE` sayfa kombinasyonunda kalıcı (kapatılamaz,
her ziyarette görünür — bir kerelik "dismiss" mekanizması EKLENMEZ, çünkü kullanıcı her seferinde
bu sayfanın özel davranışını hatırlamalı) bir `Alert`:

```tsx
{editMode === "TEMPLATE" && (
  <Alert variant="warning">
    <span className="flex items-start gap-2">
      <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
      Bu sayfa <strong>şablon modunda</strong>. Buradaki yapısal değişiklikler (konteyner
      ekleme/silme, düzen, stil, animasyon) bu sayfayı düzenleyen standart kullanıcıların
      form ekranını etkiler; onlar yalnızca metin/görsel/buton gibi içerik alanlarını görür.
    </span>
  </Alert>
)}
```

`Alert`'in mevcut `warning` varyantı (`alert.tsx` satır 12) DEĞİŞMEDEN kullanılır.

**Neden badge TEK BAŞINA yetersiz, alert TEK BAŞINA gereksiz:** rozet düşük-sürtünmeli/her an
görünür bir HATIRLATMA (kullanıcı sayfayı ilk açtığında farkına varır), alert ise İÇERİK sekmesine
girdiğinde tam açıklamayı verir (SEO/Geçmiş Sürümler sekmelerinde tekrar GÖSTERİLMEZ — orada
yapısal değişiklik riski zaten yok). İkisi birlikte, ne SEO ne Geçmiş Sürümler sekmesini
gereksiz uyarıyla kirletmeden, doğru bağlamda doğru derinlikte bilgi verir.

---

## Karar 5 — 403 sunumu: **mevcut hata deseni AYNEN kullanılır, YENİ bir mekanizma EKLENMEZ**

**KESİN KARAR:** `page.tsx::handleSave` zaten HER hata için ikili bir desen uyguluyor (satır
340-346): `friendlyErrorMessage(err)` → hem `setSaveError` (üstte `Alert variant="error"`, satır
507-514) HEM `toast.error(message)`. `assertTemplateEditAllowed`'ın ürettiği 403
(`error.code: "FORBIDDEN"`, `error.message: "Bu sayfa şablon modunda; yalnızca içerik alanlarını
düzenleyebilirsiniz."`) bu akıştan GEÇTİĞİNDE, `friendlyErrorMessage` zaten `err.message`'ı
(backend'in TR mesajı) döndürüyor — **frontend-agent'ın YAPMASI gereken TEK şey: bu hata kodu
için ÖZEL bir dal AÇMAMAK.** Mevcut `catch` bloğu hiçbir değişiklik olmadan doğru mesajı hem
toast hem inline Alert olarak gösterir.

**`details.blocks` KESİNLİKLE render EDİLMEZ** (architect'in §6.3 madde 5 önerisiyle AYNI karar) —
zaten bugün `friendlyErrorMessage`/`fieldErrorsFrom` (`lib/api/friendly-error.ts`) `details`i bu
akışta HİÇ OKUMUYOR; frontend-agent'ın DİKKAT ETMESİ gereken tek nokta, bu davranışı KORUMAK
(yanlışlıkla `err.details.blocks`'u bir yerde `.map`leyip listelememek).

**Gerekçe — neden toast/Alert ARASINDA seçim YAPILMADI, ikisi de kullanıldı:** bu, mevcut
`handleSave` hata yolunun DIŞINDA yeni bir "403 özel durumu" icat etmek yerine, PROJENİN zaten
sahip olduğu TEK hata sunumu mekanizmasını olduğu gibi miras almaktır. Yeni bir mekanizma (yalnız
toast VEYA yalnız Alert) icat etmek hem tutarsızlık yaratır (aynı sayfada iki farklı hata sunumu
kuralı) hem de gereksiz kod dalı açar — architect'in kendi notu da bu hatanın "normalde hiç
olmaması gereken, ırk-koşulu (race condition) kaynaklı" olduğunu vurguluyor; nadir/beklenmedik bir
hata için özel bir UI YATIRIMI YAPILMAZ, var olan genel mekanizma yeterlidir. Autosave 403'ü de
aynı şekilde MEVCUT `autosaveStatus === "error"` göstergesine (satır 450-457, ikon + tooltip) düşer
— YENİ bir dal AÇILMAZ.

---

## Karar 6 — `/admin/users` yetenek anahtarı: **ayrı sütun, İÇİNDE Switch + türetilmiş rozet
birlikte**

**KESİN KARAR:** Ne "yalnızca Switch" ne "yalnızca rozet" — tabloya YENİ bir sütun eklenir
("Rol" sütunundan HEMEN SONRA, "Durum"dan ÖNCE — satır 593 `<TableHead className="w-32">Rol</TableHead>`'in
ardına), içinde HEM `Switch` HEM Karar 3'teki türetilmiş rozet birlikte durur. Gerekçe: yalnızca
Switch göstermek yöneticiye "bu ayarın SONUCU ne?" sorusunu bıraktırır (rol + bayrağı zihinde
birleştirmesi gerekir); yalnızca rozet göstermek etkileşimi (aç/kapa) kaybettirir.

```tsx
<TableHead className="w-48">Yetenek</TableHead>
```

```tsx
<TableCell className="w-48">
  <BuilderAccessCell user={user} onChange={handleBuilderAccessChange} />
</TableCell>
```

### 6.1 `BuilderAccessCell` — üç davranış durumu

```tsx
function BuilderAccessCell({ user, onChange }: { user: AdminUser; onChange: (user: AdminUser, next: boolean) => void }) {
  const badge = getRoleBadgeInfo(user); // Karar 3
  const isAdmin = user.role === "ADMIN";
  const isViewer = user.role === "VIEWER";

  return (
    <div className={cn("flex items-center gap-2", isViewer && "opacity-60")}>
      <Switch
        aria-label={`${user.name} için gelişmiş düzenleyici erişimi`}
        checked={user.advancedBuilderEnabled}
        disabled={isAdmin || user.status === "DELETED"}
        title={isAdmin ? "Yöneticiler her zaman gelişmiş düzenleyiciye sahiptir." : undefined}
        onCheckedChange={(checked) => onChange(user, checked)}
      />
      <Badge tone={badge.tone} solid={badge.solid} size="sm">
        <badge.icon className="mr-1 h-3 w-3" />
        {badge.label}
      </Badge>
      {isViewer && (
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
            <AlertTriangle className="h-3.5 w-3.5 text-warning/70" />
          </TooltipTrigger>
          <TooltipContent>
            İzleyici rolü sayfa yazma uçlarına hiç erişemez; bu ayarın görünür bir etkisi olmaz.
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
```

**Üç durum:**

1. **`ADMIN` satırı:** `Switch` `disabled` + `title` tooltip'i (mevcut `disabled`+`title` deseni,
   satır 649-650'deki `isLastActiveAdmin`/`isDeleted` ile AYNI konvansiyon) — DB'deki ham değeri
   değiştirmenin görünür hiçbir etkisi olmayacağını baştan söyler, kafa karışıklığını/"boş
   yere destek talebi"ni önler (§1.5 mimari notunun UI karşılığı).
2. **`EDITOR` satırı:** `Switch` tam işlevsel, birincil kullanım senaryosu — açıkken rozet
   `Editör (Gelişmiş Düzenleyici)`, kapalıyken `Yazar (Standart Düzenleyici)` OLARAK ANINDA
   değişir (rozet `advancedBuilderEnabled`in DEĞİL, `getRoleBadgeInfo`nin `canUseAdvancedBuilder`
   girdisinin türevidir — optimistik UI: `updateUserBuilderAccess` yanıtı dönene kadar yerel
   state'ten hesaplanır).
3. **`VIEWER` satırı:** architect §1.6 kararına göre (`Switch` TEKNİK olarak serbest, backend 422
   ÜRETMEZ) `Switch` DISABLED DEĞİL ama satırın tamamı `opacity-60` ile SOLUKLAŞTIRILIR + yanına
   bir `AlertTriangle` ikonu + tooltip ("bu ayarın görünür bir etkisi olmaz") eklenir. Rozet HER
   ZAMAN `İzleyici` kalır (bayrağın durumundan BAĞIMSIZ — architect §1.2 tablosunda VIEWER için
   zaten TEK bir dış etiket var, "VIEWER + flag=true" diye ayrı bir görsel durum YOK).

**Gerekçe — neden VIEWER `disabled` DEĞİL, `opacity-60`:** görevdeki öneri ("soluk/uyarılı")
benimsendi çünkü architect AÇIKÇA "422 üretilmez, kabul edilir" diyor (§1.6) — `disabled`
yapmak, backend'in kasıtlı olarak İZİN VERDİĞİ bir eylemi UI'da YASAKLIYORMUŞ gibi YANLIŞ bir
sinyal verirdi. Soluklaştırma + tooltip, "teknik olarak çalışır ama anlamsız" nüansını doğru
taşır.

### 6.2 `usersApi.updateBuilderAccess`

Görev listesindeki (`§6.4 madde 6`) `PATCH /admin/users/{userId}/builder-access` çağrısı
frontend-agent'ın işi — bu doküman yalnızca YUKARIDAKİ görsel/etkileşim kararını sağlar. Hata
durumunda AYNI toast+friendlyErrorMessage deseni (Karar 5 ile tutarlı, `handleConfirmRoleChange`
satır 128-143'teki mevcut desenle BİREBİR) kullanılır — ayrı bir hata sunumu İCAT EDİLMEZ.

---

## Bileşen/dosya eşleme tablosu (frontend-agent için hızlı referans)

| Değişiklik | Dosya | Not |
|---|---|---|
| Standart mod ana ekranı (YENİ) | `frontend/src/components/admin/page-builder/template-editor-view.tsx` | §2.1, §2.4, §2.7-2.8 |
| Sade-mod alan editörü switch'i (YENİ) | `frontend/src/components/admin/page-builder/template-block-fields.tsx` | §2.6 |
| 12 blok editörüne `simple?: boolean` prop'u | `blocks/{image,heading,button,cta,icon-box,gallery,accordion,tabs,video,before-after-slider,logo-marquee,latest-posts,featured-products,featured-portfolio}-block.tsx` | §2.5 tablo B |
| 8 blok editörü DEĞİŞMEDEN reuse | `blocks/{text,hero,team,pricing-table,contact-form,counter,testimonial,skill-bar}-block.tsx` | §2.5 tablo A |
| Rol/yetenek rozet yardımcısı (YENİ) | `frontend/src/lib/role-badge.ts` | Karar 3 |
| İçerik sekmesi koşullu render | `frontend/src/app/admin/pages/[pageId]/page.tsx` (~satır 621-657) | §2.1 |
| Şablon modu rozeti (sticky toolbar) | `frontend/src/app/admin/pages/[pageId]/page.tsx` (~satır 429-434 civarı) | §4.1 |
| Şablon modu `Alert`'i (İçerik sekmesi) | `frontend/src/app/admin/pages/[pageId]/page.tsx` (~satır 622 öncesi) | §4.2 |
| `/admin/users` "Yetenek" sütunu | `frontend/src/app/admin/users/page.tsx` (tablo başlığı satır ~593, satır ~657 sonrası hücre) | Karar 6 |
| 403/`FORBIDDEN` sunumu | *(yeni kod YOK — mevcut `handleSave`/autosave hata yolu)* | Karar 5 |

---

## Kapsam dışı (netlik için)

Bu doküman şunları TANIMLAMAZ: `page.tsx`teki `simpleMode`/`canUseAdvancedBuilder` state
kablolaması (frontend-agent, §6.4 madde 3), `usersApi.updateBuilderAccess` çağrısının tam
imzası ve optimistik state güncellemesinin kesin implementasyonu (frontend-agent), `POST
/admin/pages`/`new/page.tsx`/silme/geri yükleme aksiyonlarının yeteneksiz kullanıcıya
gösterilmemesi (§6.4 madde 5 — bu bir görünürlük/routing kararı, ui-designer'ın 6 maddelik
listesinde YOK), `TEMPLATE_EDITABLE_FIELDS`in frontend aynasının (`lib/page-builder/template-fields.ts`)
TAM içeriği (backend `page-template-fields.ts` ile birebir olmak ZORUNDA — bu bir veri kararı,
architect §3.2'de zaten sabit), iç içe konteyner girinti çizgisinin (§2.4.1) tam piksel değeri
(frontend-agent estetik takdirine bırakıldı, ZORUNLU değil).
