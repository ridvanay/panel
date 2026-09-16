import type { FastifyInstance } from "fastify";
import { hashOtpCode } from "../../src/lib/otp";

interface RegisteredUser {
  email: string;
  password: string;
  name: string;
  userId: string;
  accessToken: string;
}

/**
 * Testlerde tekrar tekrar kullanılan akış: yeni bir kullanıcı kaydeder + e-posta doğrulamasını
 * TAMAMLAR, access token'ını döner.
 *
 * `.claude/architect-scope-guest-account-otp.md` §2 (bağlayıcı) — `POST /auth/register` artık
 * token DÖNDÜRMEZ, `202 RegistrationPendingVerification` döner; gerçek doğrulama kodu YALNIZCA
 * e-posta ile gönderilir. Test ortamında SMTP/`EmailTemplate` satırı VARSAYILAN OLARAK YOKTUR
 * (bkz. `tests/setup/global-setup.ts` — seed script çalıştırılmaz), bu yüzden `register()`'ın
 * kod gönderimi (best-effort, bkz. `auth.service.ts::register`) burada sessizce başarısız
 * kalabilir — DB satırı (kod HASH'i dahil) YİNE DE yazılmıştır.
 *
 * Testin "kodu bilmesi" için her çağıran test dosyasının `sendMail`'i `vi.mock`lamasını
 * ZORUNLU kılmak yerine (`auth-forgot-password-success.test.ts`'teki desen — orada TEK bir
 * dosyaya özgü), DB satırındaki `codeHash`'i BİLİNEN bir kodun hash'iyle DOĞRUDAN değiştiriyoruz.
 * `lib/otp.ts::hashOtpCode` PUBLIC, SAF bir fonksiyondur — gerçek doğrulama mantığı (deneme
 * sayacı/TTL/timingSafeEqual) BAYPAS EDİLMEZ, yalnızca kodun KENDİSİ test ortamında bilinir
 * kılınır. Ardından GERÇEK `POST /auth/verify-email` ucu çağrılır.
 */
export async function registerTestUser(
  app: FastifyInstance,
  overrides: Partial<{ email: string; password: string; name: string }> = {}
): Promise<RegisteredUser> {
  const email = overrides.email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = overrides.password ?? "Sifre12345!";
  const name = overrides.name ?? "Test User";

  const registerRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password, name },
  });
  if (registerRes.statusCode !== 202) {
    throw new Error(`registerTestUser: beklenmeyen /auth/register yanıtı (${registerRes.statusCode}): ${registerRes.body}`);
  }

  const user = await app.prisma.user.findUniqueOrThrow({ where: { email } });

  const KNOWN_TEST_CODE = "123456";
  const codeHash = hashOtpCode(user.id, "EMAIL_VERIFICATION", KNOWN_TEST_CODE);
  const updated = await app.prisma.emailVerificationCode.updateMany({
    where: { userId: user.id, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    data: { codeHash },
  });
  if (updated.count === 0) {
    throw new Error("registerTestUser: bekleyen bir EMAIL_VERIFICATION kodu bulunamadı.");
  }

  const verifyRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/verify-email",
    payload: { email, code: KNOWN_TEST_CODE },
  });
  if (verifyRes.statusCode !== 200) {
    throw new Error(`registerTestUser: /auth/verify-email başarısız (${verifyRes.statusCode}): ${verifyRes.body}`);
  }

  const body = verifyRes.json() as { data: { user: { id: string }; tokens: { accessToken: string } } };
  return { email, password, name, userId: body.data.user.id, accessToken: body.data.tokens.accessToken };
}
