# Tasarım Notu — İçerik Listesi "Hızlı Düzenle" Satırı

**Kapsam:** `frontend/src/components/admin/content-list/content-list-table.tsx` — masaüstü tablo satırı (~90-190) ve mobil kart formu (~300-372).
**Görsel yön:** Bu bileşen zaten **Minimal/Flat** dilinde (düz `bg-card`/`bg-muted`, ince border, blur/glow yok). Quick-edit satırı da bu dile sadık kalmalı — cam efekti/gradyan/glow EKLENMEYECEK, sadece `primary` tonunun soluk bir tint'i + net border ile "vurgulanmış satır" hissi verilecek.

Renk referansları (`globals.css`): `--primary` (light: `#4f46e5`, dark admin: `var(--accent-600, #4f46e5)`/`var(--accent-500, #6366f1)`), `--danger` (`#b91c1c` light / `#f87171` dark), `--muted`, `--border`, `--card`.

---

## 1) Durum Select genişliği (bug fix)

**Karar:** Quick-edit satırındaki (SADECE bu context — normal satırdaki `Badge`'e dokunma) `Durum` `<Select>` bileşenine `className="min-w-36"` ekle (Select'in kendi taban class'ı `w-full min-w-0` içeriyor; `tailwind-merge` `min-w-0` → `min-w-36` olarak override edecek, çünkü `className` prop'u `cn()` çağrısında ikinci/son argüman).

**Değer:** `min-w-36` (144px).

**Gerekçe:** En uzun seçenek metni "Yayında" (7 karakter) + `px-2.5` (10px×2=20px) iç padding + native `<select>` ok ikonunun ayırdığı boşluk (Chrome/Edge ~20px, Firefox biraz daha fazla rezerve eder) + `focus-visible:ring-3` odak halkasının satır içinde metni kesmemesi için pay. `min-w-28` (112px) veya `min-w-32` (128px) sınırda kalıp Firefox/Windows native select render farklarında yine kesilme riski taşıyor; `min-w-36` güvenli marj bırakıyor. Tablo `table-layout: fixed` KULLANMIYOR (otomatik layout) — bu değişiklik `Durum` sütununu otomatik genişletecek, bu KABUL EDİLEBİLİR (normal satırlardaki `Badge`'e de fazladan boşluk verir, sorun yaratmaz).

Mobilde (`h-11` Select, kart içinde `w-full`) bu sorun yok — dokunma, `min-w-36` mobile eklenmeyecek.

---

## 2) Label-on-top garantisi + spacing ölçeği

**Kök neden onayı:** `<label>` varsayılan `display: inline` — `space-y-1`'in `margin-top` ile ürettiği ayrım inline elemanlarda tarayıcı satır sarmasına bağlıdır, garanti değildir. Çözüm: her quick-edit `<label>`'ına `block` class'ı eklenmeli.

**Karar — tüm label class'ları şu şekle çevrilecek:**
```
className="block text-xs font-medium text-foreground/60"
```
(Sadece `block` eklendi, mevcut `text-xs font-medium text-foreground/60` aynen kalıyor — renk/boyut tokenı değişmiyor.)

**Bu, masaüstü satırındaki (Başlık, Slug, Durum) VE mobil kartındaki (Başlık, Slug, Durum) TÜM quick-edit label'larına uygulanmalı** — mobilde de aynı `inline` riski var, aynı düzeltme geçerli.

**Spacing ölçeği — mevcut değerler ONAYLANDI, değiştirilmeyecek:**
- Label → Input arası: `space-y-1` (4px) — tutarlı, korunuyor.
- Alanlar arası (Başlık↔Slug dış container): `space-y-3` (12px) — tutarlı, korunuyor.
- Bu ikisi projenin 4/8/12/16/24/32 ölçeğiyle uyumlu (4px ve 12px), oran olarak da (1:3) net bir hiyerarşi kuruyor — label bir alana "yapışık", alanlar birbirinden belirgin şekilde ayrık. Değiştirmeye gerek yok, kök neden `space-y` değeri değil `inline` display'di.

---

## 3) Satırı ayrıştıran arka plan + border (tek kesintisiz blok)

**Karar — masaüstü `TableRow` (ana quick-edit satırı):**
```
border-l-4 border-l-primary border-t border-primary/20 bg-primary/8 hover:bg-primary/8
```
+ **koşullu alt kenarlık:** `quickEditError` YOKSA `border-b border-primary/20` ekle (satır kendi başına kapalı bir blok olsun); `quickEditError` VARSA `border-b-0` (alt kenarlığı hata satırına devret, ikisi arasında çizgi/boşluk oluşmasın).

**Hata satırı (`quickEditError` varsa) — aynı `TableRow`:**
```
border-l-4 border-l-primary border-t-0 border-b border-primary/20 bg-primary/8 hover:bg-primary/8
```
(`border-t-0` zaten mevcuttu, `border-b border-primary/20` ve `bg-primary/8` eklenmeli ki üstteki satırla renk/kenarlık BİREBİR eşleşsin ve tek blok gibi görünsün.)

**Neden `bg-primary/8` (mevcut `bg-muted/40` yerine):** `bg-muted/40`, `--muted` (`#1a1a24` dark) ile satırın oturduğu `--card` (`#12121a` dark) arasında neredeyse fark yaratmıyor — kullanıcının "yetersiz" şikayetinin nedeni bu. `bg-primary/8`, `primary` tonunun (mor/indigo) çok soluk bir tintini verir; hem light hem dark modda `--card`'dan net ayrışır, ama metin/kontrast okunabilirliğini bozacak kadar koyu değildir (metin zaten `foreground`/input kendi arka planını taşıyor, bu bg sadece satır zeminini renklendiriyor). `/8` (%8 opaklık) seçildi çünkü `/5` çok soluk kalıp fark edilmeyebilir, `/10`+ dark modda hafif "kirli" görünebilir; `/8` iki modda da dengeli.

**`border-l-4`** (mevcut `border-l-2`'den kalınlaştırıldı, 2px→4px) — Linear/Vercel tarzı "seçili/aktif blok" vurgusu için yeterince belirgin, ama satırın geri kalanını ezmeyecek kadar ince.

**`border-y` yerine ayrı `border-t`/`border-b` kullanmanın nedeni:** Fragment içinde iki `<tr>` varsa (ana satır + hata satırı), her ikisi de `border-y` uygularsa aralarında ÇİFT çizgi oluşur (ana satırın alt kenarlığı + hata satırının üst kenarlığı yan yana). Yukarıdaki koşullu mantık bunu önler — blok her zaman TEK bir üst ve TEK bir alt kenarlıkla çevrili kalır.

**Mobil kart (`div` wrapper, satır ~307):**
```
rounded-xl border border-l-4 border-l-primary border-primary/20 bg-primary/8 p-4 shadow-sm
```
(Şu anki `border border-l-2 border-primary bg-muted/40` yerine — masaüstüyle aynı `primary/8` arka plan ve `4px` sol vurgu tonu; kart zaten tek bir `div` olduğu için "kesintisiz blok" sorunu yok, tüm kenarlıklar `border-primary/20` ile tutarlı ince ton, sadece sol kenarlık `border-l-primary` tam opak kalıp vurguyu taşıyor.)

---

## 4) Buton hizası + geçiş animasyonu

### 4a. Buton hizası — KARAR: hayalet spacer eklenmeli

Mevcut `align-top` + `flex flex-col items-end gap-2` YETERSİZ: diğer hücrelerde (`Başlık`, `Durum`) `label` (text-xs, ~16px satır yüksekliği) + `space-y-1` (4px) = **20px** bir üst boşluk var, input/select kutusu bu 20px'in ALTINDA başlıyor. Buton hücresinde label olmadığı için butonlar satırın en tepesinden başlıyor — bu da Input/Select kutularının üst kenarıyla Buton'un üst kenarı arasında ~20px'lik bir hizasızlık yaratıyor (butonlar görsel olarak "daha yukarıda" duruyor).

**Karar:** Görüntülenme hücresindeki `flex flex-col items-end gap-2` wrapper'ın HEMEN ÜSTÜNE, diğer alanlardaki `label + space-y-1` yüksekliğini birebir karşılayan görünmez bir spacer ekle:
```
<span aria-hidden className="block h-5" />
```
**Değer: `h-5` (20px)** — `text-xs` label satır yüksekliği (16px, Tailwind `text-xs` → `line-height: 1rem`) + `space-y-1` (4px) = 20px, ve `h-5` tam olarak 20px'e denk geliyor (4px'in katı, projenin spacing ölçeğiyle uyumlu). Bu, Buton grubunun üst kenarını Input/Select kutularının üst kenarıyla piksel-hizalı yapar.

`TableCell` zaten `align-top` — bu KALSIN, spacer ile birlikte doğru sonucu verir; `items-end` de kalsın (butonlar sağa yaslı kalmaya devam etsin, sütun `text-right`).

### 4b. Geçiş animasyonu — KARAR: `<tr>` değil, hücre İÇERİĞİ fade-in ile sarmalanır

`<tr>` üzerinde `opacity`/`height` transition'ı tarayıcılar arası güvenilir DEĞİL (table layout algoritmasıyla çakışır, bazı tarayıcılarda `tr`'de `transition` hiç tetiklenmez çünkü `display: table-row` üzerinde CSS transition'lar tutarsız uygulanır). Framer Motion `motion.tr` + `AnimatePresence` de table içinde kırılgan (layout animasyonları `<table>`/`<tbody>` reflow'uyla çakışabilir) — bu satır için GEREKSİZ risk, kullanılmayacak.

**Karar:** Proje zaten `tw-animate-css` import ediyor (`globals.css:2`) ve `dialog.tsx`/`popover.tsx`/`dropdown-menu.tsx` gibi yerlerde `animate-in`/`fade-in` utility'leri kullanıyor — AYNI paterni izle. `<tr>`'nin kendisine DEĞİL, HER TableCell içindeki mevcut içerik `div`'ine (yeni bir wrapper eklemeye gerek yok, zaten var olan `<div className="space-y-3">` (Başlık hücresi), `<div className="space-y-1">` (Durum hücresi), `<div className="flex flex-col items-end gap-2">` (Buton hücresi)) şu class'ları ekle:

```
animate-in fade-in-0 slide-in-from-top-1 duration-200
```

**Gerekçe:** Bu class'lar saf CSS `@keyframes` tabanlı (JS state/mount-effect gerektirmez), `<div>` gibi block-level elemanlarda güvenilir çalışır, `<tr>`/`<table>` layout algoritmasına hiç dokunmaz (animasyon `td` İÇİNDEKİ block elemanında, hücrenin kendi boyutu/layout'u etkilenmez — sadece içerik hafifçe yukarıdan belirir). `duration-200` (200ms) diğer projedeki (`dialog`/`popover`) hızıyla tutarlı, `slide-in-from-top-1` (4px) çok hafif bir hareket katıp "beliriyor" hissini güçlendiriyor ama abartılı değil.

Hata satırının `<p role="alert">` elementine de aynı desen: `animate-in fade-in-0 duration-150` (biraz daha kısa, çünkü zaten kullanıcı bir aksiyon sonrası — hata mesajı — bekliyor, gecikmesi az olmalı).

Kapanış (İptal/satırın DOM'dan kaldırılması) için `animate-out` GEREKMİYOR — satır zaten `editingId` değişince tamamen unmount oluyor, ani kapanma bu UX'te kabul edilebilir (kullanıcı zaten "İptal"e tıklayıp listeye dönüyor, çıkış animasyonu kritik değil). Bu, ek karmaşıklık (`AnimatePresence` gibi exit-animasyon altyapısı) gerektirmeden en basit/güvenilir çözüm.

### 4c. Mobil (kart) buton hizası

Mobil kartta butonlar zaten `flex items-center gap-2` içinde YATAY diziliyor (satır 351), dikey label-hizası sorunu YOK (masaüstündeki gibi tek satırda değiller) — mobil için 4a'daki spacer GEREKMİYOR, dokunma.

---

## Özet — Uygulanacak Somut Değerler

| Öğe | Değer |
|---|---|
| Quick-edit Select (Durum, sadece desktop) | `min-w-36` |
| Tüm quick-edit label'ları (desktop + mobil) | `block` eklenir |
| Label→Input gap | `space-y-1` (4px) — değişmedi |
| Alanlar arası gap | `space-y-3` (12px) — değişmedi |
| Desktop ana satır bg/border | `border-l-4 border-l-primary border-t border-primary/20 bg-primary/8 hover:bg-primary/8` + (hata yoksa `border-b border-primary/20`, varsa `border-b-0`) |
| Desktop hata satırı bg/border | `border-l-4 border-l-primary border-t-0 border-b border-primary/20 bg-primary/8 hover:bg-primary/8` |
| Mobil kart bg/border | `border border-l-4 border-l-primary border-primary/20 bg-primary/8` |
| Buton hücresi spacer | `<span aria-hidden className="block h-5" />` üstte eklenir |
| Satır/alan giriş animasyonu | Her hücre içeriğine `animate-in fade-in-0 slide-in-from-top-1 duration-200`; hata mesajına `animate-in fade-in-0 duration-150` |
| Çıkış animasyonu | Yok (unmount anlık, kabul edilebilir) |
