import type { FastifyInstance } from "fastify";
import type { User } from "@prisma/client";

// [TCT] §9.7.7 KARAR K3 (bağlayıcı) — `toUserDto`/`toAdminUserDto`'nun gerektirdiği `doctorProfile`
// İLİŞKİSİ ile GENİŞLETİLMİŞ `User` — `mappers/index.ts::UserWithDoctorLink` İLE AYNI şekil.
type UserWithDoctorLink = User & { doctorProfile: { id: string } | null };
import { hashPassword, verifyPassword } from "../../lib/password";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import { signAccessToken, signChallengeToken } from "../../lib/jwt";
import { ConflictError, UnauthorizedError, NotFoundError, ForbiddenError } from "../../lib/errors";
import { issueVerificationCode, consumeVerificationCode, RESEND_COOLDOWN_MS } from "../../lib/otp";
import { toUserDto } from "../../mappers";
import { env } from "../../config/env";
import { sendPasswordResetEmail, sendEmailVerificationCode, sendAccountActivationEmail } from "../email-templates/email-templates.service";

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Bug-fix turu (2026-09-18, kullanıcı onaylı — bkz. görev notu) — YALNIZCA
 * `NODE_ENV === "development"` iken (asla production/test) çalışır. Amaç: gerçek SMTP
 * gönderimi dev'de de başarısız olursa (dev'de SMTP hiç yapılandırılmamışsa zaten otomatik bir
 * Ethereal test hesabı kullanılır ve `lib/mail.ts::sendMail` KENDİ `previewUrl`'ini loglar —
 * bu yalnızca O yolun DA başarısız olduğu nadir durum İÇİNDİR, örn. Ethereal'e internet
 * erişimi yok) geliştiriciye e-postayı hiç görmeden test etmeye devam edebileceği bir kaçış
 * kapısı sağlamak.
 *
 * **BİLİNÇLİ OLARAK YAPILMAYAN İki şey** (görev talimatı bunları istedi, güvenlik gerekçesiyle
 * REDDEDİLDİ): (1) kod production log'larına ASLA yazılmaz — `lib/mail.ts::sendMail`'in "hassas
 * veri LOGLANMAZ" disiplini burada da geçerlidir; (2) sabit/evrensel bir "fallback kod" (ör.
 * `123456`) İCAT EDİLMEZ — bu, `lib/otp.ts`'in HMAC-biberleme + deneme-sınırı + sabit-zamanlı
 * karşılaştırma korumalarının TAMAMINI atlayan bir kimlik doğrulama backdoor'u olurdu
 * (`.claude/security-review-guest-account-otp.md` KARAR 1'i doğrudan ihlal eder).
 */
function logDevFallbackOtpCode(app: FastifyInstance, userId: string, email: string, code: string): void {
  if (env.NODE_ENV !== "development") return;
  app.log.warn({ userId, email, code }, "[AUTH_OTP] E-posta gönderilemedi (yalnızca dev ortamı) — doğrulama kodu yukarıda");
}

export interface TokenIssue {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
}

/** `login()` (şifre doğru + 2FA kapalı) ve `POST /auth/2fa/verify` (2FA doğrulandıktan sonra) tarafından paylaşılır. */
export async function issueTokenPair(app: FastifyInstance, user: User, meta: RequestMeta): Promise<TokenIssue> {
  const { token: accessToken, expiresAt: accessTokenExpiresAt } = signAccessToken({
    sub: user.id,
    email: user.email,
  });

  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await app.prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    },
  });

  return { accessToken, accessTokenExpiresAt, refreshToken };
}

export interface RegisterResult {
  email: string;
  expiresAt: Date;
  resendAvailableAt: Date;
}

/**
 * `.claude/architect-scope-guest-account-otp.md` §2 (bağlayıcı) — **DEĞİŞTİ.** Artık token/cookie
 * DÖNDÜRMEZ; `User.emailVerifiedAt = null` ile bir kullanıcı oluşturur, 6 haneli bir
 * `EMAIL_VERIFICATION` kodu üretir ve e-postayla gönderir. Token çifti YALNIZCA
 * `POST /auth/verify-email` başarılı olduğunda üretilir (`issueTokenPair`, yeni bir token yolu
 * İCAT EDİLMEZ). `middleware/authenticate.ts` HİÇ DEĞİŞMEDİ.
 */
export async function register(
  app: FastifyInstance,
  input: { email: string; password: string; name: string },
  _meta: RequestMeta
): Promise<RegisterResult> {
  const email = input.email.toLowerCase();
  const existing = await app.prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictError("Bu e-posta adresi zaten kayıtlı.");
  }

  // Sıfırdan kurulan bir ortamda ilk kayıt olan kullanıcı otomatik ADMIN olur —
  // aksi halde `/admin/*` uçlarına erişebilecek hiç kimse olmaz (kilitlenme). Sonraki HER
  // kayıt `role: undefined` bırakılır → şema varsayılanı devreye girer —
  // `.claude/architect-scope-rbac-5-tier.md` §7.1 gereği bu artık `USER`'dır (eski: `VIEWER`).
  // `POST /auth/register` PUBLIC'tir; varsayılanın panele erişimi olan bir role (EDITOR/MANAGER)
  // düşmesi doğrudan bir güvenlik açığı olurdu — bu satırın kendisi DEĞİŞMEDİ, yalnızca şema
  // varsayılanının anlamı değişti. `emailVerifiedAt` de ŞEMA VARSAYILANINA (`null`) bırakılır —
  // bu ADMIN kuralıyla İLİŞKİSİZDİR, yeni her hesap (ilk ADMIN dahil) doğrulama BEKLER.
  const userCount = await app.prisma.user.count();

  const passwordHash = await hashPassword(input.password);
  const user = await app.prisma.user.create({
    data: { email, passwordHash, name: input.name, role: userCount === 0 ? "ADMIN" : undefined },
  });

  // §2.1/§3.6 — taze oluşturulmuş bir `userId` için HİÇBİR önceki `EmailVerificationCode` satırı
  // var OLAMAZ, dolayısıyla cooldown/tavan kısıtları doğal olarak devre dışı kalır (§3.6,
  // "register kaynaklı ilk gönderim bu iki kısıttan MUAFTIR" — ayrı bir bayrak GEREKMEZ).
  const issued = await issueVerificationCode(app, user.id, "EMAIL_VERIFICATION");
  /* istanbul ignore next — taze kullanıcı için pratikte imkânsız, yalnızca savunma amaçlı. */
  if (!issued) {
    throw new Error("E-posta doğrulama kodu üretilemedi (beklenmedik durum).");
  }

  // Doğrulama kodu e-postası best-effort'tur (mevcut `sendWelcomeEmail` deseniyle AYNI disiplin,
  // bkz. eski `register()`): gönderim başarısız olsa da kayıt işlemi geri alınmaz — DB satırı
  // (kod dahil) zaten yazılmıştır, kullanıcı `POST /auth/resend-verification-code` ile yeniden
  // deneyebilir. `forgotPassword`'dan KASITLI OLARAK FARKLI (orada kullanıcı VARLIĞI zaten bilinen
  // bir bilgidir ve sıfırlama LİNKİ tek kurtarma yoludur) — burada `resend` her zaman bir
  // kaçış kapısıdır, register() akışını SMTP kullanılabilirliğine BAĞIMLI kılmak istemiyoruz.
  try {
    await sendEmailVerificationCode(app, { email: user.email, name: user.name }, issued.code, issued.expiresAt);
  } catch (err) {
    app.log.error({ err, userId: user.id }, "Doğrulama kodu e-postası gönderilemedi (register)");
    logDevFallbackOtpCode(app, user.id, user.email, issued.code);
  }

  return {
    email: user.email,
    expiresAt: issued.expiresAt,
    resendAvailableAt: new Date(Date.now() + RESEND_COOLDOWN_MS),
  };
}

/**
 * §10.4 Güvenlik & 2FA — `login()`'ün ÜÇ farklı sonucunu ayırt eden discriminated union.
 * `.claude/architect-scope-guest-account-otp.md` §2.3 (bağlayıcı) — YENİ `emailVerificationRequired` dalı.
 */
export type LoginResult =
  | { twoFactorRequired: true; emailVerificationRequired: false; challengeToken: string }
  | { twoFactorRequired: false; emailVerificationRequired: true; email: string }
  | { twoFactorRequired: false; emailVerificationRequired: false; user: UserWithDoctorLink; tokens: TokenIssue };

export async function login(
  app: FastifyInstance,
  input: { email: string; password: string },
  meta: RequestMeta
): Promise<LoginResult> {
  const user = await app.prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: { doctorProfile: { select: { id: true } } },
  });
  // E-posta ve şifre hatalarını ayırt etmiyoruz: hangi alanın yanlış olduğunu sızdırmamak için.
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new UnauthorizedError("E-posta veya şifre hatalı.");
  }

  // `authenticate()`/`refresh()` zaten SUSPENDED/DELETED kullanıcıları reddediyor (bkz.
  // middleware/authenticate.ts), yani askıya alınmış/silinmiş biri buradan geçse bile hiçbir
  // korumalı uca erişemez. Ama burada erken reddetmezsek: (a) kullanıcıya kafa karıştırıcı
  // şekilde "giriş başarılı, tokenlar alındı" izlenimi verilip bir sonraki istekte 403 ile
  // karşılaşılır, (b) kullanılamayacak bir refresh token DB'ye yazılır, (c) audit log'da
  // askıya alınmış/silinmiş bir hesap için yanıltıcı bir "auth.login SUCCESS" kaydı oluşur.
  // `DELETED` için de KASITLI OLARAK aynı jenerik mesaj kullanılır (authenticate.ts ile
  // tutarlı) — "hesabınız silindi" gibi ayrı bir mesaj, bir e-postanın geçmişte var olup
  // sonradan silindiğini sızdırırdı (bkz. güvenlik değerlendirmesi).
  if (user.status === "SUSPENDED" || user.status === "DELETED") {
    throw new ForbiddenError("Hesabınız askıya alınmış.");
  }

  // `.claude/architect-scope-guest-account-otp.md` §2.3 (bağlayıcı) — şifre+status kontrolünden
  // SONRA, 2FA dalından ÖNCE. `emailVerifiedAt === null` ise token ÜRETİLMEZ. Backfill migration'ı
  // (§2.4) TÜM mevcut kullanıcıları grandfather ettiği için bu dal YALNIZCA bu özellikten SONRA
  // oluşturulan hesaplarda tetiklenir — mevcut kullanıcıların girişi DEĞİŞMEZ. **Kod OTOMATİK
  // GÖNDERİLMEZ** — istemci `POST /auth/resend-verification-code` ile açıkça ister.
  if (user.emailVerifiedAt === null) {
    return { twoFactorRequired: false, emailVerificationRequired: true, email: user.email };
  }

  // §10.4: 2FA açıksa şifre doğru olsa bile token çifti HEMEN verilmez — önce
  // POST /auth/2fa/verify ile TOTP/backup kodu doğrulanmalı (bkz. modules/security).
  if (user.twoFactorEnabled) {
    const challengeToken = signChallengeToken(user.id);
    return { twoFactorRequired: true, emailVerificationRequired: false, challengeToken };
  }

  await app.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const tokens = await issueTokenPair(app, user, meta);
  return { twoFactorRequired: false, emailVerificationRequired: false, user, tokens };
}

/**
 * `.claude/architect-scope-guest-account-otp.md` §2/§4 (bağlayıcı) — kodu doğrular,
 * `emailVerifiedAt`i SET EDER, kodu tüketir ve normal login ile BİREBİR AYNI token çiftini üretir.
 * **YALNIZCA `EMAIL_VERIFICATION` amaçlı kodları kabul eder** (§4.5, amaç bağlaması —
 * `consumeVerificationCode`'un `purpose` filtresiyle DOĞAL olarak sağlanır).
 */
export async function verifyEmail(
  app: FastifyInstance,
  input: { email: string; code: string },
  meta: RequestMeta
): Promise<{ user: UserWithDoctorLink; tokens: TokenIssue }> {
  const user = await app.prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: { doctorProfile: { select: { id: true } } },
  });

  // §4.3/security-review §4.3 netleştirmesi — `userId === null` OLSA BİLE gerçek bir
  // HMAC+timingSafeEqual+DB sorgusu çalıştırılır (erken `return` YOK, zamanlama tutarlılığı).
  await consumeVerificationCode(app, user?.id ?? null, "EMAIL_VERIFICATION", input.code);
  /* istanbul ignore next — `consumeVerificationCode` userId=null iken HER ZAMAN fırlatır, bu satıra ulaşılamaz. */
  if (!user) {
    throw new UnauthorizedError();
  }

  const verifiedUser = await app.prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date() },
    include: { doctorProfile: { select: { id: true } } },
  });

  const tokens = await issueTokenPair(app, verifiedUser, meta);
  return { user: verifiedUser, tokens };
}

/**
 * §3.5 (bağlayıcı) — gövde YALNIZCA `email` taşır. Amaç sunucuda türetilir: kullanıcının EN SON
 * `EmailVerificationCode` satırının amacı; hiç satırı yoksa `EMAIL_VERIFICATION`. Yanıt HER
 * KOŞULDA `202`dir (route seviyesinde) — bu fonksiyon HİÇBİR ZAMAN fırlatmaz, sessizce döner.
 *
 * security-review KARAR 7.2 (bağlayıcı SIKILAŞTIRMA) — e-posta gönderimi çağıranın `202`
 * yanıtını BLOKLAMAMALIDIR (SMTP round-trip'in yanıt süresine sızıp bir zamanlama oracle'ı
 * açmaması için); bu yüzden gönderim burada `void` + `.catch(...)` ile fire-and-forget yapılır.
 */
export async function resendVerificationCode(app: FastifyInstance, email: string): Promise<void> {
  const user = await app.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return; // enumeration koruması — sessizce çık.
  if (user.emailVerifiedAt !== null) return; // zaten doğrulanmış — AYNI ayırt edilemezlik.

  const latest = await app.prisma.emailVerificationCode.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { purpose: true },
  });
  const purpose = latest?.purpose ?? "EMAIL_VERIFICATION";

  const issued = await issueVerificationCode(app, user.id, purpose);
  if (!issued) return; // cooldown/günlük tavan — sessizce çık, e-posta GÖNDERİLMEZ.

  // Fire-and-forget (security-review KARAR 7.2, bağlayıcı) — `await` EDİLMEZ.
  const sendPromise =
    purpose === "EMAIL_VERIFICATION"
      ? sendEmailVerificationCode(app, { email: user.email, name: user.name }, issued.code, issued.expiresAt)
      : resolveActivationBookingNumber(app, user.id).then((bookingNumber) =>
          sendAccountActivationEmail(app, { email: user.email, name: user.name }, issued.code, issued.expiresAt, bookingNumber)
        );

  void sendPromise.catch((err) => {
    app.log.error({ err, userId: user.id, purpose }, "Doğrulama/aktivasyon kodu e-postası gönderilemedi (resend)");
    logDevFallbackOtpCode(app, user.id, user.email, issued.code);
  });
}

/** `ACCOUNT_ACTIVATION` yeniden gönderiminde e-postanın `booking_number` değişkeni için — booking bulunamazsa boş bırakılır. */
async function resolveActivationBookingNumber(app: FastifyInstance, userId: string): Promise<string> {
  const booking = await app.prisma.appointmentBooking.findFirst({
    where: { patientUserId: userId },
    orderBy: { createdAt: "desc" },
    select: { bookingNumber: true },
  });
  return booking?.bookingNumber ?? "";
}

/**
 * `.claude/architect-scope-guest-account-otp.md` §5/§4.4 (bağlayıcı) + `.claude/security-review-
 * guest-account-otp.md` KARAR 5 (bağlayıcı SIKILAŞTIRMA) — misafir randevu ödemesiyle açılmış
 * hesabı aktive eder: kod doğrulaması + İLK parolanın belirlenmesi TEK istekte yapılır.
 * **YALNIZCA `ACCOUNT_ACTIVATION` amaçlı kodları kabul eder** (§4.5).
 *
 * Başarıda TEK transaction'da: `passwordHash`i belirler → `emailVerifiedAt`i SET EDER →
 * kullanıcının TÜM canlı refresh token'larını iptal eder → security-review KARAR 5 (YENİ,
 * bağlayıcı): kullanıcıya bağlı TÜM `AppointmentBooking` satırlarının `accessTokenHash`'i
 * rotate edilir (saldırganın elindeki eski misafir magic-link'i bu andan itibaren ÖLÜR).
 *
 * Kod tüketimi (`consumeVerificationCode`) BU transaction'ın DIŞINDA, ÖNCE yapılır —
 * `lib/otp.ts` dosya-başı yorumundaki bilinçli tasarım kararına bakınız: başarısız bir denemenin
 * `attemptCount` artırımı, sonraki bir transaction rollback'iyle ASLA silinmemelidir.
 */
export async function activateAccount(
  app: FastifyInstance,
  input: { email: string; code: string; password: string },
  meta: RequestMeta
): Promise<{ user: UserWithDoctorLink; tokens: TokenIssue }> {
  const user = await app.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });

  await consumeVerificationCode(app, user?.id ?? null, "ACCOUNT_ACTIVATION", input.code);
  /* istanbul ignore next — `consumeVerificationCode` userId=null iken HER ZAMAN fırlatır. */
  if (!user) {
    throw new UnauthorizedError();
  }

  const passwordHash = await hashPassword(input.password);

  await app.prisma.$transaction([
    app.prisma.user.update({ where: { id: user.id }, data: { passwordHash, emailVerifiedAt: new Date() } }),
    app.prisma.refreshToken.updateMany({ where: { userId: user.id, revoked: false }, data: { revoked: true } }),
    // security-review KARAR 5 (bağlayıcı, YENİ) — aktivasyon anında, kullanıcıya bağlı TÜM
    // booking'lerin `accessTokenHash`'i rotate edilir. Üretilen ham token HİÇBİR YERE
    // yazılmaz/loglanmaz — kullanıcı artık portal üzerinden (oturum) erişir, eski magic-link'e
    // ihtiyacı yoktur (bu KASITLIDIR).
    app.prisma.appointmentBooking.updateMany({
      where: { patientUserId: user.id },
      data: { accessTokenHash: hashToken(generateOpaqueToken()) },
    }),
  ]);

  const activatedUser = await app.prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { doctorProfile: { select: { id: true } } },
  });

  const tokens = await issueTokenPair(app, activatedUser, meta);
  return { user: activatedUser, tokens };
}

export async function refresh(app: FastifyInstance, rawRefreshToken: string | undefined, meta: RequestMeta) {
  if (!rawRefreshToken) {
    throw new UnauthorizedError("Refresh token bulunamadı.");
  }

  const tokenHash = hashToken(rawRefreshToken);
  const existing = await app.prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!existing) {
    throw new UnauthorizedError("Geçersiz refresh token.");
  }

  if (existing.revoked) {
    // Zaten iptal edilmiş bir token tekrar kullanılmaya çalışıldı — çalıntı token belirtisi.
    // Önlem: kullanıcının tüm oturumlarını sonlandır.
    await app.prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revoked: false },
      data: { revoked: true },
    });
    throw new UnauthorizedError("Oturum güvenlik nedeniyle sonlandırıldı, lütfen tekrar giriş yapın.");
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("Refresh token süresinin dolmuş.");
  }

  const user = await app.prisma.user.findUnique({ where: { id: existing.userId } });
  if (!user) {
    throw new UnauthorizedError();
  }
  // `DELETED` (yumuşak silme) `SUSPENDED` ile aynı şekilde reddedilir — bkz. login()'deki
  // gerekçe ve middleware/authenticate.ts. Silme zaten bu kullanıcının TÜM refresh token'larını
  // iptal eder, ama bu kontrol defense-in-depth'tir (ör. iptal işlemi eksik/gecikmeli kalırsa).
  if (user.status === "SUSPENDED" || user.status === "DELETED") {
    throw new ForbiddenError("Hesabınız askıya alınmış.");
  }

  const { token: accessToken, expiresAt: accessTokenExpiresAt } = signAccessToken({
    sub: user.id,
    email: user.email,
  });
  const newRefreshToken = generateOpaqueToken();
  const newExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const newTokenHash = hashToken(newRefreshToken);

  await app.prisma.$transaction([
    app.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revoked: true, replacedByTokenHash: newTokenHash },
    }),
    app.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newTokenHash,
        expiresAt: newExpiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    }),
  ]);

  return { accessToken, accessTokenExpiresAt, refreshToken: newRefreshToken };
}

export async function logout(app: FastifyInstance, rawRefreshToken: string | undefined) {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  await app.prisma.refreshToken.updateMany({
    where: { tokenHash, revoked: false },
    data: { revoked: true },
  });
}

/**
 * Şifre sıfırlama token'ı üretir ve DB'ye (hash'lenmiş) kaydeder. `forgotPassword`
 * (kullanıcı kendi başlatır) ve admin-users modülündeki yeni kullanıcı oluşturma akışı
 * (admin başlatır, kullanıcı ilk şifresini böyle belirler) bu fonksiyonu paylaşır.
 */
export async function createPasswordResetToken(app: FastifyInstance, userId: string): Promise<string> {
  const rawToken = generateOpaqueToken();
  await app.prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return rawToken;
}

export async function forgotPassword(app: FastifyInstance, email: string) {
  const user = await app.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Kullanıcı yoksa sessizce çık — e-posta enumeration'ı önlemek için route her zaman 202 döner.
  // (Bu davranış SADECE "kullanıcı yok" durumu için geçerli — aşağıda "kullanıcı var ama gönderim
  // başarısız oldu" durumunda hatayı BİLEREK yutmuyoruz, bkz. sendPasswordResetEmail çağrısı.)
  if (!user) return;

  const rawToken = await createPasswordResetToken(app, user.id);
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;

  // Gerçek SMTP hatası (kullanıcı var, gönderim başarısız) burada YUTULMAZ — sendMail() zaten
  // app.log.error ile stack + hedef adresi (asla token/şifre) loglar ve EmailDeliveryError (502)
  // fırlatır; bu hata route'a kadar yükselip anlamlı bir hata olarak döner (bkz. lib/errors.ts).
  await sendPasswordResetEmail(app, { email: user.email, name: user.name }, resetUrl);
}

export async function resetPassword(app: FastifyInstance, rawToken: string, newPassword: string) {
  const tokenHash = hashToken(rawToken);
  const resetToken = await app.prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("Geçersiz veya süresi dolmuş sıfırlama bağlantısı.");
  }

  const passwordHash = await hashPassword(newPassword);

  // `.claude/architect-scope-guest-account-otp.md` §2.5 (bağlayıcı) — başarılı sıfırlamada
  // `emailVerifiedAt` NULL ise onu da SET eder (AYNI transaction). Bir posta kutusuna gönderilen
  // tek kullanımlık sıfırlama bağlantısının kullanılması, 6 haneli bir OTP'den DAHA GÜÇLÜ bir
  // posta kutusu sahipliği kanıtıdır — bu, ADMIN'in oluşturduğu kullanıcılar/org davetleri/
  // aktivasyon kodu süresi dolan Özellik B kullanıcıları için TEK kaçış kapısıdır (§5.6).
  const user = await app.prisma.user.findUniqueOrThrow({ where: { id: resetToken.userId } });

  await app.prisma.$transaction([
    app.prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, ...(user.emailVerifiedAt === null ? { emailVerifiedAt: new Date() } : {}) },
    }),
    app.prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
    app.prisma.refreshToken.updateMany({
      where: { userId: resetToken.userId, revoked: false },
      data: { revoked: true },
    }),
  ]);
}

export async function getSession(app: FastifyInstance, userId: string) {
  const user = await app.prisma.user.findUnique({
    where: { id: userId },
    include: { doctorProfile: { select: { id: true } } },
  });
  if (!user) {
    throw new NotFoundError("Kullanıcı bulunamadı.");
  }

  const memberships = await app.prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    select: { organizationId: true, role: true },
  });

  return { user: toUserDto(user), memberships };
}
