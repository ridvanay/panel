import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as emailTemplatesApi from "@/lib/api/email-templates";
import * as contactApi from "@/lib/api/contact";

/**
 * Regresyon — ARCHITECTURE.md §10.16.6 BREAKING: şablonlar artık `{templateId}` (uuid) ile
 * adreslenir, eski `{key}` DEĞİL. `frontend/src/lib/api/email-templates.ts` bu kontrata uymalı.
 */
describe("email-templates.ts — {templateId} adresleme", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: {} }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getTemplate uuid'yi {key} DEĞİL {templateId} olarak path'e koyar", async () => {
    await emailTemplatesApi.getTemplate("11111111-1111-1111-1111-111111111111");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/admin/notifications/templates/11111111-1111-1111-1111-111111111111");
  });

  it("activateTemplate POST .../{templateId}/activate çağırır", async () => {
    await emailTemplatesApi.activateTemplate("tpl-1");
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/admin/notifications/templates/tpl-1/activate");
    expect(options.method).toBe("POST");
  });

  it("duplicateTemplate POST .../{templateId}/duplicate çağırır", async () => {
    await emailTemplatesApi.duplicateTemplate("tpl-1");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/admin/notifications/templates/tpl-1/duplicate");
  });

  it("testSendTemplate gövdesinde `to` alanı GÖNDERMEZ (§10.16.6 bağlayıcı güvenlik kararı)", async () => {
    await emailTemplatesApi.testSendTemplate("tpl-1", { sampleValues: { user_name: "Ada" } });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/admin/notifications/templates/tpl-1/test-send");
    const body = JSON.parse(options.body as string);
    expect(body).not.toHaveProperty("to");
    expect(body.sampleValues).toEqual({ user_name: "Ada" });
  });

  it("previewTemplate DURUMSUZ /preview ucunu çağırır (templateId İÇERMEZ)", async () => {
    await emailTemplatesApi.previewTemplate({ purpose: "CUSTOM", editorMode: "BLOCKS", subject: "Konu", blocks: [] });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/admin/notifications/templates/preview");
  });
});

describe("contact.ts — public gönderim honeypot alanını taşır", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      status: 201,
      ok: true,
      json: async () => ({ data: { id: "sub-1", message: "Alındı" } }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submitContactForm gövdesinde website (honeypot) alanını istemciden geldiği gibi taşır", async () => {
    await contactApi.submitContactForm({ values: { name: "Ada", email: "a@example.com" }, consent: true, website: "" });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/contact/submissions");
    const body = JSON.parse(options.body as string);
    expect(body.website).toBe("");
    expect(body.consent).toBe(true);
  });

  it("getPublicContactForm GET /contact/form çağırır", async () => {
    fetchMock.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ data: { title: "İletişim" } }) });
    await contactApi.getPublicContactForm();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/contact/form");
  });
});
