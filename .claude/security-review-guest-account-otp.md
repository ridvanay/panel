# Security Review — E-posta OTP Doğrulaması + Misafir Randevudan Hesap Oluşturma

> **Kaynak:** `.claude/architect-scope-guest-account-otp.md` (**[GAO]**) — bu doküman onun §3 ve
> §6 ENGELLEYİCİ maddelerine yanıttır. **Durum: §3 ONAYLANDI (küçük ek zorunluluklarla), §6'daki
> altı vektörün TAMAMINA karar verildi — ENGEL KALKTI**, aşağıdaki iki SIKILAŞTIRMA (Vektör 4,
> Vektör 6-b) backend-agent için BAĞLAYICIDIR. Kod YAZILMADI — bu doküman implementasyon
> talimatıdır; çelişki çıkarsa architect'e eskale edilir (CLAUDE.md: security-agent
> SIKILAŞTIRABİLİR, GEVŞETEMEZ, kararı bağlayıcıdır).

Doğrulanan dosyalar: `backend/src/lib/crypto.ts`, `backend/src/lib/tokens.ts`,
`backend/src/lib/backup-codes.ts`, `backend/src/modules/auth/auth.service.ts` (`register`,
`login`), `backend/src/modules/telehealth/lib/booking.ts::confirmBookingPayment`,
`backend/src/modules/telehealth/telehealth.routes.ts` (booking oluşturma yanıtı,
`accessToken`/`rawAccessToken` alanları), `backend/src/modules/telehealth/lib/notifications.ts`
(`triggerAppointmentConfirmationEmail` → `booking.patientEmail`'e gönderim),
`.claude/security-review-demo-payment-toggle.md`, `.claude/security-review-smtp-settings.md`.

---

## KARAR 1 (§3) — Kod formatı/hash/TTL/deneme/hız sınırı: **ONAYLANDI**, iki bağlayıcı ek

### 1.1 Kod formatı ve `crypto.randomInt`: ONAYLANDI

6 haneli, yalnızca rakam, `crypto.randomInt(0, 1_000_000)`, baştaki sıfırlar korunur. `Math.random()`
yasağı doğru. Ek gerekçe gerekmez, mevcut proje disiplinine (`lib/backup-codes.ts` de
`crypto.randomBytes` kullanıyor, `Math.random()` hiçbir güvenlik yardımcısında yok) uygun.

### 1.2 Hash — `ENCRYPTION_KEY`'in HMAC biberi olarak yeniden kullanımı: **ONAYLANDI, GÜÇLÜ**

`derivedKey = HMAC-SHA256(env.ENCRYPTION_KEY, "email-verification-code/v1")`,
`codeHash = HMAC-SHA256(derivedKey, "${userId}:${purpose}:${code}")` incelendi:

- Bu bir **HKDF-benzeri alan ayrımı** (domain separation) desenidir — `crypto.ts`'in AES anahtarı
  ile OTP peppera'ı arasında matematiksel bağımsızlık sağlar (ikinci bir HMAC turu, doğrudan
  `ENCRYPTION_KEY`'i mesajın anahtarı olarak kullanmaktan daha güvenlidir — anahtar sızıntısı
  senaryosunda bile `crypto.ts::encryptSecret/decryptSecret`'in AES-256-GCM kullanımıyla
  kriptografik olarak karışmaz).
- **Kritik gözlem — bu tasarım architect'in gerekçesinden bile DAHA GÜÇLÜ:** `lib/tokens.ts::
  hashToken` (düz sha256) neden yetersiz olduğu doğru tarif edilmiş ("10⁶ girdi, DB dökümünde
  saniyeler içinde tersine çevrilir") — ama HMAC biberleme yalnızca "daha yavaş" değil, **anahtar
  olmadan hesaplanamaz** kılar: `ENCRYPTION_KEY` sızmadığı sürece, `codeHash` DB'den çalınsa bile
  saldırgan 10⁶'lık alanı OFFLINE deneyemez — `derivedKey` olmadan hiçbir rainbow table/brute-force
  önceden hesaplanamaz. Yani "20 bit entropi" endişesi yalnızca ONLINE deneme sınırıyla (§3.4, 5
  deneme) değil, HMAC'in kendisiyle de kapatılıyor. `lib/backup-codes.ts::hashBackupCode`'un düz
  sha256 kullanmasıyla (yedek kodlar ~40 bit) kıyaslandığında bu **bilinçli ve doğru bir sapma.**
- **Yeni env değişkeni yok** ilkesi `.claude/architect-scope-smtp-settings.md` §2.2 ile tutarlı
  ve `security-review-smtp-settings.md` KARAR 1'in "ikinci bir şifreleme/anahtar yaşam döngüsü
  açma" reddiyle aynı çizgide — onaylanır.
- `ENCRYPTION_KEY` rotasyonunun canlı kodları geçersiz kılması kabul edilebilir (kodlar
  dakikalar/saatler yaşar) — `security-review-smtp-settings.md` KARAR 4'teki "fail closed, sessiz
  degrade yok" felsefesiyle aynı sınıf risk, aynı kabul.
- `crypto.timingSafeEqual` ile karşılaştırma: **ZORUNLU** — eşit uzunluklu hex buffer'lar
  (`Buffer.from(hex, "hex")`), uzunluk farkı varsa (olmamalı, ikisi de HMAC-SHA256 hex çıktısı,
  64 karakter) `timingSafeEqual` fırlatır; backend-agent bunu try/catch ile `false`'a düşürmeli,
  **fırlatmayı yukarı sızdırmamalı** (aksi halde `401` yerine `500` dönebilir — bu küçük ama
  gerçek bir implementasyon tuzağıdır, unit test §9 backend-agent madde 8'e eklenmeli).

**Ek bağlayıcı zorunluluk (yeni, bu incelemede eklendi):** `hashOtpCode`'un girdi `code`'u
**HER ZAMAN** doğrulamadan önce sabit uzunlukta olmalı (6 karakter, baştaki sıfırlar dahil) —
kullanıcı girdisi trim edildikten sonra `/^\d{6}$/` ile doğrulanmadan HMAC'e verilmemeli; aksi
halde `"48213"` (5 hane) gibi bir girdi farklı bir mesaj uzunluğu üretir ve teorik olarak (düşük
riskli ama bedelsiz kapatılabilir) bir yapı sızıntısı olur. `lib/otp.ts`'e bu format kontrolü
`consumeVerificationCode`'un EN BAŞINA (hash hesaplamadan ÖNCE) eklenmeli; format uymuyorsa
doğrudan `401 VERIFICATION_CODE_INVALID` (deneme sayacı yine artırılır — §3.4 ile tutarlı).

### 1.3 TTL: ONAYLANDI

`EMAIL_VERIFICATION` 10 dk / `ACCOUNT_ACTIVATION` 24 saat — gerekçe (kullanım bağlamı farkı)
makul, 24 saatlik pencerenin 5-deneme + hedef-başına cooldown ile güvenli kaldığı hesaplaması
doğru (~200.000 deneme, 60 sn cooldown altında pratikte imkânsız).

### 1.4 Deneme sınırı ve geçersiz kılma: ONAYLANDI

5 deneme, `attemptCount >= 5` ölümcül, yeni kod eskiyi geçersiz kılar, satır silinmez (denetim
izi korunur) — hepsi doğru ve `codeHash`'in `@unique` OLMAMASI (§1.4 [GAO]) ile birlikte tutarlı
bir bütün oluşturuyor.

### 1.5 Hedef-başına hız sınırı: ONAYLANDI (bkz. KARAR 5, Vektör 5)

---

## KARAR 2 (§6 Vektör 1) — Hesap ele geçirme: **DOĞRULANDI, ele geçirme DEĞİL**

`auth.service.ts::login` (satır 98-136) incelendi: `verifyPassword` başarısız/kullanıcı yok →
jenerik `401`; `SUSPENDED`/`DELETED` → `403`; 2FA açıksa token verilmez. Bu zincire, [GAO] §2.3
gereği **`emailVerifiedAt === null` kontrolü şifre doğrulamasından SONRA, 2FA'dan ÖNCE**
eklenecek — mevcut desenle (2FA challenge deseni) birebir aynı disipline oturuyor, **DOĞRULANDI.**

Sağlanan hesabın şekli (§5.2) doğrulandı: rastgele parola (`crypto.randomBytes(32)`) hiçbir yere
yazılmıyor/loglanmıyor **olmalı** — bu mevcut kodda henüz yok, bu yüzden bağlayıcı bir ek koşul
olarak yazıya geçiriyorum:

**Bağlayıcı ek koşul:** `provisionPatientAccountForBooking` içinde üretilen rastgele parola
**hiçbir `app.log.*` çağrısına, hiçbir audit `metadata`'sına, hiçbir dönüş değerine dahil
edilmeyecek** — fonksiyon yalnızca oluşturulan `User.id`'yi döndürmeli, parolanın kendisi
fonksiyon gövdesi dışına asla çıkmamalı (yerel değişken, kullanıldıktan hemen sonra kapsamdan
düşer). code-quality-agent'ın PR denetiminde bu satırı özellikle arayacağı belirtilmeli
(`§9 code-quality-agent`'a 4. madde olarak eklenmesi önerilir: "rastgele parolanın hiçbir
log/audit/response'a sızmadığı").

**Sonuç: Vektör 1 — ONAYLANDI, ele geçirme değil, iki bağımsız kilit (rastgele+yazılmayan parola,
`emailVerifiedAt` gate) doğru tasarlanmış.**

---

## KARAR 3 (§6 Vektör 2) — Demo-pay istisnası: **ONAYLANDI**

`.claude/security-review-demo-payment-toggle.md` ile çapraz kontrol edildi: demo-pay ucu zaten
üç katmanlı fail-closed korumaya tabi (boot-time env kontrolü prod'da `process.exit(1)`,
register-time `404` gizleme, request-time `403 DEMO_PAYMENTS_DISABLED` DB AND-gate'i) ve bu
korumaların HİÇBİRİ bu turda değişmiyor. Sağlamanın (`provisionPatientAccountForBooking`) demo-pay
yolunda da çalışması, üretimde **hiçbir ek risk açmaz** çünkü demo-pay ucunun kendisi üretimde
zaten ulaşılamaz (`404`) — sağlama mantığı da dolayısıyla üretimde asla bu yoldan tetiklenmez.

**Bağlayıcı DoD maddesi (architect'in önerisiyle birebir, teyit edildi):**
"Demo ödemeler üretimde KAPALI" — bu zaten `security-review-demo-payment-toggle.md`'nin Madde 1
ve mevcut `env.ts` boot-time koruması tarafından **garanti ediliyor**, ek bir teknik kontrol
GEREKMİYOR; DoD'a yalnızca **regresyon testi** olarak eklenmesi yeterli: qa-agent, prod-simülasyon
ortamında (`ENABLE_DEMO_PAYMENTS` kapalı) demo-pay + sağlama zincirinin ucun kendisi `404`
olduğu için hiç tetiklenmediğini doğrulamalı (bu zaten `security-review-demo-payment-toggle.md`
madde 9(c)'nin bir üst kümesi — aynı testin sağlama açısından da geçerli olduğunu teyit eder).

---

## KARAR 4 (§6 Vektör 3) — İstenmeyen veri ilişkilendirme: **KABUL EDİLEBİLİR RİSK**

Kısa değerlendirme (asıl karar compliance-agent'ın): saldırganın kendi girdiği `patientName`/
randevu bağlamının kurbanın "Randevularım" ekranında görünmesi, **kurbana teknik bir veri
sızıntısı DEĞİL** (kurbanın hiçbir bilgisi saldırgana açılmıyor — tek yönlü, saldırganın kendi
verisinin kurbana görünmesi). Güvenlik açısından bloklayıcı bir bulgu yok; risk sınıfı
**itibar/kafa karışıklığı/olası taciz** (saldırgan `patientName` alanına uygunsuz bir metin
yazabilir) — bu bir içerik moderasyonu sorunudur, security-agent'ın OWASP kapsamının dışındadır.
**Öneri (bağlayıcı değil):** compliance-agent, kurbanın hesabına üçüncü bir tarafça randevu
eklendiğinde ek bir bilgilendirme/onay adımı gerekip gerekmediğini değerlendirsin (KVKK
aydınlatma kapsamı, `.claude/compliance-notes-guest-account-otp.md`).

---

## KARAR 5 (§6 Vektör 4) — Misafir magic-link + hesap ikili erişimi: **KISMEN SIKILAŞTIRILDI**

Architect'in önerisi ("mevcut davranış korunsun") **kısmen kabul edildi**, ama kod incelemesi
mevcut davranışı architect'in tarif ettiğinden daha riskli buldu — bu yüzden **dar kapsamlı,
somut bir ek koşul** getiriyorum.

### 5.1 Bulgu — magic-link saldırgana E-POSTA OLMADAN, doğrudan tarayıcı yanıtında verilir

`telehealth.routes.ts` satır 349 ve 497 (`accessToken: rawAccessToken`) doğrulandı: booking
oluşturma ucu ham `accessToken`'ı **doğrudan API yanıtında** döndürüyor — booking'i oluşturan
taraf (Vektör 1 senaryosunda saldırgan) bu token'ı **kurbanın e-postasına hiç ihtiyaç duymadan**,
kendi tarayıcı oturumunda elde ediyor. `confirmBookingPayment`'a `knownRawAccessToken` geçirilen
(standart Stripe/demo-pay) yollarda bu token ödeme SONRASINDA da rotate EDİLMİYOR
(`booking.ts:372,388-390`). Yani: saldırgan, kurbanın e-postasıyla oluşturduğu randevunun
**tüm içeriğine** (randevu detayları, olası video görüşme erişimi, belgeler — sağlık verisi
sınıfı) bu bearer-token ile, hesap sağlamasından/aktivasyondan TAMAMEN BAĞIMSIZ, süresiz erişmeye
devam eder — architect'in "iki taraf da erişebilir" tarifinden daha ciddidir: bu **saldırganın
tek taraflı, kalıcı erişimidir**, kurbanın hesabı aktive edip etmemesinden etkilenmez.

### 5.2 Karar — rotasyon "ödeme anında" DEĞİL, "hesap AKTİVASYONU anında" zorunlu kılınır

Architect'in "ödeme anında rotasyon meşru misafirin kendi bağlantısını kırar" endişesi **haklı
ve korunur** — ödeme-zamanı davranışı (`booking.ts::confirmBookingPayment`) **DEĞİŞTİRİLMEZ.**

Ama bu, health-data sınıfı bir kaynağa saldırganın süresiz erişimini KABUL ETMEK anlamına
gelmemeli. **Bağlayıcı ek koşul:** `POST /auth/activate-account` başarılı olduğunda ([GAO] §4.4
zaten bu kullanıcının TÜM canlı refresh token'larını iptal ediyor — "parola belirleme anı"
disiplini), **AYNI transaction'da**, o kullanıcıya (`patientUserId = user.id`) bağlı TÜM
`AppointmentBooking` satırlarının `accessTokenHash`'i **rotate edilir** (yeni
`generateOpaqueToken()` + `hashToken()`, eski token'lar geçersiz kılınır; yeni ham token
saklanmaz/loglanmaz — mevcut `confirmBookingPayment` deseniyle BİREBİR aynı üretim şekli).

**Neden bu nokta doğru ve architect'in endişesini çözüyor:**
- Aktivasyon, ödemeden GÜNLER sonra olabilir — o ana kadar meşru misafirin kendi bağlantısı
  **hiç kesintiye uğramaz** (architect'in kaygısı tam olarak karşılanır).
- Aktivasyon anında kullanıcı ZATEN kimlik doğrulamalı bir oturuma (`issueTokenPair`) sahip
  olur ve `/patient/bookings` üzerinden AYNI randevulara erişebilir — eski bearer-link'e artık
  **hiçbir meşru ihtiyacı yoktur**, kaybı sıfır UX maliyetlidir.
- Saldırgan senaryosunda (Vektör 1): saldırgan aktivasyon kodunu ASLA alamaz (Karar 2) — yani
  kurban aktivasyonu tamamladığı AN, saldırganın elindeki eski `accessToken` sessizce ölür.
  Bu, kurbanın hesabını "geri aldığı" anı, saldırganın kalıcı erişiminin de bittiği an yapar.
- Kapsam dar: yalnızca `activate-account` handler'ına (zaten transaction açan tek nokta) bir
  `updateMany` eklenir; `confirmBookingPayment`, webhook'lar, demo-pay, admin mark-paid
  **DOKUNULMAZ.**

**Backend-agent'a somut talimat:** `auth.service.ts` (veya `activate-account` handler'ının
bulunduğu dosya), refresh-token iptalinin hemen yanına:
```
await tx.appointmentBooking.updateMany({
  where: { patientUserId: user.id },
  data: { accessTokenHash: hashToken(generateOpaqueToken()) },
});
```
Not: üretilen ham token hiçbir yere yazılmadığı için bu link'ler kullanıcı tarafından bir daha
asla bilinemez — bu KASITLIDIR (kullanıcı artık portal üzerinden erişir, yeni bir magic-link'e
ihtiyacı yoktur).

**Sonuç: Vektör 4 — DEĞİŞTİRİLDİ.** Ödeme-zamanı davranış aynen korunur (architect onaylandı);
aktivasyon-zamanı rotasyon YENİ bir bağlayıcı koşul olarak eklenir. qa-agent test eklemeli:
aktivasyon sonrası eski `?t=` bağlantısının o booking için artık ÇALIŞMADIĞI.

---

## KARAR 6 (§6 Vektör 5) — Resend mail-bomb: **ONAYLANDI, değişiklik gerekmiyor**

60 sn cooldown + 24 saatte 5 kod tavanı: bir hedefin posta kutusuna günde en fazla 5 e-posta
gidebilir, saldırganın IP'sinden bağımsız (hedef-başına, `EmailVerificationCode` satır sayımı
üzerinden) — endüstri pratiğine göre muhafazakâr (çoğu üründe saatlik 5 sınırı vardır, burası
günlük 5). IP sınırının (2/dk) yalnızca TAMAMLAYICI olduğu doğru tarif edilmiş. **Sıkılaştırma
gerekmiyor.**

---

## KARAR 7 (§6 Vektör 6) — Hesap-varlık oracle'ı: **KISMEN SIKILAŞTIRILDI (b şıkkı)**

### 7.1 Ödeme başarı ekranı — ONAYLANDI

Statik/koşulsuz metin, DTO'da alan yok, frontend backend'e sorgu atmıyor — doğru, sızıntı yok.

### 7.2 `resend-verification-code` yanıt SÜRESİ — **YENİ BULGU, BAĞLAYICI SIKILAŞTIRMA**

Bu uç HER durumda `202` döner (kullanıcı yok / doğrulanmış / cooldown içinde / gerçek gönderim) —
gövde ayırt edilemez, ama **yanıt SÜRESİ** ayırt edilebilir kalabilir eğer sunucu gerçek e-posta
gönderiminde SMTP round-trip'ini **await edip yanıtı ondan sonra döndürürse**: "kullanıcı yok"
veya "cooldown içinde" dalları yalnızca birkaç ms'lik bir DB sorgusuyla biter; "gerçek gönderim"
dalı ise `lib/mail.ts::sendMail`'in SMTP el sıkışmasını (tipik olarak 100 ms - birkaç saniye,
ağa/relay'e bağlı) bekler. İnternet üzerinden bile bu fark **istatistiksel olarak güvenilir
şekilde ölçülebilir** (birkaç ms'lik DB farkının aksine, yüzlerce ms'lik bir SMTP round-trip
gürültüye gömülmez) — saldırgan tekrarlanan isteklerle "bu e-posta kayıtlı mı" ve hatta
"cooldown'da mı" bilgisini zamanlamadan çıkarabilir. Bu, §4.3'ün gövde-seviyesinde kapattığı
oracle'ı **yan kanaldan** yeniden açar.

**Bağlayıcı zorunluluk:** `resend-verification-code` handler'ı, e-posta gönderimini **response'u
bloklamadan** yapmalı — `provisionPatientAccountForBooking`'in "best-effort" deseniyle (§5.1
[GAO], try/catch + `app.log.error`, hatayı yutup ana akışı bozmama) AYNI disiplin: DB
işlemleri (kullanıcı bulma, cooldown/tavan kontrolü, kod üretme+hash'leme+yazma) senkron/await
edilir (bunlar zaten hızlı ve dallar arası süre farkı ihmal edilebilir düzeydedir), ama
**`sendTemplateEmail` çağrısı `202` yanıtı DÖNÜLMEDEN ÖNCE await EDİLMEZ** — fire-and-forget
(`void sendTemplateEmail(...).catch((err) => app.log.error({ err }, "..."))`) veya eşdeğeri bir
kuyruğa alma. Bu, `register()`'ın karşılama e-postası için kullandığı "await + best-effort" (satır
84-88, senkron ama kullanıcı zaten `202`'den önce login olmuş durumda, farklı bir DTO ile
karıştırılmamalı) deseninden **kasıtlı olarak farklıdır** çünkü orada e-posta gönderimi bir
oracle riski taşımaz (register zaten `ConflictError`/`202` ile e-postanın var olup olmadığını
başka şekilde açığa vuruyor — ayrı bir tartışma, bu turun kapsamı dışı), burada ise `202`'nin
TEK garantisi "ayırt edilemezlik" olduğu için zamanlama da bu garantiye dahil edilmeli.

**İkincil, düşük öncelikli öneri (SHOULD, zorunlu değil):** kullanıcı bulunamadığında da
(§1.4 [GAO] `verify-email`/`activate-account` için zaten istenen) eşdeğer maliyetli bir sahte
`EmailVerificationCode` sorgusu/HMAC hesaplaması yapılabilir; ama bu birkaç ms'lik fark,
gerçek internet gürültüsü karşısında (a) maddesindeki SMTP-await farkı kadar pratik olarak
sömürülebilir değildir — **düşük öncelikli**, backend-agent isterse ekler, FINAL saymak için
şart değildir.

**Sonuç: Vektör 6 — (a) ONAYLANDI, (b) DEĞİŞTİRİLDİ (SMTP-await'in yanıt öncesi
bloklamaması ZORUNLU).**

---

## §5.4 ADMIN-kilitlenme tuzağı — implementasyon talimatı yeterliliği: **DOĞRULANDI**

`auth.service.ts:67-71` incelendi, gerçek satır:
`role: userCount === 0 ? "ADMIN" : undefined` — [GAO] §5.4'ün "bu satır BURAYA KOPYALANMAZ"
uyarısının somut hedefi doğrulandı, kopyalanabilecek gerçek bir kod parçası var.

[GAO] §9 backend-agent madde 6'daki talimat (`role: "USER"` SABİT KODLU — `userCount === 0 →
ADMIN` kuralını KOPYALAMAYIN, koda açıklayan bir yorum yazın) **yeterince açık ve vurgulu**
bulundu — ayrıca üç bağımsız güvenlik ağı ile destekleniyor: (1) backend-agent unit test
(§9 madde 8: "amaç bağlaması"na ek olarak qa §9.9 de rol testi istiyor), (2) qa-agent §9 madde 9
("hiç kullanıcısı olmayan bir ortamda... rolü USER'dır, ADMIN DEĞİL" — açıkça test senaryosu
tanımlı), (3) code-quality-agent §9 madde 3 ("role'un sabit kodlu olduğunu doğrulayın" — statik
PR denetimi). Üç bağımsız katman (implementasyon yorumu + unit/e2e test + statik denetim) tek bir
kopyala-yapıştır hatasının prod'a sızma ihtimalini pratik olarak sıfırlıyor. **Ek talimat
gerekmiyor**, mevcut hâliyle onaylanıyor.

---

## §4.3 Tek-jenerik-hata disiplini — hesap-varlık oracle'ı: **DOĞRULANDI (gövde), Vektör 6-b ile bkz. yukarı (zamanlama)**

Gövde/kod seviyesinde: `401 VERIFICATION_CODE_INVALID` her koşulda aynı — kullanıcı yok / kod
yok / yanlış / süresi dolmuş / deneme tükenmiş / amaç eşleşmiyor, hepsi aynı gövde. §1.4'teki
"kullanıcı yoksa da sabit maliyetli sahte karşılaştırma yapılır" ilkesi **`verify-email` ve
`activate-account` için zaten doğru tarif edilmiş** — bunun `lib/otp.ts::consumeVerificationCode`
imzasına AÇIKÇA yansıtılması gerekiyor: fonksiyon `userId: string | null` kabul etmeli (email
bulunamadıysa `null` geçilir), `userId === null` dalında GERÇEK bir `HMAC + timingSafeEqual`
hesaplaması (sabit/rastgele bir tampon değere karşı) yapılıp SONRA `401` dönmeli — yalnızca
`if (!user) throw ...` ile erken çıkış YAPILMAMALI (bu, DB sorgusu dahil tüm maliyeti atlayıp
zamanlama farkını PEKİŞTİRİR). Bu, [GAO] §1.4'te zaten yazılı ama backend-agent'ın §9 görev
listesinde AÇIK bir madde olarak yer almıyor — **bağlayıcı netleştirme:** §9 backend-agent madde
2'ye ("`consumeVerificationCode`") şu netleştirme eklenir: *"`userId` bulunamadığında bile
fonksiyon HMAC hesaplama + `timingSafeEqual` adımlarını GERÇEKTEN çalıştırır, erken `return`
YAPMAZ."*

`resend-verification-code` için aynı disiplin **Vektör 6-b** (yukarı, KARAR 7.2) kapsamında ele
alındı — asıl risk orada zamanlama, burada değil.

---

## Backend-agent'a iletilecek uygulama kontrol listesi (özet, bağlayıcı)

1. `lib/otp.ts::hashOtpCode`'a girmeden önce `code` `/^\d{6}$/` ile doğrulanır; uymuyorsa erken
   `401 VERIFICATION_CODE_INVALID` + `attemptCount` artırımı (KARAR 1.2).
2. `timingSafeEqual` çağrısı try/catch'e alınır, uzunluk uyuşmazlığında `false` döner, ASLA
   yukarı fırlatmaz (KARAR 1.2).
3. Rastgele parola (`crypto.randomBytes(32)`) `provisionPatientAccountForBooking` içinde
   hiçbir log/audit/response'a yazılmaz — yalnızca `hashPassword`'a girer ve kapsamdan düşer
   (KARAR 2).
4. **YENİ:** `POST /auth/activate-account` başarılı olduğunda, refresh-token iptaliyle AYNI
   transaction'da, `patientUserId = user.id` olan TÜM `AppointmentBooking` satırlarının
   `accessTokenHash`'i rotate edilir (KARAR 5, kod örneği yukarıda).
5. **YENİ:** `resend-verification-code` handler'ında `sendTemplateEmail`/eşdeğeri çağrı `202`
   yanıtından ÖNCE await EDİLMEZ (fire-and-forget + `app.log.error` best-effort) — SMTP
   round-trip'in yanıt süresine sızmaması ZORUNLU (KARAR 7.2).
6. `consumeVerificationCode(userId, purpose, code)`: `userId === null` dalında da GERÇEK
   HMAC+`timingSafeEqual` hesaplaması çalıştırılır, erken `return` yapılmaz (§4.3 netleştirmesi).
7. Unit/e2e test eklentileri: (a) `timingSafeEqual` uzunluk-uyuşmazlığında 500 değil 401 döndüğü;
   (b) aktivasyon sonrası eski booking `accessToken`'ının artık geçersiz olduğu; (c) 5 haneli/
   harf içeren kod girildiğinde erken `401` + deneme sayacı artışı.

---

## Definition of Done'a eklenen sonuç

[GAO] §10'daki "security-agent §6'daki altı vektöre ve §3'e açıkça karar verdi" maddesi:
**karşılandı.** §3: ONAYLANDI + 1 bağlayıcı ek (format ön-doğrulama). §6: Vektör 1 doğrulandı
(ele geçirme değil), Vektör 2 onaylandı (demo-pay istisnası, mevcut fail-closed altyapısına
dayanarak), Vektör 3 kabul edilebilir risk (compliance-agent'a devredildi), **Vektör 4 kısmen
sıkılaştırıldı (aktivasyon-anı token rotasyonu YENİ bağlayıcı koşul)**, Vektör 5 onaylandı
(değişiklik yok), **Vektör 6 kısmen sıkılaştırıldı (resend'in SMTP-await zamanlama oracle'ı YENİ
bağlayıcı koşul)**. §5.4 implementasyon talimatı yeterli bulundu, ek gerekmiyor. §4.3 gövde
disiplini doğrulandı, zamanlama netleştirmesi eklendi. backend-agent bu dosyayı doğrudan
uygulayabilir; herhangi bir çelişki architect'e eskale edilir.
