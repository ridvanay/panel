import { test, expect } from "@playwright/test";
import { getCachedAdminSession, getAdminSettings, patchSiteSettings, API_BASE_URL } from "./support/api";
import { registerFixtureUser, adminGetUserByEmail, adminUpdateRole, resetFixtureUserToBaseline } from "./support/admin-users-fixtures";
import { createAuthenticatedPageAs } from "./support/admin-session";

/**
 * qa-agent — `.claude/architect-scope-support-desk-and-reminders.md` §4.8 madde 7/9/10/13/14/15
 * canlı doğrulaması. Ziyaretçi mesajı GERÇEK public uçtan (`POST /support/sessions`) açılır,
 * admin paneli (`/admin/support`) MANAGER hesabıyla GERÇEK UI üzerinden yanıtlar; EDITOR'ün
 * `/admin/support/*`den 403 aldığı DOĞRUDAN API isteğiyle (UI'da bağlantı gizliliği KANIT
 * SAYILMAZ — görev talimatı, bağlayıcı) ayrıca doğrulanır.
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
const MANAGER_EMAIL = `qa-e2e-support-manager-${RUN_SUFFIX}@example.com`;
const MANAGER_PASSWORD = "QaE2eSupportManager12345!";
const EDITOR_EMAIL = `qa-e2e-support-editor-${RUN_SUFFIX}@example.com`;
const EDITOR_PASSWORD = "QaE2eSupportEditor12345!";

let adminToken: string;
let managerToken: string;
let editorToken: string;
let initialLiveChatEnabled: boolean;

async function createVisitorSession(message: string): Promise<{ sessionId: string; accessToken: string }> {
  const res = await fetch(`${API_BASE_URL}/support/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitorName: `QA Ziyaretçi ${RUN_SUFFIX}`, visitorEmail: `qa-visitor-${RUN_SUFFIX}@example.com`, message }),
  });
  const body = (await res.json()) as { data: { sessionId: string; accessToken: string } };
  if (!res.ok) throw new Error(`qa-agent: destek oturumu açılamadı: ${res.status} ${JSON.stringify(body)}`);
  return body.data;
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  await registerFixtureUser(MANAGER_EMAIL, MANAGER_PASSWORD, "QA Support Manager");
  const managerUser = await adminGetUserByEmail(adminToken, MANAGER_EMAIL);
  if (!managerUser) throw new Error("qa-agent: MANAGER fixture kullanıcısı bulunamadı.");
  const roleRes = await adminUpdateRole(adminToken, managerUser.id, "MANAGER");
  expect(roleRes.status).toBe(200);

  await registerFixtureUser(EDITOR_EMAIL, EDITOR_PASSWORD, "QA Support Editor");
  const editorUser = await adminGetUserByEmail(adminToken, EDITOR_EMAIL);
  if (!editorUser) throw new Error("qa-agent: EDITOR fixture kullanıcısı bulunamadı.");
  const editorRoleRes = await adminUpdateRole(adminToken, editorUser.id, "EDITOR");
  expect(editorRoleRes.status).toBe(200);

  const managerLogin = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: MANAGER_EMAIL, password: MANAGER_PASSWORD }),
  }).then((r) => r.json() as Promise<{ data: { tokens: { accessToken: string } } }>);
  managerToken = managerLogin.data.tokens.accessToken;

  const editorLogin = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD }),
  }).then((r) => r.json() as Promise<{ data: { tokens: { accessToken: string } } }>);
  editorToken = editorLogin.data.tokens.accessToken;

  // Ziyaretçi `POST /support/sessions` §3 gereği yalnızca `liveChatEnabled && provider==="internal"`
  // iken 200'dür (`live-chat-widget.spec.ts`in paylaşımlı-demo-ortamı KAPALI bırakma kuralıyla
  // AYNI gerekçe) — bu dosya kendi ihtiyacı için AÇAR, `afterAll`de eski değere DÖNER.
  const settings = await getAdminSettings(adminToken);
  initialLiveChatEnabled = Boolean(settings.liveChatEnabled);
  if (!initialLiveChatEnabled) {
    await patchSiteSettings(adminToken, { liveChatEnabled: true, liveChatProvider: "internal" });
  }
});

test.afterAll(async () => {
  await resetFixtureUserToBaseline(adminToken, MANAGER_EMAIL).catch(() => undefined);
  await resetFixtureUserToBaseline(adminToken, EDITOR_EMAIL).catch(() => undefined);
  if (!initialLiveChatEnabled) {
    await patchSiteSettings(adminToken, { liveChatEnabled: false }).catch(() => undefined);
  }
});

test("madde 12: EDITOR `/admin/support/sessions`e DOĞRUDAN API isteğiyle 403 alır; MANAGER 200 alır", async () => {
  const editorRes = await fetch(`${API_BASE_URL}/admin/support/sessions`, { headers: { Authorization: `Bearer ${editorToken}` } });
  expect(editorRes.status, "qa-agent: EDITOR /admin/support/* üzerinde 403 almalı (rbac §4.4).").toBe(403);

  const managerRes = await fetch(`${API_BASE_URL}/admin/support/sessions`, { headers: { Authorization: `Bearer ${managerToken}` } });
  expect(managerRes.status).toBe(200);
});

test("madde 7/9/10/13/14: ziyaretçi mesajı 'Bekleyen'de görünür → MANAGER şablonla yanıtlar → oturum 'Yanıtlandı'ya geçer ve yanıtlayana OTOMATİK atanır", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const templateTitle = `QA Karşılama Şablonu ${RUN_SUFFIX}`;
  const templateBody = "Merhaba, size nasıl yardımcı olabilirim?";
  const createTemplateRes = await fetch(`${API_BASE_URL}/admin/support/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ title: templateTitle, body: templateBody }),
  });
  expect(createTemplateRes.status).toBe(201);

  const visitorMessage = `QA e2e destek mesajı ${RUN_SUFFIX} — randevumu değiştirmek istiyorum.`;
  const visitor = await createVisitorSession(visitorMessage);

  const { page, close } = await createAuthenticatedPageAs(browser, MANAGER_EMAIL, MANAGER_PASSWORD);
  try {
    await page.goto("/admin/support");

    // Sidebar'da "Canlı Destek" MANAGER'a görünür (§4.8 madde 15 UI tarafı — API kanıtı yukarıda).
    await expect(page.getByRole("link", { name: "Canlı Destek" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("tab", { name: /Bekleyen/ }).click();

    const sessionButton = page.getByRole("button", { name: new RegExp(visitorMessage.slice(0, 30)) });
    await expect(sessionButton).toBeVisible({ timeout: 20_000 });
    await sessionButton.click();

    await expect(page.getByText(visitorMessage)).toBeVisible({ timeout: 10_000 });

    const templateSelect = page.getByLabel("Hazır yanıt şablonu seç");
    await expect(templateSelect).toBeVisible({ timeout: 10_000 });
    await templateSelect.selectOption({ label: templateTitle });

    const replyBox = page.getByLabel("Yanıt metni");
    await expect(replyBox).toHaveValue(templateBody);

    await page.getByRole("button", { name: "Gönder" }).click();
    await expect(page.getByText(templateBody).last()).toBeVisible({ timeout: 10_000 });

    // Madde 9: oturum ANSWERED'a geçer ve yanıtlayana (MANAGER) otomatik atanır.
    await expect(page.getByText("Yanıtlandı")).toBeVisible({ timeout: 10_000 });
    const assignSelect = page.getByLabel("Temsilci ata");
    await expect(assignSelect).toHaveValue(/.+/, { timeout: 10_000 });
    await expect(assignSelect.locator("option:checked")).toHaveText("QA Support Manager");

    // Madde 8: ziyaretçi tarafında (public poll) yanıt ~5sn içinde görünür.
    await expect(async () => {
      const pollRes = await fetch(`${API_BASE_URL}/support/sessions/${visitor.sessionId}/messages?t=${visitor.accessToken}`);
      const body = (await pollRes.json()) as { data: { body: string }[] };
      expect(body.data.some((m) => m.body === templateBody)).toBe(true);
    }).toPass({ timeout: 15_000, intervals: [1_000, 2_000] });
  } finally {
    await close();
  }

  // Temizlik — şablon silinir (`DELETE /admin/support/templates/{id}`).
  const listRes = await fetch(`${API_BASE_URL}/admin/support/templates`, { headers: { Authorization: `Bearer ${adminToken}` } });
  const list = (await listRes.json()) as { data: { id: string; title: string }[] };
  const created = list.data.find((t) => t.title === templateTitle);
  if (created) {
    await fetch(`${API_BASE_URL}/admin/support/templates/${created.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
  }
});
