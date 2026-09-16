# Architect Scope — E-posta OTP Doğrulaması + Misafir Randevudan Hesap Oluşturma

> **Durum:** Karar verildi. **Bir ENGELLEYİCİ onay bekliyor** (security-agent, §6).
> **Kapsam:** İKİ İLİŞKİLİ özellik, TEK ortak altyapı üzerinde:
> **A)** `POST /auth/register` sonrası 6 haneli e-posta doğrulama kodu (OTP);
> **B)** misafir randevu ödemesi tamamlanınca `patientEmail` için hesap açılması ve
> randevunun o hesaba bağlanması.
> **İlgili dosyalar:** `docs/architecture/openapi.yaml` (bu görevde GÜNCELLENDİ — 3 yeni uç,
> `/auth/register` + `/auth/login` sözleşmesi DEĞİŞTİ), `backend/prisma/schema.prisma`,
> `backend/src/modules/auth/*`, `backend/src/modules/telehealth/lib/booking.ts`,
> `backend/src/lib/rate-limit.ts`, `frontend/src/app/(auth)/register/page.tsx`.
> **Bu doküman bağlayıcıdır.** Ajanlar arası çelişkide `openapi.yaml` + bu doküman hakemdir.
> **Branş:** `feature/email-otp-and-guest-account`.

---

## 0. Yönetici özeti — sorun ne, sorun ne DEĞİL

`User.emailVerifiedAt DateTime?` **zaten vardır ama HİÇBİR YERDE YAZILMAZ.** Tüm kod tabanında
iki referansı var (`mappers/index.ts:196` okur, `schemas/entities.ts:39` DTO'ya koyar) — hiçbir
servis onu SET etmez, hiçbir guard onu OKUMAZ. Yani bugün her hesap "doğrulanmamış"tır ve bunun
hiçbir sonucu yoktur. Özellik A bu yarım kalmış alanı tamamlar.

Özellik B ise **yeni bir desendir**: bugün ne telehealth (`telehealth.routes.ts:337,466`) ne de
e-ticaret (`checkout`) tarafında `request.user?.id ?? null` dışında bir şey yapılmaz — misafir
misafir kalır. "Ödeme sonrası hesap aç" mekanizması sıfırdan kurulacaktır.

| Katman | Mevcut durum |
|---|---|
| SMTP gönderimi + şablon motoru (`lib/mail.ts`, `email-templates.service.ts`) | VAR, çalışıyor |
| Link tabanlı tek kullanımlık token deseni (`PasswordResetToken`) | VAR — ama LİNK, kod DEĞİL |
| Route-level hız sınırı desenleri (`lib/rate-limit.ts`) | VAR, zengin |
| Hasta portalı "Randevularım" (`/patient/bookings`, `patientUserId` filtreli) | VAR, **DEĞİŞMEZ** |
| Ödeme onayının TEK paylaşılan hook'u (`lib/booking.ts::confirmBookingPayment`) | VAR |
| `emailVerifiedAt` yazımı / doğrulama gate'i | **YOK** ← Özellik A |
| OTP (sayısal kod) üretim/doğrulama altyapısı | **YOK** ← ORTAK ALTYAPI |
| Misafirden hesap sağlama (provisioning) | **YOK** ← Özellik B |

**İki özelliğin ortak noktası tek bir cümledir:** "bir posta kutusunun sahipliğini 6 haneli bir
kodla kanıtlat." Özellik B'nin "hesabını aktive et" akışı, Özellik A'nın OTP altyapısının
İKİNCİ BİR AMACIDIR — ayrı bir sistem DEĞİL (§1).

---

## 1. KARAR: Ortak OTP altyapısı — **tek yeni model `EmailVerificationCode` + `lib/otp.ts`**

### 1.1 Karar

Yeni model: **`EmailVerificationCode`**, `purpose` ayrımlı
(`EMAIL_VERIFICATION` | `ACCOUNT_ACTIVATION`). Yeni yardımcı: **`backend/src/lib/otp.ts`**
(üretim + hash + sabit-zamanlı karşılaştırma + doğrulama/tüketme).
**İki ayrı OTP sistemi AÇILMAZ**; her iki özellik de AYNI tabloyu, AYNI üretici/doğrulayıcıyı,
AYNI deneme sayacını ve AYNI hedef-başına kısıtları kullanır. Amaca göre DEĞİŞEN tek şey
**TTL** ve **hangi ucun kabul ettiğidir** (§3.3, §4.5).

### 1.2 Gerekçe — neden `PasswordResetToken` GENİŞLETİLMİYOR

Görev bu seçeneği açıkça sordu. Reddedildi, ve gerekçesi kozmetik değil **fonksiyoneldir**:

1. **`PasswordResetToken.tokenHash` `@unique`'tir ve arama GLOBAL yapılır**
   (`auth.service.ts:246` → `findUnique({ where: { tokenHash } })`). Bu, 256 bitlik opak bir
   token için doğrudur. **6 haneli bir kod için KATASTROFİKTİR:** global arama, saldırganın
   `000000`…`999999` denerken *herhangi bir kullanıcının* canlı kodunu yakalamasına izin verir —
   yani saldırı, kullanıcı başına 10⁶ yerine **tüm canlı kodlar havuzuna karşı** çalışır. Ayrıca
   `@unique` kısıtı, iki kullanıcının aynı 6 haneyi çekmesi durumunda (10⁶ alanda kaçınılmaz)
   kayıt akışını rastgele bozardı. Yeni modelde **`codeHash` `@unique` DEĞİLDİR ve arama
   HER ZAMAN `userId` ile başlar** (§1.4) — bu, iki modelin uzlaşmaz biçimde farklı olduğu
   noktadır ve tek başına kararı verdirir.
2. **Hash fonksiyonu farklı olmak ZORUNDA.** `PasswordResetToken` düz `sha256` kullanır
   (`lib/tokens.ts::hashToken`) — 256 bit girdi için yeterli. 6 haneli kod için düz sha256, bir
   DB sızıntısında saniyeler içinde 10⁶ elemanlık bir gökkuşağı tablosuyla ÇÖZÜLÜR. OTP, anahtarlı
   bir HMAC ile "biberlenmek" zorundadır (§3.2). Tek tabloda iki farklı hash semantiği taşımak
   ileride kaçınılmaz olarak yanlış fonksiyonun çağrılmasıyla sonuçlanır.
3. **Deneme sayacı yalnızca OTP'ye aittir.** `attemptCount` kolonu `PasswordResetToken` için
   anlamsızdır (tahmin edilemez token); orada ölü bir kolon olurdu.
4. **Yaşam döngüsü farklı.** Parola sıfırlama token'ı 1 saat yaşar ve amacı tektir; OTP'nin
   TTL'i amaca göre değişir (10 dk / 24 saat, §3.3) ve "yeni kod eskiyi öldürür" kuralı vardır.

Aynı tabloya iki farklı güvenlik modeli sığdırmak, `.claude/architect-scope-smtp-settings.md`
§1.2'deki bağlayıcı ilkenin ihlali olurdu: **sınır bir mapper/if disiplini değil, bir tablo
sınırı olmalıdır.**

### 1.3 Şema taslağı (db-agent uygular — niyet ve alan adları BAĞLAYICI, Prisma sözdizimi db-agent'ın)

```prisma
/// Ortak OTP altyapısı — bkz. .claude/architect-scope-guest-account-otp.md §1.
/// `PasswordResetToken`'dan BİLEREK AYRIDIR (§1.2): orası 256-bit opak token için
/// GLOBAL `@unique` arama yapar, burası DÜŞÜK ENTROPİLİ (10^6) bir kod için
/// YALNIZCA `userId` kapsamında arama yapar. İki model KARIŞTIRILMAZ.
enum EmailVerificationPurpose {
  /// Özellik A — `POST /auth/register` sonrası, `POST /auth/verify-email` tüketir.
  EMAIL_VERIFICATION
  /// Özellik B — misafir randevu ödemesiyle açılan hesap; `POST /auth/activate-account`
  /// tüketir (kod doğrulaması + İLK parolanın belirlenmesi AYNI istekte).
  ACCOUNT_ACTIVATION
}

model EmailVerificationCode {
  id           String                   @id @default(uuid())
  userId       String
  purpose      EmailVerificationPurpose
  /// HMAC-SHA256 — DÜZ sha256 DEĞİL (§3.2, bağlayıcı). Düz metin kod ASLA saklanmaz.
  /// `@unique` BİLEREK YOKTUR (§1.4).
  codeHash     String
  expiresAt    DateTime
  /// Başarıyla kullanıldığında VEYA yeni bir kod üretilip bu geçersiz kılındığında dolar.
  consumedAt   DateTime?
  /// Başarısız deneme sayacı. `>= 5` ise kod ÖLÜDÜR (§3.4) — ayrı bir `invalidatedAt`
  /// kolonu EKLENMEZ, geçerlilik yüklemi bu üç alanla tam olarak ifade edilir.
  attemptCount Int                      @default(0)
  createdAt    DateTime                 @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// Canlı kod araması (`userId` + `purpose` + `consumedAt: null`, `createdAt desc`)
  /// ve hedef-başına üretim sayımı (§3.6) BU indeksi kullanır.
  @@index([userId, purpose, createdAt])
  @@map("email_verification_codes")
}
```

`User` tarafına ters ilişki: `emailVerificationCodes EmailVerificationCode[]`.

### 1.4 `codeHash` neden `@unique` DEĞİL — ATLANMASI KOLAY, ZORUNLU madde

Bu, tüm tasarımın güvenlik ekseni olduğu için ayrı bir başlıkta tekrarlanıyor:

- **Arama HER ZAMAN `userId` ile başlar.** `findFirst({ where: { userId, purpose,
  consumedAt: null }, orderBy: { createdAt: "desc" } })` → tek satır → o satırın hash'i
  girdiden hesaplananla **sabit zamanlı** karşılaştırılır.
- **`findFirst({ where: { codeHash } })` YAZMAK YASAKTIR.** Böyle bir sorgu, saldırgana
  "herhangi bir kullanıcının kodunu bul" yeteneği verir ve saldırı maliyetini kullanıcı başına
  10⁶'dan sistemdeki canlı kod sayısına böler. code-quality-agent bu deseni PR denetiminde arar.
- Kullanıcı e-postadan bulunur (`user.findUnique({ where: { email } })`), kod ondan SONRA
  aranır. Kullanıcı yoksa yine de sabit maliyetli bir sahte karşılaştırma yapılır ve **aynı**
  `401` döner (§4.3).

---

## 2. KARAR (Özellik A): Token semantiği — **`register` token DÖNDÜRMEZ**

### 2.1 Karar

`POST /auth/register` artık `201 AuthResponse` DEĞİL, **`202 RegistrationPendingVerification`**
döner. Refresh cookie SET EDİLMEZ. Token çifti **YALNIZCA** `POST /auth/verify-email`
başarılı olduğunda üretilir (mevcut `issueTokenPair` ile, yeni bir token yolu icat edilmez).

**`middleware/authenticate.ts` HİÇ DEĞİŞMEZ.**

### 2.2 Gerekçe — neden "token ver + korumalı uçları gate'le" REDDEDİLDİ

Görev bu iki seçeneği karşılaştırmamı istedi. İkinci seçenek (register token döndürsün, backend
tüm korumalı uçları `emailVerifiedAt` ile kapatsın) bu kod tabanında **çok daha invazivdir**:

1. **Patlama yarıçapı 254 uç.** `emailVerifiedAt` gate'i `authenticate.ts`'e konulursa
   sözleşmedeki *tüm* korumalı uçların davranışı bir anda değişir; konulmazsa her uç için tek
   tek "doğrulanmamış kullanıcı bunu yapabilir mi?" kararı vermek gerekir — bu, kalıcı bir
   "unutulmuş uç" sınıfı yaratır (yeni bir uç eklendiğinde gate'i eklemeyi hatırlamak zorundasın).
2. **Mevcut kullanıcıların TAMAMI `emailVerifiedAt = null`.** `authenticate.ts`'e gate koymak,
   backfill olmadan **her mevcut kullanıcının her isteğini** anında 403'e düşürürdü.
3. **Kullanılamayan bir oturumun tüm maliyeti ödenir:** refresh token satırı DB'ye yazılır,
   cookie set edilir, audit "login SUCCESS" der — hiçbiri kullanılamayacak olsa bile. Bu, mevcut
   `login()`'ün 2FA dalında ZATEN reddedilmiş bir yaklaşımdır (`auth.service.ts:125-130`:
   "2FA açıksa şifre doğru olsa bile token çifti HEMEN verilmez").
4. **Emsal var ve bağlayıcı:** §10.4'ün 2FA challenge deseni tam olarak budur — "kimlik doğrulama
   yarım kaldıysa token VERİLMEZ". Yeni bir desen icat etmiyoruz, var olanı ikinci bir adım için
   tekrar kullanıyoruz.

Seçilen yaklaşımda doğrulanmamış bir kullanıcının **hiç access token'ı olmaz** — dolayısıyla
"hangi uç doğrulanmamışa açık?" sorusu HİÇ SORULMAZ. Güvenlik, eksiksiz sayılması gereken bir
liste yerine tek bir kapıda toplanır.

### 2.3 `POST /auth/login` davranışı (gerekli ve kaçınılmaz)

Register token vermese bile kullanıcı bir PAROLA belirlemiştir — doğrudan `/auth/login`
çağırarak doğrulamayı atlayabilirdi. Bu deliği kapatmak için:

`login()`, **şifre ve `status` kontrolünden SONRA, 2FA dalından ÖNCE**:
`user.emailVerifiedAt === null` ise token üretmez, `{ requiresEmailVerification: true, email }`
döner (sözleşmedeki `LoginRequiresEmailVerification`). `lastLoginAt` GÜNCELLENMEZ, refresh token
satırı OLUŞTURULMAZ.

**Kod OTOMATİK GÖNDERİLMEZ.** Kod üretiminin TEK yolu `register` ve
`resend-verification-code`'dur (§3.5). Login'in sessizce kod göndermesi, parolayı bilen birinin
kurbanın posta kutusunu, hedef-başına cooldown'ı atlatarak bombalamasına izin verirdi.

Audit: mevcut `auth.login` aksiyonu `status: "FORBIDDEN"` + `metadata.reason:
"email_not_verified"` ile yazılır (askıya alınmış hesap dalıyla AYNI desen).

### 2.4 Geriye dönük uyumluluk — **migration TÜM mevcut kullanıcıları "grandfather" eder**

**Karar:** migration `UPDATE users SET email_verified_at = created_at WHERE email_verified_at
IS NULL` yapar. Bu turdan ÖNCE var olan hiçbir hesap etkilenmez; doğrulama YALNIZCA bu turdan
SONRA açılan hesaplar için zorunludur.

**Gerekçe (backfill YAPMAMAK yerine neden bu):** alternatif, "yeni mi eski mi" ayrımını taşıyan
İKİNCİ bir kolon eklemekti (`emailVerificationRequired` gibi). Reddedildi: iki kolon, iki
doğruluk kaynağı ve kaçınılmaz bir tutarsızlık demektir. Backfill'den sonra
**`emailVerifiedAt IS NULL` TEK ve kesin bir anlam taşır: "bu hesap doğrulanmayı bekliyor"** —
gate tek bir yüklemle ifade edilir. Backfill'in "yalan söylediği" itirazı (bu kullanıcılar
gerçekten doğrulanmadı) kabul edilir ve bilinçlidir: bu bir *grandfathering* beyanıdır,
kolon yorumunda AÇIKÇA belgelenir.

### 2.5 `resetPassword()` de `emailVerifiedAt`i SET EDER — ATLANMASI KOLAY, YÜK TAŞIYAN madde

`auth.service.ts::resetPassword` başarılı olduğunda, `emailVerifiedAt` NULL ise onu da SET eder
(aynı transaction içinde).

**Gerekçe:** bir posta kutusuna gönderilen tek kullanıcılık sıfırlama bağlantısının kullanılması,
6 haneli bir OTP'den **daha güçlü** bir posta kutusu sahipliği kanıtıdır. Bunu yapmazsak üç akış
kilitlenir:

- **ADMIN'in oluşturduğu kullanıcılar** (`createPasswordResetToken`'ı paylaşan admin-users akışı)
  ilk parolalarını sıfırlama bağlantısıyla belirler — ama `emailVerifiedAt` NULL kalırsa login
  onları doğrulama ekranına yollar; oysa ortada bekleyen bir OTP kodu YOKTUR.
- **Organizasyon davetleri** aynı sorunu yaşar.
- **Özellik B'nin aktivasyon kodunun süresi dolan kullanıcıları** (§5.6) — `forgot-password`
  onların kalıcı kaçış kapısıdır.

Bu tek satır, üç ayrı kilitlenme sınıfını birden kapatır ve `activate-account` için ayrı bir
"kodum süresi doldu" kurtarma akışı yazma ihtiyacını ortadan kaldırır.

---

## 3. KARAR: Kod formatı, hash, TTL, deneme ve hedef-başına kısıtlar

> **Bu bölümün tamamı security-agent onayına tabidir (§6). Aşağıdaki, architect'in gerekçeli
> önerisidir; security-agent SIKILAŞTIRABİLİR, GEVŞETEMEZ.**

### 3.1 Kod formatı

**6 haneli, yalnızca rakam**, baştaki sıfırlar KORUNUR (`"048213"` geçerlidir).
Üretim **`crypto.randomInt(0, 1_000_000)`** ile yapılır — `Math.random()` KULLANIMI YASAKTIR.
Doğrulamadan önce sunucu girdiden boşluk ve tireleri temizler (kullanıcılar kopyalarken taşır).

Alfanümerik/daha uzun kod REDDEDİLDİ: 6 hane e-posta OTP'sinin evrensel beklentisidir, mobil
sayısal klavyeyle uyumludur ve güvenliği entropiden DEĞİL **deneme sınırından** gelir (§3.4).

### 3.2 Hash — **HMAC-SHA256 (biberli)**, düz `sha256` DEĞİL

`lib/otp.ts::hashOtpCode(userId, purpose, code)` =
`HMAC-SHA256(key = derivedKey, message = "${userId}:${purpose}:${code}")` (hex).
`derivedKey = HMAC-SHA256(env.ENCRYPTION_KEY, "email-verification-code/v1")`.

- **Neden `lib/tokens.ts::hashToken` (düz sha256) DEĞİL:** 10⁶ olası girdi, bir DB dökümünde
  saniyeler içinde tersine çevrilir. `lib/backup-codes.ts::hashBackupCode` düz sha256 kullanır
  ama yedek kodlar ~40 bit taşır; 6 haneli kod ~20 bittir. **Emsalden bilinçli sapma** — sebebi
  `lib/otp.ts`'in tepesine yazılır.
- **Neden mesaja `userId` + `purpose` katılıyor:** aynı kod farklı kullanıcılarda farklı hash
  üretir (çapraz-kullanıcı eşleşmesi imkânsız) ve bir amacın kodu diğerinde çalışmaz.
- **Neden YENİ bir env değişkeni YOK:** `.claude/architect-scope-smtp-settings.md` §2.2'deki
  bağlayıcı ilke — ikinci bir anahtar yaşam döngüsü/rotasyon prosedürü/denetim yüzeyi
  yaratılmaz. Alan ayrımı (domain separation) etiketi bunu güvenli kılar.
- **`ENCRYPTION_KEY` rotasyonu** canlı kodları geçersizleştirir. Kabul edilebilir: kodlar
  dakikalar/saatler yaşar, kullanıcı yeniden gönderim ister. `PATCH`/`GET` uçlarını 500'e
  düşüren bir durum YOKTUR.
- Karşılaştırma **`crypto.timingSafeEqual`** ile (eşit uzunluklu hex buffer'lar).

### 3.3 TTL — amaca göre

| Amaç | TTL | Gerekçe |
|---|---|---|
| `EMAIL_VERIFICATION` | **10 dakika** | Kullanıcı klavye başındadır, formu yeni gönderdi. |
| `ACCOUNT_ACTIVATION` | **24 saat** | "Soğuk" bir e-postadır — alıcı saatler sonra açabilir. 10 dk burada özelliği kullanılamaz kılardı. |

24 saatlik pencere güvenliği bozmaz: kod başına 5 deneme hakkı vardır (§3.4), yeniden üretim
hedef-başına sınırlıdır (§3.6); bir kodu kırmak için gereken ~200.000 yeniden gönderim, 60 sn
cooldown altında yüz günlerce sürer.

### 3.4 Deneme sınırı ve geçersiz kılma (ZORUNLU)

- Her başarısız doğrulama `attemptCount`i **1 artırır** (artırım, karşılaştırmadan bağımsız
  olarak HER denemede yazılır — başarılı denemede kod zaten tüketilir).
- **`attemptCount >= 5` → kod ÖLÜDÜR.** Geçerlilik yüklemi (tek doğruluk kaynağı):
  `consumedAt IS NULL AND expiresAt > now() AND attemptCount < 5`.
- **Yeni kod üretimi, o `userId`+`purpose` için CANLI olan TÜM kodların `consumedAt`ini SET
  EDER.** Her an en fazla tek bir canlı kod vardır — "hangi kod geçerliydi?" belirsizliği
  tasarımdan çıkarılır.
- Başarılı doğrulama `consumedAt`i SET EDER; satır SİLİNMEZ (denetim izi).

### 3.5 Yeniden gönderme (resend)

`POST /auth/resend-verification-code` — gövde **yalnızca `email`**.

**`purpose` gövdede YOKTUR ve EKLENMEYECEKTİR (bağlayıcı).** Amaç sunucuda türetilir:
kullanıcının EN SON `EmailVerificationCode` satırının amacı; hiç satırı yoksa
`EMAIL_VERIFICATION`. İstemcinin amacı seçebilmesi, sıradan bir kullanıcı için
`ACCOUNT_ACTIVATION` kodu ürettirip `activate-account`ın parola-belirleme dalını açmaya
çalışan bir vektör olurdu (§4.5 ile birlikte okunur).

Yanıt **her koşulda `202`**: kullanıcı yok / zaten doğrulanmış / cooldown içinde — üçü de
ayırt edilemez (`forgot-password` ile AYNI disiplin, `auth.service.ts:230`).

### 3.6 Hız sınırları — **hedef-başına kısıt, IP kısıtından DAHA ÖNEMLİDİR**

| Uç | Sınır | Kaynak |
|---|---|---|
| `POST /auth/register` | `AUTH_RATE_LIMIT` (mevcut) | IP |
| `POST /auth/verify-email` | `AUTH_RATE_LIMIT` (mevcut, 5/dk) | IP |
| `POST /auth/activate-account` | `AUTH_RATE_LIMIT` (mevcut, 5/dk) | IP |
| `POST /auth/resend-verification-code` | **yeni** `VERIFICATION_CODE_RESEND_RATE_LIMIT = { max: 2, timeWindow: "1 minute" }` | IP |

**IP sınırı TEK BAŞINA YETMEZ** — bu uç, saldırganın IP'sinden bağımsız olarak **kurbanın**
posta kutusuna e-posta göndertir; IP rotasyonuyla atlatılabilir bir mail-bomb vektörüdür.
Bu yüzden ZORUNLU, DB tabanlı, **hedef-başına** iki kısıt (bağlayıcı):

1. **Cooldown:** o `userId`+`purpose` için en son kod < 60 sn önce üretildiyse yeni kod
   ÜRETİLMEZ, e-posta GÖNDERİLMEZ (yanıt yine `202`).
2. **Günlük tavan:** o `userId`+`purpose` için son 24 saatte 5'ten fazla kod üretilmişse
   ÜRETİLMEZ (yanıt yine `202`).

İkisi de `EmailVerificationCode` satırları sayılarak uygulanır — yeni bir sayaç kolonu/tablosu
EKLENMEZ (`@@index([userId, purpose, createdAt])` bunun içindir).

`register` kaynaklı ilk gönderim bu iki kısıttan MUAFTIR (ilk koddur, tanımı gereği).

---

## 4. KARAR: Uç sözleşmesi ve amaç bağlaması

`docs/architecture/openapi.yaml` bu görevde **güncellendi ve doğrulandı** (YAML geçerli,
448 `$ref` çözümleniyor, 254 path).

| Tür | Ad | Not |
|---|---|---|
| path (DEĞİŞTİ) | `POST /auth/register` | `201 AuthResponse` → **`202 RegistrationPendingVerification`** |
| path (DEĞİŞTİ) | `POST /auth/login` | Yanıt artık 3'lü `oneOf` (2FA şekli de sözleşmeye eklendi) |
| path (YENİ) | `POST /auth/verify-email` | `{ email, code }` → `200 AuthResponse` |
| path (YENİ) | `POST /auth/resend-verification-code` | `{ email }` → her zaman `202` |
| path (YENİ) | `POST /auth/activate-account` | `{ email, code, password }` → `200 AuthResponse` |
| schema (YENİ) | `RegistrationPendingVerification`, `LoginRequiresEmailVerification`, `LoginRequiresTwoFactor`, `VerifyEmailRequest`, `ResendVerificationCodeRequest`, `ActivateAccountRequest` | |

### 4.1 Neden `/auth` altında, telehealth altında DEĞİL

Özellik B'nin aktivasyon ucu bir **kimlik doğrulama** ucudur; randevu bağlamı onu tetikleyen
olaydır, sahibi değildir. `/appointments/...` altına konsaydı, aynı işi yapan ikinci bir
kimlik yüzeyi doğardı ve e-ticaret tarafı yarın aynı özelliği istediğinde üçüncüsü gerekirdi.

### 4.2 Neden `verify-email` challenge token DEĞİL `{ email, code }` alıyor

2FA `challengeToken` deseni burada YANLIŞ olurdu: challenge token, kaydı yapan tarayıcıya
bağlıdır; oysa kullanıcı kodu çoğu zaman **telefonundaki** posta kutusundan okuyup
**masaüstünde** girer. `{ email, code }` cihazdan bağımsızdır ve e-postadaki bağlantıyla
(`/verify-email?email=...`) doğal olarak uyuşur.

### 4.3 Tek jenerik hata — `401 VERIFICATION_CODE_INVALID`

Kullanıcı yok / canlı kod yok / kod yanlış / süresi dolmuş / deneme tükenmiş / amaç eşleşmiyor —
**hepsi aynı gövdeyle** döner. Yeni `ApiErrorCode` değeri: **`VERIFICATION_CODE_INVALID`**
(+ `lib/errors.ts`'e karşılık gelen sınıf). Ayrı bir `EMAIL_ALREADY_VERIFIED` kodu EKLENMEZ —
"bu e-posta doğrulanmış" bilgisi bir hesap-varlık oracle'ıdır.

`401` seçimi emsale dayanır: `resetPassword` geçersiz token için `UnauthorizedError` fırlatır
(`auth.service.ts:249`). Kendi makine-okunur kodu vardır ki arayüz "kod hatalı — yeniden
gönder" akışını gösterebilsin.

### 4.4 Cookie/token semantiği

`verify-email` ve `activate-account`, başarıda **normal login ile BİREBİR AYNI** çıktıyı üretir:
`issueTokenPair` + `REFRESH_COOKIE_NAME` cookie'si + `auth.login` audit kaydı
(`metadata.via: "email_verification" | "account_activation"`). Yeni bir token yolu, yeni bir
cookie adı, yeni bir TTL İCAT EDİLMEZ.

`activate-account` EK OLARAK kullanıcının canlı TÜM refresh token'larını iptal eder
(`resetPassword` ile AYNI disiplin) — parola belirleme anıdır.

### 4.5 Amaç bağlaması (BAĞLAYICI)

- `verify-email` **YALNIZCA** `EMAIL_VERIFICATION` kodunu kabul eder.
- `activate-account` **YALNIZCA** `ACCOUNT_ACTIVATION` kodunu kabul eder.
- Uyuşmazlık → `401 VERIFICATION_CODE_INVALID`, deneme sayacı ARTIRILIR.

Gevşetilirse: `verify-email` bir aktivasyon kodunu tüketip hesabı "doğrulanmış ama parolasız"
bırakır (kullanıcı kilitlenir); `activate-account` ise kayıt kodunu bir parola sıfırlama aracına
çevirir. Her iki yön de gerçek bir kusurdur.

---

## 5. KARAR (Özellik B): Misafir randevu ödemesinden hesap sağlama

### 5.1 Nerede tetiklenir — **`confirmBookingPayment`'ın SONUNDA, transaction'ın DIŞINDA**

Yeni dosya: `backend/src/modules/telehealth/lib/patient-account.ts` →
`provisionPatientAccountForBooking(app, booking)`.
`lib/booking.ts::confirmBookingPayment` bunu `runSerializable(...)` **döndükten SONRA**,
best-effort (try/catch + `app.log.error`) çağırır.

**Neden bu nokta:** üç ödeme-başarı yolunun ÜÇÜ de (`webhooks/stripe.routes.ts::
handleTelehealthBookingPaid`, `telehealth.demo-payment.routes.ts`,
`telehealth.admin.routes.ts::mark-paid`) zaten buradan geçer ve dosyanın kendi yorumu
(`booking.ts:360`) burayı "paylaşılan hook noktası" ilan etmiştir. Üç çağrı yerine ayrı ayrı
eklemek, farklı ajanlara ait üç dosyada aynı mantığın kopyalanması ve zamanla ayrışması demekti.

**Neden transaction'ın DIŞINDA (bağlayıcı):** argon2 parola hash'i (~100 ms CPU) ve bir SMTP
gidiş-dönüşü, Serializable bir transaction'ın içine konursa modülün en sıcak yazma yolunda
çakışma penceresini kat kat büyütür (`runSerializable` retry'ları). Ayrıca e-posta gönderimi
geri alınamaz — rollback edilen bir transaction'dan e-posta çıkması kabul edilemez.

**Best-effort:** sağlama başarısız olsa bile ödeme onayı ASLA geri alınmaz/bozulmaz
(`triggerAppointmentConfirmationEmail` ile AYNI disiplin) — hata YUTULMAZ, `app.log.error`
her zaman çağrılır.

### 5.2 Yeni hesabın şekli (bağlayıcı)

```
email:           booking.patientEmail  →  trim + toLowerCase (ZORUNLU)
name:            booking.patientName
passwordHash:    hashPassword(crypto.randomBytes(32).toString("base64url"))   ← KULLANILAMAZ
role:            "USER"     ← SABİT KODLU (§5.4)
status:          "ACTIVE"
emailVerifiedAt: null       ← giriş kapısını kapatan alan
```

**İki BAĞIMSIZ kilit** bu hesabın ele geçirilmesini engeller: (a) parola hiç kimse tarafından
bilinmez (rastgele 32 bayt, hiçbir yere yazılmaz), (b) `emailVerifiedAt = null` olduğu için
`login()` doğru parolayla bile token vermez (§2.3). Aktivasyon kodu **kurbanın/hastanın kendi
posta kutusuna** gider.

**Neden `SiteUserStatus`'a `PENDING_ACTIVATION` EKLENMEDİ:** enum'a değer eklemek, kod tabanındaki
her `SUSPENDED`/`DELETED` kontrolünün (authenticate, login, refresh, admin listeleri, portal
guard'ları) yeniden gözden geçirilmesini gerektirirdi — geniş bir regresyon yüzeyi. Yukarıdaki
iki kilit, o enum değerinin sağlayacağı garantiyi zaten SIFIR patlama yarıçapıyla veriyor.
Ayrıca `User`'a "parola hiç belirlenmedi" kolonu da EKLENMEZ: amaç bağlaması (§4.5) aynı işi
yapar ve `forgot-password` zaten mevcut kullanıcılar için de parola belirlemenin meşru yoludur.

### 5.3 E-posta ZATEN kayıtlıysa — **randevu mevcut hesaba bağlanır, YENİ hesap AÇILMAZ**

Bulunan kullanıcıda **hiçbir alan değiştirilmez**: parola, `emailVerifiedAt`, `role`, `status`
DOKUNULMAZ. **Aktivasyon e-postası GÖNDERİLMEZ** (kullanıcının zaten hesabı var; "hesabını
aktive et" demek kafa karıştırıcı ve kimlik avı eğitimi olurdu). Randevu onay e-postası zaten
gidiyor; ikinci bir bildirim EKLENMEZ.

### 5.4 **TUZAK: `register()`'ın `userCount === 0 → ADMIN` kuralı BURAYA KOPYALANMAZ**

`auth.service.ts:67-71` ilk kullanıcıyı ADMIN yapar (kilitlenmeyi önlemek için — orada doğrudur).
Sağlama yolunda `role` **SABİT `"USER"`** olmalıdır. Aksi hâlde: sıfırdan kurulmuş, henüz hiç
kullanıcısı olmayan bir sitede **ilk misafir randevu ödemesi, anonim bir ziyaretçiye tam ADMIN
hesabı açar.** Bu, tek bir satırlık kopyala-yapıştır hatasıyla oluşabilecek en ciddi sonuçtur;
kodda bir yorumla AÇIKÇA işaretlenmeli ve qa-agent tarafından test edilmelidir (§9).

### 5.5 İdempotency ve yarış durumları

- `booking.patientUserId !== null` → **no-op** (oturum açmış hastanın randevusu; tekrar çağrı).
- Bağlama tek bir `$transaction([...])` ile: `appointmentBooking.update({ patientUserId })` +
  `appointment.updateMany({ where: { bookingId }, data: { patientUserId } })`. **Booking ve ona
  bağlı randevu satırları AYNI anda bağlanır** — `/patient/appointments` ve `/patient/bookings`
  farklı alanlara bakar, yarısı bağlanmış bir durum portalda tutarsız görünürdü.
- Aynı e-postayla iki ödeme aynı anda onaylanırsa `User.email` üzerinde `P2002` oluşabilir →
  yakalanır, kullanıcı yeniden okunur, bağlama yapılır (yeni hesap açılmaz, ikinci aktivasyon
  e-postası gitmez).
- `demo-pay` yolu da bu akıştan geçer (§6, vektör 2).

### 5.6 Kullanıcının kilitlenmeyeceğinin garantisi

Aktivasyon kodunun 24 saati dolarsa: kullanıcı `/activate-account` ekranından yeni kod ister
(§3.5) **veya** `forgot-password` → `reset-password` yolunu kullanır; ikincisi `emailVerifiedAt`i
de SET eder (§2.5). Kalıcı kilitlenme durumu YOKTUR.

### 5.7 "Randevularım" ekranı — **kontrol edildi, DEĞİŞMEZ**

`frontend/src/app/[lang]/(site)/patient/bookings|appointments` mevcuttur;
`telehealth.portal.routes.ts:596` listeyi `patientUserId: request.user!.id` ile filtreler
(sorgu parametresi YOKTUR — IDOR yüzeyi yok). `patientUserId` doldurulduğu anda randevu bu
ekranlarda **hiçbir değişiklik yapılmadan** görünür. **Portal kodu bu görevde DEĞİŞTİRİLMEZ.**

---

## 6. ENGELLEYİCİ — security-agent kararı bekleniyor: hesap ele geçirme / kötüye kullanım yüzeyi

Özellik B, **doğrulanmamış bir kullanıcı girdisinden (`patientEmail`) kimlik nesnesi üretir.**
Bu, bu turun tek gerçek risk merkezidir ve `.claude/architect-scope-smtp-settings.md` §4.4 ile
AYNI statüdedir: **ayrı, engelleyici bir onay adımı.** Aşağıdakiler architect'in çözümlemesi ve
başlangıç noktasıdır; **security-agent'ın kararı BAĞLAYICIDIR** (bulgular:
`.claude/security-review-guest-account-otp.md`).

**Vektör 1 — Hesap ele geçirme (ana soru).** Saldırgan `victim@example.com` ile randevu alıp
KENDİ kartıyla öder. `victim@example.com` için hesap açılır. **Saldırgan bu hesaba ERİŞEMEZ:**
parola rastgeledir ve hiçbir yere yazılmaz; aktivasyon kodu yalnızca kurbanın posta kutusuna
gider; `login()` doğrulanmamış hesaba token vermez. *Architect değerlendirmesi: ele geçirme
DEĞİL.* security-agent doğrulamalıdır.

**Vektör 2 — İstenmeyen e-posta / rahatsızlık.** Sağlama YALNIZCA **ödeme tamamlandığında**
çalışır: bir aktivasyon e-postası göndermenin maliyeti **bir konsültasyon ücretidir**. Ödeme
duvarı, buradaki asıl hız sınırlayıcıdır ve bilinen tüm e-posta bombardımanı vektörlerinden
daha pahalıdır. **İSTİSNA:** `POST /appointments/bookings/{id}/demo-pay` ödemeyi simüle eder ve
bu duvarı kaldırır. Çifte kapılıdır (env + `SiteSettings.demoPaymentsEnabled`,
bkz. `.claude/security-review-demo-payment-toggle.md`). *Architect önerisi:* demo yolunda
sağlama ÇALIŞMAYA DEVAM ETSİN (aksi hâlde qa-agent akışı uçtan uca test edemez), ancak
"demo ödemeler üretimde KAPALI" bir DoD maddesi olarak doğrulansın. **Karar security-agent'ındır.**

**Vektör 3 — İstenmeyen veri ilişkilendirme.** Saldırgan kurbanın e-postasını kullanırsa ve
kurbanın ZATEN hesabı varsa (§5.3), saldırganın oluşturduğu randevu kurbanın "Randevularım"
ekranında belirir — saldırganın girdiği kimlik/isim verisiyle birlikte. Kurbana zarar değil,
ama **saldırganın kendi kişisel verisinin kurbana açılması** ve ciddi bir kafa karışıklığıdır.
compliance-agent ile birlikte değerlendirilmelidir.

**Vektör 4 — Çift erişim.** Saldırgan booking oluştururken aldığı `?t=` magic-link'i korur;
randevu artık kurbanın hesabına da bağlıdır. İki taraf da erişebilir. Bu, misafir tasarımının
ÖNCEDEN VAR OLAN bir özelliğidir (bu turda YARATILMADI), ama bu turda ilk kez bir
**kimlik doğrulamalı hesap sınırını** aşmaktadır. security-agent, ödeme sonrası token
rotasyonunun (`knownRawAccessToken` geçirilmemesi) yeni hesaplar için zorunlu kılınıp
kılınmayacağına karar vermelidir — *architect'in eğilimi:* mevcut davranış korunsun (aksi hâlde
meşru misafirin kendi bağlantısı ödeme anında kırılır), risk kabul edilsin.

**Vektör 5 — Posta kutusu bombardımanı (`resend`).** §3.6'daki hedef-başına cooldown + günlük
tavan bu vektörü kapatmak için VARDIR; IP sınırı tek başına yetersizdir. security-agent
değerleri (60 sn / 5-24 sa) sıkılaştırabilir.

**Vektör 6 — Hesap-varlık oracle'ı.** Bu yüzden: `AppointmentBooking` DTO'suna
`accountActivationPending` benzeri bir alan **EKLENMEZ** ve ödeme başarı ekranındaki metin
her iki durumda da **BİREBİR AYNIDIR** (§8.3). Aksi hâlde bir kez ödeme yapan saldırgan,
istediği adresin sitede kayıtlı olup olmadığını öğrenirdi.

**security-agent bu bölümü onaylamadan Özellik B FINAL sayılmaz.** Özellik A'nın altyapısı
(§1–§4) bu onayı beklemeden ilerleyebilir — bağımsızdır.

---

## 7. KARAR: E-posta şablonları — **İKİ AYRI `purpose`**, tek birleşik e-posta DEĞİL

### 7.1 Karar

`EmailTemplatePurpose` enum'una **iki yeni değer**: `EMAIL_VERIFICATION`, `ACCOUNT_ACTIVATION`.
`prisma/seed.ts`'e iki sistem şablonu (`isSystem: true`) eklenir. `APPOINTMENT_CONFIRMATION`
şablonu **DEĞİŞTİRİLMEZ**.

### 7.2 Gerekçe — neden "randevunuz oluşturuldu + hesabınızı aktive edin" TEK e-posta DEĞİL

1. `APPOINTMENT_CONFIRMATION`ın değişken seti `lib/email-variables.ts::
   SYSTEM_VARIABLES_BY_PURPOSE` ile **sabittir ve üç farklı durumda tetiklenir** (misafir/yeni
   hesap, misafir/var olan hesap, oturum açmış hasta). Koşullu bir aktivasyon bloğu, üç durumdan
   ikisinde boş kalır — kullanıcı bozuk görünen bir e-posta alır.
2. Aktivasyon e-postası bir **güvenlik** e-postasıdır. Kimlik bilgisi belirleme çağrısını bir
   makbuzun içine gömmek, kullanıcıları tam olarak kimlik avının taklit ettiği davranışa
   alıştırır.
3. `EmailTemplate.isActive` amaç başınadır: ayrı `purpose`, site sahibinin iki metni ayrı ayrı
   düzenlemesini/kapatmasını sağlar.
4. `ALTER TYPE ... ADD VALUE` geri alınamaz — şemadaki mevcut nota (`APPOINTMENT_REMINDER_*`
   emsali) uyularak bu iki değer **İZOLE bir migration'da** eklenir, model migration'ıyla AYNI
   dosyada DEĞİL.

### 7.3 Değişken setleri (bağlayıcı)

| purpose | değişkenler |
|---|---|
| `EMAIL_VERIFICATION` | `user_name`, `verification_code`, `expires_in_minutes` |
| `ACCOUNT_ACTIVATION` | `user_name`, `verification_code`, `expires_in_hours`, `activation_url`, `booking_number` |

**`activation_url` kodu TAŞIMAZ.** Bağlantı `${FRONTEND_URL}/{lang}/activate-account?email=...`
biçimindedir — yalnızca gezinme kolaylığıdır. Kodun URL'ye konması onu referer başlıklarına,
proxy/erişim loglarına ve tarayıcı geçmişine sızdırır ve deneme sayacını anlamsızlaştırır.

**Sağlık verisi sızma yasağı (§9.7.5 madde 8, mevcut ve bağlayıcı) aynen geçerlidir:**
aktivasyon e-postasında **doktor adı, uzmanlık, şikâyet notu veya slot saatleri YER ALMAZ.**
`booking_number` yer alır (alıcının e-postanın nedenini anlaması için; aynı adrese zaten
randevu onayı da gitmektedir, yeni bir sızma yoktur).

---

## 8. KARAR: Arayüz akışı (frontend-agent'ın uygulayacağı davranış — görsel kararlar ui-designer'ın)

### 8.1 Kayıt akışı

`register()` artık token döndürmüyor → `/dashboard`'a yönlendirme KALDIRILIR.
Yeni ekran: **`/verify-email`** (`(auth)` grubunda, mevcut `AuthPageShell` ile — yeni bir
kabuk/görsel dil İCAT EDİLMEZ). 6 haneli kod girişi, geri sayım (`expiresAt`), "Kodu yeniden
gönder" butonu (`resendAvailableAt`'e kadar pasif). Başarıda `AuthResponse` alınır ve
`auth-context` mevcut login yolundaki AYNI şekilde doldurulur → `?next`/`/dashboard`.

`login()` `requiresEmailVerification` döndürürse aynı ekrana yönlendirilir (kod otomatik
gönderilmediği için ekran "Kod gönder" eylemiyle açılır).

### 8.2 Aktivasyon akışı

Yeni ekran: **`/[lang]/activate-account`** (public site tarafında, e-postadaki bağlantının
hedefi; `?email=` ile gelir). Alanlar: kod + yeni parola (+ parola tekrarı — istemci tarafı).
Başarıda oturum açılır ve **`/{lang}/patient/bookings`e** yönlendirilir (kullanıcı hesabı
aktive etmesinin sebebini orada görür).

### 8.3 Ödeme başarı ekranı (`/patient/bookings/[bookingId]?payment=success`)

**STATİK, koşulsuz bir bilgilendirme** eklenir — hesabın var olup olmadığına göre DEĞİŞMEZ
(§6 vektör 6): *"Bu randevu, e-posta adresinize bağlı hesabınıza eklendi. Hesabınız yoksa,
hesabınızı oluşturmanız için gereken talimatları e-posta ile gönderdik."*
Frontend **bunun için backend'e HİÇBİR sorgu atmaz** ve DTO'da böyle bir alan YOKTUR.

---

## 9. Görev dağılımı

Sıra bağımlılığı: **db-agent → backend-agent → frontend-agent → qa-agent.**
**security-agent PARALEL başlar ve §6 için ENGELLEYİCİDİR.**
**compliance-agent PARALEL başlar, DoD için engelleyicidir.**

### db-agent
1. `EmailVerificationPurpose` enum'u + `EmailVerificationCode` modeli + migration (§1.3).
   Alan adları ve `@@index([userId, purpose, createdAt])` **bağlayıcıdır**.
   **`codeHash` üzerinde `@unique` OLMAYACAK** (§1.4) — bu bir unutulma değil, karardır;
   kolon yorumuna bunu yazın.
2. `User`'a ters ilişki (`onDelete: Cascade`).
3. **Grandfathering backfill migration'ı** (§2.4): `UPDATE users SET email_verified_at =
   created_at WHERE email_verified_at IS NULL`. `User.emailVerifiedAt`in şema yorumunu
   güncelleyin: artık YAZILAN bir alandır ve NULL "doğrulanmayı bekliyor" demektir.
4. `EmailTemplatePurpose`'a `EMAIL_VERIFICATION` + `ACCOUNT_ACTIVATION` — **İZOLE bir
   migration'da** (§7.2 madde 4).
5. `prisma/seed.ts`: iki yeni sistem şablonu (`isSystem: true`, `isActive: true`), §7.3
   değişken setleriyle. Mevcut `APPOINTMENT_CONFIRMATION` seed satırına DOKUNMAYIN.
6. **YAPMA:** OTP hash mantığı, sağlama iş mantığı, uç implementasyonu.

### backend-agent
1. **`lib/otp.ts`** (§3.1, §3.2): `generateOtpCode()` (`crypto.randomInt`, 6 hane, baştaki
   sıfırlar korunur), `hashOtpCode(userId, purpose, code)` (HMAC + alan ayrımı),
   `timingSafeEqual` karşılaştırması. Dosya başına, düz `hashToken`'dan neden sapıldığını yazın.
2. **`lib/otp.ts` servis fonksiyonları:** `issueVerificationCode(userId, purpose)` (eski canlı
   kodları geçersiz kılar, hedef-başına cooldown/tavanı uygular, §3.4/§3.6) ve
   `consumeVerificationCode(userId, purpose, code)` (geçerlilik yüklemi, `attemptCount` artırımı,
   `consumedAt`). **`findFirst({ where: { codeHash } })` YAZMAYIN** (§1.4).
3. `lib/rate-limit.ts`: `VERIFICATION_CODE_RESEND_RATE_LIMIT = { max: 2, timeWindow: "1 minute" }`.
4. `lib/errors.ts`: `VERIFICATION_CODE_INVALID` kodu + `VerificationCodeInvalidError` (401).
5. `auth.service.ts`/`auth.routes.ts`/`auth.schemas.ts`: `register`in dönüş sözleşmesini
   değiştirin (token/cookie YOK, §2.1); `login`e `requiresEmailVerification` dalını ekleyin
   (§2.3, **`authenticate.ts`e DOKUNMAYIN**); üç yeni ucu uygulayın (§4);
   `resetPassword`in `emailVerifiedAt` set etmesini ekleyin (§2.5).
6. **`modules/telehealth/lib/patient-account.ts`** (§5): `provisionPatientAccountForBooking`.
   `confirmBookingPayment`in SONUNDAN, transaction DIŞINDA, best-effort çağrılır.
   **`role: "USER"` SABİT KODLU — `userCount === 0 → ADMIN` kuralını KOPYALAMAYIN (§5.4),
   koda bunu açıklayan bir yorum yazın.** E-posta normalizasyonu (trim+lowercase) ZORUNLU.
7. `email-templates.service.ts` + `lib/email-variables.ts`: iki yeni `purpose` için değişken
   kaydı ve `sendEmailVerificationCode` / `sendAccountActivationEmail` tetikleyicileri (§7.3).
   **Şablonun İÇERİĞİ/metni notification-agent'ın sahasıdır** — siz yalnızca tetikleyiciyi ve
   değişken setini sağlarsınız (mevcut `notifications.ts` dosya-başı notuyla AYNI sınır).
8. Unit test: 5 yanlış denemeden sonra kodun ölmesi; yeni kodun eskiyi öldürmesi; süre aşımı;
   amaç bağlaması (§4.5, HER İKİ yön); cooldown/günlük tavan; doğrulanmamış kullanıcının
   login'den token ALAMAMASI; kodun hiçbir yanıtta/logda görünmemesi.
9. **YAPMA:** şema tasarımı (db-agent), §6'daki güvenlik politikasını FINAL sayma
   (security-agent), portal/`patientUserId` filtresi değişikliği (§5.7).

### security-agent — AYRI, ENGELLEYİCİ ADIM
1. **§6'daki altı vektörün her birine AÇIKÇA karar verin** — özellikle vektör 2 (demo ödeme
   yolunda sağlama açık mı kalsın?) ve vektör 4 (ödeme sonrası token rotasyonu yeni hesaplar
   için zorunlu mu?). Architect'in eğilimleri belirtilmiştir, **karar sizindir**.
2. **§3'ü (kod formatı, HMAC + `ENCRYPTION_KEY` türetmesi, TTL'ler, 5 deneme, hedef-başına
   cooldown/tavan) ONAYLAYIN veya REDDEDİN.** `ENCRYPTION_KEY`in OTP biberi olarak yeniden
   kullanımı özellikle değerlendirilmelidir.
3. §4.3'teki tek-jenerik-hata disiplininin hiçbir yerde (yanıt, hata mesajı, zamanlama, audit)
   delinmediğini doğrulayın — hesap-varlık oracle'ı yok.
4. §5.4'ün (ADMIN kilitlenme tuzağı) implementasyonda gerçekten sabit kodlandığını doğrulayın.
5. Politikayı **SIKILAŞTIRABİLİR, GEVŞETEMEZ.** Bulgular:
   `.claude/security-review-guest-account-otp.md`.

### compliance-agent — PARALEL, DoD için engelleyici
1. Ödeme sonrası **hesap oluşturma yeni bir işleme amacıdır**: `AppointmentBooking.consentAt`/
   `consentVersion` aydınlatma metni bunu kapsıyor mu? Kapsamıyorsa
   `DEFAULT_APPOINTMENT_CONSENT_VERSION`in `"v2"` → `"v3"` yükseltilmesi GEREKİR (emsal:
   `.claude/compliance-notes-doctor-identity.md` — kimlik adımı eklendiğinde `v1` → `v2`).
2. §6 vektör 3'ü (saldırganın kimlik/isim verisinin kurbanın hesabına açılması) değerlendirin.
3. `EmailVerificationCode` satırlarının saklama süresi (tüketilmiş/süresi dolmuş kodların
   temizliği) — mevcut retention işleriyle (`lib/*-retention.ts`) aynı disiplin gerekiyor mu?
4. Bulgular: `.claude/compliance-notes-guest-account-otp.md`.

### frontend-agent
1. `app/(auth)/register/page.tsx`: `register()` artık oturum açmıyor — `/dashboard`
   yönlendirmesini kaldırıp `/verify-email`e geçin (`?next` KORUNUR).
2. Yeni `/verify-email` ekranı (§8.1) ve `/[lang]/activate-account` ekranı (§8.2); ikisi de
   mevcut `AuthPageShell`/`Field`/`Input`/`Alert` bileşenleriyle.
3. `lib/api/auth.ts`e üç yeni istemci fonksiyonu + `lib/api/types.ts` tipleri (sözleşmeye BİREBİR).
4. `context/auth-context.tsx`: `register`in artık `AuthResponse` DÖNDÜRMEDİĞİNİ yansıtın —
   oturum kurma yalnızca `verifyEmail`/`activateAccount` sonrasında olur.
5. `login` yanıtındaki üç dallı union'ı ele alın (mevcut `requiresTwoFactor` dalıyla AYNI desen).
6. Ödeme başarı ekranına §8.3'teki **statik** bilgilendirme. **Koşullu metin YAZMAYIN** ve
   bunun için backend'e sorgu ATMAYIN.
7. **YAPMA:** yeni görsel dil/renk/token kararı (ui-designer); meta tag/SEO (seo-agent);
   e-posta şablonu metni (notification-agent).

### qa-agent
1. **Kayıt → kod → oturum** uçtan uca; kod girilmeden hiçbir korumalı uca erişilemediği.
2. **Doğrulanmamış kullanıcı DOĞRU parolayla login olamaz** (`requiresEmailVerification`).
3. **Mevcut (backfill edilmiş) kullanıcıların girişi HİÇ DEĞİŞMEDİ** — regresyon (§2.4).
4. 5 yanlış deneme → kod ölür; yeniden gönderim yeni kod verir; eski kod artık çalışmaz.
5. Amaç bağlaması: aktivasyon kodu `verify-email`de, kayıt kodu `activate-account`ta ÇALIŞMAZ.
6. `resend-verification-code`: var olmayan e-posta, doğrulanmış kullanıcı ve cooldown içindeki
   istek — **üçü de ayırt edilemez `202`**; cooldown içinde e-posta GÖNDERİLMEZ.
7. **Misafir randevu ödemesi → hesap açılır, `patientUserId` bağlanır, randevu
   `/patient/bookings`te görünür**; aktivasyon öncesi o hesapla giriş YAPILAMAZ.
8. **E-posta zaten kayıtlıysa: YENİ hesap AÇILMAZ**, randevu mevcut hesaba bağlanır, parola ve
   `emailVerifiedAt` DEĞİŞMEZ, aktivasyon e-postası GİTMEZ.
9. **§5.4 regresyonu (kritik):** hiç kullanıcısı olmayan bir ortamda misafir ödemesiyle açılan
   hesabın rolü **`USER`**'dır, ADMIN DEĞİL.
10. Aktivasyon → parola belirlenir, oturum açılır, eski refresh token'lar iptal edilmiştir.
11. Kodun hiçbir API yanıtında, URL'de veya logda görünmediği.

### code-quality-agent
1. `findFirst`/`findUnique({ where: { codeHash } })` deseninin HİÇBİR YERDE olmadığını
   doğrulayın (§1.4).
2. OTP üretiminde `Math.random()` kullanılmadığını doğrulayın (§3.1).
3. Sağlama yolunda `role`un sabit kodlu olduğunu doğrulayın (§5.4).

### documentation-agent
`ARCHITECTURE.md`'ye yeni bölüm + CHANGELOG. `/auth/register`in **kırıcı sözleşme
değişikliği** olduğu (201→202, token yok) AÇIKÇA belirtilmelidir.

---

## 10. Definition of Done ek maddeleri

Ortak DoD'a (`.claude/CLAUDE.md`) ek olarak:

- [ ] security-agent §6'daki altı vektöre ve §3'e **açıkça karar verdi** (`.claude/security-review-guest-account-otp.md`).
- [ ] compliance-agent consent sürümü (`v2` → `v3`?) hakkında karar verdi.
- [ ] Mevcut kullanıcıların giriş davranışı **hiç değişmedi** (backfill doğrulandı, qa §9.3).
- [ ] Düz metin OTP hiçbir yanıtta, URL'de, logda veya audit metadata'sında YOK.
- [ ] Misafir sağlama yolunda rol **`USER`** (qa §9.9 geçti).
- [ ] `middleware/authenticate.ts` ve `telehealth.portal.routes.ts` **DEĞİŞTİRİLMEDİ**.
- [ ] Üç ödeme yolunun (Stripe webhook / demo-pay / admin mark-paid) üçünde de sağlama çalışıyor
      ve üçünde de hata durumunda ödeme onayı BOZULMUYOR.

---

## 11. Kapsam DIŞI (bilinçli)

- **E-ticaret checkout'unda misafirden hesap oluşturma.** Aynı altyapı yarın oraya da
  bağlanabilir (`Cart.siteUserId`/`Order.siteUserId` AYNI desendir) — bu turda YAPILMAZ.
- **SMS/telefon OTP.** `User.phone` vardır ama SMS taşıma katmanı YOKTUR.
- **Doğrulanmamış kullanıcıların otomatik temizliği** (ör. 30 gün sonra silme) — ayrı bir iş.
- **`emailVerifiedAt` için admin arayüzü** ("bu kullanıcıyı elle doğrula") — istenmedi.
- **E-posta değiştirme akışında yeniden doğrulama** — `PATCH /users/me` zaten `email`
  değiştirmeye izin VERMİYOR, dolayısıyla böyle bir akış YOK.
