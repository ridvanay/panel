# Security Review — Demo Ödeme Runtime Toggle (`demoPaymentsEnabled`) — Çakışma Çözümü

> **Denetçi:** security-agent
> **Tetikleyici:** Orkestratör (architect rolünde) tarafından eskale edilen çakışma — kullanıcı
> isteği ("admin panelden DB üzerinden runtime aç/kapa") ile mevcut, bilinçli, üç katmanlı
> boot-time fail-closed koruması (`backend/src/config/env.ts` satır ~199-241,
> `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 1 §1.3) arasındaki potansiyel
> çelişki.
> **Kapsam:** `backend/src/config/env.ts` (`ENABLE_DEMO_PAYMENTS`/`isDemoPaymentsEnabled`),
> `backend/src/modules/telehealth/telehealth.demo-payment.routes.ts`,
> `backend/src/modules/settings/settings.routes.ts` (`PATCH /admin/settings`),
> `backend/src/lib/site-roles.ts`, `frontend/src/lib/env.ts` (`DEMO_PAYMENTS_ENABLED`),
> `frontend/src/components/site/telehealth/booking-payment-step.tsx`.
> **Sonuç: KARAR VERİLDİ — mevcut env-seviyesi fail-closed koruma DOKUNULMADAN, yeni bir DB
> bayrağı bunun ÜZERİNE ek/kısıtlayıcı bir AND-gate olarak eklenir.** Kod YAZILMADI — bu doküman
> backend-agent/architect için bağlayıcı bir uygulama talimatıdır.

---

## Madde 1 — Mevcut boot-time fail-closed korumasına (env.ts §1-3) DOKUNULMAYACAK

**KARAR: Teyit edildi — env.ts §1-3 (Zod parse → `isProd && ENABLE_DEMO_PAYMENTS` boot-time
`process.exit(1)` → `isDemoPaymentsEnabled = NODE_ENV !== "production" && ENABLE_DEMO_PAYMENTS`)
AYNEN KALIR. Hiçbir satırı zayıflatılmaz/bypass edilebilir hale getirilmez.**

Değerlendirilen ve AÇIKÇA REDDEDİLEN seçenek: *"DB bayrağı `true` iken demo ödeme prod'da bile
işleyebilsin, DB kontrolü env kontrolünün YERİNE geçsin."*

**Neden reddedildi:**
- Bu, env.ts'teki yorumun ("yanlış `.env` kopyasının prod'a fark edilmeden gitmesi riski")
  tam olarak önlemeye çalıştığı senaryoyu, farklı bir yoldan (yanlış bir DB satırı/yanlışlıkla
  tıklanan bir toggle) yeniden AÇAR. Env değişkeni yalnızca deploy zamanında, DevOps disiplini
  altında değişir; bir DB bayrağı ise **çalışan bir üretim sisteminde, tek bir admin tıklamasıyla,
  anında ve geri alınabilir şekilde** değişebilir — bu, "gerçek tahsilat atlanabilir" riskini
  env değişkeninden ÇOK daha erişilebilir/kazayla tetiklenebilir bir yüzeye taşır.
- Boot-time koruma **gürültülü hata** (fail-closed, `process.exit(1)`) felsefesini seçmiş; bir DB
  bayrağının bunu bypass edebilmesi bu felsefeyi **sessiz bir arka kapıya** çevirir — tutarsız.
- Kullanıcının gerçek ihtiyacı ("süper admin dilediği zaman kapatabilsin") env korumasını
  BYPASS etmeyi gerektirmiyor; sadece env'in ZATEN izin verdiği ortamlarda (dev/test/demo/
  staging, `ENABLE_DEMO_PAYMENTS=true`) ek bir kontrol istiyor. Madde 2'deki tasarım bunu,
  env korumasını bozmadan karşılar.

---

## Madde 2 — Önerilen tasarım: DB bayrağı, env hesabının ÜZERİNE EK bir AND-gate

**KARAR: Orkestratörün önerdiği tasarım ONAYLANDI, ek netleştirmelerle:**

```
isDemoPaymentsEnabled        (env.ts, DEĞİŞMEZ — export olarak AYNEN kalır)
isDemoPaymentsEnabledFinal = isDemoPaymentsEnabled && dbFlag   (YENİ, "VE", "VEYA" DEĞİL)
```

- `env.ts`'teki `isDemoPaymentsEnabled` export'u **AYNEN KALIR** — hiçbir mevcut tüketicisi
  (varsa) kırılmaz. Yeni bir isim önerilir: **`isDemoPaymentsEnabledFinal`** hesaplaması,
  DB'den okunan `SiteSettings.demoPaymentsEnabled` değerine ihtiyaç duyduğu için `env.ts`
  İÇİNDE hesaplanamaz (env.ts DB'ye erişmez, bu bilinçli bir katman ayrımıdır) — bu AND-gate
  `telehealth.demo-payment.routes.ts` handler'ının İÇİNDE, request-time'da hesaplanmalıdır
  (aşağıya bkz.).
- **DB alanı:** Prisma `SiteSettings` modeline `demoPaymentsEnabled Boolean @default(true)`
  (db-agent). TS tarafında `settings.routes.ts::DEFAULTS`'a `demoPaymentsEnabled: true`
  eklenmesi ZORUNLU (mevcut `DEFAULTS` deseniyle tutarlı — satır 18-34).
  **İsimlendirme notu:** kullanıcının yazdığı `demo_payments_enabled` (snake_case) betimseldir;
  gerçek alan adı projenin camelCase konvansiyonuna uyar: `demoPaymentsEnabled`.
- **Varsayılan `true` olmasının güvenlik etkisi YOK:** DB satırı prod ortamında da `true`
  olabilir (tek global `SiteSettings` satırı, ortam bazlı değil) — ama bu ZARARSIZDIR, çünkü
  nihai bayrak yine de `isDemoPaymentsEnabled (env)` ile AND'lenir ve env prod'da HER ZAMAN
  `false`'tur (Madde 1'deki boot-time koruma sayesinde prod'da `true` olması zaten imkânsız).
  Yani DB'nin varsayılanı `true` olması sadece **dev/test'te kullanıcının istediği "sürekli
  aktif" davranışı** sağlar; prod'da hiçbir etkisi yoktur.
- **"Anında, TÜM kullanıcılardan" gereksinimi — önemli uygulama detayı:** `dbFlag` **process
  içi bellekte cache'lenmemelidir** (env.ts'teki `isDemoPaymentsEnabled` gibi modül-seviyesi bir
  sabit OLARAK OKUNMAMALI). Handler her istekte `app.prisma.siteSettings.findUnique(...)`
  ile (veya zaten okunuyorsa aynı satırdan) TAZE okumalıdır — aksi halde: (a) çok-instance bir
  deploy'da (örn. birden fazla backend container'ı) yalnızca istek düşen instance güncellenir,
  diğerleri eski değeri cache'lemiş kalır; (b) tek instance'ta bile process yeniden başlamadan
  değişikliği görmez. Bu proje genelinde zaten `readSettings`/`GET /admin/settings` gibi
  uçların hepsi DB'yi her istekte taze okuyor (satır 51-54) — YENİ bir cache katmanı İCAT
  EDİLMEMELİ, aynı "her istekte taze Prisma okuması" deseni izlenmeli.

---

## Madde 3 — `PATCH /api/admin/settings`: rol, rate-limit, audit

**KARAR: Kullanıcının "süper admin" dediği rol = `ROLES_ADMIN` (`["ADMIN"]`,
`backend/src/lib/site-roles.ts` satır 9). Projede `SiteRole.ADMIN`'den daha yüksek bir rol
YOK — bu doğrudan doğrulandı (`site-roles.ts`, `RBAC 5-tier` mimarisi 5 rolün en üstü ADMIN'dir).
Ek/yeni bir "super admin" rolü İCAT EDİLMEYECEK.**

- **Uç/uygulama yeri:** Kullanıcının talebi zaten mevcut `PATCH /admin/settings`'in
  (`backend/src/modules/settings/settings.routes.ts` satır 102-140) doğal bir uzantısıdır — bu
  uç **hâlihazırda** `authenticate` + `requirePanelAccess()` + `preHandler:
  requireSiteRole(...ROLES_ADMIN)` zinciriyle korunuyor (satır 95-96, 105). **Yeni bir endpoint
  YAZILMAYACAK** — `demoPaymentsEnabled`, `UpdateSiteSettingsRequestSchema`'ya (backend-agent,
  `settings.schemas.ts`) diğer opsiyonel alanlar (`shippingFlatFeeCents` vb.) ile AYNI şekilde
  eklenecek, `SiteSettingsSchema`'ya da eklenecek (aşağıda Madde 4'te public görünürlük ayrıca
  ele alınıyor). Bu, RBAC/rate-limit/audit'in HİÇBİRİNİN yeniden yazılmasını gerektirmez.
- **Rate limit:** Bu uçta şu an özel bir `config.rateLimit` YOK — global `RATE_LIMIT_MAX`
  (300/dk, `env.ts` satır 102-108) geçerli. Bu **yeterlidir ve DEĞİŞTİRİLMEMELİDİR**: uç zaten
  kimlik doğrulamalı + ADMIN-rolü gerektiriyor (brute-force hedefi değil, `login`/`2FA` sınıfı
  bir risk taşımıyor), ve `site-modules.routes.ts`'teki eşdeğer ADMIN-only toggle ucu
  (`PATCH .../toggle`, satır 45-48) da özel bir rate-limit taşımıyor — tutarlı.
- **Audit:** YENİ bir `action` adı İCAT EDİLMEYECEK. Mevcut `settings.update` (satır 128-136)
  zaten her `PATCH` çağrısında `metadata.changed: Object.keys(request.body)` logluyor — bu,
  `demoPaymentsEnabled` alanı gönderildiğinde OTOMATİK olarak audit'e "değişen alan" olarak
  girer, ek kod GEREKMİYOR. **Tek ek talep (backend-agent'a bağlayıcı öneri):** bu alanın
  ödeme-bütünlüğü açısından hassasiyeti nedeniyle (gerçek tahsilatın atlanabildiği bir yolu
  açıp/kapatıyor), `metadata`'ya salt alan adının yanına **yeni değeri de** açıkça yazılmalı:
  `metadata: { changed: Object.keys(request.body), ...(request.body.demoPaymentsEnabled !==
  undefined ? { demoPaymentsEnabled: request.body.demoPaymentsEnabled } : {}) }` (boolean,
  PII/sır DEĞİL — loglanması güvenlik logu disiplinine (kural 8) aykırı değil, aksine
  forensik/denetim değeri artırır: "kim, ne zaman, açtı mı kapattı mı" DB'den geriye dönük tek
  bakışta görülebilir olmalı).

---

## Madde 4 — Frontend build-time sabitten runtime DB kontrolüne geçiş — bilgi sızıntısı riski

**KARAR: Bilgi sızıntısı riski YOK (teyit edildi) — AMA mevcut build-time
dead-code-elimination katmanı KORUNMALI, yerine geçirilmemeli. Bu iki katman BİRBİRİNİN
YERİNE değil, ÜST ÜSTE (AND) çalışmalı.**

**Sızıntı riski değerlendirmesi:** Nihai bayrak (`isDemoPaymentsEnabledFinal`) prod'da
matematiksel olarak HER ZAMAN `false`tur (env tarafı prod'da asla `true` olamaz — Madde 1).
Bu boolean'ı herkese açık bir uçtan döndürmek prod'da hiçbir bilgi sızdırmaz (zaten sabit
`false`), dev/test'te de sızdırdığı tek bilgi "bu ortamda demo ödeme butonu görünür mü" —
bu ZATEN görünür bir UI durumudur (buton var/yok), gizli bir sır değildir. `siteTemplate`,
`shippingFlatFeeCents` gibi ZATEN public `GET /settings`'ten dönen alanlarla AYNI hassasiyet
sınıfı (hiçbiri sır değil). **Public API tasarımı:** `demoPaymentsEnabled` alanı public
`SiteSettingsSchema`/`toSiteSettingsDto`'ya (backend-agent, `mappers/index.ts` satır 405-419)
eklenirken, DB'deki HAM sütun değeri değil, **sunucunun zaten hesapladığı NİHAİ AND'li değer**
(`isDemoPaymentsEnabledFinal`) döndürülmeli — yani istemci hiçbir zaman env'i kendisi
hesaplamaz, sunucu tekliği garanti eder (istemci tarafı bir hataya/atlamaya karşı ek güvence).

**Ama build-time katmanı DEĞİŞTİRİLMEMELİ:** `frontend/src/lib/env.ts::DEMO_PAYMENTS_ENABLED`
(satır 31, `process.env.NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS === "true"` statik üye erişimi) ve
onun sağladığı **bundle'dan tamamen düşme** garantisi (`booking-payment-step.tsx` satır 26-27
yorumu) prod build'lerde demo-ödeme UI KODUNUN VARLIĞINI BİLE bundle'dan siler — bu, "sunucu
zaten `false` döner" güvencesinden BAĞIMSIZ, ekstra bir savunma katmanıdır (istemci tarafı
manipülasyona/tersine mühendisliğe karşı: prod bundle'ında bu kodun HİÇ olmaması, "kod var ama
her zaman false görünür" durumundan daha güçlüdür). Bu katman **runtime DB kontrolüyle
İKAME EDİLİRSE kaybedilir** — bu kabul edilemez bir gerileme olur.

**Nihai frontend tasarımı (backend-agent/frontend-agent'a bağlayıcı):**
```
kod bundle'a girer mi?     → DEMO_PAYMENTS_ENABLED (build-time, DEĞİŞMEDİ, tek başına
                              bunu kontrol eder — prod'da kod hâlâ hiç girmez)
buton render edilir mi?    → DEMO_PAYMENTS_ENABLED (build-time) && settings.demoPaymentsEnabled
                              (runtime, public GET /settings'ten — YENİ katman, "AND", "VEYA" DEĞİL)
```
Yani frontend'in bugünkü `{DEMO_PAYMENTS_ENABLED && (...)}` deseni (satır 152, 177) **AYNEN
KALIR**, sadece JSX'in kendi içindeki koşula EK bir `&& settings.demoPaymentsEnabled` eklenir —
build-time gate hiçbir zaman kaldırılmaz/gevşetilmez, sadece dev/test'te (zaten `true` olduğu
ortamlarda) İKİNCİ bir runtime kapı eklenir.

---

## Madde 5 — `403` mü `503` mü: KARAR = **403 (ForbiddenError)**, mevcut `404` katmanları AYNEN kalır

**KARAR: DB bayrağı kapalıyken (env-gate zaten AÇIK olduğu halde) demo-pay ucu `403` döner.
`PAYMENTS_NOT_CONFIGURED`/`LIVEKIT_NOT_CONFIGURED` desenindeki `503` BURAYA UYMUYOR — bu bir
"yapılandırma eksikliği" değil, kasıtlı bir admin kararıdır. Doğrudan bir precedent VAR:
`appearance.routes.ts` satır 283-284/323-324 — `CUSTOM_CODE_ENABLED=false` iken `PUT
/admin/appearance/custom-code/{css,js}` **`403 ForbiddenError`** ("Özel kod düzenleme bu
ortamda kapatılmıştır") döner, `503` DEĞİL.**

**Gerekçe (iki farklı hata sınıfının ayrımı, bu projede zaten tutarlı şekilde uygulanıyor):**
- **`503` ("yapılandırılmamış")** → bir 3. parti servisin/kimlik bilgisinin HİÇ tanımlanmadığı,
  "dürüst eksiklik" durumu (`STRIPE_SECRET_KEY` boş, `LIVEKIT_*` boş) — sistem bu özelliği
  sunmak İÇİN gereken malzemeye HİÇ sahip değil, geçici/altyapısal bir durum, "retry" semantiği
  taşır.
- **`403` ("kapatılmıştır")** → özellik TEKNİK OLARAK var/çalışabilir durumda, ama bir yetkili
  (admin/ops) onu KASITLI OLARAK kapatmış — `CUSTOM_CODE_ENABLED` bunun BİREBİR emsalidir.
  Demo ödeme DB bayrağı da tam bu sınıfa girer: env-gate zaten `true` (yani bu ortamda demo
  ödeme "yapılandırılmış" durumda), sadece ADMIN panelden bilinçli olarak kapatmış.

**Mevcut `404` katmanları DEĞİŞMEZ, DB-gate bunlardan AYRI, YENİ bir 4. katmandır:**
1. Register-time gizleme (`app.ts`, env-gate'e bağlı) — **DEĞİŞMEZ**. Env kapalıyken uç hiç
   register edilmez → `404`. DB bayrağı bu katmanı ETKİLEMEZ (register-time statiktir, DB
   runtime'da değişir — zaten mantıksal olarak register-time'a bağlanamaz).
2. Handler'ın ilk satırındaki `if (!isDemoPaymentsEnabled) throw new NotFoundError()`
   (`telehealth.demo-payment.routes.ts` satır 76-79) — **DEĞİŞMEZ, env-gate'e bağlı kalır**.
   Prod'da/env kapalıyken bu satır AYNEN `404` üretmeye devam eder — "varlığı sızdırılmaz"
   ilkesi (§1.3 madde 3 yorumu) bu katman için bozulmaz.
3. **YENİ 4. katman** — 2. katmandan HEMEN SONRA, booking'i DB'den okumadan ÖNCE eklenir:
   ```
   if (!dbFlag) throw new DemoPaymentsDisabledError();  // 403, YENİ hata sınıfı
   ```
   Bu noktaya ulaşıldığında env-gate ZATEN `true` olduğu kanıtlanmıştır (2. katman geçildi) —
   yani bu ortamda uçun varlığı zaten sızdırılmaya değer bir sır DEĞİLDİR (dev/test/demo/
   staging'de zaten bilinen bir özelliktir); bu yüzden `404` ile gizlemek yerine `403` ile
   "bu uç var ama şu an kapalı" dürüstçe söylenir — kullanıcının AÇIKÇA istediği davranışla
   ("endpoint 403 dönsün") ve proje precedent'ıyla (`CUSTOM_CODE_ENABLED`) birebir örtüşür.
- **Yeni hata sınıfı önerisi (backend-agent, `lib/errors.ts`):** `PaymentsNotConfiguredError`/
  `RecordingNotConfiguredError` desenine (satır 329-333) paralel, kendi machine-readable kodu
  olan dar bir alt sınıf: `DemoPaymentsDisabledError extends ApiError` →
  `super(403, "DEMO_PAYMENTS_DISABLED", "Demo ödeme bu ortamda admin tarafından kapatılmıştır.")`.
  Genel `ForbiddenError` (`code: "FORBIDDEN"`) YERİNE özel bir kod tercih edilir çünkü
  frontend'in bu SPESİFİK durumu (RBAC yetkisizliğinden AYRI) tanıyıp "Demo ödeme şu anda kapalı"
  gibi anlamlı bir mesaj göstermesi gerekir — `friendlyErrorMessage`/hata kodu eşlemesi
  frontend-agent'ın kapsamıdır.
- **`logAudit`/`app.log.warn` etkisi YOK:** Bu 403 durumunda `confirmBookingPayment`'a hiç
  ulaşılmıyor, dosyanın kendi yorumundaki "aktör anonim olabilir, `logAudit` çağrılmaz,
  `app.log.warn` kullanılır" kuralı (satır 54-55) yalnızca BAŞARILI demo ödeme için geçerlidir —
  403 reddi için ekstra bir loglama ZORUNLU DEĞİLDİR (rate-limit/RBAC 403'lerinde de proje
  genelinde ayrıca log tutulmuyor), ama backend-agent isterse `app.log.info` seviyesinde
  bilgilendirici bir satır ekleyebilir (engelleyici değil, öneri).

---

## Backend-agent'a iletilecek uygulama kontrol listesi (özet, bağlayıcı)

1. `prisma/schema.prisma` (db-agent): `SiteSettings.demoPaymentsEnabled Boolean @default(true)`.
2. `env.ts`: **HİÇBİR SATIR DEĞİŞMEZ** (Madde 1).
3. `settings.routes.ts`: `DEFAULTS.demoPaymentsEnabled = true`; `PATCH /` zaten `ROLES_ADMIN` +
   `settings.update` audit'i kullanıyor — sadece Madde 3'teki metadata zenginleştirmesi eklenir.
4. `settings.schemas.ts`: `UpdateSiteSettingsRequestSchema`/`SiteSettingsSchema`'ya
   `demoPaymentsEnabled: z.boolean()` (opsiyonel PATCH body'de, response'ta zorunlu) eklenir.
5. `mappers/index.ts::toSiteSettingsDto`: dönen değer HAM DB sütunu DEĞİL, `isDemoPaymentsEnabled
   (env) && row.demoPaymentsEnabled` NİHAİ hesabı olmalı (Madde 4).
6. `telehealth.demo-payment.routes.ts`: mevcut `if (!isDemoPaymentsEnabled) throw
   NotFoundError()` satırı DEĞİŞMEDEN kalır; hemen sonrasına Madde 5'teki 4. katman
   (`DemoPaymentsDisabledError`, 403) eklenir. DB okuması **cache'siz, her istekte taze**
   olmalı (Madde 2).
7. `lib/errors.ts`: `DemoPaymentsDisabledError` (403, `DEMO_PAYMENTS_DISABLED`) eklenir.
8. Frontend (frontend-agent, security-agent kapsamı DIŞI ama bağlayıcı talimat): `env.ts::
   DEMO_PAYMENTS_ENABLED` DEĞİŞMEZ; `booking-payment-step.tsx`'teki JSX koşuluna `&&
   settings.demoPaymentsEnabled` (public `GET /settings`'ten, runtime) eklenir (Madde 4).
9. Test (backend-agent/qa-agent): (a) env-gate açık + DB `true` → buton görünür + `demo-pay`
   200; (b) env-gate açık + DB `false` → `demo-pay` 403 `DEMO_PAYMENTS_DISABLED`; (c) env-gate
   kapalı (prod simülasyonu) + DB `true` → `demo-pay` YİNE `404` (DB'nin env'i bypass
   EDEMEDİĞİNİN regresyon testi — Madde 1'in en kritik doğrulaması); (d) `PATCH
   /admin/settings` ile `demoPaymentsEnabled` değişikliğinin `logAudit`'e `settings.update`
   olarak, yeni değerle, düştüğü doğrulanır.

---

## Sonuç

Çakışma çözüldü: kullanıcının "admin panelden runtime aç/kapa" ihtiyacı, env.ts'teki bilinçli
üç katmanlı fail-closed korumayı **bozmadan**, onun ÜZERİNE **kısıtlayıcı** (asla gevşetici
olmayan) bir AND-gate ile karşılanabilir ve karşılanmalıdır. Env-seviyesi koruma prod'da demo
ödemeyi HER KOŞULDA imkânsız kılmaya devam eder; DB bayrağı yalnızca env'in ZATEN izin verdiği
ortamlarda (dev/test/demo/staging) admin'e gerçek bir kapatma kontrolü verir. Frontend'de de
aynı felsefe: build-time bundle-elimination katmanı korunur, runtime DB kontrolü onun YERİNE
değil YANINA eklenir. `403 DEMO_PAYMENTS_DISABLED`, projenin `CUSTOM_CODE_ENABLED` precedent'ıyla
tutarlı, kullanıcının açıkça istediği davranıştır; mevcut `404` (varlık gizleme) katmanları
env-gate için aynen kalır.

---

## architect — NİHAİ ONAY (2026-09-15)

`.claude/CLAUDE.md` "Çakışma Çözümü" gereği ("Güvenlik ile hız/kolaylık çelişirse →
security-agent öncelikli, architect nihai onayı verir"):

**Madde 1-5'in TAMAMI ONAYLANDI, itiraz YOK.** Tasarım, mevcut bağlayıcı mimari kararı
(§1.3) zayıflatmıyor; `403 DEMO_PAYMENTS_DISABLED` seçimi `CUSTOM_CODE_ENABLED` emsaliyle
tutarlı; "yeni uç/rol icat etme" ve "cache'siz taze okuma" kısıtları aynen kabul edildi.

**Model/alan teyidi (architect):** `backend/prisma/schema.prisma` satır 1126'da **`SiteSettings`
modeli GERÇEKTEN VAR** (`@@map("site_settings")`, `id @default("singleton")`) ve `PATCH
/admin/settings`in arkasındaki model TAM OLARAK BUDUR (`settings.routes.ts::readSettings` →
`app.prisma.siteSettings`). Projede `SystemSettings`/`ModuleConfig` modeli **YOKTUR** (yalnızca
ilgisiz bir `SiteModule` modülü toggle tablosu vardır — demo ödeme bir "modül" değildir, oraya
konmaz). **Bağlayıcı alan adı: `SiteSettings.demoPaymentsEnabled Boolean @default(true)`.**
YENİ model/tablo AÇILMAZ.

### Ek Karar A (architect ilavesi) — `demoPaymentsSupported` (env seviyesi) alanı

Madde 4, DTO'nun NİHAİ (env&&db) değeri döndürmesini şart koşuyor; bu AYNEN geçerlidir. Ancak
tek başına bu, admin panelinde **toggle'ın üretimde "açıp kapanıyor" görünmesine** yol açar
(admin `true` gönderir, yanıt `false` döner). Çözüm, projenin KENDİ emsali: `SiteCustomCode.
customCodeEnabled` alanı (`openapi.yaml`) ortamın kill-switch durumunu ayrıca döndürür ve arayüz
`false` iken editörü devre dışı bırakıp nedenini açıklar. Aynısı uygulanır:
`SiteSettings.demoPaymentsSupported = isDemoPaymentsEnabled (SADECE env)`. Güvenlik etkisi yok
(üretimde sabit `false`, Madde 4'ün "bu boolean sır değildir" değerlendirmesiyle aynı sınıf) ve
env korumasına dokunmaz. `demoPaymentsSupported=false` iken PATCH isteği REDDEDİLMEZ (`422`
DEĞİL) — ham sütun yazılır ama nihai bayrak `false` kalır (fail-closed korunur).

### Ek Karar B (architect ilavesi) — `DEFAULTS` yolunda da AND uygulanmalı

`settings.routes.ts::readSettings`, satır YOKKEN mapper'ı ATLAYIP ham `DEFAULTS` döndürüyor
(satır 53). `DEFAULTS.demoPaymentsEnabled = true` eklenip AND uygulanmazsa, hiç `PATCH`
çağrılmamış bir üretim kurulumunda public `GET /settings` **`demoPaymentsEnabled: true`**
sızdırır (sözleşme ihlali). **Bağlayıcı:** AND hesabı hem `toSiteSettingsDto` hem de `DEFAULTS`
yolunda uygulanmalı — en temizi, AND'i tek bir yardımcıda toplayıp `readSettings`in dönüşünde
uygulamaktır. Kontrol listesi madde 5 bu şekilde okunmalıdır.

**Karar: Backend-agent'a devredilebilir (bu belge implementasyon talimatıdır). Eskalasyon
gerekmiyor — architect'in nihai onayına gerek görülmedi, çünkü önerilen tasarım kullanıcının
kendi önerisiyle (istekte açıkça belirttiği AND-gate tasarımı) örtüşüyor ve mevcut bağlayıcı
mimari kararı (env.ts §1-3) hiçbir şekilde zayıflatmıyor; yalnızca yeni hata sınıfı/audit
metadata detayları security-agent'ın kendi takdiriyle eklendi.**
