import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { EmailVerificationPurpose } from "@prisma/client";
import { env } from "../config/env";
import { VerificationCodeInvalidError } from "./errors";
import { runSerializable } from "./serializable-tx";

/**
 * `.claude/architect-scope-guest-account-otp.md` §1/§3 (bağlayıcı) + `.claude/security-review-
 * guest-account-otp.md` KARAR 1 (§3 ONAYLANDI + iki bağlayıcı ek koşul) — ortak e-posta OTP
 * (tek kullanımlık doğrulama kodu) altyapısı. Hem Özellik A (`EMAIL_VERIFICATION`, kayıt sonrası)
 * HEM Özellik B (`ACCOUNT_ACTIVATION`, misafir randevu ödemesiyle açılan hesap) BU dosyayı, AYNI
 * `EmailVerificationCode` tablosunu, AYNI üretici/doğrulayıcıyı ve AYNI deneme/hedef-başına
 * kısıtları paylaşır — TTL VE hangi ucun kabul ettiği (§4.5, amaç bağlaması) DIŞINDA hiçbir
 * davranış farkı yoktur.
 *
 * **Neden `lib/tokens.ts::hashToken` (düz sha256) DEĞİL, `lib/backup-codes.ts::hashBackupCode`
 * DEĞİL:** ikisi de yüksek entropili (256-bit token) veya orta entropili (~40-bit yedek kod)
 * girdiler için tasarlandı. 6 haneli bir OTP yalnızca ~20 bit taşır — düz sha256, bir DB
 * sızıntısında saniyeler içinde 10^6 elemanlık bir rainbow table ile çözülür. Burada anahtarlı
 * (HMAC) bir "biber" kullanılır (security-review KARAR 1.2): `ENCRYPTION_KEY` olmadan saldırgan
 * `codeHash`'i offline BRUTE-FORCE bile edemez (10^6 alanı önceden hesaplayamaz) — "düşük
 * entropi" endişesi yalnızca ONLINE deneme sınırıyla (§3.4, 5 deneme) değil, HMAC'in kendisiyle
 * de kapatılır. Yeni bir env değişkeni AÇILMAZ (`.claude/architect-scope-smtp-settings.md` §2.2
 * ilkesi) — `ENCRYPTION_KEY`, alan-ayrımı (domain separation) etiketiyle YENİDEN kullanılır
 * (`lib/crypto.ts::encryptSecret/decryptSecret`'in AES-256-GCM anahtarından matematiksel olarak
 * BAĞIMSIZDIR, ikinci bir HMAC turu ile türetilir).
 *
 * **`codeHash` üzerinde arama HER ZAMAN `userId` ile başlar** (§1.4, bağlayıcı) —
 * `findFirst({ where: { codeHash } })` gibi GLOBAL bir arama bu dosyada ASLA YAZILMAZ (bkz.
 * `consumeVerificationCode`, `issueVerificationCode`).
 */

/** 6 haneli, yalnızca rakam — baştaki sıfırlar KORUNUR. */
const OTP_LENGTH = 6;
const OTP_CODE_PATTERN = /^\d{6}$/;

/** §3.4 (bağlayıcı) — `attemptCount >= 5` ise kod ÖLÜDÜR. */
export const MAX_VERIFICATION_ATTEMPTS = 5;

/** §3.6 (bağlayıcı) — hedef-başına (userId+purpose) yeniden gönderim kısıtları. */
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const DAILY_ISSUE_CAP = 5;
const DAILY_ISSUE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** §3.3 (bağlayıcı) — amaca göre TTL. */
const TTL_BY_PURPOSE_MS: Record<EmailVerificationPurpose, number> = {
  EMAIL_VERIFICATION: 10 * 60 * 1000,
  ACCOUNT_ACTIVATION: 24 * 60 * 60 * 1000,
};

/**
 * §1.4 [GAO] — gerçek bir kullanıcı bulunamadığında (`userId === null`) bile GERÇEK bir HMAC +
 * DB sorgusu çalıştırmak için kullanılan sabit, GEÇERSİZ bir UUID. Bu ID'ye ait GERÇEK bir
 * `EmailVerificationCode` satırı ASLA var olamaz (uygulama seviyesinde asla `userId` olarak
 * kullanılmaz) — `consumeVerificationCode`'un "kullanıcı yok" dalını "kullanıcı var ama kod
 * yanlış" dalıyla ZAMANLAMA açısından tutarlı kılar (security-review §4.3 netleştirmesi).
 */
const DUMMY_USER_ID = "00000000-0000-0000-0000-000000000000";
/** Format geçersizken HMAC mesaj uzunluğunu SABİT tutmak için kullanılan sahte kod (KARAR 1.2). */
const DUMMY_CODE = "000000";

/** `crypto.randomInt` — `Math.random()` KULLANIMI YASAKTIR (§3.1, bağlayıcı). */
export function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(OTP_LENGTH, "0");
}

let cachedDerivedKey: Buffer | null = null;

/** `derivedKey = HMAC-SHA256(env.ENCRYPTION_KEY, "email-verification-code/v1")` (§3.2, bağlayıcı). */
function getDerivedKey(): Buffer {
  if (!cachedDerivedKey) {
    cachedDerivedKey = crypto.createHmac("sha256", env.ENCRYPTION_KEY).update("email-verification-code/v1").digest();
  }
  return cachedDerivedKey;
}

/**
 * §3.2 (bağlayıcı) — `codeHash = HMAC-SHA256(derivedKey, "${userId}:${purpose}:${code}")` (hex).
 *
 * **Bağlayıcı ek koşul (security-review KARAR 1.2):** `code` HER ZAMAN önce `/^\d{6}$/` ile
 * doğrulanır — format uymuyorsa `VerificationCodeInvalidError` fırlatılır, HMAC'e ASLA farklı
 * uzunlukta bir mesaj verilmez (aksi halde farklı bir HMAC mesaj uzunluğu, düşük riskli ama
 * bedelsiz kapatılabilir bir yapı sızıntısı olurdu).
 */
export function hashOtpCode(userId: string, purpose: EmailVerificationPurpose, code: string): string {
  if (!OTP_CODE_PATTERN.test(code)) {
    throw new VerificationCodeInvalidError();
  }
  return crypto.createHmac("sha256", getDerivedKey()).update(`${userId}:${purpose}:${code}`).digest("hex");
}

/**
 * `crypto.timingSafeEqual` — security-review KARAR 1.2 (bağlayıcı): uzunluk uyuşmazlığında
 * (olmaması gerekir, ikisi de HMAC-SHA256 hex çıktısı — 64 karakter) fırlatmayı YUKARI
 * SIZDIRMAZ, sessizce `false`'a düşer (aksi halde 401 yerine 500 dönebilirdi).
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export interface IssuedVerificationCode {
  /** Düz metin kod — YALNIZCA e-posta gönderimi için çağıranın anlık kapsamında kullanılır, ASLA loglanmaz/döndürülmez. */
  code: string;
  expiresAt: Date;
}

/**
 * §3.4/§3.6 (bağlayıcı) — o `userId`+`purpose` için CANLI olan TÜM eski kodları geçersiz kılar
 * (`consumedAt` SET), hedef-başına cooldown (60 sn) + günlük tavan (24 saatte 5) uygular, TTL'e
 * göre (amaç bazlı) yeni bir satır oluşturur.
 *
 * **`register` kaynaklı İLK gönderim §3.6'daki iki kısıttan MUAFTIR** — bu, AYRI bir "ilk kod mu"
 * bayrağı GEREKTİRMEZ: `register()` DAİMA taze oluşturulmuş bir `userId` ile çağırır, bu ID için
 * hiçbir `EmailVerificationCode` satırı VAR OLAMAZ, dolayısıyla cooldown/tavan sorgusu doğal
 * olarak boş döner ve kısıtlar kendiliğinden devre dışı kalır. `resend-verification-code` ise
 * MEVCUT bir kullanıcı için çağırır — kısıtlar orada doğal olarak devreye girer.
 *
 * Cooldown/tavan aşıldığında `null` döner — çağıran taraf (route) YİNE DE `202` döner, yalnızca
 * e-posta GÖNDERİLMEZ (§3.6).
 *
 * **Atomiklik (race-condition düzeltmesi, bkz. `docker compose logs backend` — aynı milisaniyede
 * iki eşzamanlı `resend-verification-code` → ikisi de `202`):** cooldown/tavan OKUMASI ile eski
 * kodu geçersiz kılma + yeni kod YAZMASI ayrı adımlar olarak ÇALIŞTIRILMAZ — ikisi de `lib/
 * serializable-tx.ts::runSerializable` ile TEK bir Serializable transaction'a sarılır (projenin
 * `booking.ts`/`stripe.routes.ts::handleOrderPaid`'de KULLANDIĞI aynı desen). Postgres Serializable
 * izolasyonda iki eşzamanlı çağrıdan biri diğerinin "en son kod" satırını YAZDIKTAN SONRA
 * commit'lenene kadar bekletilir/çakışırsa `P2034` ile reddedilip retry edilir — bu sayede aynı
 * `userId`+`purpose` için eşzamanlı iki çağrı ASLA iki farklı "canlı" kod ÜRETEMEZ: ikincisi ya
 * cooldown'a takılıp `null` döner ya da retry sonrası birincinin geçersiz kıldığı satırı görüp
 * kendi kodunu tek canlı kod olarak yazar.
 */
export async function issueVerificationCode(
  app: FastifyInstance,
  userId: string,
  purpose: EmailVerificationPurpose
): Promise<IssuedVerificationCode | null> {
  return runSerializable(app, async (tx) => {
    const now = new Date();
    const windowStart = new Date(now.getTime() - DAILY_ISSUE_WINDOW_MS);

    const recent = await tx.emailVerificationCode.findMany({
      where: { userId, purpose, createdAt: { gte: windowStart } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (recent.length > 0) {
      const lastCreatedAt = recent[0]!.createdAt;
      if (now.getTime() - lastCreatedAt.getTime() < RESEND_COOLDOWN_MS) {
        return null; // cooldown içinde — yeni kod ÜRETİLMEZ (§3.6).
      }
    }
    if (recent.length >= DAILY_ISSUE_CAP) {
      return null; // günlük tavan aşıldı (§3.6).
    }

    const code = generateOtpCode();
    const codeHash = hashOtpCode(userId, purpose, code);
    const expiresAt = new Date(now.getTime() + TTL_BY_PURPOSE_MS[purpose]);

    // §3.4 — "her an en fazla tek bir canlı kod vardır" (eski canlı kodlar geçersiz kılınır).
    await tx.emailVerificationCode.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.emailVerificationCode.create({
      data: { userId, purpose, codeHash, expiresAt },
    });

    return { code, expiresAt };
  });
}

/**
 * §3.4/§4.3/§4.5 (bağlayıcı) + security-review §4.3 netleştirmesi — bir kodu doğrular ve
 * (başarılıysa) tüketir. Başarısızsa `VerificationCodeInvalidError` (401) fırlatır; TÜM
 * başarısızlık nedenleri (kullanıcı yok, canlı kod yok, kod yanlış, süresi dolmuş, deneme
 * tükenmiş, amaç eşleşmiyor) **AYNI** hatayı üretir (§4.3, hesap-varlık oracle'ı yok).
 *
 * **`userId === null` dalında bile GERÇEK bir HMAC + `timingSafeEqual` + DB sorgusu çalıştırılır,
 * erken `return` YAPILMAZ** (security-review §4.3, bağlayıcı netleştirme) — aksi halde "kullanıcı
 * yok" dalı, DB sorgusu dahil tüm maliyeti atlayarak zamanlama farkını PEKİŞTİRİRDİ.
 *
 * **Amaç bağlaması (§4.5) DOĞAL OLARAK sağlanır:** sorgu `purpose` ile filtrelenir — kullanıcının
 * en son canlı kodu FARKLI bir amaca aitse bu sorgu hiçbir satır BULAMAZ (yanlış amaç = "canlı kod
 * yok" ile AYNI sonuç).
 *
 * **`findFirst({ where: { codeHash } })` YAZILMAZ** (§1.4) — arama HER ZAMAN `userId`+`purpose`
 * ile başlar.
 *
 * **Bilinçli tasarım kararı — bu fonksiyon KENDİ transaction'ını AÇMAZ, ASLA bir dış
 * `$transaction`/`tx` içine SARILMAMALIDIR:** başarısız bir denemede `attemptCount` artırımı
 * HER ZAMAN kalıcı olmalıdır (§3.4, "artırım HER denemede yazılır") — bu fonksiyon çağrıldıktan
 * SONRA başka bir adımda (ör. `activate-account`'ın parola/transaction adımı) hata oluşursa,
 * daha önce buradan atılan `VerificationCodeInvalidError` zaten fırlamış ve akış durmuş olur;
 * ama BAŞARILI bir tüketimden SONRA çağıranın KENDİ transaction'ı başarısız olursa (ör. DB
 * bağlantı sorunu), kodun `consumedAt`i geri ALINMAZ — bu, "deneme sayacının rollback ile
 * SESSİZCE silinip brute-force korumasının delinmesi" riskinden KESİNLİKLE daha güvenli bir
 * ödünleşimdir (bkz. `auth.service.ts::activateAccount`).
 */
export async function consumeVerificationCode(
  app: FastifyInstance,
  userId: string | null,
  purpose: EmailVerificationPurpose,
  rawCode: string
): Promise<void> {
  // Kullanıcı kopyalarken sıklıkla boşluk/tire taşır (§3.1) — doğrulamadan ÖNCE temizlenir.
  const normalized = rawCode.trim().replace(/[\s-]/g, "");
  const isValidFormat = OTP_CODE_PATTERN.test(normalized);
  const codeForHash = isValidFormat ? normalized : DUMMY_CODE;

  const effectiveUserId = userId ?? DUMMY_USER_ID;
  const candidateHash = hashOtpCode(effectiveUserId, purpose, codeForHash);

  const record = await app.prisma.emailVerificationCode.findFirst({
    where: { userId: effectiveUserId, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();
  const isLive = record !== null && record.expiresAt.getTime() > now && record.attemptCount < MAX_VERIFICATION_ATTEMPTS;
  const matches = isValidFormat && isLive && timingSafeEqualHex(candidateHash, record!.codeHash);

  if (!matches) {
    // §3.4 — "artırım, karşılaştırmadan bağımsız olarak HER denemede yazılır" (kullanıcı
    // gerçekten var VE canlı bir kod satırı varsa; kullanıcı yoksa artırılacak bir satır yoktur).
    if (record) {
      await app.prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { attemptCount: { increment: 1 } },
      });
    }
    throw new VerificationCodeInvalidError();
  }

  await app.prisma.emailVerificationCode.update({
    where: { id: record!.id },
    data: { consumedAt: new Date() },
  });
}
