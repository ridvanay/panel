# AI İş 3 — HIZLI SÜRÜM Raporu: hasta koordinatörüyle online görüşme rezervasyonu (2026-11-03 sabahı)

Dal: **`feat/ai3-coordinator-booking-nov03`**. Bu dal AJ dalının (`feat/aj-fixes-nov02`, `02b1dce`) üzerine kurulu ve AG İş 3'ün WIP dalını (`feat/ag-meetings-nov02`, merge commit `e4d00a0`) içeriyor. **Önce AJ, sonra bu dal** master'a alınmalı. Push yapılmadı.

**Kırmızı çizgiler korundu:**
- `consultation-room.tsx`, `room/*`, `lib/livekit.ts` ve `telehealth.livekit.routes.ts` değişmedi; `git diff a594b39..HEAD` bu dosyalarda boş (güvenlik incelemesi doğruladı).
- Compose, Dockerfile, Nginx, `.env`, LiveKit sunucu ayarları ve `docs/legal/` değişmedi.
- Yeni npm paketi yok. Migration'lar yalnızca ekleme yapıyor. Ödeme ve doktor randevu oluşturma kuralları değişmedi.

## 1. Ne yapıldı (kapsam)

1. **Ziyaretçi rezervasyonu `/{lang}/book-consultation?service=<slug>`** (ya da `?package=`). Adımlar: Hizmet → Tarih ve saat → Bilgiler ve rıza → Özet/onay → Başarı (`SVC-00012`).
   - Eski doktor online randevu ekranının **takvimi, saat ızgarası (sabah/öğleden sonra), saat dilimi bandı, 12/24 saat tercihi, "Earliest available" bandı, adım çubuğu, çift saat özeti ve "Add to calendar" bileşenleri birebir aynı bileşenlerle** kullanıldı.
   - Doktor adı, unvanı, avatarı ve ücreti hiçbir yerde yok. Bunların yerine "Patient Coordinator", hizmet adı, "Free of charge" ve "30-minute video consultation with a patient coordinator" var.
   - 8 dil ve RTL destekleniyor. Sayfa `noindex`.
2. **Tek genel masa.** Admin, Hizmet Masası ekranından şunları yönetir: koordinatörler (EDITOR/MANAGER personel, doktor profili olmayan), haftalık çalışma saatleri ve tatil günleri.
   - Slotlar 30 dk; en erken 2 saat sonrası, en fazla 30 gün ileri.
   - Koordinatör otomatik atanır. Öncelik sırası: dil uyumu → o gün en az görüşmesi olan → en uzun süredir atanmamış olan → rastgele.
3. **Ödeme yok.**
   - Hastaya giden e-postalar (8 dil, aracı kuruluş footer'ı, konu satırında hizmet adı yok): onay (katılım ve yönetim bağlantısı), 24 saat hatırlatması (bağlantısız), 60 dk hatırlatması (yeni katılım bağlantısı), iptal ve saat değişikliği.
   - Admin bildirimi AG altyapısıyla gider ve kişisel veri içermez. Koordinatöre de atama e-postası gider.
   - Hasta, yönetim bağlantısıyla iptal ve saat değişikliği yapabilir.
4. **Görüşme AG `meet_` odasında yapılır.** Koordinatör ev sahibi; görünen adı "Patient Coordinator · Ayşe K.", unvan yok. Hasta misafir olarak `/meet/join#mg_…` bağlantısıyla girer.
   - Kayıt yok. Ekran paylaşımı yalnızca koordinatörde.
   - Oda en fazla 3 kişilik. Oda başlığı sabit: "WM Health online consultation".
5. **Koordinatör paneli** (`/admin/my-consultations`):
   - "Bugünkü görüşmelerim" ve "Yaklaşanlar" listeleri.
   - "Görüşmeye katıl" düğmesi, başlangıçtan 15 dk önce etkinleşir.
   - Talep mesajı ancak hesabında 2FA açıksa görülür ve her görüntüleme audit'e yazılır.
6. **Düğmeler.** Anahtar açıkken header, mega menü, hizmet kartları, bölüm sayfası, Find your treatment sonucu, ana sayfa koordinatör bandı ve paket sayfasındaki "Book a consultation" düğmeleri `/book-consultation`'a gider.
   - İkincil seçenek "Request a call back", talep formuna gider.
   - Anahtar kapalıyken her şey AJ'deki hâlindedir (`/request`).
7. **AG İş 3 (harici toplantı)** genel özelliği `EXTERNAL_MEETINGS_ENABLED=false` sabitiyle kapalı. Admin "Toplantılar" menüsü, toplantı oluşturma uçları ve meeting-host yetkisi görünmüyor ve kayıtlı değil.
   - Yalnızca misafir katılım uçları ve oda süpürücüsü açık.
   - AG İş 3'ün kalanı (3. adım) bu sabiti açacak.

**Sonraya bırakılanlar:**
- birden fazla masa ve hizmet→masa eşlemesi;
- koordinator bazında saat ve izin;
- hesaplı hasta için "My account" sekmesi;
- otomatik sonuç işaretleme;
- admin ekranından saat değiştirme ve yeniden atama (hasta kendi bağlantısıyla değiştirebiliyor);
- harici toplantı misafir yönetimi;
- raporlama, ücretli seçenek, e-posta doğrulaması (OTP) ve CAPTCHA.

## 2. Varsayımlar (belirsiz noktalarda verilen kararlar)

- **Sihirbaz iskeleti yeniden yazıldı.** Eski `booking-wizard.tsx`, `booking-intake-step.tsx` ve `booking-summary-card.tsx` doktora, booking kaydına ve ödemeye bağlı olduğu için doğrudan kullanılamadı. Aynı ızgara (takvim 4, saatler 5, özet 3 kolon), aynı kart yüzeyi ve aynı özet paneli düzeniyle yeni bir sihirbaz yazıldı. Takvim, saat, stepper ve saat dilimi bileşenleri **aynı bileşenler**; doktor akışı için bunlara yalnızca geriye uyumlu opsiyonel prop'lar eklendi (`fetchSlots`, `singleSelect`, `stringOverrides`, `latinDigits`).
- **"Takvim/gün" ve "saat" tek adımda.** Eski ekrandaki gibi tek "Date & time" adımında birleştirildi.
- **Arapçada Latin rakam.** Takvim zaten Latin rakamlıydı; aynı ekranda iki rakam sistemi görünmesin diye saatler ve özet de Latin rakamla gösteriliyor (yalnızca bu sayfada).
- **Hasta yalnızca e-posta bağlantılarıyla yönetir.** Misafire hesap açılmaz (tasarım S6).
- **Personel e-postası hizmet adını içerir.** Tasarım §8 gereği; hasta e-postasında hizmet adı yok. Güvenlik incelemesi bunu "kabul edilen karar" olarak not etti.
- **Hizmet adımında tüm aktif hizmetler seçilebilir.** Tek masa olduğu için hizmete göre masa ayrımı yok.
- **Misafir bekleme metni davranışla uyumlu.** Metin: "The room opens when your coordinator joins". Odaya kimin gireceğini koordinatör tek tek onaylamıyor; katılım bağlantısı kişiseldir.

## 3. Commit'ler

| Commit | Açıklama |
|---|---|
| `e4d00a0` | merge: AG İş 3 WIP (harici toplantı altyapısı) |
| `635ee9e` | docs: tasarım raporuna §15 (eski arayüzün yeniden kullanımı, süreye etkisi, hızlı sürüm kapsamı) |
| `76371c4` | şema + migration (ServiceDesk, saatler, tatiller, CoordinatorProfile, ServiceConsultation) |
| `19ace9c` | AG genel özelliği bayrakla kapalı; misafir preflight `purpose`/`hostName`; misafir adı taklit koruması |
| `197e3f8` | frontend bayrağı; AG admin/doktor toplantı ekranları gizli |
| `94a177f` | admin istemcisi, `isServiceCoordinator`, sidebar |
| `0f2b5b5` | admin Hizmet Masası ekranları |
| `1887eaa` | koordinatör paneli + katılım odası |
| `c8bd15f` | ziyaretçi rezervasyon sihirbazı, yönetim sayfası, 9 dil sözlük |
| `903f0ff` | misafir ekranı amaç metinleri |
| `f37cda4` | "Book a consultation" yönlendirmeleri; `/request` → "Request a call back" |
| `f31e89c` | frontend testleri |
| `6e6ece2` | backend: rezervasyon, yönetim bağlantısı, koordinatör/admin uçları, hatırlatmalar, e-postalar, bildirimler |
| `8dd1c11` | `setup-service-desk.ts` script'i + OpenAPI |
| `f8b337a` | backend testleri |
| `bf0a0a8` | tema alınamazsa varsayılan tema |
| `f41c888` | AG preflight testi |
| `75f9a7f` | güvenlik inceleme bulguları |
| `261d1c4` | e2e + ekran görüntüleri + eski ekranla yan yana |
| `b8b7099` | `/auth/me`'de koordinatör bayrağı (e2e bulgusu) |
| `fd2aa2e` | arayüz bulguları (yeniden gönder düğmesi, AR rakam ve sıra, erişilebilir ad, tekrar liste, hashchange, Türkçe başlık, bekleme metni) |

## 4. Migration'lar (yalnızca ekleme)

1. `20261115090000_external_meetings` (AG İş 3): `external_meetings` ve `external_meeting_guests` tabloları, kullanıcıda meeting-host alanları.
2. `20261117090000_service_consultations`:
   - `CREATE TYPE "ServiceConsultationStatus"`;
   - `ALTER TABLE site_settings ADD COLUMN "serviceBookingEnabled" BOOLEAN NOT NULL DEFAULT false`;
   - yeni tablolar: `service_desks` (tekil satır `id='main'`), `service_desk_hours`, `service_desk_closures`, `coordinator_profiles` ve `service_consultations`;
   - indeksler ve foreign key'ler;
   - elle eklenen SQL: kısmi tekil indeks `(coordinatorId, startsAt) WHERE status IN ('SCHEDULED','PENDING_PAYMENT')` ve `CHECK` kısıtları.

Not: AJ'deki `20261116090000_aj_contact_channel` migration'ı numara sırasında bu ikisinin arasına düşer. `prisma migrate deploy`, henüz uygulanmamış tüm migration'ları uygular; AJ önce canlıya alındıysa 20261115 sonradan sorunsuz uygulanır.

## 5. Güvenlik ve KVKK incelemesi

**Canlıya engel bulgu yok.** Orta ve düşük önemdeki bulgular düzeltildi (`75f9a7f`, `fd2aa2e`):
- **Altyapı kapısı:** telehealth modülü veya LiveKit kapalıyken rezervasyon kapalı.
- **Oran sınırı:** IPv6 adresleri /64 bloğu olarak sayılıyor. Saatte 20'yi aşan rezervasyonda adminlere uyarı gidiyor. Hastanın onay e-postası site genelindeki e-posta tavanından muaf.
- **E-posta hatası:** onay e-postası gönderilemezse kişisel veri içermeyen admin uyarısı gidiyor. Admin görüşme detayında "Bağlantıları yeniden gönder" düğmesi var; yeni katılım ve yönetim bağlantısı üretir, eskiler geçersiz olur.
- **Koordinatör uygunluğu:** yalnızca EDITOR/MANAGER koordinatör olabilir; ADMIN koordinatör sayılmaz ve odaya giremez.
- **Ad taklidi:** misafir adında "coordinator", "support", "admin", "wm health" gibi ifadeler reddediliyor. Kontrol NFKC normalizasyonu ve Kiril/Yunan benzer harf eşlemesiyle yapılıyor.

**Doğrulananlar:**
- Belirteçler 256 bit; veritabanında yalnızca SHA-256 özeti tutuluyor; bağlantıda `#` parçasında taşınıyor; geçersizse tek tip 404.
- Misafir token'ında ekran paylaşımı, `roomAdmin` ve `roomRecord` yok.
- Başkasının kaydı 404 döner; EDITOR admin masa uçlarına 403 alır; anahtarı yalnızca ADMIN değiştirebilir.
- Kişisel veri yalnızca `ConsultationRequest` ve `CrmLead`'de. Audit kayıtlarında, admin bildiriminde ve e-posta konusunda kişisel veri yok.
- Sağlık verisi rızası sunucuda zorlanıyor. Rıza sürümü sunucuda sabit: `service-consultation-v1`.

**Hukuk kontrol listesine gidecekler** (`docs/legal/` bu turda değişmedi):
1. `service-consultation-v1` rıza metinleri (8 dil): iletişim izni, mesaj için sağlık verisi açık rızası, "koordinatörle ücretsiz görüntülü ön görüşme" ifadesi, tıbbi muayene olmadığı, kayıt tutulmadığı.
2. Aydınlatma metnine yeni amaç: "koordinatörle görüntülü ön görüşme". İşlenen veri: ad, e-posta, telefon, ülke, dil, tercüman ihtiyacı, görüşme zamanı, IP/UA. Saklama süreleri: IP/UA 30 gün, mesaj 365 gün, lead süresi boyunca diğerleri, misafir adı 90 gün.
3. Lead anonimleştirildikten sonra `ServiceConsultation` satırında kimliksiz olarak hizmet adı, tercüman dili ve saat dilimi kalır; bu, saklama politikasına yazılmalı.
4. Görüşme LiveKit altyapısında işlenir ve misafir adı odaya gider; aydınlatma metninde belirtilmeli.
5. Başkası adına yapılan rezervasyon (yanlış kişiye bildirim riski).

## 6. Testler

- **Backend tam süit (sıralı, tüm düzeltmelerden sonra):** 3190 geçti, 15 atlandı. Düşen 2 dosya: `telehealth-demo-payment` (önceden bilinen) ve `telehealth-livekit` (test öncesi DB sıfırlamada anlık deadlock, AJ turunda da görüldü; tek başına 19/19 geçti). Yeni testler: `service-consultations-booking` (30), `-coordinator` (12), `-security`, `service-desk-admin` (8), birim `service-consultations` (17), `external-meetings-flag` (3) ve diğerleri.
- **Frontend tam süit (sıralı, tüm düzeltmelerden sonra):** 2526 geçti, 1 düştü (`featured-doctors-block`, önceden bilinen). Eski doktor randevu bileşenlerinin testleri (`availability-calendar`, `dual-time-display`, `doctor-availability-display`, `booking-wizard-*`) yeşil.
- **E2E** `tests/e2e/ai3-service-booking.spec.ts` (headless, `--workers=1`, `saas_e2e`): **11/11 geçti** (son koşu, tüm düzeltmelerden sonra). Kapsam:
  - admin ekranları;
  - ziyaretçinin uçtan uca rezervasyonu;
  - aynı slota ikinci istekte 409;
  - koordinatör bayrağı (`/users/me` ve `/auth/me`);
  - "Görüşmelerim", katılım penceresi ve 2FA'lı mesaj;
  - yönetim bağlantısı: saat değişikliği ve iptal (slot yeniden açılıyor);
  - misafir sayfası amaç metinleri;
  - anahtar kapalıyken `/request`'e yönlendirme;
  - Find your treatment düğmeleri.

  Her adımda Türkçe harf, doktor ifadesi ve yatay taşma için otomatik ölçüm yapıldı; sıfır bulgu çıktı.
- **Yerelde doğrulanamayanlar:** LiveKit'e gerçek oda bağlantısı (yerelde LiveKit adımı doğrulanmadı) ve e-postanın gerçekten teslimi. E-posta içerikleri ve konu satırları backend testlerinde ve snapshot'larda doğrulandı.
- **Kararsız test:** bir koşuda yönetim sayfasının ikinci `goto` adımı zaman aşımına düştü (dev sunucu derleme gecikmesi şüphesi). Sonraki 4 koşuda geçti.
- **Typecheck ve lint:** yeni hata yok. Kalanlar önceden var olan `.next/types` ve bilinen test dosyalarındaki hatalar.

## 7. Ekran görüntüleri — `docs/prompts/2026-11-03-AI3-ekran/`

- **Ziyaretçi (EN ve AR; 1440 ve 390):** `01` hizmet, `02` takvim ve saat, `03` bilgiler, `04` özet, `05` başarı, `06–08` yönetim (bilgi, saat değiştirme, iptal onayı), `09–11` misafir (oda öncesi, amaç metni, bekleme).
- **Admin ve koordinatör:** `20` masa ayarları, saatler ve tatil günleri; `21` koordinatörler; `22–23` görüşmeler ve detay; `24–26` "Görüşmelerim", detay ve 2FA uyarısı.
- **Eski ekranla yan yana:** `yan-yana-takvim.png`, `yan-yana-bilgiler.png`, `yan-yana-ozet.png` (1440) ve `-390` sürümleri. Eski sihirbazın görüntüsü için ziyaretçiye kapalı rota **yalnızca yerelde ve geçici olarak** açıldı; görüntü alındıktan sonra geri alındı (`git status` temiz, commit'e girmedi).
  - Görsel dil birebir aynı: ay ızgarası, sabah/öğleden sonra saat grupları, seçili saat vurgusu, "Earliest available" bandı, saat dilimi bandı ve sağdaki özet kartı.
  - Farklar: doktor avatarı, adı ve "TRY 450.00" yerine "Patient Coordinator", hizmet adı ve "Free of charge" var. Eski ekranda 5 adım (doktor, tarih, kimlik, belgeler, ödeme) vardı, yenisinde 4. Kimlik numarası ve doğum tarihi istenmiyor (veri minimizasyonu).
  - Eski akışın ödeme ve belge adımlarının yeni akışta karşılığı yok.
- **Not:** e2e veritabanında telehealth teması teal olduğu için görüntülerde düğmeler teal. Canlıda Tele-Sağlık teması marka mavisine çekilince (§9, adım 1) rezervasyon sayfası da `#2951a0` olur. AR görüntüleri, rakam sistemi ve sıra düzeltmesinden (`fd2aa2e`) önce alındı.

## 8. Canlıya alma — adım adım (kopyalanabilir)

**Ön koşul:** AJ dalı canlıya alınmış olmalı (`docs/prompts/2026-11-02-AJ-RAPOR.md` §10). Sunucuda, depo kökünde çalıştırın.

```bash
# 0) Yerelde: AJ zaten master'daysa bu dalı birleştirip gönderin (siz)
git checkout master && git merge --no-ff feat/ai3-coordinator-booking-nov03 && git push
# Sunucuda:
git pull

# 1) Değişkenler
DB_URL=$(docker compose exec -T backend printenv DATABASE_URL | tr -d '\r')
NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' $(docker compose ps -q db))
RUN() { docker run --rm --network "$NET" -v "$PWD/backend:/app" -w /app -e DATABASE_URL="$DB_URL" \
  node:20-alpine sh -c "apk add --no-cache openssl >/dev/null && npm ci --silent && npx prisma generate >/dev/null && npx tsx $*"; }

# 2) Migration'lar (yalnızca ekleme: external_meetings + service_consultations)
docker run --rm --network "$NET" -v "$PWD/backend/prisma:/app/prisma" -w /app -e DATABASE_URL="$DB_URL" \
  node:20-alpine sh -c "apk add --no-cache openssl >/dev/null && npx --yes prisma@5.22.0 migrate deploy"

# 3) Uygulamayı yeniden kur (compose/Nginx/LiveKit ayarı DEĞİŞMEZ)
docker compose up -d --build --no-deps backend frontend

# 4) Kontrol: rezervasyon anahtarı varsayılan KAPALI → site düğmeleri hâlâ /request'e gider
curl -s https://<site>/api/v1/service-consultations/config
#   beklenen: {"success":true,"data":{"enabled":false,...}}

# 5) (İsteğe bağlı, panel yerine) masa kurulum script'i — önce kuru
RUN scripts/setup-service-desk.ts --hours="1-5 09:00-17:00" --coordinator=<koordinator-eposta> --display-name="Ayşe K." --languages=en,ar
RUN scripts/setup-service-desk.ts --hours="1-5 09:00-17:00" --coordinator=<koordinator-eposta> --display-name="Ayşe K." --languages=en,ar \
  --confirm=setup-service-desk --operator="Ad Soyad" --i-know-this-is-prod
#   Anahtarı açmak için aynı komuta --enable ekleyin (panelden açmak daha güvenli: koşulları kontrol eder).

# 6) Duman testi
docker compose logs --tail=100 backend | grep -i -E "service|meeting|error"
```

**Geri alma (kod değil, özellik):** Admin → Hizmet Masası → "Online görüşme rezervasyonu" anahtarını kapatın. Tüm düğmeler talep formuna döner; mevcut görüşmeler ve bağlantıları çalışmaya devam eder.

**Canlıda gerekenler:** telehealth modülü açık ve LiveKit yapılandırılmış olmalı. Değilse rezervasyon kendiliğinden kapalı kalır (`enabled:false`).

## 9. Panelden yapmanız gerekenler (sırayla)

1. **Tele-Sağlık → Ayarlar → Tema:** `primaryColor = #2951a0`, `calendarActiveBg = #2951a0`, `accentColor = #4ab9e1`. Rezervasyon sayfası eski ekran gibi bu temayı kullanır; değiştirilmezse teal görünür.
2. **Kullanıcılar:** koordinatör olacak kişiler için **EDITOR** rolünde, aktif ve doktor profili olmayan hesaplar açın.
3. **Hizmet Masası → Koordinatörler:**
   - Adaydan "Koordinatör yap"a tıklayın.
   - Görünen adı kontrol edin (ör. "Ayşe K."; unvan yazmayın).
   - Konuştuğu dilleri işaretleyin.
4. **Hizmet Masası → Masa ayarları:**
   - Süre 30 dk, en erken rezervasyon 2 saat, ufuk 30 gün, saat dilimi `Europe/Istanbul`. "Ayarları kaydet".
5. **Haftalık çalışma saatleri:** ör. Pzt–Cum 09:00–17:00. "Çalışma saatlerini kaydet".
6. **Tatil günleri:** resmî tatilleri ekleyin. O güne planlı görüşme varsa sistem uyarır.
7. **"Online görüşme rezervasyonu" anahtarını açın** (yalnızca ADMIN). Koordinatör veya çalışma saati eksikse anahtar açılmaz ve neyin eksik olduğunu yazar.
8. **Koordinatörler kendi hesaplarıyla girer:**
   - "Görüşmelerim" menüsünü görürler.
   - Talep mesajını görmek için **Güvenlik → İki adımlı doğrulama**'yı açmaları gerekir.
   - "Görüşmeye katıl" düğmesi başlangıçtan 15 dk önce etkinleşir.
9. **Randevu bildirimi alıcıları** ayarı (AG İş 2) doluysa yeni rezervasyon, iptal ve saat değişikliği bildirimleri buraya gelir.
10. **Test rezervasyonu:** canlıda kendi e-postanızla bir rezervasyon yapın. Onay e-postasındaki "Join" ve "Manage" bağlantılarını deneyin, ardından yönetim sayfasından iptal edin.

## 10. Bilinen sınırlar ve sonraki adım

- E-posta doğrulaması ve CAPTCHA yok. Koruma şunlarla sağlanıyor: oran sınırları, IP başına günlük sınır, e-posta başına en fazla 2 gelecek görüşme, honeypot ve saatlik admin uyarısı. Kötüye kullanım görülürse OTP veya Turnstile eklenmeli.
- 7 dilin çevirisi (de, fr, es, ar, ru, ro, sr-latn) tarafımdan üretildi; ana dil kontrolünden geçmedi.
- **Sıradaki adım:** 3. adım olan AG İş 3'ün kalanı (harici toplantı ekranları). Ayrı dalda yapılacak ve `EXTERNAL_MEETINGS_ENABLED` sabitini açacak.
