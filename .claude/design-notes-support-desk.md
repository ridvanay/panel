# Tasarım Notları — Erken Katılım Modalı & Canlı Destek Masası

**ui-designer** · Kapsam: `.claude/architect-scope-support-desk-and-reminders.md` §1.3 ve §4.5.
Bu doküman **kod içermez**; frontend-agent'a devredilecek somut bileşen/token kararlarıdır.
Görsel yön: projenin mevcut **Minimal/Flat** dili (dark-uyumlu, `Badge`/`Button`/`Dialog` tone
tokenleri) — yeni bir görsel dil **açılmadı**, yalnızca mevcut tokenlerin bu iki yüzeye eşlemesi.

---

## 1. Erken Katılım Onay Modalı

**Bulgu:** Proje zaten `frontend/src/components/ui/confirm-dialog.tsx` içinde tam ihtiyaca uyan bir
`ConfirmDialog` bileşenine sahip — `tone="warning"` verildiğinde `AlertTriangle` ikonlu, amber
(`bg-warning/10 text-warning`) rozet + `outline` (Vazgeç) / `warning` variant (onay) buton
ikilisini **zaten üretiyor**. Yeni bir Dialog kompozisyonu yazmaya **gerek yok**.

**Karar:** `join-meeting-button.tsx` içinde doğrudan `<ConfirmDialog>` kullanılsın:

| Prop | Değer |
|---|---|
| `tone` | `"warning"` (amber ikon/rozet — `danger` DEĞİL: bu bir engelleme değil bilgilendirme) |
| `title` | "Erken Katılım" (kısa, DialogTitle) |
| `description` | Architect §1.3'teki birebir metin: *"Dikkat: Randevu saatinizden erken katılıyorsunuz. Görüşmeyi erken başlatıp sonlandırmanız durumunda, asıl randevu saatinizde odaya yeniden giriş yapılamayabilir. Devam etmek istiyor musunuz?"* |
| `cancelText` | "Vazgeç" (ikincil, `variant="outline"` — zaten `ConfirmDialog` varsayılanı) |
| `confirmText` | "Anladım, Odaya Katıl" (birincil-uyarı, `variant="warning"` — zaten `ConfirmDialog`'un `tone="warning"` eşlemesi) |
| `onConfirm` | `window.location.assign(href)` |

**İkon:** `AlertTriangle` (lucide-react) — `ConfirmDialog` bunu otomatik render eder, ayrıca ikon
seçimi gerekmez. `destructive`/`danger` tonu **kullanılmaz** (kırmızı = "silme/geri dönüşsüz"
anlamına geliyor bu projede; burada yanlış sinyal olur).

**Buton hiyerarşisi:** Vazgeç = ikincil/outline (sol veya mobilde üst — `DialogFooter`'ın
`flex-col-reverse sm:flex-row sm:justify-end` düzeni zaten bunu veriyor); Anladım = birincil-uyarı
(sağda, amber dolgu). Hiçbir buton `destructive` değil.

Yeni bileşen/dosya **gerekmez** — bu madde salt bir eşleme kararıdır.

---

## 2. Admin Canlı Destek Masası (`/admin/support`)

### 2.1 Oturum listesi (sol panel)
**Yeniden kullanılacak desen:** `frontend/src/app/admin/contact/submissions/page.tsx` —
`InputGroup` (arama) + `Select` (durum filtresi) + dikey liste kartları
(`rounded-xl border p-4`, aktif/vurgulu satır `border-primary/30 bg-primary/5`). Destek
oturumları için de **aynı kart deseni** kullanılır (yeni bir liste bileşeni icat edilmez).

**Sekme/filtre kararı:** Durum filtresi için `Select` yerine `Tabs` (`components/ui/tabs.tsx`,
`variant="line"`) tercih edilir — architect'in `meta.counts` sekme rozetleri gereksinimiyle daha
iyi eşleşir (her `TabsTrigger` içine `Badge tone="neutral" size="sm"` ile sayı eklenebilir: "Bekleyen (3)"). Arama kutusu `contact/submissions` ile birebir aynı `InputGroup` + `Search` ikonu.

**Liste satırı içeriği:** ziyaretçi adı (veya "Misafir Ziyaretçi" — `visitorName` boşsa), durum
`Badge`, `lastMessagePreview` (120 karakter, `text-foreground/60`), `createdAt`/`lastMessageAt`
göreli zaman (`date-fns` + `tr` locale — `notifications/templates/page.tsx`'teki
`relativeDate` yardımcı fonksiyon deseni). Atanmış temsilci varsa küçük `Avatar` veya isim etiketi
sağ üstte (opsiyonel, alan yoksa atlanabilir).

### 2.2 Durum rozeti eşlemesi (`Badge` — YENİ RENK YOK)

| Durum | `tone` | `solid` | Gerekçe |
|---|---|---|---|
| `PENDING` | `warning` | `false` (soft) | Dikkat gerektiren, henüz ele alınmamış — `contact-submissions`'daki `NEW` → `primary` yerine burada `warning` daha doğru: "aciliyet" bekleyen kuyruk. |
| `ANSWERED` | `success` | `false` (soft) | Yanıtlanmış, olumlu durum — `email-templates`'teki aktif şablon `success` tonuyla tutarlı. |
| `CLOSED` | `neutral` | `false` (soft) | Nötr/arşiv — `contact-submissions`'daki `ARCHIVED`/`READ` ile aynı ton. |

Liste satırında `size="sm"`; oturum detay panelinin başlığında `size="lg"` kullanılabilir. `solid`
varyantı bu ekranda **kullanılmaz** (liste yoğun, soft ton okunabilirliği korur) — `solid` yalnızca
tek bir durum rozetinin öne çıkması gereken (`email-templates`'teki Aktif/Pasif gibi) tekil
noktalarda kullanılıyordu; burada listede birden çok rozet yan yana göründüğünden soft tercih edilir.

### 2.3 Sohbet paneli (sağ panel) — baloncuk yön/renk kararı

**Referans:** `frontend/src/components/site/live-chat-widget.tsx` satır ~96-106 —
ziyaretçi mesajı `ml-auto bg-primary text-primary-foreground` (sağa yaslı, dolgu vurgulu),
temsilci mesajı `bg-muted text-foreground` (sola yaslı, nötr).

**Admin tarafında ayna kural (architect'in önerdiği gibi, karar netleştirildi):**

| Gönderen | Widget'ta (ziyaretçi ekranı) | Admin'de |
|---|---|---|
| `VISITOR` | sağda, `bg-primary text-primary-foreground` | **solda**, `bg-muted text-foreground` (nötr) |
| `AGENT` | solda, `bg-muted text-foreground` | **sağda**, `bg-primary text-primary-foreground` (vurgulu) |

Gerekçe: her iki ekranda da "ben" (mesajı bu ekrandan yazan taraf) sağda ve vurgulu, "karşı taraf"
solda ve nötr — sohbet uygulamalarındaki evrensel konvansiyon, widget'ın **renk dilini
değiştirmeden** (`bg-primary`/`bg-muted` aynı token'lar) yalnızca hizalama ve "kimin ekranı"
bağlamı tersine çevrilir. Baloncuk şekli aynı: `rounded-[var(--site-radius)] px-3 py-2 text-sm`,
`max-w-[85%]`.

Her baloncuğun altında/üstünde küçük meta satırı: `senderDisplayName` (AGENT için) + saat
(`text-xs text-foreground/50`) — widget'ta yoktu, admin tarafında "kim yanıtladı" görünürlüğü için
eklenir (architect §3.4'teki `senderDisplayName` snapshot alanı bunun için var).

Panel çerçevesi: `contact/submissions/[submissionId]` benzeri bir detay kartı
(`rounded-xl border border-border bg-card`), üstte oturum başlığı + durum rozeti + atama
dropdown'ı, ortada kaydırılabilir mesaj listesi (`ScrollArea` — `components/ui/scroll-area.tsx`
zaten var), altta yanıt kutusu.

### 2.4 Yanıt kutusu ve şablon seçici
- Metin girişi: `Textarea` (`components/ui/textarea.tsx`) — düz metin, 2000 karakter sınırı bir
  `text-xs text-foreground/50` sayaçla gösterilebilir (ör. "142/2000").
- Şablon seçici: `Select` (`components/ui/select.tsx`) — `notifications/templates` listesinden
  bilinen desen; seçilince `Textarea` içeriğini doldurur (frontend-agent'ın işi), tasarımsal olarak
  yanıt kutusunun hemen üstünde ince bir `InputGroup`-benzeri şerit.
- Gönder butonu: `Button` `variant="default"` (primary, `Send` ikonu — `live-chat-widget.tsx`'teki
  gönder ikonuyla tutarlı).

### 2.5 Temsilci atama alanı
`Select` (`components/ui/select.tsx`) — `contact/submissions` filtre `Select`'iyle aynı görsel;
`GET /admin/support/agents` sonucundan `{ id, name, role }` ile doldurulur. Panel başlığında,
durum rozetinin yanında küçük bir etiketli alan: "Atanan: [Select]". Seçenek yoksa/boşsa
placeholder "Atanmamış".

### 2.6 İkon seti (lucide-react — tek kaynak)
- Sayfa başlığı (`PageHeading`): `MessageCircle` (widget'ın tetikleyici ikonuyla tutarlı).
- Sekmeler: gerekirse `Clock` (Bekleyen), `MessageSquareText`/`CheckCheck` (Yanıtlanan),
  `Archive` (Kapatılan) — opsiyonel, yalnızca sekme metniyle de yeterli, ikon zorunlu değil.
- Arama: `Search`. Atama: `UserCog` veya `UserPlus`. Gönder: `Send`. Şablon: `FileText`.
- Kapatma eylemi (oturumu kapat): `X` veya `Archive` — `DropdownMenuItem` içinde `variant="destructive"`
  **kullanılmaz** (kapatma silme değildir); nötr/`ghost` yeterli. Silme (`DELETE`) eylemi için
  `Trash2` + `ConfirmDialog tone="danger"` (`contact/submissions`'daki silme deseniyle birebir aynı).

### 2.7 Şablon yönetimi (`/admin/support/templates`)
**Yeniden kullanılacak desen:** `frontend/src/app/admin/notifications/templates/page.tsx` —
masaüstünde `Table` (Ad / Durum / Son Düzenleme / işlemler `DropdownMenu`), mobilde kart listesi;
yeni kayıt için `Dialog` tabanlı form (`NewTemplateDialog` deseni: `Field` + `Input` + `Textarea`
+ `DialogFooter` [Vazgeç: outline] [Oluştur: default]); silme için `ConfirmDialog tone="danger"`.
Sütunlar burada: Başlık (`title`), Durum (`isActive` → `Badge tone={isActive ? "success" : "neutral"} solid size="lg"` — email-templates'teki Aktif/Pasif rozetiyle birebir aynı), Kullanım
Sayısı (`usageCount`, düz metin), sıralama (`sortOrder` — sürükle-bırak istenmedi, basit sayısal
alan yeterli). Yeni bileşen icat edilmez.

---

## 3. Özet — yeniden kullanılan dosyalar
- `frontend/src/components/ui/confirm-dialog.tsx` — erken katılım modalı (`tone="warning"`).
- `frontend/src/components/ui/badge.tsx` — durum rozetleri (`warning`/`success`/`neutral`).
- `frontend/src/components/ui/tabs.tsx` (`variant="line"`) — oturum durum sekmeleri.
- `frontend/src/components/ui/select.tsx` — atama dropdown'ı + şablon seçici.
- `frontend/src/components/ui/table.tsx`, `dialog.tsx`, `confirm-dialog.tsx`, `dropdown-menu.tsx` —
  şablon CRUD (`notifications/templates/page.tsx` deseni).
- `frontend/src/app/admin/contact/submissions/page.tsx` — oturum listesi kart/arama/filtre deseni.
- `frontend/src/components/site/live-chat-widget.tsx` — baloncuk renk/şekil token'ları (yön ayna).
