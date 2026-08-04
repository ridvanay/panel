import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

/**
 * Kanıt: `plugins/error-handler.ts`'in son catch-all dalı (beklenmedik 500) `Sentry.
 * captureException`'ı DOĞRU koşulda çağırıyor mu? Gerçek bir Sentry hesabı/DSN olmadan test
 * edebilmek için `lib/sentry.ts` (SDK'nın kendisi değil, kendi ince sarmalayıcımız) mock'lanır —
 * bkz. proje CLAUDE.md görev maddesi 6.
 */
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/sentry", () => ({
  Sentry: { captureException: captureExceptionMock },
  sentryEnabled: true,
  initSentry: vi.fn(),
}));

async function buildApp() {
  // errorHandlerPlugin `lib/sentry`'i import ettiği için mock'un ETKİLİ olması adına
  // dinamik import kullanılır (üstteki `vi.mock` hoist edilir, ama modül önbelleği testler
  // arası temiz kalsın diye her testte `vi.resetModules()` sonrası taze import ediyoruz).
  // `lib/errors`'ı da AYNI taze modül grafiğinden import ediyoruz — aksi halde route handler'ın
  // fırlattığı `ValidationError`, error-handler.ts'in (resetModules sonrası re-import edilen)
  // `ApiError` class referansından FARKLI bir modül kimliğine sahip olur ve `instanceof ApiError`
  // sessizce false döner (yanlışlıkla 500'e düşer) — iki import'un da taze grafikten gelmesi şart.
  const { default: errorHandlerPlugin } = await import("../../src/plugins/error-handler");
  const { ValidationError } = await import("../../src/lib/errors");
  const app = Fastify();
  await app.register(errorHandlerPlugin);

  app.get("/boom", async () => {
    throw new Error("beklenmedik patlama");
  });
  app.get("/known", async () => {
    throw new ValidationError("Girdi doğrulama hatası.", { email: ["Zorunlu alan."] });
  });

  await app.ready();
  return app;
}

describe("error-handler.ts — Sentry entegrasyonu", () => {
  beforeEach(() => {
    vi.resetModules();
    captureExceptionMock.mockClear();
  });

  it("beklenmedik (yakalanmamış) 500 hatalarında Sentry.captureException'ı çağırır", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/boom" });

    expect(res.statusCode).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    const [error, hint] = captureExceptionMock.mock.calls[0] as [Error, Record<string, unknown>];
    expect(error.message).toBe("beklenmedik patlama");

    // PII sızıntısı yok: user context tanımsız (bu istek kimliksiz), sadece method + route
    // pattern context'e eklenmiş — email/ham query string/body YOK.
    expect(hint.user).toBeUndefined();
    expect(hint.contexts).toMatchObject({ request: { method: "GET", route: "/boom" } });
    // Trace correlation: aynı isteğin request-id'si Sentry event'ine tag olarak eklenmiş.
    expect((hint.tags as Record<string, string>).requestId).toEqual(expect.any(String));

    await app.close();
  });

  it("bilinen/ele alınmış hatalarda (ör. ValidationError) Sentry'ye HİÇ göndermez", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/known" });

    expect(res.statusCode).toBe(422);
    expect(captureExceptionMock).not.toHaveBeenCalled();

    await app.close();
  });

  afterEach(() => {
    vi.doUnmock("../../src/lib/sentry");
  });
});

describe("error-handler.ts — SENTRY_DSN tanımsızken (sentryEnabled=false)", () => {
  beforeEach(() => {
    vi.resetModules();
    captureExceptionMock.mockClear();
  });

  afterEach(() => {
    vi.doUnmock("../../src/lib/sentry");
  });

  it("Sentry.captureException'ı hiç çağırmaz (no-op)", async () => {
    vi.doMock("../../src/lib/sentry", () => ({
      Sentry: { captureException: captureExceptionMock },
      sentryEnabled: false,
      initSentry: vi.fn(),
    }));

    const { default: errorHandlerPlugin } = await import("../../src/plugins/error-handler");
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    app.get("/boom", async () => {
      throw new Error("beklenmedik patlama");
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/boom" });

    expect(res.statusCode).toBe(500);
    expect(captureExceptionMock).not.toHaveBeenCalled();

    await app.close();
  });
});
