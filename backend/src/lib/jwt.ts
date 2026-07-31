import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { jwtPrivateKey, jwtPublicKey } from "./keys";

export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
}

export function signAccessToken(payload: AccessTokenPayload): { token: string; expiresAt: Date } {
  const expiresInSec = env.ACCESS_TOKEN_TTL_MIN * 60;
  const token = jwt.sign(payload, jwtPrivateKey, {
    algorithm: "RS256",
    expiresIn: expiresInSec,
  });
  return { token, expiresAt: new Date(Date.now() + expiresInSec * 1000) };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, jwtPublicKey, { algorithms: ["RS256"] });
  if (typeof decoded === "string" || !decoded.sub || !decoded.email) {
    throw new Error("Geçersiz token gövdesi.");
  }
  return { sub: decoded.sub as string, email: decoded.email as string };
}

/**
 * §10.4 Güvenlik & 2FA — şifre doğrulandıktan sonra, 2FA açık bir kullanıcı için token
 * çifti HEMEN verilmez; bunun yerine 5 dakika ömürlü bu "challenge" token'ı üretilir
 * (bkz. auth.service.ts::login, POST /auth/2fa/verify).
 */
export function signChallengeToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: "2fa_challenge" }, jwtPrivateKey, {
    algorithm: "RS256",
    expiresIn: "5m",
  });
}

export function verifyChallengeToken(token: string): { sub: string } {
  const decoded = jwt.verify(token, jwtPublicKey, { algorithms: ["RS256"] });
  if (typeof decoded === "string" || decoded.purpose !== "2fa_challenge" || !decoded.sub) {
    throw new Error("Geçersiz 2FA challenge token'ı.");
  }
  return { sub: decoded.sub as string };
}

/**
 * §10.4 Güvenlik & 2FA kurulumu — `POST .../2fa/setup` henüz DB'ye yazılmamış yeni
 * secret'ı bu kısa ömürlü token içine gömer; `POST .../2fa/enable` doğrulayıp kalıcı
 * hale getirir (bkz. modules/security/security.routes.ts).
 */
export function signTwoFactorSetupToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId, secret, purpose: "2fa_setup" }, jwtPrivateKey, {
    algorithm: "RS256",
    expiresIn: "5m",
  });
}

export function verifyTwoFactorSetupToken(token: string): { sub: string; secret: string } {
  const decoded = jwt.verify(token, jwtPublicKey, { algorithms: ["RS256"] });
  if (typeof decoded === "string" || decoded.purpose !== "2fa_setup" || !decoded.sub || !decoded.secret) {
    throw new Error("Geçersiz 2FA kurulum token'ı.");
  }
  return { sub: decoded.sub as string, secret: decoded.secret as string };
}
