# Security Review — Hasta Kimlik Bilgisi Tasarımı (`[DPI]` §2.3-2.7) — TASARIM ONAYI

> **Denetçi:** security-agent
> **Kapsam:** `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §2.3
> (şifreleme+hash), §2.4 (TCKN algoritması), §2.5 (dil kuralı), §2.6-2.7 (akış/erişim yetkisi),
> §6 madde 0b. **Bu bir TASARIM ONAYIDIR** — implementasyon henüz YOK (db-agent ile PARALEL).
> Kaynak kod incelemesi yalnızca **mevcut/yeniden kullanılacak** yardımcılara (`lib/crypto.ts`,
> `lib/tokens.ts`, `lib/api-key.ts::timingSafeEqualHex`, `lib/telehealth-access.ts`,
> `lib/tr-identity.ts`, `lib/rate-limit.ts`, `plugins/security.ts`) karşı yapıldı; `[DPI]`'de
> tarif edilen `lib/identity.ts` henüz yazılmamıştır.
> **Sonuç: ONAY (koşullu — aşağıdaki ENGELLEYİCİ maddeler implementasyonda zorunlu).**
> İmplementasyon sonrası ikinci tur denetim ayrıca yapılacaktır ([DPI] §6 madde 7).
> **2. TUR SONUCU (aşağıda): ONAY — 5/5 ENGELLEYİCİ madde PASS.** Bkz. "İkinci Tur" bölümü.

---

## Özet tablo

| # | Konu | Sonuç |
|---|---|---|
| 1 | HKDF+HMAC kararı (çıplak SHA-256 yasağı) | **ONAY** — doğru tehdit modeli, düşük entropili girdi için tek savunma keyed-hash'tir |
| 2 | Anahtar rotasyon sonucu | **ONAY + GAP tespit edildi** — "kurtarılabilir" iddiası ancak bir **runbook/script** varsa doğrudur; böyle bir araç bugün **yok** |
| 3 | Maskeleme oranı (≤5 karakter) | **ONAY** — TR için "son 2" zaten checksum hanesidir, gerçek ek bilgi ≈3 hane |
| 4 | Erişim kontrolü matrisi | **ONAY** — mevcut `lib/telehealth-access.ts` deseniyle birebir uyumlu; 1 implementasyon notu |
| 5 | Hata gövdelerinin girdiyi yansıtmaması | **ONAY, ENGELLEYİCİ koşullu** — mevcut Zod/error-handler deseni riskli, açık kural gerekli |
| 6 | Hız sınırı / numara tarama | **ONAY** — mevcut 5/dk yeterli, gerçek bir "oracle" yok; 1 tavsiye |
| 7 | TCKN algoritması + dil kuralı | **ONAY** — algoritma doğru, `lib/tr-identity.ts` ile bilinçli ayrım; dil kuralı doğru çerçevelenmiş |

---

## 1. HKDF + HMAC kararı (§2.3) — ONAY

`lib/tokens.ts::hashToken` doğrulandı — çıplak `crypto.createHash("sha256")`, tuz/pepper YOK
(satır 8-10). Bu, 256-bit rastgele token'lar (`generateOpaqueToken`, `generateApiKey`) için
doğrudur çünkü saldırgan **anahtarsız** bir fonksiyonla 2^256'lık bir uzayı asla tarayamaz.
T.C. Kimlik No için aynı yardımcıyı kullanmak kategorik bir hatadır: değer uzayı ilk hane≠0 ve
iki checksum hanesi nedeniyle **etkin olarak ~9×10⁸** (d1-d9 serbest, d10/d11 türetilir) — tuzsuz
SHA-256 için bu, modern bir GPU'da rainbow table/kaba kuvvetle saniyeler-dakikalar mertebesinde
tersine çevrilebilir bir uzaydır. Şifreli kolonun (`identityNumberCiphertext`) yanında böyle bir
hash bulunması, "şifreleme + ayrı arama indeksi" ayrımını **anlamsızlaştırır** çünkü hash zaten
açık numarayı taşır.

`crypto.hkdfSync("sha256", ENCRYPTION_KEY, salt, info, 32)` ile türetilen `subKey` +
`crypto.createHmac("sha256", subKey)` doğru çözümdür: HMAC **anahtarlıdır** — saldırgan `subKey`'i
(dolayısıyla `ENCRYPTION_KEY`'i) bilmeden çevrimdışı hiçbir tarama yapamaz; düşük giriş entropisi
(10^9) artık önemsizdir çünkü saldırganın denemesi gereken şey giriş uzayı değil, 256-bit
`ENCRYPTION_KEY`'in kendisidir. `salt`/`info` ile alan ayrımı (domain separation) doğru
kullanılmış — aynı `ENCRYPTION_KEY`'den türetilen `subKey`, AES şifreleme anahtarıyla
**kriptografik olarak bağımsızdır** (HKDF'nin garantisi). Yeni env değişkeni gerekmemesi doğru
gerekçelendirilmiş (devops'a yeni sır yükü yok).

**Codebase'de emsal yok** — bu, projede `crypto.hkdfSync` kullanan **ilk** kod olacak (grep ile
doğrulandı, `backend/src` içinde başka hiçbir `hkdfSync` çağrısı yok). Bu yeni bir örüntü olduğu
için implementasyonda şu noktalar **ENGELLEYİCİ**:

- `subKey` türetimi `lib/crypto.ts`'teki `encryptionKey` deseniyle **AYNI** şekilde **modül
  yükleme anında bir kez** hesaplanıp sabitlenmeli (her çağrıda yeniden `hkdfSync`
  çalıştırılmamalı — performans değil, **tutarlılık/hata yüzeyi** gerekçesiyle: `salt`/`info`
  string literalleri `lib/identity.ts` içinde birer `const` olarak **tek yerde** tanımlanmalı,
  ikinci bir kopyası açılmamalı).
- `crypto.hkdfSync` bir `ArrayBuffer` döner, `Buffer` değil — `crypto.createHmac`'e geçirmeden
  önce `Buffer.from(...)` ile sarmalanmalı; birim testte (`HMAC determinizmi`, [DPI] §6 madde 2
  zaten şart koşuyor) bu dönüşümün doğru çalıştığı dolaylı olarak kanıtlanmış olur.
- `subKey`/`ENCRYPTION_KEY` hiçbir log/hata/audit alanına yazılmamalı (mevcut `redact` listesi
  bunu adıyla hedeflemiyor — `identity.ts` içinde asla `console.log`/`request.log.*` ile
  yazdırılmayacağının kod incelemesiyle teyidi, 2. tur denetimin parçası olacak).

## 2. Anahtar rotasyon sonucu (§2.3) — ONAY + GAP

Teknik iddia doğrudur: `identityNumberCiphertext` çözülüp yeni `ENCRYPTION_KEY` ile yeniden
şifrelenebilir, ardından yeni `subKey` ile yeniden HMAC'lenebilir — **veri kaybı olmadan**
kurtarılabilir. Ancak `lib/crypto.ts` incelendi: `encryptionKey` **tek** bir env değerinden
türetilir, ciphertext formatında (`iv:authTag:ciphertext`) bir **anahtar sürüm/ID öneki YOK**,
ve kod tabanında **hiçbir yerde** anahtar rotasyonu için "eski anahtarla dene, olmazsa yeniyle"
gibi bir çoklu-anahtar mekanizması ya da script mevcut değil (grep ile doğrulandı).

**Sonuç:** "Kurtarılabilir" iddiası doğru ama **otomatik değildir** — bugün `ENCRYPTION_KEY` prod
ortamında değiştirilip redeploy edilirse, hem yeni identity hash'leri hem de **halihazırda var
olan TÜM `encryptSecret` değerleri** (TOTP secret, `AppointmentIntake.noteCiphertext`,
`binary-crypto.ts` kullanan alanlar) **aynı anda ve geri dönüşsüz** okunamaz hale gelir; "decrypt
edip yeniden hash'le" adımını gerçekleştirecek bir offline migration script **yoktur**. Bu,
[DPI]'nin tanıttığı bir risk **değildir** — mevcut, bu turdan önce de var olan bir boşluktur; ama
identity hash'lerinin eklenmesiyle rotasyonun maliyeti/görünürlüğü artar (§3.1'deki "Toplam
Hasta" metriği rotasyon sonrası sessizce sıfırlanır/bozulur).

**Gereklilik (ENGELLEYİCİ DEĞİL, ama runbook borcu açıkça işaretlenir):** Bu tur `ENCRYPTION_KEY`
rotasyon script'i yazmayı **kapsamına almıyor** (backend-agent'ın işi değil, devops/architect
kapsamı) — ancak documentation-agent'ın [DPI] §6 madde 11'de zaten yazması istenen not
("`ENCRYPTION_KEY` rotasyonu kimlik hash'lerini geçersiz kılar, yeniden hash'lenebilir") **yeterli
değildir** çünkü "yeniden hash'lenebilir" için gerçek bir araç yoktur. documentation-agent/
devops-agent'a **ayrı bir backlog maddesi** olarak iletiyorum: `ENCRYPTION_KEY` rotasyon runbook'u
(offline decrypt-then-reencrypt script'i, TÜM `encryptSecret` tüketicileri için, yalnızca identity
için değil) bu turda yazılmasa da mimari borç olarak kaydedilmeli. Bu, mevcut bir boşluğun
büyümesidir, bu turun DoD'sini **bloklamaz**.

## 3. Maskeleme oranı (§2.4) — ONAY

TR: ilk3+son2 açık. Önemli bir hafifletici doğrulama: son iki hane (`d10`, `d11`) **checksum
haneleridir** — ilk 9 haneden **matematiksel olarak türetilir**, dolayısıyla saldırgana **yeni
bir entropi bilgisi eklemezler** (ilk 9 hane bilinirse zaten hesaplanabilirler). Gerçek ek bilgi
yalnızca ilk 3 hanedir; kalan bilinmeyen alan 6 hane (`d4..d9`) = 10^6 kombinasyon — bu hâlâ kaba
kuvvetle taranabilir bir uzaydır, **ama** maskelenmiş değer hiçbir yerde bir arama/doğrulama
anahtarı olarak KULLANILMIYOR (yalnızca DTO'da görüntüleme), gerçek numaraya erişim AES-256-GCM +
eşik bazlı erişim kontrolü + audit ile ayrıca korunuyor (§2.7). Bu nedenle maskeleme oranı
**görüntüleme amacına** göre yeterlidir; ApiKey `keyPrefix`/`last4` emsaliyle (`lib/api-key.ts`)
tutarlıdır. FOREIGN için ilk2+son2 aynı mantıkla kabul edilir (pasaportta checksum yok, dolayısıyla
oradaki 4 hane/karakter gerçek ek bilgidir — daha "pahalı" bir ifşa ama pasaport numaraları zaten
TCKN'den daha yüksek entropili ve format ülkeye göre değişken, kabul edilebilir).

## 4. Erişim kontrolü (§2.6-2.7) — ONAY + 1 implementasyon notu

`lib/telehealth-access.ts` okundu. Mevcut `assertBookingHealthDataAccess` **tam olarak** istenen
eşiği uyguluyor: `ADMIN` ✓, booking'in doktoru ✓, hasta ✓, `MANAGER`/`EDITOR`/başka doktor → HER
ZAMAN `404` (throw, `NotFoundError`) — IDOR disiplini (`403` değil `404`) [TCT]'den beri tutarlı.
`assertBookingPatientOnlyAccess` da mevcut ve `PUT .../intake` için zaten kullanılıyor — `PUT
.../identity` için **birebir aynı** fonksiyon yeniden kullanılabilir, yeni bir yetki fonksiyonu
YAZILMASINA gerek yok.

**Uyum notu (ENGELLEYİCİ):** [DPI] §2.7 iki farklı davranış istiyor: (a) liste/detay DTO'sunda
`identity` alanı eşiği geçemeyen aktörler için **`null`** (booking'in kendisi hâlâ görünür — ör.
MANAGER booking'i görür), (b) `GET .../identity` ucunda aynı eşik **`404`** fırlatır. Mevcut
`assertBookingHealthDataAccess` yalnızca **throw eden** bir "assert" biçimindedir — dedike uçta
(b) doğrudan kullanılabilir, ama mapper'da (a) için booking'in geri kalanını render ederken
`identity`'yi `null`'a düşürmek üzere onu `try/catch` ile sarmalamak **kırılgan bir örüntüdür**
(gelecekte `assertBookingHealthDataAccess` içine yeni bir throw eklenirse mapper'da sessizce
yutulabilir, ve NotFoundError sarmalamak semantik olarak yanlıştır — "bulunamadı" burada
"var ama gösterme" demektir). backend-agent'a **zorunlu** tavsiye: `lib/telehealth-access.ts`'e
throw ETMEYEN bir kardeş fonksiyon eklensin, ör. `canAccessBookingHealthData(booking, request):
boolean`, ve `assertBookingHealthDataAccess` bunun üzerine `if (!canAccessBookingHealthData(...))
throw new NotFoundError(...)` şeklinde yeniden yazılsın (davranış değişmez, tek kaynak — mapper
hem `canAccessBookingHealthData` ile `identity` doldurma kararını, hem dedike uç
`assertBookingHealthDataAccess` ile 404'ü aynı mantıktan türetir). Bu, `lib/telehealth-access.ts`
dosyasında küçük bir refactor gerektirir (backend-agent kapsamı, db-agent/security-agent
kapsamı DEĞİL) — **ENGELLEYİCİ**, çünkü aksi hâlde try/catch deseni gelecekte sessiz bir
yetki sızıntısına dönüşebilir.

`PUT .../identity` → yalnızca hasta + `paymentStatus === PENDING`, aksi `409 IDENTITY_LOCKED`:
onaylanıyor, `checkout-session` ucunun zaten aynı booking'i `PENDING` dışı durumlarda kilitleme
mantığıyla (`telehealth.checkout.routes.ts`) tutarlı bir örüntü.

## 5. Hata gövdelerinin girdiyi yansıtmaması (§2.4/§2.5) — ONAY, ENGELLEYİCİ koşullu

`backend/src/plugins/error-handler.ts` incelendi: `isZodError` dalı `flattenZodIssues` ile
**yalnızca** `issue.path`/`issue.message`'ı `VALIDATION_ERROR` gövdesine yazıyor — Zod'un
`issue.received`/`issue.input` gibi alanları **serileştirilmiyor** görünüyor (yalnızca
mesaj metni). Bu genel davranış güvenlidir, **ANCAK** tek başına yeterli değildir: eğer
backend-agent `identityNumber` alanı için `.refine()`/`.superRefine()` içinde **mesaj
string'ine değeri interpolasyon yaparsa** (ör. `` `Geçersiz kimlik numarası: ${value}` ``),
bu numara `message` alanı üzerinden **doğrudan yanıta sızar** — `flattenZodIssues` bunu
filtrelemez, aynen taşır.

**ENGELLEYİCİ kural (backend-agent'a):** `lib/identity.ts` ve onu tüketen Zod şemalarındaki
TÜM hata mesajları **sabit, jenerik metinler** olmalı (ör. `"Geçersiz T.C. Kimlik Numarası
formatı."`, `"Geçersiz pasaport numarası formatı."`) — girilen değer, normalize edilmiş hâli,
veya bunun bir kısmı (maskelenmiş dahi olsa) **mesaj string'ine ASLA enjekte edilmez**. Aynı
kural `422 IDENTITY_MINOR_NOT_SUPPORTED` ve `409 IDENTITY_LOCKED` için de geçerlidir — hata
kodu/mesajı jenerik kalır, `details` gövdesine de `identityNumber` alanı YAZILMAZ. Bu, code-
quality-agent'ın grep taramasına (§6 madde 9) eklenmesi gereken bir kalıptır: `identityNumber`
değişkeninin herhangi bir `throw new ValidationError(...)`/template literal içinde geçmediğinin
doğrulanması.

## 6. Hız sınırı / kimlik numarası tarama riski (§2.6) — ONAY

`lib/rate-limit.ts::BOOKING_CREATE_RATE_LIMIT = { max: 5, timeWindow: "1 minute" }` (IP bazlı,
`plugins/security.ts`'teki global varsayılan `keyGenerator`ı kullanıyor, override YOK) — bu
değer [DPI] ile **değişmiyor**, kimlik alanı aynı isteğin gövdesine ekleniyor.

**Gerçek tehdit modeli değerlendirmesi:** Klasik "credential stuffing/enumeration" senaryosunun
burada çalışması için sunucunun bir **oracle** sağlaması gerekir (ör. "bu TCKN sistemde kayıtlı
mı?" sorusuna farklı yanıt). Bu tasarımda böyle bir oracle **yok**:
- TCKN checksum algoritması **kamuya açık ve istemci tarafında da birebir mirror'lanıyor**
  ([DPI] §6 madde 4) — saldırganın "bu numara algoritmik olarak geçerli mi?" sorusunu sormak
  için sunucuya hiç ihtiyacı yok, offline hesaplanabilir.
- `POST /identity/validate` gibi ayrı bir kimlik-sorgu ucu **açıkça yasaklanmış** ([DPI] §6
  madde 2) — tek yol booking oluşturmanın **içinden**, gerçek bir slot+e-posta ile geçiyor.
- Hata gövdeleri girdiyi yansıtmıyor (madde 5) ve `identityNumberHash` hiçbir yanıtta dönmüyor.
- Geçersiz kimlik → `422`, **slot tutulmaz** — bu, geçersiz denemelerle slot-tükenmesi (DoS)
  riskini zaten kapatıyor; geçerli-formatlı ama gerçek olmayan (senteik) bir numarayla slot
  tutmak teorik olarak mümkün ama bu **[DPI] öncesinde de** (patientName/patientEmail ile) var
  olan genel bir spam/slot-squatting riskidir, kimlik alanı bunu **artırmıyor** — mevcut 5/dk
  IP limiti bu riski [TCT]'den beri aynı şekilde sınırlıyor.

**Sonuç:** Mevcut hız sınırı yeterlidir, kimlik alanının eklenmesi yeni bir rate-limit
gerektirmez. **Tavsiye (ENGELLEYİCİ DEĞİL):** `GET /appointments/bookings/{bookingId}/identity`
— açık numarayı döndüren **tek uç** — codebase'deki diğer "tek noktadan PII/secret açığa çıkaran"
uçlarla (meeting-token 10/dk, recording-access 10/dk) aynı sınıftadır; DPI bu uca özel bir limit
öngörmüyor ama tutarlılık için `config: { rateLimit: { max: 10, timeWindow: "1 minute" } }`
eklenmesi önerilir (global varsayılan zaten bir taban oluşturuyor, bu ek bir savunma katmanıdır).
`PUT .../identity` için de aynı öneri geçerli, mevcut `PUT .../intake` presedansı (rate-limit
YOK, yalnızca global) kabul edilebilir asgari çizgidir.

## 7. TCKN algoritması + dil kuralı (§2.4-2.5) — ONAY

Mod-11/mod-10 algoritması matematiksel olarak doğru (resmî TCKN checksum formülü) ve
`lib/tr-identity.ts::isValidTcKimlikNo` (checkout/orders modülü, `billing.nationalId` için)
ile **aynı formülü** uyguluyor — çapraz doğrulama mümkün oldu, iki bağımsız yerde aynı sonuç.
**Not (bilgi amaçlı, ENGELLEYİCİ DEĞİL):** bu, codebase'de TCKN checksum algoritmasının
**ikinci** implementasyonu olacak (`lib/tr-identity.ts` zaten var, checkout/orders modülü
tüketiyor). [DPI] §6 madde 2 bunu **yeni bir dosya** (`lib/identity.ts`) olarak istiyor — bu,
[TCT]'nin "tek yardımcı" ilkesiyle yüzeysel bir gerilim gibi görünse de **haklı bir ayrımdır**:
`tr-identity.ts::isValidTcKimlikNo` **repdigit reddi YAPMIYOR** (`11111111110` checkout'ta hâlâ
"geçerli" kabul edilir) ve pasaport/18-yaş/maskeleme gibi telehealth'e özgü kuralları taşımıyor
— iki modülün gereksinimleri farklılaştığı için ayrı dosya doğru karardır, **ANCAK** bu, checkout
modülünün repdigit reddi eksikliğinin ayrı bir (bu turun kapsamı DIŞINDA) bulgu olduğunu da ortaya
çıkarıyor; code-quality-agent/architect'e bilgi amaçlı iletilir, bu turu bloklamaz.

**Dil kuralı (§2.5):** doğru çerçevelenmiş — bu bir **format denetimidir**, NVİ/KPS sorgusu
değildir; `identityCapturedAt` adlandırması ve "doğrulandı" ifadesinin yasaklanması OWASP
açısından değil ama **kullanıcı güvenini yanlış yönlendirmeme** (misrepresentation) açısından
doğru bir disiplindir — sahte bir güvenlik/doğrulama garantisi vermek, kullanıcıların gerçek
riskini (ör. sahte kimlikle randevu alınabilir olması) yanlış değerlendirmesine yol açabilir.
Onaylanıyor, security-agent bu dil kuralını kendi çıktısında da uyguladı (bu doküman boyunca
"doğrulama" yerine "denetim/format kontrolü" kullanıldı).

---

## Backend-agent için ENGELLEYİCİ gereksinimler (implementasyonda zorunlu)

1. `subKey` HKDF türetimi `lib/crypto.ts::encryptionKey` deseniyle **modül yükleme anında bir
   kez**, `salt`/`info` **tek yerde tanımlı sabitler** olarak — `crypto.hkdfSync` dönüşü
   `Buffer.from(...)` ile sarmalanmalı.
2. `lib/telehealth-access.ts`'e throw ETMEYEN `canAccessBookingHealthData(...): boolean`
   eklenmeli; hem mapper'ın `identity: null` kararı hem `assertBookingHealthDataAccess`'in
   `404`'ü **aynı** bu fonksiyondan türemeli (try/catch ile sarmalama YASAK).
3. Kimlik doğrulama/format hatalarının (`422`, `409 IDENTITY_LOCKED`,
   `422 IDENTITY_MINOR_NOT_SUPPORTED`) mesaj/`details` gövdesi **sabit ve jenerik**; girilen
   numara veya normalize edilmiş hâli hiçbir hata yanıtına enjekte edilmez.
4. `hashToken`/`tr-identity.ts::isValidTcKimlikNo` kimlik akışında **hiçbir yerde**
   kullanılmaz (grep ile kanıt — code-quality-agent'ın DoD maddesiyle çakışıyor, security-agent
   2. turda ayrıca doğrulayacak).
5. `subKey`/`ENCRYPTION_KEY`/açık kimlik numarası hiçbir `request.log`/`console`/audit
   `metadata` çağrısına geçirilmez.

## Backend-agent / devops-agent için tavsiyeler (ENGELLEYİCİ DEĞİL)

- `GET .../identity` ve `PUT .../identity` uçlarına `{ max: 10, timeWindow: "1 minute" }`
  düzeyinde route-level rate limit eklenmesi (tutarlılık, meeting-token/recording-access
  emsali).
- `ENCRYPTION_KEY` rotasyon runbook'u (offline decrypt-then-reencrypt script'i, tüm
  `encryptSecret` tüketicileri için) devops-agent/architect'e ayrı bir backlog maddesi olarak
  iletildi — bu turun DoD'sini bloklamaz.
- `lib/tr-identity.ts`'in repdigit reddi eksikliği (checkout modülü) architect/code-quality-
  agent'a bilgi amaçlı iletildi — bu turun kapsamı dışı.

---

## Sonuç

[DPI] §2.3-2.7'deki tasarım kararlarının tamamı OWASP açısından sağlam bir tehdit modeline
dayanıyor: düşük entropili girdi için anahtarlı hash (HMAC) doğru birincil savunma, şifreleme/
hash ayrımı korunuyor, erişim matrisi mevcut IDOR disipliniyle (404, eşik bazlı) birebir tutarlı,
hata gövdeleri ve dil kuralı bilgi sızıntısını/yanlış güvenlik algısını önlüyor, mevcut hız sınırı
yeni bir oracle olmadığı için yeterli. Kritik bir mimari risk veya red gerektiren bir bulgu
**yok**. **Karar: ONAY** — yukarıdaki 5 madde implementasyonda ENGELLEYİCİ, tavsiyeler isteğe
bağlıdır. İmplementasyon sonrası 2. tur denetim ([DPI] §6 madde 7) zorunludur.

---

## İkinci Tur (İmplementasyon Denetimi)

> **Denetçi:** security-agent — **Sonuç: ONAY.** Gerçek kod incelendi (backend + frontend).
> 5/5 ENGELLEYİCİ madde **PASS**. Yeni bir IDOR/yetki/PII-sızıntısı bulgusu **yok**. 1
> ENGELLEYİCİ-OLMAYAN tavsiye (route-level rate limit) hâlâ uygulanmamış — backend-agent'a
> tekrar iletiliyor, bu turu BLOKLAMIYOR.

### Özet tablo

| # | Konu | Dosya | Sonuç |
|---|---|---|---|
| 1 | HKDF `subKey` modül-yükleme-anında, tek yerde | `lib/identity.ts` | **PASS** |
| 2 | `canAccessBookingHealthData` (throw etmeyen) var + mapper'da try/catch YOK | `lib/telehealth-access.ts`, `mappers/index.ts` | **PASS** |
| 3 | Hata mesajları sabit/jenerik, girdiyi yansıtmıyor | `lib/identity.ts`, `telehealth.identity.routes.ts`, `lib/errors.ts` | **PASS** |
| 4 | `hashToken`/`tr-identity.ts` kimlik akışında kullanılmıyor | grep kanıtı | **PASS** |
| 5 | Log/audit'te numara/maske sızıntısı yok | `telehealth.identity.routes.ts` (`logAudit`) | **PASS** |
| 6 | Frontend: kimlik no `localStorage`/`sessionStorage`/URL/analytics'e yazılmıyor | `telehealth-identity.ts`, `identity-step-dialog.tsx` | **PASS** |
| 7 | `autoComplete="off"` + TCKN için `inputMode="numeric"` | `identity-step-dialog.tsx` | **PASS** |
| 8 | Route-level rate limit (`GET`/`PUT .../identity`, 10/dk) | `telehealth.identity.routes.ts` | **UYGULANMAMIŞ** (ENGELLEYİCİ DEĞİL — devredildi) |

### 1. HKDF `subKey` — PASS

`backend/src/lib/identity.ts:260-268`: `identityHashSubKey`, modül gövdesinde (fonksiyon
dışında) `crypto.hkdfSync(...)` ile **bir kez** hesaplanıp `const` olarak sabitleniyor —
`lib/crypto.ts::encryptionKey` (satır 15) ile **birebir aynı** desen. `Buffer.from(...)` sarmalaması
mevcut (dönen `ArrayBuffer`'ı `Buffer`'a çeviriyor). `salt`/`info` string literalleri
(`IDENTITY_HASH_HKDF_SALT`, `IDENTITY_HASH_HKDF_INFO`) dosyada **tek yerde** `const` olarak
tanımlı, ikinci bir kopyası yok (grep ile doğrulandı — dosyada başka `hkdfSync` çağrısı yok).
`hashIdentityNumber` her çağrıda yalnızca `crypto.createHmac(..., identityHashSubKey)` çağırıyor,
`hkdfSync`'i yeniden çalıştırmıyor.

### 2. `canAccessBookingHealthData` — PASS

`backend/src/lib/telehealth-access.ts:89-94` — throw ETMEYEN boolean yardımcı mevcut;
`assertBookingHealthDataAccess` (satır 103-106) bunun üzerine yeniden yazılmış
(`if (!canAccessBookingHealthData(...)) throw new NotFoundError(...)`) — tam istenen refactor.
Tüketiciler grep ile doğrulandı: `mappers/index.ts::toBookingIdentitySummaryDto` saf bir
`hasHealthDataAccess: boolean` parametresi alıyor (try/catch YOK); `telehealth.routes.ts`,
`telehealth.admin.routes.ts`, `telehealth.portal.routes.ts`, `telehealth.identity.routes.ts`
hepsi `canAccessBookingHealthData(...)` sonucunu doğrudan `toAppointmentBookingDto`'ya geçiriyor.
Dedike `GET .../identity` ucu ayrıca `assertBookingHealthDataAccess` ile `404` atıyor — aynı
mantıktan türüyor, kod tekrarı/sapma yok.

### 3. Hata mesajları — PASS

`lib/identity.ts` içindeki tüm hata fırlatmaları (`GENERIC_TR_IDENTITY_MESSAGE`,
`GENERIC_PASSPORT_MESSAGE`, `GENERIC_COUNTRY_CODE_MESSAGE`, `GENERIC_BIRTH_DATE_MESSAGE`) sabit
string literalleri — hiçbirinde template-literal interpolasyonu yok, `input.identityNumber`/
`input.birthDate` mesaj veya `details` gövdesine hiçbir yerde geçirilmiyor (kaynak okundu, satır
satır doğrulandı). `lib/errors.ts`'teki `IdentityMinorNotSupportedError` (422) ve
`IdentityLockedError` (409) de sabit varsayılan mesajlarla tanımlı, constructor'a hiçbir çağıran
taraf dinamik değer geçirmiyor. `telehealth.identity.routes.ts`'teki `NotFoundError` çağrıları
(`"Rezervasyon bulunamadı."`, `"Bu rezervasyon için kaydedilmiş bir kimlik bilgisi yok."`) da
sabit — booking id'sini bile yansıtmıyor.

### 4. `hashToken`/`tr-identity.ts` kullanılmıyor — PASS

`grep -rn "hashToken" backend/src/modules/telehealth backend/src/lib/identity.ts` — `identity.ts`
içindeki tek eşleşmeler **yorum satırları** (bilinçli olarak kullanılmadığını açıklayan dokümantasyon),
gerçek bir çağrı yok. `telehealth.routes.ts`/`booking.ts`/`notifications.ts`/
`telehealth.livekit.routes.ts` içindeki `hashToken` çağrıları **access-token hash'i** içindir
(magic-link/meeting-token), kimlik numarasıyla ilgisi yok — [TCT] döneminden beri var olan ayrı
bir kullanım. `grep -rn "tr-identity" backend/src` — yalnızca `checkout.schemas.ts` ve
`orders.schemas.ts` (billing.nationalId, [DPI] kapsamı dışı) + `identity.ts` içindeki açıklayıcı
yorumlar. Kimlik akışında hem `hashToken` hem `tr-identity.ts::isValidTcKimlikNo` **hiç
çağrılmıyor**.

### 5. Log/audit sızıntısı yok — PASS

`grep -rn "identityNumber\|patientBirthDate" backend/src --include="*.ts" | grep -i "log\|console\|audit"`
**boş sonuç döndü** — hiçbir eşleşme yok. `telehealth.identity.routes.ts`'teki iki `logAudit`
çağrısı okundu: `telehealth.identity.accessed` metadata'sı YOK (yalnızca `actorId`/`actorEmail`/
`targetId`/`ipAddress`); `telehealth.identity.updated` metadata'sı yalnızca
`{ fields: ["citizenshipType", "countryCode", "identityNumber", "birthDate"] }` — alan **adları**,
değerler değil. `GET .../identity` ucu `Cache-Control: no-store` header'ı taşıyor (§2.7 uyumu).

### 6. Frontend storage/analytics — PASS

`grep -rn "localStorage|sessionStorage" frontend/src/components/site/telehealth
frontend/src/lib/telehealth-identity.ts` — yalnızca **açıklayıcı yorum satırları** eşleşti
("YAZILMAZ" diyen dokümantasyon), gerçek bir `localStorage.setItem`/`sessionStorage.setItem`
çağrısı yok. `telehealth-identity.ts` tamamen saf fonksiyonlardan oluşuyor (DB/IO/ağ/storage
YOK) — sunucu tarafı `lib/identity.ts` ile birebir aynı algoritmaların istemci kopyası.
`identity-step-dialog.tsx` içinde `fetch`/`analytics`/`track` çağrısı yok (form state React
`useState` içinde bellekte tutuluyor).

### 7. `autoComplete`/`inputMode` — PASS

`identity-step-dialog.tsx`: TCKN input'u `inputMode="numeric"` + `autoComplete="off"` (satır
174-175) taşıyor; pasaport input'u da `autoComplete="off"` (satır 227) taşıyor (harf+rakam
karışık olduğu için `inputMode="numeric"` doğru şekilde uygulanmamış — beklenen).

### 8. Route-level rate limit — UYGULANMAMIŞ (ENGELLEYİCİ DEĞİL)

`telehealth.identity.routes.ts`'teki `GET`/`PUT .../identity` route tanımlarında `config:
{ rateLimit: ... }` **yok** (dosyada `rateLimit` hiç geçmiyor — grep ile doğrulandı; diğer
telehealth dosyalarında `meeting-token`/`recording-access` gibi uçlarda `{ max: 10, timeWindow:
"1 minute" }` deseni var, bu ikisinde yok). 1. tur incelemesinde bu **ENGELLEYİCİ DEĞİL,
tavsiye** olarak işaretlenmişti ve öyle kalıyor — global varsayılan rate limit (`plugins/
security.ts`) hâlâ bir taban oluşturuyor. **backend-agent'a tekrar iletiliyor:** tutarlılık için
`config: { rateLimit: { max: 10, timeWindow: "1 minute" } }` her iki route'a da eklenmeli.

### Yeni bulgu taraması

Yukarıdaki 8 maddenin ötesinde IDOR/eksik yetki kontrolü/PII sızıntısı türünde **yeni bir bulgu
yok**. `PUT .../identity`'nin `assertBookingPatientOnlyAccess` + `paymentStatus !== PENDING →
409` kapısı kod düzeyinde doğrulandı (`telehealth.identity.routes.ts:132-136`), [DPI] §2.6 ile
birebir uyumlu. `GET .../identity`'nin booking'de kimlik hiç yoksa (`citizenshipType`/
`identityNumberCiphertext`/vb. `null`) `404` attığı (satır 74-82) doğrulandı — istemciye "var ama
gösterilmiyor" ile "hiç yok" arasında sinyal karışıklığı yaratmıyor (her ikisi de `404`).

### Nihai karar

**ONAY.** [DPI] §6 madde 7 ikinci tur denetimi tamamlandı, 5/5 ENGELLEYİCİ madde implementasyonda
karşılanmış. Tek açık kalem (rate limit tavsiyesi) engelleyici değildir ve backend-agent'a
devredilmiştir.
