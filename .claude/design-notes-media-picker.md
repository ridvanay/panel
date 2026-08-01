# Tasarım Notları: `<MediaPicker>`

Ajan: ui-designer
Kapsam: Sadece tasarım/UX kararları. Kod implementasyonu frontend-agent'a aittir.
Görsel yön: Bu proje **Minimal/Flat** çizgide (standart `bg-popover` / `border-border` / `ring-foreground/10` token'ları, `Dialog` bileşeninin varsayılan yüzeyi) — MediaPicker modalı da bu çizgiyi korur, glassmorphism/glow eklenmez (Ayarlar sayfasının bento/glow estetiği İSTİSNAİ bir yüzeydir, bkz. madde 7).

---

## 0. Bileşen sözleşmesi (öneri)

```tsx
// frontend/src/components/admin/media/media-picker.tsx
interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (media: Media) => void; // seçim anında çağrılır, dialog da kapanır
}
```

- `MediaPicker`, `image-upload-field.tsx` ile aynı klasörde (`frontend/src/components/admin/media/`) yeni bir dosyada yaşar.
- `ImageUploadField`'in public prop arayüzü DEĞİŞMEZ (`id, label, value, onChange, required`) — `MediaPicker` tamamen `ImageUploadField`'in içinde, kendi lokal `open` state'iyle yönetilir. Dışarıdan (ör. Ayarlar sayfası, Sayfa formu) hiçbir ek prop geçirilmesi gerekmez.
- `Media` tipi zaten `frontend/src/lib/api/types.ts` içinde tanımlı (`id, url, filename, mimeType, sizeBytes, createdAt`) — aynen kullanılır.

---

## 1. Modal iskeleti

- `Dialog` / `DialogPortal` / `DialogOverlay` üzerine kurulur (mevcut `@/components/ui/dialog`, değişiklik gerekmiyor).
- `DialogContent` için varsayılan `sm:max-w-sm` YETERSİZ — override: `className="max-w-3xl p-0 gap-0"` (768px). Gerekçe: 4-5 kolonluk kare thumbnail grid'i için `max-w-md`/`max-w-sm` çok dar kalır, `max-w-3xl` hem masaüstünde ferah bir grid hem de mobilde (`max-w-[calc(100%-2rem)]` zaten devrede) sorunsuz daralır.
- `p-0` ile varsayılan `DialogContent` iç padding'i kaldırılır; iç düzen 3 dikey bölüme ayrılır (aşağıya bkz.), her biri kendi padding'ini yönetir. Bu, arama/yükle satırının **sticky** kalabilmesi ve grid'in bağımsız scroll edebilmesi için gerekli.
- Dış çerçeve: `flex max-h-[85vh] flex-col`.
  1. **Header** (`p-4 pb-3`): `DialogTitle` = "Görsel Seç", `DialogDescription` = "Kütüphaneden bir görsel seçin veya yeni bir görsel yükleyin."
  2. **Araç çubuğu** (`px-4 pb-3 border-b border-border`, sticky — scroll alanının DIŞINDA, header'ın hemen altında sabit): arama input'u + "Yükle" butonu (madde 4 ve 5).
  3. **Grid alanı** (`flex-1 overflow-y-auto p-4 min-h-[320px]`): thumbnail grid veya boş/durum ekranları.
- `DialogFooter` KULLANILMAZ. Gerekçe: seçim tek tıkla anında gerçekleşip modalı kapattığı için ayrı bir "Onayla/İptal" adımına gerek yok; kullanıcı vazgeçmek isterse `Esc`/backdrop/`X` (mevcut `showCloseButton`) ile kapatır.

---

## 2. "Kütüphane" / "Yeni Yükle" modu: Tabs KULLANILMAZ

**Karar:** Modal tek bir görünüm sunar — varsayılan ve TEK görünüm her zaman kütüphane grid'idir. "Yeni Yükle", araç çubuğundaki bir butonun (native dosya seçici açan) tetiklediği bir **aksiyon**dır, ayrı bir sekme/görünüm DEĞİLDİR.

Gerekçe:
- `Tabs` (settings/page.tsx deseni), kullanıcıyı iki ayrı "ekran" arasında geçirir; burada amaç tek bir görsel seçmek olduğundan gereksiz bir zihinsel adım ekler.
- Modal içinde `admin/media/page.tsx`'teki gibi tam bir drag-drop dropzone'u yeniden üretmek (madde 5'te detaylandırıldığı gibi) hem yer kaplar hem de küçük modal içinde debe/karmaşıklık yaratır.
- Native dosya seçici (`<input type="file">` + `fileInputRef.current?.click()`), `ImageUploadField`'in zaten kullandığı, kanıtlanmış ve basit bir desendir — aynı deseni burada da kullanmak tutarlılık sağlar.
- Sonuç: kullanıcı modalı açar → doğrudan mevcut görselleri görür → ya birine tıklar (seçilir, kapanır) ya da "Yükle" butonuna basıp bilgisayarından dosya seçer (yüklenir, otomatik seçilir, kapanır). Tek akış, tek zihinsel model.

---

## 3. Grid tasarımı ve seçim davranışı

- **Masonry DEĞİL, sabit kare grid.** Gerekçe: `admin/media/page.tsx`'teki `columns-N` masonry deseni değişken yükseklikli kartlar üretir; modal içinde sınırlı/scroll'lu bir alanda bu, göz taramasını ve tıklama hedefini öngörülemez kılar. Modal bağlamında yoğunluk ve tarama hızı, görsel çeşitliliğe göre önceliklidir.
- Grid: `grid grid-cols-3 sm:grid-cols-4 gap-3`.
- Her hücre: `<button>` (erişilebilirlik için gerçek buton, `aria-label={media.filename + " seç"}`), `aspect-square overflow-hidden rounded-lg border border-border`, içinde `<img className="h-full w-full object-cover">`.
- **Seçim = tek tıkla seç-ve-kapat.** Ekstra "Onayla" butonu YOK, hover'da beliren ayrı bir "Seç" butonu YOK — tıklanan hücrenin `onClick`'i doğrudan `onSelect(media)` çağırır ve `onOpenChange(false)` ile modalı kapatır. Bu, görevde belirtilen "seçim yapıldığında önizleme anında güncellensin" beklentisiyle birebir uyumlu.
- Hover/focus geri bildirimi (buton olmasa da affordance için): `hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring transition` + hafif `hover:scale-[1.03]`. Dosya adı grid'de metin olarak YAZILMAZ (yoğunluk için) — `title={media.filename}` native tooltip yeterli minimum.
- Seçili/aktif değer varsa (yani `ImageUploadField`'in mevcut `value`'su bu medyalardan birinin URL'siyle eşleşiyorsa) o hücre `ring-2 ring-primary` ile işaretli gösterilebilir (nice-to-have, zorunlu değil).

---

## 4. Arama input'u

- Konum: araç çubuğunda (madde 1.2), grid'in ÜSTÜNDE, sticky (scroll alanı dışında sabit kalır).
- Bileşen: `InputGroup` + `InputGroupAddon` (Search ikonu) + `InputGroupInput` — `frontend/src/app/admin/pages/page.tsx` (satır ~108-119) ile birebir aynı desen, genişlik `w-full sm:max-w-xs`.
- Placeholder: `"Dosya adına göre ara…"`, `aria-label="Dosya adına göre ara"`.
- Filtreleme: client-side, `media.filename` üzerinde case-insensitive `includes` (backend/db değişikliği yok, mimari karar zaten belirlenmiş).
- Sonuç yoksa: `EmptyState` — `icon={Search}`, `title="Sonuç bulunamadı"`, `description={\`"${query}" ile eşleşen bir görsel yok.\`}`. Modal içinde kenarlık gereksiz olduğundan `className="border-none p-8"` ile dış `border-dashed` kaldırılır (zaten modal kendi sınırına sahip, iç içe iki çerçeve görsel gürültü yaratır).
- Kütüphane tamamen boşsa (hiç medya yoksa, arama yapılmamışken): `EmptyState` — `icon={ImageIcon}`, `title="Henüz görsel yüklenmedi"`, `description="Bilgisayarınızdan bir görsel yükleyerek başlayın."`, `action={<Button onClick={...}>Görsel Yükle</Button>}` (aynı yükleme tetikleyicisini kullanır) — `admin/media/page.tsx`'teki boş durum metniyle terminolojik tutarlılık.

---

## 5. "Yeni Yükle" davranışı

- **Dropzone YOK.** Araç çubuğunda arama input'unun yanında tek bir `Button` (`variant="secondary"`, ikon `UploadCloud`, metin "Yükle") — tıklanınca gizli `<input type="file" accept="image/*">` tetiklenir (mevcut `ImageUploadField` deseniyle birebir aynı). Gerekçe: madde 2'de açıklandı — modal küçük ve tek amaçlı, drag-drop'un getirdiği ekstra state (dragActive, dragCounter vb.) ve görsel alan burada gereksiz karmaşıklık.
- **Tek dosya.** `<input>` için `multiple` KULLANILMAZ (admin/media/page.tsx'in çoklu yükleme senaryosundan farklı olarak, MediaPicker'ın amacı TEK bir görsel seçmek/kullanmaktır).
- **Yükleme sırasında:** "Yükle" butonu `loading` durumuna geçer (mevcut `Button` bileşeninin `loading` prop'u), buton disabled olur.
- **Yükleme başarılı olduğunda:** Otomatik olarak `onSelect(media)` çağrılır VE modal kapanır (`onOpenChange(false)`) — kütüphane grid'ine dönüp kullanıcının tekrar tıklaması İSTENMEZ. Gerekçe (görevde de ima edildiği gibi): kullanıcı bir görseli spesifik olarak bu alan için yüklüyor, yükledikten hemen sonra onu kullanmak istediği makul varsayım; ekstra bir tıklama adımı sürtünme yaratır.
- **Yükleme başarısız olduğunda:** Modal AÇIK kalır, araç çubuğunun altında `Alert variant="error"` (veya mevcut `friendlyErrorMessage` ile aynı desen) gösterilir, kullanıcı tekrar deneyebilir.

---

## 6. `ImageUploadField`'in yeni hâli (3 buton düzeni)

Sıra (soldan sağa, mantıksal öncelik: önce mevcut olanı kullan, sonra yeni yükle):

```
[ URL Input (flex-1) ]  [ Kütüphaneden Seç ]  [ Yükle ]
```

- **"Kütüphaneden Seç" butonu**, mevcut `Input` (URL) ile "Yükle" butonu arasına eklenir (3. buton olarak değil, ortaya) — gerekçe: kullanıcı akışında "önce var olanı dene, yoksa yeni yükle" doğal sıralama; URL'yi manuel yapıştırmak zaten en solda kalan birincil/gelişmiş kullanım.
- Buton: `variant="secondary"`, ikon `Images` (lucide-react, çoklu fotoğraf yığını — "Yükle" butonunun `UploadCloud` ikonundan görsel olarak net ayrışır), metin "Kütüphaneden Seç". Tıklanınca `MediaPicker`'ı açar (`mediaPickerOpen = true`); `onSelect` callback'i `onChange(media.url)` çağırıp modalı kapatır.
- **Responsive/mobil davranış:** Konteyner `flex gap-2` yerine `flex flex-wrap gap-2` olur; `Input` için `min-w-[160px] flex-1 basis-full sm:basis-auto` (dar genişlikte URL input'u tam genişlik alıp buton ikilisi altına sarar, geniş ekranda aynı satırda kalır). Butonlar dar alanda (`ImageUploadField` küçük bir form alanı olarak kullanıldığında, ör. sidebar/dar sütun) **ikon+metin yerine sadece ikon** gösterir: metin `<span className="hidden sm:inline">` ile sarılır, `aria-label` her zaman tam metni taşır (erişilebilirlik korunur). Bu, 3 butonun (URL alanı hariç) sıkışmadan yan yana durmasını sağlar.
- Görsel önizleme (`<img>`, mevcut `h-32 w-full` kutu) davranışı DEĞİŞMEZ; hem manuel URL girişinde hem kütüphaneden seçimde hem yüklemede aynı önizleme anında güncellenir (zaten `value` prop'una bağlı olduğu için otomatik).

---

## 7. Ayarlar sayfası (bento tema) içinde görünüm — küçük tutarsızlık kabul edilir, prop eklenmez

**Karar:** `ImageUploadField`'e bento-uyumlu bir `variant`/`className` prop'u EKLENMEZ; standart token'larıyla (`text-foreground`, `border-border`, `bg-input` vb.) olduğu gibi Ayarlar sayfasına entegre edilir.

Gerekçe:
- `MediaPicker` modalının kendisi zaten `Dialog`'un standart `bg-popover`/`ring-foreground/10` yüzeyini kullanır — bu, projede `ConfirmDialog`, `MediaPreviewDialog` gibi tüm diğer modallarla aynı emsaldir; hiçbir modal, tetiklendiği sayfanın (bento veya değil) temasına göre şekil değiştirmez. Modal = ayrı bir yüzey katmanı, sayfa temasından bağımsız olması BEKLENEN davranıştır.
- `ImageUploadField`'in kendisi (satır içi önizleme + input + butonlar) Ayarlar sayfasında bugün zaten bento olmayan standart görünümüyle var olacak bir bileşen haline gelecek (mevcut Ayarlar'daki bespoke logo implementasyonunun REFAKTÖR edilme kararı — mimari karar zaten verilmiş) — bu, `siteName`/`homePageId` gibi diğer bento alanlarıyla kıyasla küçük bir görsel "dikiş" (seam) yaratacaktır (standart `border-border` vs `border-bento-border`).
- Bu dikiş kabul edilebilir çünkü: (a) görev tanımında "fazla mühendislik yapma" uyarısı açık, (b) tek bir prop/varyant eklemek `ImageUploadField`'i 6 kullanım yerinden 5'i için gereksiz karmaşıklaştırır, (c) görsel etki sınırlı — sadece bir form alanının border/metin rengi tonu, layout/işlevsellik etkilenmiyor.
- İleride istenirse (bu görevin kapsamı DIŞINDA): `ImageUploadField`'e opsiyonel `inputClassName`/`fieldVariant?: "default" | "bento"` eklenip Ayarlar sayfasında `bento` varyantı verilebilir — ama bu şimdi YAPILMAYACAK, ayrı/küçük bir polish görevi olarak not düşülür.

---

## Özet — frontend-agent için uygulama kontrol listesi

1. Yeni dosya: `frontend/src/components/admin/media/media-picker.tsx` — `Dialog` tabanlı, `max-w-3xl p-0 gap-0`, sticky arama+yükle araç çubuğu + `overflow-y-auto` kare grid, `Tabs` yok, `DialogFooter` yok.
2. `image-upload-field.tsx` içine `MediaPicker` entegre edilir, 3 buton sırası: URL Input → "Kütüphaneden Seç" (`Images` ikonu) → "Yükle" (`UploadCloud` ikonu), `flex flex-wrap`, dar alanda ikon-only + `aria-label`.
3. Ayarlar sayfasındaki bespoke logo yükleme bloğu (satır ~487-513) `ImageUploadField` ile değiştirilir (`id="logoUrl"`), bento token stil farkı kabul edilir, ek prop yazılmaz.
4. Yeni Sayfa formuna (`pages/new/page.tsx`), `pages/[pageId]/page.tsx`'teki `ogImageUrl` alanıyla birebir aynı `ImageUploadField` (`id="ogImageUrl"`, label "Sosyal medya (OG) görseli") eklenir.
5. Diğer 4 kullanım yeri (navigasyon, blog new/[postId], hero-block, image-block) kod değişikliği gerektirmeden MediaPicker'ı otomatik kazanır.
