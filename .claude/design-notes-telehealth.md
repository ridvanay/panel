# Tasarım Notları — Tele-Sağlık Kliniği (`telehealth` modülü + `telehealth-clinic` şablonu)

Durum: v1 (2026-09-10) · Sahibi: ui-designer
Girdi: `.claude/architect-scope-telehealth-template.md` §6.3, §6.4, §6.6, §9.5 (BAĞLAYICI — rota/
kontrat/veri/LiveKit sahiplik kararları burada TEKRAR EDİLMEZ, yalnızca görsel karar üretilir).
Uygulayıcı: frontend-agent (bileşenler), backend-agent (`telehealth-clinic.ts` içindeki
`appearance` başlangıç değerleri). **Kod YAZILMAMIŞTIR** — bu dosya sadece karar setidir.

**Kapsam dışı (bilinçli):** `Appointment` veri modeli, LiveKit token/grant mantığı, saat
dilimi hesaplama algoritması, KVKK metinleri — bunlar sırasıyla db-agent/integration-agent/
backend-agent/compliance-agent'ın alanı; bu doküman yalnızca bunların **üstündeki görsel
katmanı** tarif eder.

---

## 0. Görsel yön ve token kaynağı

Proje genelinde zaten **A) Minimal/Flat** (`design-notes-ecommerce-storefront.md` §0,
`design-notes-checkout-redesign.md` başlığı — düz `bg-surface`/`bg-card`, ince
`border-border`, gradyan/ambient glow YOK). **Bu doküman bu dili KIRMAZ.** Tek pragmatik
istisna, projede zaten kurulu olan "yüzen kontrol üzerinde blur" deseni
(`FavoriteButton: bg-surface/90 backdrop-blur-sm`) — bu dokümanda **yalnızca konsültasyon
odasının video üzerine bindirilen kontrol çubuğunda** (§5) aynı gerekçeyle tekrar kullanılır.
Bekleme odası/yapılandırılmamış panelleri (§6) DÜZ kart yüzeyleridir, blur YOK.

**Token kaynağı (SAPMA YOK):** `frontend/src/app/globals.css` `.site-scope` bloğu —
`--site-primary/secondary/button/button-text/link/accent/background/surface/text/muted-text`,
`--site-radius` (bu şablonda **16px**, `SITE_BORDER_RADIUS_PX.LG`,
`frontend/src/lib/site-settings/site-radius.ts`). Semantik durum renkleri (`--danger`
`#b91c1c` 6.47:1, `--success` `#166534` 7.13:1, `--warning` `#92400e` 7.09:1 — hepsi düz
metin, AA doğrulanmış, `globals.css:20-45`) **override EDİLMEZ**, kök değerleri miras alınır.
Slot durumları (§3) ve uyarı panelleri (§6, §9) bu KÖK tokenlerini kullanır — telehealth için
YENİ bir kırmızı/yeşil/amber İCAT EDİLMEZ.

**İkon seti:** yalnızca `lucide-react` ([DTI] §9.3 ile tutarlı, tek kaynak).

---

## 1. Palet ve WCAG AA doğrulaması — mimari önerinin ÜZERİNE nihai karar

Mimari doküman (§6.4) şu başlangıç tablosunu öneriyor ve **açıkça** şu uyarıyı taşıyor:
*"`#0D9488` beyaz üzerinde 3,6:1 kontrast verir → normal gövde metni için WCAG AA'yı GEÇMEZ...
Nihai hex'ler ve AA doğrulaması ui-designer'ın kararıdır."* Aşağıda TÜM metin/link/buton
rollerinin **gerçek** (WCAG 2.1 göreli parlaklık formülüyle hesaplanmış) kontrast oranları
verilmiştir; iki alanda mimari önerinin ham hex'i **REDDEDİLİP** koyulaştırılmış bir değerle
DEĞİŞTİRİLMİŞTİR.

### 1.1 Bulgu — `#0D9488` (teal) BAŞARISIZ, `#0284C7` (okyanus mavisi) da BAŞARISIZ

| Renk | Kullanım | Zemin | Ölçülen oran | Sonuç |
|---|---|---|---|---|
| `#0D9488` (teal-600, mimari öneri) | düz metin/rozet | `#FFFFFF` | **3.75:1** | **BAŞARISIZ** (< 4.5:1) |
| `#0D9488` | düz metin/rozet | `#F8FAFC` | **3.58:1** | **BAŞARISIZ** |
| `#0284C7` (sky-600, mimari öneri, "okyanus mavisi" CTA) | **beyaz metin, solid buton zemini** | — | **4.09:1** | **BAŞARISIZ** (< 4.5:1 — buton etiketi tipik `text-sm font-semibold` ≈14px, WCAG'ın 3:1 eşiği tanıyan "büyük metin" sınırının (18.66px kalın / 24px normal) ALTINDA, tam 4.5:1 eşiği uygulanır) |

Mimari dokümanın kendi uyarısı yalnızca `#0D9488` içindi; görev tanımı ikinci aksan rengini
(`#0284C7`) de doğrulamamı istedi ve **o da başarısız çıktı.** `.claude/CLAUDE.md`'nin
"görsel çelişkide ui-designer kazanır" kuralı gereği iki değeri de koyulaştırıyorum.

### 1.2 Nihai karar

| `SiteAppearance` alanı | Mimari öneri | **Nihai (ui-designer)** | Gerekçe |
|---|---|---|---|
| `primaryColor` | `#0D9488` | **`#0F766E`** (teal-700) | §1.1 — metin/rozet rolünde AA garantisi |
| `accentColor` | `#0D9488` | **`#0F766E`** (primaryColor ile AYNI) | Mimari tablo zaten ikisini eşitlemişti; aynı gerekçe |
| `secondaryColor` | `#0F172A` | `#0F172A` (değişmedi) | Zaten AAA (§1.3) |
| `buttonColor` | `#0284C7` | **`#0369A1`** (sky-700) | §1.1 — beyaz buton metniyle AA garantisi |
| `buttonTextColor` | `#FFFFFF` | `#FFFFFF` (değişmedi) | — |
| `linkColor` | `#0369A1` | `#0369A1` (değişmedi — artık `buttonColor` ile AYNI) | Tek "aksiyon mavisi" — `design-notes-ecommerce-storefront.md` §9'daki "buton ile aynı ton, ikinci bir mavi İCAT EDİLMEDİ" ilkesiyle birebir |
| `backgroundColor` / `surfaceColor` | `#F8FAFC` / `#FFFFFF` | değişmedi | Zaten AAA (§1.3) |
| `textColor` / `mutedTextColor` | `#0F172A` / `#64748B` | değişmedi | Zaten AA/AAA (§1.3) — `ecommerce-pro` paletiyle AYNI değerler, ikinci bir hesap GEREKMEZ |
| `borderRadius` / `buttonStyle` | `LG` / `SOLID` | değişmedi | `LG` = **16px** (`SITE_BORDER_RADIUS_PX.LG`) |
| `headingFont` / `bodyFont` | `PLUS_JAKARTA_SANS` / `INTER` | değişmedi | `SiteFont` enum'ına yeni değer YOK ([DTI] §7.1) |
| `presetKey` | `null` | değişmedi | — |

**`buttonColor === linkColor` (`#0369A1`) bilinçli bir sadeleştirmedir**, mimari önerinin
"buton daha canlı, link daha koyu" ayrımını KALDIRIR — çünkü canlı uç (`#0284C7`) AA'yı
geçemiyordu ve iki farklı mavi tonu icat etmek yerine tek, doğrulanmış bir "okyanus mavisi"
aksiyon rengi kullanmak `ecommerce-pro`'nun zaten uyguladığı emsalle tutarlıdır.

**`#0D9488`/`#0284C7` NEREDE HÂLÂ KULLANILABİLİR:** yalnızca metin taşımayan, salt
DEKORATİF, büyük yüzeyler (ör. `preview.svg`/hero'daki gradyan **görsel referansı** — ama
§1.4'te görüleceği gibi hero gradyanının kendisi de nihai değerlerle çizilir, o yüzden bu
istisna fiilen KULLANILMAZ). Kural: **SiteAppearance token'larının hiçbiri ham `#0D9488`/
`#0284C7` DEĞERİNİ TAŞIMAZ** — tutarlılık için tek bir doğrulanmış teal + tek bir doğrulanmış
mavi kullanılır.

### 1.3 Tam kontrast tablosu (WCAG 2.1 göreli parlaklık formülü, 4.5:1 AA eşiği — normal metin)

| Çift | Oran | Sonuç |
|---|---|---|
| `textColor` (`#0F172A`) / `backgroundColor` (`#F8FAFC`) | **17.06:1** | Geçer (AAA) |
| `textColor` / `surfaceColor` (`#FFFFFF`) | **17.85:1** | Geçer (AAA) |
| `mutedTextColor` (`#64748B`) / `backgroundColor` | **4.55:1** | Geçer (AA) |
| `mutedTextColor` / `surfaceColor` | **4.76:1** | Geçer (AA) |
| `primaryColor`/`accentColor` (`#0F766E`) düz metin / `backgroundColor` | **5.23:1** | Geçer (AA) |
| `primaryColor`/`accentColor` düz metin / `surfaceColor` | **5.48:1** | Geçer (AA) |
| Beyaz metin / `primaryColor`/`accentColor` (solid rozet/buton zemini) | **5.48:1** | Geçer (AA) |
| `linkColor`/`buttonColor` (`#0369A1`) düz metin / `backgroundColor` | **5.67:1** | Geçer (AA) |
| `linkColor`/`buttonColor` düz metin / `surfaceColor` | **5.93:1** | Geçer (AA) |
| `buttonTextColor` (beyaz) / `buttonColor` (solid CTA zemini) | **5.93:1** | Geçer (AA) |
| `--success`/`--warning`/`--danger` (kök token, değiştirilmedi) | 7.13 / 7.09 / 6.47 | Geçer (AAA) — §0 |

**Kritik uyarı (frontend-agent'a bağlayıcı):** `primaryColor`/`accentColor` (`#0F766E`),
**koyu `secondaryColor` (`#0F172A`) zemin üzerinde METİN olarak KULLANILMAZ** — o kombinasyon
yalnızca **3.26:1** verir (AA metin eşiğinin altında, ama WCAG 1.4.11'in 3:1 grafiksel
nesne/aktif-gösterge eşiğini GEÇER). Header/footer'da (koyu zemin) teal yalnızca **ikon,
aktif sekme alt çizgisi, küçük nokta/rozet kenarlığı** gibi grafiksel vurgularda kullanılır;
gerçek metin (nav linkleri, footer linkleri) her zaman beyaz/açık gri (`text-white`/
`text-white/70`) — mevcut header/footer bileşenlerinin zaten yaptığı gibi, yeni bir istisna
İCAT EDİLMEDİ.

### 1.4 Hero gradyanı — AA doğrulamasının doğal sonucu

`[DTI] §4.4 madde 1` + mimari §6.5 madde 2: hero `bgType: GRADIENT`, teal → okyanus mavisi.
**Nihai gradyan uçları doğrudan §1.2'nin AA-doğrulanmış hex'leridir: `#0F766E → #0369A1`**
(rastgele bir "daha canlı" ton İCAT EDİLMEZ). Bunun faydası çift yönlüdür: (a) gradyan tek
başına marka hissini taşır, (b) üzerine bindirilen **beyaz** başlık/CTA metni gradyanın HER
noktasında AA'yı geçer — iki ucun luminans değerleri (0.1418 ve 0.1271) birbirine yakın
olduğundan ara noktalarda da beyaz metin kontrastı **5.2:1'in altına DÜŞMEZ.** Ham
`#0D9488 → #0284C7` gradyanı kullanılsaydı bu garanti YOKTU (özellikle `#0284C7` ucunda
beyaz metin 4.09:1'e düşerdi). `heroGrad` yönü: `x1=0% y1=0% x2=100% y2=100%` (sol-üstten
sağ-alta, `modern-architecture`/`ecommerce-pro` preview'larıyla AYNI yön konvansiyonu).

---

## 2. Doktor kartı

Izgara kartı (`/doctors` listesi) VE profil sayfasının üst özet kartı AYNI temel yapıyı
paylaşır, yalnızca boyut değişir.

```
┌──────────────────────────────────┐
│  ┌────┐  Dr. Ayşe Yılmaz          │  ← avatar (dairesel) + unvan+ad
│  │ AY │  Kardiyoloji              │  ← uzmanlık (muted)
│  └────┘                          │
│  [TR] [EN]                       │  ← dil rozetleri
│  ─────────────────────────────── │
│  30 dk · ₺450                    │  ← süre · fiyat
│  [Randevu Al →]                  │
└──────────────────────────────────┘
```

- **Kart yüzeyi:** paylaşılan `Card` primitifi, `rounded-[var(--site-radius)]` (16px),
  `border border-border`, `p-5`, `hover:border-primary/30 hover:shadow-sm
  transition-all duration-150` (ızgara kartı tıklanabilir → `/doctors/[slug]`).
- **Avatar:** `h-16 w-16 rounded-full` (ızgara), `h-24 w-24` (profil özeti) — GERÇEK `Media`
  varsa `object-cover`; yoksa/şablon demo verisinde `Doctor.avatarMediaId` boşsa **monogram
  fallback**: `bg-gradient-to-br from-[#0F766E] to-[#0369A1] text-white font-semibold
  flex items-center justify-center` içinde baş harfler (`fullName`'den türetilir, `Dr./Prof.
  Dr.` unvanı HARİÇ) — `PLUS_JAKARTA_SANS`, ızgarada `text-lg`, profilde `text-2xl`.
  **Fotogerçekçi insan görseli/AI üretimi YASAK** ([DTI] §9.3) — bu fallback DAİMA bir
  harf+gradyan, asla stok/AI yüz.
- **Unvan + ad:** `text-sm font-semibold text-foreground` (ızgara) / `text-2xl font-semibold`
  (profil, §8 tipografi ölçeği) — `{title} {fullName}` tek satır, `truncate` (ızgara).
- **Uzmanlık:** hemen altında, `text-sm text-foreground/60` (mutedTextColor rolü).
- **Dil rozetleri:** paylaşılan `Badge` (`variant="outline" size="sm"`), her biri ISO 639-1
  kodunun BÜYÜK harfli hali (`TR`, `EN`, `DE`) — bayrak emoji KULLANILMAZ (bayrak≠dil,
  ör. `EN` ABD/UK/Avustralya'yı karıştırır; ayrıca emoji font'a bağımlı render tutarsızlığı
  yaratır). `flex flex-wrap gap-1.5`, `aria-label="Konuşulan diller: Türkçe, İngilizce"`
  (kısaltma her zaman tam adla `sr-only`/`title` üzerinden erişilebilir).
- **Ayraç:** `border-t border-border/60 my-3`.
- **Süre · Fiyat:** `flex items-baseline gap-1.5 text-sm` — süre `text-foreground/60`
  (`{sessionDurationMin} dk`), fiyat `text-foreground font-semibold` (`formatPriceFromCents`
  ile AYNI biçimlendirici, checkout/storefront'takiyle BİREBİR).
- **CTA:** ızgarada `Button variant="outline" size="sm" className="w-full mt-3
  rounded-[var(--site-radius)]"` "Profili Gör"; profil özetinde `Button size="lg"
  className="rounded-[var(--site-radius)]"` "Randevu Al" (sayfanın kendi slot takvimine
  scroll eder).
- **`isVerified` rozeti (§7.2 mimari kararı gereği şablon verisinde DAİMA `false`, ama alan
  gerçek kullanımda `true` olabilir):** `true` iken avatarın sağ-alt köşesinde küçük
  `BadgeCheck` (lucide) ikonu, `h-5 w-5 text-white bg-primary rounded-full ring-2
  ring-surface` — **`false` iken HİÇBİR ŞEY render edilmez** (boş/gri bir "doğrulanmamış"
  rozeti YOK — yokluğun kendisi zaten "doğrulanmamış" anlamına gelir, sahte bir negatif
  sinyal üretmenin gereği yok).

---

## 2.1 Doktor detay sayfası — Hero düzeni (v2, 2026-09-11, ui-designer)

Bağlam: `/doctors/[slug]` sayfası bugüne kadar §2'deki paylaşılan `DoctorCard`'ı `size="lg"` ile
BİREBİR aynı şekilde tekrar kullanıyordu (avatar+isim+uzmanlık+dil rozetleri+fiyat+CTA TEK bir
kart yüzeyinde). Bu, bir danışmanlık/randevu HERO'su için yetersiz kaldı: fiyat+CTA sayfa
kaydırıldıkça kayboluyor, "Hakkında" bölümü dar/sıkışık görünüyor, uzmanlık/dil bilgisi görsel
ağırlık taşımıyor. Bu bölüm YALNIZCA doktor DETAY sayfasını kapsar — `/doctors` ızgarasındaki
`DoctorCard` (§2, `size="sm"`) DEĞİŞMEZ.

**Kod implementasyonu YOK** — frontend-agent muhtemelen bunu `DoctorCard`'dan AYRI yeni bir
`DoctorProfileHero` bileşeni olarak kurar (paylaşılan `size="lg"` varyantı BURADA TERK EDİLİR,
ızgara kartı `sm` varyantıyla sınırlı kalır); bu bir implementasyon detayıdır, burada yalnızca
görsel sözleşme verilir.

### 2.1.1 Sayfa iskeleti — iki sütun + sticky yan panel

Mevcut `max-w-5xl` konteyner KORUNUR (`doctors/[slug]/page.tsx`). İçerik artık tek sütun değil,
`lg:` kırılımından itibaren iki sütun: SOL/ana sütun (hero başlığı + "Hakkında" + "Müsaitlik ve
Randevu"), SAĞ sütun YALNIZCA fiyat+CTA paneli — `product-purchase-panel.tsx`'in
`lg:sticky lg:top-24 lg:self-start` deseniyle BİREBİR aynı offset (projede zaten 4 yerde kurulu
emsal — bkz. `checkout/page.tsx`, `catalog-sidebar.tsx`, `product-purchase-panel.tsx` — YENİ bir
sticky-offset değeri İCAT EDİLMEDİ):

```
<div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px] lg:items-start">
  <div className="min-w-0"> {/* ana sütun: hero başlık + Hakkında + Müsaitlik */} </div>
  <aside className="lg:sticky lg:top-24 lg:self-start"> {/* §2.1.4 fiyat/CTA paneli */} </aside>
</div>
```

`320px` sabit genişlik — mevcut `1024px` (`max-w-5xl`) konteynerde ana sütuna `gap-8` (32px)
düşüldükten sonra ~**672px** bırakır; bu, "Hakkında" metninin `max-w-prose` (§2.1.3) ölçüsünü
zaten aşan bir genişlik, rastgele bir kesir DEĞİL.

Mobilde (`<lg`) sütunlar TEK sütuna düşer, panel `sticky` DEĞİLDİR (dar ekranda "yapışkan yan
panel" kavramı anlamsız) — bunun yerine §2.1.5'teki mobil alt çubuk devreye girer.

### 2.1.2 Hero başlık satırı — avatar + isim + rozet/chip'ler

```
┌──────────┐  Dr. Elif Aydemir  [✓ Doğrulanmış Hekim]
│          │  ─────────────────────────────────────
│   EA     │  [🩺 Kardiyoloji]
│          │  [TR] [EN]
└──────────┘
```

- **Kapsayıcı:** `flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:gap-6` — dar
  ekranda avatar üstte/tek sütun, `sm:` (640px) itibaren yan yana.
- **Avatar/fotoğraf alanı — KASITLI olarak §2'nin dairesel ızgara avatarından FARKLI şekil:**
  `h-28 w-28 sm:h-36 sm:w-36 shrink-0 rounded-[var(--site-radius)] overflow-hidden` (yumuşak
  köşeli KARE — `--site-radius` bu şablonda 16px, §8; buton/kart/rozetle AYNI köşe dili, YENİ
  bir radius token İCAT EDİLMEDİ). Gerekçe: hero'nun "profil fotoğrafı" ağırlığını ızgara
  kartının küçük dairesel avatarından görsel olarak AYIRT ETMEK — kullanıcı bunun sıradan bir
  liste öğesi değil, sayfanın ana konusu olduğunu anlar.
  - GERÇEK `avatarMedia` varsa: `<img>` `object-cover h-full w-full`, `border border-border`.
  - YOKSA (monogram fallback, **DAİMA** — [DTI] §9.3, fotogerçekçi/AI insan görseli YASAK):
    `flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0F766E]
    to-[#0369A1] text-3xl sm:text-4xl font-semibold text-white select-none`.
    **§2/§10'daki TEK marka gradyanı BİREBİR korunur; isim/`id`'ye göre hash'lenmiş çoklu renk
    paleti KASITLI OLARAK KULLANILMAZ.** Gerekçe: `design-notes-telehealth.md` §10 bu gradyanı
    "4 doktor avatarı ... AYNI uçlar, marka tutarlılığı" gerekçesiyle zaten sabitlemiş bir
    karardır; ızgara kartı (`h-16 w-16`, onlarca doktor yan yana) ile hero'nun (TEK doktor,
    sayfanın odağı) AYNI gradyanı taşıması, ziyaretçinin `/doctors` ızgarasından tıklayıp
    geldiği kartla profildeki hero'nun AYNI kişi/marka kimliğini taşıdığını görsel olarak
    teyit eder. Renk-hash'leme yalnızca "listede onlarca doktoru birbirinden ayırt etme"
    problemini çözer — bu projede her doktor zaten benzersiz bir fotoğraf/isim/uzmanlık
    kombinasyonuyla ayrışıyor; tam tersine, her doktora farklı bir monogram rengi vermek
    markanın "tek teal→okyanus mavisi" kimliğini sulandırırdı. **Taşma güvencesi:**
    `initialsFromFullName` (`doctor-card.tsx`, DEĞİŞMEDİ) HER ZAMAN yalnızca 1-2 harf
    döndürür — sabit `text-3xl/4xl` ile 112-144px'lik bir kare içinde bu ASLA taşmaz
    (ölçülebilir üst sınır); ham `fullName` monogram konteynerine ASLA yazılmaz.
  - `isVerified` **köşe rozeti hero'da KALDIRILIR** (§2'nin ızgara kartındaki küçük köşe
    `BadgeCheck`'i yalnızca yer darlığı için bir çözümdü) — hero'da aynı bilgi artık isim
    yanındaki metin taşıyan chip'te var (aşağıda); aynı bilgiyi iki kez farklı biçimde
    göstermek (ikon-only köşe + metinli chip) gürültü yaratır.
- **İsim:** `text-2xl sm:text-3xl font-semibold text-foreground break-words` (§8 H1 ölçeği,
  Plus Jakarta Sans) — `truncate` KULLANILMAZ (ızgara kartının aksine hero'da tam genişlik var,
  doktorun adının kesilmesi kabul edilemez); uzun adlar `break-words` ile ikinci satıra sarkar.
- **Doğrulama chip'i** (`isVerified === true` iken, isimle aynı satırda/yanında, `flex-wrap`
  sayesinde dar ekranda alta düşer): `Badge tone="primary" solid size="lg"` + `BadgeCheck`
  ikonu + **"Doğrulanmış Hekim"** metni — `solid` (`bg-primary text-primary-foreground`)
  kasıtlı olarak aşağıdaki uzmanlık/dil chip'lerinin `soft` (`bg-{tone}/10`) halinden güçlü,
  çünkü bu bir güven sinyali, sıradan bir meta veri değil. `isVerified === false` iken
  **hiçbir şey render edilmez** (§2 ile AYNI ilke — sahte negatif sinyal yok).
- **Uzmanlık chip'i** (isim/doğrulama satırının ALTINDA, `mt-3`, kendi satırında):
  `Badge tone="primary" size="lg"` (soft, `bg-primary/10 text-primary`) + `Stethoscope`
  (lucide) ikonu + `doctor.specialty?.name ?? "Genel Danışmanlık"`. Chip içi ikon+metin
  `gap-1.5`. Bu, §2'nin düz `text-sm text-foreground/60` uzmanlık metninin hero'daki
  YÜKSELTİLMİŞ halidir.
- **Dil chip'leri** (uzmanlık chip'inin altında, `mt-2`, `flex flex-wrap gap-1.5`): §2 ile
  AYNI `Badge tone="neutral" size="sm"` + ISO kodu büyük harf — hero'da BÜYÜTÜLMEZ (bilinçli:
  bunlar ikincil bilgi, doğrulama/uzmanlık chip'leriyle aynı görsel ağırlığı taşırsa hiyerarşi
  düzleşir). `aria-label="Konuşulan diller: ..."` §2 ile AYNI.

### 2.1.3 "Hakkında" (bio) tipografisi

```
<section className="mt-10 max-w-prose space-y-3">
  <h2 className="text-xl font-semibold text-foreground">Hakkında</h2>
  <p className="whitespace-pre-line text-base leading-7 text-foreground/80">{doctor.bio}</p>
</section>
```

- **`max-w-prose`** (Tailwind `65ch`) — görev tanımının istediği "ölçü" (measure) kısıtı;
  `672px`'lik ana sütunun (§2.1.1) İÇİNDE oturur, ikinci bir sabit piksel genişliği İCAT
  EDİLMEZ.
- **`text-base leading-7`** (16px / 28px satır yüksekliği, ~1.75 oranı) — mevcut
  `text-sm leading-relaxed` (14px/1.625) sıkışık görünümün doğrudan nedeniydi; §8'in "Gövde
  metni: text-sm/text-base" aralığının ÜST UCUNU kullanmak hero bağlamında (kısa liste öğesi
  değil, sayfanın ana okunacak metni) doğru seçim.
- **`text-foreground/80`** (§2'nin `/70`'inden bir kademe koyu) — daha uzun bir okuma
  bloğunda `/70` (`mutedTextColor` rolü, AA sınırında ~4.55:1) ile YAKIN render edilebiliyordu;
  `/80` daha güvenli bir marj bırakır — uzun okuma metni ikincil/muted değildir.
- Başlık-gövde arası `space-y-3` (12px), bölüm başlangıcı `mt-10` (40px) — sayfanın ZATEN
  kullandığı değer, DEĞİŞMEDİ.

### 2.1.4 Fiyat + CTA paneli (sticky, kart İÇİNE GÖMÜLÜ DEĞİL)

```
<aside className="lg:sticky lg:top-24 lg:self-start">
  <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5 shadow-sm">
    <div className="flex items-baseline gap-1.5">
      <span className="text-2xl font-semibold text-foreground">{fiyat}</span>
      <span className="text-sm text-foreground/60">/ seans</span>
    </div>
    <p className="mt-1 text-sm text-foreground/60">{sessionDurationMin} dakika görüşme</p>
    <Button size="lg" className="mt-4 w-full rounded-[var(--site-radius)]" asChild>
      <a href="#randevu">Randevu Al</a>
    </Button>
  </div>
</aside>
```

- Bu, görev tanımının "fiyat+CTA kart içine gömülü olmamalı" isteğinin BİREBİR karşılığı:
  fiyat+CTA artık hero'nun/bio'nun İÇİNE gömülü DEĞİL, kendi `bg-surface border border-border`
  yüzeyinde, sayfa kaydırıldıkça ("Hakkında"/"Müsaitlik" bölümleri boyunca) sabit kalan
  bağımsız bir panel.
- `formatPriceFromCents` §2 ile AYNI biçimlendirici — yeni bir fiyat formatı İCAT EDİLMEZ.
- CTA her zaman `href="#randevu"` (sayfanın kendi slot takvimine kaydırır, §2'nin `ctaHref`
  mekanizmasıyla AYNI davranış) — `Button variant="default" size="lg"` (`buttonStyle: SOLID`,
  §8).
- Panel genişliği sidebar sütununun tamamı (`320px`, §2.1.1) — panel içinde ayrı bir `max-w`
  GEREKMEZ. Panele güven ifadesi (ör. "KVKK uyumlu görüşme") eklenecekse metni
  compliance-agent onaylamalıdır (§9'daki acil durum metniyle AYNI ilke) — bu doküman yerleşim
  önerir, metin İCAT ETMEZ.

### 2.1.5 Mobil davranış — sticky panel yerine alt çubuk

`<lg` ekranlarda §2.1.4'teki panel `sticky` DEĞİLDİR, normal akışta hero başlığının hemen
altında TEK KEZ render edilir (kullanıcı sayfayı ilk açtığında fiyatı/CTA'yı zaten görür).
Kullanıcı aşağı kaydırıp bu panel viewport'tan çıktığında, `sticky-add-to-cart-bar.tsx`
(`ecommerce-storefront`, PDP) ile **BİREBİR AYNI** desen devreye girer — YENİ bir mobil
sticky-bar deseni İCAT EDİLMEZ:

```
<div
  aria-hidden={!visible}
  className={cn(
    "fixed inset-x-0 bottom-0 z-40 h-16 border-t border-border bg-surface/95",
    "shadow-[0_-2px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-transform duration-300 lg:hidden",
    visible ? "translate-y-0" : "pointer-events-none translate-y-full"
  )}
>
  <div className="flex h-full items-center gap-3 px-4">
    <div className="min-w-0 text-base font-semibold text-foreground">{fiyat}</div>
    <div className="flex-1" />
    <Button size="lg" className="rounded-[var(--site-radius)]" asChild>
      <a href="#randevu">Randevu Al</a>
    </Button>
  </div>
</div>
```

`visible` durumu `IntersectionObserver` ile §2.1.4'teki inline panelin `ref`'ini izler
(`sticky-add-to-cart-bar.tsx`'in `targetRef` deseniyle AYNI) — bu implementasyon detayı
frontend-agent'a aittir. `z-40` ve çerez bandı önceliği (`z-50`) `sticky-add-to-cart-bar.tsx`
yorumundaki AYNI öncelik sırasını KORUR.

---

## 2.2 Randevu tarih-saat seçim akışı (v1, 2026-09-11, ui-designer) — **SUPERSEDE EDİLDİ**

> **Durum (2026-09-11, ui-designer, v2):** Bu bölümün **tarih seçim kısmı** (§2.2.1'in "tarih
> chip'i" yarısı, §2.2.3'ün gün başlığı, §2.2.6'nın dikey sıralaması) **§2.3 tarafından
> SUPERSEDE EDİLMİŞTİR** — dikey chip listesi UX açısından verimsiz bulunduğu için yerini tam
> bir AYLIK TAKVİM IZGARASINA (month grid) bırakır. **Bu bölüm SİLİNMEZ** (tarihsel karar kaydı
> olarak kalır, "seçim pili" taban dilinin NEREDEN geldiğini açıklar), ama **frontend-agent artık
> BUNU DEĞİL, §2.3'ü uygular.** Şu alt bölümler KISMEN hâlâ geçerlidir (§2.3 bunları miras alır,
> tekrar İCAT ETMEZ): §2.2.1'in SAAT SLOTU yarısı (tarih chip'i yarısı DEĞİL), §2.2.2'nin saat
> gruplama MANTIĞI (üç grup ikiye düşürülür, §2.3.3), §2.2.4 (dolu/geçmiş/müsait), §2.2.5 (seçim
> onay şeridi), §2.2.6'nın saat dilimi rozeti stili. Ayrıntılı harita §2.3'ün girişinde.

Bağlam: `availability-calendar.tsx` (frontend-agent, mevcut implementasyon) tarih seçimini
`role="tab"` pilleriyle **yumuşak/tint** bir seçili durumla (`border-primary bg-primary/10
text-primary`) gösteriyor, saat seçimini ise `role="radio"` düğmeleriyle **dolgu+ring+ikon**
seçili durumla (§3'ün ORİJİNAL hali) gösteriyordu — iki farklı "seçim vurgusu" dili aynı akışta
yan yana duruyordu. Bu bölüm ikisini **TEK bir pil (chip/button) diline** birleştirir ve §3'ü
bu doğrultuda GÜNCELLER (aşağıdaki §3 artık bu bölümle tutarlı okunmalı — "seçili" satırı bu
bölümdeki nihai sınıflarla DEĞİŞTİRİLMİŞTİR). Kod YAZILMAMIŞTIR, yalnızca sınıf/spesifikasyon.

### 2.2.1 Ortak "seçim pili" taban dili — tarih chip'i ve saat slotu AYNI kurallara uyar

**Karar:** iki bileşen tipi de aynı taban + aynı üç durum sınıfını kullanır, SADECE genişlik/
padding'te (içerik uzunluğu farklı olduğu için) ayrışır — `--site-radius` (bu şablonda 16px),
kenarlık/hover/seçili renk tokenleri BİREBİR aynıdır.

**Paylaşılan taban (her ikisi de):**
```
inline-flex h-10 items-center justify-center gap-1.5 rounded-[var(--site-radius)] border
text-sm font-medium tabular-nums transition-colors duration-150
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
focus-visible:ring-offset-2 focus-visible:ring-offset-surface
```
(`focus-visible:ring` — mevcut kodda hiçbir slot/gün düğmesinde açık bir klavye odak stili
YOKTU, bu eklenen bir düzelti; tarayıcı varsayılan `outline`'ına bırakılmaz.)

**Boyut farkı (İZİN VERİLEN TEK ayrım):**
- Tarih chip'i: `px-4` (içerik "11 Eylül Cuma" gibi değişken/uzun metin), sabit genişlik YOK.
- Saat slotu: `px-3 min-w-[84px]` (içerik sabit `HH:mm`, §3'teki mevcut `min-w-[84px]`
  DEĞİŞMEDİ).

**Durum sınıfları (renk tokenleri — İKİSİ İÇİN DE aynı):**

| Durum | Sınıf | Not |
|---|---|---|
| Müsait/pasif (seçilebilir, seçili değil) | `border-border bg-surface text-foreground hover:border-primary/50 hover:bg-primary/5` | Tarih chip'inin eski `text-foreground/70` tonu KALDIRILDI — saat slotuyla aynı `text-foreground` (tam kontrast) kullanılır; ikisi de birincil, tıklanabilir içerik, biri diğerinden "daha az önemli" değildir |
| **Seçili** | `border-2 border-transparent bg-primary text-primary-foreground ring-2 ring-offset-2 ring-offset-surface ring-primary` + baştan `Check` (lucide, `h-3.5 w-3.5`) ikonu, etiketten `gap-1.5` | Tarih chip'inin eski soft/tint seçili durumu (`bg-primary/10 text-primary`, ikon YOK) KALDIRILDI — §3'ün saat slotu için zaten doğrulanmış, renk-körü güvenli (WCAG 1.4.1, dolgu+ikon+ring üçlü sinyal) dili artık HER İKİSİNE de uygulanır. Gerekçe: mevcut iki dili birbirine YAKINLAŞTIRMAK yerine, ikisini de zaten var olan DAHA GÜÇLÜ/erişilebilir sinyale YÜKSELTMEK — bir geriye düşüş değil |

Dolu/geçmiş durumları (yalnızca saat slotunda anlamlı — bir "gün" asla dolu/geçmiş olarak
render edilmez, gün her zaman seçilebilir) **§3'teki hali BİREBİR KORUNUR** (aşağıda §2.2.4'te
tekrar özetlenir, DEĞİŞİKLİK YOK) — bu bölüm SADECE müsait/seçili ikilisini birleştiriyor.

**`role`/ARIA değişmez:** tarih chip'i `role="tab" aria-selected`, saat slotu `role="radio"
aria-checked` — bu semantik fark (gün seçimi ↔ tek seçimli grup) KALIR, yalnızca GÖRSEL sınıflar
birleşiyor; ekran okuyucu davranışı frontend-agent'ın implementasyon detayıdır.

### 2.2.2 Saat gruplama — Sabah / Öğleden Sonra / Akşam

Seçili günün saat slotları, ızgaraya dökülmeden önce üç sabit gruba ayrılır (ziyaretçinin
`displayTimeZone`'undaki saat değerine göre, `formatTime`'ın ürettiği `HH:mm` dizesinden
saat kısmı `parseInt` ile okunur — hesaplama frontend-agent'ın implementasyon detayıdır):

| Grup | Aralık (dahil) | Etiket |
|---|---|---|
| Sabah | `00:00`–`11:59` | **"Sabah"** |
| Öğleden Sonra | `12:00`–`17:59` | **"Öğleden Sonra"** |
| Akşam | `18:00`–`23:59` | **"Akşam"** |

- **Boş grup RENDER EDİLMEZ** — o gün için "Sabah" saati yoksa "Sabah" başlığı da, boş bir
  ızgara da GÖRÜNMEZ (sahte bir boşluk/başlık üretmenin gereği yok).
- **Grup başlığı tipografisi:** `text-xs font-semibold uppercase tracking-wider
  text-foreground/50 mb-2 mt-5 first:mt-0` — §8'in "İkincil/muted metin" rolüyle (`text-xs`,
  `text-foreground/60`) aynı aileden, ama `uppercase tracking-wider` ile bir bölüm ETİKETİ
  (kart/tablo başlığı değil) olarak ayrışır; bu projede İLK KEZ kullanılan bir "uppercase
  eyebrow" deseni — gerekçesi: üç grup arka arkaya `text-sm font-semibold` (bölüm başlığı
  ölçeği) kullansaydı saat ızgarasıyla aynı görsel ağırlığı taşır, taranabilirlik yerine
  gürültü eklerdi; küçük/açık/geniş-aralıklı bir etiket göz için "bölüm ayracı" işlevi görür.
- **Grup içi ızgara:** `grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2` — sabit
  breakpoint sütun sayısı (`sm:grid-cols-4` gibi) İCAT EDİLMEZ; `auto-fill` + `minmax(84px,1fr)`
  konteyner genişliği ne olursa olsun (mobil tam genişlik, `lg:` sonrası §2.1.1'in 672px'lik ana
  sütunu) slot pilinin (§2.2.1, `min-w-[84px]`) altına düşmeden otomatik sütunlanır — mevcut
  `flex flex-wrap gap-2`'nin YERİNİ alır (flex-wrap solda boşluk bırakan düzensiz satırlar
  üretiyordu, grid hepsini hizalar).
- **Gruplar arası boşluk** üstteki `mt-5` (20px, grup başlığının kendi üst boşluğu) ile
  sağlanır, ayrı bir `space-y-*` sarmalayıcı GEREKMEZ.

### 2.2.3 Seçili güne göre saat grid başlığı

Grup başlıklarının (§2.2.2) ÜSTÜNDE, tarih chip satırının altında, TEK SATIR bir bağlam
başlığı — "hangi güne bakıyorum" sorusunu saatleri okumadan ÖNCE yanıtlar:

```
<p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
  <CalendarDays className="h-4 w-4 text-foreground/40" aria-hidden="true" />
  {formatDayLabel(activeDay.items[0].startsAt, displayTimeZone)} için uygun saatler
</p>
```

- Format BİREBİR mevcut `formatDayLabel` çıktısını kullanır (`"11 Eylül Cuma"` gibi,
  `weekday: long, day: numeric, month: long`, `tr-TR`) + sabit `" için uygun saatler"` eki —
  §3'ün `aria-label`'ında zaten kullanılan AYNI etiketin (`"{gün adı} müsaitlik saatleri"`)
  görsel/okunabilir karşılığı, ikinci bir tarih biçimlendirici İCAT EDİLMEZ.
- `CalendarDays` ikonu (lucide) — §4'ün saat dilimi rozetindeki "ikon + metin" desenini
  (`Globe` + metin) tekrarlar, aynı satır yüksekliği/boşluk ritmini (`gap-1.5`/`gap-2`
  aralığında) korur; `Clock`/`Globe` ile KARIŞTIRILMAZ (o ikonlar sırasıyla geri sayım/saat
  dilimi rolüne ayrılmış, §4/§7).
- `text-sm font-semibold text-foreground` — §2.2.2'nin grup etiketlerinden (küçük/uppercase/
  muted) kasıtlı olarak DAHA GÜÇLÜ, çünkü bu, üç grubun ORTAK üst başlığıdır (hiyerarşi:
  gün başlığı > grup etiketi > slot metni).
- Konum: mevcut saat dilimi rozetinin (§4/§2.2.6) ALTINDA, tarih chip satırının ALTINDA, ilk
  grup başlığının ÜSTÜNDE.

### 2.2.4 Dolu / geçmiş / müsait — DEĞİŞMEDİ (§3'ten taşınan özet)

Bu üç durum §3'te zaten nihai — burada sadece grid/gruplama bağlamında hatırlatılır, sınıflar
BİREBİR AYNI kalır:

- **Müsait:** §2.2.1'deki paylaşılan "müsait/pasif" sınıfı (artık tarih chip'iyle birleşik).
- **Dolu:** `border-border/60 bg-muted text-foreground/40 cursor-not-allowed pointer-events-none
  line-through decoration-foreground/30` + alt satırda `text-[10px] text-foreground/50` "Dolu"
  etiketi — DEĞİŞMEDİ.
- **Geçmiş:** `border-transparent bg-transparent text-foreground/25 cursor-not-allowed
  pointer-events-none` (çizgi/etiket YOK) — DEĞİŞMEDİ.

Grid'e (§2.2.2) yerleşimleri de DEĞİŞMEZ: dolu/geçmiş slotlar kendi grubunun içinde, müsait
slotlarla aynı ızgarada, konumlarını (kronolojik sıra) KORUYARAK render edilir — "önce müsaitler,
sonra dolular" gibi bir yeniden sıralama YOK (kullanıcı saat sırasını kaybetmemeli).

### 2.2.5 Seçim onay şeridi (slot seçildiğinde, form/CTA'nın ÜSTÜNDE)

Şu an seçili saat bilgisi SADECE booking formunun içinde gömülü düz bir `<p>` olarak görünüyor
(`availability-calendar.tsx` satır 315-317: `"Seçilen saat: {gün} · {saat}"`, `text-sm
font-medium text-foreground`, formun İÇİNDE). Bu METNİ formun İÇİNDEN ÇIKARIP, saat ızgarası
(§2.2.2-2.2.4) ile booking formu arasına, kendi vurgulu şeridi olarak taşı:

```
<div className="flex items-center justify-between gap-3 rounded-[var(--site-radius)] border border-primary/30 bg-primary/5 px-4 py-3">
  <div className="flex items-center gap-2 text-sm">
    <CalendarCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
    <span className="font-medium text-foreground">
      {formatDayLabel(selectedSlot.startsAt, displayTimeZone)} · {formatTime(selectedSlot.startsAt, displayTimeZone)}
    </span>
  </div>
  <button type="button" onClick={() => setSelectedSlot(null)} className="shrink-0 text-xs font-medium text-primary hover:underline">
    Değiştir
  </button>
</div>
```

- **Konum:** saat grid'inin (§2.2.2) HEMEN ALTI, booking formunun (mevcut `<form
  className="mt-4 ...">`) HEMEN ÜSTÜ — yalnızca `selectedSlot !== null` iken render edilir
  (mevcut `{selectedSlot && (...)}` koşuluyla AYNI kapı, sadece bu şerit formdan AYRI bir
  kardeş eleman olur). "CTA'ya yakın" isteği bu konumla karşılanır: hasta formu doldurmadan
  önce SEÇTİĞİ şeyi bir kez daha net görür, "Randevuyu Onayla" butonuna basmadan önceki SON
  görsel doğrulama noktası.
- **Renk tokenleri:** `border-primary/30 bg-primary/5` — §6.1'deki "Bekleme Odası" panelinin
  `border-primary/20 bg-primary/5` tonuyla AYNI aileden (bir kademe daha görünür kenarlık,
  `/30` vs `/20`, çünkü bu aktif bir onay değil bekleyiş DEĞİL); YENİ bir teal tonu İCAT
  EDİLMEZ.
- **İçerik formatı:** `{gün etiketi} · {HH:mm}` — orta nokta ayracı §2'nin "30 dk · ₺450"
  deseniyle AYNI konvansiyon, ikinci bir ayraç biçimi İCAT EDİLMEZ.
- **"Değiştir" bağlantısı:** `text-primary hover:underline`, mevcut `setSelectedSlot(null)`
  state'ini çağırır (zaten var olan fonksiyon, yeni bir state GEREKMEZ) — kullanıcı formu
  doldurmaya başlamadan saatini değiştirebilir; form ALANLARINI SIFIRLAMAZ (yalnızca slot
  seçimini temizler, `patientName`/`patientEmail` girilmişse KORUNUR — kullanıcı deneyimi
  gereği, veri kaybı YARATILMAZ).
- **İkon:** `CalendarCheck` (lucide) — "onaylı tarih" çağrışımı, §2.2.3'ün `CalendarDays`
  (henüz seçilmemiş/genel) ikonundan KASITLI olarak farklı bir varyant (dolu/işaretli), aynı
  ailenin "durum değişti" sinyali.
- Form içindeki eski satır (`"Seçilen saat: ..."`, satır 315-317) bu şeritle DUPLICATE olacağı
  için KALDIRILIR — aynı bilgi iki kez farklı stillerde gösterilmez (§9'daki "bilinçli tekrar"
  ilkesinin TERSİ burada geçerli: o farklı SAYFA konumlarında bilinçli tekrardı, bu ise aynı
  akışta bitişik gereksiz bir tekrar olurdu).

### 2.2.6 Saat dilimi rozeti — stil KORUNUR, yalnızca hizalama

§4'teki iki-aşamalı saat dilimi rozetinin (`Globe` ikonu, `border-border bg-muted/50` şeridi)
**sınıfları/metni/aşama mantığı DEĞİŞMEZ** — bu bölüm SADECE onun yeni ızgarayla dikey
sıralamasını netleştirir:

```
[saat dilimi rozeti — §4, DEĞİŞMEDİ]
[tarih chip satırı — §2.2.1]
[gün başlığı "{gün} için uygun saatler" — §2.2.3]
[Sabah — grup başlığı + grid — §2.2.2]
[Öğleden Sonra — grup başlığı + grid]
[Akşam — grup başlığı + grid]
[seçim onay şeridi — §2.2.5, YALNIZCA selectedSlot varken]
[booking formu / "Randevuyu Onayla" — DEĞİŞMEDİ]
```

Rozet ile tarih chip satırı arasındaki boşluk mevcut `mb-1`'den `mb-4`'e ÇIKARILIR (16px) —
şu an rozetin ALTINDAKİ eleman (tarih chip'leri) neredeyse yapışık duruyordu (`mb-1` = 4px),
yeni gün başlığı+grup başlıklarıyla kalabalıklaşan ızgarada bu şerit kendi "bilgi bandı"
kimliğini görsel bir boşlukla ayırmalı. Rozetin kendi İÇ `px-3 py-2` dolgusu, `text-xs` boyutu,
`Globe` ikonu, iki-aşamalı (SSR/mount) davranışı BİREBİR KORUNUR.

### 2.2.7 Breakpoint özeti

Bu akışta YENİ bir breakpoint İCAT EDİLMEZ, mevcut Tailwind varsayılanları (`sm`/`md`/`lg`)
kullanılır:

- Tarih chip satırı: `flex flex-wrap gap-2` — DEĞİŞMEDİ, tüm genişliklerde satır kaydırır.
- Saat grid'i (§2.2.2): `grid-cols-[repeat(auto-fill,minmax(84px,1fr))]` — breakpoint'e BAĞIMLI
  DEĞİL, kendiliğinden yanıt verir (mobilde ~3-4 sütun, `lg:`'nin 672px ana sütununda ~6-7
  sütun — kesin sayı konteyner genişliğine göre otomatik).
  Grid ile ilgili tek gerçek "breakpoint" olayı §2.1.1'in `lg:grid-cols-[1fr_320px]` geçişidir
  (ana sütun `lg:` altında 672px'e sabitlenir) — bu, §2.1'in KENDİ kararıdır, burada TEKRAR
  İCAT EDİLMEZ.
- Seçim onay şeridi (§2.2.5): tek satır `flex items-center justify-between` her genişlikte
  aynı kalır — içerik ("11 Eylül Cuma · 14:00" + "Değiştir") en dar mobil ekranda (`320px`)
  dahi taşmayacak kadar kısa, ayrı bir mobil varyant GEREKMEZ.

---

## 2.3 Randevu takvim ızgarası (month grid) — §2.2'yi supersede eder (v2, 2026-09-11, ui-designer)

**Kod YAZILMAMIŞTIR** — bu bölüm de yalnızca sınıf/spesifikasyon kararıdır, frontend-agent
uygular. Bu bölüm §2.2'nin tarih chip'i (dikey/yatay liste) kısmını **TAMAMEN KALDIRIR** ve
yerine tam genişlikte bir AYLIK TAKVİM IZGARASI (month grid) koyar; §2.2'nin saat slotu/gruplama/
onay şeridi kararları (aşağıda §2.3.3-§2.3.6'da miras alınıp gerekli yerlerde güncellenir) KALIR.

**Kim ne miras alıyor — hızlı harita:**

| §2.2 alt bölümü | §2.3'teki durumu |
|---|---|
| §2.2.1 tarih chip'i yarısı | **KALDIRILDI** → §2.3.2 (takvim hücresi) onun yerini alır |
| §2.2.1 saat slotu yarısı | **DEĞİŞMEDİ**, §2.3.4'te tekrar teyit edilir |
| §2.2.2 (Sabah/Öğleden Sonra/Akşam, 3 grup) | **DEĞİŞTİ** → §2.3.3 (2 grup: ÖÖ Sabah / ÖS Öğleden Sonra) |
| §2.2.3 (gün başlığı) | **KALDIRILDI** — takvimde seçili gün zaten görsel olarak vurgulu (§2.3.2 "Seçili"), saat grid'inin üstünde ayrı bir "{gün} için uygun saatler" metnine gerek KALMADI; aynı bilgi §2.4'ün "Seçilen Randevu" satırında zaten var |
| §2.2.4 (dolu/geçmiş/müsait saat) | **DEĞİŞMEDİ**, §2.3.4'te tekrar teyit edilir |
| §2.2.5 (seçim onay şeridi) | **DEĞİŞMEDİ**, konumu §2.3.6'da teyit edilir |
| §2.2.6 (saat dilimi rozeti + dikey sıralama) | Rozetin STİLİ DEĞİŞMEDİ, dikey sıralama §2.3.7'de GÜNCELLENDİ (takvim rozetin altına girer) |

### 2.3.1 Ay navigasyonu

Takvim kartının EN ÜSTÜ, tam genişlik, üç bölümlü satır:

```
<div className="mb-4 flex items-center justify-between">
  <button
    type="button"
    aria-label="Önceki ay"
    disabled={isPrevMonthDisabled}
    className="flex h-9 w-9 items-center justify-center rounded-[var(--site-radius)] border border-border text-foreground/70 transition-colors duration-150 hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent"
  >
    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
  </button>
  <p className="text-sm font-semibold uppercase tracking-wider text-foreground">
    {ayAdıBüyükHarf} {yıl}
  </p>
  <button
    type="button"
    aria-label="Sonraki ay"
    className="flex h-9 w-9 items-center justify-center rounded-[var(--site-radius)] border border-border text-foreground/70 transition-colors duration-150 hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
  >
    <ChevronRight className="h-4 w-4" aria-hidden="true" />
  </button>
</div>
```

- **Ay+yıl etiketi:** `new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" })`
  çıktısı BÜYÜK HARFE çevrilir (`.toLocaleUpperCase("tr-TR")` — Türkçe `İ/i` noktalama kuralı
  için `.toUpperCase()` DEĞİL `toLocaleUpperCase("tr-TR")` kullanılır, "EYLÜL 2026" gibi) —
  ikinci bir ay-adı sözlüğü İCAT EDİLMEZ, `Intl` zaten Türkçe ay adlarını doğru üretir.
- **Geri buton devre dışı koşulu:** görüntülenen ayın ilk günü, bugünün ait olduğu ayın ilk
  gününden ÖNCEYSE (`viewMonthStart < startOfCurrentMonth`) `disabled` — "bugünden önceki aya
  gidilemez" kısıtı BİREBİR budur; bugünün AYI her zaman gezilebilir (geçmiş günleri §2.3.2'de
  zaten tek tek pasif render edilir, ay bazında ayrıca kilitlemek gereksiz çift kısıt olurdu).
- **İleri buton HİÇBİR ZAMAN disabled DEĞİL** — backend `GET /doctors/{slug}/slots` hangi ay
  için veri döndürürse döndürsün (mimari §4.2), kullanıcı istediği kadar ileri gidebilir; o ay
  için slot yoksa §2.3.2'nin "hiç müsait gün yok" durumu (tüm günler pasif) zaten bunu iletir —
  ayrıca bir "bu ayın sonrası kilitli" mesajı İCAT EDİLMEZ.
- Buton boyutu `h-9 w-9` (36px) — dokunma hedefi §2.3.2'nin hücre boyutundan (min 40px) BİLE
  isteye küçük TUTULMAZ, `h-9` zaten ≥36px WCAG 2.5.5 AAA eşiğinin biraz altında ama AA'nın
  aradığı 24px eşiğinin ÜZERİNDE; nav okları birincil etkileşim yüzeyi DEĞİL (hücreler kadar sık
  dokunulmaz), bu yüzden §2.3.2'nin 40px kuralı ona UYGULANMAZ.

### 2.3.2 Gün ızgarası — 7 sütun, hücre durumları

**Gün başlıkları** (nav'ın altında, `mb-1`):
```
<div className="mb-1 grid grid-cols-7 gap-1">
  {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((d) => (
    <span key={d} className="flex h-6 items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-foreground/40">
      {d}
    </span>
  ))}
</div>
```
Pazartesi BAŞLANGIÇ (Türkiye standardı, ISO 8601) — `Date.getDay()`'in Pazar=0 döndüren
JS varsayılanı frontend-agent'ın hücre-indeksleme hesabında `(getDay() + 6) % 7` gibi bir
dönüşümle Pazartesi=0'a çevrilir; bu bir implementasyon detayıdır, burada yalnızca GÖRSEL
sıra (`Pzt` ilk sütun) bağlayıcıdır.

**Hücre ızgarası:** `grid grid-cols-7 gap-1` — 7 sütun, satır sayısı ay uzunluğuna göre değişir
(4-6 satır). Her hücre taban boyutu (TÜM durumlar için ORTAK, dokunma hedefi garantisi):
`flex h-10 sm:h-11 w-full flex-col items-center justify-center gap-0.5` — `w-full` sütunu
doldurur (7 eşit sütun kendiliğinden kare-YAKIN bir en-boy oranı üretir, `aspect-square`
UTILITY'sine İHTİYAÇ YOK çünkü `gap-1` ile `grid-cols-7` zaten dar konteynerde ~40-48px arası
kare-yakın hücreler üretir — sabit `aspect-square` mobilde 320px genişlikte 7×`gap-1` düşüldükten
sonra ~40px'in ALTINA inebilirdi, `h-10 sm:h-11` ile YÜKSEKLİK sabitlemek `min 40px` dokunma
hedefini GENİŞLİKTEN bağımsız garanti eder — bu daha güvenli bir taktik).

**Ay dışı taşan günler (önceki ayın son günleri, ilk haftanın hafta-içi hizalaması için):**
tamamen BOŞ/görünmez yer tutucu, gün numarası YOK:
```
<span aria-hidden="true" className="h-10 sm:h-11 w-full" />
```
Sonraki ayın taşan günleri (son satırı 7'ye tamamlamak için) RENDER EDİLMEZ — satır kısa
kalabilir, sahte bir "sonraki ay" günü İCAT EDİLMEZ (kullanıcı `>` ile zaten bir sonraki aya
geçebilir, taşan günler tıklanamaz olacağından fazladan bir görsel gürültüdür).

**Durum sınıfları (4 durum):**

| Durum | Öğe | Sınıf |
|---|---|---|
| **Müsait** (o gün ≥1 uygun slot var) | `<button>` | `flex h-10 sm:h-11 w-full flex-col items-center justify-center gap-0.5 rounded-[var(--site-radius)] border border-primary/20 bg-primary/5 text-sm font-medium tabular-nums text-foreground transition-colors duration-150 hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface` |
| **Müsait + en yakın gün** (kronolojik olarak İLK uygun gün, "Erken Randevu" vurgusu) | `<button>` | Müsait ile AYNI taban, İÇ etiket farklı (aşağıda) |
| **Müsait değil / geçmiş** (o gün için 0 slot VEYA gün geçmişte) | `<span>` (tıklanamaz) | `flex h-10 sm:h-11 w-full items-center justify-center rounded-[var(--site-radius)] border border-transparent text-sm font-medium tabular-nums text-foreground/25 cursor-not-allowed` |
| **Seçili** | `<button aria-pressed="true">` | `relative flex h-10 sm:h-11 w-full flex-col items-center justify-center gap-0.5 rounded-[var(--site-radius)] border-2 border-transparent bg-primary text-sm font-semibold tabular-nums text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface` |

**Hücre İÇ yapısı (gün numarası + alt işaretleyici, boyut BOZULMAZ):**

```
{/* Müsait, en yakın gün DEĞİL */}
<button aria-label="16 Eylül Çarşamba — müsait" className={AVAILABLE}>
  <span>16</span>
  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-primary" />
</button>

{/* Müsait, EN YAKIN gün — "Erken Randevu" vurgusu */}
<button aria-label="16 Eylül Çarşamba — müsait, en yakın randevu tarihi" className={AVAILABLE}>
  <span>16</span>
  <span aria-hidden="true" className="text-[8px] font-semibold uppercase leading-none tracking-wide text-primary">
    Erken
  </span>
</button>

{/* Müsait değil / geçmiş */}
<span aria-label="9 Eylül Çarşamba — müsait saat yok" className={DISABLED}>9</span>

{/* Seçili */}
<button aria-pressed="true" aria-label="16 Eylül Çarşamba — seçili" className={SELECTED}>
  <span>16</span>
  <Check className="h-2.5 w-2.5" aria-hidden="true" />
</button>
```

- **"Erken Randevu" etiketi SADECE kronolojik olarak İLK müsait güne** uygulanır (tüm müsait
  günlere değil) — 40-44px'lik bir hücreye tam "Erken Randevu" metni SIĞMAZ, bu yüzden kısaltılmış
  `"Erken"` (8px, tek satır) kullanılır; TAM metin ekran okuyucuya `aria-label` üzerinden
  ("... en yakın randevu tarihi") ulaşır — görsel kısaltma ile erişilebilir tam ifade ARASINDA
  bir ÇATIŞMA yok, sadece SUNUM farkı.
  Diğer TÜM müsait günler (en yakın olan HARİÇ) yalnızca `h-1 w-1 rounded-full bg-primary` bir
  nokta taşır — "bu günde müsaitlik var" sinyali, hücre boyutunu ETKİLEMEZ.
- **Renk kararı — `bg-emerald-50` DEĞİL, `bg-primary/5`/`border-primary/20`:** görev tanımı
  örnek olarak "zümrüt paletiyle uyumlu bir açık yeşil ton" öneriyordu; bu doküman §0/§1'in
  KESİN kuralına (`SiteAppearance` token'larının HİÇBİRİ ham/yeni bir renk taşımaz, TEK
  doğrulanmış `primaryColor` — `#0F766E`, teal — kullanılır) SADIK KALARAK ham `emerald-50`
  yerine `primary` token'ının `%5/%20` tint'ini kullanır. Sonuç görsel olarak "açık yeşilimsi"
  bir zemindir (teal zaten yeşile yakın bir tondur) AMA token kaynağı YENİ bir renk İCAT ETMEZ —
  §1.2'nin "iki farklı yeşil/mavi icat etmek yerine tek doğrulanmış ton" ilkesiyle BİREBİR aynı
  karar. `bg-primary/5` beyaz/`surfaceColor` zemin üzerinde metin taşımadığı için AA hesabına
  GİRMEZ (§1.3'ün metin kontrastı tablosu yalnızca DÜZ METNİ kapsar, dekoratif %5 dolgu bir
  "grafiksel nesne" — WCAG 1.4.11 — bile SAYILMAYACAK kadar soluktur, sıradan bir hover/zemin
  tonudur).
- **Seçili hücrenin ek sinyali:** dolgu rengi DEĞİŞİMİNE ek olarak `Check` ikonu (renk-körü
  güvenliği, §2.2.1/§3'ün "seçili" sinyaliyle AYNI ilke — dolgu+ikon+şekil değişimi ÜÇLÜ sinyal)
  VE `shadow-sm` (görev tanımının istediği "diğer hücrelerden öne çıkma" — dolgu+ikonun ÜSTÜNE
  üçüncü bir görsel ayrım katmanı).
- **`aria-label` formatı** (`"{gün} {ay adı} {haftanın günü} — {durum}"`) — bu bölümün
  önerdiği metin, kesin ARIA/`role` yapısı (örn. `role="grid"`/`role="gridcell"` mi yoksa düz
  `<button>` grid'i mi) frontend-agent'ın implementasyon detayıdır (§2.2.1'in "semantik fark
  KALIR, görsel sınıf birleşir" ilkesiyle AYNI ayrım).

### 2.3.3 Saat grupları — ÖÖ Sabah / ÖS Öğleden Sonra (2 grup, §2.2.2'yi GÜNCELLER)

Görev tanımı üç grubu (Sabah/Öğleden Sonra/Akşam) **İKİYE** sadeleştirmeyi istiyor. Sınır saati
öğlen 12:00 — sabah grubu `00:00–11:59`, öğleden sonra grubu (eski "Öğleden Sonra" + "Akşam"
BİRLEŞİR) `12:00–23:59`:

| Grup | Aralık (dahil) | Etiket | Rozet şeridi |
|---|---|---|---|
| Sabah | `00:00`–`11:59` | **"ÖÖ SABAH"** | sıcak/sarı gradyan |
| Öğleden Sonra | `12:00`–`23:59` | **"ÖS ÖĞLEDEN SONRA"** | nötr/bej |

`getHourGroupLabel` (`availability-calendar.tsx` satır 72-77) fonksiyonu ikiye İNDİRİLİR —
`hour < 12 ? "Sabah" : "Öğleden Sonra"` — üçüncü dal (`hour < 18`) KALDIRILIR. Boş grup KURALI
DEĞİŞMEDİ (§2.2.2 ile aynı): o gün için "Sabah" saati yoksa "ÖÖ SABAH" şeridi de, boş bir kart
da GÖRÜNMEZ.

**Her grup kendi kartıdır (şerit üstte, saat ızgarası altta, TEK yüzeyde birleşik):**

```
<section className="overflow-hidden rounded-[var(--site-radius)] border border-border">
  {/* başlık şeridi */}
  <div className="flex items-center gap-2 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-2.5">
    <Sun className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
    <span className="text-xs font-semibold uppercase tracking-wider text-amber-900">ÖÖ Sabah</span>
  </div>
  {/* saat ızgarası */}
  <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 p-3">
    {/* §2.3.4 saat butonları */}
  </div>
</section>

<section className="overflow-hidden rounded-[var(--site-radius)] border border-border">
  <div className="flex items-center gap-2 bg-muted px-4 py-2.5">
    <CloudSun className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
    <span className="text-xs font-semibold uppercase tracking-wider text-foreground/70">ÖS Öğleden Sonra</span>
  </div>
  <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 p-3">
    {/* §2.3.4 saat butonları */}
  </div>
</section>
```

- İki kart arası boşluk: `space-y-3` (12px) sarmalayıcı — kartların KENDİ `border`'ı olduğundan
  ayrı bir `divide-y` GEREKMEZ.
- **Başlık şeridi tipografisi (İKİSİ için ORTAK):** `text-xs font-semibold uppercase
  tracking-wider` (§2.2.2'nin grup etiketi ölçeğiyle AYNI aile — `text-xs`, ama burada
  ARTIK muted DEĞİL, kendi şeridinin zemini üzerinde güçlü renk taşıyor, çünkü bu artık
  bağımsız bir kart başlığı, saat ızgarasının İÇİNDEKİ bir alt-etiket değil).
- **ÖÖ Sabah renk kararı — İKİNCİ bilinçli §0 istisnası:** `from-amber-50 to-orange-50` +
  `text-amber-900`/`text-amber-600` proje paletinin (`--primary`/`--secondary`/kök semantik
  renkler) DIŞINDA, ham Tailwind varsayılan tonlarıdır — bu doküman genelde ("SAPMA YOK", §0)
  bunu YASAKLAR, ama burada KASITLI bir istisna yapılır: "sabah" kavramının sezgisel karşılığı
  SICAK/GÜNEŞ ışığı tonudur ve projenin paletinde (teal + okyanus mavisi + nötr gri + kırmızı/
  yeşil/amber SEMANTİK durum renkleri) bu sıcaklığı taşıyan bir token YOKTUR; `primaryColor`'ı
  (teal) hem sabah hem öğleden sonra şeridinde kullanmak "zaman dilimi" ayrımını GÖRSEL OLARAK
  SİLERDİ (görev tanımının doğrudan istediği "iki farklı başlık şeridi" amacına aykırı). Kontrast
  doğrulaması: `amber-900` (`#78350f`) / `amber-50` (`#fffbeb`) ≈ **12.9:1** (AAA), `amber-600`
  (`#d97706`) ikon-only kullanıldığından metin kontrastı KAPSAMINA GİRMEZ. Bu istisna §5'in
  "video üzerine bindirilen kontrol çubuğu" istisnasıyla AYNI mantık: dar/işlevsel bir mikro-alan,
  markanın GENEL kimliğini (buton/link/CTA/başlık renkleri) ETKİLEMEZ, YALNIZCA bu iki şeridin
  İÇİNDE yaşar.
- **ÖS Öğleden Sonra renk kararı — YENİ renk İCAT EDİLMEDİ:** `bg-muted` + `text-foreground/70`
  (kök `--muted`/`--muted-foreground` aile token'ları, zaten globals.css'te tanımlı) — görev
  tanımının "nötr/bej" isteği kök `muted` tonuyla ZATEN karşılanıyor, `bg-stone-50` gibi YENİ bir
  Tailwind rengi İCAT ETMEYE gerek yok. İkon `CloudSun` (lucide) — `Moon` DEĞİL (görev tanımının
  kendi notu: gündüz sonrası olduğu için ay uygun değil), `Sunset` DEĞİL (gün batımı ÇAĞRIŞIMI
  öğleden sonranın TAMAMI için yanıltıcı olurdu, `CloudSun` "hâlâ gündüz ama sabahın tam
  tersi" nötr bir çağrışım taşır).
- **`rounded-t-[var(--site-radius)]` yerine `overflow-hidden` + kartın KENDİ `rounded-[var(--site-radius)]`'ı:** şerit ayrı bir üst-köşe yuvarlama YAZMAZ, dış `<section>` `rounded-[var(--site-radius)]
  overflow-hidden` taşır ve şeridin dikdörtgen köşeleri kartın kendisi tarafından KIRPILIR — iki
  ayrı `rounded-t-*`/`rounded-b-*` değeri senkronize ETMEK yerine tek bir kırpma noktası.

### 2.3.4 Saat butonları — §2.2.1/§2.2.4/§3 İLE DEĞİŞMEDİ

Saat butonlarının sınıfları (müsait/seçili/dolu/geçmiş) bu turda DEĞİŞMEZ — §2.2.1'in paylaşılan
taban dili (`SELECTION_PILL_BASE`/`_AVAILABLE`/`_SELECTED`, `px-3 min-w-[84px]`) ve §2.2.4/§3'ün
dolu/geçmiş sınıfları BİREBİR aynı kalır, yalnızca ARTIK §2.3.3'ün iki kartının İÇİNE (üç grup
DEĞİL, iki grup) yerleşirler. Kronolojik sıra (dolu/geçmiş dahil, "önce müsaitler sonra dolular"
yeniden sıralaması YOK) kuralı da DEĞİŞMEDİ.

### 2.3.5 Saat dilimi bilgi çubuğu — stil KORUNUR, sadece hizalama

§4/§2.2.6'daki iki-aşamalı saat dilimi rozetinin sınıfları/metni/aşama mantığı DEĞİŞMEZ. Tek
fark: artık ALTINDA tarih chip satırı DEĞİL, doğrudan §2.3.1'in ay navigasyonu gelir (§2.3.7'de
dikey sıra netleştirilir).

### 2.3.6 Seçim onay şeridi — §2.2.5 İLE DEĞİŞMEDİ, konum güncellendi

`CalendarCheck` ikonu + `"{gün etiketi} · {HH:mm}"` + "Değiştir" bağlantısı İÇEREN şerit
(§2.2.5'in TÜM sınıfları/davranışı BİREBİR) — konumu artık: İKİ saat grubu kartının (§2.3.3)
HEMEN ALTI, booking formunun HEMEN ÜSTÜ (§2.2.3'ün "gün başlığı" kaldırıldığı için bu şeridin
üstünde artık doğrudan saat kartları var, aradaki mesafe DEĞİŞMEDİ — `selectedSlot !== null`
koşulu AYNI kapı).

### 2.3.7 Dikey sıra (takvim + saat grupları birlikte)

```
[saat dilimi rozeti — §4/§2.3.5, DEĞİŞMEDİ]
[AY TAKVİMİ IZGARASI — §2.3.1 (nav) + §2.3.2 (7 sütun hücre grid'i)]  ← §2.2'nin tarih chip'inin YERİNİ alır
[ÖÖ Sabah kartı — §2.3.3, YALNIZCA o gün sabah slotu varsa]
[ÖS Öğleden Sonra kartı — §2.3.3, YALNIZCA o gün öğleden sonra slotu varsa]
[seçim onay şeridi — §2.3.6/§2.2.5, YALNIZCA selectedSlot varken]
[booking formu / "Randevuyu Onayla" — DEĞİŞMEDİ]
```

Takvim ile ilk saat grubu kartı arasındaki boşluk `mt-5` (20px, §2.2.2'nin grup başlığı üst
boşluğuyla AYNI ritim) — takvimin kendi `p-4 sm:p-5` iç dolgusu ayrı bir kart yüzeyi olduğundan
(§2.3.2), saat kartları (§2.3.3) takvimin DIŞINDA, kendi `border`'larıyla ayrı birer yüzeydir;
aralarında ekstra bir `border`/`bg-surface` sarmalayıcı GEREKMEZ.

### 2.3.8 Breakpoint özeti

Bu akışta YENİ bir breakpoint İCAT EDİLMEZ:

- Takvim hücre ızgarası (§2.3.2): `grid-cols-7` SABİT (ay takvimi mantığı gereği, hiçbir
  genişlikte 7'den az/çok sütun OLAMAZ) — hücre YÜKSEKLİĞİ `h-10 sm:h-11` ile küçük ekranlarda
  bile ≥40px dokunma hedefini korur, GENİŞLİK sütun sayısına bölünerek kendiliğinden ayarlanır.
- Saat grid'i (§2.3.4): §2.2.2 ile AYNI, `grid-cols-[repeat(auto-fill,minmax(84px,1fr))]`,
  breakpoint'e BAĞIMLI DEĞİL.
- Takvim kartı + saat kartları TEK sütunda kalır (bu bölüm kendi içinde `lg:` bir iki-sütun
  düzeni İCAT ETMEZ) — §2.1.1'in `lg:grid-cols-[1fr_320px]` ana/yan sütun geçişi tek gerçek
  breakpoint kırılımı, bu bölüm onun İÇİNDEKİ ana sütunda (672px, `lg:` sonrası) tam genişlik
  akar.

---

## 2.4 Hizmet Özeti paneli — §2.1.4'ü genişletir (v2, 2026-09-11, ui-designer)

Bağlam: §2.1.4'teki `doctor-price-panel.tsx` şimdiye kadar SADECE fiyat+CTA taşıyordu. Bu bölüm
onu, doktor profili + hizmet detayı + seçilen randevu bilgisini de gösteren ZENGİN bir "Hizmet
Özeti" kartına genişletir. **§2.1.4/§2.1.5'in sticky/mobil-çubuk MEKANİZMASI DEĞİŞMEZ** —
`lg:sticky lg:top-24 lg:self-start` sarmalayıcı ve mobildeki `sticky-add-to-cart-bar.tsx` deseni
BİREBİR KORUNUR; bu bölüm SADECE panelin İÇ İÇERİĞİNİ zenginleştirir (§2.4.6'da sticky/mobil
etkisi ayrıca netleştirilir).

### 2.4.1 Panel yapısı

```
<aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
  <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">Hizmet Özeti</p>

    {/* §2.4.2 doktor profili satırı */}
    <div className="mt-4 flex items-center gap-3">
      <DoctorAvatarMedia doctor={doctor} sizeClassName="h-12 w-12 rounded-full shrink-0" textClassName="text-base" sizes="48px" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{title} {fullName}</p>
        <p className="truncate text-xs text-foreground/60">{specialty?.name ?? "Genel Danışmanlık"}</p>
      </div>
    </div>

    <div className="my-4 border-t border-border" />

    {/* §2.4.3 hizmet detayı satırı */}
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-foreground/80">{serviceName}</span>
      <span className="flex items-center gap-1 shrink-0 text-foreground/60">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {sessionDurationMin} Dk.
      </span>
    </div>

    {/* §2.4.4 dinamik seçim satırı */}
    <div className="mt-4 rounded-[var(--site-radius)] border border-border bg-muted/50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/50">Seçilen Randevu</p>
      {selectedSlot ? (
        <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
          <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          {formatDayLabel(selectedSlot.startsAt, displayTimeZone)} · {formatTime(selectedSlot.startsAt, displayTimeZone)}
        </p>
      ) : (
        <p className="mt-1 text-sm text-foreground/40">Tarih ve saat seçin</p>
      )}
    </div>

    {/* §2.4.5 fiyat + CTA */}
    <div className="mt-4 flex items-baseline gap-1.5">
      <span className="text-2xl font-semibold text-foreground">{price}</span>
      <span className="text-sm text-foreground/60">/ seans</span>
    </div>
    <a href={ctaHref} className={cn(buttonVariants({ size: "lg" }), "mt-3 w-full rounded-[var(--site-radius)]")}>
      Randevu Al
    </a>
  </div>
</aside>
```

### 2.4.2 Doktor profili satırı

- **Avatar:** `doctor-avatar.tsx`'in (`DoctorAvatarMedia`) KOMPAKT varyantı — `h-12 w-12
  rounded-full` (§2'nin ızgara kartı avatarıyla AYNI dairesel şekil/boyut AİLESİNDEN, hero'nun
  kare `h-28/36` varyantından FARKLI — bu panel bir "özet kart", hero DEĞİL, §2'nin ızgara
  kartı diliyle hizalanması daha DOĞRU: kullanıcı zaten hero'da BÜYÜK kare avatarı gördü, burada
  onu küçük/dairesel bir "özet rozeti" olarak TEKRAR görmesi TUTARLI bir küçültme, YENİ bir
  üçüncü şekil İCAT ETMEZ). `sizes="48px"`. Gerçek görsel YOKSA/hata varsa mevcut monogram
  fallback (`from-[#0F766E] to-[#0369A1]`, §2/§2.1.2/§10 ile AYNI gradyan) `textClassName="text-base"`.
- **Ad + uzmanlık:** `flex flex-col min-w-0` içinde ad `text-sm font-semibold text-foreground
  truncate` (`{title} {fullName}`, §2'nin ızgara kartı ölçeğiyle AYNI, hero'nun `text-2xl/3xl`
  İLE KARIŞTIRILMAZ — bu küçük bir özet satırı), uzmanlık `text-xs text-foreground/60 truncate`
  hemen altında (§2'nin "Uzmanlık" satırıyla AYNI rol/ton).
- **Ayırıcı:** `border-t border-border my-4` (16px üst+alt boşluk — §2'nin `border-t
  border-border/60 my-3` ayracından BİRAZ daha güçlü/`/60` OPAKLIK EKİ OLMADAN, çünkü bu panelde
  ayıracın ÜSTÜNDE/ALTINDA şimdi İKİ FARKLI bilgi bloğu var — profil ve hizmet detayı — §2'nin
  kartındaki "meta bilgi/fiyat" ayrımından biraz daha BELİRGİN bir bölüm geçişi gerekiyor).

### 2.4.3 Hizmet detayı satırı

**Hizmet adı — specialty'den TÜRETİLİR, sabit metin İCAT EDİLMEZ:**
`{doctor.specialty?.name ?? "Genel Danışmanlık"} Seansı` (§2.1.2'nin uzmanlık chip'indeki
AYNI fallback zincirini — `doctor.specialty?.name ?? "Genel Danışmanlık"` — kullanır, yalnızca
sonuna `" Seansı"` eki eklenir, ör. "Kardiyoloji Seansı", uzmanlık yoksa "Genel Danışmanlık
Seansı"). **Sabit "Profesyonel Danışmanlık Seansı" metni KULLANILMAZ** — proje zaten her
doktora bir `specialty` atıyor (mimari veri modeli), bu bilgiyi YOK SAYIP jenerik bir isim
göstermek daha AZ bilgilendirici olurdu; specialty'den türetmek İKİNCİ bir metin kaynağı/
çeviri anahtarı İCAT ETMEDEN (compliance/documentation-agent'ın onaylaması gereken YENİ bir
sabit dize YARATMADAN) doğru bilgiyi verir.
- **Süre:** `Clock` (lucide) ikonu + `{sessionDurationMin} Dk.` — §7'nin geri sayımından farklı
  bir ikon/rol (`Clock` burada STATİK süre bilgisi, geri sayımda kullanılan sayaç DEĞİL).
- Satır düzeni: `flex items-center justify-between` — hizmet adı SOLDA (`text-foreground/80`,
  §2.1.3'ün bio metniyle AYNI okuma tonu), süre SAĞDA (`text-foreground/60`, ikincil/muted).

### 2.4.4 Dinamik seçim satırı — "Seçilen Randevu"

- **Kapsayıcı:** `rounded-[var(--site-radius)] border border-border bg-muted/50 p-3` — §6.1'in
  "Bekleme Odası" panelinin dolgu mantığıyla AYNI aileden (nötr bir bilgi kutusu), ama `primary`
  tint DEĞİL `muted` (bu bir "bekleyiş" değil, sade bir bilgi ÖZETİ — `primary` tonu bu panelde
  zaten CTA/fiyatta kullanılacağından, burada tekrar kullanmak görsel hiyerarşiyi BULANIKLAŞTIRIR).
- **Üst etiket:** `text-[11px] font-semibold uppercase tracking-wider text-foreground/50`
  "Seçilen Randevu" (§2.4.1'in "Hizmet Özeti" üst etiketiyle AYNI aileden, bir tık daha küçük —
  `11px` vs panelin ana üst etiketinin `text-xs`/12px — çünkü bu İKİNCİL bir alt-başlık, panelin
  BİRİNCİL başlığı değil).
- **Seçili durum:** `CalendarCheck` (lucide, §2.2.5/§2.3.6 ile AYNI ikon — "onaylı tarih"
  sinyalinin panel İÇİNDE TEKRARI, tutarlı bir görsel dil) + `{formatDayLabel} · {formatTime}`
  (§2.2.5 ile AYNI orta-nokta ayraç konvansiyonu — görev tanımının verdiği örnek `"16 Eylül
  Çarşamba, 09:30"` VİRGÜLLÜ formatı KASITLI olarak KULLANILMAZ, çünkü proje zaten §2.2.5'te
  orta-nokta ayracını "30 dk · ₺450" ile AYNI konvansiyon olarak sabitlemiş; ikinci bir ayraç
  biçimi İCAT ETMEK tutarsızlık yaratırdı).
- **Boş durum (hiçbir şey seçilmemiş):** `text-sm text-foreground/40` "Tarih ve saat seçin" —
  `/40` opaklığı bu panelin/dokümanın en soluk metin tonu (§2'nin `/60`'ından, §2.1.3'ün
  `/80`'inden DAHA soluk) çünkü bu bir PLACEHOLDER, gerçek bir veri/meta bilgi DEĞİL — input
  placeholder'larının genel konvansiyonuyla (gerçek değerden daha soluk) tutarlı. İkon YOK bu
  durumda (`CalendarCheck` yalnızca gerçek bir seçim olduğunda "onaylı" anlamı taşır; boş
  durumda bir ikon göstermek sahte bir doluluk hissi verirdi).

### 2.4.5 CTA + fiyat

- **Fiyat:** `formatPriceFromCents` + `" / seans"` (§2.1.4/§2 ile BİREBİR AYNI biçimlendirici/
  ek — YENİ bir format İCAT EDİLMEZ), `text-2xl font-semibold text-foreground` + `text-sm
  text-foreground/60` ek, `flex items-baseline gap-1.5` (§2.1.4 ile AYNI).
- **CTA:** `Button size="lg" className="w-full rounded-[var(--site-radius)]"` "Randevu Al",
  `href="#randevu"` (§2.1.4 ile AYNI davranış — sayfanın kendi slot takvimine kaydırır). **DEVRE
  DIŞI BIRAKILMAZ** (`selectedSlot` olmasa da tıklanabilir kalır) — bu buton bir "randevuyu
  onayla" GÖNDER'i DEĞİL, panelin İÇİNDEN takvime/forma bir ÇAPA bağlantısıdır (gerçek "Randevuyu
  Onayla" `<button type="submit">`'i §2.2.5/§2.3.6'nın altındaki booking formunda, farklı bir
  elemanda KALIR) — kullanıcı henüz saat seçmeden bu butona basarsa takvime yönlendirilir, bu
  BEKLENEN/YARARLI bir davranıştır, DEVRE DIŞI bırakmak fonksiyonu GİZLERDİ.
- Fiyat CTA'nın ÜSTÜNDE (§2.1.4 ile AYNI dikey sıra) — görev tanımının "CTA + altında/yanında
  fiyat" ifadesindeki iki seçenekten (üstte/yanda) ÜSTTE olanı §2.1.4'ün mevcut kararıyla
  TUTARLILIK için KORUNUR (yeni bir yan-yana düzen İCAT EDİLMEZ).

### 2.4.6 Sticky davranış ve mobil — §2.1.4/§2.1.5'e EK

- **Masaüstü (`lg:` ve üzeri):** `lg:sticky lg:top-24 lg:self-start` OFFSET'i DEĞİŞMEZ (§2.1.1
  ile AYNI, projede 4 yerde kurulu emsal — YENİ bir offset İCAT EDİLMEZ). **EKLENEN tek şey:**
  `lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto` — panel artık avatar+ayraç+hizmet+seçim
  kutusu+fiyat+CTA taşıdığından (eski sürümün ~3 katı yükseklik), çok kısa viewport'larda
  (ör. tarayıcı araç çubukları açık bir 720px yükseklik) `top-24` (96px) offset'iyle birlikte
  panel viewport'un ALT kenarını AŞABİLİR; `max-h-[calc(100vh-7rem)]` (viewport - 112px, `top-24`
  96px + güvenlik payı) + `overflow-y-auto` panel KENDİ İÇİNDE kayar, sayfanın GENEL scroll'unu
  ETKİLEMEZ. Tipik masaüstü yüksekliklerde (`≥768px`) panel zaten TAMAMEN sığar, bu kural sadece
  bir GÜVENLİK AĞIDIR, normal kullanımda görünmez/devreye GİRMEZ.
- **Mobil (`<lg`):** §2.1.5'in mobil davranışı DEĞİŞMEZ — bu ZENGİN panel (§2.4.1'in TAMAMI)
  hero başlığının hemen altında, normal akışta, `sticky` OLMADAN TEK KEZ render edilir (§2.1.5
  ile AYNI, sadece artık İÇERİĞİ zengin). **Ayrı bir "mobil sade panel" İCAT EDİLMEZ** — mobil
  kullanıcı da masaüstü kullanıcının gördüğü AYNI zengin özeti (avatar/hizmet/seçim/fiyat/CTA)
  görür, tek fark `sticky` OLMAMASI. Kullanıcı bu paneli kaydırıp GEÇTİĞİNDE devreye giren
  `sticky-add-to-cart-bar.tsx` deseni (§2.1.5'teki `fixed inset-x-0 bottom-0` çubuk) DEĞİŞMEZ —
  o çubuk BİLİNÇLİ olarak SADE kalır (yalnızca fiyat+CTA, §2.1.5'in JSX'i BİREBİR) çünkü onun
  rolü "kullanıcı zaten scroll ETTİ, sadece hızlı bir CTA hatırlatıcısı" — zengin içeriği (avatar/
  hizmet/seçim satırı) o dar `h-16` çubuğa SIKIŞTIRMAK okunaksız/aceleci bir UI üretirdi. Kısacası:
  **zengin panel = TEK render nokta (üstte, sticky/non-sticky farkıyla masaüstü/mobil ayrışır),
  sade fiyat+CTA çubuğu = SADECE mobilde, panel viewport'tan çıkınca, İKİNCİ bir hatırlatıcı** —
  bu §9.2'nin "şerit+kart" bilinçli tekrar ilkesiyle AYNI mantık.

---

## 3. Slot düğmesi durumları (müsait / dolu / geçmiş / seçili)

**Not (2026-09-11, ui-designer, v2 — §2.3 sonrası):** aşağıdaki tablo artık YALNIZCA SAAT
SLOTUNU kapsar — "tarih chip'i" §2.3'ün AY TAKVİMİ IZGARASI tarafından supersede edildiği için
(gün seçimi artık §2.3.2'nin hücreleri üzerinden yapılır, kendi durum tablosu ORADADIR) bu
tablonun **"Müsait"** ve **"Seçili"** satırları ARTIK yalnızca §2.2.1'in SAAT SLOTU yarısını
yansıtır (tarih chip'i referansı TARİHSEL bir not olarak okunmalı). **"Dolu"** ve **"Geçmiş"**
satırları DEĞİŞMEDİ, bunlar zaten §2.2.4/§2.3.4'te aynen tekrarlandı.

`GET /doctors/{slug}/slots` yalnızca `{ startsAt, endsAt, available }` döndürür (mimari §4.2)
— "geçmiş" ile "dolu/tampon içi" ayrımı **frontend'in `now` ile karşılaştırmasından** gelir,
ikisi de `available: false` olarak gelir ama görsel muameleleri FARKLIDIR (aşağıda).

**Temel şekil:** `h-10 min-w-[84px] px-3 rounded-[var(--site-radius)] text-sm font-medium
tabular-nums border transition-colors duration-150`, saat metni ziyaretçinin yerel dilimine
göre biçimlendirilmiş (`HH:mm`, §4). Grup: `role="radiogroup" aria-label="{gün adı}
müsaitlik saatleri"`, her düğme `role="radio" aria-checked`.

| Durum | Sınıf | Ek sinyal (renk-bağımsız, WCAG 1.4.1) |
|---|---|---|
| **Müsait** (seçilebilir, seçili değil) | `border-border bg-surface text-foreground hover:border-primary/50 hover:bg-primary/5 cursor-pointer` | Yok — bu en sık görünen durum, sade kalır; `aria-label="{saat} — müsait"` |
| **Seçili** | `border-2 border-transparent bg-primary text-primary-foreground ring-2 ring-offset-2 ring-offset-surface ring-primary` | Saat metninin SOLUNDA `Check` ikonu (`h-3.5 w-3.5`, beyaz) — yalnızca dolgu rengine güvenilmez |
| **Dolu** (gelecekte, rezerve edilmiş VEYA 2 saatlik tampon içinde) | `border-border/60 bg-muted text-foreground/40 cursor-not-allowed pointer-events-none line-through decoration-foreground/30` | Saat metni **üstü çizili** + metnin altında `text-[10px] text-foreground/50` **"Dolu"** etiketi. `aria-label="{saat} — dolu, seçilemez"`, `aria-disabled="true"` |
| **Geçmiş** (an zaten geçti) | `border-transparent bg-transparent text-foreground/25 cursor-not-allowed pointer-events-none` (çizgi YOK) | Etiket YOK — "dolu"nun aktif-blok görünümünden BİLİNÇLİ olarak daha soluk/sessiz (kullanıcı zaten "bugünün geçmiş saatleri" bağlamında görür); `aria-label="{saat} — geçmiş, artık kullanılamaz"` |

**Neden "dolu" ile "geçmiş" görsel olarak ayrışıyor:** ikisi de `available:false` dönse de
anlamsal olarak farklıdır — "dolu" kullanıcıyı "başka bir saat seç" diye yönlendirir (aktif
bir bilgi), "geçmiş" ise artık alakasız bir zaman dilimidir (dikkat çekmemeli). Aynı soluk
gri tona indirmek bu ayrımı kaybettirir; çizgi+etiket kombinasyonu SADECE "dolu"da vardır.

**Renk-körü güvenliği:** hiçbir durum SADECE renkle ayırt edilmiyor — müsait/seçili/dolu/
geçmiş dörtlüsü sırasıyla "boş kenarlık", "dolgu+ikon", "çizgi+etiket", "opaklık+`aria-label`"
ile de ayrışıyor.

---

## 4. Saat dilimi rozeti

Mimari §4.2 (bağlayıcı): sunucu HTML'i sunucu dilimini yansıtır, ziyaretçi dilimi yalnızca
mount sonrası istemcide okunur → **hidrasyon uyuşmazlığını önlemek için İKİ AŞAMALI render**:

**Aşama 1 — SSR/ilk boya (jenerik, dilim bilgisi YOK):**
```
<div className="mb-3 flex items-center gap-2 rounded-[var(--site-radius)] border border-border bg-muted/50 px-3 py-2 text-xs text-foreground/60">
  <Globe className="h-3.5 w-3.5 shrink-0" />
  <span>Saat dilimi algılanıyor…</span>
</div>
```

**Aşama 2 — mount sonrası (istemci dilimi bilinir):**
```
<div className="mb-3 flex items-start gap-2 rounded-[var(--site-radius)] border border-border bg-muted/50 px-3 py-2 text-xs text-foreground/70">
  <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/50" />
  <span>
    Saatler <strong className="font-medium text-foreground">Europe/Istanbul</strong> diliminizde gösteriliyor
    <span className="text-foreground/50"> (doktorun yerel saati: 14:00)</span>
  </span>
</div>
```

- Konum: slot ızgarasının HEMEN ÜSTÜNDE, gün seçicinin altında (kullanıcı saatleri okumadan
  ÖNCE hangi dilimde olduğunu görür).
- Ziyaretçi dilimi **her zaman birincil/güçlü** (`font-medium text-foreground`), doktorun
  yerel saati **ikincil/muted** parantez içi — birincil bilgi kullanıcının KENDİ eylemiyle
  ilgili olan saattir.
- İkon `Globe` (lucide) — saat dilimi/coğrafya çağrışımı, `Clock` ikonuyla KARIŞTIRILMAZ
  (o, aşağıdaki geri sayımda kullanılır, §7).

---

## 5. Konsültasyon odası kontrol çubuğu

Minimalist, video alanının ÜZERİNE bindirilen tek bir yüzen çubuk — bu projedeki TEK
sistemik "cam" istisnası (§0):

```
<div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-3">
  <div className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-2 backdrop-blur-md">
    {/* mikrofon, kamera, ekran paylaşımı — h-12 w-12 dairesel */}
    {/* ayrıl — h-14 w-14, ayrı gruplanmış */}
  </div>
</div>
```

**Toggle düğmeleri (mikrofon/kamera/ekran paylaşımı):** `h-12 w-12 rounded-full flex
items-center justify-center transition-colors duration-150`:

| Durum | Sınıf | İkon |
|---|---|---|
| Açık/aktif | `bg-white/15 text-white hover:bg-white/25` | `Mic` / `Video` / `ScreenShare` |
| Kapalı/susturulmuş | `bg-white/90 text-black` (BEYAZ dolgu — "kapalı" durumunu koyu ikon+açık zemin ile vurgular, karanlık video üzerinde en yüksek fark) | `MicOff` / `VideoOff` / `ScreenShareOff` — lucide'in "off" varyantları, salt renkle DEĞİL farklı İKONLA da ayrışır |

Her düğme `aria-pressed` + `aria-label="Mikrofonu kapat"`/`"Mikrofonu aç"` (duruma göre
DİNAMİK metin — sadece ikon değişimi ekran okuyucuya yetmez).

**Ayrıl düğmesi:** görsel olarak GRUPTAN ayrık (`ml-2` boşluk + kendi dairesi, gruba
KARIŞTIRILMAZ — yanlışlıkla tıklanmasın diye komşularından uzak):
```
<button className="ml-2 flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white transition-colors hover:bg-danger/90">
  <PhoneOff className="h-5 w-5" />
</button>
```
`bg-danger` (`#b91c1c`, kök token — §0, telehealth için YENİ bir kırmızı İCAT EDİLMEDİ).

**Katılımcı adı/rol etiketi** (video karesinin sol-alt köşesi, her katılımcı için):
`rounded-[var(--site-radius)] bg-black/60 px-2 py-1 text-xs font-medium text-white
backdrop-blur-sm` — "Dr. Ayşe Yılmaz" / "Hasta" (misafir hastanın gerçek adı yerine ROL
gösterilir, §8 güvenlik notunun ruhuyla tutarlı — PII ekranda gereksiz yere büyütülmez).

---

## 6. Bekleme odası paneli vs. "LiveKit yapılandırılmamış" paneli — KASITLI farklı görsel dil

Mimari §4.4 madde 3: bu ikisi **FARKLI durumlardır** ve birbirine KARIŞTIRILMAMALIDIR — biri
nötr/geçici bir bekleyiş, diğeri "yönetici aksiyonu gerekli" bilgilendirmesi.

### 6.1 Bekleme odası (nötr, sakin — LiveKit yapılandırılmış ama karşı taraf henüz katılmadı)

```
<div className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-primary/20 bg-primary/5 p-8 text-center">
  <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
    <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
    <Loader2 className="h-5 w-5 animate-spin text-primary" />
  </span>
  <h3 className="font-semibold text-foreground">Bekleme Odası</h3>
  <p className="max-w-xs text-sm text-foreground/60">
    Doktorunuz bağlandığında görüşme otomatik olarak başlayacak.
  </p>
</div>
```

Ton: `primaryColor` (`#0F766E`) tintli, `animate-ping` ile YUMUŞAK bir nabız efekti ("bir şey
bekleniyor, ama sorun yok") — alarm/uyarı ÇAĞRIŞTIRMAZ.

### 6.2 "LiveKit yapılandırılmamış" (dürüst durum ekranı — admin aksiyonu gerekli)

```
<div className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-warning/30 bg-warning/5 p-8 text-center">
  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/15">
    <Settings2 className="h-5 w-5 text-warning" />
  </span>
  <h3 className="font-semibold text-foreground">Görüntülü Görüşme Yapılandırılmamış</h3>
  <p className="max-w-sm text-sm text-foreground/60">
    {/* compliance-agent/backend-agent'ın metni — mimari §4.4 madde 3'teki cümle BİREBİR */}
  </p>
</div>
```

Ton: `--warning` (`#92400e`, kök token, 7.09:1) — **`--danger` DEĞİL**: bu bir hata/çökme
değil, beklenen bir kurulum adımıdır ("aciliyet" değil "bilgilendirme" kaydı, `design-notes-
ecommerce-storefront.md` §4'teki "uyarı ama alarm değil" ayrımıyla AYNI ilke). İkon `Settings2`
(yapılandırma çağrışımı) — `AlertTriangle` KULLANILMAZ, çünkü o "bir şey bozuldu" hissi verir;
burada bozulan bir şey yok, henüz kurulmamış bir şey var. Randevu bilgileri (§7 geri sayımı,
katılımcı listesi) bu panelin ÜSTÜNDE/YANINDA **normal şekilde** render edilmeye devam eder
(mimari kararı — sayfa tamamen boşalmaz, yalnızca video alanı bu paneli gösterir).

**Ayrım özeti:** bekleme odası = `primary` tint + `Loader2` (spinner) + sakin dil; yapılandırma
eksik = `warning` tint + `Settings2` + "yönetici" hitaben dil. İkisi ASLA aynı anda görünmez
(karşılıklı dışlayan durumlar — LiveKit yapılandırılmamışsa bekleme odası kavramı zaten
anlamsızdır).

---

## 7. Geri sayım sayacı tipografisi

Katılım penceresi `startsAt - 5dk` ile `endsAt + 15dk` arasıdır (mimari §4.5) — geri sayımın
görsel ağırlığı randevuya yaklaştıkça ARTAR (iki kademe):

| Kademe | Ne zaman | Tipografi |
|---|---|---|
| **Uzak** (>15 dk kala) | Normal cümle içinde | `text-sm text-foreground/70` — *"Randevunuza 2 saat 14 dakika kaldı."* (`Inter`, `tabular-nums` yalnızca sayılara) |
| **Yakın** (≤15 dk kala, katılım penceresi açık/yaklaşıyor) | Büyük, tek başına | `text-3xl sm:text-5xl font-bold tabular-nums tracking-tight text-foreground` — `PLUS_JAKARTA_SANS` (`headingFont`), format `04:59` (MM:SS) |

**Renk geçişi (yakın kademede, saniye saniye değil eşik bazlı):** `text-foreground` (nötr) →
katılım penceresi FİİLEN açıldığında (`now >= startsAt - 5dk`) `text-primary` (teal,
"katılabilirsiniz" sinyali) + geri sayımın altında `Button` "Görüşmeye Katıl" belirir. Renk
DEĞİŞİMİ TEK BAŞINA anlam taşımaz — buton her zaman metinle birlikte gelir (WCAG 1.4.1).

**İki nokta üst üste ayracı** hafif soluk (`text-foreground/30`) — rakamlar baskın kalsın:
```
<span className="text-3xl sm:text-5xl font-bold tabular-nums tracking-tight">
  02<span className="text-foreground/30">:</span>14<span className="text-foreground/30">:</span>59
</span>
```

---

## 8. Tipografi ölçeği (`headingFont: PLUS_JAKARTA_SANS`, `bodyFont: INTER`, tutarlı skala)

| Rol | Sınıf | Font |
|---|---|---|
| Doktor adı / sayfa başlığı (H1) | `text-2xl sm:text-3xl font-semibold` (24/30px) | Plus Jakarta Sans |
| Bölüm başlığı (H2 — "Müsaitlik", "Hakkında") | `text-xl font-semibold` (20px) | Plus Jakarta Sans |
| Kart başlığı (doktor kartı adı, panel başlığı) | `text-base font-semibold` (16px) | Plus Jakarta Sans |
| Gövde metni | `text-sm`/`text-base` (14/16px) `font-normal` | Inter |
| İkincil/muted metin (uzmanlık, tarih, açıklama) | `text-xs`/`text-sm` (12/14px), `text-foreground/60` | Inter |
| Slot/saat metni, fiyat, sayaç (uzak kademe) | `font-medium tabular-nums` | Inter |
| Geri sayım (yakın kademe, §7) | `font-bold tabular-nums tracking-tight` | Plus Jakarta Sans |
| `baseFontSize` | 16 | — |

`borderRadius: LG` (16px) → HER interaktif yüzeyde (`Button`, `Card`, slot düğmesi, rozet
konteyneri, avatar-DIŞI dikdörtgen elemanlar) `rounded-[var(--site-radius)]` override
ZORUNLUDUR — `ecommerce-storefront.md` §0'daki AYNI kontrat, bu şablon için tekrar edilir çünkü
paylaşılan `Button`/`Card` bileşenleri kendi varsayılan `rounded-lg`/`rounded-xl` sınıflarını
taşır ve bunlar 16px'e denk GELMEYEBİLİR. `buttonStyle: SOLID` → birincil CTA'lar (`Button`
`variant="default"`) her zaman dolgu renkli, `outline`/`ghost` yalnızca ikincil aksiyonlarda
(§2 "Profili Gör" gibi).

---

## 9. Acil durum uyarısı — yerleşim ve görsel dil

Metnin İÇERİĞİ compliance-agent'ındır (*"Bu platform acil tıbbi durumlar için KULLANILAMAZ.
Acil durumda 112'yi arayın."*); burada yalnızca YERLEŞİM ve GÖRSEL DİL kararı verilir.

**Ton: `--warning` (amber), `--danger` DEĞİL.** Gerekçe: bu bir hata/arıza bildirimi değil,
KALICI bir kullanım kısıtı bildirimidir; `--danger` (kırmızı) ekranda "bir şeyler ters gitti"
okunur ve zamanla kullanıcı tarafından "yoksayılan bir hata rengi" olarak öğrenilebilir
(banner-blindness riski) — `--warning` "dikkat, bilgi" tonu bu kalıcı/yasal notlar için daha
doğru semantiktir (aynı ayrım §6.2'de "yapılandırılmamış" paneli için de kullanıldı).

### 9.1 Sitewide ince şerit (kalıcı, kapatılamaz)

`/doctors*` ve `/consultation/*` altındaki TÜM sayfalarda, header'ın HEMEN ALTINDA, tam
genişlik (`w-full`, `.site-scope` konteyner genişliğinin DIŞINDA, edge-to-edge):

```
<div className="w-full border-b border-warning/25 bg-warning/10 px-4 py-2">
  <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 text-center text-xs font-medium text-warning sm:text-sm">
    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    {/* compliance-agent metni */}
  </p>
</div>
```

**Kapatma/`X` düğmesi YOK** — bu bir çerez bandı (`cookie-consent-banner.tsx`) değil, kalıcı
bir güvenlik bildirimidir; kullanıcı tercihiyle gizlenebilir olmamalı. `z-index` GEREKMEZ (akış
içinde, `sticky`/`fixed` DEĞİL — sayfayla birlikte kayar, header'ın sahip olduğu `sticky` katmanı
tekrar İCAT EDİLMEZ ve iki sticky eleman üst üste binme riski oluşmaz).

### 9.2 Randevu formu/booking anında ikinci, daha belirgin tekrar

Mimari §6.6: ana sayfa VE doktor detay sayfasında da yer alır — doktor detay sayfasında bu,
**randevu formunun/slot takviminin HEMEN ÜSTÜNDE**, kart biçiminde tekrarlanır (§9.1'in ince
şeridinden DAHA görünür, çünkü burası fiilen aksiyon anı):

```
<div className="mb-4 flex items-start gap-3 rounded-[var(--site-radius)] border border-warning/30 bg-warning/10 p-4">
  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
  <p className="text-sm text-warning">{/* compliance-agent metni */}</p>
</div>
```

Ana sayfada aynı kart, doktor tanıtım bölümünün (§6.5 madde 6, "Öne çıkan doktorlar") HEMEN
ALTINDA/YANINDA — kullanıcı "randevu al" CTA'sına tıklamadan ÖNCE bunu görür.

**Neden şerit + kart ikisi birden (tekrar bilinçli):** ince şerit her sayfada "arka plan
bilgisi" görevi görür (her zaman orada, ama göze batmaz); kart ise TAM aksiyon anında
(booking formunun eşiğinde) dikkat çeker — checkout'taki "mobil peek + sağ sütun sipariş
özeti" ikili tekrarıyla (`design-notes-checkout-redesign.md` §2) AYNI ilke: farklı yerlerde
farklı işlev gören bilinçli bir tekrar, kazara çoğaltma DEĞİL.

---

## 10. Avatar monogramı ve destekleyici görseller — yön (kısa, dosya üretimi bu turda ZORUNLU DEĞİL)

- **4 doktor avatarı (§6.3):** `bg-gradient-to-br from-[#0F766E] to-[#0369A1]` (hero
  gradyanıyla AYNI uçlar, marka tutarlılığı) zemin üzerinde beyaz, `Plus Jakarta Sans
  font-semibold`, TEK harf VEYA iki harf baş harfleri (`AY`, `MK` gibi) — 512×512,
  `backend/scripts/build-template-assets.ts` ile üretilir (backend-agent'ın ikinci turu).
  Fotogerçekçi/AI insan görseli KESİNLİKLE YOK ([DTI] §9.3, mimari §6.3 ile birebir).
- **2-3 destekleyici görsel ("güven bandı"/"nasıl çalışır"):** soyut/geometrik, 1200×900 —
  `ecommerce-pro`'nun kategori arka planlarıyla (`design-notes-ecommerce-storefront.md` §11)
  AYNI teknik: `backgroundColor → surfaceColor` hafif gradyan zemin + `primaryColor`
  (`#0F766E`) tonunda %15-25 opaklıkta ince motif. Önerilen motifler: (a) "7/24 erişim" →
  merkezi bir saat kadranının ince çizgi soyutlaması, (b) "şifreli görüşme" → iç içe geçmiş
  ince kilit/kalkan çizgisi, (c) "doğrulanmış hekim" → basit bir rozet/onay işareti
  soyutlaması. Rozet ikonlarının KENDİSİ SVG olarak ÇİZİLMEZ — mevcut `icon-box` bloğu +
  `lucide-react` (`Clock`, `ShieldCheck`, `BadgeCheck`) kullanılır, [DTI] §4.4 emsaliyle
  BİREBİR aynı karar.

---

## 11. `preview.svg`

Yol: `frontend/public/demo-templates/telehealth-clinic/preview.svg` — **oluşturuldu**, bu
görevin bir parçası (aşağıdaki dosya). 1200×750, `modern-architecture`/`ecommerce-pro`
preview'larıyla AYNI ölçü/format konvansiyonu (statik servis edilir, `Media` boru hattından
GEÇMEZ, [DTI] §4.5 tadilatı §9.6'da kayıtlı). İçerik: koyu lacivert (`#0F172A`) header, ince
amber uyarı şeridi (§9.1'in önizlemedeki temsili), teal→okyanus mavisi (`#0F766E→#0369A1`)
gradyanlı hero (EKG nabız çizgisi + mini "slot ızgarası" ipucu — bu şablonun ayırt edici
özelliği randevu takvimidir, önizlemede de sergilenir), 3'lü güven rozeti bandı, 6'lı uzmanlık
ızgarası, 4'lü doktor kartı şeridi (monogram avatarlar, GERÇEK insan görseli YOK), koyu footer.
Gerçek metin/fotoğraf içermez — yalnızca bölüm ritmini ve palet renklerini temsil eder.

---

## Özet — Uygulanacak Somut Değerler

| Öğe | Değer |
|---|---|
| `primaryColor` / `accentColor` | **`#0F766E`** (mimari önerisi `#0D9488`'in ÜZERİNE, 5.23:1/5.48:1) |
| `secondaryColor` | `#0F172A` (değişmedi, teal metin BU zeminde KULLANILMAZ — §1.3) |
| `buttonColor` / `linkColor` | **`#0369A1`** (mimari önerisi `#0284C7`'nin ÜZERİNE, 5.67:1/5.93:1) |
| `buttonTextColor` | `#FFFFFF` (5.93:1 üzerinde `buttonColor`) |
| `backgroundColor` / `surfaceColor` | `#F8FAFC` / `#FFFFFF` (değişmedi) |
| `textColor` / `mutedTextColor` | `#0F172A` (17.06:1) / `#64748B` (4.55:1) (değişmedi) |
| `borderRadius` / `buttonStyle` / `presetKey` | `LG` (16px) / `SOLID` / `null` |
| `headingFont` / `bodyFont` / `baseFontSize` | `PLUS_JAKARTA_SANS` / `INTER` / `16` |
| Hero gradyanı | `#0F766E → #0369A1`, sol-üst → sağ-alt |
| Doktor kartı avatarı (ızgara) | `h-16 w-16` dairesel; monogram fallback `from-[#0F766E] to-[#0369A1]` |
| Doktor detay hero düzeni (§2.1) | `grid-cols-1 lg:grid-cols-[1fr_320px] gap-8`, sağ sütun `lg:sticky lg:top-24 lg:self-start` |
| Hero avatar | `h-28 w-28 sm:h-36 sm:w-36 rounded-[var(--site-radius)]` (yumuşak kare, ızgaradan KASITLI farklı); monogram AYNI `from-[#0F766E] to-[#0369A1]` gradyanı (hash-tabanlı çoklu renk KULLANILMAZ) |
| Hero chip'leri | Doğrulama: `Badge tone="primary" solid size="lg"` + `BadgeCheck`; Uzmanlık: `Badge tone="primary" size="lg"` + `Stethoscope`; Diller: `Badge tone="neutral" size="sm"` (değişmedi) |
| Hero "Hakkında" tipografisi | `max-w-prose text-base leading-7 text-foreground/80` (eski `text-sm leading-relaxed text-foreground/70`'in yerine) |
| Hero fiyat/CTA paneli | Ayrı `bg-surface border border-border` kart, `lg:sticky lg:top-24`; mobilde `sticky-add-to-cart-bar.tsx` ile BİREBİR aynı `fixed bottom-0 z-40` alt çubuk deseni |
| Dil rozeti | `Badge variant="outline" size="sm"`, ISO kodu büyük harf, emoji bayrak YOK |
| ~~Tarih chip (§2.2.1)~~ | **SUPERSEDE EDİLDİ** → §2.3.2 ay takvimi hücreleri (aşağıdaki 2 satır) |
| Slot (saat) — müsait (§2.2.1/§2.3.4, DEĞİŞMEDİ) | `h-10 rounded-[var(--site-radius)] border-border bg-surface text-foreground hover:border-primary/50 hover:bg-primary/5 px-3 min-w-[84px]` |
| Slot (saat) — seçili (§2.2.1/§2.3.4, DEĞİŞMEDİ) | `border-2 border-transparent bg-primary text-primary-foreground ring-2 ring-offset-2 ring-offset-surface ring-primary` + `Check` ikonu |
| Slot — dolu | `bg-muted text-foreground/40 line-through` + "Dolu" etiketi + `Lock` yok, sadece çizgi+etiket (DEĞİŞMEDİ) |
| Slot — geçmiş | `text-foreground/25`, çizgi/etiket YOK, yalnızca `aria-label` (DEĞİŞMEDİ) |
| **Ay takvimi ızgarası (§2.3.1/§2.3.2, YENİ)** | Nav: `< EYLÜL 2026 >`, geri buton geçmiş aya `disabled`; hücre `grid grid-cols-7 gap-1`, taban `h-10 sm:h-11 w-full`; müsait `border-primary/20 bg-primary/5` + nokta işaretleyici; en yakın müsait gün "Erken" mikro-etiketi; müsait-değil/geçmiş `text-foreground/25` (`<span>`, tıklanamaz); seçili `bg-primary text-primary-foreground shadow-sm` + `Check` |
| Saat grid gruplama (§2.3.3, GÜNCELLENDİ — 3→2 grup) | ÖÖ Sabah `00:00-11:59` (ikon `Sun`, `from-amber-50 to-orange-50`) / ÖS Öğleden Sonra `12:00-23:59` (ikon `CloudSun`, `bg-muted`) — her grup `overflow-hidden rounded-[var(--site-radius)] border border-border` kart, şerit `text-xs font-semibold uppercase tracking-wider`, grid `grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 p-3` |
| ~~Seçili gün başlığı (§2.2.3)~~ | **KALDIRILDI** — takvim hücresinin kendi seçili vurgusu + §2.4.4'ün "Seçilen Randevu" satırı bu bilgiyi zaten taşıyor |
| Seçim onay şeridi (§2.2.5/§2.3.6, DEĞİŞMEDİ) | `border-primary/30 bg-primary/5` + `CalendarCheck` ikonu + "{gün} · {HH:mm}" + "Değiştir" bağlantısı, saat kartlarının altı/formun üstü |
| **Hizmet Özeti paneli (§2.4, YENİ — §2.1.4'ü genişletir)** | Üst etiket "HİZMET ÖZETİ"; avatar `h-12 w-12 rounded-full` + ad/uzmanlık; ayraç; hizmet adı `{specialty ?? "Genel Danışmanlık"} Seansı` + `Clock` ikonu + süre; "Seçilen Randevu" kutusu (`bg-muted/50`, boşken `text-foreground/40` "Tarih ve saat seçin"); fiyat üstte + `Button` "Randevu Al" altta (devre dışı bırakılmaz); sticky `lg:top-24` DEĞİŞMEDİ, EK `lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto` güvenlik ağı; mobilde aynı zengin panel tek render + değişmeyen sade `sticky-add-to-cart-bar` çubuğu |
| Saat dilimi rozeti | 2 aşamalı (SSR jenerik → mount sonrası ikili gösterim), `Globe` ikonu, DEĞİŞMEDİ (§2.2.6 — sadece `mb-4` hizalama) |
| Konsültasyon kontrol çubuğu | `bg-black/70 backdrop-blur-md rounded-full`, toggle `h-12 w-12`, ayrıl `h-14 w-14 bg-danger` ayrık |
| Bekleme odası paneli | `border-primary/20 bg-primary/5` + `Loader2` + `animate-ping` (sakin) |
| "Yapılandırılmamış" paneli | `border-warning/30 bg-warning/5` + `Settings2` (admin aksiyonu, `--danger` DEĞİL) |
| Geri sayım — uzak | `text-sm` cümle, Inter |
| Geri sayım — yakın (≤15dk) | `text-3xl sm:text-5xl font-bold tabular-nums`, Plus Jakarta Sans, pencere açılınca `text-primary` |
| Acil durum uyarısı | `--warning` tonu (`--danger` DEĞİL); sitewide kapatılamaz ince şerit (§9.1) + booking anında kart tekrarı (§9.2) |
| Avatar/destekleyici görsel yönü | Monogram gradyan (§10), soyut çizgi motifli destekleyici görseller — fotoğraf/AI insan YOK |
| `preview.svg` | `frontend/public/demo-templates/telehealth-clinic/preview.svg`, 1200×750, oluşturuldu |
