# Uyumluluk Değerlendirmesi — E-posta OTP + Misafir Randevudan Hesap Oluşturma

> Referans: `.claude/architect-scope-guest-account-otp.md` (**[GAO]**) §6 vektör 3 ve §9
> "compliance-agent" bölümü. Üst dokümanlar: `.claude/compliance-notes-telehealth.md` (**[CNT]**,
> consent sürümleme kuralı — "yalnızca metnin maddi/kapsam değiştiren bir revizyonunda
> artırılır") ve `.claude/compliance-notes-doctor-identity.md` (**[CNI]**, emsal: kimlik adımı
> eklendiğinde `v1`→`v2` bump gerekçesi ve retention tablo formatı). Bu doküman **hukuki tavsiye
> DEĞİLDİR**; genel KVKK/GDPR prensiplerinin teknik gereksinime çevrilmiş hâlidir. Nihai
> aydınlatma/rıza metni içeriği ve saklama süresinin hukuki uygunluğu için **gerçek bir hukuk
> danışmanına** başvurulması ZORUNLUDUR.

**Kod incelendi, doğrulandı:** `backend/src/modules/telehealth/lib/booking.ts:67`
(`DEFAULT_APPOINTMENT_CONSENT_VERSION = "v2"`, satır 61-67 yorumu [CNI] emsalini teyit ediyor),
`backend/src/modules/telehealth/telehealth.routes.ts:440-477` (booking oluşturma —
`patientUserId: request.user?.id ?? null`, oturum açmış kullanıcı KENDİ isteğiyle kendi hesabına
`patientName`/`patientEmail` farklı bir üçüncü kişi için bile ATAYABİLİR — bu **mevcut, kabul
edilmiş** bir davranıştır), `backend/src/lib/intake-retention.ts` (tam dosya, 90 gün, günlük
kadans — emsal desen), `backend/src/lib/contact-retention.ts` ve
`backend/src/lib/support-retention.ts` (`PII_REDACTION_MS = 30 gün` — "operasyonel/güvenlik
amaçlı" kısa saklama emsali), `.claude/architect-scope-guest-account-otp.md` §1.3 (şema taslağı),
§3.4 (deneme sayacı + "satır SİLİNMEZ, denetim izi"), §5.1-§5.7 (sağlama akışı), §6 vektör 3, §11
(Kapsam DIŞI — "doğrulanmamış kullanıcıların otomatik temizliği" AYRI bir iş olarak işaretli).

## Karar: **KOŞULLU ÖN-ONAY — backend-agent/db-agent uygulamaya BAŞLAYABİLİR.** Bloklayıcı bulgu: yalnızca (1) — consent sürümü NET karar aşağıda, implementasyonu engellemeyecek şekilde bağlayıcıdır.

---

## 1. Rıza (consent) sürümü — **`v2` → `v3` GEREKİR (bağlayıcı karar)**

**Karar: EVET, yükseltilsin.** `DEFAULT_APPOINTMENT_CONSENT_VERSION` **`"v2"`'den `"v3"`'e**
güncellenir (`backend/src/modules/telehealth/lib/booking.ts:67`, backend-agent).

**Gerekçe — [CNT]'nin bağlayıcı sürümleme kuralı burada da tam karşılanıyor:**

1. Mevcut `v2` onay metni **açıkça kapsam sınırlıdır**: "...kişisel verilerimin **BU RANDEVU
   KAPSAMINDA** işlenmesine açık rızamı veriyorum" ([CNI] satır 66-68, `identity-step-
   dialog.tsx:310-311`'de birebir doğrulanmış). "Bu randevu kapsamında" ifadesi, işlemenin **tek
   seferlik, randevuya özgü** olduğunu beyan eder.
2. Özellik B, `patientEmail` üzerinden **randevudan bağımsız, kalıcı bir `User` hesabı**
   oluşturuyor: parola hash'i saklanıyor, hesap **süresiz** yaşıyor (`Kapsam DIŞI` §11 —
   doğrulanmamış hesapların otomatik temizliği bu turda YOK), aktivasyon kodu e-postayla
   gönderiliyor, hesap gelecekteki TÜM randevuları (`/patient/bookings`) görüntülemek için
   kullanılabilir hâle geliyor. Bu, "bu randevunun ifası" ile sınırlı bir işleme AMACI değildir —
   randevu tamamlandıktan SONRA da devam eden, yeni ve ayrı bir işleme amacıdır (kimlik
   bilgisi/erişim yönetimi amacı).
3. [CNI]'nin `v1→v2` bump'ını tetikleyen ölçüt ("booking onay kutusunun aydınlatma metni MADDİ
   olarak genişliyor — yeni bir veri kategorisi ekleniyor") burada da geçerli, hatta daha
   güçlüdür: kimlik adımı yalnızca YENİ VERİ ALANLARI ekliyordu (aynı amaç — randevu), Özellik B
   ise YENİ BİR İŞLEME AMACI ekliyor (hesap oluşturma + kimlik doğrulama + gelecekteki erişim).
   Amaç genişlemesi, alan genişlemesinden KVKK m.10 aydınlatma yükümlülüğü açısından daha
   belirleyicidir — veri sahibinin "verim yalnızca bu randevu için mi kullanılacak yoksa kalıcı
   bir hesaba mı dönüşecek?" sorusuna net cevap alması gerekir.
4. **`m.5/2-c` (sözleşmenin ifası) bu yeni amacı KAPSAMAZ.** Randevu hizmeti, hesap oluşturulmadan
   da tamamen ifa edilebilir (bugün zaten öyle çalışıyor — misafir randevu). Hesap açma, hizmetin
   ZORUNLU bir unsuru değil, **kullanıcı deneyimi kolaylığı** (gelecekte tekrar giriş yapabilme)
   amacıyla eklenen AYRI bir işlemedir — bu da onu güçlü biçimde **açık rıza (m.5/2-a)** temeline
   oturtur, mevcut sözleşme temelli gerekçeye "sırt üstü" bindirilemez.

**Global bump, TR/FOREIGN ayrımı YOK** — [CNI]'deki gibi tek bir GLOBAL artış: metin herkes için
aynı ölçüde genişliyor (guest randevu alan HERKES potansiyel olarak bu akıştan geçer; oturum açmış
kullanıcının kendi randevusunda sağlama zaten no-op olsa da [§5.5], aynı checkbox/aydınlatma
metni akışını PAYLAŞTIĞI için ayrı bir metin dalı AÇILMAZ — aşırı-bilgilendirme bir ihlal
oluşturmaz, eksik bilgilendirme oluşturur).

**Geriye dönük backfill YOK** ([CNI] ile aynı disiplin): bu turdan önceki booking'ler `v2` (veya
daha eski) olarak kalır; bu, o dönemde geçerli aydınlatma kapsamının doğru bir kaydıdır.

**Booking onay kutusu metni — önerilen ek (iskelet, hukuki metin DEĞİL):**
> "...kişisel verilerimin bu randevu kapsamında işlenmesine **ve ödeme sonrasında e-posta
> adresime bağlı bir kullanıcı hesabı oluşturulup bu hesap üzerinden randevularıma erişim
> sağlanmasına** açık rızamı veriyorum."

KVKK Aydınlatma Metni sayfasının "İşlenme Amaçları" bölümüne eklenmesi gereken satır:
> "Hesap Oluşturma ve Erişim Yönetimi — misafir olarak alınan bir randevunun ödemesi
> tamamlandığında, e-posta adresinize bağlı bir kullanıcı hesabı açılır ve bu hesaba erişim için
> tarafınıza bir e-posta doğrulama kodu gönderilir; bu hesap, geçmiş/gelecek randevularınızı tek
> bir yerden görüntülemenizi sağlar. Hesabı etkinleştirmek istemiyorsanız herhangi bir işlem
> yapmak ZORUNDA DEĞİLSİNİZ; aktivasyon yalnızca siz kodu kullanıp bir parola belirlediğinizde
> tamamlanır."

**Not (bloklayıcı değil, ama kayda geçirilmeli):** Hesabın kendisi kullanıcının AÇIKÇA talep
ETMEDİĞİ bir işlemdir (görev tanımının da belirttiği gibi — "sadece ödeme yaparak"). Bu, veri
minimizasyonu ilkesi açısından tartışmaya açık bir tasarım kararıdır ([GAO] §5'te architect
tarafından zaten karara bağlanmış, bu doküman o tasarımı GERİ ÇEVİRMEZ — implementasyon
kapsamındaki tek görevim rıza metninin bunu DOĞRU yansıtmasıdır). Ancak iki teknik telafi
architect tarafından zaten sağlanmış ve bunlar KVKK m.12 (uygun teknik tedbir) açısından
YETERLİDİR: (a) hesap parolasız/erişilemez durumda açılır — kullanıcı aktive ETMEDİĞİ sürece
hesap fiilen "pasif" kalır, (b) `forgot-password`/aktivasyon dışında kullanıcının hesapla
ZORUNLU bir etkileşimi YOKTUR. **Unutulma hakkı ile ilgili tek eksik:** kullanıcı bu şekilde
oluşan (kendisinin talep etmediği) hesabı SİLMEK isterse bugün bunu yapacak bir uç YOK — bu,
bu turun DoD'sini bloklamaz (mevcut sistemde zaten genel bir "hesabımı sil" ucu yok, bu Özellik
B'ye özgü yeni bir eksiklik değil), ama backlog olarak not düşülür: `DELETE /users/me` (veya
admin eliyle silme) akışı ileride eklendiğinde, bu şekilde otomatik açılmış hesaplar da aynı
mekanizmadan geçebilmelidir.

---

## 2. §6 Vektör 3 — istenmeyen veri ilişkilendirme (kurbanın hesabına yabancı kişinin verisi)

**Değerlendirme: Bu GERÇEK bir KVKK riskidir, ancak mevcut "üçüncü kişi adına randevu" deseninden
NİTELİKSEL olarak FARKLIDIR — §5.3'ün "sessizce bağla, ek işlem yapma" kararı YETERSİZDİR; bir
**audit log** eklentisi ÖNERİLİR (bloklayıcı değil).**

**Neden mevcut desenle KARIŞTIRILMAMALI:** `telehealth.routes.ts:445-453,466` incelendi —
OTURUM AÇMIŞ bir kullanıcı, KENDİ isteğiyle, `patientName`/`patientEmail` alanlarına farklı bir
kişinin bilgilerini girip randevuyu KENDİ hesabına (`patientUserId: request.user.id`)
bağlayabiliyor (aile üyesi adına randevu — meşru, mevcut, bu turda DEĞİŞMEYEN bir davranış). Bu
durumda veri, hesap SAHİBİNİN kendi AKTİF eylemiyle hesaba giriyor.

Vektör 3'te ise TAM TERSİ oluyor: hesap sahibi (kurban) **PASİFTİR** — randevu süreciyle hiçbir
etkileşimi yoktur, oturum açmamıştır, hiçbir şey onaylamamıştır. Saldırgan MİSAFİR olarak,
kurbanın e-postasını kullanarak randevu alır; ödeme sonrası Özellik B'nin sağlama mantığı bunu
kurbanın hesabına **otomatik ve sessizce** bağlar. Bu, Özellik B'nin **YENİ** ürettiği bir
davranıştır — Özellik B'den ÖNCE, misafir bir randevunun `patientEmail`'i bir hesapla eşleşse
bile `patientUserId` NULL kalırdı ve randevu o hesabın portalında GÖRÜNMEZDİ (§5.7'nin referans
verdiği `telehealth.portal.routes.ts:596` filtresi `patientUserId` üzerinden çalışır). Yani
**"kurbanın hesabına yabancı veri sızması" riski, Özellik B ile birlikte YENİDEN
doğuyor/genişliyor** — KVKK m.4 "ilgili, sınırlı ve ölçülü olma" ile "doğru ve güncel olma"
ilkeleri açısından mevcut riskin basit bir uzantısı değil, veri sahibinin (kurbanın) rızası/bilgisi
DIŞINDA gerçekleşen yeni bir birleştirme (linkage) olayıdır.

**Zarar kime, ne ölçüde:** Kurbana doğrudan bir güvenlik zararı YOKTUR (mevcut vektör
analizinde de doğrulandığı gibi hesap ele geçirilmiyor). Asıl mağdur aslında **saldırganın
kendisidir** (kendi adı/randevu verisi, kendi seçtiği bir yabancının hesabına maruz kalıyor —
büyük ölçüde kendi eylemi). Ancak KURBAN açısından da somut bir sorun var: **kendi hesabında,
kendisinin oluşturmadığı, kimliğini bilmediği bir kişiye ait randevu kaydı görmek** — hem kafa
karıştırıcıdır hem de "hesabım ele geçirildi mi?" endişesi yaratabilecek bir destek/şikayet
yüküdür, hem de KVKK m.4 anlamında verinin doğruluğu/bütünlüğü ilkesini zedeler (kurbanın
hesabındaki veri artık "kurbana ait" değildir, ama portal ayrımı yapmaz).

**Öneri — architect'in §5.3 kararı NEDEN TEK BAŞINA yeterli DEĞİL, ne eklenmeli:**

1. **§5.3'ün "hiçbir ek işlem yapma" kararı KORUNSUN** — kullanıcıya bildirim GÖNDERİLMESİ
   ÖNERİLMEZ. Gerekçe: (a) §6 vektör 6'daki "hesap-varlık oracle'ı" disipliniyle çelişmemesi için
   bildirim ÖDEME EKRANI/saldırgana asla görünür OLMAMALI (zaten öyle tasarlanmış — bildirim
   sadece kurbanın kendi gelen kutusuna giderdi, saldırgana hiçbir sinyal SIZMAZ, dolayısıyla
   oracle riski YOK) — ama (b) meşru "aile üyesi adına randevu" senaryosunda (kurban BİLE
   olabilir, örn. eşi kurbanın e-postasını hatırlayıp kendi bilgileriyle randevu alıyor) her
   otomatik bağlantıda bir güvenlik e-postası göndermek gereksiz gürültü/endişe yaratır. Net karar
   dengesi: bildirim EKLENMESİN.
2. **Bunun yerine: sessiz bir audit log kaydı EKLENSİN** (observability-agent ile koordineli,
   backend-agent implemente eder). Öneri aksiyon adı: `telehealth.booking.autoLinkedToExistingAccount`,
   `metadata: { bookingId, userId }` — **`patientName`/kimlik alanları metadata'ya YAZILMAZ**
   ([CNI] madde (e) ile AYNI disiplin: audit yalnızca ilişkiyi kaydeder, içeriği SIZDIRMAZ). Bu
   kayıt, ileride bir kurban şikayet ettiğinde ("hesabımda tanımadığım bir randevu var") destek
   ekibinin "bu OTOMATİK bağlandı, kurban tarafından OLUŞTURULMADI" ayrımını yapabilmesini sağlar
   — mevcut oturum-açmış-kullanıcı-kendi-isteğiyle-bağladı senaryosundan AYIRT edilebilir olması
   ÖNEMLİDİR (aksi hâlde destek ekibi iki senaryoyu birbirinden ayıramaz).
3. **§5.3'ün "yeni hesap açılmaz, mevcut hesaba bağlanır" kararı AYNEN KORUNUR** — burada önerilen
   TEK ek, audit log satırıdır; iş akışına, ödeme sürecine veya kullanıcı deneyimine HİÇBİR
   müdahale ÖNERİLMEZ.

**Bu madde bloklayıcı DEĞİLDİR** — mevcut §5.3 kararı zaten güvenlik açısından kabul edilebilir;
audit log eklentisi, gelecekteki bir KVKK başvurusuna/şikayetine yanıt verebilmek için güçlü bir
tavsiyedir (backend-agent bu turda ekleyebilir; eklemezse ayrı bir backlog maddesi olarak takip
edilmelidir, [CNI]'nin 12 aylık süpürücü tavsiyesiyle AYNI statüde: "şiddetle önerilir", "zorunlu"
değil).

---

## 3. `EmailVerificationCode` saklama süresi — **YENİ bir retention job ÖNERİLİR (bloklayıcı değil)**

**[GAO] §11 Kapsam DIŞI ile KARIŞTIRILMAMALI:** architect'in kapsam dışı bıraktığı şey
"doğrulanmamış KULLANICI HESAPLARININ (`User` satırı) otomatik temizliği"dir — bu ayrı bir konudur
ve bu doküman O kararı GERİ ÇEVİRMEZ. Burada değerlendirilen, `EmailVerificationCode`
SATIRLARININ (OTP kodu, deneme sayacı, zaman damgaları) kendisidir — daha dar ve daha az riskli
bir veri kümesi.

**Karar: EVET, aynı disiplin (proje genelindeki `*-retention.ts` deseni) burada da UYGULANMALI —
ancak mevcut turun implementasyon DoD'sini BLOKLAMAZ (`intake-retention.ts`/[CNI]'nin 12 aylık
booking süpürücüsü ile AYNI statü: "şiddetle önerilir", backlog olarak açılabilir).**

**Gerekçe:**

1. [GAO] §3.4 zaten "satır SİLİNMEZ (denetim izi)" diyor — yani satırlar KALICI olarak
   tasarlanmıştır (doğru bir karar, kısa vadeli denetim/anomali tespiti için). Ancak "kalıcı"
   burada "SÜRESİZ" ile eş anlamlı OLMAMALIDIR — proje genelinde HİÇBİR kişisel veri kategorisi
   süresiz saklanmıyor (`intake-retention.ts` 90 gün, `contact-retention.ts`/`support-retention.ts`
   `PII_REDACTION_MS` 30 gün, `cart-retention.ts` günlük). `EmailVerificationCode` satırları
   `userId` (kişisel veri, `User`'a FK) taşıyan, kimin ne zaman kod istediğini/kaç kez yanlış
   denediğini gösteren bir **aktivite/log verisidir** — veri minimizasyonu ilkesi (KVKK m.4)
   gereği bunun da bir sona erme noktası olmalıdır.
2. `codeHash` HMAC ile korunuyor olsa da (§3.2), satırın kendisi (userId + purpose + zaman
   damgaları + attemptCount) tek başına anlamlı bir DAVRANIŞSAL/güvenlik izidir — sızıntı
   senaryosunda "bu kullanıcı şu tarihte kaç kez OTP denedi" bilgisinin süresiz saklanmasının
   meşru bir gerekçesi YOKTUR (kısa vadeli anomali tespiti/dolandırıcılık soruşturması dışında).
3. **Önerilen süre: 30 gün** — projedeki `PII_REDACTION_MS` emsaliyle (contact/support-retention)
   AYNI, çünkü bu da "işlem tamamlandıktan sonra kısa bir denetim penceresi" niteliğindedir; 90
   günlük `intake-retention.ts` penceresi ÖZEL NİTELİKLİ sağlık verisi için ayrılmıştır, OTP kodu
   gibi operasyonel bir güvenlik verisi için gerekli DEĞİLDİR — 30 gün, hem dolandırıcılık/anomali
   soruşturması için yeterli bir pencere hem de minimizasyon ilkesiyle uyumlu bir süredir.
4. **Silinecek satırlar (öneri, [CNI] tablo formatıyla AYNI):**

| Koşul | İşlem | Gerekçe |
|---|---|---|
| `consumedAt IS NOT NULL` VE `consumedAt < now - 30 gün` | Satır **HARD DELETE** | Başarıyla tüketilmiş kod — kanıt değeri 30 gün sonrası için gereksiz |
| `consumedAt IS NULL` VE `expiresAt < now - 30 gün` | Satır **HARD DELETE** | Hiç kullanılmamış/ölü kod (süresi dolmuş veya `attemptCount >= 5`) — aynı gerekçe |
| Canlı kod (`consumedAt IS NULL AND expiresAt > now AND attemptCount < 5`) | **DOKUNULMAZ** | Aktif doğrulama akışını bozmamak için işlem dışı |

   Not: `intake-retention.ts`'in aksine burada **redaksiyon (alan null'lama) değil, TAM SATIR
   SİLME** önerilir — `PasswordResetToken` emsalinde olduğu gibi ([GAO] §1.2 karşılaştırması),
   tüketilmiş/ölü bir OTP satırının hiçbir alanının (hash dahil) 30 gün sonrasında saklanmasının
   fonksiyonel bir değeri kalmaz (booking'in aksine, burada "kaynak" olarak referans alınacak bir
   ilişkili kayıt yoktur).
5. **Önerilen dosya adı/desen:** `backend/src/lib/otp-retention.ts`, `contact-retention.ts` ile
   AYNI iskelet (`registerOtpRetentionScheduler`, saatlik veya günlük kadans — düşük hacimli bir
   tablo olduğu için `intake-retention.ts`'in günlük kadansı yeterlidir).

**Bloklayıcı DEĞİL:** backend-agent bu turda `lib/otp.ts`'i bu retention job'u OLMADAN teslim
edebilir; ancak bu, `.claude/CLAUDE.md`'nin "her yeni özellik/tablo eklendiğinde... içeriyorsa
`DATA_INVENTORY.md`'yi güncelle" ilkesi gereği açık bir backlog maddesi olarak KAYDA GEÇİRİLMELİDİR
(öneri: `chore(auth): EmailVerificationCode 30 günlük saklama süpürücüsü`).

---

## Genel sonuç

| Konu | Karar |
|---|---|
| 1. Consent sürümü | **`v2` → `v3` GEREKİR** — `booking.ts:67`, backend-agent bu turda uygular; global bump, backfill yok |
| 2. Vektör 3 (istenmeyen veri ilişkilendirme) | **Gerçek risk, ama §5.3 iş akışı DEĞİŞMEZ** — tek ek: sessiz audit log (`telehealth.booking.autoLinkedToExistingAccount`, PII'siz metadata); bildirim GÖNDERİLMEZ; bloklayıcı değil |
| 3. `EmailVerificationCode` saklama | **30 günlük hard-delete süpürücüsü ÖNERİLİR** (`otp-retention.ts`, `contact-retention.ts` deseni); bloklayıcı değil, backlog olarak açılmalı |

**BLOKLAYICI implementasyon maddesi:** yalnızca **Konu 1** — `DEFAULT_APPOINTMENT_CONSENT_VERSION`
`"v3"`e yükseltilmeden bu turun DoD'si (`.claude/CLAUDE.md` "KVKK etkisi değerlendirilmiş") TAM
sayılmaz. Konu 2 ve 3 güçlü tavsiyelerdir, backend-agent bu turda uygulayabilir ya da açık backlog
maddesi olarak bırakabilir.

**Hukuki tavsiye notu (tekrar):** Bu doküman genel KVKK/GDPR prensiplerinin teknik gereksinime
çevrilmiş hâlidir, hukuki tavsiye değildir. `v3` aydınlatma/rıza metninin nihai hukuki içeriği,
30 günlük OTP saklama süresinin sektörel/yasal asgari sınırlara uygunluğu ve Vektör 3'ün olası
bir KVKK başvurusu/şikayeti karşısındaki nihai değerlendirmesi için **gerçek bir hukuk
danışmanına başvurulması ZORUNLUDUR.**
