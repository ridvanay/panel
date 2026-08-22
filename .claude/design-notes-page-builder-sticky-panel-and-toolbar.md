# Tasarım Notları: Page-Builder — Sağ Sabit Ayar Çekmecesi + Üst Kaydet/Taslak/Önizle Çubuğu

Ajan: **ui-designer** · Durum: **karar verildi, implementasyon frontend-agent'ta bekliyor**
Kapsam: `frontend/src/app/admin/pages/[pageId]/page.tsx` (yerleşim) + `frontend/src/components/admin/page-builder/container-settings-panel.tsx` (dış kabuk → `Sheet` kabuğuna taşınıyor, iç içerik değişmiyor). Bu doküman kod implementasyonu İÇERMEZ — kararları, somut sınıf adlarını ve örnek JSX iskeletini tanımlar.

**Önceki karar geçersiz kılınıyor:** `.claude/design-notes-page-builder-container-ui.md` §2.5 o zamanki kapsam için "kesin karar: sabit sağ panel, Sheet/modal YOK" demişti. Bu görevde kullanıcı özellikle sağdan kayan sabit bir çekmece istiyor; §2.5'teki o karar bu notla **AÇIKÇA GEÇERSİZ KILINIYOR**. Panelin İÇERİĞİ (üç `SettingsSection`, `StyleSection` deseni vb.) aynen korunuyor — değişen yalnızca panelin sayfa düzenindeki konumu/kabuğu.

---

## 1) Konteyner Ayar Paneli → Sağ Sabit Çekmece (`Sheet`)

### Karar
`ContainerSettingsPanel` artık `lg:grid-cols-[1fr_320px]` ızgarasının ikinci sütununda DEĞİL, `frontend/src/components/ui/sheet.tsx`'teki genel `Sheet`/`SheetContent(side="right")` bileşenleriyle sarmalanmış bağımsız bir katmanda (`fixed inset-y-0 right-0`) render edilir. Canvas artık tam genişlik kullanır.

Bu proje zaten aynı deseni `frontend/src/components/ui/sidebar.tsx`'in mobil sidebar'ında kullanıyor (`SheetContent` + görsel olarak gizli `SheetHeader`/`SheetTitle`, kendi içerik gövdesi kendi başlığını basıyor, `showCloseButton`/`[&>button]:hidden` ile çift kapatma düğmesi engelleniyor) — aşağıdaki tarif BİREBİR bu kanıtlanmış deseni izliyor, yeni bir yaklaşım icat etmiyor.

### 1.1 `page.tsx` — canvas + drawer

`grid gap-4 lg:grid-cols-[1fr_320px]` ızgarası KALDIRILIR (satır 500 civarı). Yerine:

```tsx
<div className="mt-4">
  <BuilderCanvas
    key={`${isDefaultLocale ? "default" : locale}-${editorGeneration}`}
    nodes={activeNodes}
    onChange={setActiveNodes}
    selectedContainerId={selectedContainer?.id ?? null}
    onSelectContainer={setSelectedContainerId}
  />
</div>

<Sheet
  open={selectedContainer !== null}
  onOpenChange={(open) => {
    if (!open) setSelectedContainerId(null);
  }}
>
  <SheetContent side="right" showCloseButton={false} className="p-0 sm:max-w-[420px]">
    <SheetHeader className="sr-only">
      <SheetTitle>Konteyner Ayarları</SheetTitle>
      <SheetDescription>Seçili konteynerin düzen, boşluk, arka plan ve ayırıcı ayarları.</SheetDescription>
    </SheetHeader>
    {selectedContainer && (
      <ContainerSettingsPanel
        container={selectedContainer}
        depth={selectedContainerDepth}
        onChange={(patch) => setActiveNodes(updateContainerSettings(activeNodes, selectedContainer.id, patch))}
        onClose={() => setSelectedContainerId(null)}
      />
    )}
  </SheetContent>
</Sheet>
```

Not: `BuilderCanvas`'ı saran eski `<div className="min-w-0">` gerekmez (artık tek sütun) — istenirse korunabilir, görsel bir fark yaratmaz.

**Neden `SheetHeader` `sr-only`, ayrı görünür başlık YOK:** `ContainerSettingsPanel`'in kendi iç başlığı zaten var ("Konteyner Ayarları" + seviye rozeti + X kapat düğmesi, satır ~745-755). Bunu iki kez göstermemek için `Sheet`'in kendi başlığı yalnızca ekran okuyucular için (`sr-only`) tutulur — `base-ui` `Dialog`'un erişilebilirlik gereksinimi (bir `Title`/`Description` olması) böylece karşılanır ama görsel olarak tek başlık kalır. `sidebar.tsx`'teki `SheetHeader className="sr-only"` ile birebir aynı desen.

**Neden `showCloseButton={false}`:** `SheetContent` kendi X düğmesini (`absolute top-3 right-3`) basıyor; `ContainerSettingsPanel`'in de kendi X'i var (`onClose`, aynı işlevi görüyor). İkisi birlikte render edilirse aynı köşede iki çakışan kapatma düğmesi olur — panelin kendi X'i (zaten seviye rozetiyle aynı satırda, daha bilgilendirici) kalır, `Sheet`'in varsayılan X'i kapatılır.

**Genişlik:** `SheetContent`'in varsayılanı `data-[side=right]:sm:max-w-sm` (~384px). Mevcut panel içeriği (2×2 padding/margin ızgarası, renk seçiciler, segmented toggle'lar) 320px sabitte bile sıkışıktı; 384px de yeterince ferah değil. `className="sm:max-w-[420px]"` ile override et — `w-3/4` taban sınıfı `max-w` ile zaten kısıtlandığından (`min(75vw, 420px)`) yalnızca `max-w`'yi override etmek yeterli, `width` sınıflarına dokunmaya gerek yok. Mobilde (`<640px`) taban `w-3/4` davranışı aynen kalır (tam ekran çekmeceye yakın, kabul edilebilir).

### 1.2 `container-settings-panel.tsx` — dış kabuk değişimi + iç scroll

Panelin İÇERİĞİ (dört `SettingsSection`: Düzen/Boşluk/Arka Plan/Ayırıcılar) **DEĞİŞMİYOR**. Yalnızca en dıştaki wrapper `div` ve onun hemen altındaki başlık satırı, kart-kabuğu sınıflarından (`rounded-xl border border-border bg-card p-4 shadow-sm`) çekmece-kabuğu sınıflarına geçiyor ve içerik bölümü `overflow-y-auto` alıyor (artık sabit yükseklikli — `h-full` — bir çekmece içinde olduğu için).

Şu anki kök (satır 744):
```tsx
<div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
  <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
    {/* başlık + rozet + X */}
  </div>
  {tooManyForReadability && (...)}
  <SettingsSection title="Düzen" first>...</SettingsSection>
  <SettingsSection title="Boşluk">...</SettingsSection>
  <SettingsSection title="Arka Plan">...</SettingsSection>
  <SettingsSection title="Ayırıcılar">...</SettingsSection>
</div>
```

Yeni kök:
```tsx
<div className="flex h-full flex-col bg-card">
  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
    {/* başlık + rozet + X — İÇERİK DEĞİŞMİYOR */}
  </div>
  <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
    {tooManyForReadability && (...)}
    <SettingsSection title="Düzen" first>...</SettingsSection>
    <SettingsSection title="Boşluk">...</SettingsSection>
    <SettingsSection title="Arka Plan">...</SettingsSection>
    <SettingsSection title="Ayırıcılar">...</SettingsSection>
  </div>
</div>
```

Yani: `rounded-xl border bg-card p-4 shadow-sm` → `flex h-full flex-col bg-card` (köşe yuvarlama/gölge gereksiz, `Sheet` zaten kendi `shadow-lg`/`border-l`'ini basıyor); başlık satırı `pb-3` → `shrink-0 ... px-4 py-3` (padding artık kendi satırında, dıştan gelmiyor); geri kalan tüm bölümler yeni bir `flex-1 overflow-y-auto px-4 py-4` sarmalayıcıya taşınıyor (başlık sabit kalır, yalnızca gövde kaydırılır — uzun panelde "başlığı/kapatma düğmesini kaybetme" olmaz).

### 1.3 Form state kaybı riski — YOK, doğrulama

`ContainerSettingsPanel` tamamen **controlled**: tüm görünür değerler (`settings.layout`, `settings.padding`, `settings.background`, vb.) prop olarak `container.settings`'ten geliyor (bu da `page.tsx`'teki `activeNodes` state'inin bir dilimi) ve her değişiklik `onChange(patch)` ile doğrudan parent state'e yazılıyor. `Sheet` kapanıp `ContainerSettingsPanel` unmount olsa bile hiçbir GERÇEK VERİ kaybolmaz — çünkü veri zaten component'in kendisinde değil, parent'ta yaşıyor; yeniden `open` olduğunda aynı `container.settings`'ten okunur.

Tek local `useState`, `SpacingBoxControl` içindeki `linked` (kenarları bağlama) toggle'ı — bu bir VERİ değil, geçici bir editör kolaylığı anahtarı. Bu davranış YENİ DEĞİL: panel önceden de `{selectedContainer && (...)}` koşuluyla conditional render ediliyordu (satır 510), yani panel kapanıp açıldığında `linked` zaten sıfırlanıyordu — `Sheet`'e geçiş bu konuda hiçbir REGRESYON yaratmıyor, mevcut davranış birebir korunuyor. qa-agent bunu ayrı bir bug olarak raporlamamalı.

---

## 2) Sticky Üst Çubuk — Taslak / Kaydet / Önizle

### 2.1 Üst offset — `AdminTopbar` çakışma kontrolü

`frontend/src/app/admin/layout.tsx` → `AdminTopbar` zaten `sticky top-0 z-10` (bkz. `frontend/src/components/admin/topbar.tsx` satır 70: `className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-surface/80 px-4 py-3 shadow-sm backdrop-blur-xl"`). Sayfa içeriği bu topbar'ın ALTINDA, aynı pencere kaydırma bağlamında akıyor (ne `SidebarInset` ne de `admin/layout.tsx`'teki `<main>` kendi `overflow-y-auto` kaydırma bağlamı tanımlıyor — kaydırma pencere/`window` seviyesinde gerçekleşiyor). Bu yüzden yeni sticky çubuğumuz `top-0` KULLANAMAZ — topbar'ın arkasına/üstüne binip onunla çakışır.

Topbar'ın gerçek yüksekliği: `py-3` (12px + 12px = 24px) + içindeki en yüksek öğe (ikon düğmeler/Avatar ~32px) + `border-b` (1px) ≈ **56–58px**. Buna en yakın Tailwind spacing basamağı `top-14` (3.5rem = 56px). **Başlangıç değeri olarak `top-14` kullan**; frontend-agent tarayıcıda görsel doğrulama yapmalı — 1-2px'lik bir boşluk/örtüşme görülürse `top-14` yerine kesin `top-[57px]` gibi arbitrary bir değere geçilebilir. Bu tek ayarlanabilir sayı dışında tasarım kararı sabit.

Çubuğun `z-index`'i topbar'ın `z-10`'undan yüksek olmalı ki altındaki `Card`/`Tabs` içeriğinin üzerinde kalsın: **`z-20`**.

### 2.2 Yerleşim ve sınıflar

Mevcut başlık satırı (satır 349-379) şu şekilde sarmalanır — İÇERİK (başlık, görüntülenme metni, `hasUnsavedChanges` rozeti) korunur, yalnızca dıştan `sticky` bir kabuk eklenir ve sağ tarafa iki yeni buton + önizleme butonu girer:

```tsx
<div className="sticky top-14 z-20 border-b border-border bg-surface/95 py-3 backdrop-blur">
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-2">
      <div>
        <h1 className="admin-h1">Sayfa Düzenleyici</h1>
        <p className="mt-1 admin-text-secondary">{/* değişmedi */}</p>
      </div>
      {hasUnsavedChanges && (
        <Badge tone="primary">
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          Kaydedilmemiş değişiklik
        </Badge>
      )}
    </div>

    <div className="flex flex-wrap items-center gap-2">
      {saving && <span className="text-xs text-foreground/60">Kaydediliyor…</span>}
      {autosaveStatus === "saving" && (
        <span className="text-xs text-foreground/40">Taslak kaydediliyor…</span>
      )}
      {autosaveStatus === "saved" && autosaveSavedAt && (
        <span className="text-xs text-foreground/40">
          Taslak kaydedildi{" "}
          {new Date(autosaveSavedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
      {autosaveStatus === "error" && (
        <span title="Taslak otomatik kaydedilemedi. 'Kaydet' butonuyla elle kaydedebilirsiniz.">
          <AlertTriangle
            className="h-3.5 w-3.5 text-warning/70"
            aria-label="Taslak otomatik kaydedilemedi. 'Kaydet' butonuyla elle kaydedebilirsiniz."
          />
        </span>
      )}

      <Button variant="ghost" onClick={() => setDeleteDialogOpen(true)}>
        Sil
      </Button>

      <span className="h-5 w-px bg-border" aria-hidden />

      <Button
        variant="secondary"
        disabled={status === "DRAFT"}
        title={status === "DRAFT" ? "Sayfa zaten taslak" : undefined}
        onClick={handleSaveAsDraft}
      >
        Taslak Olarak Kaydet
      </Button>

      {status === "PUBLISHED" ? (
        <Button
          variant="outline"
          render={<Link href={`/${slug}`} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Önizle
        </Button>
      ) : (
        <Button variant="outline" disabled title="Önizlemek için sayfa önce yayınlanmalı">
          <ExternalLink className="h-3.5 w-3.5" />
          Önizle
        </Button>
      )}

      <Button className="relative" loading={saving} onClick={handleSave}>
        {hasUnsavedChanges && (
          <span
            className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary"
            aria-hidden
          />
        )}
        Kaydet
      </Button>
    </div>
  </div>
</div>
```

Not: `Button`'ın `render` prop'u projede zaten `DropdownMenuTrigger render={<Button .../>}` gibi yerlerde kullanılan `base-ui` deseni — burada tam tersi (bir `Button`'ı `Link` olarak render etme) için `content-list-table.tsx`'teki `DropdownMenuItem render={<Link href={viewHref(item)} .../>}` deseniyle aynı mantık uygulanıyor. `ExternalLink` ikonu `lucide-react`'tan içe aktarılmalı (proje zaten tek ikon kaynağı kullanıyor, kural ihlali yok).

### 2.3 Kararların gerekçesi

- **"Taslak Olarak Kaydet" görünürlüğü:** her zaman görünür, `status === "DRAFT"` iken `disabled` + `title="Sayfa zaten taslak"`. Butonu tamamen gizlemek yerine devre dışı bırakmak, kullanıcının "bu eylem burada var, şu an anlamsız" bilgisini korur (buton her açılışta yer değiştirmez, göz alışkanlığı bozulmaz) — `viewHref` konvansiyonundaki "yalnızca koşul sağlanınca göster" farklı bir bağlamda (liste satırı, yoğun UI) mantıklıydı; burada tek bir sabit araç çubuğunda buton sayısının stabil kalması tercih edildi.
- **"Kaydet" metni sabit kalır** (`handleSave`, mevcut `status` select değerine göre DRAFT/PUBLISHED/SCHEDULED kaydeder) — duruma göre "Yayınla" gibi değişen bir metin İCAT EDİLMEDİ, mevcut davranışla bire bir tutarlılık için.
- **Dikkat çekici nokta (`bg-primary` `h-2 w-2` dot):** `hasUnsavedChanges` true iken `Kaydet` butonunun sağ üst köşesinde render edilir; metin rozeti (`Badge tone="primary"`) KALDIRILMADI, ikisi birlikte var — rozet "neden" bilgisini taşır (okunabilir metin), nokta ise butonun kendisine göz ucuyla bakıldığında da fark edilmesini sağlar (iki farklı okuma mesafesi/dikkat seviyesi için tamamlayıcı, çelişmeyen iki sinyal).
- **"Sil" ile yeni üçlü arasına ince dikey ayraç (`h-5 w-px bg-border`):** yıkıcı eylem (Sil) ile kaydetme/yayın akışının (Taslak/Önizle/Kaydet) yan yana aynı görsel ağırlıkta durup karışmasını önler — kullanıcı yanlışlıkla "Sil"e tıklama riskini azaltan ucuz ve düşük riskli bir ayrım.
- **`Önizle` konvansiyonu:** proje genelinde `content-list-table.tsx` yalnızca `status === "PUBLISHED"` iken linki RENDER EDİYOR (liste satırında, yoğun/tekrarlı UI — görünürlük gürültüsünü azaltmak mantıklı). Page builder'ın tek, sabit araç çubuğunda ise DAİMA görünen ama `disabled` + açıklayıcı `title` içeren bir buton tercih edildi — kullanıcı "önizleme neden yok" sorusunu kendi kendine sormasın, buton orada dursun ve NEDEN pasif olduğunu anında görsün. Bu, görevde açıkça istenen davranış.
- **Alt sticky çubuk (satır 644-670) TAMAMEN KALDIRILIR** — "Kaydediliyor…"/otomatik-kaydetme durum metni + `[Kaydet]` butonu artık üstteki çubukta. Frontend-agent bu bloğu `page.tsx`'ten siler:
  ```tsx
  <div className="sticky bottom-6 z-10 flex justify-end">
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
      {/* ... tüm autosave + Kaydet butonu ... */}
    </div>
  </div>
  ```
  Bu blok kaldırılınca kök `<div className="space-y-6 pb-24">`'deki `pb-24` (eski alt çubuğa yer açmak için eklenmişti) artık gereksiz — normal sayfa alt boşluğuna (`pb-6` veya proje genelinde kullanılan eşdeğerine) düşürülmeli.
- **Üç sekmede de sabit mi:** **EVET, üç sekmede de sabit kalır** — çünkü bu çubuk `<Tabs>` bileşeninin DIŞINDA, en üstte zaten mevcuttu (satır 349-379, `<Tabs>` satır 390'dan önce). Herhangi bir ek iş gerektirmeden bu konum korunduğu sürece çubuk İçerik/SEO/Geçmiş Sürümler sekmeleri arasında geçişte otomatik olarak sabit kalır. Gerekçe: `handleSave` zaten tüm alanları (başlık/slug/durum + SEO alanları) tek çağrıda gönderiyor — kullanıcı SEO sekmesindeyken de "Kaydet"e erişebilmeli, aksi halde kaydetmek için önce İçerik sekmesine dönmesi gerekir ki bu gereksiz bir sürtünme olur.
- **`Ctrl+S`/`Cmd+S`:** salt davranışsal bir ekleme (tarayıcının varsayılan "Sayfayı Kaydet" iletişim kutusunu `preventDefault()` ile engelleyip `handleSave()`'i tetikleyen bir `keydown` dinleyicisi) — görsel bir karar gerektirmiyor, frontend-agent bunu ekler.

---

## Bileşen/dosya eşleme tablosu

| Değişiklik | Dosya | Not |
|---|---|---|
| Canvas + sağ panel ızgarası kaldırılır, canvas tam genişlik olur | `frontend/src/app/admin/pages/[pageId]/page.tsx` (~satır 500-521) | `grid gap-4 lg:grid-cols-[1fr_320px]` silinir |
| `ContainerSettingsPanel` → `Sheet`/`SheetContent(side="right")` ile sarmalanır | `frontend/src/app/admin/pages/[pageId]/page.tsx` | §1.1'deki JSX; `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle`/`SheetDescription` import edilmeli (`@/components/ui/sheet`) |
| Panelin dış kabuğu (`rounded-xl border ... p-4 shadow-sm`) çekmece kabuğuna (`flex h-full flex-col`) dönüşür, gövdeye `overflow-y-auto` eklenir | `frontend/src/components/admin/page-builder/container-settings-panel.tsx` (satır 744 ve başlık satırı) | §1.2; iç `SettingsSection`'lar DEĞİŞMEZ |
| Üst başlık satırı `sticky top-14 z-20` çubuğa dönüşür, `[Taslak Olarak Kaydet]`/`[Önizle]` butonları + Kaydet üzerinde uyarı noktası eklenir | `frontend/src/app/admin/pages/[pageId]/page.tsx` (~satır 349-379) | §2.2; `ExternalLink` ikonu `lucide-react`'tan eklenir |
| Alt `sticky bottom-6` çubuk tamamen silinir, `pb-24` → `pb-6` | `frontend/src/app/admin/pages/[pageId]/page.tsx` (~satır 338, 644-670) | §2.3 |
| `handleSaveAsDraft` (mevcut `updatePage`'i `status: "DRAFT"` ile çağıran fonksiyon) eklenir | `frontend/src/app/admin/pages/[pageId]/page.tsx` | Yeni backend endpoint'i GEREKMİYOR — frontend-agent işi, görsel karar değil |
| `Ctrl+S`/`Cmd+S` → `handleSave()` kısayolu | `frontend/src/app/admin/pages/[pageId]/page.tsx` | Davranışsal, görsel karar gerektirmiyor |
