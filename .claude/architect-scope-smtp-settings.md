# Architect Scope — E-posta (SMTP) Yapılandırması

> **Durum:** Karar verildi. **Bir ENGELLEYİCİ onay bekliyor** (security-agent, §4).
> **Kapsam:** `/admin/settings` → "E-posta / API Yapılandırmaları" sekmesindeki
> "E-posta Yapılandırması" kartını kozmetik iskeletten GERÇEK, çalışan bir özelliğe çevirmek.
> **İlgili dosyalar:** `docs/architecture/openapi.yaml` (bu görevde GÜNCELLENDİ),
> `backend/prisma/schema.prisma`, `backend/src/lib/mail.ts`, `backend/src/lib/crypto.ts`,
> `backend/src/config/env.ts`, `frontend/src/app/admin/settings/page.tsx`.
> **Bu doküman bağlayıcıdır.** Ajanlar arası çelişkide `openapi.yaml` + bu doküman hakemdir.
> **Branş:** `feature/smtp-settings`.

---

## 0. Yönetici özeti — sorun ne, sorun ne DEĞİL

Kart bugün "Yakında — bu yapılandırma henüz bu ortamda desteklenmiyor" rozeti ve dört
`disabled` input gösteriyor (`frontend/src/app/admin/settings/page.tsx` ~870-897). Bu form
**hiçbir backend'e bağlı değil** — ne bir state tutuyor, ne bir istek atıyor.

Kritik tespit: **e-posta altyapısının kendisi eksik DEĞİL.** `lib/mail.ts` sağlayıcı-agnostik,
düzgün yazılmış, hata yönetimi olan bir SMTP katmanı ve zaten üretimde kullanılıyor
(`auth.service.ts` parola sıfırlama, `email-templates.service.ts` şablon gönderimi,
`/admin/notifications/templates/{id}/test-send`). Eksik olan tek şey, bu katmanın
yapılandırmasının **yalnızca env değişkenlerinden** okunabilmesi — yani site sahibinin
panelden erişemediği bir yerde olması.

Dolayısıyla bu iş "e-posta gönderimi yazmak" DEĞİL, **var olan gönderim katmanına ikinci
ve öncelikli bir yapılandırma kaynağı eklemek**tir. Kapsamı dar tutmak bu yüzden mümkün.

| Katman | Mevcut durum |
|---|---|
| SMTP gönderimi (`lib/mail.ts`) | VAR, çalışıyor, env tabanlı |
| Dev fallback (Ethereal) | VAR |
| Prod'da `SMTP_HOST` yoksa anlamlı hata | VAR |
| Şablon test gönderimi ucu | VAR (`EMAIL_TEST_SEND_RATE_LIMIT`, 3/dk) |
| Simetrik şifreleme (`lib/crypto.ts`) | VAR (AES-256-GCM, `ENCRYPTION_KEY` zorunlu) |
| DB'de SMTP yapılandırması | **YOK** ← tek gerçek boşluk |
| Admin UI bağlantısı | **YOK** (kozmetik iskelet) |

---

## 1. KARAR: Depolama — **ayrı singleton tablo `EmailSettings`**, `SiteSettings`'e kolon EKLENMEZ

### 1.1 Karar

Yeni, tekil (singleton) bir model: **`EmailSettings`** (`id @default("singleton")`).
`SiteSettings`'e HİÇBİR kolon eklenmez ve hiçbir kolonu değiştirilmez.

### 1.2 Gerekçe

1. **`GET /settings` HERKESE AÇIKTIR.** `settings.routes.ts::publicSettingsRoutes` bu satırı
   kimlik doğrulaması olmadan, site header'ı için servis ediyor. SMTP host/kullanıcı adı
   altyapı kimlik bilgisidir. Aynı satıra koymak, internete sızmayı **`toSiteSettingsDto`
   mapper'ında bir alanı elle hariç tutmayı hatırlamaya** bağlar. Bu, güvenlik açısından
   kabul edilemez bir bağımlılıktır: public/özel sınırı bir **tablo sınırı** olmalı,
   bir mapper disiplini değil. Tek başına bu madde kararı verdiriyor.
2. **`PATCH /admin/settings` gövdeyi körlemesine yayıyor** (`update: request.body`,
   `settings.routes.ts:159`). Yaz-şifrele / asla-döndürme / üç-durumlu-parola semantiği
   gerektiren bir alan bu yolda barınamaz — ya handler'a özel-durum eklenir (genel yolu
   kirletir) ya da bir gün birisi parolayı düz metin yazar.
3. **Emsal var ve bağlayıcı.** §10.12 Site Özelleştirme'de aynı soru sorulmuş ve aynı yanıt
   verilmişti: `SiteAppearance` ve `SiteCustomCode` ayrı singleton tablolar olarak açıldı,
   `openapi.yaml` içindeki kapsam notu "**`SiteSettings`'e HİÇBİR kolon EKLENMEZ**" diyor.
   Yeni bir desen icat etmiyoruz, var olanı izliyoruz.
4. **Okuma yetkisi farklı.** `GET /admin/settings` panel kapısı yeterli (ADMIN/MANAGER/EDITOR);
   SMTP yapılandırmasını ise EDITOR **okuyamamalıdır** bile. Farklı yetki eşiği = farklı uç =
   farklı tablo.
5. **`SiteSettings` zaten şişmiş.** 25+ kolon, dört ayrı ilgi alanı (marka, kargo, demo ödeme,
   canlı destek). Altıncı bir ilgi alanını daha eklemek bilinen bir sorunu büyütmek olurdu.

### 1.3 Neden adı `EmailSettings`, `EmailSmtpSettings` DEĞİL

Tablo, sitenin **giden e-posta yapılandırmasıdır**; SMTP bugünkü tek taşıma katmanıdır.
`fromAddress`/`fromName` taşıma-agnostiktir. Protokol adını tabloya asmak, yarın bir
sağlayıcı API'si (Resend/SES HTTP) eklendiğinde adı yanlış hale getirir. Ayrıca ortak
terminoloji kuralı gereği projede yerleşik terim zaten `email`'dir
(`EmailTemplate`, `EmailDeliveryError`, `email-renderer.ts`).

### 1.4 Şema taslağı (db-agent uygular — niyet bağlayıcı, Prisma sözdizimi db-agent'ın)

```prisma
/// Giden e-posta (SMTP) yapılandırması — tekil satır.
/// `SiteSettings`'e BİLEREK eklenmedi: o satır public `GET /settings` ile
/// kimlik doğrulamasız servis ediliyor (gerekçe: architect-scope-smtp-settings.md §1.2).
model EmailSettings {
  id                     String    @id @default("singleton")
  /// Öncelik anahtarı: true VE smtpHost dolu iken gönderim BU satırı kullanır,
  /// aksi halde env.SMTP_* değerlerine düşülür (bkz. §3).
  enabled                Boolean   @default(false)
  smtpHost               String?
  smtpPort               Int       @default(587)
  smtpSecure             Boolean   @default(false)
  smtpUser               String?
  /// AES-256-GCM, lib/crypto.ts::encryptSecret ile şifreli. DÜZ METİN YASAK.
  /// Ad, şifreli olduğunu AÇIKÇA söyler — `identityNumberCiphertext` ile aynı konvansiyon.
  smtpPasswordCiphertext String?
  fromAddress            String?
  fromName               String?
  lastTestedAt           DateTime?
  lastTestSucceeded      Boolean?
  lastTestError          String?
  updatedById            String?
  updatedAt              DateTime  @updatedAt

  updatedBy User? @relation(fields: [updatedById], references: [id], onDelete: SetNull)

  @@map("email_settings")
}
```

**Kolon adı notu:** projede iki konvansiyon var — `secretEncrypted` (outbound webhooks) ve
`*Ciphertext` (telehealth, daha yeni). `*Ciphertext` seçildi: sıfat-sonek okuma
belirsizliği bırakmıyor ve daha yeni kod bu yönde. Bu bir tercih, db-agent bunu tartışmasın.

**Tek satır garantisi:** `id @default("singleton")` + `upsert` deseni — `SiteSettings`,
`SiteAppearance`, `SiteCustomCode` ile aynı. Ek kısıt gerekmez.

**`SiteSettings`'e `emailSettingsId` gibi bir işaretçi EKLENMEZ** — iki singleton arasında
FK anlamsızdır.

---

## 2. KARAR: Parola şifrelemesi — **mevcut `lib/crypto.ts` KULLANILIR, yeni yöntem İCAT EDİLMEZ**

> **Bu bölüm security-agent onayına tabidir (§4). Aşağıdaki, architect'in gerekçeli
> önerisidir ve security-agent onaylayana kadar uygulanabilir sayılır; security-agent
> SIKILAŞTIRABİLİR, GEVŞETEMEZ.**

### 2.1 Karar

`backend/src/lib/crypto.ts::encryptSecret` / `decryptSecret`. Yeni bir şifreleme modülü,
yeni bir env değişkeni, yeni bir algoritma **YOK**.

### 2.2 Gerekçe

Arama yapıldı; proje bu sorunu **zaten çözmüş**:

- `lib/crypto.ts` — AES-256-GCM, 96-bit IV, `iv:authTag:ciphertext` (hex), anahtar
  `env.ENCRYPTION_KEY` (32 byte base64). Anahtar `env.ts:140`'ta **zorunlu**
  (`z.string().min(1)`), uzunluk boot'ta doğrulanıyor.
- Tüketiciler: outbound webhook secret'ları (`outbound-webhooks.service.ts:77,183`),
  2FA TOTP secret'ları (`security.routes.ts:89`), telehealth konsültasyon notları ve
  kimlik numaraları, LiveKit anahtarları.
- `lib/identity.ts:227` **açıkça** şunu yazıyor: "mevcut `lib/crypto.ts::encryptSecret/
  decryptSecret`'i SARAR. Yeni bir şifreleme … İCAT EDİLMEZ." Aynı disiplin burada da geçerli.

Yeni bir mekanizma eklemek ikinci bir anahtar yaşam döngüsü, ikinci bir rotasyon prosedürü
ve ikinci bir denetim yüzeyi yaratırdı — sıfır kazanç karşılığında.

### 2.3 Bağlayıcı alt kurallar

1. **Parola hiçbir uçtan DÖNMEZ.** DTO yalnızca `smtpPasswordSet: boolean` taşır.
2. **`secretLast4` deseni UYGULANMAZ.** Webhook secret'ında son 4 hane vardır çünkü admin'in
   onu karşı sistemde eşleştirmesi gerekir. SMTP parolasının son 4 hanesi hiç kimsenin işine
   yaramaz; yalnızca entropi sızdırır. Emsalden bilinçli sapma.
3. **Üç durumlu PATCH semantiği:** alan yok → koru; `null` → temizle; dolu string → değiştir.
   `"***"` gibi yer-tutucu sentinel **YASAK** (er ya da geç gerçek parola olarak kaydedilir).
4. **Çözme (decrypt) YALNIZCA transporter kurulumunda, bellekte.** Hiçbir DTO, log, audit
   metadata'sı veya hata mesajı düz metin parolaya yaklaşmaz. `GET` ucu **hiç decrypt
   ETMEZ** — bu sayede `ENCRYPTION_KEY` rotasyonu ayarlar ekranını 500'e düşürmez.
5. **Çözme hatası** (anahtar değişmiş/veri bozulmuş) → `EmailDeliveryError`, aynen
   `outbound-webhooks.dispatcher.ts:133`'teki ele alışta olduğu gibi; yakalanmadan
   yukarı fırlayıp süreci kirletmez.
6. **Audit:** `settings.email_update`, `metadata.changed` = alan **ADLARI**. Değer yazılmaz
   (`settings.update`'in `demoPaymentsEnabled` istisnası burada geçerli DEĞİLDİR — o istisna
   bir boolean içindi).

---

## 3. KARAR: Env vs DB önceliği — **DB kazanır (yalnızca `enabled: true` iken), env kalıcı yedektir**

### 3.1 Çözümleme zinciri (bağlayıcı, `lib/mail.ts::buildTransporter`)

```
1. EmailSettings.enabled === true && smtpHost dolu   → DB yapılandırması   (effectiveSource: "database")
2. env.SMTP_HOST dolu                                → env yapılandırması  (effectiveSource: "env")
3. NODE_ENV=development                              → Ethereal test kutusu (effectiveSource: "ethereal")
4. NODE_ENV=test                                     → EmailDeliveryError  (mevcut davranış, değişmez)
5. production                                        → EmailDeliveryError  (mevcut davranış, değişmez)
```

2-5 arası **bugünkü davranışın birebir aynısıdır**. Tek yenilik, en üste eklenen 1. adımdır.

`from` çözümlemesi ayrı ve aynı mantıkta: DB aktifken `fromName`/`fromAddress` doluysa
`env.SMTP_FROM`'u ezer, boşsa env değeri kullanılır. `sendMail()` bugün `from: env.SMTP_FROM`
sabitini kullanıyor (`mail.ts:92`) — çözümlenmiş yapılandırmadan okumaya geçmeli.

### 3.2 Neden env KALDIRILMIYOR

1. **Yumurta-tavuk.** Parola sıfırlama ve admin davet e-postaları, henüz hiç kimse panele
   giremeden çalışmak zorundadır. Yapılandırmanın tek kaynağı panel olursa, panele
   giremeyen bir kurulum e-posta da gönderemez — kilitlenme.
2. **Felaket kurtarma.** DB yapılandırması yanlışsa, ops'un panele bağımlı olmayan bir yola
   ihtiyacı vardır.
3. **Ortam yönetimi devops-agent'ın alanıdır.** CI, staging ve container ortamları tasarım
   gereği env ile yapılandırılır; bunu elinden almak sorumluluk sınırını ihlal ederdi.

### 3.3 Neden açık bir `enabled` bayrağı ("alanlar doluysa DB kazanır" DEĞİL)

- Yarım doldurulmuş bir formun kaydedilmesi, çalışan üretim e-postasını **sessizce**
  bozardı. Öncelik devri bilinçli bir eylemle olmalıdır.
- Admin, ayarlarını **silmeden** env'e geri dönebilmelidir (sorun giderme sırasında kritik).
- Sözleşme, `enabled: true` + boş `smtpHost` kombinasyonunu `422` ile reddeder — "açık ama
  yapılandırmasız" durumu e-postanın sessizce kaybolduğu bir tuzaktır.

### 3.4 Transporter önbelleği — ATLANMASI KOLAY, ZORUNLU madde

`lib/mail.ts` transporter'ı modül seviyesinde bir singleton'da (`transporterPromise`)
önbelleğe alıyor. DB yapılandırması değiştiğinde bu önbellek **bayatlar** ve süreç ömrü
boyunca eski SMTP sunucusu kullanılmaya devam eder.

**Karar (bağlayıcı):** transporter, yapılandırmadan türetilen bir **parmak izine** göre
önbelleğe alınır (ör. `"db:" + updatedAt.toISOString()` veya `"env"` / `"ethereal"`).
`sendMail()` her çağrıda `EmailSettings` satırını okur (tek satır, birincil anahtar —
SMTP gidiş-dönüşünün yanında ölçülemez bir maliyet); parmak izi değişmişse transporter
yeniden kurulur.

Ek olarak `resetMailTransporter()` dışa açılır ve başarılı `PATCH` sonrası çağrılır —
aynı süreçte anında etki için.

**Neden yalnızca `resetMailTransporter()` YETMEZ:** birden fazla backend örneği/pod
çalışıyorsa PATCH'i alan örnek önbelleğini temizler, diğerleri temizlemez. "Bir pod'da
çalışıyor, diğerinde çalışmıyor" hata sınıfının tamamı parmak izi yaklaşımıyla ortadan
kalkar. Bu bir optimizasyon değil, doğruluk gereğidir.

---

## 4. KARAR: Bağlantı testi — **MVP'DE VAR**, tek uç, yalnızca kendi adresine

### 4.1 Karar

`POST /admin/settings/email/test` — kaydedilmiş yapılandırmayla `transporter.verify()`
yapar **ve** gerçek bir test e-postası gönderir. Tek uç; ayrı "bağlantıyı test et" +
"test e-postası gönder" ikilisi açılmaz.

### 4.2 Gerekçe (görev bunu açıkça istemiyordu — neden yine de kapsamda)

Doğrulanamayan bir **yaz-only parola alanı bir tuzaktır**: admin kaydeder, hiçbir şey
olmaz ve hata ancak aylar sonra, gerçek bir kullanıcının parola sıfırlama e-postası
sessizce düştüğünde ortaya çıkar. Bu, bugünkü dürüst "Yakında" rozetinden **daha kötü**
bir kullanıcı deneyimidir — özelliği "gerçek" yapmak, doğrulanabilir yapmaktır.

Maliyet de düşük: `transporter.verify()` nodemailer'da hazır, test gönderimi deseni
(`/admin/notifications/templates/{id}/test-send` + `EMAIL_TEST_SEND_RATE_LIMIT`) projede
zaten var. Kopyalanacak, icat edilmeyecek.

Ayrı iki uç açılmadı çünkü `verify()` tek başına yanıltıcıdır — bazı sağlayıcılar yalnızca
`MAIL FROM` aşamasında reddeder. İki adımı tek uçta ardışık çalıştırmak tek doğru sinyali verir.

### 4.3 Bağlayıcı kurallar

1. **Gövde `to` KABUL ETMEZ.** Alıcı her zaman `request.user.email`. §10.16.6'daki bağlayıcı
   karar (spam-relay/phishing vektörü) burada istisnasız geçerlidir.
2. **Kaydedilmiş satır test edilir**, gövdedeki geçici bir yapılandırma değil — webhook
   `POST .../test` ile aynı semantik. Arayüz akışı: **önce Kaydet, sonra Test Et.**
   (Yan fayda: kimlik bilgileri ikinci bir istek gövdesinde dolaşmaz.)
3. `enabled: false` iken de çalışır (canlıya almadan önce doğrulama); `smtpHost` boşsa `422`.
4. Rate limit: yeni `EMAIL_SMTP_TEST_RATE_LIMIT = { max: 3, timeWindow: "1 minute" }` —
   `EMAIL_TEST_SEND_RATE_LIMIT` ile aynı değer, `lib/rate-limit.ts`'e eklenir.
5. Sonuç `lastTestedAt` / `lastTestSucceeded` / `lastTestError`'a yazılır (başarısızlıkta da).
6. Audit: `settings.email_test`. Alıcı adresi ve ham hata gövdesi metadata'ya **yazılmaz**.
7. Başarısızlık → `502 EMAIL_DELIVERY_FAILED` (mevcut `lib/errors.ts` sınıfı).

### 4.4 ENGELLEYİCİ — security-agent kararı bekleniyor: `smtpHost` SSRF/port politikası

**Sorun:** `smtpHost` + port, sunucuyu keyfi bir `host:port` adresine TCP bağlantısı açmaya
ikna eder. Hata mesajı (bağlantı reddedildi / zaman aşımı) bir **oracle**'dır: iç ağ port
taraması yapılabilir. `lib/ssrf-guard.ts` bu sorunu webhook URL'leri için zaten çözmüş
(`resolveAndValidateHost`, `isPublicUnicastIp`).

**Ama webhook kuralları buraya OLDUĞU GİBİ uygulanamaz:** meşru kurulumların çoğu **iç
ağdaki** bir SMTP relay'ini kullanır (kurumsal relay, docker-compose `mailhog`, sidecar).
Koşulsuz "public unicast" şartı gerçek kullanıcıları kırar.

**Architect'in önerisi (security-agent'ın kararı BAĞLAYICIDIR, bu yalnızca başlangıç noktası):**

- Sözdizimi: kimlik bilgisi (`user:pass@`), şema (`smtp://`), port eki, boşluk → `422`.
- Port: `[25, 465, 587, 2525]` kapalı kümesi (sözleşmede `enum` olarak yazıldı).
  Serbest aralık, ucu doğrudan bir port tarayıcısına çevirir.
- `resolveAndValidateHost` **yalnızca `isProd`'da** uygulanır; self-hosted/kurumsal iç relay
  senaryosu için devops-agent'ın yöneteceği bir env kaçış kapısı
  (ör. `SMTP_ALLOW_PRIVATE_HOST=true`) tanımlanır.
- Hata mesajı sınıflandırılır (kimlik doğrulama / bağlantı / TLS), ham soket hatası
  ziyaretçiye değil admin'e, kırpılmış olarak döner.

**security-agent bunu onaylamadan backend-agent SSRF katmanını FINAL saymaz.** Yapılandırma
ve şifreleme işi bu onayı beklemeden ilerleyebilir (bağımsız).

---

## 5. KARAR: API sözleşmesi — ayrı alt-kaynak (`PATCH /admin/settings`e EKLENMEDİ)

`docs/architecture/openapi.yaml` bu görevde **güncellendi ve doğrulandı** (YAML geçerli,
tüm `$ref`'ler çözümleniyor, 251 path).

| Tür | Ad | Not |
|---|---|---|
| path | `GET /admin/settings/email` | **Yalnızca ADMIN** (MANAGER/EDITOR → `403`) |
| path | `PATCH /admin/settings/email` | Yalnızca ADMIN, upsert, üç-durumlu parola |
| path | `POST /admin/settings/email/test` | Yalnızca ADMIN, 3/dk, kendi adresine |
| schema | `EmailSettings` | `smtpPasswordSet` + `effectiveSource` içerir, parola İÇERMEZ |
| schema | `UpdateEmailSettingsRequest` | `smtpPassword` `writeOnly: true` |
| schema | `EmailSettingsTestResponse` | `sentTo` **maskeli** (`lib/pii-mask.ts` disiplini) |

**Neden `PATCH /admin/settings`e eklenmedi:** §1.2 madde 1-2 (public sızıntı yüzeyi + kör
gövde yayılımı). Mevcut `/admin/settings/{permissions,api-keys,webhooks}` alt-kaynak
deseniyle birebir tutarlı — yeni desen icat edilmedi.

**Yetki — üç ucun üçü de ADMIN.** `GET` bile panel kapısıyla yetinmez: SMTP host/kullanıcı
altyapı kimlik bilgisidir. `GET /admin/settings/permissions` ile aynı eşik.

**`effectiveSource` (türetilmiş, salt-okunur):** `database | env | ethereal | none`.
Arayüzün "kaydettim ama gerçekten kullanılıyor mu?" belirsizliğini kapatan alan — bu
özelliğin tamamı zaten o belirsizliği gidermekle ilgili olduğu için sözleşmeye dahil edildi.

---

## 6. Görev dağılımı

Sıra bağımlılığı: **db-agent → backend-agent → frontend-agent → qa-agent**.
**security-agent PARALEL başlar ve §4.4 için ENGELLEYİCİDİR.**

### db-agent
1. `EmailSettings` modelini + migration'ı ekle (§1.4). Alan adları bağlayıcıdır.
2. `User` tarafına ters ilişkiyi ekle (`onDelete: SetNull`).
3. Seed/veri geri doldurma **YOK** — satır ilk `PATCH`'te oluşur (lazy-upsert).
   Mevcut `env.SMTP_*` değerleri DB'ye **taşınmaz** (§3.2: env kalıcı yedektir).
4. **YAPMA:** şifreleme kodu, öncelik mantığı, uç implementasyonu.

### backend-agent
1. Üç ucu uygula (`GET`/`PATCH`/`POST .../test`) — sözleşme `openapi.yaml`'da hazır.
   `settings.routes.ts`'teki lazy-upsert + `DEFAULTS` desenini birebir izle.
   Üçü de `requireSiteRole(...ROLES_ADMIN)`.
2. Şifreleme: **`lib/crypto.ts::encryptSecret/decryptSecret`** (§2). Yeni modül/env/algoritma
   İCAT ETME. Üç durumlu parola semantiğini (§2.3.3) uygula.
3. `lib/mail.ts`: §3.1 öncelik zinciri + §3.4 parmak-izi tabanlı transporter önbelleği +
   `resetMailTransporter()`. `from` çözümlemesini `env.SMTP_FROM` sabitinden çıkar.
   2-5. adımların mevcut davranışını **DEĞİŞTİRME**.
4. `lib/rate-limit.ts`'e `EMAIL_SMTP_TEST_RATE_LIMIT = { max: 3, timeWindow: "1 minute" }`.
5. Audit: `settings.email_update`, `settings.email_test` (§2.3.6, §4.3.6).
6. `toEmailSettingsDto` mapper'ı — `effectiveSource`'u türetir, parolaya **yaklaşmaz**.
7. SSRF/port doğrulaması: §4.4'ü başlangıç noktası al, **ama security-agent onayı gelmeden
   FINAL sayma.** Çelişki çıkarsa architect'e eskale et.
8. Unit test: üç-durumlu parola, `enabled=false` iken env'e düşüş, parmak izi değişince
   transporter'ın yeniden kurulması, parolanın DTO'ya sızmaması.
9. **YAPMA:** şema tasarımı (db-agent), güvenlik politikası belirleme (security-agent).

### security-agent — AYRI, ENGELLEYİCİ ADIM
1. **§2 şifreleme yaklaşımını ONAYLA veya REDDET.** Architect'in önerisi: mevcut
   `lib/crypto.ts` (AES-256-GCM / `ENCRYPTION_KEY`) yeniden kullanılır. Bu bir architect
   kararı olarak yazılmıştır ama **güvenlik onayı security-agent'ındır**; onay olmadan
   "denetimden geçmiş" sayılmaz.
2. **§4.4 `smtpHost` SSRF + port politikasına KARAR VER** — burada architect'in bir tercihi
   değil, security-agent'ın kararı geçerlidir (iç relay meşruiyeti ile port-tarama riski
   arasındaki denge).
3. Test ucunun hata-oracle yüzeyini (dönen hata mesajının ayrıntı düzeyi) sınırla.
4. Audit metadata'sının ve `lastTestError` alanının kimlik bilgisi sızdırmadığını doğrula.
5. `ENCRYPTION_KEY` rotasyon senaryosunda davranışı (§2.3.4-5) gözden geçir.
6. Politikayı **SIKILAŞTIRABİLİR, GEVŞETEMEZ.** Bulguları `.claude/security-review-smtp-settings.md`.

### frontend-agent
1. `frontend/src/app/admin/settings/page.tsx` (~870-897): "Yakında" rozetini, alttaki kilit
   metnini ve `disabled` niteliklerini **KALDIR**; kartı üç uca bağla.
2. Alanlar: `enabled` (anahtar), host, port (seçim: 25/465/587/2525), `smtpSecure`,
   kullanıcı adı, parola, `fromName`, `fromAddress`.
3. **Parola yaz-only:** `smtpPasswordSet: true` ise `••••••••` placeholder'ı göster;
   kullanıcı dokunmadıysa istekte alanı **GÖNDERME** (mevcut parolayı ezmesin). Temizleme
   için açık bir eylem (`null` gönderir).
4. `effectiveSource`'u kullanıcıya göster — "Şu anda: veritabanı yapılandırması / sunucu
   ortam değişkenleri / geliştirme test kutusu / yapılandırılmamış". Bu, özelliğin
   "gerçek" hissettiren asıl parçasıdır.
5. "Test E-postası Gönder" butonu: yalnızca kayıtlı yapılandırmayla çalışır, kaydedilmemiş
   değişiklik varken kullanıcıyı önce kaydetmeye yönlendir. Sonucu ve `lastTestedAt` /
   `lastTestSucceeded` durumunu göster. `previewUrl` doluysa bağlantı olarak sun.
6. `422`/`502` hatalarını alan bazında göster; mevcut `useUnsavedChangesGuard` hook'unu kullan.
7. **YAPMA:** yeni görsel dil/renk kararı (ui-designer'ın; mevcut `Card`/`Field`/`SectionHeader`
   bileşenleri yeterli — bu kart zaten var, yalnızca kilidi kalkıyor).

### qa-agent
1. **Parolanın hiçbir yanıtta, logda veya hata gövdesinde görünmediği** (en kritik test).
2. Üç-durumlu parola: gönderme → korunur; `null` → temizlenir; dolu → değişir.
3. `enabled: false` iken env yapılandırmasının kullanıldığı; `true` iken DB'nin kazandığı.
4. `enabled: true` + boş `smtpHost` → `422`.
5. Test ucunun **yalnızca** isteği yapan kullanıcının adresine gönderdiği; gövdeye `to`
   enjekte etmenin işe yaramadığı.
6. MANAGER ve EDITOR için üç ucun da `403` döndüğü.
7. Rate limit (4. istek → `429`).
8. E2E: `/admin/settings` → "E-posta / API Yapılandırmaları" sekmesinde "Yakında" rozetinin
   **artık olmadığı** ve input'ların etkin olduğu.

### Kapsam DIŞI (bilinçli)
- Sağlayıcı API taşımaları (Resend/SES/SendGrid HTTP) — SMTP yeterli, `EmailSettings` adı
  ileride buna yer bırakıyor.
- Tenant/site başına birden fazla SMTP profili — singleton yeterli.
- Gönderim kuyruğu/yeniden deneme mantığı — ayrı bir iş.
- Env değerlerinin DB'ye otomatik taşınması (§3.2).

---

## 7. Definition of Done ek maddeleri

Ortak DoD'a (`.claude/CLAUDE.md`) ek olarak bu iş için:

- [ ] security-agent §2 şifreleme yaklaşımını **açıkça onayladı** (§4.4 dahil).
- [ ] Hiçbir uç, log veya audit kaydı düz metin parolaya temas etmiyor (qa-agent doğruladı).
- [ ] `enabled: false` iken mevcut env tabanlı gönderim davranışı **hiç değişmedi** (regresyon).
- [ ] Transporter önbelleği yapılandırma değişince geçersizleşiyor (§3.4).
- [ ] compliance-agent'a **gerek YOK**: saklanan veri kişisel veri değil, altyapı kimlik
      bilgisidir. Tek temas noktası `EmailSettingsTestResponse.sentTo` — sözleşmede zaten
      maskeli. (Bu değerlendirme architect'e aittir; compliance-agent itiraz ederse
      kararı onundur.)
