import crypto from "node:crypto";
import { env, isProd } from "../config/env";

function decode(base64?: string): string | undefined {
  return base64 ? Buffer.from(base64, "base64").toString("utf8") : undefined;
}

let privateKey = decode(env.JWT_PRIVATE_KEY_BASE64);
let publicKey = decode(env.JWT_PUBLIC_KEY_BASE64);

if (!privateKey || !publicKey) {
  if (isProd) {
    throw new Error(
      "JWT_PRIVATE_KEY_BASE64 / JWT_PUBLIC_KEY_BASE64 production'da zorunludur (bkz. backend/.env.example)."
    );
  }
  // Geliştirme kolaylığı: anahtar verilmemişse süreç içi geçici bir RSA çifti üret.
  // Sunucu her yeniden başladığında değişir; bu nedenle eski access token'lar geçersiz olur
  // (refresh token DB'de kalıcı olduğundan /auth/refresh ile yeni token alınabilir).
  const { privateKey: genPriv, publicKey: genPub } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  // eslint-disable-next-line no-console
  console.warn(
    "[uyarı] JWT anahtarları .env içinde tanımlı değil — geliştirme için geçici anahtar çifti üretildi."
  );
  privateKey = genPriv;
  publicKey = genPub;
}

export const jwtPrivateKey = privateKey;
export const jwtPublicKey = publicKey;
