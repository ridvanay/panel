# Paket G — Güvenlik incelemesi (2026-10-19)

Kapsam: `git log 10bcd2b..HEAD` (9 commit). İnceleyici kodu değiştirmedi, test koşmadı.
Doğrulama: `git diff 10bcd2b` — telehealth.livekit.routes.ts, lib/livekit-egress.ts, telehealth.egress-webhook.routes.ts, telehealth.recording*.ts BOŞ. lib/livekit.ts'te `createMeetingToken` değişmemiş (yalnız QA dinleyici kimliği/`listRoomParticipantIdentities` eklendi).

Sonuç: yeni KRİTİK veya YÜKSEK bulgu YOK. Commit bloklanmaz.

## Madde durumları
1. TOTP replay (ac99b81): KAPATILDI. `verifyAndConsumeTotp` adımı atomik `updateMany (step < yeni)` ile tüketir; giriş, admin 2FA reset step-up, staff-2FA PUT bu yoldan geçer. `/2fa/enable` şifre + atomik `twoFactorEnabled:false` koşulu + adım kaydı. Yedek kod `updateMany usedAt:null` ile atomik.
2. sessionsValidAfter (53f65f3): KAPATILDI. `ims` claim'i RS256 imzalı içinde (sahte üretilemez); eksik/sayısal olmayan `ims` -> `iat*1000` (güvenli yönde sıkı). Sıfırlama/şifremi unuttum/admin şifre/break-glass damga atar. `authenticate` ve `authenticateOptional` kontrol eder.
3. revokeOtherSessions (3784fa9): KAPATILDI. Varsayılan davranış gevşemedi; true iken sva=now + diğer refresh'ler iptal + yalnız mevcut oturuma yeni token. Oturum sabitleme yok (mevcut şifre zorunlu).
4. /2fa/enable şifre (eee4993): KAPATILDI (hata mesajı /disable ile aynı, denetim kaydı var, SENSITIVE rate limit eklendi).
5. Dinleyici kimliği + sayfalama (c1fd9d7): KAPATILDI (D-1, D-2, D-3).
6. Sweeper (45447fd): KISMEN/KAPATILDI — O-2/B-3 kapandı; aşağıdaki D-1 (yarış) açık küçük risk. O-3b için bkz. altta.
7. Personel zorunlu 2FA (4a29b5c): KAPATILDI, aşağıdaki orta/düşük notlarla. Varsayılan KAPALI. Tüm `/admin/*` uçları `requireSiteRole`/`requirePanelAccess` (= requireSiteRole) üzerinden; guard'ı atlayan /admin ucu bulunamadı (kalan authenticate-only uçlar: `/admin/settings/security/{2fa,sessions}` — bilinçli muaf; `/auth/*`, `/users/*`).

## Bulgular
### O-1 (Orta) — Son 2FA'lı admin koruması kontrol-sonra-işlem; /2fa/disable'da transaction dışı
`lib/staff-two-factor.ts:50-60`, `security.routes.ts:157`. İki 2FA'lı admin aynı anda birbirinin korumasını geçip ikisi de 2FA'yı kapatabilir (her biri diğerini "kalan" sayar) -> zorunluluk aktifken politikayı yönetebilecek 2FA'lı admin kalmaz. admin-users uçları tx içinde ama Serializable olduğu doğrulanmadı (`runSerializable` yalnız bazılarında). Etki: kendiliğinden iyileşir değil, break-glass gerekir (kilitlenme değil, kurtarma yolu var). Öneri: `/disable`'ı Serializable tx içinde yap veya `SELECT ... FOR UPDATE` ile admin satırlarını kilitle.

### D-1 (Düşük) — Sweeper: yeni açılan oturumu "kaçak" sayıp atabilir
`qa-listener-sweeper.ts:101-118,150-170`. `joinedRows` taramanın başında okunur; sonrasında (LiveKit çağrıları sürerken) açılıp bağlanan yeni oturumun kimliği `stillValidIdentities`'te yoktur; oda listesi sonradan okunduğu için "stray" diye atılır. Pencere milisaniye-saniye, etki: dinleyici yeniden katılır, audit'te `stray_removed` görünür. Hasta/doktor etkilenmez (`removeListener` önek kapısı doğru; throw ile korumalı). Öneri: stray atmadan önce `joined` satırını yeniden sorgula veya yalnız `createdAt < taramaBaşlangıcı - 30sn` olan kimlikleri atma değil, kimlik->oturum eşlemesini atma anında yeniden doğrula.

### D-2 (Düşük) — Break-glass: kullanıcıya bildirim ve ikinci onay yok
`lib/break-glass-two-factor.ts`. Dry-run varsayılan, `--confirm` e-posta eşleşmesi, operatör adı + osUser + hostname audit'te, audit aynı transaction içinde (fail-open değil) — iyi. Eksik: hedefe e-posta bildirimi gitmez (panelden sıfırlamada `sendTwoFactorResetNotice` gidiyor), operatör/osUser kendi beyanı. Shell erişimi zaten DB erişimi olduğundan kabul edilebilir. Öneri: ileride aynı bildirim e-postası; runbook'ta kullanıcıyı ayrı kanaldan bilgilendirme adımı zaten var.

### D-3 (Düşük) — Staff-2FA PUT ve admin-reset'te deneme sayacı yok
`settings.staff-two-factor.routes.ts:62-100`. Yalnız `SENSITIVE_ACTION_RATE_LIMIT` var (admin 2FA reset'teki 15 dk hatalı-deneme sayacı yok). Şifre+TOTP birlikte gerektiği için pratik risk düşük. Tarih kontrolünün step-up'tan önce olması bilgi sızıntısı DEĞİL (yalnız herkese açık 7 gün kuralı; kullanıcı zaten 2FA'lı admin olarak doğrulanmış) ve TOTP'nin boşa tüketilmesini önler; uygun.

### D-4 (Düşük) — Kilitlenme senaryoları (değerlendirme)
- Zorunluluk aktif + 2FA'sız tek ADMIN: kurulum uçları muaf, kendi başına 2FA kurar; politikayı ise yalnız 2FA'lı admin açabilir (açma sırası güvenli). Sorun yok.
- Son 2FA'lı admin: rol/askı/silme/disable engelli (bkz. O-1 yarış). Admin->admin UI reset yasağı (ORTA-2) bilinçli; çözüm break-glass. Break-glass sonrası: sva=now, tüm refresh iptal, 2FA temiz; admin giriş yapınca kurulum sayfasına yönlenir (muaf uçlar yeterli). Sorun yok.
- Kapıdan muaf olmayan ama admin açılışında çağrılabilecek uçlar (bildirim merkezi vb.) 403 `TWO_FACTOR_SETUP_REQUIRED` alır; kabuk bu durumda yalnız kurulum sayfasını mount ediyor, notification-center sessizce yutuyor. Başka bir sayfa/hook'un kabuk dışı `/admin/*` çağrısı varsa yalnızca hata toast'ı olur (güvenlik değil, UX).

### B-1 (Bilgi) — Sweeper `LIVEKIT_INTERNAL_URL` boşsa atamaz
Kayıt `removed:false` ile kapanır (dürüst), sonraki turda stray temizliği de çalışmaz. Prod'da değişkenin dolu olması şart (mevcut not).

### B-2 (Bilgi) — Challenge token karşılaştırması <=1 sn gevşek
`auth.routes.ts:190-193`; saniyelik `iat` yüzünden kabul edilmiş, yazılı. Sıfırlamayla aynı saniyedeki eski challenge geçebilir; TOTP ayrıca gerektiği için pratik etki yok.

## Ertelenen O-3b (çıkış/giriş zamanı yetkili değil)
Kısmen hafifledi: `leave` istemci beyanı olsa da sweeper, `left` kaydı olan kimliği `stillValid` saymaz; erken "çıktı" yazıp odada kalan dinleyici <=60 sn'de atılır ve `stray_removed` denetime düşer. Giriş = token üretimi (bağlanma kanıtı) hâlâ geçerli. Tam çözüm LiveKit `participant_joined/left` webhook'u (mevcut egress webhook dosyasına dokunur -> kullanıcı kuralı gereği bu pakette doğru ertelendi). Seviye: düşük; ertelemeyi onaylıyorum, `LIVEKIT_INTERNAL_URL` prod'da dolu olmalı.
