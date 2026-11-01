# Paket AF — İş 0: Bağlantı dayanıklılığı incelemesi — RAPOR (2026-11-01)

**Yalnızca okuma.** Kod, compose, Nginx ve `.env` değiştirilmedi. Tam test paketi ve Docker derlemesi çalıştırılmadı. Sunucuya erişim yok; sunucu tarafı maddeler repo, `INFRA.md` ve proje notlarından çıkarıldı ve **sunucuda doğrulanmalı** olarak işaretlendi. Sır değerleri rapora yazılmadı.

**Kapsam notu:** `C:\Users\Ridonei\Desktop\claude code proje\docs\prompts\2026-11-01-AF-gorusme-odasi-profesyonel.md` dosyasında (son değişiklik 2026-11-01 00:09) "İş 0" bölümü yine yok. İnceleme, kullanıcının tarif ettiği kapsamla yapıldı:
- Room seçenekleri
- yeniden bağlanma
- TURN/TLS 443
- UDP portları
- Nginx `/livekit/`
- compose'daki LiveKit ayarları

Kod referansları `origin/master` `4a5c92b` sürümüne aittir. İlk turun genel bulguları için: `2026-11-01-AF-IS0-RAPOR.md`.

---

## Özet

| # | Bulgu | Önem |
|---|---|---|
| 1 | Compose'da backend'in `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` değerleri **çıplak sabit** (repoda açık dev anahtarı). Canlı bu compose ile çalıştığı için `.env` değerini ezer. İki ihtimal var: canlı LiveKit bu anahtarı kabul ediyorsa repoya erişen herkes canlı odalara token üretebilir; kabul etmiyorsa görüşmeler hiç kurulamaz. | **Kritik, sunucuda doğrulanmalı** |
| 2 | TURN yok (compose `--dev` modunda kapalı; canlı ayarı repoda yok). UDP'yi ve 7881/tcp'yi engelleyen ağlarda (kurum, otel, bazı mobil operatörler) medya hiç akmaz. 443 üzerinden TURN/TLS yok. | Yüksek |
| 3 | İstemcide kendiliğinden yeniden bağlanma **katılım başına yalnızca bir kez** yapılıyor. Başarılı bir kurtarmadan sonraki ikinci kopma, kullanıcıyı **mesajsız** giriş ekranına atıyor. | Yüksek |
| 4 | Aynı kullanıcı iki sekmede açınca (DUPLICATE_IDENTITY) sekmeler birbirini bir kez düşürüyor, sonunda biri sessizce giriş ekranına dönüyor. | Orta |
| 5 | "Yeniden bağlanılıyor" ve "bağlantı zayıf" durumları kullanıcıya ayrıntılı gösterilmiyor (yalnızca köşedeki rozet). Ham SDK hata metni ekrana gidiyor. | Orta |
| 6 | `livekit-client 2.22` önce `/rtc/v1` yolunu deniyor. Sunucu eskiyse veya proxy bu yolu geçirmiyorsa her bağlantıda fazladan bir başarısız deneme ve doğrulama isteği oluyor. | Orta, doğrulanmalı |
| 7 | Compose'taki `livekit` servisi `:latest` imajı, `--dev` modu ve sabit portlar kullanıyor. Canlıda bu servis de ayağa kalkıyorsa gerçek LiveKit ile port çakışabilir. | Orta, doğrulanmalı |
| 8 | UFW notunda `7881/tcp` (ICE/TCP yedeği) yok. 7880/tcp ise dışa açık (TLS'siz sinyal). | Orta / düşük, doğrulanmalı |

---

## 1. İstemci: Room seçenekleri

**Kod:** `frontend/src/components/site/telehealth/consultation-room.tsx:743-775`. Tercüman odası (`interpreter-room.tsx:187`) aynı seçenekleri kullanıyor.

| Seçenek | Değer | Kaynak / yorum |
|---|---|---|
| `adaptiveStream` | `true` | Bilinçli açılmış (2026-09-21). İyi. |
| `dynacast` | `true` | Bilinçli açılmış. İyi. |
| `reconnectPolicy` | SDK varsayılanı | 10 deneme: 0, 0.3, 1.2, 2.7, 4.8 sn, sonra 5 × 7 sn (+0–1 sn sapma); toplam **~45–50 sn** (`DefaultReconnectPolicy.ts:3-16`). |
| `singlePeerConnection` | `true` (SDK 2.22 varsayılanı) | `/rtc/v1` sinyal yolunu gerektirir; yoksa `/rtc` yoluna düşer (§5). |
| `disconnectOnPageLeave` | `true` (varsayılan) | Sayfadan çıkınca bağlantı kapanır. |
| `connectOptions.maxRetries` | 1 (varsayılan) | İlk katılımda sunucuya ulaşılamazsa tek ek deneme var. |
| `websocketTimeout` / `peerConnectionTimeout` | 15 sn / 15 sn (varsayılan) | Yavaş mobil ağda ilk katılım 15 sn'de düşebilir. |
| `rtcConfig` / `iceServers` | verilmiyor | **Doğru.** ICE ve TURN sunucuları LiveKit'in katılım yanıtından gelir; istemciye TURN yazılmamalı. |
| Ses kısıtları | SDK varsayılanı | AGC, echo cancellation, noise suppression ve voiceIsolation açık (`defaults.ts:25-31`). |
| Yayın | SDK varsayılanı | simulcast, VP8 + yedek codec, 720p, DTX, RED açık. Zayıf ağ için uygun. |

**Öneri (AF veya ayrı bir düzeltme turu; şimdi değiştirilmedi):**
- `connectOptions={{ maxRetries: 2 }}` ve `websocketTimeout: 20_000`, ilk katılımın zayıf ağda dayanıklılığı için. Düşük risk.
- İstemciye `iceServers` veya `iceTransportPolicy` **eklenmemeli**. Yalnızca test için `iceTransportPolicy: "relay"` ile TURN doğrulaması yapılabilir (§6).

## 2. İstemci: yeniden bağlanma akışı

Akış şöyle işliyor:
1. **SDK katmanı:**
   - Önce ICE yeniden başlatma ("resume") deneniyor, olmazsa tam yeniden bağlanma; en fazla ~45–50 sn.
   - Bu sürede rozet "Yeniden Bağlanıyor" gösteriyor (`useConnectionState`, `:501-527`).
2. **Uygulama katmanı (`handleDisconnected`, `:907-919`):**
   - SDK pes edince, kullanıcı kendisi ayrılmadıysa yeni token alınıyor ve `<LiveKitRoom key={token}>` yeniden kuruluyor. Kamera ve mikrofon tekrar açılıyor.
   - `autoReconnectedRef` bayrağı **yalnızca `handleJoin`'de sıfırlanıyor** (`:877`).

**Sorunlar:**
- **Tek hak:** 20. dakikada bir kopma başarıyla kurtarılsa bile 40. dakikadaki ikinci kopmada kullanıcı doğrudan giriş ekranına düşüyor. Hata mesajı da yok: mesaj yalnızca token isteği başarısız olursa yazılıyor (`:915`).
  - Öneri: bağlantı belirli bir süre (ör. 60 sn) kararlı kalınca hak yenilensin.
  - Token ucunun hız sınırı 10/dk olduğu için en fazla 2–3 deneme ve artan bekleme yeterli.
- **DUPLICATE_IDENTITY:** bu neden de kendiliğinden yeniden bağlanmayı tetikliyor ve iki sekme birbirini bir kez düşürüyor.
  - Öneri: bu nedende yeniden bağlanma yapılmasın; "Bu görüşme başka bir sekmede/cihazda açık" mesajı ve "Burada devam et" düğmesi gösterilsin.
- **Dinlenmeyen olaylar:** `RoomEvent.Reconnecting`, `SignalReconnecting`, `ConnectionQualityChanged`, `ParticipantDisconnected`. AF İş 4'teki "Bağlantı zayıf" ve "Yeniden bağlanılıyor…" katmanları bunlarla kurulmalı.
- **`onError` metni:** SDK'nın ham, İngilizce `err.message` metni ekrana gidiyor (`:771`). Hata nedenine göre çevrilmiş mesaj gösterilmeli: sunucuya ulaşılamadı, izin yok, medya hatası.
- **Sayfa yenileme:** bellekteki `meeting` kayboluyor ve tekrar "Katıl" gerekiyor. Otomatik yeniden katılım bir ürün kararı; şu an bilinçli olarak yok.
- **Tercüman odası:** kopunca doğrudan giriş ekranına dönüyor (`interpreter-room.tsx:188-191`); kendiliğinden yeniden bağlanma hiç yok.

## 3. Compose'daki LiveKit ayarları (`docker-compose.yml`)

- **`backend.environment` (satır 117-126):**
  - `LIVEKIT_INTERNAL_URL` ve `LIVEKIT_URL` doğru biçimde `${VAR:-dev}` kalıbıyla.
  - **`LIVEKIT_API_KEY` ve `LIVEKIT_API_SECRET` çıplak sabit değer** (değerler `INFRA.md:503-512`'de de açık metin yazılı).
  - `environment:` bölümü `env_file:` değerlerinden öncelikli. Proje notuna göre canlı bu kök compose'u doğrudan kullanıyor (`docker compose up -d --build --no-deps backend frontend`). Dolayısıyla canlıdaki backend büyük olasılıkla **dev anahtarıyla** token imzalıyor.
  - Bu, projede iki kez yaşanan "çıplak değer `.env`'i sessizce ezer" hatasının üçüncü örneği.
  - **Sunucuda doğrulama (değer yazdırmadan):**
    ```bash
    # Anahtar kimliği gizli değil; sır kısmı yazdırılmaz, yalnızca uzunluk ve dev değerle eşitlik kontrol edilir
    docker compose exec backend sh -c 'echo "key=$LIVEKIT_API_KEY secret_len=${#LIVEKIT_API_SECRET}"'
    grep -c "^LIVEKIT_API_KEY=devkey" .env   # kök .env'de gerçek anahtar mı var?
    ```
  - `key=devkey` çıkıyor ve görüşmeler çalışıyorsa canlı LiveKit dev anahtarını kabul ediyor demektir. Bu durumda **canlı LiveKit anahtarı derhal döndürülmeli** ve compose satırları `${LIVEKIT_API_KEY:-devkey}` kalıbına çevrilmeli.
  - Bu bir compose değişikliği; AF kapsamında yasak. Ayrı bir devops işi olarak sırası şöyle: önce `.env`'e yeni anahtar, sonra LiveKit yapılandırması, sonra compose kalıbı.
- **`livekit` servisi (satır 239-253):**
  - `livekit/livekit-server:latest`; `--dev`; `--keys` sabit; portlar `7880`, `7881/tcp`, `7882/udp`.
  - `--dev` modunda TURN kapalı ve tek UDP portu var.
  - `:latest` her derlemede sürümü kontrolsüz değiştirir; sabit bir sürüm etiketine bağlanmalı.
  - **Canlıda bu servis de çalışıyor mu?** Notlara göre gerçek LiveKit sunucuda ayrı ve host ağında çalışıyor (7880 + 50000-60000/udp). Bir kez tam `docker compose up -d --build` çalıştırıldıysa (2026-09-19 notu), bu dev servisi de başlamış ve 7880'i tutmaya çalışmış olabilir: port çakışması, yeniden başlama döngüsü ya da yanlış sunucuya bağlanma. Doğrulama:
    ```bash
    docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' | grep -i livekit
    ss -ltnp | grep -E ':(7880|7881|5349|443)\b'
    ss -lunp | grep -E ':(7882|3478)\b|:5[0-9]{4}\b' | head
    ps aux | grep -i [l]ivekit-server      # gerçek kurulumun komut satırı / config yolu
    ```
  - Öneri: compose'taki `livekit` servisine `profiles: ["dev-livekit"]` eklenerek yalnızca istenince başlatılması. Bu da compose değişikliği; ayrı bir devops işi.

## 4. Sunucu: TURN, TLS 443 ve UDP portları

**Repoda canlı `livekit.yaml` yok.** Proje notlarındaki canlı değerler:
- `rtc.node_ip: <sunucu IP>`, `rtc.tcp_port: 7881`, `port_range 50000-60000`
- host ağı
- UFW'de `7880/tcp` ve `50000-60000/udp` açık

**Değerlendirme:**
- **UDP 50000-60000:** doğru. Bulut sağlayıcının güvenlik grubunda da açık olmalı (UFW'nin üstünde ayrı katman).
- **ICE/TCP 7881:** UDP engelli ağlar için ilk yedek. UFW notunda **7881/tcp yok**. Kapalıysa UDP engelli kullanıcı hiç bağlanamaz. Doğrulama: `ufw status | grep 7881`.
- **TURN:** yapılandırmaya dair iz yok. Yalnızca 80/443 çıkışına izin veren ağlarda (kurum, hastane, otel Wi-Fi'si, bazı yurt dışı mobil ağlar) 7881/tcp de engelli olur ve **tek çözüm TURN/TLS 443**. Sağlık turizminde hastaların otel ağlarından bağlanması yaygın olduğu için bu yüksek öncelikli.
- **Önerilen hedef yapılandırma (sunucuda, devops işi):**
  ```yaml
  # livekit.yaml (canlı) — mevcut rtc ayarları korunur
  rtc:
    tcp_port: 7881
    port_range_start: 50000
    port_range_end: 60000
    node_ip: <sunucu IP>        # mevcut kural, değişmez
  turn:
    enabled: true
    domain: turn.wmhealthistanbul.com     # A kaydı aynı IP
    tls_port: 5349                        # seçenek A (aşağıda)
    udp_port: 3478
    cert_file: /etc/letsencrypt/live/turn.wmhealthistanbul.com/fullchain.pem
    key_file:  /etc/letsencrypt/live/turn.wmhealthistanbul.com/privkey.pem
  ```
- **443 sorunu:** 443 Nginx'te olduğu için TURN/TLS doğrudan 443'ü dinleyemez. Seçenekler:
  - **A) 5349/tcp + 3478/udp:** kolay, Nginx'e dokunmaz. Yalnızca-443 ağlarında yine çalışmaz, ama 7881'den daha çok ağdan geçer.
  - **B) Nginx `stream` + `ssl_preread`:** 443'te SNI'ya göre ayrım yapılır. `turn.` alan adı TLS'i çözmeden LiveKit TURN'üne (127.0.0.1:5349) aktarılır; diğer alan adları içteki HTTPS sunucusuna (ör. 127.0.0.1:8443) gider. En kapsamlı çözüm, ama mevcut `server { listen 443 }` bloklarının taşınmasını gerektiren riskli bir Nginx değişikliği. Bakım penceresinde ve geri alma planıyla yapılmalı.
  - **C) İkinci IP:** TURN o IP'nin 443 portunda. Temiz ama ek maliyet.
  - **Öneri:** önce A, ardından ölçüm (LiveKit loglarında relay oranı); gerekirse B.
- **Sertifika:** TURN alan adı için ayrı Let's Encrypt sertifikası ve yenileme hook'u (LiveKit'in yeniden yüklenmesi) gerekir.

## 5. Nginx `/livekit/`

- Repoda Nginx yapılandırması yok. `INFRA.md:746-760`'daki referans blok şöyle: `location /livekit/` → `proxy_pass http://127.0.0.1:7880/;` (sondaki `/` önekin kesilmesini sağlıyor), Upgrade/Connection başlıkları, 3600 sn zaman aşımı.
- Proje kuralına göre `/livekit` ve `/rtc` yolları 7880'e, 86400 sn zaman aşımıyla gidiyor.
- **SDK 2.22'nin istekleri** (`LIVEKIT_URL=wss://<alan adı>/livekit`):
  1. WS `…/livekit/rtc/v1?…` (singlePeerConnection).
  2. Başarısızsa HTTP GET `…/livekit/rtc/v1/validate`. 404 dönerse istemci `…/livekit/rtc` (v0) yoluna düşer (`SignalClient.ts:1285-1296`, `api/utils.ts:4-19`).
  3. Backend sunucudan sunucuya `RoomServiceClient` çağrıları (`…/twirp/…`). `LIVEKIT_INTERNAL_URL` boşsa bu çağrılar da genel adrese, yani Nginx'e gider (`lib/livekit-signal.ts:68`).
- **Kontrol listesi (sunucuda):**
  - `location /livekit/` önek kesiyor ve `/rtc/v1` dahil **bütün alt yolları** geçiriyor mu?
  - LiveKit sunucu sürümü `/rtc/v1` destekliyor mu? (`docker logs` veya servis logunda "starting LiveKit server" satırındaki sürüm.) Desteklemiyorsa her katılımda fazladan bir istek ve gecikme oluşur; çalışır ama yavaştır.
  - WS zaman aşımı en az 3600 sn mi? (Proje kuralı 86400 sn.)
  - `proxy_set_header X-Forwarded-For $remote_addr` ve `X-Real-IP` var mı?
  - 7880/tcp dışa açık mı? Nginx üzerinden geçiliyorsa dışa açık olması gerekmez; TLS'siz sinyal yüzeyi oluşturur. Önce erişim yolu doğrulanmalı.
  ```bash
  nginx -T 2>/dev/null | grep -n -A12 -E "location (/livekit|/rtc)"
  curl -s -o /dev/null -w "%{http_code}\n" https://<alan adı>/livekit/rtc/v1/validate   # 401 (token yok) beklenir; 404 → v1 yok ya da yol geçmiyor
  curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" https://<alan adı>/livekit/rtc   # 101 veya 401 beklenir
  ```

## 6. Doğrulama planı (kod değişikliği olmadan, canlıda)

1. §3 ve §5'teki komutlar; çıktılar paylaşılırsa değerlendiririm.
2. **TURN testi** (TURN açıldıktan sonra): istemci geçici olarak `iceTransportPolicy: "relay"` ile çalıştırılır (yalnızca test dalında). Alternatif: `chrome://webrtc-internals` ile seçilen aday türüne bakılır (relay/tcp/udp).
3. **Ağ senaryoları:**
   - UDP engelli: telefon hotspot + güvenlik duvarı ya da kurumsal ağ.
   - Yalnızca 443 açık.
   - Ağ geçişi: Wi-Fi'den 4G'ye.
   - 60 sn uçak modu: SDK'nın ~50 sn penceresi aşılır ve uygulamanın tek hakkı devreye girer.
   - İki sekme: DUPLICATE_IDENTITY.
4. **Yerel e2e:** mevcut `telehealth-consultation-livekit-live.spec.ts` dev LiveKit'le çalışıyor; TURN ve ağ kesintisi senaryolarını kapsamıyor.

## 7. AF ile ilişkisi ve önerilen iş bölümü

- **AF'nin içinde (arayüz):**
  - §2'deki "Yeniden bağlanılıyor…" ve "Bağlantı zayıf" katmanları ile karşı taraf düştü mesajı (İş 4).
  - DUPLICATE_IDENTITY mesajı ve çevrilmiş hata metinleri.
  - Tekrarlanabilir yeniden bağlanma hakkı (`consultation-room.tsx` istisna kapsamında). `consultation-room-connection-resilience.test.tsx` buna göre **genişletilmeli**; mevcut "ilk kopmada bir kez yeniden bağlan" davranışı korunur.
- **AF'nin dışında (devops, ayrı paket):**
  - §3: anahtarların `${VAR:-}` kalıbına alınması ve anahtar döndürme; `livekit` servisi için `profiles`; sürüm sabitleme.
  - §4: TURN/TLS ve 7881/tcp.
  - §5: Nginx kontrolü.
  - Promptun kırmızı çizgisi (compose, Nginx, `.env`, LiveKit sunucu ayarları) gereği bunlar AF'ye konmadı.

## 8. Kullanıcı kararları (2026-11-01) ve AF'ye etkileri

- **Hasta adı:** token'a konmaz. İstemcide booking verisinden **rol bazlı maskelenerek** eşlenir: hasta ve doktor tam adı, tercüman baş harfleri ("İ. K.") görür. Dinleyici video görmediği için ad etiketi yok.
  - Not: tercüman uç noktasındaki `patientInitial` bugün yalnızca "A." biçiminde. "İ. K." için bu alanın üretiminde küçük bir backend değişikliği gerekir; tercüman rotası istisna listesinde yok, onay gerekir.
- **Doktor ve tercümanın görünen adı token'a konabilir.** Token'da ad olmamasını doğrulayan birim test (`tests/unit/telehealth-livekit.test.ts:113`) buna göre güncellenebilir. Tasarım notları:
  - Token'daki `name` **tek dilli**dir ve odadaki herkese aynı gider. "Unvan izleyicinin dilinde" kuralı token adıyla sağlanamaz. Öneri: token adı yedek olarak kalsın (ör. randevunun dilinde); ekranda unvan, istemcide izleyicinin dilinde oluşturulsun.
  - Kayıt `layout: "speaker"` ile alındığı için doktor ve tercüman adları kayıt videosunda da görünecek. Hasta adı görünmeyecek, çünkü token'a girmiyor.
  - Rotanın adı `livekit.ts`'e geçirmesi gerekiyor: `telehealth.livekit.routes.ts` ve `lib/livekit.ts` arayüzü. Bu rota dosyası promptun istisna listesinde yok; bu kararın rotada yalnızca ad geçirme değişikliğine de izin verdiği varsayılacak. Teyit iyi olur.
- **Ekran paylaşımı:** mevcut davranış korunur, hasta da paylaşabilir. Promptun İş 4 maddesindeki "yalnızca doktor" ifadesi bu karara göre uygulanmayacak.
- **Tercüman etiketi:** 9 dile çevrilecek. Token adı (`"A. Yılmaz · Interpreter (العربية)"`) tek dilli olduğu ve AA entegrasyon testinde sabitlendiği için çeviri istemcide yapılacak: metadata'daki `{role, language}` + ad + i18n'li "Tercüman" sözcüğü. Tercüman kutusundaki çift etiket de böylece kalkar.

## 9. Açık sorular (cevabınızı bekleyenler)

İlk İş 0 raporundan taşınanlar:
1. **Test mock'ları:** Frontend birim test mock'larına (`@livekit/components-react`, `livekit-client`) **yalnızca yeni export eklemek** "mevcut testler değişmeden geçmeli" kuralına uygun sayılıyor mu?
2. **DUPLICATE_IDENTITY:** "Bu görüşme başka bir sekmede/cihazda açık" mesajı ve "Burada devam et" düğmesi AF kapsamında mı?
3. **Canlı LiveKit:** Compose'taki servis mi, sunucudaki ayrı kurulum mu? TURN ve 443/5349 durumu biliniyor mu? Compose'taki sabit anahtar canlıda etkili mi? (§3'teki komutların çıktısı bu üç soruyu birlikte cevaplar.)
4. **Sözlük:** Görüşme odası metinleri için yeni bir site sözlüğü mü (`consultation`), yoksa mevcut `portal` sözlüğü mü kullanılacak?

Bu incelemeden doğanlar:

5. **Anahtar:** §3'te dev anahtarı canlıda etkili çıkarsa, anahtar döndürme + compose `${VAR:-}` düzeltmesi için ayrı bir acil devops işi açılsın mı?
6. **TURN yolu:** A (5349 + 3478/udp, Nginx'e dokunmaz) ile başlansın mı, yoksa doğrudan B'ye (443'te SNI ayrımı) mi gidilsin?
7. **Yeniden bağlanma hakkı:** Kararlı bağlantıdan sonra yenilensin mi (önerilen: 60 sn kararlılık sonrası, en fazla 3 deneme ve artan bekleme), yoksa mevcut "katılım başına bir kez" kuralı mı kalsın?
8. **Tercüman odası:** Kendiliğinden yeniden bağlanma AF kapsamına alınsın mı? Tercüman yetki kurallarına dokunmaz; yalnızca arayüz akışı.
9. **Rota dosyası:** Doktor ve tercüman adını token'a geçirmek için `telehealth.livekit.routes.ts` dosyasında yalnızca ad parametresi geçiren değişikliğe izin var mı? Tercüman `patientInitial` alanını "İ. K." biçimine getirmek için tercüman rotasındaki küçük değişikliğe izin var mı?
