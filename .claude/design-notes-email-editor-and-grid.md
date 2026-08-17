# Tasarım Notu — E-posta Şablonu Blok Editörü (§10.16) + Sayfa Grid/Kolon Düzeni (§10.17)

**Kapsam:** `docs/architecture/ARCHITECTURE.md` §10.16.12 (7 madde) ve §10.17.7 (5 madde) için istenen tasarım kararları. Bu doküman **kod yazmaz**; frontend-agent'ın doğrudan uygulayabileceği somut token/class/ikon kararlarını verir. Kapsam dışı olanlar (blok tipi anahtarları, `data` şemaları, `sandbox`, sunucu render'ı, `md` kırılma noktası, grid sınıf iskeleti) mimarın elindedir, burada tekrarlanmaz.

**Görsel yön:** Değişmedi — proje **Minimal/Flat** (bkz. `.claude/design-notes-appearance-polish.md` §"Görsel yön"). Bu doküman yeni bir görsel dil eklemez; mevcut `Card`/`Badge`/`Button`/`Table`/`Dialog`/`DropdownMenu` token setini ve nav-tree/content-list'te kurulmuş dnd-kit/liste desenlerini yeniden kullanır. Yeni renk **icat edilmez** — yalnızca `--primary`, `--danger`, `--success`, `--warning`, `--foreground`, `--border`, `--surface(-muted)` ve public tarafta `--site-primary`/`--site-button(-text)` kullanılır.

**Referans alınan mevcut bileşenler (okundu, doğrulandı):**
- `frontend/src/components/admin/page-builder/block-list.tsx`, `builder-canvas.tsx`, `frontend/src/lib/page-builder/registry.ts` — mevcut blok paleti ve kart düzeni.
- `frontend/src/components/admin/navigation/nav-tree-row.tsx` (+ `nav-tree-editor.tsx`) — drag handle, `DropIndicator`, `DragOverlay` deseni.
- `frontend/src/components/admin/content-list/content-list-table.tsx`, `quick-edit-grid.tsx` — tablo/kart liste deseni, "düzenleniyor" satır vurgusu, rozet kullanımı.
- `frontend/src/components/admin/appearance/color-field.tsx` (`ColorField`, `ContrastBadge`) — hex renk seçici + WCAG kontrast rozeti.
- `frontend/src/components/ui/{badge,button,card,dialog,confirm-dialog,tabs,select,switch,input,empty-state}.tsx`.
- `.claude/design-notes-appearance-polish.md` — cihaz önizleme segmented control, mikro grup etiketi (`text-[11px] font-semibold tracking-wide text-foreground/40 uppercase`), doluluk soketi deseni.
- İkon kaynağı: yalnızca `lucide-react` (proje kuralı).

---

# BÖLÜM A — E-posta Şablonu Editörü

## Genel sayfa iskeleti (`app/admin/notifications/templates/[templateId]/page.tsx`)

Üç sütun, appearance sayfasındaki `lg:w-64` paneliyle **aynı genişlik biriminden** türetilir:

```
grid grid-cols-1 lg:grid-cols-[16rem_1fr_20rem] gap-4
```
- Sol: **Bloklar** paleti — `w-64` (256px, appearance'ın `lg:w-64` paneliyle tutarlı).
- Orta: tuval (canvas) — `flex-1 min-w-0`, içerik `max-w-2xl mx-auto` (kart genişliği okunur kalsın, editör alanı gereksiz genişlemesin).
- Sağ: **Blok ayarları + Değişkenler** — `w-80` (320px, `ColorField` + `Input` satırlarının rahat sığması için sol panelden daha geniş).
- `lg` altında üç panel dikey olarak istiflenir (`grid-cols-1`), sağ panel bloğa tıklanınca `Sheet`/inline açılır — bu davranış detayı frontend-agent'ın takdirinde, görsel dil aynı kalır.

Üst araç çubuğu (`sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur px-4 py-3`):
- Sol: geri linki + `Input` (şablon adı, `className="h-8 max-w-64 font-medium"`) + `dirty` iken amber `DirtyDot` (appearance-polish'teki AYNI `bg-warning` nokta deseni, `title="Kaydedilmemiş değişiklikler"`).
- Sağ: `Button variant="outline" size="sm"` **Test E-postası Gönder** (bkz. madde 6) → `Button variant="secondary" size="sm"` **Aktif Yap** (yalnızca `!isActive` iken görünür) → `Button size="sm"` **Kaydet** (primary, `loading` prop debounce'lu preview'dan bağımsız).

---

## 1) Blok paleti tasarımı

**Karar: dikey ikon+etiket liste, tıkla-ekle** (mimar tercihiyle birebir — palette'ten sürükleme YOK, sıralama tuvalde yapılır). Mevcut sayfa editörünün yatay "+ Label" çip şeridinden (`block-list.tsx`) kasıtlı olarak SAPILIYOR: üç sütunlu, sabit yükseklikli bir editör sayfasında dikey liste hem daha çok blok tipini (7 adet) okunur tutar hem de sol sütunun boş alanını doldurur. Sayfa editörünün mevcut yatay çip şeridi **DEĞİŞTİRİLMEZ** (kapsam dışı, ayrı bir bileşen).

Palet başlığı: `.admin-h3` sınıfıyla "Bloklar".

Her satır (buton, `type="button"`):
```
flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-surface px-3 py-2.5 text-sm font-medium text-foreground
transition-colors hover:border-border hover:bg-surface-muted
focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2
```
İkon: `h-4 w-4 text-foreground/50 shrink-0`. Liste `flex flex-col gap-1.5`.

Blok tipi → ikon eşlemesi (`lucide-react`, tek kaynak):

| `EmailBlockType` | İkon | Etiket (TR) |
|---|---|---|
| `logo-header` | `PanelTop` | Logo / Üst Bilgi |
| `heading` | `Heading` | Başlık |
| `text` | `Text` | Metin |
| `button` | `MousePointerClick` | Buton / CTA |
| `image` | `ImageIcon` (mevcutta `seo-preview.tsx`'te zaten aynı isimle import ediliyor — yeniden isimlendirme gerekmez) | Görsel |
| `divider` | `SeparatorHorizontal` | Ayırıcı |
| `footer` | `PanelBottom` | Footer |

Tıklanınca blok tuvalin **sonuna** eklenir ve otomatik seçili hale gelir (sağ panel o bloğun ayarlarına döner) — sıralama daha sonra tuvalde sürükle/ok tuşlarıyla yapılır.

---

## 2) Seçili blok göstergesi + drag handle

**Renk tek başına gösterge OLAMAZ** kısıtı `content-list-table.tsx`'teki "şu an düzenlenen satır" deseniyle **birebir aynı** çözümle karşılanır (proje içi kanıtlanmış emsal, yeni bir desen icat edilmez):

Seçili blok kartı (mevcut `builder-canvas.tsx` `Card`'ının üstüne eklenir):
```
border-l-4 border-l-primary border-y border-r border-primary/20 bg-primary/8
```
Bu, **kenarlık kalınlığı (1px → 4px)** değişimiyle renkten bağımsız bir yapısal fark taşır (2.5.5 boyutunda algılanabilir), rengin üstüne eklenen bir katmandır. Seçili DEĞİL blok kartı mevcut `rounded-xl border border-border bg-card p-4 shadow-sm` olarak kalır.

Drag handle: `GripVertical` ikonu, `nav-tree-row.tsx`'teki hedef alanla **birebir aynı** boyut/stil (tutarlılık + zaten a11y onaylı):
```
flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/40
hover:bg-surface-muted hover:text-foreground/70 active:cursor-grabbing
```
Konum: kart başlık satırının en solunda, blok tipi ikonu + etiketinden ÖNCE. Blok başlık satırı yeni hali: `[GripVertical] [blok ikonu] [blok etiketi] ... [Düzenleniyor rozeti — sadece seçiliyken] [Sil]`. "Yukarı/Aşağı" ok butonları KALDIRILMAZ — nav-tree ile aynı gerekçeyle (klavye erişimi, ekran okuyucu keşfedilebilirliği) korunur ve `GripVertical`'ın sağında kalmaya devam eder.

Seçili blok rozeti (renkten bağımsız EK sinyal, opsiyonel ama önerilir): `Badge tone="primary" size="sm"` içinde "Düzenleniyor" — yalnızca seçili blokta, başlık satırının sağında Sil butonundan önce.

`DragOverlay` içeriği: `nav-tree-row.tsx`'teki `NavTreeRowOverlay` ile aynı desen — sürüklenen bloğun ikon+etiket başlığının `shadow-lg ring-2 ring-primary/40` kopyası; orijinal konumdaki kart `opacity-50` olur.

---

## 3) Değişken paneli tasarımı

**Karar: gruplu, arama kutulu bir liste** (basit chip listesi DEĞİL) — çünkü `CUSTOM` amaçlı bir şablonda toplam değişken sayısı (global 2 + özel en fazla 20) 22'ye kadar çıkabilir; sabit chip şeridi bu ölçekte taranamaz hale gelir.

**Arama kutusu koşullu gösterilir:** toplam değişken sayısı (`system + contact-field + custom`) **≥ 8** ise üstte görünür, altındaysa gizlenir (çoğu `purpose` 2–6 değişkenle sınırlı — gereksiz kroma eklenmez). Arama kutusu mevcut `InputGroup`/`InputGroupAddon`/`InputGroupInput` bileşenleri ile (`content-list-table.tsx`'teki slug arama alanıyla aynı desen), `Search` ikonu solda.

Gruplama, `EmailVariableDefinition.source` alanına birebir haritalanır — grup başlıkları appearance-polish'teki mikro etiket sınıfıyla:
```
text-[11px] font-semibold tracking-wide text-foreground/40 uppercase
```
Sıra: **Genel** (`site_name`/`site_url`, her zaman en üstte, kendi mini grubu — "Genel" başlığı) → **Sistem Değişkenleri** (`source: "system"`, amaca özgü) → **Form Alanları** (`source: "contact-field"`, yalnızca `CONTACT_FORM_NOTIFICATION`) → **Özel Değişkenler** (`source: "custom"`).

Her satır (tıklanabilir buton):
```
flex w-full flex-col items-start gap-0.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors
hover:border-border/60 hover:bg-surface-muted
disabled:cursor-not-allowed disabled:opacity-50
```
İçerik: üstte `<span className="text-sm font-medium text-foreground">{label}</span>` (Türkçe, birincil — mimar kararı), altında `<span className="font-mono text-xs text-foreground/50">{"{{" + key + "}}"}</span>` (ikincil).

**Hedef yokken:** panelin en üstünde, listenin ÜZERİNDE (satır başına değil, panel geneline) bir bilgi çubuğu:
```
flex items-center gap-2 rounded-lg border border-border/60 bg-surface-muted px-3 py-2 text-xs text-foreground/60
```
`Info` ikonu (`h-3.5 w-3.5 shrink-0`) + "Önce bir metin alanına tıklayın". Aynı anda TÜM değişken satırları `disabled` olur (mimar kararı: sessizce yanlış yere eklemek yasak).

**Özel değişken ekleme butonu** ("Özel Değişkenler" grubunun altında, en fazla 20'ye ulaşınca gizlenir):
```
flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-foreground/60
hover:border-foreground/30 hover:text-foreground
```
`Plus` ikonu (`h-3.5 w-3.5`) + "Özel Değişken Ekle" — `EmptyState`'in dashed-border diline uygun, modal AÇMAZ, aynı panelde inline genişler (bkz. madde 7).

---

## 4) Blok stil ayarları paneli

Sağ panel, seçili bloğa göre bölümlere ayrılır; her bölüm appearance-polish'teki ayraç deseniyle ayrılır: `border-t border-border/60 pt-4` (ilk bölüm hariç), mikro başlık `text-[11px] font-semibold tracking-wide text-foreground/40 uppercase`.

**Hizalama (`align`)** — appearance-polish'teki cihaz toggle'ıyla AYNI segmented-control kabı:
```
flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5
```
İçinde 3× `Button size="icon-xs" variant={active ? "secondary" : "ghost"} aria-pressed={active}` — `AlignLeft`/`AlignCenter`/`AlignRight` (`h-3 w-3`). `variant="secondary"` geçişi (arka plan+kenarlık değişimi) rengin YANINDA yapısal bir farktır — WCAG 1.4.1 için yeterli, appearance-polish'te zaten bu gerekçeyle onaylandı.

**Renk (`backgroundColor`, `textColor`, buton `backgroundColor`/`textColor`)** — **mevcut `accent-color-picker.tsx` YENİDEN KULLANILMAZ** (o, admin arayüzünün sabit 6-8 renklik marka paleti içindir, serbest hex girişini desteklemez). Bunun yerine **`frontend/src/components/admin/appearance/color-field.tsx`'teki `ColorField` bileşeni** doğrudan yeniden kullanılır — zaten native `<input type=color>` swatch + hex `Input` + opsiyonel `ContrastBadge` (WCAG AA) sağlıyor, tam ihtiyaca uyuyor:
- `backgroundColor`/`textColor` çifti girildiğinde `ColorField`'ın `checkAgainst` prop'u karşı renge bağlanır → `ContrastBadge` otomatik görünür.
- **Nullable alanlar için "Temizle" eklentisi (YENİ, küçük):** `ColorField`'ın yanına `Button variant="ghost" size="icon-xs"` + `X` ikonu, `title="Varsayılana dön"` — tıklanınca `null`'a döner (e-postanın varsayılan beyaz zemin/siyah metnine düşer). Bu, `ColorField`'ın kendisine DOKUNMADAN (paylaşılan bileşen, appearance sayfası etkilenmez) çağıran taraf (editör state'i) tarafından eklenir.

**Boşluk (`paddingY`/`paddingX`, `none/sm/md/lg`)** — **px karşılıkları (ZORUNLU, e-posta render'ı için)**, projenin mevcut 4/8 tabanlı ölçeğinden:

| token | px | Tailwind (yalnızca editör önizleme referansı — gerçek e-posta HTML'i backend'de üretilir) |
|---|---|---|
| `none` | `0px` | `p-0` |
| `sm` | `8px` | `p-2` |
| `md` | `16px` | `p-4` |
| `lg` | `32px` | `p-8` |

Kontrol: metin etiketli 4'lü segmented control (ikon YOK — boyut farkını ikonla ayırt etmek belirsiz kalır): "Yok · S · M · L", her biri `Button size="xs" variant={active ? "secondary" : "ghost"}`. Kontrolün altında `text-xs text-foreground/50` ile seçili değerin px karşılığı gösterilir: "Dikey: 16px · Yatay: 16px".

**Ayırıcı kalınlığı (`divider.thickness`, `1/2/4`)** — özel mini ikonlar (lucide'da birebir karşılık yok, `Minus` tek kalınlıkta): üç `Button size="icon-xs" variant={active?"secondary":"ghost"}` içinde artan yükseklikte bar:
```
<span className="block w-4 rounded-full bg-current" style={{ height: `${thickness}px` }} aria-hidden />
```
(1px/2px/4px — `EmailBlockData.divider.thickness` değeriyle birebir, yeni bir ölçek icat edilmiyor.)

**Buton köşe yarıçapı (`button.radius`, `none/sm/full`)** — aynı segmented-control kabında 3 mini kare:
```
<span className={cn("block h-4 w-4 border-2 border-current", radius === "none" && "rounded-none", radius === "sm" && "rounded-[4px]", radius === "full" && "rounded-full")} aria-hidden />
```

**Görsel genişliği (`image.width`)** — `Input type="number"` + sağda `px` birim etiketi (`InputGroupAddon` deseni), boş bırakılırsa `null` (otomatik genişlik).

---

## 5) Canlı önizleme alanı tasarımı

**Karar: masaüstü/mobil toggle VAR** (tablet YOK — e-posta istemcilerinde pratik ayrım masaüstü webmail vs. mobil istemci; appearance-polish'teki 3'lü cihaz seçiciden kasıtlı olarak sadeleştirildi).

Üst şerit (appearance-polish'teki "Canlı Önizleme" başlık satırıyla AYNI desen):
```
flex items-center justify-between gap-2
```
Sol: `text-[11px] font-medium tracking-wide text-foreground/50 uppercase` "Önizleme". Sağ: segmented control (`rounded-md border border-border/60 bg-surface-muted p-0.5 gap-0.5`), 2× `Button size="icon-xs"` — `Monitor` / `Smartphone` (`h-3 w-3`), `aria-pressed`.

Genişlikler (e-posta gövdesi genellikle 600px sabit tablo genişliğinde tasarlanır — appearance-polish'teki `100%/768px/375px` cihaz genişliklerinden BİLİNÇLİ olarak farklı):
```ts
const EMAIL_PREVIEW_WIDTH = { desktop: "640px", mobile: "375px" };
```
(640px = 600px e-posta içerik genişliği + 40px görsel boşluk payı.)

Çerçeve ("e-posta istemcisi" hissi veren pencere kromu):
```
mx-auto overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-300 ease-in-out
```
style ile `maxWidth`. İçinde iki katman:
1. Konu satırı çubuğu: `border-b border-border/60 bg-surface-muted px-4 py-2 text-sm font-medium text-foreground` — "Konu: {subject}" (boşsa `text-foreground/40` ile "Konu satırı girilmedi").
2. `<iframe sandbox="" srcDoc={html} title="E-posta önizlemesi" className="h-[70vh] min-h-[420px] w-full border-0 bg-white" />` — **`bg-white` sabit** (admin dark mode'dan bağımsız; e-posta istemcileri de varsayılan beyaz zemin kullanır, önizleme yalan söylememeli).

**Güncelleniyor durumu (500ms debounce):** iframe'i KAPLAMAZ (blocking skeleton YOK — önizleme zaten güncel içeriği gösteriyor, sadece tazeleniyor). Konu satırı çubuğunun sağında küçük `Spinner` (`h-3.5 w-3.5 text-foreground/40`), yalnızca `previewLoading` true iken.

---

## 6) "Test E-postası Gönder" butonu ve durumu

Konum: üst araç çubuğu (bkz. "Genel sayfa iskeleti"), `variant="outline" size="sm"`, önünde `Send` ikonu.

**Durum matrisi:**
| Durum | Görünüm |
|---|---|
| `dirty === true` (kaydedilmemiş değişiklik var) | `disabled`, `title="Test göndermeden önce değişiklikleri kaydedin"` — mimar kararı: test **kaydedilmiş** satır üzerinde çalışır, editör auto-save yapmıyor. |
| idle, kaydedilmiş | `Send` ikonu + "Test E-postası Gönder" |
| yükleniyor | `Button loading` prop'u (mevcut `Spinner` otomatik) + "Gönderiliyor…" |
| başarı | Buton anında idle'a döner; geri bildirim **yeni bir bileşen İCAT EDİLMEDEN** mevcut `sonner` toast (`components/ui/sonner.tsx`, proje genelinde zaten mutation geri bildirimi için kullanılıyor) ile: `toast.success("Test e-postası " + sentTo + " adresine gönderildi.")` |
| hata (genel) | `toast.error(message)` |
| hata (429 rate limit) | `toast.error("Çok fazla deneme — 1 dakika sonra tekrar deneyin.")` |

Yeni bir inline başarı/hata banner'ı **eklenmez** — proje zaten toast deseninde tutarlı, ikinci bir geri bildirim kanalı gürültü yaratır.

---

## 7) Özel değişken tanımlama formu

Madde 3'teki "Özel Değişken Ekle" butonuna tıklanınca, buton yerine **inline genişleyen** bir mini form belirir (modal DEĞİL — panelin zaten dar/uzun akışına uyar):
```
rounded-lg border border-border/60 bg-surface-muted/60 p-3 space-y-2.5
```
Alanlar:
1. **Etiket** (`label`, zorunlu) — `Input` `h-8`, placeholder "ör. Telefon Numarası".
2. Etiketin HEMEN altında salt-okunur anahtar önizlemesi (canlı `slugify` sonucu — mimar kararı, ASCII zorunlu): `<p className="font-mono text-xs text-foreground/50">Anahtar: {"{{" + key + "}}"}</p>`. Anahtar mevcut bir sistem/özel değişkenle çakışırsa aynı satırın altında `text-xs text-danger` ile "Bu anahtar zaten kullanılıyor" — **Ekle butonu bu durumda `disabled`.**
3. **Örnek Değer** (`sampleValue`, zorunlu) — `Input` `h-8`, placeholder "ör. 0555 000 00 00" (test gönderiminde ve önizlemede kullanılacağı `label`in altına küçük bir ipucu metniyle belirtilir: `text-xs text-foreground/40` "Test gönderiminde bu değer kullanılır").

Alt satır: `Button size="sm"` "Ekle" (primary) + `Button size="sm" variant="ghost"` "Vazgeç" — sağa yaslı, `flex justify-end gap-2`.

Eklenen değişken anında "Özel Değişkenler" grubunun listesine düşer (form kapanır, buton tekrar görünür).

---

## Ek — Şablon listesi sayfası (`app/admin/notifications/templates/page.tsx`)

*(§10.16.12 madde 5 ve 10.16.11'deki liste ekranı için.)*

**Karar: `content-list-table.tsx`'in KENDİSİ yeniden kullanılmaz** (o, SEO skoru/görüntülenme/çöp kutusu/toplu işlem gibi Page/BlogPost'a özgü alanlarla sıkı bağlı — `EmailTemplate`'te bunların hiçbiri yok, zorlamak generic tipi kirletir). Bunun yerine **AYNI görsel diliyle** (aynı `Table`/`TableRow` primitifleri, aynı sarmalayıcı, aynı zebra/hover class'ları) **özel, hafif bir tablo** kurulur — kod frontend-agent'ındır, burada yalnızca görünüm belirtilir:

Masaüstü (`≥768px`): `rounded-xl border border-border bg-card shadow-sm`, `TableHeader className="bg-muted"`, satırlar `even:bg-muted hover:bg-primary/8 dark:hover:bg-primary/10` (content-list-table ile BİREBİR aynı). Sütunlar: **Ad** (`admin-link`, `isSystem` ise yanında `Lock` ikonu `h-3.5 w-3.5 text-foreground/40` + `title="Sistem şablonu — silinemez"`) · **Kullanıldığı Yer** (`Badge tone="neutral" size="sm"` — purpose'un Türkçe etiketi, aşağıdaki tabloya göre) · **Durum** (`Badge tone={isActive ? "success" : "neutral"} solid size="lg"` — "Aktif"/"Pasif") · **Son Düzenleme** (`date-fns` göreli, `title` ile tam tarih) · sağda `MoreVertical` `DropdownMenu` (Düzenle, Kopyala, Aktifleştir [yalnızca `!isActive`], Sil [`isSystem`/`isActive` ise `disabled` + `title` açıklaması, `content-list-table`'daki "Kalıcı Sil" disabled deseniyle aynı]).

Mobil (`<768px`): `content-list-table.tsx`'in kart deseniyle aynı (`rounded-xl border border-border bg-card p-4 shadow-sm`), başlık + `DropdownMenu` (⋮), altında rozet satırı.

Purpose → Türkçe etiket (yeni terminoloji İCAT EDİLMEZ, `email-variables.ts` registry ile birebir aynı sözlük frontend'de tutulur):

| `purpose` | Etiket |
|---|---|
| `WELCOME` | Hoş Geldin |
| `PASSWORD_RESET` | Şifre Sıfırlama |
| `SYSTEM_ANNOUNCEMENT` | Sistem Duyurusu |
| `ORDER_CONFIRMATION` | Sipariş Onayı |
| `ORG_INVITATION` | Organizasyon Daveti |
| `CONTACT_FORM_NOTIFICATION` | İletişim Formu Bildirimi |
| `CUSTOM` | Özel |

Boş liste: `EmptyState` (`icon={Mail}`, title "Henüz e-posta şablonu yok"). "Yeni Şablon" CTA sağ üstte `Button size="sm"` → `Dialog` (amaç `Select` + ad `Input`) → oluştur → `[templateId]`'ye yönlendir.

---

## Ek — Public iletişim formu (§10.16.12 madde 7)

*(`app/[lang]/(site)/contact/page.tsx`.)* Public site tokenleri kullanılır (`--site-*`), admin `--primary` DEĞİL.

**Alan düzeni:** dikey tek sütun, `space-y-5 max-w-xl mx-auto`. Her alan:
```
<div className="space-y-1.5">
  <label className="block text-sm font-medium text-foreground">{label}{required && <span className="text-danger"> *</span>}</label>
  <input/textarea/select className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground
    transition-colors placeholder:text-foreground/40
    focus-visible:border-[var(--site-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]/30" />
  {helpText && <p className="text-xs text-foreground/50">{helpText}</p>}
</div>
```
(`px-3.5 py-2.5` admin `Input`'un `px-2.5 py-1`'inden kasıtlı olarak daha ferah — public site formları admin yoğunluğunda değil, dokunma hedefi daha büyük olmalı.)

**Hata durumu:** `border-danger` + `ring-2 ring-danger/20` + alanın altında `<p role="alert" className="text-xs font-medium text-danger">{error}</p>` (help text'in YERİNE geçer, ikisi aynı anda gösterilmez).

**KVKK onay kutusu:** `Checkbox` (mevcut admin `checkbox.tsx` bileşeni public tarafta da kullanılabilir, tema-nötr) + yanında:
```
<label className="text-sm leading-snug text-foreground/80">
  {consentText} <Link href={legalHref} className="font-medium text-[var(--site-primary)] underline underline-offset-2 hover:opacity-80">Aydınlatma Metni</Link>'ni okudum, onaylıyorum.
</label>
```
Onaysız gönderim denemesi: checkbox çevresine `ring-2 ring-danger/30 rounded` + üstte `role="alert" text-xs text-danger` "Devam etmek için onay kutusunu işaretleyin".

**Gönder butonu:** `legal-document-notice.tsx`/`site-header.tsx`'teki mevcut public buton deseniyle BİREBİR aynı (yeni bir buton stili icat edilmez):
```
inline-flex items-center justify-center rounded-lg bg-[var(--site-button)] px-5 py-2.5 text-sm font-medium text-[var(--site-button-text)]
transition-all hover:opacity-85 disabled:opacity-50 disabled:pointer-events-none
```
Gönderiliyor durumunda buton içi `Spinner` + "Gönderiliyor…"; başarıda form yerine `successMessage` bir `bg-success/10 text-success border border-success/20 rounded-lg p-4 text-sm` bilgi kutusunda gösterilir (form kaybolur, tekrar gönderim önerilmez — spam'i teşvik etmemek için "Yeni mesaj gönder" linki YOK, kasıtlı).

---

# BÖLÜM B — Sayfa Grid/Kolon Düzeni

## 1) "Düzen" seçici tasarımı

**Karar: her bloğun (ve her `columns` konteynerinin) KENDİ başlık satırındaki bir `DropdownMenu`** — global bir araç çubuğu kontrolü DEĞİL, çünkü sarmalama/kaldırma tek bir bloğa özgü bir eylemdir (§10.17.3). Blok ekleme çubuğunun "yanında" ifadesi, her blok kartının kendi eylem satırında (Yukarı/Aşağı/Sil ile aynı hizada) karşılığını bulur.

Tetikleyici: `Button variant="ghost" size="icon-sm"` + o anki düzenin ikonu (aşağıdaki tablo), `aria-label="Düzen"`, blok başlık satırında `GripVertical`'dan SONRA, "Yukarı" ok butonundan ÖNCE.

İkonlar (lucide-react, tam genişlik dahil 3+1 seçenek):

| Düzen | İkon |
|---|---|
| Tam Genişlik (varsayılan, `columns` yokluğu) | `Square` |
| 2 Sütun | `Columns2` |
| 3 Sütun | `Columns3` |

`DropdownMenuContent`: her seçenek `DropdownMenuItem` + solda küçük ikon + sağda `Check` (yalnızca aktif seçenekte) — `accent-color-picker.tsx`'teki `{accent === key && <Check className="ml-auto h-4 w-4" />}` deseniyle BİREBİR aynı.

**Kapsam ayrımı (önemli, frontend-agent için netleştirme):**
- Üst seviye, tekil bir blokta: menüde "Tam Genişlik" (aktif/check'li, tıklanamaz-disabled) + "2 Sütun" + "3 Sütun" — seçilince sarmalar.
- `columns` konteynerinin KENDİ başlığında: "2 Sütun"/"3 Sütun" (aktif olan check'li) + "Tam Genişlik" (seçilince unwrap, bkz. madde 4) — konteynerin `columnCount`'unu 2↔3 arası DARALTMA/GENİŞLETME de bu menüden yapılır.
- Bir sütunun İÇİNDEKİ bloklarda bu kontrol **HİÇ gösterilmez** (derinlik-1 kısıtı — sarmalanamaz/tekrar sarmalanamaz, mimar kararı).

## 2) `gap` token'larının Tailwind karşılıkları

E-posta bölümündeki (Bölüm A madde 4) AYNI 0/8/16/32 ölçeğiyle tutarlı — proje genelinde TEK bir boşluk ölçeği:

| `gap` | px | Tailwind |
|---|---|---|
| `none` | 0px | `gap-0` |
| `sm` | 8px | `gap-2` |
| `md` | 16px | `gap-4` |
| `lg` | 32px | `gap-8` |

(Public render sınıf iskeleti mimarın `grid grid-cols-1 md:grid-cols-{2,3}`'üne bu `gap-*` sınıfı eklenir; editör önizlemesi de AYNI sınıfı kullanmalı — WYSIWYG.)

## 3) Sütun konteynerinin görsel çerçevesi + boş sütun bırakma alanı

**Konteyner çerçevesi:** kesikli kenarlık + üstte bir "etiket + özet" başlık satırı (fieldset benzeri, ama gerçek `<fieldset>` KULLANILMAZ — form semantiği yanıltıcı olur, düz `div` + `role` gerekmez):
```
rounded-xl border-2 border-dashed border-border/70 bg-surface-muted/30 p-4 space-y-3
```
Başlık satırı (`flex items-center justify-between gap-2`):
- Sol: sütun sayısı ikonu (`Columns2`/`Columns3`, `h-4 w-4 text-foreground/50`) + `text-sm font-medium text-foreground` "2 Sütun" + `text-xs text-foreground/50` "· Boşluk: Orta" (aktif `gap` etiketi).
- Orta-sağ (küçük, `Info` ikon + tooltip/`title`): `Info className="h-3.5 w-3.5 text-foreground/35"` `title="Mobilde bu sütunlar alt alta sıralanır"` — mobil yığılma UYARISI budur (ayrı bir "mobil önizleme modu" İCAT EDİLMEZ, veri alanı da değildir — §10.17.3; salt bilgilendirici, statik ikon).
- Sağ: "Düzen" `DropdownMenu` (madde 1) + varsa `verticalAlign`/`ratio` kontrolleri (madde 5).

**Boş sütun placeholder** (her `column.blocks.length === 0` sütunda — "boş sütuna bırakılamaz" tuzağına karşı GERÇEK bir `useDroppable` hedefi, görünür minimum yükseklikte):
```
flex min-h-24 items-center justify-center rounded-lg border-2 border-dashed border-border/50 text-center text-xs text-foreground/40
```
"Buraya blok sürükleyin". Aktif sürükleme bu sütunun ÜZERİNDEYKEN (`isOver`):
```
border-primary bg-primary/5 text-primary
```
(Geçici sürükleme durumu — statik içerik ayrımı değil, WCAG 1.4.1'in kapsamadığı bir etkileşim-anı geri bildirimi; zaten imleç/DragOverlay ile eşlik ediyor.)

`min-h-24` (96px) — dnd-kit'in gerçek bir bırakma hedefi tanıması için yeterli dokunma/işaretçi alanı; `EmptyState`'in `p-10` boşluğundan daha kompakt (sütun genişliği dar olabilir, `EmptyState` burada AŞIRI olurdu).

## 4) Unwrap (tam genişliğe dönme) onay diyaloğu

**Karar: mevcut `ConfirmDialog` bileşeni (`components/ui/confirm-dialog.tsx`) yeniden kullanılır** — yeni bir diyalog bileşeni icat edilmez. Yalnızca boş OLMAYAN sütun(lar) varken tetiklenir (mimar kararı — boşsa sessizce unwrap edilir, onay GEREKMEZ).

```
tone="warning"  // silme değil, taşıma — "danger" (kırmızı) YANLIŞ sinyal verir
title="Sütunlar tam genişliğe dönüştürülsün mü?"
description={`${columnCount} sütundaki ${totalBlockCount} blok tek bir sütuna, sırasıyla alt alta taşınacak. İçerik SİLİNMEZ.`}
confirmText="Tam Genişliğe Dönüştür"
cancelText="Vazgeç"
```
`tone="warning"` seçimi bilinçli: `ConfirmDialog`'un var olan üç tonu arasında bu **veri kaybı DEĞİL, veri taşıma** işlemi — `danger` (kırmızı, "geri alınamaz silme" çağrışımı) yanlış olurdu, appearance-polish'teki "silme kadar tehlikeli değil ama önemli" ayrımıyla aynı gerekçe.

Daralma (`3 sütun → 2 sütun`, madde 1'deki aynı menüden) son sütun boş değilse AYNI diyalog, `description` metni: "3. sütundaki N blok, 2. sütunun sonuna taşınacak."

## 5) `verticalAlign` ve `ratio` kontrollerinin v1'de açılması

**Karar: İKİSİ DE v1'de AÇILIR**, ama düşük vurgulu, konteyner başlık satırının İÇİNE gömülü küçük kontroller olarak (yeni bir ayarlar paneli/sekme AÇILMAZ) — şema zaten bu alanları taşıyor, UI'dan tamamen gizlemek "hiçbir yoldan erişilemeyen alan" tuzağı yaratır.

**`verticalAlign`** — konteyner başlık satırının sağında, "Düzen" menüsünün yanında, 3'lü mini segmented control:
```
rounded-md border border-border/60 bg-surface-muted p-0.5 flex gap-0.5
```
3× `Button size="icon-xs" variant={active?"secondary":"ghost"}` — `AlignStartVertical` / `AlignCenterVertical` / `AlignEndVertical` (lucide-react'te mevcut, dikey hizalamayı temsil eder; yatay `AlignLeft/Center/Right`'tan görsel olarak ayrışır, karıştırılmaz).

**`ratio`** — YALNIZCA `columnCount = 2` iken görünür (3 sütun şema gereği zaten `1-1-1`'e kilitli, kontrol GEREKSİZ ve gösterilmez). "Düzen" `DropdownMenu`'sü 2 Sütun seçiliyken bir **ikinci küçük segmented control** olarak konteyner başlığında belirir (lucide'de literal "oran" ikonu yok — özel mini görsel, appearance-polish'teki renk paleti şeridi presedentiyle aynı teknik: gerçek CSS oranlarıyla çizilen iki bar):
```tsx
function RatioIcon({ left, right }: { left: number; right: number }) {
  return (
    <span className="flex h-3.5 w-6 gap-0.5" aria-hidden>
      <span className="rounded-[1px] bg-current" style={{ flex: left }} />
      <span className="rounded-[1px] bg-current" style={{ flex: right }} />
    </span>
  );
}
```
3 seçenek: `1-1` (`left=1 right=1`), `2-1` (`left=2 right=1`), `1-2` (`left=1 right=2`) — her biri `Button size="icon-xs" variant={active?"secondary":"ghost"}` içinde, `aria-label` ile ("Eşit", "Sol geniş", "Sağ geniş").

---

## Kontrol Listesi (frontend-agent)

**Bölüm A:**
- [ ] Sol palet: dikey ikon+etiket liste, tıkla-ekle (`PanelTop/Heading/Text/MousePointerClick/ImageIcon/SeparatorHorizontal/PanelBottom`).
- [ ] Blok kartı: `GripVertical` handle (h-8 w-8, nav-tree ile aynı class'lar) + seçili durumda `border-l-4 border-l-primary border-y border-r border-primary/20 bg-primary/8` + `Badge tone="primary"` "Düzenleniyor".
- [ ] Değişken paneli: `source` bazlı gruplama (Genel/Sistem/Form Alanları/Özel), ≥8 değişkende arama kutusu, hedef yokken panel-üstü `Info` uyarısı + tüm satırlar disabled.
- [ ] Stil paneli: hizalama segmented control, `ColorField` + "Temizle" (X) eklentisi, boşluk 4'lü metin segmented (px karşılıkları: 0/8/16/32), ayırıcı kalınlık mini-bar ikonları, buton radius mini-kare ikonları.
- [ ] Önizleme: `Monitor`/`Smartphone` toggle (640px/375px), konu satırı çubuğu + `iframe sandbox bg-white`, debounce sırasında yalnızca küçük `Spinner`.
- [ ] Test gönder: `dirty` iken disabled + tooltip; sonuç geri bildirimi `sonner` toast (yeni bileşen YOK).
- [ ] Özel değişken formu: inline (modal değil), canlı `slugify` anahtar önizlemesi + çakışma hatası.
- [ ] Şablon listesi: content-list-table'ın GÖRSEL dili (Table/rozet/hover class'ları) ile hafif, özel bir tablo — bileşenin kendisi yeniden kullanılmaz.
- [ ] Public iletişim formu: `--site-primary`/`--site-button(-text)` tokenleri, mevcut public buton class'ı birebir, KVKK checkbox + link deseni.

**Bölüm B:**
- [ ] "Düzen" kontrolü her blok/`columns` başlığında `DropdownMenu` (`Square`/`Columns2`/`Columns3` + `Check`), global araç çubuğunda DEĞİL.
- [ ] `gap` → `gap-0/gap-2/gap-4/gap-8` (0/8/16/32px, Bölüm A ile aynı ölçek).
- [ ] Konteyner çerçevesi `border-2 border-dashed border-border/70 bg-surface-muted/30`, başlık satırında ikon+özet+`Info` mobil-yığılma ipucu.
- [ ] Boş sütun `min-h-24 border-2 border-dashed`, sürükleme sırasında `border-primary bg-primary/5 text-primary`.
- [ ] `DropIndicator`/`DragOverlay` `nav-tree-row.tsx`'ten AYNEN taşınır.
- [ ] Unwrap/daralma onayı: `ConfirmDialog tone="warning"` (yeni diyalog bileşeni YOK).
- [ ] `verticalAlign` (3'lü dikey hizalama ikon seti) ve `ratio` (yalnızca 2 sütunda, özel `RatioIcon` mini-bar) v1'de AÇIK, konteyner başlığına gömülü, düşük vurgulu.
