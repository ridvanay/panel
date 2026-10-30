# Paket AA: Görüşmeye tercüman katılımı (görüntü ve ses ile) (2026-10-30)

**Hızlı Mod geçerli.** Testler sıralı koşar. **Bütün cevaplarını ve raporunu Türkçe yaz.**

## Başlangıç
- Paket V canlıya alındıktan sonra `origin/master` üzerinden `feat/interpreter-oct30` dalını aç. Push etme.
- Mevcut **ADMIN kalite dinleyicisi (Paket C)** olduğu gibi kalır: sessiz, yayın yapmaz, bildirimli. Tercüman bundan **ayrı, yeni bir katılımcı rolüdür.** Dinleyici akışını değiştirme; yalnızca ortak kodu yeniden kullan.

## KIRMIZI ÇİZGİ ve bu paketin istisnası
- **Kullanıcı onaylı istisna (Paket C'deki gibi):** Bu paket yalnızca tercüman katılımı için şu dosyalarda **en küçük gerekli** değişikliği yapabilir:
  - `consultation-room.tsx`
  - `lib/livekit.ts` (yeni token fonksiyonu)
  - meeting-token uçları

  Mevcut hasta ve doktor akışı, kayıt/egress mantığı, erken katılım kuralları ve dinleyici akışı **değişmez.** Her değişikliği rapora "neden gerekli" notuyla tek tek yaz.
- Ödeme ve randevu oluşturma kuralları değişmez. Tercüman ücretsizdir; fiyat ve ödeme koduna dokunulmaz.
- docker-compose, Dockerfile'lar, Nginx, `.env`, LiveKit sunucu ayarları ve `docs/legal/` değişmez.
- Yeni npm paketi yok.
- Migration yalnızca ekleme yapar.

---

## İş 1: Rol ve veri modeli

- Yeni site rolü: **`INTERPRETER`**. Mevcut rol listesine eklenir.
  - Admin, doktor ve CRM ekranlarına erişemez.
  - Yalnızca kendi tercüman paneline ve kendisine atanmış görüşmelere erişir.
- **`InterpreterProfile`:**
  - `userId` (tekil)
  - `displayName` (sitede görünen ad; varsayılan baş harfli biçim, örn. "A. Yılmaz")
  - `languages[]` (site dil kodları ve ek ISO kodları)
  - `timeZone`
  - `isActive`
  - `confidentialityAcceptedAt`: gizlilik taahhüdü onay tarihi. **Boşsa hiçbir görüşmeye atanamaz.**
  - `notes` (yalnızca admin görür)
- **`AppointmentInterpreter`:**
  - `bookingId`
  - `interpreterId`
  - `language`
  - `status`: assigned / joined / left / removed / cancelled
  - `assignedById`, `assignedAt`
  - `joinedAt`, `leftAt`
  - `removedById`, `removedReason`
  - Kural: bir booking'e aynı anda **en çok 1 aktif tercüman.**
- **Hasta talebi:** `InterpreterRequest` tablosu: `bookingId`, `language`, `requestedAt`.
  - Randevu sihirbazının intake adımına opsiyonel bir kutu eklenir: "Görüşmede ücretsiz tercüman istiyorum" ve dil seçimi.
  - Kutu yalnızca site ayarında `interpreterIncluded=true` ise görünür.
  - Bu kutu randevu oluşturma kuralını değiştirmez; yalnızca ayrı bir kayıt açar.

## İş 2: Atama (admin)

- **Admin → Tele-sağlık → "Tercümanlar":**
  - Tercüman hesabı oluşturma: davet e-postası ve şifre belirleme (mevcut davet akışı).
  - Diller, aktif/pasif.
  - Gizlilik taahhüdü durumu.
  - Tercüman hesaplarında **2FA zorunlu** (mevcut staff 2FA altyapısı). 2FA kurulmadan görüşmeye katılamaz.
- **Randevu detay ekranında "Tercüman" kartı:**
  - Hastanın talebi varsa gösterilir.
  - Dile göre uygun tercümanlar listelenir: aktif, taahhütlü ve o saatte başka atamasıyla çakışmayan.
  - Ata / değiştir / kaldır işlemleri.
  - Her işlem audit log'a yazılır: `interpreter.assigned`, `interpreter.unassigned`.
- **Bildirimler** (mevcut e-posta şablon sistemi, alıcının dilinde):
  - **Tercümana:** tarih ve saat (kendi diliminde ve TR saatiyle), görüşme dili, panel bağlantısı. **Hastanın adı, şikayeti ve belgeleri e-postada yer almaz.**
  - **Hastaya:** "Görüşmenize tercüman katılacak (dil)". Tercümanın yalnızca görünen adı yazılır.
  - **Doktora:** aynı bilgi.
- **Atama kaldırılırsa:** Tercüman o anda odadaysa `removeRoomParticipant` ile çıkarılır ve token'ı geçersiz sayılır. Yeni token alamaz.

## İş 3: Görüşmeye katılım

- **Tercüman paneli:** `/[lang]/interpreter`
  - Atanmış yaklaşan görüşmeler: saat, dil, doktorun görünen adı, hastanın yalnızca adının baş harfi.
  - "Katıl" düğmesi.
  - Geçmiş görüşmeler listesi.
  - **Görmediği bilgiler:** hasta belgeleri, intake cevapları, doktor notları, reçeteler, kayıtlar.
- **Katılım penceresi:** Doktorun erişim penceresi kuralı aynen uygulanır (erken katılım dahil). Görüşme bitince ya da iptal edilince token alınamaz.
- **Token:** yeni `createInterpreterToken`
  - `canPublish: true` (kamera ve mikrofon), `canSubscribe: true`, `canPublishData: true` (oda içi sohbet ve sinyaller hasta/doktorla aynı)
  - `hidden` kullanılmaz.
  - identity `interpreter:<interpreterProfileId>:<bookingId>`
  - metadata `{ role: "interpreter", language }`
  - Görünen ad: "<displayName> · Interpreter (العربية)", dil adı yerel adıyla.
  - TTL doktor token'ıyla aynı.
  - **Ekran paylaşımı kapalı** (`canPublishSources`: yalnızca kamera ve mikrofon).
- **Oda içi davranış** (`consultation-room.tsx`, en küçük değişiklik):
  - Katılımcı ızgarasında tercüman 3. kutu olarak görünür, "Tercüman · dil" etiketiyle.
  - Hasta ve doktora bir kez "Tercüman görüşmeye katıldı / ayrıldı" bildirimi çıkar.
  - **Doktor**, tercümanı "Görüşmeden çıkar" düğmesiyle çıkarabilir (onay penceresiyle). Bu işlem audit log'a yazılır ve atama `removed` olur.
  - Tercüman ekranında: hasta ve doktor videoları, kendi kamera ve mikrofon kontrolleri, "Ayrıl".
  - Tercüman ekranında **olmayanlar:** kayıt başlatma/durdurma, belge paneli, not paneli, randevu bilgisi.
  - Kayıt açıksa tercüman da "Bu görüşme kaydediliyor" uyarısını görür (mevcut kayıt bildirimi).
  - **Dinleyici:** Paket C dinleyicisi aynı anda katılabilir. Katılımcı listesi ve bildirimler üç rolü doğru ayırt etmeli.
- **Kayıt:** Kayıt açıksa tercümanın ses ve görüntüsü de mevcut composite kayda girer. Egress ayarına dokunulmaz, yalnızca bu durum doğrulanır.
- **Audit:** `interpreter.joined` ve `interpreter.left` (oturum süresiyle), `interpreter.removed_by_doctor`. Metadata'da token ya da URL olmaz.

## İş 4: Bilgilendirme ve rıza metinleri (hukuk kontrolü listesine)

- **Randevu onay ekranı ve e-postası:** "Görüşmenize gizlilik taahhüdü vermiş bir tercüman katılacaktır." (9 dil)
- **Görüşme odasına girişte hasta için tek satır bilgi:** "Bu görüşmeye bir tercüman katılıyor." (9 dil)
- **Gizlilik taahhüdü metni:** Tercümanın ilk girişte okuyup onayladığı metin. Taslağı EN ve TR yaz, admin ayarında düzenlenebilir olsun. Hukuk onayı gerekir; rapora "hukuk kontrolü gerekli" olarak listele.
- `docs/legal/` metinlerine dokunma. Aydınlatma metnine eklenmesi gereken cümleyi rapora öneri olarak yaz.

## İş 5: Raporlama
- Admin raporu: tercüman bazında görüşme sayısı, dil, toplam süre (audit join/leave verisinden). CSV dışa aktarma.

## Testler
- **Yetki:**
  - INTERPRETER yalnızca atanmış booking için token alabilir.
  - Atama kaldırılınca alamaz.
  - Pencere dışında alamaz.
  - 2FA ve taahhüt yoksa alamaz.
  - Başka uçlara (admin, doktor, hasta belgeleri) 403 alır.
- **Token grant'ları:**
  - yayın ve abonelik açık
  - ekran paylaşımı kapalı
  - `hidden` yok
  - metadata rolü doğru
- **Atama:**
  - tek aktif tercüman
  - dil ve çakışma filtresi
  - audit kayıtları
  - e-postalarda hasta adı, şikayet ve belge olmadığı
- **Oda:**
  - tercüman kutusu ve etiketi
  - katıldı/ayrıldı bildirimleri
  - doktorun çıkarma düğmesi
  - tercüman ekranında kayıt/belge/not kontrollerinin olmadığı
  - dinleyiciyle birlikte üç rolün ayrımı
- **Regresyon:** Mevcut hasta, doktor ve dinleyici akışlarının bütün testleri değişmeden geçmeli. Kayıt ve egress testleri de dahil.
- 9 dil sözlük eşitliği. RTL.
- **Uçtan uca:** yerel LiveKit ile doktor, hasta ve tercüman aynı odada; ses ve görüntü yayını; doktorun çıkarma işlemi. Ekran görüntüleri `docs/prompts/2026-10-30-AA-ekran/` klasörüne.

## İnceleme
- `security-agent` (yetki, token, pencere, IDOR), `compliance-agent` (sağlık verisi, tercüman erişim sınırı, rıza metinleri), `frontend-agent` ve `db-agent` incelesin.
- Şu kontrolde **yalnızca** bu paket için izin verilen dosyalar görünmeli. Diğerleri boş olmalı:
  ```
  git diff origin/master --stat -- frontend/src/components/site/telehealth/consultation-room.tsx backend/src/modules/telehealth/lib/livekit.ts backend/src/modules/telehealth/lib/livekit-egress.ts docker-compose.yml backend/src/modules/billing backend/src/modules/checkout frontend/package.json backend/package.json
  ```
  - `livekit-egress.ts`, billing, checkout, `package.json` ve compose **boş** olmalı.

## Rapor
`docs/prompts/2026-10-30-AA-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- kırmızı çizgi istisnası kapsamında değişen her dosya ve gerekçesi
- migration SQL
- hukuk kontrolü gereken metinler (9 dil)
- ekran görüntüleri
- testler
- canlıya alma sırası (yedek → migrate → backend → frontend → ilk tercüman hesabı → test görüşmesi). LiveKit konteyneri yeniden başlatılmaz.
