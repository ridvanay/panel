# Security Review — E-posta (SMTP) Yapılandırması

> **Kaynak:** `.claude/architect-scope-smtp-settings.md` (**[SMTP]**) — bu doküman onun §2 ve
> §4.4 ENGELLEYİCİ maddelerine yanıttır. **Durum: her iki madde de KARARA BAĞLANDI, ENGEL
> KALKTI.** backend-agent bu dosyayı doğrudan uygulayabilir; çelişki çıkarsa architect'e eskale
> edilir (bu dosya politikanın SIKILAŞTIRILDIĞI noktalarda [SMTP]'nin başlangıç önerisinin
> ÜZERİNDEDİR — CLAUDE.md kuralı: security-agent SIKILAŞTIRABİLİR, GEVŞETEMEZ, kararı bağlayıcıdır).

---

## KARAR 1 — Şifreleme yaklaşımı: **ONAYLANDI**

`backend/src/lib/crypto.ts::encryptSecret/decryptSecret` (AES-256-GCM, 96-bit rastgele IV,
`iv:authTag:ciphertext` hex formatı, anahtar `env.ENCRYPTION_KEY` — 32 byte base64, boot'ta
zorunlu/uzunluk doğrulanıyor) SMTP parolası için **yeterli ve doğru seçimdir.** Yeni bir
şifreleme modülü/env değişkeni/algoritma **açılmayacak.**

**Gerekçe (incelendi, doğrulandı):**
- GCM authenticated encryption sağlıyor — bütünlük denetimi (`authTag`) var, sessiz bozulma/
  manipülasyon DB'de tespit edilmeden geçemez.
- IV her çağrıda `crypto.randomBytes` ile rastgele üretiliyor (aynı parola iki kez şifrelense
  bile ciphertext'ler farklı — ECB-tarzı desen sızıntısı yok).
- Üç bağımsız hassas veri sınıfında zaten üretimde: outbound webhook secret'ları
  (`outbound-webhooks.dispatcher.ts:131`), 2FA TOTP secret'ları (`security.routes.ts`),
  telehealth kimlik numaraları (`lib/identity.ts:231-237`, `lib/identity.ts:9-11`'de AÇIKÇA
  "yeni bir şifreleme icat edilmez" ilkesiyle bu modülü sarıyor — aynı disiplin burada
  uygulanmalı, emsal zaten var).
- İkinci bir şifreleme mekanizması ikinci bir anahtar yaşam döngüsü demektir — sıfır güvenlik
  kazancı karşılığında denetim yüzeyini büyütür. Reddedilir.

### Bağlayıcı alt kurallar (backend-agent uygular — [SMTP] §2.3 ile birebir, security-agent
tarafından teyit edildi, hiçbiri gevşetilmedi)

1. **Parola hiçbir uçtan (GET/PATCH response, test response, hata gövdesi) düz metin dönmez.**
   Yalnızca `smtpPasswordSet: boolean`.
2. `secretLast4` deseni **uygulanmaz** — SMTP parolasının son 4 hanesi hiçbir işe yaramaz,
   yalnızca entropi sızdırır.
3. Üç durumlu `PATCH` semantiği zorunlu: alan **yok** → mevcut ciphertext korunur; `null` →
   `smtpPasswordCiphertext = null`; dolu string → yeniden şifrelenip yazılır. **Sentinel
   yer-tutucu (`"***"` vb.) YASAK.**
4. `decryptSecret` **yalnızca** transporter kurulurken, bellekte, o anki işlem kapsamında
   çağrılır. `GET /admin/settings/email` **hiçbir koşulda decrypt çağırmaz** (aşağıdaki KARAR 4
   ile birebir).
5. Decrypt hatası ele alışı: **KARAR 4**'e bakınız (rotasyon senaryosu ayrı başlık altında).
6. Audit kısıtı: **KARAR 3**'e bakınız.

**Ek not (bilgilendirici, bu görevin kapsamı DIŞINDA, engel DEĞİL):** proje genelinde
`ENCRYPTION_KEY` için versiyonlu/çoklu-anahtar bir rotasyon şeması (ör. ciphertext'e anahtar-id
öneki) yok — bu SMTP parolasına özgü bir eksiklik değil, projenin var olan mimari durumu
(webhook secret'ları, TOTP secret'ları, kimlik numaraları da aynı sınırlamaya tabi). Bu
özelliğin sorumluluğu bu gerçekliği **güvenli** şekilde ele almaktır (KARAR 4), rotasyon
altyapısını icat etmek değildir. architect/devops-agent ileride proje-geneli bir key-versioning
şeması isterse bu ayrı bir görev olmalı.

---

## KARAR 2 — `smtpHost` SSRF/port politikası: **NİHAİ KARAR (mimarın önerisi SIKILAŞTIRILDI)**

Mimarın önerisi başlangıç noktası olarak iyi ama **iki noktada yetersiz** bulundu ve
sıkılaştırıldı. Aşağıdaki politika **bağlayıcıdır.**

### 2.1 Neden mimarın "`resolveAndValidateHost` yalnızca `isProd`'da" önerisi REDDEDİLDİ

`isProd`'a bağlamak, dev/staging ortamlarını SSRF kontrolünden **tamamen muaf** bırakır. Bu
yanlış bir güven varsayımı: staging genelde gerçek bulut VM'lerinde çalışır ve
**bulut metadata endpoint'i (`169.254.169.254`)** erişilebilir durumdadır — buraya erişim
IAM kimlik bilgisi hırsızlığına kadar gidebilen kritik bir sınıf saldırıdır. "Dev/staging
güvenlidir" varsayımı bu tehdide karşı savunmasızdır. Ayrıca SMTP relay'in özel ağda olması
**prod'da da** meşru bir senaryodur (mimarın kendi tespiti) — `isProd` şartı bu senaryoyu prod
için zaten "izin ver" tarafına koyuyordu ama non-prod'da kontrolü tamamen kapatarak gereksiz bir
asimetri yaratıyordu.

**Karar:** SSRF ağ-katmanı kontrolü **tüm ortamlarda varsayılan olarak açık**, `NODE_ENV`'e
bakılmaksızın. Muafiyet **tek bir açık env bayrağıyla** (`SMTP_ALLOW_PRIVATE_HOST`) verilir —
bu bayrak hangi ortamda `true` olacağına devops-agent karar verir (ör. yalnızca kurumsal relay
kullanan bir prod kurulumunda, ya da docker-compose ile yerel bir mail-catcher'a karşı test
eden bir dev/staging kurulumunda). Bu, mimarın önerisinden **daha basit** (tek bayrak, `NODE_ENV`
dallanması yok) ve **daha güvenli** (dev/staging metadata-SSRF boşluğunu kapatıyor).

### 2.2 Katman A — Sözdizimsel doğrulama (HER ortamda, ağ çağrısı YOK, `PATCH` anında)

`smtpHost` alanı aşağıdakilerden herhangi birini içeriyorsa **422 `VALIDATION_ERROR`**
(`details.smtpHost`), ham girdi hata gövdesine **yansıtılmaz** (yalnızca sabit/jenerik mesaj —
`lib/identity.ts` disiplini ile aynı):

- `@` (kimlik bilgisi, `user:pass@host`)
- `://` (şema eki, `smtp://`, `smtps://` vb.)
- `:` (port zaten AYRI bir alan — host string'inin içine gömülmüş port kabul edilmez)
- boşluk (herhangi bir whitespace karakteri)
- kontrol karakteri (`\n`, `\r`, `\0` vb. — savunma amaçlı, header/log injection sınıfı
  girdilerin daha ileri hiçbir işleme girmeden reddi)
- uzunluk `> 253` karakter (RFC 1123 host adı üst sınırı)
- boş string (`enabled: true` iken — [SMTP] §3.3 ile aynı, `422`)

Kalan değer ya (a) `net.isIP() !== 0` ile geçerli bir **IP literal'i** ya da (b) makul bir
**RFC 1123 host adı** deseni (`^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$`)
olmalıdır; ikisine de uymuyorsa `422`.

**Kasıtlı sapma — webhook politikasından farklı olarak IP literal'e izin verilir.**
`lib/ssrf-guard.ts::validateWebhookUrlSyntax` webhook URL'lerinde IP literal'i kesin reddeder
(`literal_ip_host`) çünkü webhook host'u genelde dışarıdan/üçüncü taraftan gelen bir DNS adıdır
ve IP literal kabulü ek bir obfuskasyon yüzeyi açar. SMTP relay'i ise **çok yaygın olarak sabit
bir iç IP ile yapılandırılır** (ör. "relay 10.0.5.20") — bunu reddetmek mimarın kendi
gerekçesiyle (kurumsal/self-hosted relay meşruiyeti) çelişir. Tehdit modeli de farklı: bu alanı
yalnızca ADMIN yazabilir (webhook URL'i de öyle, ama SMTP relay pratiği IP-tabanlı yapılandırmayı
normalleştirir). IP literal verildiğinde DNS çözümlemesi ATLANIR, `isPublicUnicastIp()` **doğrudan**
o literal üzerinde çalışır (aşağıdaki Katman B, escape-hatch dahil aynen geçerli).

### 2.3 Port — kapalı küme (mimarın önerisi AYNEN onaylandı, değiştirilmedi)

`smtpPort` yalnızca `{25, 465, 587, 2525}` kümesinden biri olabilir (OpenAPI'de `enum`).
Serbest aralık **kesinlikle açılmaz** — bunun tek amacı ucu bir port tarayıcısına çevirmemektir.
Bu dört port, endüstri standardı SMTP submission/relay portlarıdır (25 klasik, 465 implicit TLS,
587 STARTTLS submission, 2525 ISP-25-engeli aşan yaygın sağlayıcı alternatifi — Mailtrap/SendGrid
vb.) ve yüksek riskli portları (22, 3389, 6379, 9200 vb.) içermez. Sıkılaştırma gerekmiyor.

### 2.4 Katman B — Ağ katmanı doğrulaması (TÜM ortamlarda varsayılan AÇIK)

`lib/ssrf-guard.ts::isPublicUnicastIp` (IP literal için doğrudan; host adı için
`resolveAndValidateHost` → dönen **TÜM** adresler public-unicast olmalı, webhook ile aynı
"tek adres bile düşerse tüm istek reddedilir" kuralı) **aynen yeniden kullanılır** — yeni bir
CIDR/blok listesi icat edilmez.

**Escape hatch (bağlayıcı, tek bayrak):**

```
SMTP_ALLOW_PRIVATE_HOST: z.enum(["true", "false"]).default("false").transform(v => v === "true")
```

(`SMTP_SECURE`/`CUSTOM_CODE_ENABLED` ile BİREBİR AYNI desen — `z.coerce.boolean()` KASITLI
KULLANILMAZ, boş olmayan her string'i `true`'ya çevirir.) `config/env.ts`'e, `SMTP_*` bloğunun
yanına eklenir. **Yalnızca env'den okunur, ADMIN panelinden hiçbir şekilde değiştirilemez** —
devops-agent'ın operasyonel kararıdır, uygulama katmanının değil. `true` iken Katman B
**tamamen atlanır** (private/loopback/link-local/metadata/multicast dahil TÜM adresler kabul
edilir) — bu bilinçli bir "ben ne yaptığımı biliyorum" anahtarıdır, kısmi gevşetme (ör. yalnızca
`10.0.0.0/8`'e izin ver) **yapılmaz**, gereksiz karmaşıklık ekler.

`Katman B` ihlali → **422 `VALIDATION_ERROR`** (`details.smtpHost`), sabit mesaj (ör. "Bu SMTP
host adresi bu ortamda kullanılamaz (özel/dahili ağ adresi). Kurumsal/iç ağ relay'i kullanan bir
kurulumdaysanız `SMTP_ALLOW_PRIVATE_HOST` ortam değişkenini devops ile birlikte değerlendirin.").
**Bunun bir "oracle" riski YOKTUR** — bu adım yalnızca DNS çözümlemesi + statik IP-aralığı
denetimi yapar, **hiçbir TCP soket açmaz**; dolayısıyla port-tarama/bağlantı-durumu sinyali
sızdırmaz. Asıl oracle riski aşağıdaki KARAR 3'tedir (test ucu, gerçek soket açıyor).

### 2.5 DNS rebinding / TOCTOU — minimum zorunlu önlem

Webhook teslimatı gibi her-tekil-istekte yeniden doğrulama + IP pinleme burada **zorunlu
tutulmuyor** (SMTP relay, webhook abonesinin keyfi/üçüncü-taraf URL'inden farklı olarak ADMIN'in
kendi seçtiği, nadiren IP değiştiren bir hedeftir — risk/efor dengesi farklı). Ama **minimum**
şu zorunludur: `resolveAndValidateHost`/`isPublicUnicastIp` doğrulaması yalnızca `PATCH` anında
DEĞİL, **her transporter (yeniden) kurulumunda** ([SMTP] §3.4'teki parmak-izi tabanlı önbellek
geçersizleşme noktası — yani config değiştiğinde VE test ucunda) **tekrar** çalıştırılır. Bu,
rebinding penceresini "config değişmediği sürece süreç ömrü" ile sınırlar; sıfıra indirmez ama
mimarın önerisinde hiç yoktu — eklenen bir sıkılaştırmadır. Backend-agent isterse (opsiyonel,
zorunlu değil) nodemailer'a `host` yerine pinlenmiş IP + `tls.servername = <orijinal host>`
vererek webhook dispatcher'ındaki pinleme desenini tam kopyalayabilir; bu bir "nice-to-have"dir,
FINAL saymak için şart değildir.

### 2.6 Özet tablo (backend-agent bunu birebir uygular)

| Kontrol | Ortam | Sonuç | Kod |
|---|---|---|---|
| `@`/`://`/`:`/boşluk/kontrol karakteri/uzunluk>253/boş | HER | Reddet | 422 |
| Host ne IP literal ne RFC1123 deseni | HER | Reddet | 422 |
| Port `∉ {25,465,587,2525}` | HER | Reddet | 422 |
| Host/IP `isPublicUnicastIp() === false` | HER, `SMTP_ALLOW_PRIVATE_HOST=false` (varsayılan) | Reddet | 422 |
| Host/IP private/dahili | `SMTP_ALLOW_PRIVATE_HOST=true` | Kabul | — |
| DNS çözümlenemedi | HER | Reddet | 422 |

---

## KARAR 3 — Test ucu (`POST /admin/settings/email/test`) hata-oracle sınırlaması

**Sorun:** bu uç, KARAR 2'nin B katmanından farklı olarak **gerçek bir TCP soketi açar**
(`transporter.verify()` + gerçek gönderim). Bağlantı-reddedildi / zaman-aşımı / DNS-yok gibi
farklı hata sınıflarının ayırt edilebilir dönmesi, kapalı port kümesiyle (KARAR 2.3) birleşince
dahi bir iç-ağ **port/servis keşif oracle'ı** oluşturabilir.

**Politika (bağlayıcı):** Ham hata (`err.message`, `err.code`, `err.response`/SMTP sunucu yanıt
metni, stack) **hiçbir zaman** istemciye (ne `EmailSettingsTestResponse` ne `lastTestError`
DB kolonu) döndürülmez. Hata, aşağıdaki **kaba, sabit-mesajlı** kovalara sınıflandırılır —
sınıflandırma admin'e karar vermesi için yeterli detayı verir ama alt-sinyalleri (ECONNREFUSED
vs ETIMEDOUT vs ENOTFOUND) **kasıtlı olarak birleştirir**:

| Kova | Eşleşen nodemailer/node sinyalleri (örnek) | Dönen SABİT mesaj |
|---|---|---|
| `connection` | `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNRESET`, `EHOSTUNREACH`, `ENETUNREACH`, belirsiz `ESOCKET` | "SMTP sunucusuna bağlanılamadı. Host adresini ve portu kontrol edin." |
| `tls` | `ESOCKET` + TLS/sertifika bağlamlı iç hata | "TLS/SSL bağlantısı kurulamadı. `smtpSecure` ayarını ve sunucu sertifikasını kontrol edin." |
| `auth` | `EAUTH`, SMTP yanıt kodu `535/534/530` | "Kimlik doğrulama başarısız. Kullanıcı adı/parolayı kontrol edin." |
| `rejected` | `EENVELOPE`, SMTP yanıt kodu `550/553/521` | "Sunucu gönderimi reddetti. Gönderen adresini (fromAddress) kontrol edin." |
| `config` | `smtpPasswordCiphertext` decrypt hatası (bkz. KARAR 4) | "Kayıtlı SMTP parolası çözülemedi (şifreleme anahtarı değişmiş olabilir). Parolayı panelden yeniden girin." |
| `unknown` | eşleşmeyen her şey | "E-posta gönderimi başarısız oldu." |

**Kritik nokta — `connection` kovası içinde ALT AYRIM YAPILMAZ.** ECONNREFUSED (port kapalı/
dinlemiyor) ile ETIMEDOUT (filtrelenmiş/paket düşürülüyor) ile ENOTFOUND (DNS yok) arasındaki
fark istemciye **asla** sızdırılmaz — bu ayrım tam olarak bir port tarayıcısının ihtiyaç duyduğu
sinyaldir. Hepsi tek, aynı mesaja düşer.

- Bu sınıflandırılmış mesaj **hem** HTTP yanıtına (`502 EMAIL_DELIVERY_FAILED`, mevcut
  `EmailDeliveryError` sınıfı) **hem de** `EmailSettings.lastTestError` kolonuna yazılır — ikisi
  de AYNI (ham değil, sınıflandırılmış) metni taşır.
- Ham hata **sunucu tarafı log'a** (`app.log.error`) `err` nesnesiyle düşebilir (mevcut
  `sendMail()` deseniyle aynı — `mail.ts:110`), bu ADMIN'e dönen yanıttan **ayrı** bir kanaldır
  ve yalnızca ops/observability erişimindedir. Audit tablosuna (KARAR 5) **yazılmaz.**
- Rate limit (`EMAIL_SMTP_TEST_RATE_LIMIT = { max: 3, timeWindow: "1 minute" }`, [SMTP] §4.3.4)
  bu sınıflandırmayla **birlikte** çalışır — tek başına yeterli değildi (3 istek/dk hâlâ kaba bir
  taramaya izin verir), sınıflandırma asıl kapatan katmandır.

---

## KARAR 4 — `ENCRYPTION_KEY` rotasyon senaryosu davranışı: **ONAYLANDI, gözden geçirildi**

[SMTP] §2.3.5'in önerdiği davranış (`outbound-webhooks.dispatcher.ts:129-142`'deki desenle
birebir aynı: decrypt `try/catch`, yakalanıp `EmailDeliveryError`'a çevrilir, yakalanmadan
yukarı fırlamaz) **güvenli ve doğrudur, onaylandı.** Ek netleştirmeler:

1. **`GET /admin/settings/email` hiç decrypt ETMEZ** (KARAR 1 madde 4) — bu tek başına, anahtar
   rotasyonunun ayarlar ekranını **hiçbir zaman** 500/502'ye düşürmemesini garanti eder. Bu en
   kritik korumadır.
2. **Gerçek gönderim yolunda (`enabled: true` iken `lib/mail.ts::buildTransporter`) decrypt
   hatası olursa env'e SESSİZCE DÜŞÜLMEZ.** `enabled: true`, admin'in DB yapılandırmasını
   **bilinçli olarak** öncelikli kıldığı bir karardır ([SMTP] §3.3). Decrypt başarısız olduğunda
   env'e otomatik geçmek şu riskleri taşır: (a) e-postanın admin'in haberi olmadan farklı bir
   kimlikten/relay'den gitmesi (itibar/spoofing riski), (b) gerçek bir operasyonel arızanın
   (`ENCRYPTION_KEY` rotasyonu sonrası veri taşınmamış) sessizce maskelenmesi. Proje genelinde
   zaten yerleşik olan "dürüst yapılandırılmamışlık" felsefesiyle (`LiveKitNotConfiguredError`,
   `PaymentsNotConfiguredError`, `RecordingNotConfiguredError` — hepsi 503/502, sessiz
   degrade YOK) **tutarlı** olarak: **fail closed** — `EmailDeliveryError` (502) yukarı fırlar,
   çağıran akış (ör. parola sıfırlama) kendi mevcut hata ele alışını kullanır.
3. **Test ucunda** aynı decrypt hatası `config` kovasına düşer (KARAR 3) — admin'e "parolayı
   yeniden girin" gibi **eyleme geçirilebilir** bir sinyal verir; bu KARAR 3'ün genel "ham hata
   sızdırma" kısıtından **muaftır** çünkü mesajın kendisi zaten sabit/jenerik ve hiçbir zaman
   ciphertext/plaintext/anahtar içeriğine değinmiyor — yalnızca "rotasyon olmuş olabilir" gibi
   ADMIN'in zaten bildiği bir operasyonel gerçeği adlandırıyor.
4. Log/audit'e **ciphertext, plaintext veya `ENCRYPTION_KEY` parçası hiçbir koşulda yazılmaz** —
   yalnızca hata sınıfı adı (ör. `"config"`) ve olay adı (`settings.email_test`) loglanabilir.

---

## KARAR 5 — Audit metadata + `lastTestError` PII/secret sızıntı denetimi: **ONAYLANDI, koşullu**

`settings.email_update` ve `settings.email_test` olayları incelendi; [SMTP] §2.3.6'daki kural
("yalnızca değişen alan ADLARI, değer değil") **doğru ve yeterlidir**, aşağıdaki netleştirmelerle
bağlayıcı hale getirildi:

### `settings.email_update`
- `metadata.changed`: değişen alan **adlarının** dizisi — `["smtpHost", "smtpPort", "smtpUser",
  "smtpPassword", "smtpSecure", "fromAddress", "fromName", "enabled"]` kümesinden bir alt küme.
  **`smtpPasswordCiphertext` iç şema adı DEĞİL, dış/kullanıcıya dönük `smtpPassword` adı
  loglanır** (tutarlılık + iç şema detayının audit trail'e sızmaması için).
- Değer diff'i **yazılmaz** — `settings.update`'teki `demoPaymentsEnabled` istisnası (boolean
  değerin loglanması) burada **geçerli DEĞİLDİR** ([SMTP] §2.3.6 ile birebir, teyit edildi):
  o istisna bir boolean'a özgüydü (public/açık bir bayrak), burada `enabled` dışındaki HİÇBİR
  alan değeri (host/port/user/fromAddress/fromName dahil, bunlar teknik olarak "sır" olmasa da)
  audit'e yazılmaz — tutarlılık ve "bu satırda ne var ne yok" konusunda tek bir kural olsun diye.
  **İstisna:** `enabled` (boolean, host/port gibi altyapı kimlik bilgisi taşımıyor) değeri
  loglanabilir — `demoPaymentsEnabled` presedanıyla aynı sınıf.
- Ciphertext'in kendisi (şifreli hâliyle bile) audit metadata'sına **yazılmaz** — gereksiz bir
  ikinci kopya, audit tablosunun erişim kontrolü `EmailSettings` tablosuyla birebir aynı
  sıkılıkta olmayabilir; ekstra maruziyet yüzeyi açmanın anlamı yok.

### `settings.email_test`
- `metadata`: `{ succeeded: boolean, errorCategory?: "connection" | "tls" | "auth" | "rejected" | "config" | "unknown" }`.
  **Ham hata metni, SMTP sunucu yanıtı, stack — YAZILMAZ.**
- Alıcı adresi metadata'ya **eklenmez** — zaten daima `request.user.email`'dir ([SMTP] §4.3.1),
  audit sisteminin zaten kaydettiği `actorId`/aktör bilgisinden bağımsız bir tekrar gerekmez.

### `lastTestError` (DB kolonu, `GET` yanıtında admin'e görünür)
- **Yalnızca** KARAR 3'teki sınıflandırılmış SABİT mesajlardan biri yazılabilir. Ham SMTP sunucu
  yanıtı/stack/err.message **asla** bu kolona yazılmaz — hem çünkü bu kolon `GET` ile ADMIN'e
  geri gösteriliyor (ikinci bir sızıntı yüzeyi), hem de sınırsız uzunlukta güvenilmeyen bir
  string'i (uzak SMTP sunucusunun döndürdüğü metin) DB'de saklamamak için.

---

## Definition of Done'a eklenen sonuç

`.claude/architect-scope-smtp-settings.md` §7'deki "security-agent §2 şifreleme yaklaşımını
açıkça onayladı" maddesi: **karşılandı** (bkz. KARAR 1). §4.4 ENGELLEYİCİ madde: **karşılandı**
(bkz. KARAR 2, sıkılaştırılmış hâliyle bağlayıcı). backend-agent artık implementasyonu bu
dosyadaki KARAR 1-5'e göre FINAL sayabilir; herhangi bir çelişki architect'e eskale edilir.
