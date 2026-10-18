# Güvenlik İncelemesi — Paket B1 (Admin 2FA sıfırlama, aktivasyon yeniden gönderme)

Tarih: 2026-10-18 · Branch: fix/auth-doctor-oct18 · İnceleyen: security-agent (salt okunur inceleme)

## Kapsam
- `backend/src/modules/users/admin-users.routes.ts` (GET /:userId, POST /:userId/2fa/reset, POST /:userId/resend-activation)
- `backend/src/lib/security-notice-email.ts`, `backend/src/lib/errors.ts`
- `backend/src/modules/security/security.routes.ts` (/setup, /enable), `requireDoctorPortalAccess` 2FA kapısı
- `backend/src/modules/telehealth/telehealth.admin.routes.ts` arşiv uçları, `mappers/index.ts` archivedReason maskesi
- Testler (`admin-2fa-reset.test.ts`) bu turda çalıştırılmadı; yalnızca kod okundu.

## Bulgular

### ORTA-1 — `/setup` + `/enable` step-up'sız: çalıntı access token ile 2FA sahipliği alınabilir (soru a)
`POST /admin/settings/security/2fa/enable` yalnızca `authenticate` ister. Mevcut 2FA'yı, şifre/TOTP istemeden ve `twoFactorEnabled` zaten true iken bile üzerine yazar. Sıfırlama sonrası access token 15 dk geçerli kalır. Bu sürede çalıntı oturum kendi TOTP'sini kaydedip hesabı kalıcı sahiplenebilir (refresh iptal edildiği için oturum yenilenemez, ama 2FA artık saldırganın cihazına bağlıdır). Bu sorun sıfırlama akışından önce de vardı (mevcut 2FA üzerine yazma), sıfırlama yalnızca kolay hedef penceresi ekliyor. Kabul: 15 dk pencere tek başına kabul edilebilir. Üzerine yazma açığı kabul edilemez.
Öneri (commit'i engellemez, ayrı iş): (1) `/enable` içinde `twoFactorEnabled` zaten true ise 409 dön (değiştirmek için önce `/disable` + şifre). (2) `/enable` ve `/setup` için şifre doğrulaması veya son login'den kısa süre koşulu. (3) Sıfırlama anında kullanıcıya `tokenVersion`/`sessionsValidAfter` benzeri bir alan ile açık access token'ları da düşür (şu an mevcut değilse backlog).

### ORTA-2 — Admin hedef olarak başka ADMIN olabiliyor
Ele geçirilmiş/kötü niyetli bir admin (kendi TOTP'si ile) başka bir admin'in 2FA'sını kaldırabilir; hedef admin için "yeniden kurulum zorunluluğu" yok, yalnızca doktor portalı bu kapıyı uygular. Hedef 2FA'sız kalır.
Öneri: hedef rolü ADMIN ise ya engelle ya da tüm diğer ADMIN'lere bildirim gönder; ADMIN/MANAGER için de girişte 2FA kurulum zorunluluğu uygula (en az bir sonraki login'de).

### DÜŞÜK-1 — TOTP replay (soru b)
`verifyTotp` aynı kodu pencere içinde (~30 sn) tekrar kabul eder; `lastUsedStep` yok. Etki sınırlı: step-up yalnızca ADMIN'e ait, IP+aktör limitli ve kod ayrıca geçerli admin access token'ı gerektirir. Öneri: `twoFactorLastUsedStep` alanı (db-agent) ve login/step-up'ta tek kullanım.

### DÜŞÜK-2 — Rate limit / aktör kilidi (soru c)
- Sağlam yönler: aktör kilidi TOTP doğrulamasından ÖNCE kontrol ediliyor, hedef varlığı kod doğrulandıktan SONRA sorgulanıyor (enumeration yok), 6 haneli kod için 5 hata/15 dk ihmal edilebilir tahmin olasılığı.
- Kilit DoS: ele geçirilmiş admin oturumu, meşru admin'in sıfırlama özelliğini 15 dk kilitleyebilir (yalnız bu uç; diğer işlemler etkilenmez). Kabul edilebilir.
- TOCTOU: sayma ile FAILURE audit yazımı atomik değil; eşzamanlı istekler 5'i biraz aşabilir, ancak IP limiti (5/dk) tavanı sınırlar. Kabul.
- Limiter `authenticate`'ten önce IP anahtarlı: aynı NAT/IP'deki kimliksiz trafik admin'in kovasını tüketebilir. Öneri: `keyGenerator` ile kullanıcı id'si kullanılamıyorsa kabul et; prod TRUST_PROXY doğru olmalı.

### DÜŞÜK-3 — Diğer
- Bildirim e-postası "bir sonraki girişte 2FA kurmanız istenecek" diyor; bu yalnızca doktor portalı için doğru. ADMIN/MANAGER hedeflerde yanıltıcı. Metni role göre uyarla veya genel tut.
- `resend-activation`: eski token'ların iptali ile yeni token oluşturma tek transaction'da değil (küçük yarış, etkisi düşük). Kendine/SUSPENDED/DELETED/lastLoginAt!=null kontrolleri doğru. Rate limit 20/dk uygun.
- 2FA sıfırlama bekleyen `passwordResetToken`'ları iptal etmiyor; e-posta hesabını ele geçirmiş saldırgan için marjinal. Öneri: aynı transaction'da `usedAt` ile kapat.
- Yedek kodla step-up desteklenmiyor (authenticator kaybeden admin sıfırlama yapamaz); güvenlik açısından olumlu, operasyonel not.

### BİLGİ
- (d) Yetki: dosya hook'u authenticate + requirePanelAccess + ADMIN; MANAGER GET dahil 403. IDOR yok (yalnızca ADMIN, zaten tüm kullanıcılara yetkili). `GET /:userId` silinmiş kullanıcıyı da döndürür (liste varsayılanda gizler) — ADMIN için sorun değil, tutarlılık notu.
- (e) E-posta: link/kod/IP yok, ad HTML-escape edilmiş, sabit metin; oltalama malzemesi değil. Temiz.
- (f) Audit metadata: kod, secret, hash yok; `email` (PII) diğer admin audit kayıtlarıyla tutarlı; FAILURE kaydı yalnızca `reason`. Sorun yok.
- Arşiv uçları: doktor archive/unarchive ADMIN+MANAGER, booking archive/unarchive ADMIN, gelecek randevu kontrolü serializable; `archivedReason` DTO'da yalnızca `hasHealthDataAccess` ise dolu (doğru). Arşivlenen doktorun kullanıcı hesabı/portal erişimi bilinçli olarak kapanmıyor; operasyonel not.

## Kalan riskler
ORTA-1 (/enable üzerine yazma + 15 dk access token), ORTA-2 (admin→admin sıfırlama), TOTP replay.

## Karar
KRİTİK: yok · YÜKSEK: yok → commit engellenmez. ORTA-1 ve ORTA-2 için takip işi açılması önerilir (ORTA-1'in `/enable` için 409 kontrolü küçük ve bu pakete eklenmesi tercih edilir).

## Uygulama sonrası durum (ana oturum, 2026-10-18)
Bulgular uygulandı ve testlerle sabitlendi (`backend/tests/integration/admin-2fa-reset.test.ts`):
- **ORTA-1 → kısmen kapatıldı:** `POST /admin/settings/security/2fa/enable`, `twoFactorEnabled=true` iken `409` döner (üzerine yazma yok). Test: "etkin 2FA, /2fa/enable ile üzerine yazılamaz". **Kalan:** sıfırlama anında elde olan access token ≤15 dk geçerli; bu sürede 2FA kapalı hesapta `/setup`+`/enable` yapılabilir (refresh iptal edildiği için oturum uzatılamaz). Takip: `sessionsValidAfter` benzeri access token iptali + `/setup`/`/enable` için şifre şartı (backlog).
- **ORTA-2 → kapatıldı:** hedef ADMIN ise `403 FORBIDDEN` ("Başka bir yöneticinin 2FA'sı bu yolla sıfırlanamaz."). Test eklendi. ADMIN/MANAGER için zorunlu 2FA kurulumu ayrı bir iş (backlog).
- **DÜŞÜK-3 → kapatıldı:** e-posta metni genelleştirildi ("…yeniden kurmanız gerekebilir"); sıfırlama aynı transaction'da bekleyen `passwordResetToken`'ları `usedAt` ile kapatır (test eklendi); `resend-activation` iptal+oluşturma tek transaction.
- **DÜŞÜK-1 (TOTP replay) → kalan risk**, `twoFactorLastUsedStep` alanı ayrı migration gerektirir (backlog).
- **DÜŞÜK-2 → kabul** (prod `TRUST_PROXY=true`, INFRA.md).
