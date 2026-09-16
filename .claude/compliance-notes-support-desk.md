# Uyumluluk Değerlendirmesi — Canlı Destek Masası (`SupportChatSession` / `SupportChatMessage` / `SupportReplyTemplate`) — KVKK/GDPR

> Referans: `.claude/architect-scope-support-desk-and-reminders.md` (**[ASD]**) §3, özellikle
> §3.4 (şema taslağı), §3.6 (güvenlik sınırları), §3.7 (KVKK — bu göreve devir). Üst doküman:
> `.claude/compliance-notes-telehealth.md` (**[CNT]**) — bu doküman [CNT]'nin saklama/rıza
> disiplinini **bozmaz, aynı desenleri (ContactSubmission emsali) destek sohbetine uyarlar.**
> Bu doküman **hukuki tavsiye DEĞİLDİR** — genel KVKK/GDPR prensiplerinin teknik gereksinime
> çevrilmiş hâlidir. Nihai saklama süresi/aydınlatma metni/açık rıza içeriği/VERBİS bildirimi
> için **gerçek bir hukuk danışmanına** başvurulması ZORUNLUDUR; bu proje bir üretim ortamı
> değildir.

**Kod incelendi, doğrulandı:** `backend/prisma/schema.prisma` (`ContactSubmission` modeli, satır
1774-1804 — `consentAt`/`consentTextSnapshot`/`ipAddress`/`userAgent`/`piiRedactedAt` deseni;
`SupportChatSession`/`SupportChatMessage`/`SupportReplyTemplate` **henüz şemada YOK** — bu tur
db-agent'tan ÖNCE çalışıyor), `backend/src/lib/contact-retention.ts` (tam dosya — saatlik
sweeper deseni: redaksiyon + koşullu kalıcı silme, aynı dosyada iki bağımsız işlem),
`docs/architecture/openapi.yaml` (satır 728-780 `Support` tag açıklaması; 10928-11460 uç
tanımları; 20082-20320 şema tanımları — `SupportAgentSummary`'de `email` YOK,
`SupportChatMessagePublic`'te `senderUserId` YOK, `DELETE /admin/support/sessions/{id}`
açıklaması "geri alınamaz, çöp kutusu YOKTUR" diyor — **zaten kontrata yazılmış**).

## Karar: **ONAY (koşullu netleştirmelerle) — db-agent M3 migration'ına başlayabilir.** Bloklayıcı bulgu yok; aşağıdaki 6 madde BAĞLAYICIDIR.

---

## 1. Veri envanteri — hangi alan, nerede, ne amaçla

| Model.Alan | Tip | Amaç / hukuki sebep | Saklama |
|---|---|---|---|
| `SupportChatSession.visitorName` | `String?` | Ziyaretçi BEYANI, doğrulanmamış; personelin hitap edebilmesi (m.5/2-f meşru menfaat — destek talebine yanıt) | Oturum kalıcı silinene kadar (bkz. §3) — redaksiyona tabi DEĞİL, çünkü personelin yanıt verebilmesi için gerekli (`ContactSubmission.name` ile aynı desen) |
| `SupportChatSession.visitorEmail` | `String?` | Aynı gerekçe; dönüş yapılabilmesi | Aynı |
| `SupportChatSession.visitorUserId` | `String? (FK User)` | Kayıtlı ziyaretçi ise ilişkilendirme (`Cart.siteUserId` deseni) | `User` silinirse `onDelete: SetNull` — ayrı bir retention GEREKMEZ |
| `SupportChatSession.ipAddress` | `String?` | Kötüye kullanım/güvenlik amaçlı (m.5/2-f) | **30 gün** sonra `null` |
| `SupportChatSession.userAgent` | `String?` | Aynı | **30 gün** sonra `null` |
| `SupportChatSession.piiRedactedAt` | `DateTime?` | Redaksiyon kanıtı — `ContactSubmission.piiRedactedAt` ile BİREBİR aynı adlandırma | — |
| `SupportChatSession.pageUrl` / `locale` | `String?` | Bağlam; PII değil (doğrulanmaz) | Oturumla birlikte gider |
| `SupportChatSession.closedAt` / `closedById` | `DateTime?` / `String? FK User` | 180 günlük silme sayacının başlangıcı + hesap verebilirlik | `closedById`: `User` silinirse `SetNull` |
| `SupportChatSession.assignedAgentId` | `String? FK User` | Personel verisi (kişi verisi DEĞİL, iç operasyon) | `SetNull` |
| `SupportChatMessage.senderDisplayName` | `String?` | SNAPSHOT — personelin görünen ADI (e-posta DEĞİL); `OrderItem.productTitle` disipliniyle aynı | Mesajla birlikte gider (mesaj Cascade ile oturuma bağlı) |
| `SupportChatMessage.senderUserId` | `String?` | Personel FK — **yalnızca yönetim DTO'sunda döner** | `SetNull` |
| `SupportChatMessage.body` | `String @db.Text` | Serbest metin — **md.6 özel nitelikli veri riski taşıyabilir** (bkz. §2) | Mesaj, bağlı olduğu oturumla birlikte gider (`onDelete: Cascade`) |
| `SupportReplyTemplate.*` | — | Personel tarafından YAZILAN şablon metni — bir ziyaretçiye ait kişisel veri DEĞİLDİR | Retention GEREKMEZ (kişisel veri değil) |

**Yeni kolon önerisi: YOK.** [ASD] §3.4'teki taslak, `ContactSubmission` emsaliyle tutarlı ve
yeterlidir — db-agent **ek bir kolon eklemeden** M3'ü uygulayabilir. Tek fark: aşağıdaki §3'teki
180/365 günlük silme kararları **yeni bir "marker" kolonu gerektirmez** (`closedAt` ve
`lastMessageAt` zaten var, `deleteMany` bunlar üzerinden doğrudan çalışır — `ContactSubmission`
kalıcı silme adımıyla AYNI desen, orada da ayrı bir marker kolonu yok).

---

## 2. Özel nitelikli veri (md.6) riski — rıza YERİNE veri minimizasyonu tercih edildi

Ziyaretçi serbest metin yazdığı için `SupportChatMessage.body` teorik olarak sağlık durumu
anlatımı (md.6 özel nitelikli veri) içerebilir — [ASD] §3.7'nin işaret ettiği risk **doğrudur**.

**Karar: açık rıza YERİNE veri minimizasyonu (privacy-by-design) tercih edilir.** Gerekçe:

1. Bu bir "sağlık verisi toplama özelliği" DEĞİLDİR (intake formu/belge yükleme gibi) — genel bir
   destek kanalıdır. Md.6 verisini işlemek için gereken açık rıza metni, işlenecek özel nitelikli
   veri KATEGORİLERİNİN sayılmasını gerektirir (bkz. [CNT] "Açık Rıza Metni sayfası" iskeleti) —
   bunu önceden bilmeden (ziyaretçi ne yazacağı önceden belli değil) her sohbet başında
   doldurmak hem pratik değildir hem de "her ihtimale karşı geniş bir rıza" toplamak anlamına
   gelir, bu da KVKK'nın **açık ve belirli olma** ilkesiyle çelişir.
2. Bunun yerine **veriyi baştan toplamamak** tercih edilir: widget'ta zorunlu, sürekli görünür bir
   uyarı (bkz. §4) ile ziyaretçi sağlık detayı paylaşmaması konusunda AÇIKÇA bilgilendirilir. Bu,
   sistem talimatındaki "veri minimizasyonu" ilkesiyle birebir örtüşür — rıza almak yerine
   toplamamaya çalışmak, ihlal yüzeyini kaynağında küçültür.
3. Ziyaretçi uyarıya rağmen sağlık bilgisi paylaşırsa bu **kabul edilen, kalan bir risktir**
   (aynı ilke [ASD] §1.2'de "erken katılım" için kullanılmıştı — bilinçli, gerekçeli risk kabulü).
   Kalan riski azaltan katmanlar: (a) erişim yalnızca ADMIN/MANAGER personelle sınırlı
   ([ASD] §3.2, EDITOR HİÇ göremez), (b) kısa saklama süreleri (§3), (c) tam metin arama YOKTUR
   ([ASD] §6 kapsam dışı listesi — bilinçli, bu riski büyütmemek için), (d) aşağıdaki §6'daki
   görüntüleme audit'i.
4. **Şifreleme (AES-256-GCM, `lib/crypto.ts`) bu turda ZORUNLU KILINMAZ** — bu, sağlık verisi
   toplamak için TASARLANMIŞ `AppointmentIntake.noteCiphertext` ([CNT] TUR 2) ile aynı düzeyde bir
   risk taşımaz (o özellik BİLEREK şikâyet notu topluyor; bu özellik BİLEREK toplamamaya çalışıyor
   ve arama/dışa aktarım gibi ek ifşa yüzeyleri zaten kapalı). **Bağlayıcı olmayan, ileriye dönük
   öneri:** izleme/şikâyet verisiyle ziyaretçilerin uyarıya rağmen sağlık detayı paylaşma sıklığı
   yüksek çıkarsa, `body` alanı için aynı şifreleme mekanizması yeniden değerlendirilmelidir —
   bu turun DoD'sini BLOKLAMAZ.

**Hukuki sebep (taslak, nihai onay hukuk danışmanınındır):**
- Ad/e-posta/mesaj (genel PII): m.5/2-f (meşru menfaat — destek talebine yanıt) + m.10 aydınlatma.
- Sağlık verisi riski: **rıza YERİNE önleme** (yukarıdaki gerekçe) — bir sağlık verisi işleme
  faaliyeti olarak TASARLANMADIĞI için m.6 açık rıza akışı bu kanala **kurulmaz**; bu, riskin
  yok sayıldığı anlamına gelmez, §2 madde 3'teki "kabul edilen risk" olarak kayda geçirilir.

---

## 3. Saklama süreleri — KESİN kararlar

| # | Kural | Süre | Tetikleyen koşul | Sonuç |
|---|---|---|---|---|
| 1 | IP/UA redaksiyonu | **30 gün** (createdAt bazlı) | `createdAt < now - 30g` AND `piiRedactedAt IS NULL` | `ipAddress`/`userAgent` → `null`, `piiRedactedAt` → `now()`. Satır SİLİNMEZ. |
| 2 | `CLOSED` oturum kalıcı silme | **180 gün** — **`closedAt` bazlı** (`createdAt` DEĞİL) | `status = CLOSED` AND `closedAt < now - 180g` | Oturum + tüm mesajlar (`onDelete: Cascade`) **KALICI SİLİNİR**. |
| 3 | **YENİ — kapatılmamış oturum üst sınırı (bağlayıcı ek karar)** | **365 gün** | `status IN (PENDING, ANSWERED)` AND `COALESCE(lastMessageAt, createdAt) < now - 365g` | Aynı şekilde **KALICI SİLİNİR** (status'tan bağımsız). |

**Madde 2 neden `createdAt` değil `closedAt`:** [ASD] §3.7 "180 gün sonra kalıcı silinir" derken
başlangıç noktasını belirtmemişti. `createdAt` kullanılırsa, aylarca `PENDING`'de bekleyen ama
geç kapatılan bir oturum, kapatıldığı anda neredeyse hemen silinebilir — bu, personelin oturumu
referans olarak kullanabileceği makul bir pencereyi kısaltır. `closedAt` (etkileşimin fiilen
bittiği an) daha doğru bir başlangıç noktasıdır ve `ContactSubmission`'ın `createdAt` bazlı
olmasından FARKLI olması bilinçlidir — iletişim formu tek seferlik bir gönderimdir, destek
sohbeti süregelen bir etkileşimdir.

**Madde 3 neden gerekli (compliance-agent'ın kendi eklediği, [ASD]'de YOKTU):** [ASD]'nin
tasarımında yalnızca `CLOSED` oturumlar silinir; bir oturum hiç kapatılmazsa (personel unutur,
ziyaretçi bir daha yazmaz, "havuzda" asılı kalır) **süresiz saklanır** — bu, KVKK'nın "işleme
amacı ortadan kalktığında saklamama" ilkesiyle çelişen bir boşluktur. 365 gün, personelin makul
bir işlem penceresinden (180 günün üstünde, dolayısıyla normal iş akışını kısıtlamaz) sonra bu
boşluğu kapatan bir GÜVENLİK AĞIDIR — status'a bakılmaksızın hiçbir oturum 365 günden uzun
saklanamaz.

**Sweeper dosyası:** `backend/src/lib/support-retention.ts` — `contact-retention.ts` ile
**BİREBİR AYNI iskelet** (tek dosyada üç bağımsız `updateMany`/`deleteMany`, hepsi idempotent,
saatlik kadans `RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000`, `app.ts` `onReady`'de kayıt,
`onClose`'da `clearInterval`). Bu, backend-agent'ın implementasyon işidir — bu doküman yalnızca
sözleşmeyi (süre + tetikleyici + sonuç) dondurur.

---

## 4. Widget uyarı metni — KESİN, TAM Türkçe metin

**Zorunlu, her zaman görünür (tek seferlik kapatılabilir bir banner DEĞİL — mesaj kutusunun
HEMEN ÜSTÜNDE, sürekli):**

> "Lütfen sağlık durumunuza ilişkin ayrıntı paylaşmayın; tıbbi konular için randevu oluşturun."

([ASD] §3.7'nin önerdiği metin — incelendi, KVKK açısından yeterli/net bulundu, DEĞİŞTİRİLMEDEN
finalize edildi.)

**Ek olarak (bu doküman ile YENİ eklenen, bağlayıcı) — aydınlatma bildirimi:** Sağlık uyarısından
ayrı, mesaj gönderme alanının altında küçük punto bir şeffaflık notu (m.10 aydınlatma
yükümlülüğü; bir onay kutusu DEĞİL, yalnızca bildirim/link):

> "Bu sohbeti kullanarak [KVKK Aydınlatma Metni]'ni kabul etmiş olursunuz."

`[KVKK Aydınlatma Metni]` mevcut, site genelinde zaten var olan aydınlatma metni sayfasına link
verir (telehealth şablonundaki `kvkk-aydinlatma-metni` sayfasıyla AYNI kaynak — yeni bir sayfa
İCAT EDİLMEZ). **Onay kutusu/checkbox EKLENMEZ** — gerekçe §2 madde 1 (widget'ın düşük sürtünmeli
doğası + belirli-kategori rıza metni pratik değil). Bu, `ContactForm`'un ZORUNLU checkbox'ından
**bilinçli bir sapmadır**: destek sohbeti farklı bir veri sınıfı riski taşımıyor (genel PII,
m.5/2-f yeterli), yalnızca md.6 riski var ve o risk rıza değil önleme ile ele alınıyor (§2).

**Yerleşim (frontend-agent'a bağlayıcı):** İki metin de `live-chat-widget.tsx`'in
`InternalChatPanel`'inde, mesaj gönderme formunun sabit bir parçası olarak render edilir; ne
`sessionStorage` ne `localStorage` ile "bir daha gösterme" YAPILMAZ (sağlık uyarısı her mesajdan
önce hatırlatılmalıdır — [CNT]'nin `LEGAL_PLACEHOLDER_NOTICE` ilkesinden FARKLI olarak bu bir
tek seferlik hukuki uyarı değil, davranışsal bir hatırlatmadır).

---

## 5. Personel kimlik bilgisinin sızmaması — TEYİT

**Onaylanır — zaten kontrata (`openapi.yaml`) doğru yazılmış:**

1. `SupportAgentSummary` şeması (satır 20136-20146): `{ id, name, role }` — **`email` YOK**.
   `GET /admin/support/agents` dropdown'ı e-posta döndürmüyor. **ONAY.**
2. `SupportChatMessagePublic` (ziyaretçi yüzeyi, satır 20102-20122): yalnızca
   `senderDisplayName` (ad, e-posta DEĞİL) taşıyor; `senderUserId` bu DTO'da **YOK**.
   `SupportChatMessage` (yönetim yüzeyi, satır 20124-20134) `senderUserId` EKLER ama bu yalnızca
   ADMIN/MANAGER'a döner. **ONAY.**
3. `SupportChatSession`/`SupportChatSessionSummary`'de `assignedAgent` alanı
   `SupportAgentSummary`'yi kullanıyor (satır 20184-20188, 20220-20223) — burada da e-posta YOK.
   **ONAY.**

**Sonuç: backend-agent'ın `mappers/index.ts`'te uygulayacağı DTO eşlemesi bu üç kuralı
BİREBİR yansıtmalıdır** — `senderUser.email`/`assignedAgent.email` gibi bir alanın YANLIŞLIKLA
mapper'a eklenmediğini security-agent + code-quality-agent ayrıca grep ile doğrulamalıdır (bu,
[ASD] §4.6 madde 6'nın zaten öngördüğü denetimdir — compliance-agent bunu DESTEKLER).

---

## 6. `DELETE /admin/support/sessions/{id}` — veri sahibi silme hakkının karşılığı

**Onaylanır — kontrat zaten doğru tasarlanmış (satır 11183-11195):**

- **HARD DELETE (kalıcı silme), SOFT DELETE DEĞİL.** "Geri alınamaz — çöp kutusu YOKTUR" ifadesi
  KVKK md.11 (ve GDPR Art. 17) "silme" hakkının teknik karşılığı için **doğru yorumdur** —
  md.11 "silinmesini isteme" bir soft-delete/arşivleme değil, verinin fiilen ortadan kalkmasını
  ifade eder.
- Mesajlar `onDelete: Cascade` ile birlikte gider — kısmi bir silme (yalnızca oturum, mesajlar
  kalır) KVKK açısından YETERSİZ olurdu, doğru tasarım budur.
- Audit: `support.session_delete` zaten tanımlı ([ASD] §3.6 madde 5) — SİLİNEN VERİNİN
  İÇERİĞİ değil, yalnızca `sessionId` + aktör + zaman metadata'ya yazılmalıdır (mesaj
  içeriği/ziyaretçi PII'si audit'e YAZILMAZ kuralı burada da geçerli).

**Boşluk (bloklayıcı değil, kayda geçirilmeli):** Ziyaretçi genellikle kayıtsız/anonimdir — bu
ucu **kendisi çağıramaz** (yetki `ADMIN`/`MANAGER`). Yani bir ziyaretçinin "verimi sil" talebi
**kendi kendine hizmet (self-service) DEĞİLDİR**; talep başka bir kanaldan (ör. iletişim formu,
e-posta) ADMIN'e ulaşmalı, ADMIN bu ucu MANUEL çağırmalıdır. **Bu, `ContactSubmission`/`Order`
için zaten kabul edilmiş "manuel ADMIN işlemi yeterlidir" emsaliyle ([CNT] KVKK md.11 bölümü)
BİREBİR TUTARLIDIR** — ayrı bir öz-hizmet ucu (ör. ziyaretçinin kendi `accessToken`'ıyla kendi
oturumunu silebilmesi) bu turda **istenmedi, GEREKMEZ**; talep sıklığı artarsa
`feature/support-visitor-self-delete` olarak backlog'a alınabilir.

---

## 7. Audit / erişim izleme — görüntüleme kaydı eklenmeli (YENİ, bağlayıcı)

[ASD] §3.5 "kontrata yazılmış davranış kuralları" bölümü: *"`GET` uçları yan etkisizdir (okundu
işaretlemez)"* — bu ifade **okundu/unread SAYACINI etkilememe** kuralıdır, audit LOGLAMAMA
anlamına GELMEMELİDİR. Görev tanımındaki "kim, ne zaman, hangi kişisel veriyi görüntüledi"
gerekliliği ([CLAUDE.md görev maddesi 5] + bu turun görev tanımı madde 5) şu an [ASD]'de
**karşılanmıyor** — hiçbir `GET` ucu audit üretmiyor, dolayısıyla potansiyel md.6 içerikli bir
sohbeti kimin görüntülediğinin izi YOK.

**Karar (bağlayıcı, backend-agent'a):**
- `GET /admin/support/sessions/{sessionId}` (oturum detayı, mesaj dizisi DEĞİL) çağrısında
  **oturum başına, personel başına GÜNDE BİR KEZ** `support.session_viewed` audit kaydı
  yazılır (`metadata: { sessionId }` — mesaj içeriği/ziyaretçi adı YAZILMAZ). "Günde bir kez"
  sınırı **zorunludur** — aksi halde 5 saniyelik mesaj poll'ü (`GET .../messages`) audit
  tablosunu taşırır; bu yüzden yalnızca oturum DETAY ucu (15 saniyede bir çağrılan liste değil,
  bir oturumu AÇMA eylemi) loglanır, `.../messages` poll ucu loglanmaz.
- Bu, observability-agent'ın önerdiği "en eski yanıtlanmamış oturum yaşı" metriğinden **AYRI ve
  EK** bir gerekliliktir — biri operasyonel metrik, diğeri hesap verebilirlik/erişim izidir.

---

## 8. Üçüncü taraf / yurt dışı aktarım — kapsam dışı ama işaretlendi

`SiteSettings.liveChatProvider` mekanizmasının `crisp`/`tawkto` dalları bu turda **dokunulmuyor**
([ASD] §3.1) — bunlar yabancı (ABD/AB merkezli) SaaS canlı-sohbet sağlayıcılarıdır ve
etkinleştirilirlerse ziyaretçi PII'si (ve olası sağlık verisi anlatımı) **yurt dışına aktarılmış**
olur. Bu turun kapsamı `liveChatProvider = "internal"` (kendi backend'imiz, veri hiç
yurt dışına çıkmaz) olduğu için **bloklayıcı değildir**, ama kayda geçirilir:

**Bağlayıcı olmayan öneri:** Bir telesağlık sitesinde `crisp`/`tawkto` gibi üçüncü taraf
sağlayıcıların gelecekte etkinleştirilmesi, ayrı bir KVKK/GDPR değerlendirmesi (veri işleyen
sözleşmesi/SCC, yurt dışı aktarım için açık rıza veya Kurul kararına uygun mekanizma) gerektirir
— özellikle hastaların sağlık bağlamlı sohbet edebileceği bir sayfada. Bu, mevcut `crisp`/`tawkto`
kodunun DEĞİŞTİRİLMESİNİ gerektirmez, yalnızca **ileride etkinleştirilmeden önce compliance-agent
tarafından ayrı bir tur** açılması gerektiğinin notudur.

---

## 9. Ajan iş bölümü (bu dokümanın çıktısı olarak)

- **db-agent:** [ASD] §3.4 şeması AYNEN (ek kolon YOK) — M3 migration'a başlayabilir.
- **backend-agent:** `lib/support-retention.ts` (§3 — üç kural, `contact-retention.ts`
  iskeleti), `support.session_viewed` audit kaydı (§7), DTO mapping'in §5'teki üç kuralı
  ihlal etmediğinin doğrulanması.
- **frontend-agent:** §4'teki iki metnin `live-chat-widget.tsx`'e yerleşimi (sağlık uyarısı +
  KVKK aydınlatma linki), ikisi de **kalıcı görünür**, `sessionStorage`/`localStorage` ile
  gizlenmez.
- **security-agent:** §5'in mapper/DTO seviyesinde gerçekten uygulandığının grep ile doğrulanması
  (zaten [ASD] §4.6 madde 6 kapsamında).
- **observability-agent:** §7'deki `support.session_viewed` audit action'ının log/alert
  pipeline'ına dahil edilmesi (uygulama kodu YAZMAZ, yalnızca izlemeyi kapsar).
- **documentation-agent:** `DATA_INVENTORY.md` varsa (proje genelinde henüz yok — [CNT]
  doctor-identity turunda da aynı tespit yapılmıştı, organizasyonel bir eksiklik) bu tablo
  (§1) oraya eklenmelidir; yoksa bu doküman kendisi referans kaynağı olarak kalır.

---

## Genel sonuç

| Konu | Durum |
|---|---|
| Veri envanteri (§1) | Tamamlandı — **yeni kolon YOK**, [ASD] §3.4 taslağı yeterli |
| Md.6 riski / rıza yaklaşımı (§2) | **Rıza yerine minimizasyon** — gerekçeli, ONAY |
| Saklama süreleri (§3) | **30 gün (IP/UA redaksiyon) + 180 gün (`closedAt` bazlı, `CLOSED` silme) + 365 gün (YENİ, kapatılmamış oturum güvenlik ağı)** |
| Widget uyarı metni (§4) | **KESİN TR metin verildi** + YENİ aydınlatma bildirimi eklendi |
| Personel e-postası sızması (§5) | **TEYİT EDİLDİ — kontrat zaten doğru** |
| `DELETE` ucu (§6) | **ONAY — hard delete, veri sahibi hakkının doğru karşılığı**; ziyaretçi öz-hizmeti YOK (ADMIN manuel, mevcut emsalle tutarlı) |
| Görüntüleme audit'i (§7) | **YENİ, bağlayıcı gereklilik** — [ASD]'de yoktu, bu turda eklendi |
| Üçüncü taraf/yurt dışı (§8) | Kapsam dışı, ama `crisp`/`tawkto` etkinleştirilirse ayrı tur gerektiği işaretlendi |

**BLOKLAYICI madde: YOK.** db-agent M3 migration'a, backend-agent modül implementasyonuna
başlayabilir; yalnızca §3 (retention), §4 (widget metni) ve §7 (audit) bu dokümana göre
uygulanmalıdır.

**Hukuki tavsiye notu (tekrar):** Bu doküman genel KVKK/GDPR prensiplerinin teknik gereksinime
çevrilmiş hâlidir, hukuki tavsiye değildir. Saklama sürelerinin (özellikle sağlık bağlamlı bir
destek kanalı için), aydınlatma bildiriminin nihai hukuki içeriğinin ve md.11 başvuru
prosedürünün nihai onayı için **gerçek bir hukuk danışmanına başvurulması ZORUNLUDUR.**
