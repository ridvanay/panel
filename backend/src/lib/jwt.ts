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
