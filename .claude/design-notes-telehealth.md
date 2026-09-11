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

## 3. Slot düğmesi durumları (müsait / dolu / geçmiş / seçili)

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
| Doktor kartı avatarı | `h-16 w-16`(ızgara)/`h-24 w-24`(profil) dairesel; monogram fallback `from-[#0F766E] to-[#0369A1]` |
| Dil rozeti | `Badge variant="outline" size="sm"`, ISO kodu büyük harf, emoji bayrak YOK |
| Slot — müsait | `border-border bg-surface hover:border-primary/50` |
| Slot — seçili | `bg-primary text-primary-foreground ring-2 ring-primary` + `Check` ikonu |
| Slot — dolu | `bg-muted text-foreground/40 line-through` + "Dolu" etiketi + `Lock` yok, sadece çizgi+etiket |
| Slot — geçmiş | `text-foreground/25`, çizgi/etiket YOK, yalnızca `aria-label` |
| Saat dilimi rozeti | 2 aşamalı (SSR jenerik → mount sonrası ikili gösterim), `Globe` ikonu |
| Konsültasyon kontrol çubuğu | `bg-black/70 backdrop-blur-md rounded-full`, toggle `h-12 w-12`, ayrıl `h-14 w-14 bg-danger` ayrık |
| Bekleme odası paneli | `border-primary/20 bg-primary/5` + `Loader2` + `animate-ping` (sakin) |
| "Yapılandırılmamış" paneli | `border-warning/30 bg-warning/5` + `Settings2` (admin aksiyonu, `--danger` DEĞİL) |
| Geri sayım — uzak | `text-sm` cümle, Inter |
| Geri sayım — yakın (≤15dk) | `text-3xl sm:text-5xl font-bold tabular-nums`, Plus Jakarta Sans, pencere açılınca `text-primary` |
| Acil durum uyarısı | `--warning` tonu (`--danger` DEĞİL); sitewide kapatılamaz ince şerit (§9.1) + booking anında kart tekrarı (§9.2) |
| Avatar/destekleyici görsel yönü | Monogram gradyan (§10), soyut çizgi motifli destekleyici görseller — fotoğraf/AI insan YOK |
| `preview.svg` | `frontend/public/demo-templates/telehealth-clinic/preview.svg`, 1200×750, oluşturuldu |
