"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";
import * as authApi from "@/lib/api/auth";
import { clearAccessToken, getAccessToken } from "@/lib/api/token-store";
import type { AuthSession, LoginRequest, RegisterRequest, User } from "@/lib/api/types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/** `login()` 2FA açık kullanıcılarda token vermeden `challengeToken` döner (bkz. ARCHITECTURE.md §10.4). */
type LoginOutcome = { requiresTwoFactor: false } | { requiresTwoFactor: true; challengeToken: string };

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  memberships: AuthSession["memberships"];
  login: (input: LoginRequest) => Promise<LoginOutcome>;
  register: (input: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** Üyelik listesini tazelemek için (org oluşturma/silme, davet kabul sonrası). */
  refreshSession: () => Promise<void>;
  /** 2FA challenge sonrası TOTP/backup kodu doğrulaması; başarılıysa oturumu açar. */
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<AuthSession["memberships"]>([]);

  const loadSession = useCallback(async () => {
    try {
      const session = await authApi.getSession();
      setUser(session.user);
      setMemberships(session.memberships);
      setStatus("authenticated");
      // Sentry hata event'lerini "hangi kullanıcı" sorusuna bağlamak için — SADECE id
      // (PII olmadan, bkz. proje kökü CLAUDE.md § Kurallar); email/isim ASLA gönderilmez.
      Sentry.setUser({ id: session.user.id });
    } catch {
      setUser(null);
      setMemberships([]);
      setStatus("unauthenticated");
      Sentry.setUser(null);
    }
  }, []);

  useEffect(() => {
    // Access token yalnızca bellekte tutulur (bkz. lib/api/token-store.ts); sayfa
    // yenilendiğinde sıfırlanır. httpOnly refresh cookie hâlâ geçerliyse burada
    // sessizce yeni bir access token alınıp oturum tazelenir.
    let cancelled = false;

    (async () => {
      if (!getAccessToken()) {
        try {
          await authApi.refresh();
        } catch {
          if (!cancelled) setStatus("unauthenticated");
          return;
        }
      }
      if (!cancelled) await loadSession();
    })();

    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  const login = useCallback(
    async (input: LoginRequest): Promise<LoginOutcome> => {
      const result = await authApi.login(input);
      if ("requiresTwoFactor" in result) {
        // 2FA gerekiyor — henüz token yok, loadSession() ÇAĞRILMAZ.
        return { requiresTwoFactor: true, challengeToken: result.challengeToken };
      }
      await loadSession();
      return { requiresTwoFactor: false };
    },
    [loadSession]
  );

  const verifyTwoFactor = useCallback(
    async (challengeToken: string, code: string) => {
      await authApi.verifyTwoFactor(challengeToken, code);
      await loadSession();
    },
    [loadSession]
  );

  const register = useCallback(
    async (input: RegisterRequest) => {
      await authApi.register(input);
      await loadSession();
    },
    [loadSession]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearAccessToken();
      setUser(null);
      setMemberships([]);
      setStatus("unauthenticated");
      Sentry.setUser(null);
    }
  }, []);

  const value: AuthContextValue = {
    status,
    user,
    memberships,
    login,
    register,
    logout,
    refreshSession: loadSession,
    verifyTwoFactor,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth, <AuthProvider> içinde kullanılmalıdır.");
  return ctx;
}
