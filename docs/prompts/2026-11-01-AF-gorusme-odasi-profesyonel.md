# Paket AF: Görüşme odasının profesyonelleştirilmesi (güncel sürüm, 2026-11-01)

**Bütün cevaplarını ve raporunu Türkçe yaz.** Testler sıralı koşar. Push etme.

Bu dosya, İş 0 incelemesinden sonra kullanıcı kararlarıyla güncellendi. İş 0 tamamlandı; raporları bağlam için oku:
- `docs/prompts/2026-11-01-AF-IS0-RAPOR.md`
- `docs/prompts/2026-11-01-AF-baglanti-inceleme.md`

## Başlangıç
- **Yeni worktree ya da klasör açma.** Ana proje klasöründe çalış.
- Üzerinde çalıştığın açık bir iş varsa önce onu bitir ve commit'le.
- `git fetch`, ardından güncel `origin/master` üzerinden `feat/consultation-room-ux-nov01` dalını aç.
- Çalışma alanındaki commit'lenmemiş dosyalara (`.claude/…`, `design/`, eski prompt dosyaları) dokunma, commit'e ekleme.

## Sunucu durumu (tamamlandı, bu paketin işi değil)
Canlı LiveKit 2026-11-01'de yeniden yapılandırıldı ve gerçek görüşmeyle test edildi:
- LiveKit v1.13.7, host ağı, yapılandırma dosyasıyla çalışıyor (`--dev` yok).
- **UDP 50000–60000** (ana medya yolu), **TCP 7881** (ICE/TCP yedeği).
- **TURN/TLS 5349** ve **TURN/UDP 3478** (`turn.wmhealthistanbul.com`). Sertifika yenilemesi otomatik.
- API anahtarı döndürüldü.
- Gerçek görüşme testi: mobil veride UDP, masaüstünde TURN ile bağlanıldı. Kopma sonrası bağlantı kendiliğinden devam etti.

Sonuçları:
- İstemciye `iceServers`, TURN adresi ya da `iceTransportPolicy` **yazılmaz.** ICE ve TURN bilgisi LiveKit'in katılım yanıtından gelir (İş 0 raporu §1).
- Compose'taki sabit dev anahtarı ve `livekit` servisi konusu (rapor bulgusu 1 ve 7) bu paketin işi değil. Kırmızı çizgi devam ediyor, rapora yalnızca not olarak yaz.

## Kullanıcı kararları

**Önceki kararlar (rapor §8):**
- **Hasta adı token'a konmaz.** İstemcide booking verisinden **rol bazlı maskelenerek** eşlenir: hasta ve doktor tam adı görür, tercüman baş harfleri görür ("İ. K."). Dinleyici video görmediği için ad etiketi yoktur.
- **Doktor ve tercümanın görünen adı token'ın `name` alanına konabilir.** `backend/tests/unit/telehealth-livekit.test.ts:113` bu karara göre güncellenebilir. Bu testte yalnızca doktor ve tercüman adının varlığı doğrulanır; hasta adının token'da **olmadığını** doğrulayan bir test eklenir.
- **Ekran paylaşımı:** mevcut davranış korunur; hasta da paylaşabilir. Eski metindeki "yalnızca doktor" ifadesi uygulanmaz.
- **Tercüman etiketi** 9 dile çevrilir. Çeviri istemcide, metadata'daki `{role, language}` bilgisinden yapılır. Token'daki ad biçimi ve AA testleri değişmez.

**§9 açık sorularının cevapları:**
1. **Test mock'ları:** `@livekit/components-react` ve `livekit-client` mock'larına **yeni export eklemek serbest.** Mevcut testlerin beklentileri değişmez; tek istisna yukarıdaki `name` testi.
2. **Aynı görüşmenin iki sekmede açılması (DUPLICATE_IDENTITY):** AF kapsamında.
   - "Bu görüşme başka bir sekmede veya cihazda açık" ekranı ve "Burada devam et" düğmesi olacak.
   - Bu neden **kendiliğinden yeniden bağlanmayı tetiklemez.** Böylece sekmeler birbirini düşürmez.
3. **Canlı LiveKit:** cevaplandı (yukarıdaki sunucu durumu).
4. **Sözlük:** yeni bir **`consultation`** site sözlüğü kullanılacak. 9 dil ve RTL desteği olacak.
5. **Anahtar döndürme:** yapıldı, ek iş yok.
6. **TURN:** A seçeneği (5349 + 3478/udp) uygulandı. 443 üzerinde SNI ayrımı (B) şimdilik yok.
7. **Yeniden bağlanma hakkı:**
   - Bağlantı **60 saniye kararlı** kaldıktan sonra hak yenilenir.
   - Ardışık en fazla **3** uygulama düzeyinde deneme yapılır; aralarındaki bekleme artar (örneğin 2, 5, 10 sn).
   - Üçü de başarısızsa çevrilmiş, açıklayıcı bir mesaj ve "Yeniden bağlan" düğmesi gösterilir.
   - **Kullanıcı hiçbir durumda mesajsız olarak giriş ekranına düşmez.**
8. **Tercüman odası:** aynı yeniden bağlanma akışı tercüman odasına da eklenir. Yetki kuralları değişmez.
9. **Rota dosyaları:**
   - `telehealth.livekit.routes.ts` dosyasında doktor ve tercüman adını token'a geçiren değişikliğe izin var.
   - Tercüman rotasında `patientInitial` alanını "İ. K." biçimine getiren küçük değişikliğe izin var.

## KIRMIZI ÇİZGİ ve bu paketin istisnaları
**Kullanıcı onaylı istisna.** Bu paket yalnızca şu dosyalarda değişiklik yapabilir:
- `consultation-room.tsx` ve yeni alt bileşenler (örn. `components/site/telehealth/room/*`)
- `interpreter-room.tsx`: yalnızca arayüz ve yeniden bağlanma akışı
- `lib/livekit.ts`: yalnızca token'a `name` eklemek
- `telehealth.livekit.routes.ts` ve tercüman rotası: yalnızca 9. karardaki ad ve baş harf değişiklikleri
- `name` birim testi, frontend mock'larına yeni export'lar
- yeni `consultation` sözlük dosyaları

Değişmeyenler:
- **Room ve bağlantı seçenekleri:** `adaptiveStream`, `dynacast`, simulcast, preset'ler, codec, `degradationPreference`, `connectOptions`, zaman aşımları. Bunlarda değişiklik gerekirse **önce sor.**
- **Kayıt ve egress mantığı**, kayıt rızası, kayıt göstergesi davranışı
- **Erken katılım ve katılım penceresi kuralları**, token süreleri ve yetkiler (grant'lar)
- Dinleyici (Paket C) ve tercüman (AA) yetki kuralları
- LiveKit sunucu ayarları, compose, Dockerfile'lar, Nginx, `.env`, `docs/legal/`
- Ödeme ve randevu kuralları
- **Yeni npm paketi yok.** Arka plan bulanıklaştırma gibi işlemci gerektiren özellikler bu pakette yok.

Her değişikliği rapora "neden gerekli" notuyla yaz.

## Arayüz işleri bağlantıya dokunmamalı
- Room nesnesi yeniden oluşturulmamalı ve gereksiz yeniden bağlanma tetiklenmemeli.
- Kamera ya da cihaz değişimi `switchActiveDevice` ile yapılmalı; yayın kapatılıp yeniden açılmamalı.
- Yerleşim ve PiP değişiklikleri yalnızca görsel olmalı. Abonelikler ve video kalitesi seçimi mevcut `adaptiveStream` davranışına bırakılmalı.
- Yeni bileşenler gereksiz yeniden render ile video elementlerini söküp takmamalı.

---

## İş 1: Kod yerine kişi adları
**Sorun:** Video kutularında `doctor:77bd0977-…` gibi teknik kimlik (LiveKit identity) görünüyor. Sebebi, token'da `name` olmaması ve hazır `ParticipantTile` bileşeninin bu durumda identity göstermesi.

**İstenen:**

| Rol | Görünen ad | Kaynak |
|---|---|---|
| Doktor | Unvan + görünen ad (örn. "Prof. Dr. D. Yıldırım"). Kurucuda tam ad. Unvan izleyicinin dilinde. | token `name` ve mevcut unvan çevirileri |
| Hasta | Hasta ve doktor tam adı görür; tercüman yalnızca baş harfleri ("İ. K.") görür. | istemcide booking verisi, rol bazlı maskeleme; **token'da değil** |
| Tercüman | "A. Yılmaz · Tercüman (العربية)". Rol kelimesi izleyicinin dilinde. | token `name` ve metadata |
| Dinleyici | Ad etiketi yok (video görmüyor) | – |

- **Kimlik (`identity`) değişmez** ve hiçbir yerde kullanıcıya gösterilmez.
- Ad bulunamazsa izleyicinin dilinde "Doktor", "Hasta" gibi rol adı gösterilir.
- Video kutusunun alt köşesinde şunlar olsun: ad etiketi, mikrofon kapalı ikonu, bağlantı kalitesi göstergesi (3 çubuk, LiveKit `connectionQuality`).
- Hasta adının nasıl eşlendiğini rapora yaz.

## İş 2: Kamera çevirme ve cihaz seçimi
- **Mobil:** "Kamerayı çevir" düğmesi ön ve arka kamera arasında geçiş yapsın (`facingMode: user / environment`; destek yoksa cihaz listesinden sıradaki kamera).
  - Geçişte görüntü kesintisi en aza indirilsin (`switchActiveDevice`).
  - Arka kamerada yerel önizleme **aynalanmasın.** Ön kamerada aynalanır; karşı tarafa giden görüntü hiçbir durumda aynalanmaz.
- **Masaüstü:** Ayarlar (⚙) menüsünde kamera, mikrofon ve hoparlör seçimi olsun. Hoparlör seçimi destekleyen tarayıcılarda (`setSinkId`).
- **Ses:** Gürültü bastırma, yankı engelleme ve otomatik kazanç SDK varsayılanıyla zaten açık. Ayarlarda bunları kapatıp açmak için anahtarlar olsun; varsayılan **açık.**
- Seçimler cihazda hatırlansın (`localStorage`, `try/catch` ile).

## İş 3: Görüntü boyutu ve yerleşim
- **Kendi görüntüsü (PiP):**
  - Sürüklenerek 4 köşeden birine taşınabilsin (köşeye yapışma).
  - **Boyut:** küçük / orta / büyük düğmesi; mobilde iki parmakla büyütüp küçültme.
  - **Gizle/göster:** Kendi görüntüsünü küçültüp yalnızca bir avatar balonu olarak tutabilsin.
  - **Yer değiştir:** Kendi görüntüsüne çift tıklayınca/dokununca kendisi büyük ekrana, karşı taraf küçük kutuya geçsin. Bu yalnızca kendi ekranında olur.
- **Yerleşim:**
  - **Konuşmacı görünümü** (varsayılan): Konuşan kişi büyük ekranda olur (`isSpeaking`, ani geçişleri önlemek için 2 sn gecikmeli).
  - **Izgara görünümü:** Tercümanla 3 kişi olunca herkes eşit kutuda.
- **Tam ekran** düğmesi; tarayıcı destekliyorsa **resim içinde resim** (Picture-in-Picture) düğmesi.
- **Ekran döndürme:** Mobilde yatay ve dikey düzen ayrı ayrı düzgün olsun.
- **Görüşme süresi sayacı** ve randevu bitişine 5 dakika kala küçük, kapatılabilir bir uyarı. Uyarı yalnızca bilgi verir, görüşmeyi kesmez.

## İş 4: Profesyonel görünüm ve bağlantı durumları
- **Kontrol çubuğu (alt ortada):** mikrofon, kamera, kamerayı çevir (mobil), ekran paylaş (mevcut davranış), ayarlar, yerleşim, tam ekran, görüşmeden ayrıl (kırmızı).
  - Her düğmede tooltip ve klavye kısayolu olsun: `M` mikrofon, `V` kamera.
  - Kontrol çubuğu 3 saniye hareketsizlikte soluklaşsın; dokunma veya fare hareketiyle geri gelsin.
- **Bağlantı durumları:** `RoomEvent.Reconnecting`, `SignalReconnecting`, `Reconnected`, `ConnectionQualityChanged` ve `ParticipantDisconnected` olaylarını dinle.
  - "Bağlantı zayıf" bandı (kendi bağlantı kalitesi düşükken).
  - "Yeniden bağlanılıyor…" katmanı (görüşme ekranı arkada kalır).
  - Karşı taraf düştüğünde adla mesaj: "Hasta bağlantıyı kaybetti, bekleniyor…".
  - **Yeniden bağlanma:** 7. karardaki kural (60 sn kararlılıktan sonra hak yenilenir, en fazla 3 deneme, artan bekleme, sonunda açıklayıcı mesaj ve düğme).
  - **Aynı görüşme iki sekmede açıksa:** 2. karardaki ekran.
  - **Hata mesajları:** SDK'nın ham İngilizce `err.message` metni ekranda gösterilmez. Hata nedenine göre çevrilmiş mesaj gösterilir: sunucuya ulaşılamadı, izin yok, kamera/mikrofon hatası, görüşme süresi doldu. Ham metin yalnızca konsola yazılır.
- **Tercüman odası:** aynı yeniden bağlanma akışı ve bağlantı durumu katmanları (8. karar).
- **Bekleme odası:** Karşı taraf henüz gelmediyse kendi görüntüsü büyük gösterilsin ve adla bir metin olsun ("Prof. Dr. D. Yıldırım birazdan katılacak").
- **Giriş öncesi cihaz testi:** kamera önizlemesi, mikrofon seviye çubuğu, hoparlör test sesi ve cihaz seçimi.
- **Metinler:** Görüşme odasındaki bütün metinler (mevcut Türkçe sabit metinler dahil) yeni `consultation` sözlüğüne taşınsın. 9 dil, RTL desteği. Bütün düğmeler 44 px dokunma alanında.

## Testler
- **Ad etiketi:**
  - doktor, hasta ve tercüman için doğru ad
  - tercümanda hasta adının maskelenmesi
  - hasta adının token'da **olmadığı** (backend birim testi)
  - identity'nin hiçbir yerde ekranda olmadığı
  - ad yoksa rol adı
- **Kamera çevirme:** Mobil emülasyonda `facingMode` değişimi; arka kamerada önizleme aynalanmıyor.
- **PiP:** sürükleme ve köşeye yapışma, boyut değişimi, gizleme, yer değiştirme.
- **Yerleşim:** konuşmacı ve ızgara görünümleri; 3 katılımcıda ızgara.
- **Yeniden bağlanma:**
  - 60 sn kararlılıktan sonra hak yenileniyor.
  - En fazla 3 deneme yapılıyor; sonunda mesaj ve düğme çıkıyor.
  - Kullanıcı mesajsız olarak giriş ekranına düşmüyor.
  - Aynı görüşme iki sekmede açıkken (DUPLICATE_IDENTITY) kendiliğinden yeniden bağlanma tetiklenmiyor, 2. karardaki ekran çıkıyor.
  - Tercüman odası kendiliğinden yeniden bağlanıyor.
- **Bağlantı dayanıklılığı:** Kamera çevirme, yerleşim değiştirme ve PiP işlemleri sırasında yeniden bağlanma olayı **tetiklenmemeli** (olay sayacıyla doğrula).
- **Regresyon:** Mevcut görüşme, kayıt, tercüman ve dinleyici testlerinin tamamı geçmeli.
- **E2E:** Yerel LiveKit ile doktor + hasta (+ tercüman) görüşmesi. Ekran görüntüleri `docs/prompts/2026-11-01-AF-ekran/` altına:
  - masaüstü 1440
  - mobil 390, dikey ve yatay
  - TR ve AR
  - bağlantı zayıf / yeniden bağlanılıyor / sekme çakışması ekranları
- **Kırmızı çizgi kontrolü:**
  - `livekit-egress.ts`, kayıt, billing, checkout, `package.json` dosyaları, compose, Dockerfile'lar ve Nginx diff'leri **boş** olmalı.
  - `livekit.ts` diff'i yalnızca `name` alanını içermeli.
  - Rota diff'leri yalnızca 9. karardaki değişiklikleri içermeli.
  - Room ve bağlantı seçenekleri değişmemiş olmalı.

## Rapor
`docs/prompts/2026-11-01-AF-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- istisna kapsamında değişen her dosya ve gerekçesi
- hasta adının eşlenme ve maskelenme yöntemi
- yeniden bağlanma akışının durum şeması (kısa)
- ekran görüntüleri
- testler
- canlıya alma sırası: backend ve frontend yeniden derlenir; **LiveKit konteyneri yeniden başlatılmaz**
