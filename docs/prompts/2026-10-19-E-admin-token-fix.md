# Paket E: Meeting-token'daki ADMIN kestirmesini kapat (2026-10-19)

**Mod: Tam akış, KIRMIZI ÇİZGİ İSTİSNASI (kullanıcı onaylı).** Kapsam TEK bir yetki kuralı. Ajanlar: **security-agent** (zorunlu) ve **integration-agent** (zorunlu). Testleri ana oturum kendisi çalıştırır.

**Branch:** `git fetch origin && git switch -c fix/meeting-token-admin-bypass feature/admin-qa-listener`. Bu branch Paket C'nin (`17c9222`) üzerine kurulur; C ve E birlikte canlıya alınacak. Başlangıç commit'ini doğrula. Yalnızca kendi dosyalarını commit'le, push etme.

## Sorun (Paket C raporundaki bulgu)
`backend/src/modules/telehealth/telehealth.livekit.routes.ts::isAuthorizedForMeetingAccess` içinde şu satır var:
`if (request.user.role === "ADMIN") return { authorized: true, isDoctor: false };`

Bu satır yüzünden ADMIN rolündeki herhangi bir kullanıcı `POST /appointments/:id/meeting-token` ile **hasta kimliğinde (`patient:<id>`) ve yayın yetkili** bir token alabiliyor. Bu yolda bildirim, 2FA, gerekçe ve kayıt yok. Ayrıca bu token gerçek hastayı aynı kimlikle odadan düşürebiliyor ve SCHEDULED bir randevuyu IN_PROGRESS'e çevirebiliyor. Bu durum, Paket C'nin "gizli katılım yok" garantisini deliyor. security-agent bu bulguya "Yüksek" seviye vermişti.

## Yapılacak
- Bu ADMIN dalını **kaldır.** Admin artık görüşmeye yalnızca Paket C'deki bildirimli dinleyici ucuyla (`/admin/telehealth/appointments/:id/listener-token`) katılabilir.
- **Davranış korunacak:**
  - Admin aynı zamanda o randevunun hastasıysa (`patientUserId === user.id`) ya da doktoruysa (`doctor.userId === user.id`) erişim sürer.
  - Token ile (`?t=`) hasta erişimi aynen kalır.
  - Doktor ve hasta token'larının identity'si, grant'ları ve TTL'i hiç değişmez.
- Aynı dosyada `viaAdmin` audit alanı (~satır 191) ve `isAdmin` kullanımı (~satır 219) var. Bunların bu değişiklikten sonra ölü kod mu olduğunu, yoksa başka bir uçta (ör. complete, not) admin yetkisi mi sağladığını incele.
  - **Yalnızca meeting-token yolunu kapat.** Admin'in başka uçlardaki yetkilerine (randevu iptali, kayıt erişimi vb.) DOKUNMA.
  - Ölü kalan kod varsa temizle ve rapora yaz.
- Frontend'de admin için meeting-token çağıran bir yer var mı, tara (ör. admin panelinde "Görüşmeye katıl" butonu). Varsa kaldır ya da Paket C'deki dinleyici akışına yönlendir.
- `openapi.yaml`'daki meeting-token açıklamasını güncelle: "ADMIN yalnızca hasta ya da doktorsa erişebilir; denetim için listener-token ucu kullanılır."

## Test
- **Yeni entegrasyon testleri:**
  - Randevuyla ilgisi olmayan bir ADMIN meeting-token isteğinde **403** (ya da mevcut yetkisiz kodu) alır; randevu durumu ve `startedAt` değişmez.
  - Randevunun hastası olan bir ADMIN token alabilir (identity `patient:`).
  - Randevunun doktoru olan bir kullanıcı token alabilir.
  - Doğru `?t=` ile anonim hasta token alabilir.
  - Yanlış ya da eksik token ile istek reddedilir.
- **KIRMIZI ÇİZGİ testlerinin tamamı:** `telehealth-livekit` (unit + entegrasyon), `telehealth-bookings`, `telehealth-qa-regression`, `telehealth-recording`, `telehealth-qa-listener`, frontend `consultation-room-*`, `booking-wizard-stale-recovery`.
  - Mevcut testlerden biri ADMIN kestirmesine dayanıyorsa, testi hasta veya doktor kullanıcısıyla güncelle ve bunu rapora yaz.
- **Paralel koşuda deadlock dalgalanması:** Önceki turlarda görüldü. Ajanların test DB'sinde eşzamanlı test KOŞTURMAMASINI sağla; ajanlar yalnızca kodu incelesin.

## Rapor
`docs/prompts/2026-10-19-E-RAPOR.md`: değişen satırlar (diff özeti), security-agent ve integration-agent sonuçları, test tablosu, canlıya alma notu (migration yok; C ile birlikte backend + frontend).
