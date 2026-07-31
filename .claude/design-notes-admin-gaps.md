# Tasarım Notları — Admin Panel Eksikleri (Sistem Sağlığı / Güvenlik / Ayarlar)

> Hazırlayan: ui-designer. Bu dosya sadece tasarım kararlarıdır, implementasyon frontend-agent tarafından yapılacaktır.
> İki farklı görsel dil bilinçli olarak korunmuştur: **Sistem Sağlığı & Güvenlik** = nötr admin dili (`Card`, `--surface`/`--foreground` token'ları); **Ayarlar** = glassmorphic "bento" dili (`bg-white/5`, `backdrop-blur-xl`, `border-white/10`). Aşağıdaki her madde kendi sayfasının diline uyar, karıştırılmaz.

---

## 1. Desteklenmeyen Metrik Kartı (CPU — Windows)

Dosya: `frontend/src/components/admin/system/health-panel.tsx`, CPU kartı (satır ~204-216), `MetricCard` bileşeni (satır ~71-82).

**Kart görünümü (dış sarmalayıcı, `Card` üstüne uygulanacak ek class'lar):**
```
opacity-60 grayscale-[0.4] border-dashed
```
Tam örnek: `MetricCard`'a opsiyonel bir `disabled?: boolean` prop'u eklenip Card'a şu class'lar iletilmeli:
```tsx
<Card className={cn("space-y-3", disabled && "border-dashed border-border/40 bg-surface/40 opacity-60 grayscale-[0.4]")}>
```
- `grayscale` tam (`grayscale`) değil, kısmi (`grayscale-[0.4]`) kullanılsın — tamamen renksiz olursa ikon/text okunabilirliği bozulur.
- Hover efekti (`hover:border-border hover:shadow-md`, Card'ın default'u) bu kartta **devre dışı** kalmalı — etkileşilemez olduğu hissettirilmeli. Gerekirse `hover:border-border/40 hover:shadow-none` override'ı ekle.

**Rozet:** Kartın sağ üst köşesine, `MetricCard` header satırının sağına (label ile aynı satır, `justify-between` ile) `Badge tone="neutral"` yerleştirilsin:
```tsx
<Badge tone="neutral">Desteklenmiyor</Badge>
```
- `tone="neutral"` seçildi çünkü bu bir hata/uyarı değil, platform kısıtı — `warning`/`danger` yanlış anlam verir.
- Mevcut alt not metni (`note` prop, "Bu metrik Windows'ta..." açıklaması) **korunsun**, kaldırılmasın — rozet hızlı tarama için, alt metin detay için.
- Değer alanı (`—`) olduğu gibi kalsın, sadece kartın genel opacity'si nedeniyle zaten soluklaşmış görünecek.

---

## 2. Sparkline Mini-Grafik (Veritabanı Ping, RAM Kullanımı, Bu Süreç Belleği)

**Veri:** Son 10 dakika, 10 saniyede bir toplanan ~60 nokta (frontend-agent tarafında client-side ring buffer olarak tutulacak, poll interval zaten 10sn).

**Boyut:** `h-8 w-full` (32px yükseklik, kart genişliğine tam yayılan). Kartın mevcut padding'i (`Card` = `p-6`) içinde kalsın, sparkline'ın kendi container'ına ekstra padding verilmesin.

**Yerleşim:** Sayının/progress bar'ın **altına**, `note` metninin **üstüne** eklenecek yeni bir satır:
- Veritabanı Ping kartı: `<p className="text-2xl ...">{ms}</p>` → **sparkline** → (varsa alt not).
- RAM Kullanımı kartı: sayı → `ProgressBar` → **sparkline** → byte metni. Sparkline progress bar'ın hemen altına, `mt-1` boşlukla.
- Bu Süreç Belleği kartı: sayı → **sparkline**.

**Render yöntemi:** Basit inline SVG `<polyline>` — ekstra kütüphane (recharts vb.) gerekmiyor, zaten proje `visitor-chart.tsx`/`activity-bar-chart.tsx` gibi yerlerde chart kütüphanesi kullanıyor olabilir ama bu kadar küçük bir sparkline için overkill; native SVG tercih edilsin. `viewBox="0 0 100 24"` ile `preserveAspectRatio="none"`, değerler 0-100 aralığına min/max normalize edilerek noktalanır.

**Renk:** Tone'a göre **dinamik** — o kartın zaten kullandığı severity tonu ile eşleşmeli, tutarlılık için:
- Ping kartı: `pingTone(ms)` sonucuna göre `stroke-success` / `stroke-warning` / `stroke-danger` (mevcut `toneTextClasses` pattern'iyle aynı mantık, en son değerin tonu kullanılır).
- RAM kartı: sabit `stroke-primary` (RAM için zaten ayrı bir severity sistemi yok, progress bar da `bg-primary` — tutarlı olsun).
- Process Belleği kartı: sabit `text-foreground/40` tonunda nötr çizgi (`stroke-foreground/40`) — bu metrik için severity kavramı yok.

Çizgi kalınlığı: `strokeWidth={1.5}`, `fill="none"`, `strokeLinecap="round" strokeLinejoin="round"`. Dolgu (area fill) **eklenmesin** — sade çizgi yeterli, kartlar zaten yoğun değil.

**Az veri noktası durumu (sayfa yeni açıldığında, 1-2 nokta varken):**
- 0 nokta: sparkline alanı tamamen boş bırakılmasın, `border-b border-dashed border-border/30` ile ince bir "yer tutucu" çizgi (düz, ortada) gösterilsin — layout shift'i önler.
- 1 nokta: aynı yer tutucu davranışı (tek noktadan çizgi çizilemez).
- 2+ nokta: gerçek polyline çizilmeye başlar, veri arttıkça (60'a kadar) sağdan sola dolan bir pencere gibi kayar (en yeni veri her zaman sağda).

Erişilebilirlik: SVG'ye `aria-hidden="true"` eklensin — dekoratif, sayısal değer zaten üstte metin olarak var.

---

## 3. Aktif Oturumlar Tablosuna Cihaz Tipi İkonu

Dosya: `frontend/src/app/admin/settings/security/page.tsx`, tablo satırı (~297-322), "Cihaz / Tarayıcı" hücresi (~299-301).

**İkon seti:** `lucide-react`'tan `Monitor` (masaüstü), `Smartphone` (mobil), `Tablet` (tablet). Ayrıştırma belirsizse (user-agent parse edilemedi) fallback: `Monitor` (en yaygın admin senaryosu masaüstüdür, varsayım güvenli tarafta kalsın).

**Yerleşim:** Aynı hücrede, user-agent metninin **solunda**, satır içi (`flex items-center gap-2`):
```tsx
<TableCell className="max-w-[280px] text-foreground/80">
  <span className="flex items-center gap-2">
    <DeviceIcon className="h-4 w-4 shrink-0 text-foreground/40" />
    <span className="truncate">{session.userAgent ?? "Bilinmiyor"}</span>
  </span>
</TableCell>
```
- `truncate` artık iç `span`'e taşınmalı (mevcut kod `TableCell`'e `truncate` veriyordu, ikon eklenince flex container gerekiyor).
- İkon boyutu: `h-4 w-4` (diğer tablo/kart ikonlarıyla tutarlı, örn. `MetricCard` ikonu da `h-4 w-4`).
- Renk: `text-foreground/40` — nötr, dikkat çekmemeli, sadece hızlı tarama için görsel ipucu.

**"Bu cihaz" badge'i ile ilişki:** Ayrı kalsın, birleştirilmesin. "Durum" sütunundaki `Badge tone="primary"` (Bu cihaz) mevcut yerinde kalır; cihaz tipi ikonu sadece "Cihaz / Tarayıcı" hücresinde bağımsız bir görsel ipucu olarak eklenir. İkisini aynı hücrede birleştirmek (örn. ikonu badge içine taşımak) okunabilirliği düşürür, tablo kolonlarının anlamı bulanıklaşır.

---

## 4. 2FA Durumu Yanına Uyarı Metni (Kapalıyken)

Dosya: `frontend/src/app/admin/settings/security/page.tsx`, 2FA header bloğu (~220-232).

**Yerleşim:** Badge'in **altına**, aynı `<div>` içinde (başlık + açıklama olan sol taraf değil — badge'in bulunduğu sağ taraftaki kapsayıcıya `flex flex-col items-end gap-1` uygulanarak):
```tsx
{user?.twoFactorEnabled ? (
  <Badge tone="success">Etkin</Badge>
) : (
  <div className="flex flex-col items-end gap-1">
    <Badge tone="warning">Kapalı</Badge>
    <p className="text-xs text-warning/80">Hesabınızı korumak için etkinleştirin</p>
  </div>
)}
```
**Tipografi:** `text-xs` (12px, mevcut `note`/hint metinleriyle aynı ölçek — bkz. `MetricCard` note, `DarkField` hint), `text-warning/80` — badge ile aynı renk ailesinden ama biraz daha soluk (badge zaten `bg-warning/10 text-warning` olduğu için tam opak `text-warning` badge ile çakışıp fazla "bağırır", `/80` dengeleniyor).
- Sağa hizalı (`items-end`) çünkü bu kapsayıcı zaten `justify-between` düzeninde sağda duruyor, sol taraftaki başlık/açıklama bloğuyla dikey hizası bozulmasın.
- "Etkin" durumunda bu metin **gösterilmez** — sadece kapalıyken.

---

## 5. Ayarlar Sayfası — "Kaydedilmemiş Değişiklik" Göstergesi (Sticky Footer)

Dosya: `frontend/src/app/admin/settings/page.tsx`, sticky footer (~468-488).

Mevcut tab noktası göstergesi (satır ~325-327, `bg-amber-400` nokta) **korunur**, değiştirilmez. Buna ek olarak footer bar'ına metin eklenir.

**Footer bar'ın mevcut dili:** `rounded-xl border border-white/10 bg-white/[0.06] ... backdrop-blur-xl` — glassmorphic, amber/fuchsia accent kullanan bento sistemi. Yeni metin bu dile uyacak şekilde amber tonunda olmalı (tab noktasıyla renk tutarlılığı için).

**Yerleşim:** Footer bar'ın içinde, "Kaydediliyor…" metninin **solunda**, `Kaydet` butonundan önce — sadece `hasUnsavedChanges === true` iken görünür:
```tsx
<div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
  {hasUnsavedChanges && !saving && (
    <span className="flex items-center gap-1.5 text-xs text-amber-300/90">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
      Kaydedilmemiş değişiklikler var
    </span>
  )}
  {saving && <span className="text-xs text-white/50">Kaydediliyor…</span>}
  <motion.button ...>Kaydet</motion.button>
</div>
```
- Nokta ikonu (`h-1.5 w-1.5 rounded-full bg-amber-400`) tab'daki noktayla **aynı boyut/renk** — iki gösterge arasında görsel bir dil birliği kurar (kullanıcı "bu nokta = kaydedilmemiş değişiklik" anlamını tek yerde öğrenip her yerde tanır).
- Metin rengi: `text-amber-300/90` — footer'ın zaten kullandığı `amber-400` (tab noktası) ve `red-300`/`emerald-300` (üstteki durum mesajları, satır 350/356) ile aynı doygunluk seviyesinde, tutarlı.
- `saving` true olduğunda "Kaydedilmemiş değişiklikler var" metni **gizlenir** (yerini "Kaydediliyor…" alır) — iki mesaj aynı anda gösterilmez, çakışma olmaz.
- Footer'ın kendisi zaten sadece "general" tab'ında render ediliyor; bu davranış değişmiyor, sadece iç içerik ekleniyor.

---

## Genel Notlar

- Her iki sayfa da (Sistem Sağlığı / Güvenlik) `Card` bileşenini kullanır — oradaki tüm yeni öğeler (rozet, sparkline, ikon, uyarı metni) `--foreground`/`--success`/`--warning`/`--danger`/`--primary` CSS custom property'lerine bağlı Tailwind class'ları (`text-foreground/*`, `text-warning` vb.) kullanmalı, hardcoded hex değer kullanılmamalı — dark/light tema otomatik uyumlu kalsın.
- Ayarlar sayfası `amber-400`/`red-300`/`emerald-300` gibi sabit Tailwind renklerini zaten kullanıyor (CSS custom property değil) — madde 5'teki öneri bu mevcut paternle tutarlı, sayfanın geri kalanıyla karışık bir sistem yaratmıyor.
- Yeni ikonlar (`Monitor`, `Smartphone`, `Tablet`) `lucide-react`'tan import edilmeli — projede zaten tek ikon kaynağı bu, farklı set eklenmemeli.
