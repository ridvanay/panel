# Uyumluluk Değerlendirmesi — Sipariş Yönetimi Profesyonelleştirme (KVKK/GDPR)

> Referans: `.claude/architect-scope-order-management-pro.md` (bağlayıcı). Bu doküman **hukuki
> tavsiye değildir** — genel KVKK/GDPR prensiplerinin teknik gereksinime çevrilmiş hâlidir. Nihai
> saklama süresi/anonimleştirme/bildirim politikası kararı için gerçek bir hukuk danışmanına
> başvurulmalıdır (bu proje bir üretim ortamı değil, şablon/demo kapsamındadır).

**Kod incelendi, doğrulandı:** `backend/prisma/schema.prisma` (Order/AuditLog modelleri, §4.2/§4.3
yorumları), `backend/src/modules/orders/orders.routes.ts`, `backend/src/mappers/index.ts`
(`toOrderDto`/`toAdminOrderDto`/`toOrderActivityEntryDto`), `frontend/src/app/admin/orders/[orderId]/page.tsx`.
İmplementasyon, architect dokümanının §3.7, §5.3, §5.4, §6.2 kararlarıyla **birebir örtüşüyor** —
aşağıdaki bulgular bu doğrulamaya dayanır, spekülasyon değildir.

**Sonuç özeti: BLOKLAYICI madde YOK.** Aşağıda 2 adet "izlenmesi önerilen" (non-blocking) bulgu ve
§8 madde 3-4 için istenen görüşler yer alıyor.

---

## 1. `Order.adminNotes` — serbest metin, yanlış PII girişi riski

**Bulgu:** `adminNotes` (0..5000 karakter, yalnızca ADMIN yazar/okur, MANAGER salt-okunur) serbest
metin bir alandır. Kod: `frontend/.../[orderId]/page.tsx:904-911` — textarea'da
`placeholder="Bu sipariş hakkında dahili not…"` DIŞINDA hiçbir kullanım kılavuzu/uyarı yok.

**Risk değerlendirmesi:**
- Bu alan bir **hassas veri kategorisi toplama mekanizması DEĞİLDİR** (form tasarımı sağlık/din/
  siyasi görüş sormuyor) — risk, admin'in müşteriyle yaptığı bir telefon görüşmesinde duyduğu bir
  bilgiyi ("hamile olduğu için teslimat ertelendi", "engelli erişim gerekiyor" vb.) düşünmeden buraya
  yazma ihtimalidir. Bu, KVKK md.6 (özel nitelikli kişisel veri) kapsamına giren bir veri türünü,
  ekstra koruma (açık rıza, ayrı erişim kontrolü) OLMAKSIZIN sıradan bir metin alanında saklamak
  anlamına gelir.
- Şu an bu alana erişim zaten ADMIN'e kilitli (§3.2) ve müşteri yüzeyine SIZMIYOR (§3.7 doğrulandı:
  `toOrderDto` değişmemiş, `toAdminOrderDto` ayrı). Bu iyi bir teknik önlem ama **veri toplanmasını
  önlemez**, yalnızca yayılımını sınırlar.

**Öneri (non-blocking, izlenmesi önerilir):**
1. Textarea'nın üstüne kısa bir yardım metni eklenmesi önerilir: *"Yalnızca operasyonel bilgi girin
   (ör. 'müşteri kapıda teslim istemiyor'). Sağlık, din, siyasi görüş gibi özel nitelikli veya
   gereksiz kişisel bilgi yazmayın."* — Bu bir metin/UX değişikliğidir, frontend-agent'a devredilir,
   bloklayıcı değildir.
2. Saklama süresi: `adminNotes`, `Order` kaydının **parçasıdır** ve mevcut `Order`/`OrderItem`
   retention kararı (`schema.prisma:1992-2015`, KVKK md.5/2-c + md.5/2-ç — tamamlanmış ticari işlem
   kaydı, muhasebe zorunluluğu) **aynen kapsar**: ayrı bir saklama süresi/otomatik silme job'ı
   GEREKMEZ, `Order` silinmeden `adminNotes` de silinmez. Bu tutarlıdır — yeni bir sapma yaratmaz.
3. Unutulma hakkı akışı (mevcut karar, `schema.prisma:2007-2012`): manuel `customerEmail`/
   `customerName` "[REDACTED]" anonimleştirmesi `adminNotes`'u KAPSAMAZ. Eğer `adminNotes` içine
   müşteri adı/iletişim bilgisi serbest metin olarak yazılmışsa (ör. "Ayşe Hanım tekrar aradı, yeni
   telefon: 05xx..."), müşteri kimliği bu alanda da dolaşıyor demektir ve mevcut anonimleştirme
   akışı bunu **YAKALAMAZ**. Bu, madde 1'deki öneriyle aynı kökten bir zayıflık: serbest metin
   alanları yapılandırılmış silme/anonimleştirme akışlarının kör noktasıdır. Bloklayıcı değil ama
   dokümante edilmeli: bir md.11 silme talebi geldiğinde admin, `adminNotes` içeriğini de
   **manuel olarak** gözden geçirip gerekirse temizlemelidir (mevcut `schema.prisma` notundaki manuel
   akışa bu adım eklenmeli).

---

## 2. `Order.cancellationReason` — müşteriye e-posta ile giden admin serbest metni

**Bulgu:** Admin'in yazdığı metin, HTML-escape edilerek (`template-render.ts::escapeHtml`,
doğrulandı) ama **içerik olarak sansürlenmeden/denetlenmeden** doğrudan müşteriye giden e-postaya
basılıyor (`orders.routes.ts:259-267`).

**Değerlendirme:** Bunun **teknik/hukuki bir KVKK riski OLMADIĞI** görüşündeyim — enjeksiyon
(XSS/HTML) riski zaten HTML-escape ile kapatılmış (security-agent alanı, doğrulandı). Kalan risk
("admin ayrımcı/uygunsuz bir ifade yazar") bir **veri koruma** riski değil, bir **kurumsal
iletişim/itibar ve olası tüketici hukuku (haksız fiil, ayrımcılık yasağı)** riskidir — yani
**süreç/eğitim meselesi**, compliance-agent'ın KVKK/GDPR yetki alanının dışındadır. Bu görüşü
kaydediyorum ama bloklayıcı işaretlemiyorum.

**Tek KVKK-ilintili not:** `cancellation_reason` metni serbestçe girildiği için admin burada da
(madde 1'deki gibi) kazara üçüncü bir kişinin (ör. tedarikçi, kargo firması çalışanı) kişisel
verisini yazıp müşteriye e-postayla iletebilir (ör. "Kurye Mehmet Bey aracınızı bulamadı"). Bu da
düşük olasılıklı, düşük etkili bir uç durumdur — bloklayıcı değil, madde 1'deki genel "serbest metin
alanlarına dikkat" önerisiyle birlikte ele alınmalı.

---

## 3. `GET /:orderId/activity` — `actorEmail` ve DB'deki `ipAddress`

**`actorEmail` (iç personel verisi):** Doğru tespit — bu, müşteri PII'si değil, **çalışan/işveren
ilişkisi kapsamında işlenen bir kişisel veridir** (KVKK md.5/2-f, "veri sorumlusunun meşru menfaati" —
hangi personelin hangi işlemi yaptığının izlenebilirliği, hesap verebilirlik/iç kontrol amacıyla).
Bunun hukuki temeli müşteri verisininkinden **farklıdır** ama bu, teknik implementasyonu
**değiştirmez**: mevcut `AuditLog.actorEmail` zaten bu amaçla (iç hesap verebilirlik) toplanıyor ve
bu uç sadece mevcut bir alanı MANAGER'a da açıyor (ADMIN zaten `/admin/logs` üzerinden görüyordu).
**Yeni bir veri toplama YOK**, yalnızca mevcut verinin ikinci bir okuma yüzeyi var. Değerlendirme:
KVKK açısından ek bir aydınlatma yükümlülüğü doğurmaz (personel zaten iş sözleşmesi/İK aydınlatma
metni kapsamında "işlemlerinin loglandığı" konusunda bilgilendirilmiş olmalıdır — bu proje
kapsamında var olduğu varsayılan bir İK süreci, compliance-agent'ın bu göreve özgü kapsamı dışında).
**Bloklayıcı değil.**

**`ipAddress`'in response'tan bilerek çıkarılması (§5.4) yeterli mi:** Evet, **yeterli** —
`toOrderActivityEntryDto` allow-list'i doğrulandı (`ipAddress` şeması yok, `ORDER_ACTIVITY_METADATA_ALLOW_LIST`
içinde de yok), bu okuma ucu için veri minimizasyonu ilkesi doğru uygulanmış. Gerekçe de tutarlı:
IP'nin bu ekran için operasyonel değeri yok, PII yükü var — dolayısıyla döndürülmemesi doğru karar.

**DB'de saklanan `ipAddress`'in kendisi için ayrı bir değerlendirme gerekir mi:** Görev tanımının da
belirttiği gibi bu **YENİ bir veri değil** — `AuditLog.ipAddress` bu özellikten önce de vardı ve
zaten mevcut bir compliance kararına tabi (`schema.prisma:2246` — "HAM IP SAKLANMAZ" notu, ayrı bir
bağlamda; `AuditLog.ipAddress`'in kendisi ayrı bir alan). Bu görevin kapsamı yalnızca **yeni bir
okuma ucu** eklemek olduğundan, `AuditLog.ipAddress`'in genel saklama/maskeleme politikasını burada
YENİDEN açmıyorum — bu, bu görevin dışında, `AuditLog` modelinin kendi retention/masking kararının
konusu (daha önce ayrı bir compliance-agent turunda ele alınmış olabilir; ele alınmadıysa ayrı bir
görev olarak açılmalı, bu görevi bloklamaz).

---

## 4. İptal e-postası içeriği — `items_summary`/`total_formatted`, SMTP sağlayıcısı

**Değerlendirme:** Doğru tespit — bu **AYNI veri sınıfı**, `ORDER_CONFIRMATION` şablonu zaten
`items_summary`/`total_formatted` (aynı üretim mantığı, doğrulandı: `orders.routes.ts:262-265`)
içeriyor ve bu veri zaten SMTP sağlayıcısı üzerinden aynı müşteriye taşınıyor. **Yeni bir risk
YARATMIYOR** — mevcut `ORDER_CONFIRMATION` akışı için ne karar verilmişse (üçüncü taraf SMTP
sağlayıcısının KVKK/GDPR uygunluğu, varsa yurt dışı veri aktarımı değerlendirmesi — ör. sağlayıcı
ABD merkezliyse) bu akış için de **aynen geçerlidir**.

**Not (bloklayıcı değil, izlenmesi önerilir):** Eğer `ORDER_CONFIRMATION` için daha önce ayrı bir
üçüncü-taraf/yurt dışı aktarım değerlendirmesi yapılmadıysa (bu görevin kapsamında bu doğrulanamadı —
`lib/mail.ts` SMTP sağlayıcı seçimi devops/entegrasyon konfigürasyonu, bu görev onu değiştirmiyor),
o değerlendirme **her iki şablon için birlikte** yapılmalı; bu görev **yeni bir eksik açmıyor**,
mevcut (varsa) eksiği miras alıyor.

---

## 5. §8 madde 3 — `cancellationReason` portalda gösterilmiyor, yalnızca e-postayla ulaşıyor: GÖRÜŞ

**Görüş:** KVKK md.11 "veriye erişim hakkı" **belirli bir arayüzde gösterim** talep etmez; ilgili
kişinin kendi verisine **bir şekilde** (talep üzerine, makul sürede, anlaşılır biçimde) erişebilmesini
talep eder. Mevcut tasarımda müşteri, iptal nedenini **e-posta yoluyla zaten alıyor** — yani veri
ilgili kişiye fiilen ulaştırılmış durumda, "erişimi engellenmiş" bir veri değil. Bu nedenle mevcut
tasarımın md.11 açısından **yetersiz olduğunu düşünmüyorum**; portalda AYRICA gösterilmesi bir "nice
to have" (kullanıcı deneyimi iyileştirmesi), bir **KVKK zorunluluğu değildir**.

Ancak iki ek nokta:
- E-posta teslimatı başarısız olursa (§9 madde 2, `order.cancel_email` `FAILURE`), müşteri iptal
  nedenini **hiçbir kanaldan** alamaz — bu durumda erişim fiilen kesintiye uğrar. Portalda gösterim
  bu senaryo için bir **yedek kanal** işlevi görürdü. Bu, md.11 ihlali değil ama pratik bir açık.
- Müşteri, e-postayı silmiş/bulamıyorsa ve destek hattına "neden iptal edildi?" diye sorarsa, mevcut
  sistemde bu bilginin tekrar sunulacağı bir müşteri-yüzeyi API'si yok (yalnızca admin görebiliyor).

**Sonuç:** Bloklayıcı değil. §3.7 kararı (mevcut sızdırmama tercihi) KVKK açısından savunulabilir;
portalda gösterim istenirse bu bir **ürün kararı**dır (architect + ui-designer), compliance-agent
olarak buna itirazım yok, yalnızca yukarıdaki iki pratik notu kayda geçiriyorum.

---

## 6. §8 madde 4 — `sendCustomerEmail: false` ile hiç bilgilendirme yapılmaması: GÖRÜŞ

**Görüş (genel değerlendirme, hukuki tavsiye değil):** Bir sözleşmenin (satış sözleşmesi) tek taraflı
feshi niteliğindeki bir işlemin karşı tarafa **hiç bildirilmemesi**, KVKK'nın doğrudan konusu değildir
(KVKK kişisel veri işlemeyi düzenler, sözleşme fesih bildirimini değil) — ancak **Türk Borçlar
Kanunu/Tüketicinin Korunması Hakkında Kanun** kapsamında satıcının siparişi tek taraflı iptal ettiği
durumlarda tüketiciyi bilgilendirme yükümlülüğü doğabilir. Bu **compliance-agent'ın (KVKK/GDPR)
yetki alanının dışında**, gerçek bir hukuk danışmanına yönlendirilmesi gereken bir sorudur.

KVKK açısından tek ilgili nokta: `sendCustomerEmail: false` seçildiğinde `order.cancel_email` kaydı
**hiç oluşturulmuyor** olması (doğrulandı, §6.2 kuralı kodda uygulanmış) — bu, "e-posta gönderilmedi"
bilgisinin audit izinde de görünür kalmasını sağlıyor (`order.status_change` metadata'sındaki
`customerEmailRequested: false` üzerinden), yani **hesap verebilirlik açısından bir kayıp yok**.
Bu teknik detay KVKK uyumludur; asıl soru (bildirimsiz iptalin tüketici hukuku açısından riski)
**bloklayıcı değil ama gerçek hukuk danışmanına iletilmesi önerilen** bir açık maddedir — mevcut
dokümanın kendisi de bunu zaten §8.4'te doğru şekilde işaretlemiş.

---

## Genel sonuç

| # | Konu | Durum |
|---|---|---|
| 1 | `adminNotes` serbest metin / PII riski | Non-blocking — UX uyarı metni + manuel silme akışına not eklenmesi önerilir |
| 2 | `cancellationReason` uygunsuz ifade riski | Süreç/eğitim meselesi, KVKK kapsamı dışı — bloklayıcı değil |
| 3 | `actorEmail`/`ipAddress` (activity) | Mevcut implementasyon KVKK'ya uygun, ek aksiyon gerekmiyor |
| 4 | İptal e-postası içeriği (3. taraf SMTP) | Yeni risk yok, mevcut `ORDER_CONFIRMATION` değerlendirmesiyle aynı kapsamda |
| 5 | Portalda `cancellationReason` gösterilmemesi | md.11 açısından yeterli — ürün kararı, KVKK zorunluluğu değil |
| 6 | Sessiz iptal (`sendCustomerEmail:false`) | KVKK dışı (tüketici hukuku) — gerçek hukuk danışmanına yönlendirilmeli |

**Bloklayıcı madde: YOK.** İmplementasyon `.claude/architect-scope-order-management-pro.md` §3.7,
§5.3, §5.4, §6.2 kararlarıyla tutarlı; veri minimizasyonu (audit metadata allow-list, alan-adı-only
loglama, e-posta alıcı adresinin metadata'ya yazılmaması) doğru uygulanmış.

**Hukuki tavsiye notu:** Bu doküman genel KVKK/GDPR prensiplerinin teknik gereksinime çevrilmiş
hâlidir, hukuki tavsiye değildir. §6 maddesindeki tüketici hukuku sorusu ve genel saklama süresi
(muhasebe mevzuatı) kararı için gerçek bir hukuk danışmanına başvurulması önerilir.
