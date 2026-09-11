# architect-scope: `telehealth-clinic` — "Global TeleHealth / Online Clinic" demo şablonu + `telehealth` modülü

**Durum:** BAĞLAYICI karar dokümanı. `docs/architecture/openapi.yaml` ile birlikte TEK doğruluk
kaynağıdır; çelişkide **openapi.yaml kazanır** (`.claude/CLAUDE.md` "Çakışma Çözümü").

**Üst dokümanlar:**
- `.claude/architect-scope-demo-template-import.md` → bundan sonra **[DTI]**
- `.claude/architect-scope-ecommerce-pro-template.md` → bundan sonra **[EPT]**

Bu doküman ikisini de **DEĞİŞTİRMEZ, GENİŞLETİR.** [DTI]'nin tüm kararları (iki fazlı importer,
`asset:`/`ref:` token'ları, idempotency/`force`/`confirm`, ADMIN-only yazma, hız sınırı,
telafi/rollback, PNG varlık politikası, SVG reddi, "yeni blok tipi YOK", telif/PII kuralları)
ve [EPT]'nin "storefront geliştirmesi ≠ şablon" sınırı **aynen geçerlidir.** [DTI]/[EPT]'ye
getirilen resmi tadilatlar **yalnızca §9.6'da, tek listede** toplanmıştır.

**Branş:** `feature/telehealth-clinic-template`.
**Orkestratöre not:** şu an `feature/central-tax-rates` üzerindeyiz; ilk ajan (db-agent) işe
başlamadan ÖNCE `master`'dan yeni branş açılmalıdır. Branş açma/geçiş architect'in işi değildir.

---

## 0. Bir cümlede karar

Bu iş **iki ayrı iştir ve karıştırılmamalıdır:** **(A)** platformun KALICI bir yetenek
genişlemesi olan **`telehealth` modülü** — `Specialty` / `DoctorProfile` /
`DoctorAvailability` / `Appointment` tabloları, slot üretimi, randevu alma akışı ve LiveKit
tabanlı konsültasyon odası; **(B)** bu yetenekleri **sergileyen** üçüncü demo şablonu
(`telehealth-clinic`) — mevcut `demo-templates` altyapısına yalnızca **veri** ekleyen bir
`templates/telehealth-clinic.ts` dosyası. (A) olmadan (B) anlamsızdır; (B), (A)'nın üzerine
hiçbir yeni altyapı KOYMAZ. **Örnek/sahte randevular KAPSAM DIŞIDIR (§3.6)** ve **`MeetingRoom`
tablosu AÇILMAZ (§3.5)**.

---

## 1. KARAR A — Şablon taşıyıcısı: `.json` REDDEDİLDİ, `.ts` ZORUNLU

Kullanıcı `templates/telehealth-clinic.json` istedi. **REDDEDİLDİ.** Şablon
`backend/src/modules/demo-templates/templates/telehealth-clinic.ts` olacaktır.

Bu yeni bir karar DEĞİL, [DTI] §2'nin **zaten bağlayıcı** olan kararının üçüncü şablona
uygulanmasıdır. Gerekçeler kod tabanında bugün de doğrulanabilir durumdadır:

1. **Emsal:** bu depodaki TÜM statik registry'ler TS modülüdür (`MODULE_REGISTRY`,
   `APPEARANCE_PRESETS`, `PERMISSIONS_MATRIX`, `DEMO_TEMPLATE_REGISTRY`). Üçüncü şablon için
   dördüncü bir taşıyıcı biçim icat etmek, `.claude/CLAUDE.md`'nin "ortak terminoloji / her
   ajan kendi kısaltmasını uydurmaz" kuralının ihlalidir.
2. **Hata anı:** şablonun `page.blocks` içeriği `PageNode[]`, `slider.slides[].layers`
   içeriği `SliderLayer[]` sözleşmesine uymak ZORUNDA. `.ts`'te uyumsuzluk `npm run typecheck`
   / CI'da patlar; `.json`'da **kullanıcı "Uygula" düğmesine bastığı anda, üretimde** patlar.
3. **Dağıtım tuzağı:** `tsc` `.json`'u `dist/`e kopyalamaz. Depoda bu iş için
   `backend/scripts/copy-static-assets.js` VAR — ama o, **binary varlıklar (PNG/PDF) için
   zaten kaçınılmaz olan** tuzağı yönetir ([DTI] §4.4). İçerik tanımını da o boru hattına
   sokmak, `tsx watch` (dev) ile `node dist/server.js` (prod) arasında ikinci bir davranış
   farkı sınıfı üretir.
4. Bu şablonun tanımı `AppointmentStatus`, `SiteFont`, `SlideBackgroundType` gibi **Prisma
   enum'larına** ve `ProductVariantOption` benzeri paylaşılan tiplere referans verir; JSON'da
   bunlar tipsiz string olur.

**Kullanıcıya açıklama (documentation-agent CHANGELOG'a bu cümleyi yazar):** "Şablonun
*şeması* istenen JSON şekliyle BİREBİR aynıdır; yalnızca *taşıyıcısı* TypeScript'tir —
böylece bozuk bir şablon üretime değil, CI'ya düşer."

**Tip güvenliği TEK BAŞINA YETMEZ ([DTI] §2, aynen geçerli):** `page.blocks` ve
`slides[].layers` DB'ye yazılmadan önce API'nin kullandığı AYNI Zod şemalarından
(`PageBlockListSchema`, `SlideLayersSchema`) geçirilir; `assertDemoTemplateCaps` modül
yükleme anında tavanları zorlar (bkz. `registry.ts`).

---

## 2. KARAR B — Kapsam: bu bir "demo şablonu" DEĞİL, "modül + üstünde demo şablonu"

### 2.1 Bulgu

`modern-architecture` ve `ecommerce-pro` şablonlarının kapsam farkı belirleyicidir:

| Şablon | Yeni domain tablosu | Yeni yetenek |
|---|---|---|
| `modern-architecture` | YOK | YOK — yalnızca mevcut CMS blokları |
| `ecommerce-pro` | `ProductVariant`, `ProductDocument` (mevcut `products` modülünün İÇİNE) | Varyasyon/PDF/kargo — **ama sahibi `products` modülüydü**, şablon değil ([EPT] §5) |
| `telehealth-clinic` | **5 yeni tablo + 1 yeni enum + yeni public rotalar + 3. parti WebRTC** | **Tamamen yeni bir iş domeni** |

Bir demo şablonu, tanımı gereği **var olan yeteneklerin veriyle sergilenmesidir.** Doktor
profili, haftalık müsaitlik, randevu ve görüntülü konsültasyon **yetenektir** — bunları
`demo-templates` modülünün içine koymak, şablon silindiğinde/ hiç uygulanmadığında ölü kod
bırakır ve [EPT] §5'in bağlayıcı sınırını ("hiçbir bileşen `templateKey` bilmez") ihlal eder.

### 2.2 KARAR (bağlayıcı)

**Yeni bir birinci sınıf modül açılır: `telehealth`.**

| Katman | Ad |
|---|---|
| Backend modül dizini | `backend/src/modules/telehealth/` |
| Admin route prefix | `/admin/telehealth` (alt yollar: `/doctors`, `/specialties`, `/appointments`) |
| Public route prefix | `/doctors`, `/appointments` (bkz. §5.2) |
| OpenAPI tag | `TeleHealth` |
| `MODULE_REGISTRY` anahtarı | `telehealth` |
| Frontend admin | `frontend/src/app/admin/telehealth/**` |
| Frontend public | `frontend/src/app/[lang]/(site)/doctors/**`, `.../consultation/[id]/` |
| Türkçe terim (UI + doküman) | **"Tele-Sağlık"**, doktor için **"doktor"**, randevu için **"randevu"** |
| Demo şablon anahtarı | `telehealth-clinic` |

**`telehealth-clinic` şablonu, `telehealth` modülünün İÇİNE hiçbir şey yazmaz — yalnızca
`Specialty` / `DoctorProfile` / `DoctorAvailability` satırları üretir.** Modülün kodu
(rotalar, slot üretimi, LiveKit) şablondan BAĞIMSIZ çalışır ve şablon hiç uygulanmasa da
tamdır. **Bağlayıcı sınır (ihlal edilirse architect'e eskale):** `modules/telehealth/**` ve
`app/[lang]/(site)/doctors/**` altındaki hiçbir dosya `telehealth-clinic` / `templateKey`
bilmez.

### 2.3 `MODULE_REGISTRY` kaydı (bağlayıcı)

`backend/src/lib/module-registry.ts`:

```ts
{
  key: "telehealth",
  label: "Tele-Sağlık",
  description: "Doktor profilleri, haftalık müsaitlik, online randevu ve görüntülü konsültasyon.",
  defaultEnabled: false,        // ← products/portfolio'dan FARKLI, bilinçli (§2.4)
  adminPath: "/admin/telehealth/doctors",
}
```

`recommendedFor` **VERİLMEZ** — `SiteTemplate` enum'ı (`SHOWCASE`/`COMMERCE`/`PORTFOLIO`)
tele-sağlığı kapsamıyor ve **enum'a `HEALTHCARE` değeri EKLENMEZ**: `ALTER TYPE ... ADD VALUE`
geri alınamaz ve `siteTemplate` yalnızca kurulum sihirbazındaki bir öneri ipucudur
([DTI] §6.2). Backlog: `feature/site-template-healthcare`.

### 2.4 `defaultEnabled: false` — neden

`products`/`portfolio` yatay yeteneklerdir; tele-sağlık **dikey bir sektör modülüdür.**
Varsayılan açık gelmesi, bu güncellemeyi alan HER mevcut kurulumun admin kenar çubuğunda
"Tele-Sağlık" ve public'te `/doctors` rotasını açardı. Public uçlar
`requireModuleEnabled("telehealth")` ile korunur → kapalıyken **404** (`Cart`/`Checkout`
tag'lerindeki mevcut desen).

### 2.5 `DoctorProfile.userId` — gerçek `User`'a bağlanır, AMA şablon `User` YAZMAZ

```
userId String? @unique   →  User (onDelete: SetNull)
```

- **Nullable ve opsiyoneldir.** Bir doktor profili, panel/hesap kullanıcısı OLMADAN da tam
  bir kayıttır (adı, biyografisi, takvimi vardır). Zorunlu FK yapmak, her doktor için hesap
  açmayı ŞART koşardı ve şablonun 4 demo doktoru için 4 sahte `User` satırı üretmesi
  gerekirdi — [DTI] §3.2'nin **"`User`: kapsam dışı, şablon hesap açmaz"** yasağının
  doğrudan ihlali.
- **Bağlayıcı:** `importer.ts` içinde `prisma.user.create/upsert` çağrısı **YOKTUR** ve
  compliance-agent bunu kodda doğrular ([EPT] §9.8 ile aynı denetim).
- Bağlıysa, o kullanıcı kendi randevularını `/consultation/[id]` üzerinden doktor tarafında
  görebilir ve LiveKit token'ı alabilir (§4.4). Bağlı değilse doktor tarafı yalnızca
  `accessToken`'lı bağlantıyla katılır — aynı yetkilendirme fonksiyonu, iki giriş yolu.
- `@unique`: bir `User` en fazla bir doktor profiline sahip olabilir.

### 2.6 Şablon ve modül aç/kapa — `requiredModules` + AÇIK opt-in (tadilat, §9.6)

[DTI] §3.2 "`SiteModule` YAZILMAZ" yasağı **dar kapsamlı olarak tadil edilir.** Yasağın
gerekçesi "site-geneli kill switch'i sessizce çevirmemek"tir; **sessizlik** ortadan
kaldırıldığında gerekçe kalmaz:

1. `DemoTemplateDefinition`'a `requiredModules: string[]` eklenir
   (`telehealth-clinic` → `["telehealth"]`, diğer iki şablon → `[]`).
2. `ImportDemoTemplateRequest`'e `enableRequiredModules?: boolean` (**varsayılan `false`**)
   eklenir.
3. `false` (varsayılan) → modül kapalıysa import yine **`201`** döner + `warnings[]`:
   *"Tele-Sağlık modülü kapalı olduğu için doktorlar ve randevu sayfaları sitede
   görünmeyecek. /admin/modules üzerinden açabilirsiniz."* ([DTI] §6.6 deseni.)
4. `true` → FAZ 2 adım 2.12'de `siteModule.upsert({ key, enabled: true })`; işlem
   `AuditLog.metadata.enabledModules: string[]` ile kayda geçer ve **yıkıcılık matrisinde
   (`replaces`) `siteModules` girdisiyle** onay diyaloğunda madde madde gösterilir.
5. Uç zaten **ADMIN-only**'dir — `PATCH /admin/modules/{key}` ile AYNI yetki eşiği; ayrıcalık
   yüzeyi GENİŞLEMEZ.

**`SiteCustomCode` yasağı ve diğer [DTI] §3.2 satırları AYNEN geçerlidir.**

---

## 3. Veri modeli (db-agent — doğrudan uygulanabilir)

Yerleşim: `backend/prisma/schema.prisma`, **`DemoTemplateImport` modelinden SONRA, `Cart`
modelinden ÖNCE**. Migration adı: **`add_telehealth_module`**. Salt-ekleme; mevcut hiçbir
tabloyu/enum'u DEĞİŞTİRMEZ; `ALTER TYPE` İÇERMEZ (yeni enum eklemek ≠ mevcut enum'a değer
eklemek); veri kaybı riski YOK → tek migration.

### 3.1 Enum

```prisma
/// Tele-Sağlık randevu yaşam döngüsü — .claude/architect-scope-telehealth-template.md §3.1.
/// Değer SIRASI bağlayıcıdır (PostgreSQL enum tanım sırası ORDER BY davranışını belirler).
/// YENİ bir enum olduğu için tüm değerler İLK SEFERDE tanımlanır: sonradan değer eklemek
/// `ALTER TYPE ... ADD VALUE` ile GERİ ALINAMAZ (bkz. ImportJobType.PRODUCTS emsali).
/// Kullanıcının istediği SCHEDULED/COMPLETED ikilisi YETERSİZDİR: iptal ve gelmedi (no-show)
/// durumları ilk gerçek kullanımda ORTAYA ÇIKAR ve o an enum'a dokunmak migration borcudur.
enum AppointmentStatus {
  SCHEDULED
  IN_PROGRESS
  COMPLETED
  CANCELLED
  NO_SHOW
}
```

### 3.2 `Specialty`

```prisma
model Specialty {
  id          String   @id @default(uuid())
  seq         Int      @unique @default(autoincrement())
  name        String
  slug        String   @unique
  /// lucide-react ikon anahtarı (ör. "heart-pulse") — `icon-box` bloğuyla AYNI sözlük.
  /// Görsel/Media DEĞİL: ikon setine bağlanmak sıfır varlık maliyeti + keskin render (§[DTI] 4.4).
  icon        String
  description String?
  order       Int      @default(0)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  doctors DoctorProfile[]

  @@index([isActive, order])
  @@map("specialties")
}
```

### 3.3 `DoctorProfile`

```prisma
model DoctorProfile {
  id          String  @id @default(uuid())
  seq         Int     @unique @default(autoincrement())
  /// §2.5 — opsiyonel panel kullanıcısı bağlantısı. Şablon bu alanı DAİMA null bırakır.
  userId      String? @unique
  specialtyId String?

  /// "Dr." / "Prof. Dr." / "Uzm. Dr." — serbest metin, enum DEĞİL: unvanlar ülkeye göre
  /// değişir ve enum'a değer eklemek geri alınamaz.
  title    String
  /// `User.name`'den BAĞIMSIZ: profil hesap olmadan da tam bir kayıttır (§2.5).
  fullName String
  slug     String @unique
  bio      String
  /// ISO 639-1 kodları ("tr", "en", "de") — en fazla 6, Zod ile zorlanır.
  languages String[]
  /// IANA saat dilimi ("Europe/Istanbul"). Müsaitlik kuralları BU dilimin DUVAR SAATİNDE
  /// yorumlanır (§3.4). "UTC+3" gibi ofset string'i YASAK — DST'de sessizce yanlış olur.
  timeZone  String @default("Europe/Istanbul")

  /// Satılan birim seans'tır, saat DEĞİL ([EPT] §1.2 "fiyat satılan seviyede yaşar" ilkesi).
  /// `hourlyRate` REDDEDİLDİ: 30 dk seansta bölme yuvarlama hatası üretir.
  sessionDurationMin Int    @default(30)
  sessionPriceCents  Int
  currency           String @default("TRY")

  /// Avatar GERÇEK bir Media satırıdır ([DTI] §4.2) — serbest `avatarUrl` string'i REDDEDİLDİ:
  /// medya kütüphanesinde görünmeyen görsel MediaPicker ile değiştirilemez.
  avatarMediaId String?

  /// Kimlik/diploma doğrulaması yapılmış profil rozeti. Şablonun ürettiği DEMO profillerde
  /// DAİMA false'tur (§7.2) — sahte doğrulama rozeti yayına sızarsa tüketiciyi yanıltır.
  isVerified Boolean   @default(false)
  verifiedAt DateTime?
  isActive   Boolean   @default(true)
  order      Int       @default(0)
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  user         User?                @relation("DoctorProfileUser", fields: [userId], references: [id], onDelete: SetNull)
  specialty    Specialty?           @relation(fields: [specialtyId], references: [id], onDelete: SetNull)
  avatarMedia  Media?               @relation("DoctorAvatarMedia", fields: [avatarMediaId], references: [id], onDelete: SetNull)
  availability DoctorAvailability[]
  appointments Appointment[]

  @@index([specialtyId])
  @@index([avatarMediaId])
  @@index([isActive, order])
  @@map("doctor_profiles")
}
```

**`rating` / `reviewCount` REDDEDİLDİ (bağlayıcı).** Sistemde değerlendirme (review) tablosu
YOKTUR; bu iki kolon **hiçbir kaynağı olmayan, elle yazılan sayılar** olurdu. Arayüzde
"4,9 ★ (128 değerlendirme)" göstermek, dayanağı olmayan **uydurma sosyal kanıttır** — hem
[EPT] §1.2'deki "denormalize bayrak ile gerçeklik arasında sürüklenme" reddinin aynısı, hem
de tüketiciyi yanıltıcı ticari uygulama riskidir (compliance-agent notu, §7.4).
Backlog: `feature/doctor-reviews` (gerçek `DoctorReview` tablosu + doğrulanmış randevu şartı).

**Uzmanlık çoklu DEĞİL, tek FK.** Ara tablo (`DoctorSpecialty`) v1'de AÇILMAZ: liste ekranı
tek uzmanlığa göre filtreler, ara tablo "birincil hangisi?" + sıralama sorularını doğurur.
Backlog: `feature/doctor-multiple-specialties`.

### 3.4 `DoctorAvailability` — haftalık kural, üretilmiş slot DEĞİL

```prisma
/// Haftalık TEKRARLAYAN müsaitlik penceresi. BURADA SLOT SATIRI TUTULMAZ — slotlar
/// (§4.2) bu kurallardan + mevcut randevulardan ÇALIŞMA ZAMANINDA türetilir.
/// Gerekçe: 4 doktor × 5 gün × 16 slot × 52 hafta = 16.640 satır/yıl'lık ölü veri; ayrıca
/// "gelecek ne kadar süre için slot üretelim?" sorusunun doğru cevabı yoktur.
model DoctorAvailability {
  id       String @id @default(uuid())
  doctorId String
  /// ISO-8601: 1 = Pazartesi … 7 = Pazar. JavaScript'in 0-6 (0 = Pazar) konvansiyonu
  /// BİLİNÇLİ olarak KULLANILMAZ; dönüşüm TEK yerde (lib/availability.ts) yapılır.
  dayOfWeek Int
  /// Gün başlangıcından itibaren DAKİKA (0-1440), DOKTORUN `timeZone`'undaki DUVAR SAATİ.
  /// 09:00-17:00 → 540 / 1020. `DateTime` KULLANILMAZ: tekrarlayan kural bir AN değildir.
  startMinute Int
  endMinute   Int
  isActive    Boolean @default(true)

  doctor DoctorProfile @relation(fields: [doctorId], references: [id], onDelete: Cascade)

  @@unique([doctorId, dayOfWeek, startMinute])
  @@index([doctorId])
  @@map("doctor_availability")
}
```

**Tatil/izin/tek seferlik istisna (`DoctorTimeOff`) v1'de KAPSAM DIŞI** — istendiğinde
backlog `feature/doctor-time-off`. v1'de doktor bir günü kapatmak için müsaitlik satırını
pasifleştirir.

### 3.5 `Appointment` — `MeetingRoom` tablosu YOK

```prisma
model Appointment {
  id       String @id @default(uuid())
  seq      Int    @unique @default(autoincrement())
  doctorId String
  /// Kayıtlı hasta; misafir randevusunda NULL (Cart.siteUserId ile AYNI desen).
  patientUserId String?

  /// PII SNAPSHOT (OrderItem.productTitle disipliniyle AYNI): kullanıcı silinse/adını
  /// değiştirse de randevunun kimle yapıldığı kaydı bozulmaz.
  patientName  String
  patientEmail String

  /// MUTLAK AN (Postgres timestamptz). `startTimeUtc` adlandırması REDDEDİLDİ: Prisma
  /// DateTime zaten UTC saklar, "Utc" soneki hem gereksiz hem proje konvansiyonuna
  /// (publishedAt/startedAt/importedAt) aykırıdır.
  startsAt DateTime
  endsAt   DateTime

  status     AppointmentStatus @default(SCHEDULED)
  priceCents Int
  currency   String            @default("TRY")

  /// LiveKit oda adı — TAHMİN EDİLEMEZ, rastgele üretilir ("room_" + 32 hex).
  /// Appointment.id'den TÜRETİLMEZ: id, liste yanıtlarında ve loglarda görünür;
  /// oda adının ondan türemesi, odayı bilen herkese oda adını verir.
  meetingRoomName String @unique
  /// Misafir hastanın katılım bağlantısındaki opak token'ın SHA-256 hash'i
  /// (Cart.tokenHash / lib/tokens.ts ile AYNI desen). HAM DEĞER SAKLANMAZ.
  accessTokenHash String @unique

  startedAt    DateTime?
  endedAt      DateTime?
  cancelledAt  DateTime?
  cancelReason String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  doctor      DoctorProfile @relation(fields: [doctorId], references: [id], onDelete: Restrict)
  patientUser User?         @relation("AppointmentPatient", fields: [patientUserId], references: [id], onDelete: SetNull)

  /// Çifte rezervasyonun DB seviyesi garantisi (§4.3).
  @@unique([doctorId, startsAt])
  @@index([patientUserId])
  @@index([doctorId, startsAt])
  @@index([status, startsAt])
  @@map("appointments")
}
```

**`MeetingRoom` tablosu REDDEDİLDİ (bağlayıcı).** Kullanıcının istediği üç şeyin hiçbiri bir
tablo GEREKTİRMEZ:
- *"LiveKit oda kimliği"* → `Appointment.meetingRoomName` (bir randevuya 1:1 bağlı tek bir
  string için ayrı tablo, join maliyetinden başka bir şey üretmez).
- *"Token oluşturma yardımcıları"* → **kod**tur (`modules/telehealth/lib/livekit.ts`), veri
  değil. `lib/shipping.ts` / `lib/product-pricing.ts` ile aynı sınıf.
- *"waitingRoom durumu"* → **efemer** bir durumdur (katılımcı odada mı, değil mi). Gerçek
  kaynağı LiveKit'in katılımcı listesidir; DB'ye kopyalamak, sunucu çökmesinde/ağ kopmasında
  **kalıcı olarak yanlış** bir satır bırakır. Bekleme odası UI'ı, LiveKit `RoomContext`
  katılımcı sayısından türetilir. Randevunun gerçek yaşam döngüsü zaten
  `status` + `startedAt`/`endedAt` ile kalıcıdır.

**`patientNote` / şikâyet-semptom alanı REDDEDİLDİ (bağlayıcı, compliance).** KVKK md.6
kapsamında **sağlık verisi özel nitelikli kişisel veridir** ve açık rıza + ayrı teknik
tedbirler gerektirir. Kullanıcıyı semptom yazmaya davet eden serbest metin alanı açmak, bu
yükümlülüğü teknik bir zorunluluk hâline getirir. v1'de böyle bir alan **yoktur**; randevu
formunda yalnızca ad + e-posta toplanır. Backlog: `feature/telehealth-intake-form`
(compliance-agent önderliğinde, açık rıza akışıyla birlikte).

### 3.6 Örnek/sahte randevular — **KAPSAM DIŞI** (bağlayıcı, gerekçeli ret)

Kullanıcının istediği "2 örnek randevu" **üretilmeyecektir.** [EPT] §4.5'in (sahte sipariş
reddi) beş gerekçesi burada BİREBİR geçerlidir, üstüne iki tanesi eklenir:

1. `Appointment.patientName` + `patientEmail` **tanımı gereği kişisel veridir.**
2. Bir randevu kaydı, "şu kişi şu tarihte bir **kardiyoloğa** göründü" bilgisini taşır —
   yani **çıkarımsal sağlık verisidir.** Sahte de olsa, üretim veritabanına özel nitelikli
   veri sınıfına yakın kayıt yazmak PII disiplinini bulanıklaştırır ve veri envanterini
   (compliance-agent'ın VERBİS/işleme envanteri) yalanlar.
3. Sahte randevu, doktorun takvimindeki gerçek bir slotu **DOLDURUR** (`@@unique([doctorId,
   startsAt])`) — ilk gerçek hasta o saati alamaz ve nedenini anlayamaz.
4. `/admin/telehealth/appointments` ve gelecekteki her rapor bu satırları sayar.
5. `status: COMPLETED` ama `startedAt`/`endedAt` yok bir kayıt, hiçbir zaman oluşmaması
   gereken bir durumdur; "tamamlanan konsültasyon" metrikleri sessizce bozulur.

**Yapısal garanti (bağlayıcı):** `DemoTemplateDefinition.telehealth` şeklinde **`appointments`
diye bir alan YOKTUR** (§6.1) — sahte randevu üretmek yalnızca yasak değil, **tanımlanamaz**.
compliance-agent, `importer.ts` içinde `appointment` yazan hiçbir çağrı olmadığını doğrular.

**Yerine:** şablon **müsaitlik takvimini** doldurur (kişisel veri değildir) → takvim arayüzü
dolu ve gösterilebilir olur; sonuç ekranında *"Örnek randevu oluşturulmaz — ilk gerçek
randevunuz burada görünecek."* notu gösterilir. QA, randevuyu **gerçek rezervasyon akışından
geçerek** oluşturur (§10) — bu zaten daha değerli bir testtir.

### 3.7 Zorunlu karşı-ilişkiler

```prisma
// User modeline:
  doctorProfile        DoctorProfile? @relation("DoctorProfileUser")
  appointmentsAsPatient Appointment[] @relation("AppointmentPatient")

// Media modeline:
  doctorAvatars DoctorProfile[] @relation("DoctorAvatarMedia")
```

### 3.8 `ContentEntityType`'a `DOCTOR` EKLENMEZ

`/doctors/[slug]` **`ContentSlug` tablosuna KAYDOLMAZ** ve `syncContentSlugs` çağrılmaz.
Gerekçe: (a) enum'a değer eklemek geri alınamaz; (b) doktor profili v1'de çok dilli içerik
değildir (`translations` yok); (c) `ContentSlug.@@unique([locale, slug])` `entityType`'ı
KAPSAMAZ — doktor slug'larını oraya yazmak, `importer.ts`'in bugün çözdüğü çakışma tuzağını
(bkz. `existsAnyLocaleSlug` yorumu) yeni bir varlık tipiyle büyütürdü. `ContentRevision` de
üretilmez. Backlog: `feature/telehealth-i18n`.

---

## 4. Modül iş mantığı (backend-agent) ve LiveKit sınırı

### 4.1 Dosya yerleşimi

```
backend/src/modules/telehealth/
  telehealth.routes.ts          # public: /doctors, /appointments
  telehealth.admin.routes.ts    # /admin/telehealth/*
  telehealth.schemas.ts         # Zod istek/param şemaları
  lib/
    timezone.ts                 # duvar saati ↔ an dönüşümü (§4.2)
    availability.ts             # slot üretimi (saf fonksiyon, DB'siz test edilebilir)
    booking.ts                  # rezervasyon değişmezleri (§4.3)
    livekit.ts                  # ⚠ integration-agent'ın SAHASI (§4.4)
```
`backend/src/schemas/entities.ts` → `SpecialtySchema`, `DoctorProfileSchema`,
`AvailabilitySlotSchema`, `AppointmentSchema`. `backend/src/mappers/index.ts` → DTO'lar.

### 4.2 Saat dilimi — tek bağlayıcı cümle

> **Tekrarlayan müsaitlik DUVAR SAATİDİR (doktorun IANA diliminde); randevu ANDIR (UTC
> timestamptz). Dönüşüm TEK yerde, `lib/timezone.ts` içinde yapılır ve API sınırından
> DIŞARIYA yalnızca ISO-8601 `Z`'li ANLAR çıkar — sunucu ASLA önceden biçimlendirilmiş
> yerel saat string'i döndürmez.**

- **Yeni bağımlılık YOK** (`luxon`/`date-fns-tz`/`moment-timezone` EKLENMEZ):
  Node 20 tam ICU ile gelir; `Intl.DateTimeFormat(…, { timeZone })` ile duvar saati ↔ an
  dönüşümü yapılır. code-quality-agent bağımlılık politikası gereği tek istisna LiveKit'tir
  (§4.4).
- **DST tuzağı (backend-agent — atlanırsa yılda iki kez sessiz hata):** ilkbahar geçişinde
  var olmayan bir duvar saati (ör. 03:30) ve sonbaharda çift geçen bir saat oluşur. Kural:
  var olmayan saat → o slot **üretilmez**; çift geçen saat → **ilk (DST'li) örneği** alınır.
  qa-agent bunu birim testle sabitler.
- **Ziyaretçi tarafı (frontend-agent, bağlayıcı):** ziyaretçinin dilimi
  `Intl.DateTimeFormat().resolvedOptions().timeZone` ile **yalnızca istemcide, mount
  sonrası** okunur. Slot saatleri SSR'da biçimlendirilirse hidrasyon uyuşmazlığı olur —
  sunucu HTML'i sunucunun dilimini yansıtır. Takvim, veriyi SSR'da alır, **saatleri
  istemcide biçimlendirir** ve "Saatler *Europe/Istanbul* diliminizde gösteriliyor
  (doktorun yerel saati: 14:00)" ikili gösterimini ZORUNLU olarak yapar.

`GET /doctors/{slug}/slots?from=&to=` — `from`/`to` ISO tarih (maks. **31 gün** aralık,
Zod ile zorlanır), yanıt `AvailabilitySlot[]`: `{ startsAt, endsAt, available }`.
Geçmişteki ve **şu andan itibaren 2 saatten yakın** slotlar `available: false` döner
(rezervasyon tamponu; sabit, ayar DEĞİL — ayar istenirse backlog).

### 4.3 Rezervasyon — mevcut `runSerializable` paterni, yeni hedef

`POST /appointments` (public, kimlik doğrulama GEREKTİRMEZ, hız sınırı **5 istek/dk**):

```
runSerializable(tx => {
  1. doctor + availability oku (isActive, modül açık)
  2. istenen startsAt gerçekten bir slot mu?  (lib/availability.ts, saf fonksiyon)
  3. o slot dolu mu?  (tx.appointment.findFirst)
  4. değilse create (meetingRoomName + accessToken üret)
})
```

- **`runSerializable` BURADA GEREKLİDİR** — bu tam bir "check-then-act" yarışıdır (webhook
  stok düşürme ile AYNI sınıf). `@@unique([doctorId, startsAt])` ikinci savunma hattıdır;
  `P2002` yakalanır ve **`409 SLOT_TAKEN`**'e çevrilir.
- İptal edilen randevu (`status: CANCELLED`) slotu **serbest bırakmalıdır** — ama
  `@@unique([doctorId, startsAt])` buna izin vermez. **Karar:** iptal, satırı silmez;
  `startsAt`'i DEĞİŞTİRMEZ; slot yeniden satılabilir olmadığı için v1'de iptal edilen saat
  **kapalı kalır** ve bu, sonuç ekranında/doktor panelinde açıkça yazılır. Kısmi unique
  indeks (`WHERE status <> 'CANCELLED'`) **EKLENMEZ** — [EPT] §1.4'teki gerekçe aynen
  geçerlidir (depoda elle yazılmış SQL yok, drift riski). Backlog:
  `feature/appointment-reschedule` (iptal + yeniden planlama birlikte ele alınır).
- Yanıt gövdesi **ham `accessToken`'ı bir KEZ döner** (hash saklanır) ve katılım bağlantısı
  `/{lang}/consultation/{id}?t=<token>` olarak kurulur.
- **Ödeme YOKTUR.** `priceCents` bir snapshot'tır; Stripe akışı v1'de bağlanmaz. Backlog:
  `feature/telehealth-payments` (integration-agent sahiplenir).

### 4.4 KARAR C — LiveKit: GERÇEK SDK, "yapılandırılmamış" modu, SAHTE VİDEO YOK

Kod tabanında bugün LiveKit'e ait **hiçbir referans yoktur** (doğrulandı:
`backend/package.json`, `frontend/package.json` ve tüm `.ts/.tsx` dosyalarında sıfır eşleşme).

**Karar: (2) numaralı seçenek, netleştirilmiş hâliyle.**

1. **Gerçek SDK entegre edilir.** Sahte/mock bir video arayüzü **YAZILMAZ**: sahte katılımcı
   karesi, taklit "bağlanıyor" animasyonu veya döngüye alınmış örnek video **YASAKTIR** —
   bu, [EPT] §7.3'teki "gösterilen ile gerçekleşen aynı olmalıdır" ilkesinin ve [DTI]
   §8.2'deki "çalışmayan bir input koymak, vaat edip yapmamaktır" kararının ihlalidir.
2. **Yapılandırma opsiyoneldir ve `STRIPE_SECRET_KEY` ile BİREBİR aynı deseni izler**
   (`backend/src/config/env.ts`):

```ts
  LIVEKIT_URL: z.string().default(""),          // wss://<proje>.livekit.cloud
  LIVEKIT_API_KEY: z.string().default(""),
  LIVEKIT_API_SECRET: z.string().default(""),
  // Token TTL — kısa tutulur (§8). Dakika.
  LIVEKIT_TOKEN_TTL_MIN: z.coerce.number().int().positive().max(60).default(15),
```
   Frontend: `NEXT_PUBLIC_LIVEKIT_URL` (yalnızca sunucu adresi; **API secret ASLA frontend'e
   geçmez**).
3. **Yapılandırılmamışken davranış (bağlayıcı):** `POST /appointments/{id}/meeting-token`
   → **`503 LIVEKIT_NOT_CONFIGURED`**. `/consultation/[id]` sayfası, randevu bilgilerini,
   geri sayımı ve katılımcı durumunu **normal şekilde gösterir**; video alanında ise açık bir
   panel yer alır: *"Görüntülü görüşme altyapısı (LiveKit) bu kurulumda yapılandırılmamış.
   Yönetici `LIVEKIT_URL`, `LIVEKIT_API_KEY` ve `LIVEKIT_API_SECRET` değerlerini tanımladıktan
   sonra görüşme başlatılabilir."* — bu bir hata ekranı değil, **dürüst bir durum ekranıdır.**
4. **Sahiplik (`.claude/CLAUDE.md` ajan tablosu gereği):**
   - **integration-agent — TEK SAHİP:** `livekit-server-sdk` bağımlılığı, `lib/livekit.ts`
     (AccessToken üretimi, grant kapsamı, oda adı üretimi), `POST /appointments/{id}/meeting-token`
     ucu, LiveKit webhook'u (eğer eklenirse — v1'de **EKLENMEZ**), env değişkenlerinin
     tüketimi. **backend-agent bu dosyalara DOKUNMAZ.**
   - **frontend-agent:** `@livekit/components-react` + `livekit-client` +
     `@livekit/components-styles` ile oda arayüzü (mikrofon/kamera/ekran paylaşımı/ayrıl
     düğmeleri, geri sayım, bekleme odası durumu). Token'ı **kendisi üretmez**, uçtan alır.
   - **security-agent:** §8'deki token denetimi — **engelleyici** (blocking) onaydır.
   - **devops-agent:** `.env.example`, `docker-compose*.yml`, CI secret'ları, Docker imajı.
     **Compose'a LiveKit SUNUCUSU EKLENMEZ** (bir SFU'yu self-host etmek bu turun kapsamı
     değildir); LiveKit Cloud veya harici bir kurulum varsayılır ve `.env.example` bunu yazar.
5. **Kayıt (recording/Egress) KAPSAM DIŞI, bağlayıcı.** Bir tıbbi konsültasyonu kaydetmek
   özel nitelikli veriyi **kalıcılaştırır**: saklama süresi, şifreleme, erişim kaydı, silme
   hakkı ve her iki tarafın açık rızası gerekir. Backlog: `feature/telehealth-recording`
   (compliance-agent önderliğinde açılır; kod önce YAZILMAZ).
6. **Yeni bağımlılık onayı (code-quality-agent'a bağlayıcı gerekçe):** 4 paket eklenir
   (1 backend, 3 frontend). WebRTC SFU sinyalleşmesini elle yazmak makul bir alternatif
   değildir; paketler Apache-2.0'dır ve proje lisans politikasına uygundur. **Başka paket
   eklenmez** — özellikle bir saat dilimi kütüphanesi (§4.2) ve bir "takvim" bileşeni
   (mevcut `date-fns` + kendi ızgaramız yeterlidir) EKLENMEZ.

### 4.5 Katılım penceresi ve yetkilendirme (bağlayıcı)

Token yalnızca şu koşulların **HEPSİ** sağlanırsa üretilir:
- Randevu `SCHEDULED` veya `IN_PROGRESS`,
- `now >= startsAt - 5 dk` **ve** `now <= endsAt + 15 dk` (aksi hâlde
  **`409 APPOINTMENT_NOT_JOINABLE`**),
- Çağıran ya (a) `patientUserId` ile eşleşen oturum sahibi, ya (b) doğru `accessToken`'ı
  sunan misafir hasta, ya (c) doktorun bağlı `User`'ı, ya (d) `SiteRole.ADMIN`
  (destek/gözlem — audit'e ADMIN olarak düşer).
- İlk başarılı token → `status: IN_PROGRESS` + `startedAt` (tek seferlik).
- `POST /appointments/{id}/complete` (doktor/ADMIN) → `COMPLETED` + `endedAt`.

---

## 5. Frontend yüzeyi

### 5.1 Admin (frontend-agent)

| Dosya | Değişiklik |
|---|---|
| `src/app/admin/telehealth/doctors/page.tsx` + `*-view.tsx` | **YENİ** — doktor CRUD, müsaitlik editörü (haftalık ızgara) |
| `src/app/admin/telehealth/specialties/page.tsx` + view | **YENİ** — uzmanlık CRUD, lucide ikon seçici |
| `src/app/admin/telehealth/appointments/page.tsx` + view | **YENİ** — randevu listesi (salt-okunur + iptal), **PII içerir → ADMIN/MANAGER** |
| `src/components/admin/sidebar.tsx` | `telehealth` modülüne bağlı grup — mevcut "modüle bağlı sekme" deseniyle (bkz. `3cbc753` Vergi Sınıfları sekmesi) BİREBİR aynı |
| `src/app/admin/demo-templates/demo-templates-view.tsx` | Üçüncü kart + `requiredModules` uyarısı + `enableRequiredModules` onay kutusu (§2.6) |
| `src/lib/api/telehealth.ts`, `src/lib/api/types.ts` | **YENİ/güncelleme** — openapi ile BİREBİR |
| `src/lib/i18n/dictionaries/nav.ts` | `nav.telehealth` = "Tele-Sağlık" / "TeleHealth" |

### 5.2 Public (frontend-agent)

| Rota | İçerik |
|---|---|
| `[lang]/(site)/doctors/page.tsx` | Doktor ızgarası + uzmanlık/dil filtresi + arama |
| `[lang]/(site)/doctors/[slug]/page.tsx` | Profil + **saat dilimi duyarlı slot takvimi** + randevu formu |
| `[lang]/(site)/consultation/[id]/page.tsx` | LiveKit odası (istemci bileşeni), geri sayım, bekleme odası, `?t=` token'ı |

**Türkçe rota segmenti (`/doktorlar`) REDDEDİLDİ** — [EPT] §5'teki `/urun/[slug]` reddiyle
AYNI gerekçe: sitemap/`canonicalUrl`/i18n çözümlemesi aynı anda kırılır, kazanç kozmetiktir.
(Mevcut `hesabim`/`siparislerim` rotaları bu karardan ÖNCEye ait bir tutarsızlıktır ve bu
turda düzeltilmez.) Backlog: `feature/localized-route-segments`.

**Randevu formunda ZORUNLU (compliance, §7):** KVKK aydınlatma metnine bağlantı + **açık
onay kutusu** (varsayılan işaretsiz). Onay metninin İÇERİĞİ compliance-agent'ın alanıdır;
frontend-agent metni **kendisi yazmaz** ([DTI] §3.2 `ContactForm` emsali).

**frontend-agent meta/SEO'ya DOKUNMAZ** — `/doctors*` public sayfaların meta tag'i,
canonical'ı, sitemap girdisi ve structured data'sı **seo-agent'ındır** (§9.5).

### 5.3 Ana sayfada dinamik doktor ızgarası — v1'de YOK (bilinçli)

Frontend'de `featured-doctors` diye bir page-builder bloğu **yoktur** ve bu turda
**icat EDİLMEZ** ([DTI] §8: "yeni blok tipi YOK"; [EPT] §4.2: yalnızca ZATEN VAR OLAN bloğun
yapısal aynası eklenebilir). Bir blok tipi **site-geneli bir yetenektir** ve sahibi
page-builder özelliğidir; tek bir demo şablonu uğruna genişletmek sahiplik tersine
çevirmedir. Şablonun ana sayfası, doktorları **statik kartlarla** tanıtır ve `/doctors`
listesine yönlendirir. Backlog: `feature/page-builder-featured-doctors`.

---

## 6. Şablon paketi — `telehealth-clinic` (backend-agent)

### 6.1 `DemoTemplateDefinition` genişlemesi (`modules/demo-templates/types.ts`)

```ts
export interface DemoTemplateDefinition {
  // ... [DTI] §3 + [EPT] §4.1'deki TÜM mevcut alanlar DEĞİŞMEDEN ...

  /** §2.6 — bu şablonun ihtiyaç duyduğu MODULE_REGISTRY anahtarları. [] = yok. */
  requiredModules: string[];

  /** null = bu şablon tele-sağlık verisi getirmiyor (diğer iki şablon: null). */
  telehealth: {
    specialties: { name: string; slug: string; icon: string; description: string | null; order: number }[];
    doctors: {
      title: string;              // "Dr." / "Prof. Dr."
      fullName: string;
      slug: string;
      bio: string;                // §7.2 — İLK CÜMLE zorunlu demo uyarısı
      languages: string[];        // ISO 639-1
      timeZone: string;           // IANA
      specialtySlug: string | null;
      sessionDurationMin: number;
      sessionPriceCents: number;
      currency: string;
      /** `assets[].key` → `DoctorProfile.avatarMediaId` (GERÇEK Media FK). */
      avatarAssetKey: string | null;
      order: number;
      /** §7.2 — şablonda DAİMA false. Tip düzeyinde sabitlenir. */
      isVerified: false;
      availability: { dayOfWeek: 1|2|3|4|5|6|7; startMinute: number; endMinute: number }[];
    }[];
  } | null;

  // ⚠ `appointments` alanı YOKTUR ve EKLENMEYECEKTİR (§3.6 yapısal garantisi).
}
```

Yeni tavanlar (`types.ts`, `assertDemoTemplateCaps` ile zorlanır):

```ts
export const MAX_TEMPLATE_SPECIALTIES = 12;
export const MAX_TEMPLATE_DOCTORS = 8;
export const MAX_TEMPLATE_DOCTOR_AVAILABILITY = 21;   // doktor BAŞINA (3 pencere × 7 gün)
```
`MAX_TEMPLATE_ASSETS = 40` **DEĞİŞMEZ** — bu şablon ~8 varlık taşır (§6.3).

### 6.2 Yeni token ailesi (bağlayıcı, [DTI] §3.4 + [EPT] §4.2'ye ek)

| Token | Nerede | Neye çözülür |
|---|---|---|
| `ref:specialty-slug:<slug>` | `navigation[].children[].href`, `page.blocks` içindeki `button.href` | Faz 2'de GERÇEKTEN oluşturulan (gerekirse benzersizleştirilmiş) `Specialty.slug` → `/doctors?specialty=<gerçek-slug>` |

Gerekçe [EPT]'deki `ref:product-category-slug:` bugfix'iyle BİREBİR aynıdır: şablon yazım
anında slug'ın benzersizleştirilip benzersizleştirilmeyeceği bilinemez; ham slug yazmak,
`anasayfa-2` sınıfı bir çakışmadan sonra **ölü bağlantı** üretir. Çözümleyici
`lib/asset-tokens.ts`'te genelleştirilir (yeni dosya AÇILMAZ); çözülemeyen token **FATAL →
`422`** ([DTI] §3.4 kural 3).

### 6.3 Varlıklar (~8 PNG) ve önizleme

- 4 doktor avatarı: **fotogerçekçi insan görseli KESİNLİKLE YASAKTIR** (yapay zekâ üretimi
  dahil — [DTI] §9.3). Avatarlar `backend/scripts/build-template-assets.ts` ile üretilen
  **soyut monogram** PNG'lerdir (gradient zemin + baş harfler), 512×512.
- 1 hero için varlık YOK: hero slaydı `bgType: GRADIENT` (teal → ocean blue) —
  [DTI] §4.4 madde 1 (sıfır varlık + LCP kazancı).
- 2-3 destekleyici görsel (güven bandı / "nasıl çalışır" bölümü), 1200×900.
- `SiteSettings.logoUrl` **BOŞ BIRAKILIR** ([DTI] §4.4 madde 3).
- Önizleme: **`frontend/public/demo-templates/telehealth-clinic/preview.svg`**.
  *(Kayda geçirilen düzeltme: [DTI] §4.5 "preview.webp" diyor; fiilen uygulanan ve mevcut
  iki şablonda kullanılan biçim `preview.svg`'dir — `Media` boru hattından geçmediği için
  §4.1'deki SVG yasağı BURAYA UYGULANMAZ; Next.js statiği olarak servis edilir. Üçüncü
  şablon mevcut uygulamayı izler; §9.6'da tadilat olarak listelenmiştir.)*

### 6.4 Görünüm (`appearance`) — başlangıç değerleri, **nihai karar ui-designer'ın**

| `SiteAppearance` alanı | Başlangıç | Not |
|---|---|---|
| `primaryColor` | `#0D9488` (teal) | Kullanıcının "zümrüt yeşili" isteği |
| `secondaryColor` | `#0F172A` | Koyu lacivert header/footer |
| `buttonColor` / `buttonTextColor` | `#0284C7` / `#FFFFFF` | Okyanus mavisi CTA |
| `linkColor` | `#0369A1` | — |
| `accentColor` | `#0D9488` | — |
| `backgroundColor` / `surfaceColor` | `#F8FAFC` / `#FFFFFF` | Klinik/steril beyaz |
| `textColor` / `mutedTextColor` | `#0F172A` / `#64748B` | — |
| `borderRadius` / `buttonStyle` | `LG` / `SOLID` | Yumuşak, "sağlık" tonu |
| `headingFont` / `bodyFont` | `PLUS_JAKARTA_SANS` / `INTER` | **`SiteFont` enum'ına yeni değer EKLENMEZ** ([DTI] §7.1) |
| `presetKey` | `null` | ([DTI] §7.3) |

**ui-designer'a bağlayıcı uyarı:** `#0D9488` beyaz üzerinde **3,6:1** kontrast verir → normal
gövde metni için **WCAG AA'yı GEÇMEZ.** Metin/link rolünde kullanılacaksa koyulaştırılmalıdır
(ör. `#0F766E`, 4,8:1). Nihai hex'ler ve AA doğrulaması ui-designer'ın kararıdır
(`.claude/CLAUDE.md`: görsel çelişkide ui-designer kazanır).

### 6.5 Sayfa kompozisyonu — MEVCUT bloklarla (yeni blok tipi YOK)

| # | Bölüm | Blok bileşimi |
|---|---|---|
| 1 | Header | Blok DEĞİL — `NavigationItem` + `headerCta*` ("Randevu Al" → `/doctors`) |
| 2 | Hero | `advanced-slider` (`ref:slider`) → `bgType: GRADIENT` + heading/text/button katmanları |
| 3 | Güven bandı (7/24, şifreli görüşme, doğrulanmış hekim) | `container(row)` → 3 × `icon-box` |
| 4 | Uzmanlık ızgarası (6) | `container(row)` → 6 × `icon-box` (`href: ref:specialty-slug:<slug>`) |
| 5 | "Nasıl çalışır?" (3 adım) | `container` → `heading` + 3 × `icon-box` |
| 6 | Öne çıkan doktorlar | `container(row)` → 4 × (`image` + `heading` + `text` + `button`) — statik, §5.3 |
| 7 | Sayaç bandı | `counter` (doktor sayısı, uzmanlık, dil, ortalama yanıt süresi) |
| 8 | SSS / güven CTA | `container` (koyu) → `cta` |
| 9 | İletişim | `contact-form` (mevcut singleton) |
| 10 | Footer | Blok DEĞİL — `FooterColumn`/`FooterLink` + `footerCopyrightText` |

**Sayaç değerleri kurgusal ama iddiasız olmalıdır** — "10.000+ mutlu hasta" gibi
doğrulanamayan bir başarı iddiası compliance-agent tarafından REDDEDİLİR (§7.4); "6 uzmanlık
alanı", "4 dil" gibi **şablonun kendi verisinden doğrulanabilir** sayılar kullanılır.

### 6.6 `extraPages`

`isLegalDocument: true` ile **KVKK Aydınlatma Metni**, **Açık Rıza Metni (sağlık hizmeti)**,
**Kullanım Koşulları**, **Mesafeli Hizmet Sözleşmesi** yer tutucuları üretilir ve footer'dan
bağlanır. [EPT] §4.3'ün **ZORUNLU ilk cümlesi** aynen geçerlidir:

> "Bu metin bir **yer tutucudur** ve hukuki geçerliliği yoktur. Yayına almadan önce hukuk
> danışmanınızla birlikte doldurmanız zorunludur."

Ek olarak **sağlığa özgü, ZORUNLU bir yer tutucu uyarı sayfası/bölümü**: *"Bu platform acil
tıbbi durumlar için KULLANILAMAZ. Acil durumda 112'yi arayın."* — bu cümle şablonun ana
sayfasında ve doktor detay sayfasında da yer alır (§7.4).

### 6.7 Yıkıcılık matrisi eki ([DTI] §6.1 / [EPT] §4.4'e ek satırlar)

| Alan | Davranış |
|---|---|
| `Specialty` / `DoctorProfile` / `DoctorAvailability` | **EKLENİR** — mevcut kayıtlar ASLA silinmez; slug çakışmasında [DTI] §6.5 benzersizleştirmesi |
| `Appointment` | **ASLA YAZILMAZ** (§3.6) |
| `SiteModule` (`telehealth`) | `enableRequiredModules: true` ise **AÇILIR**; `replaces` içinde `siteModules` olarak gösterilir (§2.6) |
| `User` | **ASLA YAZILMAZ** (§2.5) |

Importer FAZ 2'ye eklenen adımlar (2.7'den sonra, 2.8'den önce):
`2.7f specialty.create → 2.7g doctorProfile.create → doctorAvailability.createMany`;
ve en sona `2.12 siteModule.upsert` (§2.6). Transaction timeout **30 sn** korunur
([DTI] §5.3); ~40 ek satır yazılır.

---

## 7. KARAR D — PII / KVKK: compliance-agent BU TURDA ZORUNLUDUR (engelleyici)

### 7.1 Karar

**EVET.** Önceki iki şablonda compliance-agent'ın rolü "şablon PII üretmediğini doğrulamak"
ile sınırlıydı ([DTI] §9.6: *"PII yoktur"*). **Bu turda durum niteliksel olarak farklıdır:**
`telehealth` modülü, canlıya çıktığı andan itibaren **ziyaretçilerden kişisel veri toplayan
bir işleme faaliyeti** başlatır ve toplanan veri, **çıkarım yoluyla sağlık verisidir**
("X kişisi Y tarihinde bir psikiyatriste randevu aldı" → KVKK md.6 özel nitelikli veri
sınırına temas eder).

compliance-agent'ın onayı **engelleyicidir**: onay olmadan `POST /appointments` ucu
birleştirilemez (merge edilemez).

### 7.2 Demo doktor verisi — kurgusallık ZORUNLU (bağlayıcı)

1. **`isVerified` şablonda DAİMA `false`.** Kullanıcının "isVerified: true" isteği
   **REDDEDİLDİ**: "doğrulanmış hekim" rozeti, gerçek bir kimlik/diploma denetimine dair bir
   **iddiadır**; kurgusal profillerde yayına sızarsa tüketiciyi yanıltır (ve gerçek bir
   hekimle aynı adı taşıyorsa o kişi adına beyanda bulunmuş olur).
2. **Doktor adları** compliance-agent tarafından **marka/gerçek kişi çakışması taramasından**
   geçirilir ([DTI] §9.4 "Mimarist" → "Kütle Yapı" emsali). Ad-soyad kombinasyonu, tanınmış
   bir hekimle eşleşmeyecek şekilde seçilir.
3. **Her demo doktorun `bio` alanının İLK CÜMLESİ zorunludur:** *"Bu, örnek (demo) bir doktor
   profilidir; gerçek bir hekimi temsil etmez."*
4. Import sonucunda `warnings[]`: *"4 örnek doktor profili ve 6 uzmanlık oluşturuldu; yayına
   almadan önce gerçek bilgilerinizle değiştirin veya silin."*
5. Uzmanlık adları jenerik tıbbi terimlerdir (Kardiyoloji, Dermatoloji, Nöroloji, Psikiyatri,
   Aile Hekimliği, Çocuk Sağlığı) — marka değildir, serbesttir.
6. İletişim yer tutucuları [DTI] §9.5 ile AYNI (`info@example.com`, `+90 212 000 00 00`).
   Doktor e-postası/telefonu **HİÇ TUTULMAZ** (şemada alan yoktur — veri minimizasyonu).

### 7.3 compliance-agent'ın teslim edeceği (bağlayıcı çıktı)

`.claude/compliance-notes-telehealth.md`:
- İşleme envanteri: hangi alan, hangi hukuki sebep, hangi saklama süresi.
- **Randevu formu açık rıza metni** ve KVKK aydınlatma metni **iskeleti** (gerçek hukuki
  metin DEĞİL — [EPT] §4.3 kuralı: yer tutucu, hukuk danışmanı doldurur).
- **Saklama/anonimleştirme politikası.** Başlangıç önerisi (nihai karar compliance-agent'ın):
  randevu bitiminden **12 ay** sonra `patientName` → `"Silinmiş Kayıt"`, `patientEmail` →
  `null`; satır SİLİNMEZ (istatistik bütünlüğü). Mevcut `contact-retention` / `cart-retention`
  süpürücüleriyle AYNI desen; süpürücü **backend-agent** tarafından yazılır.
- Silme/erişim talebi (KVKK md.11) akışının hangi mevcut uçla karşılandığı.
- **Kayıt (recording) yasağının** (§4.4 madde 5) yazılı teyidi.

### 7.4 Tıbbi içerik ve iddia denetimi (compliance-agent — engelleyici)

- **Tanı/tedavi vaadi içeren hiçbir metin YAZILMAZ** ("iyileşin", "tedavi edin", "teşhis
  alın"). Şablon metinleri **hizmet tanımıyla** sınırlıdır ("uzmanla görüntülü görüşün").
- **Acil durum uyarısı ZORUNLUDUR** (§6.6).
- Doğrulanamayan istatistik/başarı iddiası yasaktır (§6.5).
- Reçete/e-reçete, tıbbi kayıt, laboratuvar sonucu ve sigorta/SGK entegrasyonu
  **KAPSAM DIŞIDIR** — hiçbiri ima edilmez.

---

## 8. Güvenlik (security-agent — engelleyici denetim)

1. **`POST /appointments/{id}/meeting-token`** — kontratın en riskli yeni yüzeyi:
   - `LIVEKIT_API_SECRET` **hiçbir yanıtta, logda veya hata gövdesinde** görünmemeli.
   - Token TTL ≤ `LIVEKIT_TOKEN_TTL_MIN` (varsayılan 15 dk) ve **yalnızca o randevunun
     `meetingRoomName`'ine** kapsamlı (`roomJoin: true, room: <ad>`); `roomCreate`,
     `roomAdmin`, `roomList`, `ingressAdmin` grant'ları **VERİLMEZ**.
   - Katılımcı kimliği (`identity`) tahmin edilebilir ve KİŞİSEL VERİ İÇERMEZ
     (`patient:<appointmentId>` / `doctor:<doctorId>`) — e-posta identity'ye YAZILMAZ.
   - Yetkilendirme §4.5'teki 4 yolun DIŞINDA hiçbir yoldan geçmemeli (IDOR testi).
   - Hız sınırı **10 istek/dk**; her üretim `logAudit(action: "telehealth.meeting_token.issued")`.
2. **`accessToken`**: `lib/tokens.ts` ile üretilir (kriptografik rastgelelik), **hash'i**
   saklanır, karşılaştırma sabit zamanlı; token URL'de taşındığı için Referrer-Policy ve
   log'lara sızmama kontrolü yapılır (query string erişim loglarında görünebilir — kabul
   edilen risk, TTL yerine randevu penceresiyle sınırlıdır, §4.5).
3. **`POST /appointments`** kimlik doğrulaması olmayan bir YAZMA ucudur: hız sınırı (5/dk),
   e-posta format doğrulaması, `startsAt`'in gerçekten bir slot olduğunun **sunucuda**
   doğrulanması (istemciden gelen fiyat/süre **ASLA** kabul edilmez — `priceCents`
   `DoctorProfile`'dan okunur; checkout'taki mevcut değişmezle aynı sınıf).
4. **Randevu listeleme RBAC'i:** `/admin/telehealth/appointments` **ADMIN + MANAGER**;
   **EDITOR DIŞLANIR** — EDITOR'ün alanı blog/medya/sayfa içeriğidir
   (`.claude/architect-scope-rbac-5-tier.md` §5.3) ve hasta PII'sine erişmesi için hiçbir iş
   gerekçesi yoktur (veri minimizasyonu). Doktor/uzmanlık CRUD'u ADMIN + MANAGER
   (içerik yönetimi), okuma panel kapısı.
5. **Public yanıtlarda sızıntı kontrolü:** `GET /doctors*` yanıtı `userId`, `avatarMediaId`
   dışında iç kimlik, e-posta veya `Appointment` verisi TAŞIMAZ. Slot yanıtı yalnızca
   `available: boolean` döner — **"kim rezerve etti" ASLA sızmaz.**
6. Modül kapalıyken tüm public/admin tele-sağlık uçları **404** (`requireModuleEnabled`).

---

## 9. KARAR E — Ajan haritası, sıra ve paralellik

### 9.1 Kullanıcının önerdiği sıranın denetimi

Önerilen: `architect → db-agent → backend-agent → ui-designer → frontend-agent → qa-agent`.
**Eksik olan 5 ajan** (`.claude/CLAUDE.md` sorumluluk tablosuna göre ZORUNLU):

| Eksik ajan | Neden ZORUNLU |
|---|---|
| **integration-agent** | LiveKit bir 3. parti entegrasyondur → tablo gereği TEK SAHİP. backend-agent'ın LiveKit yazması sınır ihlalidir. |
| **security-agent** | Kimlik doğrulamasız yazma ucu + token üretimi + WebRTC yüzeyi (§8). Engelleyici. |
| **compliance-agent** | Sağlık verisine temas eden PII (§7). Engelleyici. |
| **devops-agent** | `LIVEKIT_*` env'leri, `.env.example`, compose, CI secret'ları, Docker imajı (+ `assets/telehealth-clinic/**` kopyalama). |
| **seo-agent** | `/doctors*` public sayfaların meta/canonical/sitemap/structured data'sı — frontend-agent bu alana GİRMEZ. |

Ayrıca **code-quality-agent** (4 yeni bağımlılık + lisans/lint) ve **documentation-agent**
(openapi + ARCHITECTURE.md + CHANGELOG) standart akışın parçasıdır. **observability-agent**
opsiyoneldir (§9.5 son satır). **notification-agent bu turda DEVREDE DEĞİLDİR** (§11).

### 9.2 Bağlayıcı yürütme sırası

```
architect (bu doküman)
  → db-agent                                  [tek başına, herkes bunu bekler]
  → backend-agent  ∥  ui-designer  ∥  devops-agent
  → integration-agent  ∥  frontend-agent  ∥  seo-agent
  → backend-agent (şablon parçası: telehealth-clinic.ts)
  → security-agent  ∥  compliance-agent       [ENGELLEYİCİ]
  → code-quality-agent
  → qa-agent
  → documentation-agent
  → devops-agent (CI/imaj doğrulaması)
  → observability-agent (opsiyonel)
```
Sıralamanın operasyonel planı (kim neyi bekliyor, hangi dosya kilitli) **release-coordinator**'ındır.

### 9.3 db-agent (İLK)
Dosyalar: `backend/prisma/schema.prisma`, `backend/prisma/migrations/<ts>_add_telehealth_module/`.
- §3.1-§3.7'deki enum + 4 model + karşı-ilişkiler **birebir**.
- Kabul: `prisma migrate dev` temiz; elle yazılmış SQL YOK; `prisma generate` sonrası
  backend `typecheck` yalnızca BEKLENEN (henüz yazılmamış iş mantığı) hatalarını verir.

### 9.4 backend-agent
Dosyalar: `modules/telehealth/{telehealth.routes.ts, telehealth.admin.routes.ts,
telehealth.schemas.ts, lib/timezone.ts, lib/availability.ts, lib/booking.ts}`,
`lib/module-registry.ts` (§2.3), `schemas/entities.ts`, `mappers/index.ts`, `app.ts` kaydı.
- **`lib/livekit.ts`'e ve meeting-token ucuna DOKUNMAZ** (integration-agent).
- Birim testleri (zorunlu): slot üretimi (DST ileri/geri, gün sınırı, doktor dilimi ≠ sunucu
  dilimi), `dayOfWeek` ISO↔JS dönüşümü, rezervasyon tamponu, `409 SLOT_TAKEN` yarış senaryosu.
- Saklama süpürücüsü (§7.3) compliance-agent'ın politikası KESİNLEŞTİKTEN sonra yazılır.

### 9.5 Diğer ajanlar — kısa görev listeleri
- **ui-designer** → `.claude/design-notes-telehealth.md` (kod DEĞİL): palet + WCAG AA
  doğrulaması (§6.4 uyarısı), doktor kartı, slot düğmesi durumları (müsait/dolu/geçmiş/
  seçili), saat dilimi rozeti, konsültasyon odası kontrol çubuğu, bekleme odası ve
  "yapılandırılmamış" durum paneli, geri sayım tipografisi, `preview.svg`.
- **devops-agent** → `.env.example`, `docker-compose*.yml`, CI secret'ları,
  `scripts/copy-static-assets.js`'in yeni varlık klasörünü kapsaması, LiveKit sunucusunun
  **compose'a EKLENMEDİĞİNİN** dokümante edilmesi.
- **integration-agent** → `livekit-server-sdk`, `modules/telehealth/lib/livekit.ts`,
  `POST /appointments/{id}/meeting-token`, §4.5 katılım penceresi, §8 grant kapsamı.
  Fiyat/slot matematiğini **kendisi yazmaz**.
- **frontend-agent** → §5.1/§5.2; LiveKit token'ını uçtan alır; **meta/SEO'ya dokunmaz**;
  `templateKey`'e koşullanan bileşen yazmaz.
- **seo-agent** → `/doctors` ve `/doctors/[slug]` meta/canonical/OG, `sitemap.ts` girdisi,
  `schema.org` **`Physician`/`MedicalWebPage`** structured data. **Bağlayıcı:** structured
  data'da `aggregateRating` **KULLANILMAZ** (değerlendirme sistemi yok, §3.3) ve tıbbi iddia
  içeren alanlar doldurulmaz. `/consultation/[id]` **`noindex`** olmalıdır.
- **security-agent** → §8 (engelleyici). **compliance-agent** → §7 (engelleyici).
- **code-quality-agent** → 4 yeni bağımlılığın lisans/boyut denetimi, `any` yok, lint/format,
  saat dilimi kütüphanesi EKLENMEDİĞİNİN doğrulanması.
- **documentation-agent** → openapi.yaml (§12'deki liste), `ARCHITECTURE.md` yeni §
  (Tele-Sağlık modülü), `README`, `CHANGELOG.md`.
- **observability-agent** (opsiyonel) → `telehealth.appointment.created` /
  `telehealth.meeting_token.issued` audit action'ları, `503 LIVEKIT_NOT_CONFIGURED` ve
  `409 SLOT_TAKEN` oranları için log alanları.

### 9.6 [DTI] / [EPT]'ye resmi tadilatlar (TEK liste — başka tadilat yoktur)

| Madde | Tadilat |
|---|---|
| [DTI] §3 `DemoTemplateDefinition` | `requiredModules: string[]` + `telehealth` alanları eklendi (§6.1) |
| [DTI] §3.2 "`SiteModule` YAZILMAZ" | **Dar tadilat:** yalnızca `requiredModules` içindeki anahtarlar, yalnızca `enableRequiredModules: true` AÇIK opt-in ile açılabilir (§2.6). `SiteCustomCode`/`User`/`ContactForm` yasakları AYNEN durur. |
| [DTI] §3.3 tavanlar | `MAX_TEMPLATE_SPECIALTIES = 12`, `MAX_TEMPLATE_DOCTORS = 8`, `MAX_TEMPLATE_DOCTOR_AVAILABILITY = 21` eklendi. `MAX_TEMPLATE_ASSETS = 40` ve `MAX_TEMPLATE_ASSET_BYTES` DEĞİŞMEDİ. |
| [DTI] §3.4 token tablosu | `ref:specialty-slug:<slug>` eklendi (§6.2) |
| [DTI] §4.5 `preview.webp` | Fiilî uygulama `preview.svg`'dir; üçüncü şablon onu izler (§6.3) |
| [DTI] §6.1 yıkıcılık matrisi | `siteModules` satırı eklendi (§6.7) |
| [DTI] §6.3 `ImportDemoTemplateRequest` | `enableRequiredModules?: boolean = false` eklendi |
| [EPT] §4.5 sahte sipariş reddi | Aynı ilke **randevulara** genişletildi ve **yapısal** hâle getirildi (§3.6) |

Diğer her şey (uçlar, RBAC, hız sınırı, `confirm`, `force`, telafi/rollback, PNG/SVG
politikası, "yeni blok tipi YOK", telif kuralları) **aynen geçerlidir.**

---

## 10. QA kapsamı (qa-agent)

**Birim (backend-agent + qa-agent):**
1. Slot üretimi: doktor `America/New_York`, sunucu UTC → Pzt 09:00 yerel slot **doğru
   ana** karşılık geliyor.
2. **DST:** ilkbahar geçişinde var olmayan duvar saati için slot ÜRETİLMİYOR; sonbaharda
   çift geçen saatte TEK slot üretiliyor.
3. `dayOfWeek` ISO(1-7) ↔ JS(0-6) dönüşümü; Pazar sınırı.
4. Çifte rezervasyon: eşzamanlı iki `POST /appointments` → biri `201`, diğeri `409 SLOT_TAKEN`.
5. `telehealth-clinic` tanımı `PageBlockListSchema` + `SlideLayersSchema`'dan geçiyor; tüm
   `asset:` / `ref:specialty-slug:` token'ları çözülüyor; yeni tavanlar zorlanıyor.

**E2E (`frontend/tests/e2e/`):**
6. `telehealth-template-import.spec.ts`: ADMIN olarak `telehealth-clinic` uygula → `201`;
   admin kartı görünüyor; 6 uzmanlık + 4 doktor + müsaitlik oluştu; **`appointments` tablosu
   BOŞ** (§3.6 kabul kriteri) ve **hiçbir `User` satırı yaratılmadı** (§2.5).
7. Modül kapalıyken import → `201` + ilgili `warnings[]`; `enableRequiredModules: true` ile
   import → modül açık ve `/doctors` **200** dönüyor.
8. `telehealth-public-booking.spec.ts`: `/doctors` listesi + uzmanlık filtresi → doktor
   detayına git → slot seç → randevu al → onay ekranında katılım bağlantısı var.
9. **Saat dilimi (bağlayıcı test tekniği):** aynı doktor sayfası
   `test.use({ timezoneId: "America/New_York" })` ve `"Europe/Istanbul"` ile iki kez
   açıldığında **aynı ana** karşılık gelen, **farklı yerel saat** etiketleri gösteriyor.
10. `/consultation/[id]`: LiveKit yapılandırılmamışken **"demo/yapılandırılmamış" paneli**
    görünüyor, sahte video YOK, geri sayım çalışıyor, randevu bilgileri doğru.
11. Yetkilendirme: `?t=` token'ı olmadan/yanlış token ile `/consultation/[id]` → erişim yok;
    randevu penceresi dışında token isteği → `409 APPOINTMENT_NOT_JOINABLE`.
12. RBAC: EDITOR `/admin/telehealth/appointments`te **403**; MANAGER görüyor.
13. Şablonun idempotency/`confirm`/`force`/hız sınırı testleri [DTI] §12'den **miras alınır**,
    yeniden yazılmaz — yalnızca yeni `templateKey` ile parametrize edilir.

**Not (mevcut bilinen davranış):** public sayfalar 60 sn ISR gecikmesiyle güncellenir —
e2e testleri `toPass` + `reload` ile **yoklamalıdır**; bu bir hata değildir ve "düzeltilmez".

---

## 11. Bilinçli KAPSAM DIŞI + backlog

| Öğe | Neden | Branş |
|---|---|---|
| Örnek/sahte randevular | §3.6 (7 gerekçe) | — (yapısal olarak kapalı) |
| `MeetingRoom` tablosu | §3.5 | — |
| Görüşme kaydı (LiveKit Egress) | §4.4 madde 5 | `feature/telehealth-recording` |
| Randevu onay/hatırlatma e-postaları | Yeni `EmailTemplatePurpose` değeri = geri alınamaz `ALTER TYPE`; tetikleyici + kuyruk **notification-agent**'ın alanıdır ve bu turun asıl isteği (şablon + oda) değildir | `feature/telehealth-appointment-emails` (notification-agent ∥ integration-agent) |
| Randevu ödemesi (Stripe) | §4.3 | `feature/telehealth-payments` (integration-agent) |
| Doktor değerlendirme/puanlama | §3.3 | `feature/doctor-reviews` |
| Çoklu uzmanlık (ara tablo) | §3.3 | `feature/doctor-multiple-specialties` |
| Tatil/izin/istisna takvimi | §3.4 | `feature/doctor-time-off` |
| Randevu erteleme + iptal edilen slotun serbest kalması | §4.3 | `feature/appointment-reschedule` |
| `featured-doctors` page-builder bloğu | §5.3 | `feature/page-builder-featured-doctors` |
| Semptom/şikâyet formu (intake) | §3.5 — özel nitelikli veri | `feature/telehealth-intake-form` |
| Doktor tarafı için ayrı panel/rol | v1'de ADMIN/MANAGER yeterli | `feature/doctor-portal` |
| Çok dilli doktor içeriği / `ContentEntityType.DOCTOR` | §3.8 | `feature/telehealth-i18n` |
| `SiteTemplate.HEALTHCARE` | §2.3 | `feature/site-template-healthcare` |
| E-reçete, tıbbi kayıt, sigorta/SGK | §7.4 | — |

---

## 12. `docs/architecture/openapi.yaml` — GEREKECEK eklemeler (bu adımda YAPILMADI)

Bu turda kontrat dosyasına dokunulmadı; **backend-agent (uçlar) + documentation-agent
(açıklamalar)** aşağıdaki eklemeleri yapar ve **kontrat, implementasyondan ÖNCE** güncellenir:

| Ekleme | Yer |
|---|---|
| `TeleHealth` tag'i (modül kapsamı, modül kapalıyken 404, RBAC gerekçesi) | `tags` |
| `Specialty`, `DoctorProfile`, `DoctorAvailability`, `AvailabilitySlot`, `Appointment`, `AppointmentStatus` | `components.schemas` |
| `CreateAppointmentRequest` (ad, e-posta, `doctorSlug`, `startsAt`, `consent: true`), `CreateAppointmentResult` (ham `accessToken` **bir kez**) | `components.schemas` |
| `MeetingTokenResponse` (`token`, `serverUrl`, `roomName`, `expiresAt`) | `components.schemas` |
| `GET /doctors`, `GET /doctors/{slug}`, `GET /doctors/{slug}/slots`, `POST /appointments`, `GET /appointments/{id}`, `POST /appointments/{id}/meeting-token`, `POST /appointments/{id}/cancel`, `POST /appointments/{id}/complete` | `paths` (public) |
| `GET/POST/PATCH/DELETE /admin/telehealth/specialties[/{id}]`, `.../doctors[/{id}]`, `.../doctors/{id}/availability`, `GET /admin/telehealth/appointments` | `paths` (admin) |
| `DoctorSlug`, `AppointmentId`, `SpecialtyId` yol parametreleri | `components.parameters` |
| Yeni hata kodları: `SLOT_TAKEN` (409), `APPOINTMENT_NOT_JOINABLE` (409), `LIVEKIT_NOT_CONFIGURED` (503) | `ErrorCode` sözlüğü |
| `DemoTemplateSummary.contents`: `specialties`, `doctors`, `availabilityWindows`; `requiredModules: string[]`; `replaces` enum'ına `siteModules` | `DemoTemplateSummary` |
| `ImportDemoTemplateRequest.enableRequiredModules` (default `false`) | `ImportDemoTemplateRequest` |
| `DemoTemplateImportResult.counts`: `specialties`, `doctors`, `availabilityWindows`; `enabledModules: string[]` | `DemoTemplateImportResult` |
| `x-site-rbac`: appointments okuma ADMIN/MANAGER (EDITOR **dışlanır**, §8.4) | ilgili path'ler |

---

## 13. KARAR F — "Tek commit" isteği

**Karar: tek commit ÇALIŞMA YÖNTEMİ olarak REDDEDİLDİ, SONUÇ olarak KABUL EDİLDİ.**

Bu iş 8+ ajan, ~45 dosya, 1 migration, 4 yeni bağımlılık ve 2 engelleyici denetim içeriyor.
Hepsini tek commit'e sıkıştırmak:
- **Conventional Commits'i anlamsızlaştırır** — tek satır hem `feat(db)` hem `feat(telehealth)`
  hem `chore(devops)` hem `test(e2e)` olamaz; CHANGELOG üretimi bozulur.
- **`git bisect`'i öldürür** — DST hatası mı, LiveKit token hatası mı, migration hatası mı
  ayırt edilemez.
- **DoD'yi denetlenemez kılar** — security-agent/compliance-agent'ın neyi onayladığı bir
  commit sınırına karşılık gelmez.
- **Geri alınamaz kılar** — LiveKit entegrasyonunu geri almak için tüm modülü geri almak gerekir.

**Bağlayıcı çözüm:** `feature/telehealth-clinic-template` branşında **mantıksal commit'ler**,
master'a **squash-merge**. Kullanıcı master'da tek commit görür; branş geçmişi incelenebilir
kalır. Commit sırası:

```
1. feat(db): tele-sağlık şeması — uzmanlık, doktor, müsaitlik, randevu
2. feat(telehealth): doktor/uzmanlık/randevu API'leri + saat dilimi duyarlı slot üretimi
3. feat(telehealth): LiveKit konsültasyon odası token'ı        # integration-agent
4. feat(telehealth): doktor listesi, randevu takvimi ve konsültasyon arayüzü
5. feat(seo): doktor sayfaları meta + structured data
6. feat(demo-templates): telehealth-clinic hazır şablonu
7. test(e2e): tele-sağlık randevu ve şablon akışları
8. chore(devops): LIVEKIT_* ortam değişkenleri ve varlık kopyalama
9. docs(openapi,architecture): TeleHealth tag'i, ARCHITECTURE ve CHANGELOG
```

Squash-merge mesajı: `feat(telehealth): Global TeleHealth / Online Clinic modülü ve hazır
şablonu` + gövdede yukarıdaki 9 maddenin özeti.

---

## 14. Definition of Done

- [ ] `add_telehealth_module` migration temiz uygulandı; elle SQL yok (db-agent)
- [ ] `telehealth` `MODULE_REGISTRY`'de `defaultEnabled: false`; kapalıyken tüm uçlar 404 (backend-agent)
- [ ] Slot üretimi TEK yardımcıda; DST + çoklu saat dilimi birim testleri yeşil (backend-agent)
- [ ] Rezervasyon `runSerializable` + `@@unique([doctorId, startsAt])` ile korunuyor; `409 SLOT_TAKEN` (backend-agent)
- [ ] Uçlar openapi.yaml ile **BİREBİR**; §12'deki tüm eklemeler yapıldı (backend-agent + documentation-agent)
- [ ] LiveKit token ucu yalnızca integration-agent'ın dosyalarında; yapılandırılmamışken `503` + dürüst UI, **sahte video YOK** (integration-agent + frontend-agent)
- [ ] Token grant kapsamı/TTL/IDOR/identity denetimi imzalandı (security-agent — **engelleyici**)
- [ ] `.claude/compliance-notes-telehealth.md` teslim edildi; açık rıza + saklama politikası tanımlı; demo doktorlarda `isVerified: false` ve demo uyarı cümlesi var; **importer'da `appointment`/`user` yazan çağrı YOK** (compliance-agent — **engelleyici**)
- [ ] Acil durum uyarısı + tıbbi iddia denetimi geçti (compliance-agent)
- [ ] Tasarım tokenleri + WCAG AA (özellikle `#0D9488` metin kontrastı) doğrulandı (ui-designer)
- [ ] `/doctors*` meta/canonical/sitemap/structured data; `aggregateRating` YOK; `/consultation/*` `noindex` (seo-agent)
- [ ] `telehealth-clinic` tanımı Zod + token testlerinden geçiyor; yeni tavanlar zorlanıyor (backend-agent + qa-agent)
- [ ] Hiçbir public/site bileşeni `templateKey` bilmiyor (§2.2) (code-quality-agent)
- [ ] 4 yeni bağımlılık lisans/politika onayı; saat dilimi kütüphanesi eklenmedi (code-quality-agent)
- [ ] E2E 6-13 yeşil (qa-agent)
- [ ] `LIVEKIT_*` env'leri `.env.example`/compose/CI'da; varlıklar `dist/` ve Docker imajında; **kod değişikliğinden sonra `docker compose up --build -d`** (devops-agent)
- [ ] ARCHITECTURE.md + README + CHANGELOG (documentation-agent); CI yeşil
