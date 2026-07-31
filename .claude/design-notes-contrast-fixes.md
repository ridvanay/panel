# Kontrast Denetimi — WCAG AA Bulguları ve Düzeltme Notları

**Tarih:** 2026-07-31 · **Yazan:** ui-designer · **Uygulayacak:** frontend-agent

Yöntem: relative luminance formülü (WCAG) ile her metin/arka-plan çiftinin gerçek render edilen
rengi (opaklık modifikatörleri alfa-kompozit edilerek) hesaplandı. Eşik: küçük metin 4.5:1,
büyük metin (≥18px veya ≥14px-bold) 3:1, salt dekoratif/ikon 3:1 (WCAG 1.4.11), disabled form
alanları muaf (WCAG 1.4.3 "inactive UI component" istisnası) — ama placeholder/hint METİNLERİ
yine de okunabilir olmalı (bu görevin talimatı).

## 1. `globals.css` içinde YAPILAN token değişiklikleri (ui-designer tarafından uygulandı)

Sadece **light tema (`:root`)** token'ları değişti — dark tema (`.dark .admin-shell`) zaten AA'yı
geçiyordu (danger/success/warning 5.9–9.3:1 aralığında), dokunulmadı.

| Token | Eski | Yeni | Eski oran (düz metin / Badge `/10` kompoziti) | Yeni oran |
|---|---|---|---|---|
| `--danger` | `#dc2626` | `#b91c1c` (red-700) | 4.83:1 / **4.13:1 FAIL** | 6.47:1 / 4.98:1 |
| `--success` | `#16a34a` | `#166534` (green-800) | 4.6:1(≈) / **4.28:1 FAIL** | 7.13:1 / 6.00:1 |
| `--warning` | `#f59e0b` | `#92400e` (amber-800) | **2.12:1 FAIL** / **2.12:1 FAIL** | 7.09:1 / 6.08:1 |
| `--warning-foreground` | `#451a03` | `#ffffff` | (kullanılmıyordu) | solid `bg-warning` senaryosu için hazır |

Not: "Badge kompoziti" = `bg-{tone}/10` katmanının gerçek sayfa/kart arka planı (ör. beyaz) üzerine
%10 alfa ile bindirilmiş hâli — görünüşte sayfa arka planına çok yakın olsa da hesaplama bunu
dikkate aldı.

**Etkilenen bileşenler (otomatik düzelir, ek TSX değişikliği gerekmez):** `Badge` (`ui/badge.tsx`),
`Alert` (`ui/alert.tsx`), `Field` zorunlu `*` işareti (`ui/field.tsx`), `StatCard` delta oku
(`admin/stats/stat-card.tsx`), `HealthPanel` tonlu metin/bar (`admin/system/health-panel.tsx`),
`notification-center.tsx`, `admin/logs/page.tsx`, `pricing/page.tsx`. Bu dosyalarda kod
değişikliği GEREKMİYOR — hepsi CSS custom property'yi tüketiyor.

Görsel etki notu: `--warning` artık belirgin şekilde daha koyu/kahverengi bir amber (amber-800).
frontend-agent'ın health-panel.tsx'teki "CPU/Ping" uyarı rengi ve settings/security sayfasındaki
"Kapalı" rozeti gibi yerlerde yeni tonun turuncu/amber kimliğini hâlâ koruduğunu görsel olarak
teyit etmesi iyi olur (marka/his değişmedi, sadece koyuluk arttı).

## 2. `.tsx` içindeki class değişiklikleri (frontend-agent uygulayacak)

Bunlar CSS token'ı DEĞİL — ya `text-foreground/NN` gibi bir custom-property'nin ham Tailwind
opaklık modifikatörü, ya da settings sayfasındaki literal `text-white/NN` sınıfları. Token
değişikliği bunları düzeltmiyor, class'ların kendisi değişmeli.

### 2.1 `frontend/src/components/admin/system/health-panel.tsx`

| Satır | Eski | Yeni | Gerekçe |
|---|---|---|---|
| 92 | `text-xs text-foreground/50` | `text-xs text-foreground/60` | Dark temada 4.89:1 ile AA'yı zar zor geçiyor ama **light temada 3.69:1 ile FAIL** (Card `bg-surface/70` beyaz zemin). `/60` her iki temada da geçer (dark ~6.25:1, light ~5.25:1). |
| 258 | `text-xs text-foreground/50` | `text-xs text-foreground/60` | Aynı gerekçe (RAM kullanım alt metni). |
| 296 | `text-xs text-foreground/50` | `text-xs text-foreground/60` | Aynı gerekçe (DB kota alt metni). |
| 301 | `text-xs text-foreground/50` | `text-xs text-foreground/60` | Aynı gerekçe. |
| 314 | `text-xs text-foreground/50` | `text-xs text-foreground/60` | Aynı gerekçe (medya kota alt metni). |
| 319 | `text-xs text-foreground/50` | `text-xs text-foreground/60` | Aynı gerekçe. |
| 332 | `text-xs text-foreground/40` | `text-xs text-foreground/60` | "Son güncelleme…" satırı — dark temada 3.57–3.78:1, light temada ~3:1'in de altına düşer; ikisi de FAIL. `/60` ile düzelir. |

**Disabled CPU kartı (satır 76-95, özellikle 79-82) — ayrı ve daha ciddi bir bulgu:**
`disabled && "... opacity-60 grayscale-[0.4] ..."` sınıfı `<Card>` KÖKÜNE uygulanıyor, yani
başlık satırındaki `Badge tone="neutral"` ("Desteklenmiyor" rozeti) de bu %60 opaklığın içine
giriyor. Bileşik hesap: Badge'in kendi `text-foreground/70` metni ÖNCE badge arka planıyla
(`bg-surface-muted`, opak) kompozit oluyor (→ görünür renk L≈0.443), SONRA bu opak piksel grubun
`opacity-60`'ı ile sayfa arka planına karşı tekrar kompozit oluyor. Sonuç: **~3.62:1, FAIL**
(oysa aynı badge dimming olmadan 8.1:1). Yani şu an "Desteklenmiyor" rozeti tam da okunması en
kritik olduğu disabled kartta en düşük kontrastlı hâline düşüyor.

Önerilen düzeltme: `opacity-60 grayscale-[0.4]` sınıfını `<Card>` kök elemanından kaldırıp,
SADECE metrik değerini saran iç `<div>`'e (satır 91, `<div>{children}</div>`) taşı; başlık
satırı (ikon + label + `Badge`, satır 84-90) tam opaklıkta kalsın. Böylece "Desteklenmiyor"
rozetinin kontrastı 8.1:1'e döner, kartın "pasif" hissi de zaten `border-dashed` +
`bg-surface/40` + rozet ile korunur. Kod önerisi:

```tsx
// öncesi (satır 78-82):
<Card
  className={cn(
    "space-y-3",
    disabled && "border-dashed border-border/40 bg-surface/40 opacity-60 grayscale-[0.4] hover:border-border/40 hover:shadow-none"
  )}
>

// sonrası:
<Card
  className={cn(
    "space-y-3",
    disabled && "border-dashed border-border/40 bg-surface/40 hover:border-border/40 hover:shadow-none"
  )}
>
```

ve satır 91:
```tsx
// öncesi:
<div>{children}</div>
// sonrası:
<div className={cn(disabled && "opacity-60 grayscale-[0.4]")}>{children}</div>
```

**Item 5 — Sparkline (`stroke-foreground/40`, satır 102, dekoratif trend çizgisi):** Metin
kontrast kuralına tabi değil (SVG `aria-hidden="true"`, sayısal değer zaten üstte metin olarak
gösteriliyor) ve token değişikliği ZORUNLU değil; yine de not: dark temada ~3.6:1, light temada
~2.7:1 ile grafiksel 3:1 eşiğinin altına da düşebiliyor — çizgi light modda gerçekten soluk
görünür. Zorunlu değil ama istenirse `stroke-foreground/40` → `stroke-foreground/55` kozmetik
bir iyileştirme olur.

### 2.2 `frontend/src/app/admin/settings/page.tsx`

Bu sayfa teme sisteminden bağımsız, HER ZAMAN sabit `bg-[#05050a]` (neredeyse siyah) zemin
kullanıyor (satır 311, 322, 329) — bu nedenle light/dark mod ayrımı yapmadan tek bir hesap
yeterli. Aşağıdaki oranlar bu sabit koyu zemin + `BentoCard`'ın `bg-white/[0.03]` katmanı
(bileşik zemin ≈ `#0d0d11`, luminance ≈0.0041) baz alınarak hesaplandı.

| Opaklık | Kontrast oranı | AA (4.5:1) |
|---|---|---|
| `/80` | 12.4:1 | GEÇER |
| `/60` | 6.5:1 | GEÇER |
| `/50` | 5.3:1 | GEÇER |
| `/45` | 4.53:1 | Sınırda geçer (riskli marj) |
| `/40` | 3.8:1 | **FAIL** |
| `/30` | 2.65:1 | **FAIL** |
| `/20` | 1.79:1 | **FAIL** |
| `/15` | 1.50:1 | **FAIL** |

Gerçek (disabled OLMAYAN, bilgi taşıyan) metinler için önerilen değişiklikler:

| Satır | Bileşen/İçerik | Eski class | Yeni class | Gerekçe |
|---|---|---|---|---|
| 88 | `DarkField` hint metni (paylaşımlı bileşen — TÜM hint'leri tek noktadan düzeltir) | `text-xs text-white/40` | `text-xs text-white/60` | 3.8:1 FAIL → 6.5:1. Görev talimatı: disabled alanların hint'i bile okunabilir olmalı; bu hint aynı zamanda AKTİF "Ana sayfa" seçim kutusunda da kullanılıyor. |
| 121 | `BentoCard` açıklama metni (paylaşımlı — "Genel", "Sayfa Ayarları", "Görünüm", "Rol İzin Matrisi", "E-posta/API" kartlarının tümünü etkiler) | `text-xs text-white/45` | `text-xs text-white/60` | 4.53:1 sınırda/riskli → 6.5:1 güvenli marj. |
| 471 | "Logo yok" yer tutucu metni (logo seçilmemişken gösterilen GERÇEK bilgi, disabled değil) | `text-xs text-white/30` | `text-xs text-white/60` | 2.65:1 FAIL → 6.5:1. |
| 562 | İzin matrisi tablo başlığı (`Modül`, `Görüntüle`, `Oluştur`, `Düzenle`, `Sil` — `text-xs uppercase`) | `text-white/40` | `text-white/60` | 3.8:1 FAIL → 6.5:1. Küçük+uppercase metin, büyük metin istisnası uygulanmaz. |
| 579 | Tablo hücresi "—" (rol bu eylem için tanımsız olduğunda gösterilen gerçek veri) | `text-white/15` | `text-white/50` | 1.50:1 FAIL → 5.3:1. |
| 600–603 | "Bu izin matrisi sistem tarafından tanımlanır…" açıklama metni | `text-xs text-white/40` | `text-xs text-white/60` | 3.8:1 FAIL → 6.5:1. |
| 668–671 | "Bu yapılandırma henüz bu ortamda desteklenmiyor." açıklama metni | `text-xs text-white/40` | `text-xs text-white/60` | 3.8:1 FAIL → 6.5:1 (bu metin disabled bir form alanının içeriği değil, bağımsız bir uyarı cümlesi). |

Judgment-call (tasarım tercihi, zorunlu değil ama önerilir):

| Satır | Bileşen | Eski | Öneri | Gerekçe |
|---|---|---|---|---|
| 129–142 | `RoleBadge` inaktif hâl (rolün izni olmadığını gösteren harf, ör. pasif "V") | `text-white/15` | `text-white/40` | Şu an 1.50:1 — salt dekoratif "kapalı" göstergesi olarak görülse bile WCAG'in 3:1 grafiksel-nesne eşiğinin (1.4.11) de altında. `/40` ≈3.8:1 ile 3:1 eşiğini rahatça geçer, "sönük/pasif" hissini de korur. Tam metin AA'sı (4.5:1) isteniyorsa `/50`'ye çıkarılabilir — bu bir tasarım tercihi, mimari zorunluluk değil. |

**Disabled form alanları (satır 622-666, SMTP/API alanları) — DEĞİŞİKLİK GEREKMİYOR:**
`disabled` input'lardaki `text-white/40` (girilen/placeholder değer) ve `placeholder:text-white/20`
WCAG 1.4.3'ün "inactive user interface component" istisnası kapsamında — bu alanlar hiçbir zaman
etkileşime açılmıyor ("Yakında" etiketiyle işaretli). Yine de not: eğer bu alanlar ileride aktif
hale getirilirse (disabled kaldırılırsa) bu opaklıklar o an yeniden denetlenmeli, çünkü aktif bir
input olarak `/40`(3.8:1) ve `/20`(1.79:1) FAIL olur.

**`ChevronDown` ikonu (satır 451, `text-white/40`) — DEĞİŞİKLİK GEREKMİYOR:** Dekoratif select
oku, metin değil; 3.8:1 oranı WCAG 1.4.11'in 3:1 grafiksel-nesne eşiğini geçiyor.

### 2.3 `frontend/src/app/admin/settings/security/page.tsx`

| Satır | İçerik | Durum |
|---|---|---|
| 248 | `text-xs text-warning/80` (2FA kapalı uyarı metni) | globals.css'teki `--warning` düzeltmesiyle otomatik düzeldi: dark temada zaten 7.4:1 idi, light temada eski değerle hesaplanmamıştı ama yeni `#92400e` ile ~4.53:1'e çıktı (eski `#f59e0b` ile olsaydı ~2:1 civarı FAIL olurdu). **TSX değişikliği gerekmiyor.** |
| 239, 278, 326, 327 | `text-foreground/60` (tablo/açıklama metinleri) | Hem dark (~6.25:1) hem light (~5.25:1) temada GEÇER. Değişiklik gerekmiyor. |
| 320 | `text-foreground/80` | Her iki temada da yüksek kontrast (dark ~9:1, light ~11:1). Değişiklik gerekmiyor. |
| 322 | `text-foreground/40` (cihaz ikonu, dekoratif) | Dark temada 3.57–3.78:1 ile grafiksel 3:1 eşiğini geçiyor (sorun yok). **Light temada ~2.71:1 ile 3:1'in altında kalıyor** — küçük bir bulgu, isteğe bağlı: `text-foreground/40` → `text-foreground/55` yapılırsa light modda da 3:1 üstüne çıkar. Zorunlu değil (dekoratif ikon, yanındaki metin zaten okunuyor) ama önerilir. |

## 3. Özet — kontrol listesi

- [x] `globals.css` `:root` içindeki `--danger`/`--success`/`--warning`/`--warning-foreground` AA'yı geçecek şekilde güncellendi (dark `.admin-shell` bloğuna dokunulmadı, zaten uygunduı).
- [ ] `health-panel.tsx`: 7 adet `text-foreground/50|40` → `/60` (satır 92, 258, 296, 301, 314, 319, 332) — frontend-agent.
- [ ] `health-panel.tsx`: disabled `MetricCard` kompozisyonu — `opacity-60 grayscale-[0.4]` Card kökünden metrik-içerik `div`'ine taşınmalı (satır 79-82, 91) — frontend-agent.
- [ ] `settings/page.tsx`: 6 zorunlu class düzeltmesi (satır 88, 121, 471, 562, 579, 600-603/668-671) + 1 opsiyonel (satır 129-142 RoleBadge) — frontend-agent.
- [ ] `settings/security/page.tsx`: zorunlu değişiklik yok; opsiyonel light-mode ikon kontrastı (satır 322) — frontend-agent isterse.
