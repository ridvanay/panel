import { env, isProd } from "../config/env";

export const REFRESH_COOKIE_NAME = "refresh_token";
/** openapi.yaml'daki tüm /auth/* uçları bu path altında; cookie yalnızca bu uçlara gider. */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict" as const,
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  };
}
