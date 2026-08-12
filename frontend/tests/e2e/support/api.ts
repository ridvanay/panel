/**
 * qa-agent E2E test fixture yardımcıları — gerçek backend'e (varsayılan: `http://localhost:4001`,
 * `saas_e2e` veritabanı, bkz. `playwright.config.ts` başlığı) doğrudan `fetch` ile konuşur.
 * Amaç: Playwright testlerini rich-text editör UI akışlarına bağımlı kılmadan (kırılgan/yavaş)
 * gerçekçi içerik/locale durumları kurmak — backend zaten bu uçları `tests/integration/*.test.ts`
 * ile ayrı doğruluyor, burada YALNIZCA fixture amaçlı kullanılıyor.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API_BASE_URL = process.env.E2E_API_URL ?? "http://localhost:4001/api/v1";

// `/auth/login` ve `/auth/register` sabit 5 istek/dk IP başına sınırlıdır
// (`backend/src/modules/auth/auth.routes.ts` `AUTH_RATE_LIMIT`, env'den bağımsız). Aynı test
// koşumunda onlarca fixture çağrısı bu limiti anında aşar — bu yüzden `auth.setup.ts` TEK SEFER
// login olup token'ı diske yazar, diğer tüm spec dosyaları buradan okur (tekrar login OLMAZ).
const TOKEN_CACHE_PATH = path.join(process.cwd(), "tests/e2e/.auth/admin-token.json");

export interface AdminSession {
  email: string;
  password: string;
  accessToken: string;
  userId: string;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

export const ADMIN_EMAIL = "qa-e2e-admin@example.com";
export const ADMIN_PASSWORD = "QaE2eAdmin12345!";

/**
 * İlk kaydolan kullanıcı otomatik ADMIN olur (`backend/src/modules/auth/auth.service.ts`,
 * `userCount === 0 ? "ADMIN" : undefined`). `saas_e2e` veritabanı boşsa register, doluysa
 * (aynı test paketi tekrar çalıştırıldıysa) login'e düşer — idempotent. Yalnızca
 * `auth.setup.ts` (Playwright "setup" projesi, tüm suite için BİR KEZ) tarafından çağrılır;
 * sonucu diske yazar. Diğer testler `getCachedAdminSession()` kullanmalıdır.
 */
export async function ensureAdminSession(
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD
): Promise<AdminSession> {
  const registerRes = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "QA E2E Admin" }),
  });

  let session: AdminSession;
  if (registerRes.ok) {
    const body = (await registerRes.json()) as {
      data: { user: { id: string; role: string }; tokens: { accessToken: string } };
    };
    session = { email, password, accessToken: body.data.tokens.accessToken, userId: body.data.user.id };
  } else {
    // Zaten kayıtlı (409) — login ile devam.
    const loginRes = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await json<{ data: { user: { id: string }; tokens: { accessToken: string } } }>(loginRes);
    session = { email, password, accessToken: body.data.tokens.accessToken, userId: body.data.user.id };
  }

  await mkdir(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
  await writeFile(TOKEN_CACHE_PATH, JSON.stringify(session), "utf-8");
  return session;
}

/** Diğer spec dosyalarının kullanması gereken yol — `auth.setup.ts`'in yazdığı token'ı okur. */
export async function getCachedAdminSession(): Promise<AdminSession> {
  try {
    const raw = await readFile(TOKEN_CACHE_PATH, "utf-8");
    return JSON.parse(raw) as AdminSession;
  } catch {
    // "setup" projesi hiç çalışmadıysa (örn. dosya tek başına çalıştırıldıysa) — fallback.
    return ensureAdminSession();
  }
}

function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export interface PageFixtureInput {
  title: string;
  slug: string;
  html: string;
  status?: "PUBLISHED" | "DRAFT";
  isLegalDocument?: boolean;
  translations?: Record<string, { title?: string; slug?: string; html?: string }>;
}

/** `POST /admin/pages` — testlerin ihtiyaç duyduğu minimal alanlarla bir `Page` oluşturur. */
export async function createPage(token: string, input: PageFixtureInput) {
  const translations = input.translations
    ? Object.fromEntries(
        Object.entries(input.translations).map(([locale, fields]) => [
          locale,
          {
            ...(fields.title ? { title: fields.title } : {}),
            ...(fields.slug ? { slug: fields.slug } : {}),
            ...(fields.html ? { blocks: [{ id: "b1", type: "text", data: { html: fields.html } }] } : {}),
          },
        ])
      )
    : undefined;

  const res = await fetch(`${API_BASE_URL}/admin/pages`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      title: input.title,
      slug: input.slug,
      status: input.status ?? "PUBLISHED",
      blocks: [{ id: "b1", type: "text", data: { html: input.html } }],
      ...(input.isLegalDocument !== undefined ? { isLegalDocument: input.isLegalDocument } : {}),
      ...(translations ? { translations } : {}),
    }),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

export async function deletePagePermanently(token: string, pageId: string) {
  await fetch(`${API_BASE_URL}/admin/pages/${pageId}`, { method: "DELETE", headers: authHeaders(token) });
  await fetch(`${API_BASE_URL}/admin/pages/${pageId}/permanent`, { method: "DELETE", headers: authHeaders(token) });
}

export async function listAdminLocales(token: string) {
  const res = await fetch(`${API_BASE_URL}/admin/locales`, { headers: authHeaders(token) });
  return json<{ data: Array<Record<string, unknown>> }>(res).then((b) => b.data);
}

export async function deleteLocale(token: string, code: string) {
  return fetch(`${API_BASE_URL}/admin/locales/${code}`, { method: "DELETE", headers: authHeaders(token) });
}

export async function createLocale(
  token: string,
  input: { code: string; label: string; nativeLabel: string; enabled?: boolean }
) {
  const res = await fetch(`${API_BASE_URL}/admin/locales`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

export async function setMaintenanceMode(token: string, enabled: boolean, message?: string) {
  const res = await fetch(`${API_BASE_URL}/admin/appearance`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ maintenanceModeEnabled: enabled, ...(message ? { maintenanceMessage: message } : {}) }),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

export { API_BASE_URL };
