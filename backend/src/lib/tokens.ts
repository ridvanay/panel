import crypto from "node:crypto";

/** Opak (rastgele) refresh/reset token üretir; ham değer yalnızca istemciye döner, DB'ye hash'i yazılır. */
export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
