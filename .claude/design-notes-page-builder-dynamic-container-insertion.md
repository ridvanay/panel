# Tasarım Notları: Dinamik Konteyner Ekleme (Elementor/Gutenberg Tarzı) — Sabit "DÜZEN" Panelinin Kaldırılması

Ajan: **ui-designer** · Durum: **v1 (spesifikasyon, implementasyon bekliyor)** · Sahibi: ui-designer
Kapsam: (1) sabit üst "DÜZEN" panelinin (`BlockList`/`LayoutPicker`, `page.tsx`'in tepesi) tamamen kaldırılması, (2) yerine geçen üç dinamik konteyner-ekleme mekanizması: canvas sonu/boş-durum kutusu, konteynerler-arası hover-inserter, kontrol barına "+ Alta Yeni Konteyner Ekle" aksiyonu. Bu doküman kod İÇERMEZ; `frontend-agent` bunu okuyup `builder-canvas.tsx`'i ve yeni `container-inserter.tsx`'i buna göre kodlar, `block-list.tsx`/`layout-picker.tsx`'i kaldırır, `page.tsx`'teki ilgili prop akışını söker.

Bağlayıcı kaynaklar (bu dokümanın referans aldığı, ÜZERİNDE değiştirmediği): `.claude/design-notes-page-builder-container-ui.md` (§1 — `LayoutPresetTile`'ın kökeni, §3 — derinlik/seçili-durum görsel dili, `MAX_CONTAINER_DEPTH=4`), `.claude/design-notes-page-builder-editing-tools.md` (§1.2 — paylaşılan `SegmentedToggle`, §3.1 — `Popover`/`Sparkles` `RevealEffectControl` deseni, ContainerCard kontrol barının "sessizken soluk, hover'da opak" deseni), `frontend/src/lib/page-builder/presets.ts` (`LAYOUT_PRESETS`, `createContainerFromPreset`, `MAX_CHILDREN_PER_CONTAINER=24`). Bu sabitler burada **tekrar edilir, yeniden kararlaştırılmaz.**

---

## 0. Görsel yön (değişmiyor)

Proje **Minimal/Flat** idiomunu sürdürüyor (bkz. önceki iki design-notes dosyasının §0'ı). Bu üç yeni bileşen için de:

- Yeni renk tokenı **eklenmez** — yalnızca `primary`, `warning`, `border`, `surface-muted`, `foreground/N`.
- Blur/glow/gradient efekti **kullanılmaz.**
- Tüm ikonlar `lucide-react`; bu dokümanda kullanılan tüm ikonlar zaten kodda **doğrulanmış ve import edilmiş** durumda (`LayoutTemplate` — `builder-canvas.tsx` boş-durum hero'sunda; `Plus` — `add-content-menu.tsx`'te). Yeni bir ikon **icat edilmez.**
- Yeni bir kontrol primitifi **icat edilmez**: `Popover`/`PopoverTrigger`/`PopoverContent` (mevcut, `RevealEffectControl`'de kanıtlanmış), `Button`, `Badge`. `DropdownMenu` **bilinçli olarak kullanılmaz** — bkz. §2.1 gerekçesi.

---

## 1. Üst "DÜZEN" panelinin kaldırılması — ne siliniyor, ne taşınıyor

| Dosya/parça | Kader |
|---|---|
| `frontend/src/components/admin/page-builder/block-list.tsx` | **Tamamen silinir.** Tek işlevi `LayoutPicker`'ı sarmalamaktı, artık gövdesiz kalıyor. |
| `frontend/src/components/admin/page-builder/layout-picker.tsx` | **Tamamen silinir.** İçindeki `LayoutPicker` (sabit panel gövdesi) ve `PaletteSectionLabel` ("DÜZEN" başlığı) artık gereksiz — pozisyonel ekleme modeli aşağıda (§1.1) bu ihtiyacı ortadan kaldırıyor. |
| `LayoutPresetTile` (aynı dosyada, dışa aktarılmıyordu) | **Taşınır** → yeni `container-inserter.tsx` içinde, `LayoutPresetPopoverGrid`'in bir alt-bileşeni olarak (bkz. §2). Kendi sınıfları/`aria-label` semantiği **birebir korunur** — yalnızca artık sabit bir panelde değil, bir `Popover` içinde render edilir. |
| "Ekleniyor: {targetLabel}" bağlam satırı (`CornerDownRight` ikonu) | **Kaldırılır**, geri getirilmez (bkz. §1.1 gerekçesi). |
| `page.tsx` §"İçerik blokları" bölümü | `<BlockList onAddLayout={addLayoutPreset} targetLabel={targetLabel} layoutDisabled={...} layoutDisabledReason={...} />` satırı **silinir**. `BuilderCanvas` doğrudan `<h2>İçerik blokları</h2>` açıklamasının altında başlar. `selectedContainerId`/`ContainerSettingsPanel` kablolaması **AYNEN KALIR** (madde 2.5'teki ayar paneli bu görevin kapsamı dışında). |

### 1.1 Neden "Ekleniyor: X" bağlam satırı artık gereksiz (pozisyonel ekleme modeli)

Eski model: kullanıcı önce bir konteyner **seçer** (veya seçmez → kök), sonra sabit panelden bir preset **seçer**, sistem bunu "şu an seçili olan hedefe" ekler — hedefin ne olduğu görsel olarak belirsizleşebildiği için `targetLabel` bağlam satırı **zorunluydu** (bkz. `container-ui.md` §1.3: *"mimarın 'boş konteyner ekleyip doldurma' akışı hedefsiz hissettirmeye çok müsaittir"*).

Yeni model (Elementor/Gutenberg): her ekleme tetikleyicisi **kendi konumunu zaten taşır** — "canvas sonu" kutusu her zaman köke ekler, "aralar" inserter'ı tam o iki kart arasına ekler, kontrol barındaki "+Alta" o konteynerin hemen altına ekler. Hedef **tetikleyicinin fiziksel konumuyla birebir aynı** olduğu için ayrı bir "Ekleniyor: X" metnine gerek kalmaz — bu, eski modelin çözmeye çalıştığı belirsizliği kaynağında ortadan kaldırır. `selectedContainerId` state'i **korunur ama artık "ekleme hedefi" anlamı taşımaz** — yalnızca `ContainerSettingsPanel`'in hangi konteyneri düzenlediğini belirler (bu ayrım frontend-agent'a önemli bir not: iki state'in anlamsal olarak birbirinden koptuğu bilinmeli).

---

## 2. Ortak parça: `LayoutPresetPopoverGrid` (üç tetikleyici tarafından paylaşılan popover içeriği)

### 2.1 Neden `Popover`, neden `DropdownMenu` DEĞİL

**KESİN KARAR:** Yeni üç tetikleyicinin hepsi `Popover`/`PopoverTrigger`/`PopoverContent` kullanır (`RevealEffectControl`'ün kanıtlanmış deseni), `DropdownMenu` **kullanılmaz**. Gerekçe: `DropdownMenu` (`AddContentMenu`'nün temeli) `role="menu"` + ok-tuşu roving-focus semantiği taşır — bu, **tek boyutlu** bir liste (menü öğeleri) için doğrudur. `LayoutPresetTile` grid'i ise **iki boyutlu** bir ızgara (satır/sütun); `DropdownMenu`'nün ok-tuşu gezinme modeliyle doğal bir eşleşmesi yok (mevcut `LayoutPicker`'da zaten düz `<button>`lar kullanılıyordu, bir menü BİLEŞENİ hiç yoktu — bu doğru sezgi korunur, yalnızca artık bir `Popover` kabuğuna alınır). Ayrıca bu seçim, §6'daki görsel-ayrım kararını güçlendirir: içerik bloğu ekleme her zaman `DropdownMenu` (arama+kategori+menü öğesi), konteyner ekleme her zaman `Popover` (arama yok, sade ızgara) — **iki farklı etkileşim modeli, iki farklı zihinsel model.**

### 2.2 Grid — `LayoutPresetTile` birebir taşınır

```tsx
// container-inserter.tsx içinde, dışa AKTARILMAZ (yalnızca LayoutPresetPopoverGrid'in iç parçası)
function LayoutPresetTile({ preset, disabled, disabledReason, onSelect }: { ... }) {
  return (
    <button type="button" aria-label={preset.label} title={disabled ? disabledReason : preset.label} disabled={disabled}
      onClick={() => onSelect(preset)}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-surface-muted p-2 transition-colors outline-none",
        "hover:border-primary/50 hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        disabled && "pointer-events-none opacity-50"
      )}>
      <span className="flex h-8 w-14 items-stretch gap-0.5 rounded-md border border-border/50 bg-background p-1" aria-hidden>
        {preset.weights.map((w, i) => <span key={i} style={{ flexGrow: w }} className="rounded-[2px] bg-primary/25" />)}
      </span>
      <span className="text-[11px] font-medium text-foreground/70">{preset.label}</span>
    </button>
  );
}

export function LayoutPresetPopoverGrid({
  disabled, disabledReason, onSelect,
}: { disabled?: boolean; disabledReason?: string; onSelect: (preset: LayoutPreset) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {LAYOUT_PRESETS.map((preset) => (
        <LayoutPresetTile key={preset.id} preset={preset} disabled={!!disabled} disabledReason={disabledReason} onSelect={onSelect} />
      ))}
    </div>
  );
}
```

**e2e/erişilebilirlik uyumluluğu (KIRILMAMALI):** her karo yine düz bir `<button aria-label={preset.label}>` — `getByRole("button", { name: preset.label })` sorgusu **hiçbir değişiklik olmadan** çalışmaya devam eder, karonun artık bir `Popover` içinde render edilmesi bu semantiği etkilemez.

### 2.3 `disabled`/`disabledReason` — `MAX_CONTAINER_DEPTH` iletimi

Kök seviyeye ekleme (canvas sonu kutusu, kök `between`-inserter) **her zaman** `disabled={false}` — kök seviyede oluşan yeni konteyner en fazla derinlik 2'dir (çok-sütunlu preset seçilirse), `MAX_CONTAINER_DEPTH=4`'ü asla aşamaz. İç içe kullanım (bir konteynerin `children` listesi içinde, §4.3 ve §5) için: `disabled={depth + 1 > MAX_CONTAINER_DEPTH}`, `disabledReason="Maksimum iç içe geçme derinliğine ulaşıldı (4)"` — bu, `container-ui.md` §3.1'deki **"Seviye 4 · Maks." rozetinde Layout Picker karolarının tamamen devre dışı kalması** kararıyla birebir tutarlı (tek tek karo bazlı kısmi devre dışı bırakma YOK — mevcut emsal tüm grid'i kapatıyor, burada da aynı).

---

## 3. "+ Yeni Konteyner Ekle" — canvas sonu ve boş durum

### 3.1 Dolu canvas — tuvalin en altına eklenen dashed kutu (`variant="appended"`)

Kök düğüm listesinin (`space-y-4` / yeni yapı için bkz. §4.4) **son elemanı** olarak, tam genişlikte, `EmptyContainerDropZone`'un görsel ailesinden ama **daha belirgin/daha büyük** (sayfa-seviyesi bir aksiyon olduğu için, konteyner-içi "blok ekle" kutusundan görsel ağırlıkça bir adım üstte durmalı):

```tsx
<Popover>
  <PopoverTrigger
    render={
      <button
        type="button"
        aria-label="Yeni Konteyner Ekle"
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/50",
          "bg-surface-muted/10 py-5 text-sm font-medium text-foreground/50 transition-colors outline-none",
          "hover:border-primary/50 hover:bg-primary/5 hover:text-primary",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        )}
      />
    }
  >
    <LayoutTemplate className="h-4 w-4" aria-hidden />
    Yeni Konteyner Ekle
  </PopoverTrigger>
  <PopoverContent align="center" className="w-80">
    <LayoutPresetPopoverGrid onSelect={(preset) => onInsert(rootIds.length, preset)} />
  </PopoverContent>
</Popover>
```

- `py-5` (`EmptyContainerDropZone`'un `min-h-28`'inden orantılı olarak daha "yassı ama geniş" — sayfa sonu bir CTA şeridi hissi, kutu değil).
- `LayoutTemplate` ikonu — **yeni bir ikon değil**, zaten kodda kök boş-durum hero'sunda kullanılıyor (`builder-canvas.tsx` satır ~816), burada aynı ikon "konteyner/yapı ekle" semantiğini pekiştirerek yeniden kullanılır.
- Etiket **"Yeni Konteyner Ekle"** (kelime seçimi bilinçli — "Eleman Ekle"/"Blok Ekle" DEĞİL, bkz. §6).

### 3.2 Boş canvas — mevcut hero panelin İÇİNE gömülü tetikleyici (`variant="empty"`)

Mevcut statik mesaj kutusu (`LayoutTemplate` ikonlu, "Sayfa Tasarımına Başlayın" başlıklı) **iskelet olarak korunur**, yalnızca (a) açıklama metni güncellenir, (b) altına tıklanabilir bir CTA eklenir — **ikinci bir dashed kutu iç içe konulmaz** (§3.1'in dashed kutusu zaten dıştaki hero kutusunun kendisi, iç içe iki `border-dashed` katmanı görsel gürültü yaratır). CTA burada düz bir `Button` olarak render edilir:

```tsx
<div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/60 bg-surface-muted/20 px-8 py-16 text-center">
  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
    <LayoutTemplate className="h-7 w-7" aria-hidden />
  </span>
  <div className="space-y-1">
    <h3 className="text-base font-semibold text-foreground">Sayfa Tasarımına Başlayın</h3>
    <p className="max-w-sm text-sm text-foreground/60">
      Aşağıdaki düğmeyle ilk bölümünüzü/konteynerinizi ekleyin.
    </p>
  </div>
  <Popover>
    <PopoverTrigger render={<Button type="button" variant="secondary" size="sm" aria-label="Yeni Konteyner Ekle" />}>
      <Plus className="h-4 w-4" />
      Yeni Konteyner Ekle
    </PopoverTrigger>
    <PopoverContent align="center" className="w-80">
      <LayoutPresetPopoverGrid onSelect={(preset) => onInsert(0, preset)} />
    </PopoverContent>
  </Popover>
</div>
```

- Buton içindeki ikon burada `Plus` (kutunun kendi ikonu zaten `LayoutTemplate` — aynı ikonu iki kez art arda göstermek yerine, dıştaki hero `LayoutTemplate`, içteki buton standart "ekle" ikonu `Plus` taşır; anlam zaten hero'nun bağlamından geliyor, tekrar bir "yapı" ikonuna gerek yok).
- Metin değişikliği **zorunlu** (eski metin "Yukarıdaki ızgara düzenlerinden birini seçerek…" artık yanlış — üstte hiçbir ızgara yok).
- `variant="empty"` ve `variant="appended"` **aynı bileşenin (`NewContainerInserter`) iki görsel modu** olarak tasarlanır (tek bileşen, `variant` prop'una göre dashed-kutu-tetikleyici mi (§3.1) yoksa hero-içi-buton mu (§3.2) render edeceğine karar verir) — iki ayrı bileşen **icat edilmez**, tek bir `NewContainerInserter` iki görünüm üretir.

---

## 4. Konteynerler arası hover-inserter (`BetweenContainersInserter`)

### 4.1 Dinlenme/hover/focus görünürlüğü — ContainerCard kontrol barıyla AYNI yaklaşım

**KESİN KARAR:** `ContainerCard`'ın kontrol barındaki "sessizken soluk, hover/seçili'de tam opak" formülü (`opacity-75 hover:opacity-100 ... focus-within:opacity-100`, **asla `display:none`/`hidden`**) burada da **birebir** uygulanır — buton HER ZAMAN DOM'da, HER ZAMAN tıklanabilir/focus-edilebilir kalır, yalnızca **görsel ağırlığı** değişir:

```tsx
<div
  className={cn(
    "group/inserter relative flex h-4 items-center opacity-40 transition-opacity duration-150",
    "hover:opacity-100 focus-within:opacity-100"
  )}
>
  {/* çizgi — dinlenmede soluk ama HER ZAMAN görünür (tamamen gizli DEĞİL) */}
  <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-primary/40" aria-hidden />
  {/* buton — dinlenmede kabuk grubuyla aynı opaklıkta (0.4), hover/focus'ta tam opak */}
  <div className="relative mx-auto">
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Aralarına yeni konteyner ekle"
            title="Aralarına yeni konteyner ekle"
            className="rounded-full border border-primary/40 shadow-sm"
          />
        }
      >
        <Plus className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80">
        <LayoutPresetPopoverGrid disabled={disabled} disabledReason={disabledReason} onSelect={(preset) => onInsert(index, preset)} />
      </PopoverContent>
    </Popover>
  </div>
</div>
```

- Rest: `opacity-40` (soluk ama var — "tamamen gizli" **DEĞİL**, `container-ui.md`/`editing-tools.md` boyunca kanıtlanmış prensip: erişilebilirlik + keşfedilebilirlik için pasif elemanlar bile bir iz bırakmalı). Bu, `ContainerCard` kontrol barının `opacity-75` değerinden biraz daha düşük — gerekçe: kontrol barı zaten **metin+ikon içeren bir şerit** (okunabilir kalması gerekir), buton ise **tek bir ince çizgi + küçük daire**, `opacity-40`'ta bile fark edilir kalır ve her iki kart arasında sürekli görünen 20'den fazla soluk çizgi/nokta sayfayı görsel olarak kirletmez.
- Hover/focus: `opacity-100` — hem grup (`group/inserter`) üstüne gelindiğinde hem butonun kendisi klavyeyle `focus-within` olduğunda tetiklenir; **salt `:hover`'a bağlı değildir**, Tab ile gelen bir kullanıcı butonu görsel olarak da tam opaklıkta görür.
- `size="icon-sm"` (24-32px dokunma alanı, mevcut kontrol barı ikon butonlarıyla **aynı boyut sınıfı** — `icon-xs` DEĞİL, küçük ekranlarda/dokunmatikte yeterli hedef alanı için).
- Buton `rounded-full` + `border-primary/40` — mevcut `LayoutPresetTile`/kontrol barı ikon butonlarından **kasıtlı olarak görsel olarak ayırt edilebilir** (dairesel, ince primary kenarlıklı — "buraya ekle" işaretinin kendine özgü bir imzası var, diğer kare/dikdörtgen butonlarla karışmaz).

### 4.2 Tıklama alanı / dokunmatik erişilebilirlik notu

Dinlenme opaklığı görsel bir azalmadır, **tıklama alanını küçültmez** — `size="icon-sm"` butonun gerçek hit-area'sı sabit kalır. Dokunmatik cihazlarda `:hover` doğal olarak tetiklenmediği için (mobil/tablet admin kullanımı marjinal bir senaryo — sayfa builder zaten sürükle-bırak/mouse odaklı), soluk-çizgi-tabanlı keşif dokunmatikte zayıflar; bu **kabul edilen bir ödün** — dokunmatik/klavye kullanıcıları için eşdeğer eylem zaten kontrol barındaki "+ Alta Yeni Konteyner Ekle" (§5) üzerinden, hover'a bağlı olmadan erişilebilir durumda. Ek bir "her zaman görünür mobil mod" bu doküman kapsamında **zorunlu tutulmaz** ama frontend-agent isterse `@media (hover: none)` ile `opacity-100` varsayılanına düşürebilir (isteğe bağlı iyileştirme, engelleyici değil).

### 4.3 İç içe konteynerlerde davranış — yalnızca `direction: "column"` listelerinde

**KESİN KARAR:** Between-inserter **kök listede VE herhangi bir konteynerin `children` listesinde** (iç içe "bölüm içinde bölüm" senaryosu) gösterilir, **ancak yalnızca o liste dikey istifleniyorsa** (`direction === "column"`, ya da kökte zaten örtük olarak dikey). `direction: "row"` olan bir konteynerin çocukları (yan yana duran sütunlar) için between-inserter **gösterilmez.**

Gerekçe: hover-çizgisi görsel dili **yatay bir çizgi** ("bunun altına/üstüne ekle") ile "iki dikey-istiflenmiş öğe arasına yeni bir tane sok" fikrini doğal olarak temsil eder. `direction: "row"` sütunları ise yan yana dururlar — aralarına "yeni bir sütun sokmak" için doğal görsel karşılık **dikey bir çizgi** olurdu, bu da §4.1'deki bileşenin tamamen farklı bir varyantını (yatay yerleşimli, dikey çizgili) gerektirir; bu senaryo zaten çok daha nadir (bir satırın ortasına yeni sütun eklemek, sütun sayısını/genişlik oranlarını değiştirmek anlamına gelir — preset'in `weights` mantığıyla çakışabilir, örn. `50-50`'nin ortasına üçüncü bir sütun sokmak `33-33-33`'e dönüştürmek mi yoksa üçüncü bağımsız bir sütun mu olduğu belirsiz). Bu doküman **bu karmaşık senaryoyu kapsam dışı bırakır** — satır-içi sütun ekleme, mevcut `AddColumnMenu`/`ratioLabel` mekanizmasının (bkz. `container-ui.md` §3.4) sorumluluğunda kalır, değiştirilmez. Between-inserter yalnızca **dikey akışta** (kök + `direction: "column"` konteynerler) render edilir.

### 4.4 `MAX_CHILDREN_PER_CONTAINER`/`MAX_CONTAINER_DEPTH` iletimi

Bir konteynerin `children` listesi içindeki between-inserter'lar, o konteynerde zaten hesaplanmış `atMaxChildren` (`children.length >= 24`) ve `atMaxDepth` (`depth >= MAX_CONTAINER_DEPTH`) değerlerini **aynen** devralır (`ContainerCard` içinde bu değerler zaten `AddContentMenu`/rozet için hesaplanıyor, §2.3'teki `disabled`/`disabledReason` olarak `LayoutPresetPopoverGrid`'e iletilir). Kök listedeki between-inserter'lar için bu iki sınır **uygulanmaz** (kök için `MAX_CHILDREN_PER_CONTAINER` bu doküman kapsamında bağlayıcı değil — bkz. §10, mevcut davranışla aynı varsayım korunur).

### 4.5 Spacing notu (frontend-agent'a, bağlayıcı değil)

Mevcut kök liste `space-y-4` ile boşluklanıyor (`builder-canvas.tsx` satır ~827); between-inserter'lar araya **explicit** eleman olarak girdiğinde (`[Card, Inserter, Card, Inserter, …, Card]`), otomatik `space-y-*` yerine bu dizinin `flex flex-col` içinde **doğrudan** render edilmesi gerekir (her `Inserter`'ın kendi `h-4`'ü + üstteki/alttaki dar boşluk, eski `space-y-4`'ün 16px'lik ritmini görsel olarak karşılamalı). Bu **kesinlikle bir state/layout implementasyon detayı** — ui-designer yalnızca hedef görünümü (§4.1) sabitler, kesin spacing matematiği frontend-agent'a bırakılır.

---

## 5. Kontrol barı: "+ Alta Yeni Konteyner Ekle" (TEK yeni aksiyon)

### 5.1 Çakışma/tekrar uyarısı (netleştirme — orkestratörün madde 4'ü)

Görev tanımındaki 3 aksiyondan **ikisi zaten mevcut**, **eklenmemeli**:

| Görev tanımındaki aksiyon | Durum | Not |
|---|---|---|
| "+ Alta Yeni Konteyner Ekle" | **YENİ** — bu bölümün konusu | Tek gerçekten yeni buton |
| "📋 Çoğalt" | **ZATEN VAR** — `Copy` ikonu, `aria-label="Konteyneri çoğalt"`, `title="Çoğalt (Duplicate)"` (`builder-canvas.tsx` satır ~508-517) | Dokunulmaz, tekrar eklenmez |
| "🗑️ Sil" | **ZATEN VAR** — `Trash2` ikonu, `aria-label="Konteyneri sil"` (`builder-canvas.tsx` satır ~550-552) | Dokunulmaz, tekrar eklenmez |

### 5.2 Davranış kararı — popover (tek tık varsayılan "Tek Sütun" DEĞİL)

**KESİN KARAR:** Buton tek tıkla sessizce "Tek Sütun" eklemez — §2/§3/§4'te kurulan **aynı `LayoutPresetPopoverGrid` popover'ını** açar. Gerekçe: (a) **tutarlılık** — üç farklı tetikleyicinin üçü de aynı etkileşim modelini paylaşırsa kullanıcı bir kez öğrenip her yerde uygular (Jakob's Law); "bazısı popover açar, bazısı sessizce varsayılan ekler" tutarsızlığı kafa karıştırır. (b) Kontrol barından ekleme, konumsal olarak en "kasıtlı" eylemdir (kullanıcı belirli bir konteynerin altına, belirli bir düzenle eklemek istiyor) — varsayılan tek-sütun + sonra elle "Konteynere Sar"/preset değiştirme gibi ekstra adımlar gerektirmesi, popover'ın tek tıkla sunduğu 7 seçenekten daha fazla sürtünme yaratır.

### 5.3 Konum ve ikon

Mevcut buton sırası: `Settings2` → `RevealEffectControl` (Popover) → `LayoutMenu` (unwrap) → `Copy` (çoğalt) → [`ArrowUpToLine` yalnızca bare] → `ArrowUp` → `ArrowDown` → `Trash2`.

**Yeni buton `Copy`'den hemen SONRA eklenir** (LayoutMenu/Copy/+Alta = "bu konteynerle ilgili yapısal yaratma aksiyonları" grubu; ArrowUp/ArrowDown = "taşıma"; Trash2 her zaman en sonda kalır — mevcut gruplamayla tutarlı):

```tsx
<LayoutMenu mode="unwrap" onSelect={() => ctx.onUnwrap(container.id)} />
<Button type="button" variant="ghost" size="icon-sm" aria-label="Konteyneri çoğalt" title="Çoğalt (Duplicate)" onClick={() => ctx.onDuplicate(container.id)}>
  <Copy />
</Button>
{/* YENİ */}
<Popover>
  <PopoverTrigger
    render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Alta yeni konteyner ekle" title="Alta yeni konteyner ekle" />}
  >
    <LayoutTemplate className="h-4 w-4" />
  </PopoverTrigger>
  <PopoverContent align="start" className="w-80">
    <LayoutPresetPopoverGrid disabled={atMaxDepth} disabledReason="Maksimum iç içe geçme derinliğine ulaşıldı (4)" onSelect={(preset) => ctx.onInsertSibling(container.id, preset)} />
  </PopoverContent>
</Popover>
{isBare && ( /* ArrowUpToLine — DEĞİŞMEDİ */ ... )}
```

`LayoutTemplate` ikonu — §3'teki ile **aynı ikon**, "yapı/konteyner ekleme" ailesinin tek görsel imzası korunur (kontrol barındaki diğer ikonlardan — `Settings2`, `Copy`, `Sparkles`, `Trash2` — belirgin şekilde ayırt edilir, çünkü hiçbiri "ekleme" anlamı taşımıyor; `Plus` DEĞİL, çünkü `Plus` zaten `AddContentMenu`'nün "içerik bloğu ekle" imzası — bkz. §6).

`disabled={atMaxDepth}` — bu konteynerin **kendisi** zaten derinlik 4'teyse (`Seviye 4 · Maks.` rozeti görünüyorsa), altına yeni bir konteyner eklemek onu da derinlik 4'e (aynı seviye, kardeş) koyar ki bu sorun değil — ancak preset çok-sütunluysa oluşan ALT konteynerler derinlik 5 olur, bu yüzden grid'in tamamı (§2.3'teki emsalle tutarlı olarak) devre dışı bırakılır.

---

## 6. Görsel ayrım: "içerik bloğu ekle" vs "konteyner/bölüm ekle" — asla karıştırılmamalı

| | İçerik bloğu ekle (`AddContentMenu`, mevcut) | Konteyner/bölüm ekle (bu doküman, yeni) |
|---|---|---|
| Etkileşim kabuğu | `DropdownMenu` (`role="menu"`) | `Popover` (yapısal grup, menü değil) |
| Tetikleyici ikonu | `Plus` | `LayoutTemplate` (kontrol barı/canvas-sonu) veya sade `Plus` yalnızca between-inserter'ın **dairesel** butonunda — ama bağlamı (ince çizgi + dairesel buton) zaten `LayoutPresetTile` grid'ini açtığını görsel olarak ayırt eder |
| Tetikleyici etiketi | "Eleman Ekle" / "Konteynere blok ekle" | "Yeni Konteyner Ekle" / "Alta yeni konteyner ekle" / "Aralarına yeni konteyner ekle" — **"Eleman"/"Blok" kelimesi HİÇ geçmez** |
| Popover/menü içeriği | Arama input'u + kategori sekmeleri + 2 kolonlu ikon+etiket grid'i (`blockRegistry`'den 23 blok) | Arama YOK, sabit 7 karolu `grid-cols-4`, her karo gerçek oran önizlemesi (mini flex-bar), ikon DEĞİL |
| Karo görseli | `Icon` (lucide, `text-primary`) + etiket | Mini flex-oranı önizlemesi (`bg-primary/25` bar'lar) + etiket — **hiçbir zaman bir lucide ikonu değil** |

Bu tablo iki ailenin **hem kelime hem kabuk hem karo görseli** düzeyinde asla örtüşmediğini garanti eder — kullanıcı "içerik ekliyorum" ile "yapı/bölüm ekliyorum" eylemlerini görsel olarak anında ayırt edebilir.

---

## 7. Erişilebilirlik özeti

| Tetikleyici | `aria-label` | Popover içeriği |
|---|---|---|
| Canvas sonu kutusu (§3.1) | `"Yeni Konteyner Ekle"` | `LayoutPresetPopoverGrid` |
| Boş durum CTA butonu (§3.2) | `"Yeni Konteyner Ekle"` (aynı metin, farklı kabuk — kullanıcı ikisini asla aynı anda görmez, çakışma yok) | `LayoutPresetPopoverGrid` |
| Between-inserter (§4) | `"Aralarına yeni konteyner ekle"` (kök ve iç içe için AYNI, sadeleştirme — konum zaten DOM sırasıyla belli) | `LayoutPresetPopoverGrid` |
| Kontrol barı "+Alta" (§5) | `"Alta yeni konteyner ekle"` | `LayoutPresetPopoverGrid` |
| Preset karosu (değişmedi) | `preset.label` (ör. `"İki Eşit Sütun"`) | — |

Her tetikleyici **her zaman DOM'da**, `disabled` olduğu durumlar hariç her zaman `tabIndex`'e girer (native `<button>`/`Button` primitiflerinin varsayılan davranışı — ekstra `tabIndex` yönetimi gerekmez). `focus-visible` halkası (`focus-visible:ring-3 focus-visible:ring-ring/50`) hem karolarda hem tetikleyicilerde **korunur** (`Button` bileşeninin kendi varsayılan `focus-visible` stiliyle zaten geliyor, between-inserter'ın özel dairesel butonunda da miras alınır). e2e testlerinin `getByRole("button", { name: preset.label })` sorgusu **hiçbir yerde bozulmaz** — karo semantiği tüm üç popover'da birebir aynı (`LayoutPresetPopoverGrid` tek kaynak).

---

## 8. Bileşen/dosya eşleme tablosu (frontend-agent için hızlı referans)

| UI parçası | Mevcut primitif | Yeni yerel bileşen (isim önerisi) | Hedef dosya |
|---|---|---|---|
| Preset ızgarası (3 tetikleyici ortak) | `Popover`/`PopoverContent` (mevcut, `RevealEffectControl` deseni) | `LayoutPresetPopoverGrid`, `LayoutPresetTile` (taşınan) | **yeni:** `frontend/src/components/admin/page-builder/container-inserter.tsx` |
| Canvas sonu + boş durum tetikleyicisi | `Button`/düz `<button>`, `Popover` | `NewContainerInserter` (`variant="appended"|"empty"`) | `container-inserter.tsx` |
| Konteynerler arası hover-inserter | `Button size="icon-sm"`, `Popover` | `BetweenContainersInserter` | `container-inserter.tsx` |
| Kontrol barı "+Alta" | `Button size="icon-sm"`, `Popover` (yerinde, ayrı bileşen değil) | — | `builder-canvas.tsx::ContainerCard` |
| Kaldırılan: sabit "DÜZEN" paneli | — | — | `block-list.tsx` (SİLİNİR), `layout-picker.tsx` (SİLİNİR) |

---

## 9. Doğrulanmış `lucide-react` ikon adları (bu dokümanda kullanılan, hepsi kodda mevcut/import edilmiş)

`LayoutTemplate` (zaten `builder-canvas.tsx` boş-durum hero'sunda kullanılıyor), `Plus` (zaten `add-content-menu.tsx`'te kullanılıyor). Yeni bir ikon **eklenmez.**

---

## 10. Kapsam dışı / frontend-agent'a bırakılanlar

Bu doküman şunları TANIMLAMAZ: (a) `ctx` arayüzüne eklenmesi gereken yeni callback'lerin (ör. `onInsertRoot(index, preset)`, `onInsertSibling(containerId, preset)`) kesin imzası/implementasyonu — yalnızca üç yeni tetikleyicinin **pozisyonel** bir ekleme çağrısına ihtiyaç duyduğu not edilir, mevcut `move`/`remove`/`duplicate`/`addChild` fonksiyonlarının yanına eklenmesi mantıklı görünüyor (`builder-canvas.tsx` içinde, `page.tsx`'e taşınmadan) ama bu bir mimari/state kararıdır, frontend-agent'a aittir; (b) `space-y-4` → explicit-interleave geçişinin kesin spacing matematiği (§4.5); (c) kök seviyede `MAX_CHILDREN_PER_CONTAINER`in uygulanıp uygulanmayacağı — mevcut davranışla aynı varsayım korunur, bu doküman yeni bir sınır icat etmez; (d) `onInsert`/`onInsertSibling` çağrılarının `containers.ts` ağaç-işlem katmanındaki gerçek implementasyonu. Bu doküman yalnızca **görsel/etkileşim katmanını** bağlar.
