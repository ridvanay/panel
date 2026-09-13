# Tasarım Notları — Kurumsal Hekim Profili, Kimlik Bilgileri Adımı, Doktor Konsolu

Durum: v1 (2026-09-13) · Sahibi: ui-designer
Girdi: `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**, BAĞLAYICI —
alan/kontrat/şifreleme/yetki kararları burada TEKRAR EDİLMEZ, yalnızca görsel karar üretilir),
özellikle §1 (DoctorProfile alanları), §2 (kimlik bilgisi akışı, §2.5 dil kuralı, §2.7 okuma
yetkisi), §3 (doktor konsolu metrikleri), §6 madde 3 (bu doküman için talimat).
Üst doküman: `.claude/design-notes-telehealth.md` (**[TDN]**) — palet/WCAG yöntemi (§0-§1),
tipografi ölçeği (§8), hero/sticky panel deseni (§2.1/§2.4), slot/rozet/uploader/portal dili
(§3, §12, §13). **[TDN] BURADA TEKRAR ÜRETİLMEZ**, yalnızca referans verilir ve GENİŞLETİLİR.
**Kod YAZILMAMIŞTIR** — frontend-agent uygular.

**Dil kuralı ([DPI] §2.5, ENGELLEYİCİ):** Bu dokümanın hiçbir yerinde "kimlik doğrulandı" /
"identity verified" / "doğrulanmış hasta" ifadesi kullanılmaz. Kullanıcıya dönük adım adı
DAİMA **"Kimlik Bilgileri"**dir (§2). `DoctorProfile.isVerified` rozeti ("Doğrulanmış Hekim",
[TDN] §2.1.2) BUNUNLA KARIŞTIRILMAZ — o, doktorun yetkinlik/hesap doğrulaması içindir, hastanın
kimlik BİLGİSİ toplama adımıyla ilgisi yoktur, ikisi hiçbir ekranda yan yana bir "doğrulama"
izlenimi yaratacak şekilde konumlandırılmaz.

**Token kaynağı (SAPMA YOK):** `frontend/src/app/globals.css` `.site-scope` bloğu + [TDN] §1.2
nihai palet: `primaryColor/accentColor` **`#0F766E`**, `secondaryColor` **`#0F172A`**,
`buttonColor/linkColor` **`#0369A1`**, `--site-radius` **16px** (`LG`), kök `--danger`/
`--success`/`--warning`. **Bu doküman YENİ bir renk İCAT ETMEZ** — koyu lacivert başlık dahil
her yüzey bu ZATEN VAR OLAN token setinden kurulur. İkon seti yalnızca `lucide-react`.

---

## 1. Kurumsal hekim profil sayfası (`/doctors/[slug]`)

### 1.1 Koyu lacivert başlık — [TDN] §2.1.2'yi SUPERSEDE eder

[TDN] §2.1.2 hero'yu `bg-surface`/`background` (açık zemin) üzerinde kurmuştu. [DPI] §6 madde 3
bunun yerine **kurumsal, koyu lacivert bir üst bant** istiyor — bu bölüm o kararı uygular ve
[TDN] §2.1.2'nin İÇERİĞİNİ (avatar, isim, rozetler) bu yeni bantın İÇİNE taşır; [TDN] §2.1.1'in
iki-sütunlu grid'i (`lg:grid-cols-[1fr_320px]`, sticky panel) ARTIK bu bandın **ALTINDA** başlar
(aşağıda §1.3).

**Zemin:** `secondaryColor` (`#0F172A`, ZATEN kurulu kök token — [TDN] §1.2, YENİ bir lacivert
İCAT EDİLMEDİ), **edge-to-edge tam genişlik** (`w-full`, `.site-scope` konteynerinin dışına
taşar — [TDN] §9.1'in acil durum şeridiyle AYNI "tam genişlik" tekniği), içerik `mx-auto
max-w-5xl px-4 py-10 sm:px-6 sm:py-14` ([TDN] §2.1.1/§12.6 ile AYNI konteyner genişliği).

#### 1.1.1 WCAG AA doğrulaması ([TDN] §1'deki yöntemin AYNISI, koyu zemin için tekrarı)

| Çift | Ölçülen oran | Sonuç |
|---|---|---|
| Beyaz metin (`#FFFFFF`) / `secondaryColor` (`#0F172A`) | **17.85:1** | Geçer (AAA) — [TDN] §1.3'ün `textColor`/`surfaceColor` çiftiyle simetrik AYNI hesap |
| `text-white/70` (efektif karışım ~`rgb(183,185,191)`) / `secondaryColor` | **~9.11:1** | Geçer (AAA) — [TDN] §1.3'ün zaten kurduğu "koyu zeminde beyaz/`white/70`" kuralının bu bant için sayısal teyidi |
| Beyaz metin / `primaryColor` (`#0F766E`, OPAK rozet zemini) | **5.48:1** | Geçer (AA) — [TDN] §1.3, zeminden bağımsız (rozet kendi opak fonunu taşır) |
| **`primaryColor` (teal) DÜZ METİN olarak / `secondaryColor` zemin** | **3.26:1** | **BAŞARISIZ** (AA metin eşiğinin altında) — [TDN] §1.3'ün "koyu zeminde teal METİN OLARAK KULLANILMAZ" kuralı BU bantta da AYNEN GEÇERLİDİR |

**Bağlayıcı sonuç ([TDN] §1.3'ün bu bant için tekrarı):** teal (`#0F766E`) bu bantta yalnızca
**opak rozet zemini** (beyaz metinle, 5.48:1) veya **ikon/kenarlık gibi grafiksel vurgu**
olarak kullanılır — asla düz metin rengi olarak. Gerçek metin (isim, unvan, ikincil bilgiler)
DAİMA `text-white` veya `text-white/70` — ikinci bir istisna İCAT EDİLMEZ.

#### 1.1.2 "Koyu zemin çip'i" — bu bantta İLK KEZ tanımlanan, yeniden kullanılan taban

Dil rozetleri ve "en yakın randevu" çipi gibi ikincil bilgiler için, [TDN]'nin hiçbir yerinde
henüz tanımlanmamış bir **koyu-zemin çip taban sınıfı** (blur/glow DEĞİL — [TDN] §0'ın
Minimal/Flat kararına sadık, yalnızca düz alfa-şeffaflık):

```
inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1
text-xs font-medium text-white/90
```

Bu, [TDN] §5'in "cam" istisnasıyla (video kontrol çubuğu, `backdrop-blur-md`) **KARIŞTIRILMAZ**
— burada `blur` YOK, yalnızca `bg-white/10` düz alfa karışımı (§1.1.1'in hesabına göre AA'yı
rahatça geçer). [TDN] §0'ın "tek cam istisnası" kuralı BOZULMAZ.

#### 1.1.3 Bant içeriği ve yerleşimi

```
<div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:gap-6">
  {/* avatar — [TDN] §2.1.2 İLE AYNI şekil/boyut, yalnızca ring eklendi */}
  <div className="h-28 w-28 shrink-0 overflow-hidden rounded-[var(--site-radius)] ring-1 ring-white/15 sm:h-36 sm:w-36">
    {/* GERÇEK avatarMedia: <img object-cover>; YOKSA monogram: [TDN] §2.1.2 İLE AYNI
       from-[#0F766E] to-[#0369A1] gradyan, DEĞİŞMEDİ */}
  </div>

  <div className="min-w-0 flex-1">
    {/* doğrulama chip'i — [TDN] §2.1.2 İLE AYNI Badge, opak olduğu için zeminden ETKİLENMEZ */}
    {isVerified && (
      <Badge tone="primary" solid size="lg" className="gap-1.5">
        <BadgeCheck className="h-4 w-4" aria-hidden="true" />
        Doğrulanmış Hekim
      </Badge>
    )}

    <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl break-words">
      {title} {fullName}
    </h1>

    {/* uzmanlık — koyu zeminde teal DÜZ METİN YASAK (§1.1.1); opak teal rozet kullanılır */}
    <Badge tone="primary" solid size="lg" className="mt-3 gap-1.5">
      <Stethoscope className="h-4 w-4" aria-hidden="true" />
      {specialty?.name ?? "Genel Danışmanlık"}
    </Badge>

    {/* alt uzmanlık/merkez — DÜZ METİN, teal DEĞİL, white/70 */}
    {subSpecialty && (
      <p className="mt-2 text-sm text-white/70">{subSpecialty}</p>
    )}

    {/* çip sırası: deneyim rozeti, en yakın randevu, dil rozetleri, iletişim */}
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {experienceYears != null && (
        <Badge tone="primary" solid size="sm" className="gap-1">
          <Briefcase className="h-3 w-3" aria-hidden="true" />
          {experienceYears} Yıl Deneyim
        </Badge>
      )}

      {nextAvailableSlot && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-medium text-white/90">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          En yakın randevu: {formatDayLabel(nextAvailableSlot, tz)} · {formatTime(nextAvailableSlot, tz)}
        </span>
      )}

      {languages?.map((lang) => (
        <span key={lang} className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-xs font-medium text-white/90">
          {lang.toUpperCase()}
        </span>
      ))}

      {contactEmail && (
        <a href={`mailto:${contactEmail}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70 hover:text-white hover:underline">
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
          {contactEmail}
        </a>
      )}
    </div>
  </div>
</div>
```

Gerekçeler:
- **Deneyim rozeti ikonu `Briefcase`:** aşağıdaki Özgeçmiş zaman çizelgesinde (§1.4.2) AYNI ikon
  `EXPERIENCE` girdileri için kullanılır — **bilinçli tekrar** ([TDN] §9'un ilkesi), "mesleki
  deneyim" kavramı sayfa boyunca tek bir ikonla anlatılır.
  `experienceYears` **DTO'da türetilir** ([DPI] §1.1) — bu bant hiçbir hesap yapmaz, sunucudan
  gelen sayıyı gösterir.
- **"En yakın randevu" çipi ikonu `CalendarClock`:** [TDN] §13.1'in `SCHEDULED` rozet ikonuyla
  AYNI ("gelecekte, saati belirli" anlamı, bilinçli tekrar) — bu bir slot/booking rozeti DEĞİL,
  salt bilgilendirme amaçlı bir özet olduğundan `Badge` primitifi DEĞİL, §1.1.2'nin koyu-zemin
  çip tabanı kullanılır (rozet sistemine yeni bir "tone" İCAT ETMEK yerine).
  **Alan opsiyonel:** doktorun en yakın müsait slotu YOKSA (`nextAvailableSlot` `null`) bu çip
  **HİÇ RENDER EDİLMEZ** — [TDN]'nin tekrarlanan "sahte negatif sinyal yok" ilkesi.
- **Dil rozetleri koyu zeminde:** [TDN] §2'nin `Badge variant="outline"` (açık zemine göre
  tasarlanmış `border-border`) BU zeminde okunmaz olurdu — bu yüzden §1.1.2'nin koyu-zemin çip
  tabanı kullanılır; metin/ikon içeriği (`TR`/`EN`, emoji bayrak YOK) [TDN] §2 ile AYNI.
- **İletişim/e-posta:** yalnızca `contactEmail` ALANI VARSA render edilir (hangi alanın bu
  değeri taşıyacağı — `User.email` mi ayrı bir `contactEmail` mi — backend-agent/architect
  kararıdır, bu doküman yalnızca VARSA nasıl göründüğünü tarif eder). `mailto:` bağlantısı,
  `Mail` ikonu, `text-white/70` (ikincil bilgi, isim/uzmanlıktan daha az vurgulu).
- **`isVerified` rozetinin BURADA da "false iken hiçbir şey render edilmez" kuralı** ([TDN]
  §2/§2.1.2 ile AYNI) geçerlidir — sahte bir "doğrulanmamış" negatifi üretilmez.

### 1.2 Sayfa iskeleti — bandın altı

```
<div className="w-full bg-[var(--site-secondary)]">{/* §1.1 bandı */}</div>

<div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
  <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px] lg:items-start">
    <div className="min-w-0">{/* §1.4 sekmeli içerik */}</div>
    <aside className="lg:sticky lg:top-24 lg:self-start">{/* §1.5, [TDN] §2.1.4/§2.4 DEĞİŞMEDİ */}</aside>
  </div>
</div>
```

`lg:grid-cols-[1fr_320px]`, `lg:sticky lg:top-24 lg:self-start`, `320px` sabit sidebar genişliği
— **[TDN] §2.1.1 İLE BİREBİR AYNI**, ikinci bir kesir/offset İCAT EDİLMEZ. Tek fark: sol sütun
artık doğrudan "Hakkında" ile değil, §1.4'ün Tab çubuğuyla başlar (hero içeriği bandın içine
taşındığı için sol sütunun İLK elemanı DEĞİŞTİ, konteyner/offset mantığı DEĞİŞMEDİ).

### 1.3 Sekmeler — `Tabs` primitifi (`@/components/ui/tabs`, ZATEN kurulu, YENİ bileşen İCAT EDİLMEZ)

```
<Tabs defaultValue="about">
  <TabsList variant="line" className="border-b border-border">
    <TabsTrigger value="about">Doktor Hakkında</TabsTrigger>
    <TabsTrigger value="cv">Özgeçmiş</TabsTrigger>
    <TabsTrigger value="publications">Bilimsel Yayınlar</TabsTrigger>
  </TabsList>
  <TabsContent value="about" className="mt-6">{/* §1.4.1 */}</TabsContent>
  <TabsContent value="cv" className="mt-6">{/* §1.4.2 */}</TabsContent>
  <TabsContent value="publications" className="mt-6">{/* §1.4.3 */}</TabsContent>
</Tabs>
```

`variant="line"` (bileşenin kendi `after:bg-primary` alt-çizgi vurgusu, `.site-scope` içinde
otomatik olarak `primaryColor`'a bağlanır — EK bir override GEREKMEZ) — `variant="default"`
(dolgu/pill) DEĞİL, çünkü bu üç sekme "editoryal bölümler" arasında gezinir (dokümantasyon/
içerik gezinmesi hissi), pill-stili DAHA ÇOK filtre/aksiyon anlamı taşır (bu ayrım §3.3'te
konsol filtre sekmeleriyle KASITLI olarak TERS kullanılır — aşağıya bkz.).
**Sekmeler tek URL'de kalır** (seo-agent kararı, [DPI] §6 madde 5) — `value` state'i istemcide
tutulur, her sekme için ayrı bir rota/hash İCAT EDİLMEZ.

#### 1.3.1 Boş sekme durumları

Herhangi bir sekmenin verisi boşsa (`aboutHtml` yok, `cvEntries: []`, `publications: []`)
sekmenin KENDİSİ HÂLÂ görünür (kullanıcı "bu doktorun özgeçmişi yok mu" diye tıklayabilmeli),
ama içerik yerine [TDN]'nin zaten kurduğu boş-durum diliyle ([TDN] §12.5'in `CalendarX2` +
kısa metin kalıbı) tutarlı, sekmeye özgü bir nötr not:

```
<div className="flex flex-col items-center gap-2 rounded-[var(--site-radius)] border border-border bg-muted/30 p-8 text-center">
  <FileQuestion className="h-6 w-6 text-foreground/30" aria-hidden="true" />
  <p className="text-sm text-foreground/50">Bu doktor için henüz özgeçmiş bilgisi paylaşılmamış.</p>
</div>
```
(Sekmeye göre metin değişir: "özgeçmiş"/"bilimsel yayın"/"biyografi" — nihai metin frontend-
agent'ın çeviri sözlüğüne girer, bu doküman yalnızca YERLEŞİM/GÖRSELİ bağlayıcı kılar.)

### 1.4.1 "Doktor Hakkında" — `bio` + `aboutHtml`

[DPI] §1.2: `bio` kısa özet (mevcut, ZATEN sayfada), `aboutHtml` uzun/zengin biyografi (YENİ).
İkisi AYNI sekmede, DİKEY sırayla, birbirinin YERİNE geçmez:

```
<div className="space-y-8">
  <p className="text-base leading-7 text-foreground/80">{bio}</p>

  {aboutHtml && (
    <div
      className="prose prose-sm max-w-prose text-foreground/80 prose-headings:text-foreground prose-a:text-primary prose-strong:text-foreground"
      dangerouslySetInnerHTML={{ __html: aboutHtml }}
    />
  )}
</div>
```

- **`bio` tipografisi** [TDN] §2.1.3 İLE BİREBİR AYNI (`text-base leading-7 text-foreground/80`,
  `max-w-prose` üst kapsayıcıdan miras) — İKİNCİ bir gövde metni ölçeği İCAT EDİLMEZ.
- **`aboutHtml`, `lib/html-sanitize.ts`'ten GEÇMİŞ, GÜVENİLİR HTML'dir** ([DPI] §1.2 — yazma
  yolunda zorunlu, okuma yolunda yeniden sanitize EDİLMEZ); bu yüzden `dangerouslySetInnerHTML`
  KABUL EDİLEBİLİR (proje genelinde zaten `blog`/`aboutHtml` gibi tek-temizleme-yollu alanlar
  için kullanılan AYNI desen — YENİ bir render mekanizması İCAT EDİLMEZ).
- **`prose` sınıfı** (Tailwind Typography, projede ZATEN kurulu olduğu varsayılır — blog içeriği
  muhtemelen aynı sınıfı kullanıyor; kurulu DEĞİLSE bu bir `code-quality-agent` bağımlılık
  kararıdır, ui-designer YENİ bir paket İCAT ETMEZ, alternatif: düz `space-y-3 text-sm
  leading-7` + `[&_a]:text-primary [&_a]:underline` manuel seçiciler). `prose-a:text-primary` —
  ikinci bir link rengi İCAT EDİLMEZ, `linkColor`/`buttonColor` (`#0369A1`) ile ZATEN eşleşen
  `--primary` token'ı miras alınır (dikkat: `aboutHtml` linkleri `primaryColor` (teal) DEĞİL
  `text-primary` class'ının bağlı olduğu CSS değişkenine göre render edilir — projede `--primary`
  `primaryColor`'a eşlenir, [TDN] §1.2; bu SAPMA değildir, mevcut `.site-scope` eşlemesinin
  doğal sonucudur).
- **Boşsa** (`aboutHtml: null`): yalnızca `bio` gösterilir, ikinci blok HİÇ render edilmez —
  §1.3.1'in boş-durum notu BURADA GEREKMEZ (çünkü `bio` zaten her zaman dolu, NOT NULL).

### 1.4.2 "Özgeçmiş" — `cvEntries[]`, DİKEY zaman çizelgesi

[DPI] §1.3 kural 5: dizi SIRASI doktorundur, sunucu yeniden SIRALAMAZ. **Karar: bu sekme
gruplamaz, doktorun verdiği SIRAYLA TEK bir dikey zaman çizelgesi render eder** (Yayınlar
sekmesinden [§1.4.3] KASITLI farklı — orada `kind` görev tanımının AÇIKÇA istediği bir gruplama
kriteriydi, burada değildi; doktorun kendi anlatı sırasını korumak "özgeçmiş" bağlamında daha
doğru bir okuma deneyimidir, akademik yayın listesi ise geleneksel olarak TÜRE göre gruplanır).

```
<ol className="relative space-y-8 border-l border-border pl-8">
  {cvEntries.map((entry) => (
    <li key={entry.id ?? idx} className="relative">
      <span className="absolute -left-[calc(2rem+1px)] flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-foreground/60">
        <KindIcon className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">
        {entry.startYear} — {entry.endYear ?? "Devam ediyor"}
      </p>
      <h3 className="mt-1 text-base font-semibold text-foreground">{entry.title}</h3>
      <p className="text-sm text-foreground/70">
        {entry.organization}{entry.location ? ` · ${entry.location}` : ""}
      </p>
      {entry.description && (
        <p className="mt-2 text-sm leading-6 text-foreground/80">{entry.description}</p>
      )}
    </li>
  ))}
</ol>
```

- **Dikey çizgi + daire-ikon:** `border-l border-border` (çizgi) + her girdi için ikonlu daire
  (`h-8 w-8 rounded-full border border-border bg-surface`) — bu proje/[TDN]'de İLK KEZ kurulan
  bir "timeline" deseni, ama YALNIZCA MEVCUT token'larla (`border-border`, `bg-surface`) —
  YENİ bir renk İCAT EDİLMEZ.
- **`kind` ayrımı RENK DEĞİL İKON'la yapılır** (WCAG 1.4.1 ile tutarlı, [TDN]'nin tekrarlanan
  ilkesi — beş `kind` değeri için beş farklı renk üretmek YENİ renk İCAT ETMEK anlamına gelirdi,
  bu YASAK): tüm daireler AYNI nötr `bg-surface border-border text-foreground/60` zemini taşır,
  yalnızca İÇLERİNDEKİ ikon değişir:

  | `kind` | İkon |
  |---|---|
  | `EDUCATION` | `GraduationCap` |
  | `EXPERIENCE` | `Briefcase` (§1.1.3'ün deneyim rozetiyle AYNI, bilinçli tekrar) |
  | `CERTIFICATE` | `Award` |
  | `MEMBERSHIP` | `Users` |
  | `AWARD` | `Trophy` |

- **Tarih formatı** `{startYear} — {endYear ?? "Devam ediyor"}`: `text-xs font-semibold
  uppercase tracking-wider text-foreground/50` — [TDN] §2.2.2'nin "uppercase eyebrow" deseniyle
  BİREBİR AYNI (grup/bölüm etiketi rolü, YENİ bir stil İCAT EDİLMEZ), `em dash` (`—`) ayracı
  ([TDN]'nin "tek bir ayraç dili" ilkesiyle tutarlı bir tarih-aralığı gösterimi).
- **Boş liste:** §1.3.1'in boş-durum notu.

### 1.4.3 "Bilimsel Yayınlar" — `publications[]`, `kind`'a göre GRUPLANMIŞ akademik liste

Görev tanımının AÇIKÇA istediği gruplama — [DPI] §1.3'ün "dizi sırası doktorundur" kuralı
gruplamayı YASAKLAMAZ ("gruplama/sıralama sunum kararıdır" — bu doküman bu kararı BURADA verir).
**Sabit grup SIRASI** (doktorun veri sırasından BAĞIMSIZ, akademik gelenekteki önem sırası),
**boş grup RENDER EDİLMEZ** ([TDN] §2.2.2 ile AYNI ilke):

| `kind` | Grup başlığı |
|---|---|
| `INTERNATIONAL_ARTICLE` | **"Uluslararası Makaleler"** |
| `NATIONAL_ARTICLE` | **"Ulusal Makaleler"** |
| `PROCEEDING` | **"Bildiriler"** |
| `BOOK_CHAPTER` | **"Kitap Bölümleri"** |
| `OTHER` | **"Diğer Yayınlar"** |

Grup içinde, entries doktorun verdiği SIRAYLA (yeniden sıralanmaz):

```
<section className="space-y-8">
  {GROUP_ORDER.filter((g) => grouped[g]?.length).map((g) => (
    <div key={g}>
      <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-foreground/50 first:mt-0">
        {GROUP_LABEL[g]}
      </p>
      <ul>
        {grouped[g].map((pub) => (
          <li key={pub.id ?? idx} className="border-b border-border/60 py-3 last:border-0">
            <p className="text-sm font-medium text-foreground">{pub.title}</p>
            <p className="mt-1 text-xs text-foreground/60">
              {pub.authors ? `${pub.authors} · ` : ""}{pub.venue} · {pub.year}
            </p>
            {(pub.doi || pub.url) && (
              <a
                href={pub.doi ? `https://doi.org/${pub.doi}` : pub.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                Kaynağa Git
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  ))}
</section>
```

- Grup başlığı [TDN] §2.2.2'nin "uppercase eyebrow" sınıfıyla **BİREBİR AYNI** (`text-xs
  font-semibold uppercase tracking-wider text-foreground/50 mb-2 mt-6 first:mt-0`) — İKİNCİ bir
  bölüm-etiketi dili İCAT EDİLMEZ.
- Satır ayracı `border-b border-border/60` — [TDN] §12.5.2'nin tablo satır ayracı (`divide-y
  divide-border/60`) ile AYNI ton, akademik liste yoğunluğuna uygun ince bir ayrım.
- **`https://` DIŞINDA hiçbir `href` render edilmez** — [DPI] §1.3 kural 3 zaten sunucuda
  `422` ile zorlanıyor, bu yalnızca UI'ın varsayımı doğruladığı bir NOT: frontend-agent ikinci
  bir istemci-taraflı protokol filtresi İCAT ETMEZ, DTO'dan gelen `doi`/`url` zaten güvenlidir.
- **Boş liste (TÜM `publications: []`):** §1.3.1'in boş-durum notu (metin: "Bu doktor için
  henüz bilimsel yayın paylaşılmamış.").

### 1.5 Sticky randevu kutusu

**MEVCUT booking widget tasarımı KORUNUR** ([TDN] §2.1.4/§2.4 "Hizmet Özeti" paneli, §2.3 ay
takvimi, §12.2-§12.5 çoklu slot/uploader/rozet kararlarının TAMAMI DEĞİŞMEDİ) — bu doküman
yalnızca konumlandırmayı teyit eder: `aside`, §1.2'nin grid'inin sağ sütunu,
`lg:sticky lg:top-24 lg:self-start`, `320px` — [TDN] §2.1.1/§2.4.4 ile **BİREBİR AYNI**. Mobil
davranış (`<lg`, alt-çubuk) [TDN] §2.1.5 ile DEĞİŞMEDİ.

---

## 2. Kimlik Bilgileri adımı (modal)

[DPI] §2.6: bu adım `POST /appointments/bookings` gövdesinin İÇİNDE, slot seçiminden SONRA,
Stripe Checkout'tan ÖNCE **zorunlu** bir modal olarak devreye girer (booking akışı [TDN] §12'nin
adımlarına EKLENİR — ayrı bir sayfa/rota DEĞİL, mevcut booking formunun bir dialog adımıdır).

### 2.1 Dialog iskeleti

```
<Dialog open={identityStepOpen} onOpenChange={...}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>Kimlik Bilgileri</DialogTitle>
      <DialogDescription>{/* compliance-agent metni, [DPI] §0 madde (a) — consentVersion'a bağlı */}</DialogDescription>
    </DialogHeader>

    <Tabs value={citizenshipType} onValueChange={setCitizenshipType}>
      <TabsList className="w-full">
        <TabsTrigger value="TR" className="flex-1">T.C. Vatandaşı</TabsTrigger>
        <TabsTrigger value="FOREIGN" className="flex-1">Yabancı Uyruklu</TabsTrigger>
      </TabsList>
      <TabsContent value="TR" className="mt-4 space-y-4">{/* §2.3 */}</TabsContent>
      <TabsContent value="FOREIGN" className="mt-4 space-y-4">{/* §2.4 */}</TabsContent>
    </Tabs>

    {/* §2.5 doğum tarihi + KVKK + Devam Et — HER İKİ sekme için ORTAK, Tabs'ın DIŞINDA */}
  </DialogContent>
</Dialog>
```

**Başlık DAİMA "Kimlik Bilgileri"** ([DPI] §2.5, ENGELLEYİCİ) — `DialogTitle` metni bu, hiçbir
koşulda "Kimlik Doğrulama"/"Kimlik Doğrulaması" DEĞİL.

**`Tabs` primitifinin segmented-control olarak yeniden kullanımı — YENİ bileşen İCAT EDİLMEZ:**
"T.C. Vatandaşı"/"Yabancı Uyruklu" seçimi altındaki İÇERİK GERÇEKTEN değişiyor (TCKN alanı ↔
ülke+pasaport alanları) — bu, `Tabs`'ın `variant="default"` (pill/segmented, [TDN]'nin
`TabsList`'in varsayılan `bg-muted p-[3px]` + aktifte `bg-background shadow-sm` stilini
KULLANIR — §1.3'ün `variant="line"` kararından KASITLI FARKLI: orada içerik-gezinme, burada
ikili bir VERİ SEÇİMİ/segmented control; iki farklı `Tabs` kullanım bağlamı görsel olarak da
AYRIŞMALI) semantiğiyle BİREBİR örtüşüyor — ikinci bir "radio card"/"segmented control"
bileşeni İCAT ETMEK yerine ZATEN kurulu `Tabs` primitifi bu amaçla YENİDEN KULLANILIR.
`className="flex-1"` her iki `TabsTrigger`'ın EŞİT genişlikte olmasını sağlar (varsayılan
`w-fit` davranışının ÜZERİNE, segmented control'ün "iki eşit yarı" görünümü için).

### 2.2 T.C. formu (`TabsContent value="TR"`)

```
<Field id="identityNumber" label="T.C. Kimlik Numarası" required error={fieldError}>
  {(inputProps) => (
    <div className="relative">
      <Input
        {...inputProps}
        inputMode="numeric"
        autoComplete="off"
        maxLength={11}
        placeholder="11 haneli kimlik numaranız"
        value={value}
        onChange={onChange}
        className={cn(
          "pr-28",
          status === "valid" && "border-success focus-visible:ring-success/30",
          status === "invalid" && "border-danger focus-visible:ring-danger/30"
        )}
      />
      {status !== "idle" && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2">
          {status === "valid" ? (
            <Badge tone="success" solid size="sm" className="gap-1">
              <CircleCheck className="h-3 w-3" aria-hidden="true" />
              Geçerli
            </Badge>
          ) : (
            <Badge tone="danger" solid size="sm" className="gap-1">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              Geçersiz
            </Badge>
          )}
        </span>
      )}
    </div>
  )}
</Field>
```

- **`autoComplete="off"` + `inputMode="numeric"`** — [DPI] §6 madde 4, ENGELLEYİCİ; kimlik
  numarası tarayıcı otomatik-doldurma/otomatik-kayıt geçmişine ASLA düşmez.
  `maxLength={11}` — kullanıcı 11 haneden fazla giremez (istemci tarafı bir ön kısıt, sunucu
  zaten `^\d{11}$` ile doğrular, [DPI] §2.4).
- **Durum rozeti YALNIZCA tam 11 hane girildiğinde belirir** (`status === "idle"` iken hiçbir
  rozet YOK — [TDN]'nin "eksik/anlamsız bilgiyle erken uyarma" karşıtı ilkesiyle tutarlı,
  kullanıcı daha yazarken "geçersiz" göstermek gürültü yaratır). Algoritma
  (`isValidTurkishIdentityNumber`, [DPI] §2.4 — repdigit reddi dahil) [DPI] §6 madde 4'ün
  "sunucu yardımcısının BİREBİR istemci kopyası" kararı gereği frontend-agent tarafından
  KOPYALANIR; bu doküman yalnızca SONUCUN GÖRSELİNİ tarif eder.
- **Rozet renkleri** `success`/`danger` (kök token) — [TDN]'nin ZATEN kurulu `Badge tone`
  sistemi, YENİ bir "doğrulama rengi" İCAT EDİLMEZ. `border-success`/`border-danger` input
  kenarlığı — [TDN]'de İLK KEZ bir `Input`'un kenarlığı durum rengine bağlanıyor, ama bu YENİ
  bir renk DEĞİL, ZATEN var olan `--success`/`--danger` token'larının bir `Input`'a
  UYGULANMASI (Badge'in dışında bir bileşene ilk uygulanışı, renk İCADI değil).

### 2.3 Yabancı formu (`TabsContent value="FOREIGN"`)

```
<Field id="identityCountryCode" label="Uyruk Ülkesi" required error={countryError}>
  {(inputProps) => (
    <Select {...inputProps} value={countryCode} onChange={onCountryChange}>
      <option value="" disabled>Ülke seçin</option>
      {COUNTRIES_EXCLUDING_TR.map((c) => (
        <option key={c.code} value={c.code}>{c.nameTr}</option>
      ))}
    </Select>
  )}
</Field>

<Field id="passportNumber" label="Pasaport Numarası" required error={passportError}>
  {(inputProps) => (
    <div className="relative">
      <Input
        {...inputProps}
        autoComplete="off"
        maxLength={20}
        placeholder="Pasaport numaranız"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className={cn("pr-28", status === "valid" && "border-success", status === "invalid" && "border-danger")}
      />
      {/* AYNI Geçerli/Geçersiz rozet deseni, §2.2 İLE BİREBİR AYNI */}
    </div>
  )}
</Field>
```

- **Ülke seçici — mevcut `@/components/ui/select` (native `<select>` sarmalayıcı, projede
  aranabilir/combobox bir ülke seçici YOK) kullanılır** — YENİ bir combobox/command-palette
  kütüphanesi İCAT EDİLMEZ ([DPI] §9 madde 9'un ruhu, "yeni npm bağımlılığı EKLENMEZ" —
  ui-designer bu kararı ÖNCEDEN alarak frontend-agent'ı aynı sonuca yönlendirir). Native
  `<select>` kendi klavye-tipe-atla davranışını taşır, ~195 ülkelik bir liste için yeterlidir.
  **`TR` listeden HARİÇ TUTULUR** ([DPI] §2.4 — `countryCode` `"TR"` OLAMAZ).
- **Pasaport girişi otomatik BÜYÜK HARFE çevrilir** (`onChange` içinde `.toUpperCase()`) — [DPI]
  §2.4 normalize kuralı ("boşluk/tire temizlenip BÜYÜK harfe çevrilir") istemci tarafında ANLIK
  geri bildirim için taklit edilir, sunucu asıldır.
- **Geçerli/Geçersiz rozeti** §2.2 İLE BİREBİR AYNI görsel dil (`^[A-Z0-9]{6,20}$` format
  kontrolü, sağlama algoritması YOK — [DPI] §2.4) — İKİNCİ bir doğrulama-rozeti dili İCAT
  EDİLMEZ, tek bir "format geçerli/geçersiz" görsel sözlüğü her iki formda da kullanılır.

### 2.4 Doğum tarihi — gün/ay/yıl `Select` üçlüsü (HER İKİ sekme için ORTAK)

Projede özel bir tarih seçici (date-picker) kütüphanesi YOK ([DPI] görev tanımı "proje hangi
date picker'ı kullanıyor kontrol et" diyordu — kontrol edildi, YOK) — bu yüzden YENİ bir
bağımlılık İCAT ETMEK yerine mevcut `Select` (native) primitifinden ÜÇ ayrı alan kurulur:

```
<Field id="birthDate" label="Doğum Tarihi" required error={birthDateError}>
  {() => (
    <div className="grid grid-cols-3 gap-2">
      <Select aria-label="Gün" value={day} onChange={onDayChange}>
        <option value="" disabled>Gün</option>
        {DAYS_1_31.map((d) => <option key={d} value={d}>{d}</option>)}
      </Select>
      <Select aria-label="Ay" value={month} onChange={onMonthChange}>
        <option value="" disabled>Ay</option>
        {TR_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </Select>
      <Select aria-label="Yıl" value={year} onChange={onYearChange}>
        <option value="" disabled>Yıl</option>
        {YEARS_DESC_FROM_18_TO_120.map((y) => <option key={y} value={y}>{y}</option>)}
      </Select>
    </div>
  )}
</Field>
```

- **Yıl aralığı istemcide `(currentYear - 18)`'den `(currentYear - 120)`'ye AZALAN sırayla
  sınırlanır** — bu, [DPI] §2.4'ün "yaş < 18 → `422`" ve "yaş ≤ 120" kurallarının bir UX
  ÖN-FİLTRESİDİR (kullanıcı zaten geçersiz bir yıl SEÇEMEZ), **sunucu doğrulaması ASILDIR**
  ([DPI] §2.5'in "algoritmik format denetimi, gerçek doğrulama DEĞİL" ruhuyla tutarlı — bu
  liste kısıtı da bir "doğrulama" değil, yalnızca anlamsız seçenekleri gizleyen bir kolaylıktır).
- **Üç ayrı native `<select>`** — tek bir `<input type="date">`'in tarayıcılar arası tutarsız
  yerelleştirme/format sorunlarından KAÇINIR (bu proje `tr-TR` sabit locale kullanıyor, [TDN]
  §2.3'ün `Intl.DateTimeFormat("tr-TR", ...)` kararıyla AYNI disiplin) ve YENİ bir paket
  İCAT ETMEDEN öngörülebilir bir UI verir.
- **Sunucuya gönderim** DAİMA [DPI] §2.4'ün `new Date("<YYYY-MM-DD>T00:00:00.000Z")` /
  `.toISOString().slice(0,10)` kuralına göre BİRLEŞTİRİLİR — bu bir görsel karar DEĞİL,
  frontend-agent implementasyon detayıdır, burada yalnızca ÜÇ AYRI SEÇİCİNİN doğru sıraya
  (gün/ay/yıl, Türkiye konvansiyonu) dizilmesi bağlayıcıdır.
- **18 yaş altı istemci ön-kontrolü:** hesaplanan yaş < 18 ise, `Field`'ın `error` sloту
  DOLDURULUR — `text-danger` metni: *"Bu platform 18 yaşından küçük kullanıcılar için
  kullanılamaz."* (nihai metin compliance-agent/documentation-agent'ın onayına tabi, [DPI] §0
  madde (b)) — "Devam Et" butonu bu durumda **disabled** kalır (§2.6).

### 2.5 KVKK onayı + "Devam Et"

```
<div className="mt-6 flex items-start gap-2">
  <Checkbox id="identityConsent" checked={consent} onCheckedChange={setConsent} className="mt-0.5" />
  <label htmlFor="identityConsent" className="text-xs leading-5 text-foreground/70">
    {/* compliance-agent metni — [DPI] §0 madde (a), YENİ consentVersion'a bağlı, "kimlik
       doğrulama" ifadesi İÇERMEZ ([DPI] §2.5) */}
  </label>
</div>

<Button size="lg" className="mt-4 w-full rounded-[var(--site-radius)]" disabled={!canContinue} loading={submitting}>
  Devam Et
</Button>
```

**`canContinue` koşulu (frontend-agent implementasyon detayı, burada GÖRSEL/DAVRANIŞSAL
sözleşme olarak bağlayıcı):** `citizenshipType` seçilmiş **VE** (TR ise TCKN `status==="valid"`;
FOREIGN ise `countryCode` seçilmiş + pasaport formatı `status==="valid"`) **VE** doğum tarihinin
üç alanı da dolu **VE** yaş ≥ 18 **VE** `consent === true`. Herhangi biri eksikse buton
`disabled` (mevcut `Button` bileşeninin varsayılan `disabled:opacity-50` davranışı, YENİ bir
disabled stili İCAT EDİLMEZ) — kullanıcıya "hangi alan eksik" **rozet/hata mesajları zaten
kendi alanlarında görünür** (§2.2-§2.4), butonun kendisi ikinci bir "eksik alanlar" özeti İCAT
ETMEZ.

### 2.6 Sunucu reddi (`422`) ve düzeltme penceresi (`409`) — görsel karşılıklar

- **`422` (geçersiz kimlik/yaş, [DPI] §2.6):** modal AÇIK KALIR, ilgili `Field`'ın `error`
  slotu sunucu mesajıyla DOLDURULUR (§2.2/§2.3/§2.4'ün İSTEMCİ ön-kontrolüyle AYNI görsel
  dil — `text-xs text-danger`), "Devam Et" tekrar `disabled` OLMAZ (kullanıcı düzeltip tekrar
  deneyebilmeli). **Hiçbir slot tutulmaz** — bu bir backend/state kararıdır, UI yalnızca hatayı
  gösterir.
- **`409 IDENTITY_LOCKED`** ([DPI] §2.6, `PUT .../identity` düzeltme penceresi — booking
  ÖDENMİŞSE): bu modal artık AÇILAMAZ/düzenlenemez hâle gelmelidir — booking yönetim ekranında
  ([TDN] §12.5) ilgili satırda kimlik alanı **salt-okunur** görünür, herhangi bir "Düzenle"
  aksiyonu RENDER EDİLMEZ (§2.5'in "Devam Et"i gibi bir CTA burada YOKTUR — kilitli bir kayıt
  için aksiyon İCAT EDİLMEZ).

---

## 3. Doktor konsolu (`/doctor`)

Mevcut `DoctorPortalShell` ([TDN] §12.6 — admin panel DEĞİL, kamu sitesinin `.site-scope`
teması, sade üst çubuk, sidebar YOK) **DEĞİŞMEDİ**. Bu bölüm `DoctorPortalShell`'in İÇİNDEKİ
sayfa içeriğini ("Randevularım" tek panelden bir KONSOLA) genişletir.

### 3.1 Sayfa iskeleti

```
<DoctorPortalShell>
  <div className="space-y-8">
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* §3.2 — 4 metrik kartı */}
    </section>

    <Tabs value={scope} onValueChange={setScope}>
      <TabsList>
        <TabsTrigger value="all">Tümü</TabsTrigger>
        <TabsTrigger value="today">Bugün</TabsTrigger>
        <TabsTrigger value="upcoming">Gelecek Randevular</TabsTrigger>
        <TabsTrigger value="completed">Tamamlananlar</TabsTrigger>
      </TabsList>
    </Tabs>

    {/* §3.4 — hasta kartı listesi, [TDN] §12.5'in kart/tablo iskeletinin GENİŞLETİLMİŞ hali */}
  </div>
</DoctorPortalShell>
```

`TabsList`'in `variant="default"` (pill, VARSAYILAN) kullanılması — §1.3'ün `variant="line"`
kararından KASITLI FARKLI: bu bir İÇERİK-GEZİNME değil bir VERİ FİLTRESİDİR (§2.1'in segmented
control kararıyla AYNI aile) — `value` **BİREBİR** [DPI] §3.2'nin `scope` (`all|today|upcoming|
completed`) parametresine eşlenir, ikinci bir eşleme/relabeling KATMANI İCAT EDİLMEZ.

### 3.2 Dört metrik kartı

[TDN] §13.5.1'in kararı ("admin `StatCard` KULLANILMAZ — glow/`--foreground` ihlali") **BURADA
DA GEÇERLİDİR** — aynı taban tekrar kullanılır:

```
<div className="rounded-[var(--site-radius)] border border-border bg-surface p-5">
  <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-2 text-sm text-foreground/60">
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </div>
    {tooltip && (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-foreground/30 hover:text-foreground/50">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
      </Tooltip>
    )}
  </div>
  <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
  {sublabel && <p className="mt-1 text-xs text-foreground/50">{sublabel}</p>}
</div>
```

| Kart | `label` | İkon | Gerekçe/bilinçli tekrar |
|---|---|---|---|
| Bugünkü Seanslar | "Bugünkü Seanslar" | `CalendarClock` | [TDN] §13.1 `SCHEDULED` rozetiyle AYNI ikon |
| Tamamlanan Konsültasyonlar | "Tamamlanan Konsültasyonlar" | `CircleCheck` | [TDN] §13.1 `COMPLETED` rozeti/§12.4 `PAID` rozetiyle AYNI ikon |
| Toplam Hasta | "Toplam Hasta" | `Users` | [TDN]'de henüz "kişi grubu" anlamında kullanılmamış, ilk kullanım — `User` (tekil) ile KARIŞTIRILMAZ |
| Bekleyen Tıbbi Belgeler | "Bekleyen Tıbbi Belgeler" | `Paperclip` | [TDN] §12.5/§13.2'nin "belge" ikonuyla AYNI — proje genelinde belge kavramı TEK ikonla anlatılır |

**"Bekleyen Tıbbi Belgeler" kartının `tooltip`'i — [DPI] §3.1 ZORUNLU kılıyor:**
> *"Bu sayı bir tıbbi inceleme onayı DEĞİLDİR; yalnızca belge yüklenmiş ama seansı henüz
> tamamlanmamış randevu sayısını gösterir."*
(Metin bu dokümanın ÖNERİSİdir — nihai kelimeler documentation-agent/compliance-agent'ın
gözden geçirmesine tabi, ama İÇERİK — "bu bir inceleme/onay DEĞİL" — [DPI] §3.1'in KENDİSİ
gereği DEĞİŞTİRİLEMEZ.) `Info` ikonu (`h-3.5 w-3.5`, [TDN]'de İLK KEZ kullanılan "ek bilgi"
ikonu — `AlertCircle`/`AlertTriangle` ile KARIŞTIRILMAZ, çünkü bu bir HATA/UYARI değil, bir
TANIM netleştirmesidir) `Tooltip` (`@/components/ui/tooltip`, [TDN] §12.2.2/§12.5.3 ile AYNI
paylaşılan primitif) tetikler. **DİĞER ÜÇ kartta `tooltip` YOKTUR** — yalnızca bu kartın anlamı
yanlış anlaşılmaya AÇIK olduğu için ([DPI]'nin kendi gerekçesi), diğerleri kendini açıklar
(sahte/gereksiz bir tooltip enflasyonu İCAT EDİLMEZ).

`generatedAt` ([DPI] §3.1, sunucu saati) — bu kartların ALTINDA/yanında bir "son güncelleme"
notu İCAT ETMEYE GEREK YOK (kartlar sayfa yüklendiğinde bir kerelik render edilir); ancak
§3.4'ün "kalan süre" rozetleri bu `generatedAt`'e göre kalibre edilir ([DPI]'nin zaten
belirttiği gibi) — bu bir GÖRSEL karar değil, frontend-agent'ın hesap disiplinidir.

### 3.3 Durum filtre sekmeleri — §3.1'de tanımlandı, tekrar burada YOK

(Bkz. §3.1 — `Tabs variant="default"`, `scope` parametresine BİREBİR bağlı.)

### 3.4 Hasta kartı anatomisi

[TDN] §12.5.1/§12.5.2'nin (mobil kart / masaüstü tablo) mevcut iskeleti **KORUNUR** — bu bölüm
o iskelete YENİ satırlar/rozetler EKLER, tabloyu/kartı YENİDEN İCAT ETMEZ.

#### 3.4.1 Üst satır — hasta adı + yaklaşık yaş

```
<div className="flex items-baseline gap-1.5">
  <p className="truncate text-sm font-semibold text-foreground">{patientName}</p>
  {approxAge != null && (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0 text-xs text-foreground/50">~{approxAge} yaş</span>
      </TooltipTrigger>
      <TooltipContent>Yalnızca doğum yılından hesaplanan yaklaşık yaş</TooltipContent>
    </Tooltip>
  )}
</div>
```

**KRİTİK veri kısıtı ([DPI] §2.7, BAĞLAYICI — bu bölümün gerekçesi):** liste/detay DTO'sundaki
`identity` nesnesi yalnızca **doğum YILINI** taşır, tam doğum tarihini ASLA. Bu yüzden bu kart
**tam yaş DEĞİL, `currentYear - birthYear`'dan türeyen ± 1 yıllık bir YAKLAŞIK yaş** gösterir —
`~` öneki bunu görsel olarak işaretler, `Tooltip` bunu AÇIKÇA yazar. **Tam doğum tarihi/tam
yaş bu kartta HİÇBİR ZAMAN gösterilmez** — doktor tam değeri görmek isterse [DPI] §2.7'nin ayrı,
audit-loglu `GET .../identity` ucunu AÇIKÇA tetiklemesi gerekir (bu turda konsol kartında böyle
bir "Tam bilgiyi göster" aksiyonu İSTENMEDİ — bu doküman İCAT ETMEZ; ileride gerekirse [TDN]
§13.3.2'nin "varsayılan gizli, `Görüntüle` butonuyla açılır" desenine BİREBİR uyulmalıdır).
`identityCapturedAt`/`citizenshipType` yoksa (eski `POST /appointments` kaydı, §3.4.2) bu
satır HİÇ render edilmez.

#### 3.4.2 Maskeli kimlik rozeti / boş-durum rozeti — NET görsel ayrım ([DPI] §6 madde 3 ZORUNLU kılıyor)

```
{booking.identity?.maskedNumber ? (
  <Badge tone="neutral" size="sm" className="gap-1 font-mono tabular-nums">
    <IdCard className="h-3 w-3" aria-hidden="true" />
    {booking.identity.maskedNumber}
  </Badge>
) : (
  <span className="inline-flex items-center gap-1.5 rounded-[var(--site-radius)] border border-dashed border-border/70 px-2 py-1 text-xs text-foreground/40">
    <Ban className="h-3 w-3" aria-hidden="true" />
    Kimlik bilgisi alınmadı
  </span>
)}
```

| Durum | Görsel | Gerekçe |
|---|---|---|
| **Kimlik VAR** (`identity.maskedNumber` dolu) | `Badge tone="neutral" size="sm"` (soft, opak KENARLIK+dolgu) + `IdCard` ikonu + `font-mono tabular-nums` maskeli numara | Gerçek, yapılandırılmış bir VERİ satırı — [TDN]'nin ZATEN kurulu `Badge` diliyle tutarlı bir "veri rozeti" |
| **Kimlik YOK** (eski `POST /appointments` kaydı, `identity: null`) | DÜZ (Badge DEĞİL) kesikli-kenarlıklı (`border-dashed`) soluk çip + `Ban` ikonu + "Kimlik bilgisi alınmadı" metni | **BİLİNÇLİ OLARAK `Badge` bileşeni KULLANILMAZ** — bu bir "durum" değil bir YOKLUKTUR; [TDN] §12.3.2'nin boş-uploader kesikli-kenarlık dilini (`border-dashed`, "buraya veri yok/bekleniyor" çağrışımı) ve §12.4 `EXPIRED`'ın `Ban` ikonunu (nötr, "geçersiz DEĞİL, uygulanamaz" anlamı, bilinçli tekrar) ÖDÜNÇ alır — kalın/dolgulu bir `Badge` kullanmak bunu YANLIŞLIKLA bir "durum bildirimi" (ör. bir uyarı/hata) gibi gösterirdi, oysa bu yalnızca ESKİ bir akıştan kalan, beklenen bir boşluktur |

**`IdCard` ikonu** — bu dokümanda ilk kullanım, "kimlik kartı/kaydı" kavramını doğrudan taşır,
[TDN] §12.3'ün dosya ikonlarıyla (`FileText`/`FileImage`) KARIŞTIRILMAZ (biri kimlik verisi,
diğeri yüklenen belge). **Renk KODLAMASI kullanılmaz** (ikisi de nötr/soluk tonlarda) — bu bir
"iyi/kötü" ayrımı DEĞİL, "veri var/veri yapısal olarak hiç toplanmamış" ayrımıdır; [DPI] §2.5'in
"doğrulama değil, format denetimi" ilkesiyle aynı ölçülülükte, kimlik VARLIĞI da bir başarı/
güven sinyali olarak ABARTILMAZ (`success` tonu KULLANILMAZ).

#### 3.4.3 Kalan süre rozeti — yakın/şimdi/geçti renk kodlaması

`generatedAt` (§3.2) + `joinableFrom`/`joinableUntil` ([DPI] §3.3, mevcut alanlar) üzerinden
DÖRT kademeli, TAMAMI [TDN]'nin ZATEN kurduğu rozet/ikon dilinden ÖDÜNÇ alınan bir gösterge:

| Kademe | Koşul | Görsel |
|---|---|---|
| **Uzak** | `now < joinableFrom - 15dk` | Düz metin, rozet YOK: `text-xs text-foreground/60` — *"Yarın 14:00"* / *"3 saat sonra"* ([TDN] §7'nin "Uzak" kademesiyle AYNI ilke: her satırı rozetle doldurmak gürültü yaratır) |
| **Yakın** | `joinableFrom - 15dk ≤ now < joinableFrom` | `Badge tone="warning" solid size="sm"` + `Clock` — *"15 dk içinde"* (dinamik geri sayım metni) |
| **Şimdi** | `joinableFrom ≤ now ≤ joinableUntil` | `Badge tone="primary" solid size="sm"` + `Video` — *"Şimdi"* — [TDN] §13.1 `IN_PROGRESS` rozetiyle **BİREBİR AYNI** ikon/ton (bilinçli tekrar: "bu görüşme şu an aktif/katılınabilir" anlamı proje genelinde TEK bir görsel dille anlatılır) |
| **Geçti** | `now > joinableUntil`, randevu HÂLÂ `SCHEDULED` | `Badge tone="neutral" size="sm"` (soft) + `Ban` — *"Süresi Geçti"* — [TDN] §12.4 `EXPIRED` ile AYNI ton/ikon (bilinçli tekrar: "bu bir hata değil, pencere kapandı" anlamı) |

Randevu zaten `COMPLETED`/`CANCELLED`/`NO_SHOW` ise bu rozet **HİÇ render edilmez** — onun
yerine [TDN] §13.1'in `AppointmentStatusBadge`'i ZATEN görünür durumdadır, İKİ rozeti (kalan
süre + durum) aynı satırda göstermek ÇAKIŞIR/gereksiz tekrar yaratırdı (§13.4.1'in "Aksiyon
sütunu" kuralındaki AYNI "tek satırda tek anlam taşıyan rozet" ilkesi).

#### 3.4.4 Aksiyon üçlüsü — "Tıbbi Belgeler", "Konsültasyon Notu Ekle", "Görüşmeye Katıl"

```
<div className="flex flex-wrap items-center gap-2">
  {(documentCount > 0 || hasIntakeNote) && (/* [TDN] §13.2 "Tıbbi Belgeler (N)" rozeti/buton — BİREBİR AYNI, DEĞİŞMEDİ */)}

  <Button variant="outline" size="sm" onClick={() => openNoteEditor(booking.id)} className="gap-1.5 rounded-[var(--site-radius)]">
    <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
    Konsültasyon Notu Ekle
  </Button>

  {/* [TDN] §12.5.3 JoinMeetingButton — BİREBİR AYNI, DEĞİŞMEDİ */}
</div>
```

- **"Tıbbi Belgeler" ve "Görüşmeye Katıl"** — [TDN] §13.2/§12.5.3'ten **HİÇBİR DEĞİŞİKLİK
  OLMADAN** aynen taşınır; bu doküman onları TEKRAR TASARLAMAZ.
- **"Konsültasyon Notu Ekle" — YENİ, ama YENİ bir zengin-metin editörü İCAT ETMEZ:** proje
  ZATEN bir Tiptap tabanlı editör taşıyor
  (`frontend/src/components/site/telehealth/consultation-note-editor.tsx`,
  `ConsultationNoteEditor`) — bu buton O BİLEŞENİ bir `Dialog` (`max-w-2xl`, [TDN] §12.5.4'ün
  belge-listesi dialog'undan bir kademe geniş, çünkü bir zengin-metin editörü barındırır)
  İÇİNDE açar. **Bu karar [TDN] §13.4.2'nin epikriz alanı için önerdiği DÜZ `Textarea`'yı
  SUPERSEDE EDER** — [DPI] §3.3'ün "Tiptap tabanlı" AÇIK talimatı ve projede ZATEN VAR OLAN
  editör bileşeni birleşince, `Textarea` yerine bu editörü kullanmak "ikinci bir not-yazma
  dili İCAT ETME" ilkesinin doğal sonucudur — **"Seansı Tamamla" mini-modalındaki
  ([TDN] §13.4.2) epikriz alanı da BUNDAN SONRA AYNI `ConsultationNoteEditor`'ı kullanmalıdır**
  (iki farklı not-yazma yüzeyi/iki farklı bileşen İSTENMEZ; ikisi de AYNI
  `POST /appointments/{id}/complete` (yazma) + `GET .../consultation-note` (okuma) uçlarına
  bağlanır, [DPI] §3.3).
  `NotebookPen` ikonu — bu dokümanda ilk kullanım, "not yazma" eylemini doğrudan taşır,
  [TDN] §13.3.2'nin `StickyNote` (hasta notu, OKUMA amaçlı, farklı ikon) ile KARIŞTIRILMAZ.
  `Button variant="outline" size="sm"` — [TDN] §12.5'in ikincil aksiyon boyut/varyantıyla AYNI
  (bu, "Seansı Tamamla"nın `variant="success"` birincil onay ağırlığından KASITLI daha düşük —
  not eklemek geri alınabilir bir düzenleme eylemidir, seansı kapatmak DEĞİLDİR).
- **"Görüşmeye Katıl" yalnızca seans vakti geldiğinde AKTİF/VURGULU** — bu davranış [TDN]
  §12.5.3'ün `disabled`/`Tooltip` mekanizmasıyla ZATEN sağlanıyor, BURADA TEKRAR TANIMLANMAZ;
  §3.4.3'ün "Şimdi" rozeti (primary/solid) ile bu butonun `disabled=false` durumu AYNI ANDA
  gerçekleşir (ikisi AYNI `joinableFrom`/`joinableUntil` pencerisini okur) — bu bilinçli bir
  TUTARLILIK, iki ayrı hesaplama mantığı İCAT EDİLMEZ.

---

## Özet — Uygulanacak Somut Değerler

| Öğe | Değer |
|---|---|
| Koyu lacivert başlık zemini | `secondaryColor` (`#0F172A`, ZATEN kurulu token), edge-to-edge, içerik `max-w-5xl` |
| Başlık üzerinde metin | `text-white` (17.85:1) / `text-white/70` (~9.11:1) — teal DÜZ METİN olarak YASAK (3.26:1, FAIL) |
| Koyu-zemin çip tabanı (YENİ) | `border border-white/20 bg-white/10 text-white/90 rounded-full` — blur YOK, [TDN] §0 ihlal edilmedi |
| Hero avatar (başlık içinde) | [TDN] §2.1.2 İLE AYNI (`h-28/36 rounded-[var(--site-radius)]` yumuşak kare, monogram gradyanı DEĞİŞMEDİ), EK `ring-1 ring-white/15` |
| Doğrulama/uzmanlık chip'i (başlıkta) | `Badge tone="primary" solid size="lg"` (opak, zeminden bağımsız 5.48:1) |
| Deneyim rozeti | `Badge tone="primary" solid size="sm"` + `Briefcase` ("X Yıl Deneyim", DTO'da türetilir) |
| "En yakın randevu" çipi | Koyu-zemin çip tabanı + `CalendarClock`, YALNIZCA veri varsa |
| Dil rozetleri (başlıkta) | Koyu-zemin çip tabanı (açık-zemin `variant="outline"` YERİNE) |
| İletişim/e-posta | `mailto:` + `Mail` ikonu, `text-white/70`, YALNIZCA veri varsa |
| Sayfa iskeleti (başlık altı) | [TDN] §2.1.1 İLE BİREBİR AYNI `grid-cols-[1fr_320px]`, sticky panel DEĞİŞMEDİ |
| Sekmeler (Hakkında/Özgeçmiş/Yayınlar) | `Tabs variant="line"`, tek URL, boş-durum notu `FileQuestion` |
| Özgeçmiş (cvEntries) | Dikey zaman çizelgesi, DOKTOR SIRASI korunur, `kind`→ikon: `GraduationCap`/`Briefcase`/`Award`/`Users`/`Trophy` |
| Bilimsel Yayınlar (publications) | `kind`'a göre GRUPLANMIŞ liste, sabit grup sırası, boş grup render edilmez |
| Sticky randevu kutusu | [TDN] §2.1.4/§2.4/§12.2-§12.5 DEĞİŞMEDİ |
| Kimlik Bilgileri modalı başlığı | **"Kimlik Bilgileri"** (ENGELLEYİCİ, "Kimlik Doğrulama" YASAK) |
| Vatandaşlık seçimi | `Tabs variant="default"` (segmented control olarak yeniden kullanım), `flex-1` eşit genişlik |
| TCKN/pasaport format rozeti | `Badge tone="success"/"danger" solid size="sm"` + `CircleCheck`/`AlertCircle`, YALNIZCA tam uzunlukta belirir |
| Doğum tarihi | 3× native `Select` (gün/ay/yıl), yıl aralığı istemcide 18-120 yaşla sınırlı (UX ön-filtre, sunucu asıl) |
| KVKK onayı | `Checkbox` + metin (compliance-agent), "Devam Et" tüm alanlar geçerli+onay işaretli olana kadar `disabled` |
| Doktor konsolu metrik kartı | [TDN] §13.5.1 İLE AYNI taban (admin `StatCard` KULLANILMAZ), `text-2xl font-semibold` değer |
| 4 metrik ikonu | `CalendarClock` / `CircleCheck` / `Users` / `Paperclip` |
| "Bekleyen Tıbbi Belgeler" tooltip | `Info` ikonu + "bu bir tıbbi inceleme onayı DEĞİLDİR" metni (ZORUNLU, [DPI] §3.1) |
| Durum filtre sekmeleri | `Tabs variant="default"`, `scope` parametresine BİREBİR bağlı (`all/today/upcoming/completed`) |
| Yaklaşık yaş | `~{yıl farkı} yaş` + `Tooltip` "yalnızca doğum yılından" — TAM doğum tarihi listede YOK ([DPI] §2.7) |
| Kimlik VAR rozeti | `Badge tone="neutral" size="sm"` + `IdCard` + maskeli numara (`font-mono tabular-nums`) |
| Kimlik YOK boş-durumu | `Badge` DEĞİL — kesikli kenarlık (`border-dashed`) + `Ban` + "Kimlik bilgisi alınmadı" |
| Kalan süre rozeti | Uzak: düz metin / Yakın: `warning solid + Clock` / Şimdi: `primary solid + Video` / Geçti: `neutral soft + Ban` |
| "Konsültasyon Notu Ekle" | Mevcut `ConsultationNoteEditor` (Tiptap) `Dialog max-w-2xl` içinde açılır — [TDN] §13.4.2'nin düz `Textarea`'sını SUPERSEDE eder |

---

**Kapsam dışı (bilinçli, başka ajanların alanı):** kimlik şifreleme/hash/yetki mantığı
(backend-agent/security-agent, [DPI] §2.3/§2.7), KVKK/consentVersion metni (compliance-agent,
[DPI] §0), `experienceYears`/`nextAvailableSlot` gibi alanların DTO şekli (architect/
backend-agent), `POST /appointments/{id}/complete`'e `note` alanı eklenmesi ([TDN] §13.4.4'ün
AÇIK bağımlılığı, DEĞİŞMEDİ), meta/structured data (seo-agent, [DPI] §6 madde 5), e-posta/
bildirim şablonları (notification-agent, [DPI] §6 madde 6).
