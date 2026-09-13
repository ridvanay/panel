"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";
import * as authApi from "@/lib/api/auth";
import { clearAccessToken, getAccessToken } from "@/lib/api/token-store";
import type { AuthSession, LoginRequest, RegisterRequest, User } from "@/lib/api/types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/**
 * `login()` 2FA açık kullanıcılarda token vermeden `challengeToken` döner (bkz. ARCHITECTURE.md
 * §10.4). Başarılı dalda `user`'ı da taşır — `loadSession()`'ın state güncellemesi React'in
 * bir sonraki render'ına kadar `useAuth().user`'a yansımaz; giriş sonrası akıllı yönlendirme
 * (bkz. `lib/post-login-destination.ts`) AYNI render'da güncel `user`'a ihtiyaç duyar.
 */
type LoginOutcome = { requiresTwoFactor: false; user: User } | { requiresTwoFactor: true; challengeToken: string };

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  memberships: AuthSession["memberships"];
  login: (input: LoginRequest) => Promise<LoginOutcome>;
  register: (input: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** Üyelik listesini tazelemek için (org oluşturma/silme, davet kabul sonrası). */
  refreshSession: () => Promise<void>;
  /** 2FA challenge sonrası TOTP/backup kodu doğrulaması; başarılıysa oturumu açar ve `user`'ı döner. */
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<User>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<AuthSession["memberships"]>([]);

  /**
   * `session.user`'ı RETURN eder — `login()`/`verifyTwoFactor()` bunu senkron olarak outcome'a
   * taşıyabilsin diye (bkz. `LoginOutcome` üstündeki not). Hata dalında `null` döner, çağıran
   * taraf zaten `authApi.login`/`verifyTwoFactor`'ın kendi hatasını fırlatmasına güvenir — bu
   * `catch` yalnızca "oturum bilgisi çekilemedi" senaryosunu (ör. ilk yüklemede refresh sonrası)
   * ele alır.
   */
  const loadSession = useCallback(async (): Promise<User | null> => {
    try {
      const session = await authApi.getSession();
      setUser(session.user);
      setMemberships(session.memberships);
      setStatus("authenticated");
      // Sentry hata event'lerini "hangi kullanıcı" sorusuna bağlamak için — SADECE id
      // (PII olmadan, bkz. proje kökü CLAUDE.md § Kurallar); email/isim ASLA gönderilmez.
      Sentry.setUser({ id: session.user.id });
      return session.user;
    } catch {
      setUser(null);
      setMemberships([]);
      setStatus("unauthenticated");
      Sentry.setUser(null);
      return null;
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
      const user = await loadSession();
      // `authApi.login` başarıyla token döndüyse `loadSession()` normal şartlarda `null`
      // dönmez — yine de tip güvenliği için burada net bir hata fırlatılır (sessiz `undefined`
      // yaymak yerine, çağıran tarafın `user.doctorProfileId`'a erişimi güvenli olsun).
      if (!user) throw new Error("Oturum bilgisi yüklenemedi.");
      return { requiresTwoFactor: false, user };
    },
    [loadSession]
  );

  const verifyTwoFactor = useCallback(
    async (challengeToken: string, code: string): Promise<User> => {
      await authApi.verifyTwoFactor(challengeToken, code);
      const user = await loadSession();
      if (!user) throw new Error("Oturum bilgisi yüklenemedi.");
      return user;
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
    refreshSession: async () => {
      await loadSession();
    },
    verifyTwoFactor,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth, <AuthProvider> içinde kullanılmalıdır.");
  return ctx;
}

/**
 * `useCartOptional` (bkz. `context/cart-context.tsx`) ile AYNI desen — `<AuthProvider>` her ne
 * kadar kök layout'ta global olsa da, bazı bileşenler (ör. `components/site/site-header.tsx`)
 * `AdminAppearancePage` gibi test/canlı-önizleme bağlamlarında Provider OLMADAN da render
 * edilebilir (`app/admin/appearance/page.tsx`'teki canlı önizleme + unit testler). `null` döner,
 * hata FIRLATMAZ — çağıran taraf "giriş yapılmamış" durumuyla aynı şekilde ele alabilir.
 */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext);
}
