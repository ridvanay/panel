import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { localeFromAcceptLanguage, localizeDestination, resolveAuthLocale } from "@/lib/i18n/auth-locale";
import { isSafeInternalPath } from "@/lib/safe-redirect";

/**
 * Paket O (İş 1 + İş 5) — `[lang]` dışındaki giriş ekranlarının dili ve kapalı dillerin URL davranışı.
 *   - dil önceliği: `next` öneki → `wm-locale` çerezi → Accept-Language → varsayılan; yalnızca açık diller
 *   - `next` açık yönlendirme koruması (protokol-göreli, ters eğik çizgi, TAB/CR/LF)
 *   - giriş sonrası hedef dil önekini korur
 *   - proxy: giriş ekranlarına `x-active-locale`, site sayfalarında dil çerezi, doktor host'unda `/login` dili
 *   - kapalı dilin (`/es`, `/ru/...`) öneki dil sayılmaz (varsayılan dile rewrite → sayfa yok → 404)
 */
const ENABLED = ["tr", "en", "ru", "ar"];

describe("resolveAuthLocale", () => {
  const base = { next: null, cookie: null, acceptLanguage: null, enabledCodes: ENABLED, defaultCode: "tr" };

  it("öncelik: next öneki > çerez > Accept-Language > varsayılan", () => {
    expect(resolveAuthLocale({ ...base, next: "/ru/doctors/x", cookie: "en", acceptLanguage: "ar" })).toBe("ru");
    expect(resolveAuthLocale({ ...base, next: "/ru", cookie: "en" })).toBe("ru");
    expect(resolveAuthLocale({ ...base, next: "/patient/appointments", cookie: "en", acceptLanguage: "ar" })).toBe("en");
    expect(resolveAuthLocale({ ...base, acceptLanguage: "de-DE,de;q=0.9,ar;q=0.8,en;q=0.5" })).toBe("ar");
    expect(resolveAuthLocale(base)).toBe("tr");
  });

  it("kapalı/bilinmeyen dil ve güvensiz next yok sayılır", () => {
    expect(resolveAuthLocale({ ...base, next: "/es/doctors", cookie: "de", acceptLanguage: "es" })).toBe("tr");
    expect(resolveAuthLocale({ ...base, next: "//ru.evil.com/ru" })).toBe("tr");
    expect(resolveAuthLocale({ ...base, next: "https://evil.com/ru" })).toBe("tr");
  });

  it("Accept-Language q değerleri ve sırası", () => {
    expect(localeFromAcceptLanguage("en;q=0.3, ru;q=0.9", ENABLED)).toBe("ru");
    expect(localeFromAcceptLanguage("fr-FR, *;q=0.5", ENABLED)).toBeNull();
    expect(localeFromAcceptLanguage("ru;q=0", ENABLED)).toBeNull();
  });
});

describe("next açık yönlendirme koruması", () => {
  it("yalnızca site-içi yol", () => {
    expect(isSafeInternalPath("/ru/patient")).toBe(true);
    for (const bad of ["//evil.com", "/\\evil.com", "/%09/evil.com".replace("%09", String.fromCharCode(9)), `/${String.fromCharCode(10)}/evil.com`, "/a\\b", "https://evil.com", "evil", ""]) {
      expect(isSafeInternalPath(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("giriş sonrası hedef dil önekini korur", () => {
  it("öneksiz site hedefi aktif dilin önekini alır; admin/doktor/dashboard ve önekli hedef dokunulmaz", () => {
    expect(localizeDestination("/patient/appointments", "ru", "tr")).toBe("/ru/patient/appointments");
    expect(localizeDestination("/", "ar", "tr")).toBe("/ar");
    expect(localizeDestination("/ru/doctors/x", "ru", "tr")).toBe("/ru/doctors/x");
    expect(localizeDestination("/ru#faq", "ru", "tr")).toBe("/ru#faq");
    expect(localizeDestination("/admin", "ru", "tr")).toBe("/admin");
    expect(localizeDestination("/doctor/profile", "ru", "tr")).toBe("/doctor/profile");
    expect(localizeDestination("/dashboard", "ru", "tr")).toBe("/dashboard");
    expect(localizeDestination("/patient/appointments", "tr", "tr")).toBe("/patient/appointments");
  });
});

// ---------------------------------------------------------------------------------------------
// proxy
// ---------------------------------------------------------------------------------------------
const LOCALES = [
  { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "en", label: "English", nativeLabel: "English", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
  { code: "ru", label: "Русский", nativeLabel: "Русский", isDefault: false, enabled: true, sortOrder: 2, hreflang: "ru" },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("proxy — giriş ekranı dili, dil çerezi, kapalı diller", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/locales")) return Promise.resolve(jsonResponse({ data: LOCALES }));
        if (url.includes("/appearance")) return Promise.resolve(jsonResponse({ data: { maintenanceModeEnabled: false } }));
        return Promise.reject(new Error(`beklenmeyen fetch: ${url}`));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = (path: string, init: { cookie?: string; acceptLanguage?: string; host?: string } = {}) =>
    new NextRequest(new URL(path, "http://localhost:3000"), {
      headers: {
        host: init.host ?? "localhost:3000",
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.acceptLanguage ? { "accept-language": init.acceptLanguage } : {}),
      },
    });

  const activeLocaleOf = (res: Response) => res.headers.get("x-middleware-request-x-active-locale");

  it("/login: next öneki, çerez, Accept-Language, varsayılan; URL değişmez", async () => {
    const { proxy } = await import("@/proxy");
    const viaNext = await proxy(request("/login?next=%2Fru%2Fdoctors%2Fx"));
    expect(activeLocaleOf(viaNext)).toBe("ru");
    expect(viaNext.headers.get("x-middleware-rewrite")).toBeNull();
    expect(viaNext.status).toBe(200);
    expect(activeLocaleOf(await proxy(request("/register", { cookie: "wm-locale=en" })))).toBe("en");
    expect(activeLocaleOf(await proxy(request("/forgot-password", { acceptLanguage: "ru-RU,ru;q=0.9" })))).toBe("ru");
    expect(activeLocaleOf(await proxy(request("/verify-email", { acceptLanguage: "es" })))).toBe("tr");
    expect(activeLocaleOf(await proxy(request("/login?next=%2F%2Fevil.com", { cookie: "wm-locale=ru" })))).toBe("ru");
  });

  it("site sayfaları dil çerezini yazar (yalnızca değiştiyse)", async () => {
    const { proxy } = await import("@/proxy");
    const ru = await proxy(request("/ru/doctors"));
    expect(ru.headers.get("set-cookie")).toMatch(/wm-locale=ru/);
    const tr = await proxy(request("/doctors", { cookie: "wm-locale=ru" }));
    expect(tr.headers.get("set-cookie")).toMatch(/wm-locale=tr/);
    const same = await proxy(request("/ru", { cookie: "wm-locale=ru" }));
    expect(same.headers.get("set-cookie")).toBeNull();
  });

  it("kapalı dil (es) öneki dil sayılmaz: varsayılan dile rewrite edilir (sayfa yok → 404), dil çerezi es olmaz", async () => {
    const { proxy } = await import("@/proxy");
    for (const path of ["/es", "/es/doctors", "/de/about"]) {
      const res = await proxy(request(path));
      expect(res.headers.get("x-middleware-rewrite"), path).toContain(`/tr${path}`);
      expect(activeLocaleOf(res), path).toBe("tr");
      expect(res.headers.get("set-cookie") ?? "", path).not.toMatch(/wm-locale=(es|de)/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// ekran
// ---------------------------------------------------------------------------------------------
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("next=/ru/doctors/x"),
  usePathname: () => "/login",
}));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ status: "unauthenticated", login: vi.fn(), verifyTwoFactor: vi.fn() }) }));
vi.mock("@/context/site-branding-context", () => ({ useSiteBranding: () => ({ siteName: "WM Health Istanbul", logoUrl: null, tagline: null }) }));

describe("giriş ekranı aktif dilde", () => {
  it("Rusça ve Arapça metinler; kayıt bağlantısı next'i taşır", async () => {
    const { LocaleAlternatesProvider } = await import("@/context/locale-alternates-context");
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    const { unmount } = render(
      <LocaleAlternatesProvider activeLocaleCode="ru" defaultLocaleCode="tr">
        <LoginPage />
      </LocaleAlternatesProvider>
    );
    expect(await screen.findByRole("heading", { name: "Вход" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Пароль/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Зарегистрируйтесь" })).toHaveAttribute("href", "/register?next=%2Fru%2Fdoctors%2Fx");
    unmount();

    render(
      <LocaleAlternatesProvider activeLocaleCode="ar" defaultLocaleCode="tr">
        <LoginPage />
      </LocaleAlternatesProvider>
    );
    expect(await screen.findByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();
  });
});
