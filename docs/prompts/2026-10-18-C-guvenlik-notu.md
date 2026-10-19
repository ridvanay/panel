# Paket C — Güvenlik Notu (security-agent, 2026-10-19)

Kapsam: ADMIN kalite kontrol dinleyicisi (`feature/admin-qa-listener`, base `e25b4d2`). İnceleyici kod DEĞİŞTİRMEDİ.
Test: `telehealth-qa-listener.test.ts` 8/8 yeşil.

## Özet

Kritik: 0. Yüksek: 0 (bu paketin YENİ bulguları). Commit'i bloklayan bulgu YOK.
Orta: 3, Düşük: 4, Bilgi: 4. Paket dışı mevcut bulgu (bildirimsiz katılım yolu) ayrı bölümde: Yüksek.

## Doğrulananlar (sorun yok)

- `createMeetingToken` DEĞİŞMEMİŞ: `git diff --stat` livekit.ts için yalnızca +58/-0 (sona ekleme).
- Yetki: hook sırası module-guard, `authenticate` (DB'den taze rol/durum, SUSPENDED/DELETED reddi), `requireSiteRole("ADMIN")`. MANAGER/EDITOR/doktor/hasta/anonim erişemez. 2FA `twoFactorEnabled` DB'den taze okunur (`telehealth.qa-listener.routes.ts:68-71`, çağrı :84).
- Token grant'ları (`livekit.ts:166-190`): `canPublish:false`, `canPublishData:false`, `canUpdateOwnMetadata:false`, `hidden` yok, `roomCreate/roomAdmin` yok, `room` odaya bağlı. İyi.
- Taklit: hasta/doktor identity'si sunucuda `patient:`/`doctor:` önekiyle sabit, token'larında metadata/`canUpdateOwnMetadata` yok; hasta/doktor `qa-listener-` kimliği veya `role:qa_listener` metadata'sı üretemez, dolayısıyla karşı tarafta sahte uyarı tetikleyemez. Banner veri mesajına değil sunucu imzalı kimlik/metadata'ya bağlı (`qa-listener-notice.tsx`). Dinleyici metadata'yı değiştirip uyarıyı gizleyemez.
- IDOR: `leave` sorgusu `actorId + targetId + sessionId` ile sınırlı; başkasının sessionId'si 404 (:132-136). `sessionId` zod `uuid()`, `id` uuid; Prisma JSON path filtresi parametreli, enjeksiyon yok.
- XSS: gerekçe React metin düğümü olarak render ediliyor (`qa-listener-history-dialog.tsx:71`), `dangerouslySetInnerHTML` yok. Audit `metadata`'ya token/URL/secret yazılmıyor (yalnızca sessionId, reason, identity, roomName, tokenExpiresAt).
- Backend katılımcı sayısına bağlı mantık içermiyor (LiveKit participant webhook'u yok); frontend'de sayım/spotlight filtresi `consultation-room.tsx:548-552`'de uygulanmış.
- Rate limit: token 5/dk, leave 20/dk (IP bazlı; ADMIN+2FA kapısı arkasında yeterli).

## Bu paketin YENİ bulguları

### O-1 (Orta) — Audit "fail-open": kayıt yazılamazsa token yine de verilir
`telehealth.qa-listener.routes.ts:98-115`. `logAudit` hataları yutar (`lib/audit.ts`); token önce üretilir, audit sonra yazılır ve sonuç kontrol edilmez. DB hatasında admin kayıtsız dinleyebilir; "her katılım loglanır" garantisi bozulur.
Öneri: joined kaydını doğrudan `prisma.auditLog.create` ile (hata → 5xx, token verilmez) token'dan ÖNCE yaz; veya `logAudit`'in bool döndüren varyantı ile fail-closed yap.

### O-2 (Orta) — TTL bağlı oturumu sınırlamıyor; oturum süresi/iptal yok
`livekit.ts:157` (10 dk TTL) yalnızca bağlanmayı sınırlar; bağlı katılımcı LiveKit tarafından yenilenir ve süresiz kalabilir. Sunucu tarafı azami süre yok; randevu `COMPLETED/CANCELLED` olunca, admin askıya alınınca/rolü düşünce/2FA'sı kapatılınca dinleyici odadan atılmaz. `removeRoomParticipant` yalnızca `leave` çağrısında çalışır, o da istemci iradesine bağlı.
Öneri: oturum açılışında sunucu zamanlayıcısı/sweeper (ör. en fazla 30-60 dk) ile `removeParticipant`; randevu durum geçişlerinde ve kullanıcı askıya/rol değişikliğinde aktif dinleyici oturumlarını kapat.

### O-3 (Orta) — Çıkış kaydı istemci beyanı; uzun oturumlarda sessizce kaybolabilir
(a) `leaveQaListenerSession` (`frontend/src/lib/api/telehealth.ts:708-722`) ham `fetch` + bellekteki bearer kullanır, 401'de refresh denemez. Access token 15 dk (`ACCESS_TOKEN_TTL_MIN`), auth-context'te proaktif yenileme yok; 15 dk'yı aşan dinlemede "Ayrıl"/`pagehide` isteği 401 alır → `left` satırı yazılmaz VE sunucu tarafı `removeParticipant` çalışmaz. Geçmişte "çıkış yok" görünür (kod bunu kabul ediyor, ama normal kullanımda tetiklenecek).
(b) Çıkış/giriş zamanları denetim açısından yetkili değil: giriş = token üretimi (bağlanma kanıtı yok), çıkış = istemcinin dilediği an çağırdığı istek. `LIVEKIT_INTERNAL_URL` boşsa admin `leave`'i curl ile çağırıp kayıtta erken "çıktı" gösterirken odada kalabilir (:155-159 atlanır).
Öneri: `leave`'de 401 sonrası bir kez refresh+yeniden dene (veya `sendBeacon` yerine kısa ömürlü "leave capability"); asıl çözüm LiveKit webhook `participant_joined/left` olaylarını (mevcut egress webhook uç noktasına, imza doğrulamalı) audit'e yazıp tek yetkili zaman kaynağı yapmak. Prod'da `LIVEKIT_INTERNAL_URL` dolu olmalı (mevcut compose değişkeni).

### D-1 (Düşük) — Aynı admin için kimlik çakışması: iki sekme birbirini düşürür
Identity yalnızca `qa-listener-<userId>` (oturuma özgü değil). İkinci sekme/oturum açılınca LiveKit birincisini düşürür; birincinin `onDisconnected` → `leave` çağrısı `removeParticipant(roomName, identity)` ile İKİNCİ (canlı) bağlantıyı da atar. Güvenlik ihlali değil, erişilebilirlik/kayıt tutarsızlığı.
Öneri: identity'ye sessionId ekle (`qa-listener-<userId>-<sessionId8>`; önek kontrolü korunur) veya aynı randevuda açık oturum varken 409.

### D-2 (Düşük) — Token yeniden kullanılabilir
10 dk içinde aynı JWT birden fazla bağlantıda kullanılabilir; tek audit satırı. Token yalnızca istemci belleğinde, ek sızıntı yolu görülmedi. Öneri: D-1 çözümü identity'yi oturuma bağlar.

### D-3 (Düşük) — Geçmiş 200 satırla sessizce kesilir
`:177-186` `take: 200`, joined+left karışık. Çok oturumlu randevuda eski joined satırları kesilir, sayfalama/uyarı yok. Öneri: sayfalama veya yalnızca joined sayısı kadar sınır.

### D-4 (Düşük) — Gerekçe serbest metin KVKK/PII riski
Gerekçe (10-500 kr.) audit'e düz yazılıyor; admin hasta adı/sağlık bilgisi yazabilir. XSS riski yok. Öneri: arayüzde "hasta kimliği/sağlık verisi yazmayın" uyarısı; compliance-agent saklama süresiyle birlikte değerlendirsin.

### B-1 (Bilgi) — İstemci tarafı uyarı yalnızca görüntüleme garantisidir
Banner kullanıcının kendi tarayıcısında çalışır; hasta/doktor devtools ile kendi ekranında gizleyebilir (kendi aleyhine; diğer taraf yine görür). Sunucu zorlaması mümkün değil; kabul edilebilir.

### B-2 (Bilgi) — Doğrulama sırası
Fastify şema doğrulaması preHandler'dan önce çalıştığından, kimliksiz kullanıcı geçersiz gövdeyle 401 yerine 400 görebilir (uç varlığı ifşası, düşük etki; mevcut desenle aynı). Module-guard `authenticate`'ten önce.

### B-3 (Bilgi) — Dinleyici odayı canlı tutar
Katılımcı sayılan dinleyici varken `emptyTimeout/departureTimeout` işlemez; O-2'deki azami süre bunu da kapatır. Egress'in yalnızca açık durdurmayla bittiğini (webhook/participant sayımına bağlı olmadığını) qa-agent doğrulasın.

### B-4 (Bilgi) — Audit satırları uygulama düzeyinde değişmez
`AuditLog` DB düzeyinde salt-ekleme değil; mevcut proje desenidir, bu pakete özgü değil.

## Paket DIŞI mevcut bulgu — `isAuthorizedForMeetingAccess` ADMIN bypass'ı (Yüksek)

`telehealth.livekit.routes.ts:59`: `role === "ADMIN"` → yetkili, `isDoctor:false`; token `patient:<appointmentId>` kimliği ve `canPublish/canPublishData:true` ile verilir. Sonuçlar: (1) Bildirimsiz, `qa_listener` etiketsiz, YAYIN yetkili katılım — bu paketin "gizli katılım yok" ilkesini ve aydınlatma metnindeki "ekranda bildirim gösterilir" taahhüdünü yok eder; (2) 2FA, gerekçe ve audit kaydı yok; MANAGER hariç her ADMIN (2FA'sız dahil) kullanabilir; (3) gerçek hasta ile aynı identity → LiveKit gerçek hastayı odadan düşürür (görüşmeye müdahale); (4) kayıt/egress ve spotlight'ta gerçek hasta gibi görünür.
Seviye değerlendirmem: YÜKSEK (ayrıcalıklı iç kullanıcı gerektirdiği için kritik değil; ama paketin temel güvencesini deliyor). Architect "Orta-Yüksek" dedi; bu paketi bloklamaz görüşüne katılıyorum çünkü paket onu yeni açmıyor, fakat aydınlatma metni canlıya çıkmadan KAPATILMALI.
Öneri (`fix/meeting-token-admin-bypass`): ADMIN dalını kaldır (`meeting-token` hasta/doktor/token sahibine; ADMIN dinleme yalnızca listener-token), gerekirse destek amacıyla ayrı, 2FA+gerekçe+audit'li uç. Taahhüt metnini bu düzeltmeye kadar "ekranda bildirim gösterilir" diye mutlak yazmamak da (compliance) değerlendirilebilir.

## Sonuç

Kritik/yüksek (yeni) bulgu yok; commit bloklanmaz. O-1, O-2, O-3 canlıdan önce önerilir (en azından O-1 ve O-3a hızlı düzeltmeler). Paket dışı ADMIN bypass'ı için takip paketi canlıya alma öncesi tamamlanmalı.
