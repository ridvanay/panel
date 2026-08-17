import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useEmailTemplateEditor } from "@/hooks/use-email-template-editor";
import * as emailTemplatesApi from "@/lib/api/email-templates";
import type { EmailTemplate } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/notifications/templates/tpl-1",
}));

vi.mock("@/lib/api/email-templates", () => ({
  getTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  activateTemplate: vi.fn(),
  previewTemplate: vi.fn(),
  duplicateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  listTemplates: vi.fn(),
  listVariablesForPurpose: vi.fn(),
}));

function makeTemplate(overrides: Partial<EmailTemplate> = {}): EmailTemplate {
  return {
    id: "tpl-1",
    key: null,
    name: "Orijinal Ad",
    purpose: "CUSTOM",
    editorMode: "BLOCKS",
    isSystem: false,
    isActive: false,
    subject: "Orijinal Konu",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    bodyHtml: "",
    blocks: [],
    availableVariables: [],
    customVariables: [],
    variables: [],
    ...overrides,
  };
}

/**
 * BUG DÜZELTMESİ (qa-agent, `admin-email-template-editor.spec.ts` bulgusu) — mount sırasında
 * `GET .../templates/{id}` isteği birden fazla kez tetiklenebiliyordu (React Strict Mode/App
 * Router çift-mount etkileşimi); iptal/sıra koruması olmadığı için GEÇ dönen bir yanıt
 * `applyLoaded()` ile kullanıcının yerel düzenlemelerini SESSİZCE eziyordu. Bu testler
 * `useEmailTemplateEditor`'ın `requestGenerationRef` korumasını doğrudan doğrular.
 */
describe("useEmailTemplateEditor — request-generation guard", () => {
  it("geç dönen STALE bir load() yanıtı, daha SONRA tetiklenmiş bir load()'un sonucunu ya da onun ardından yapılan yerel düzenlemeleri EZMEZ", async () => {
    let resolveFirst!: (t: EmailTemplate) => void;
    const firstPromise = new Promise<EmailTemplate>((resolve) => {
      resolveFirst = resolve;
    });
    let resolveSecond!: (t: EmailTemplate) => void;
    const secondPromise = new Promise<EmailTemplate>((resolve) => {
      resolveSecond = resolve;
    });

    const getTemplateMock = vi.mocked(emailTemplatesApi.getTemplate);
    getTemplateMock.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);
    vi.mocked(emailTemplatesApi.previewTemplate).mockResolvedValue({ renderedHtml: "", renderedSubject: "" });

    const { result } = renderHook(() => useEmailTemplateEditor("tpl-1"));

    // Mount effect'i zaten İLK load() çağrısını (generation 1) tetikledi — `firstPromise` beklemede.
    expect(getTemplateMock).toHaveBeenCalledTimes(1);

    // React Strict Mode/App Router çift-mount'unu simüle eden İKİNCİ, daha SONRAKİ bir load() çağrısı
    // (generation 2) — gerçek koşumda gözlemlenen "4 kez tetikleniyor" senaryosunun basitleştirilmiş hali.
    act(() => {
      result.current.reload();
    });
    expect(getTemplateMock).toHaveBeenCalledTimes(2);

    // En SON çağrılan (generation 2) istek ÖNCE döner ve uygulanır.
    await act(async () => {
      resolveSecond(makeTemplate({ name: "Sunucudan Gelen Ad" }));
      await secondPromise;
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.name).toBe("Sunucudan Gelen Ad");

    // Kullanıcı bu arada elle bir düzenleme yapar.
    act(() => {
      result.current.setName("Kullanıcının Yazdığı Ad");
    });
    expect(result.current.name).toBe("Kullanıcının Yazdığı Ad");

    // Şimdi İLK (stale, generation 1) istek GEÇ döner — `requestGenerationRef` bunu YOK SAYMALI.
    await act(async () => {
      resolveFirst(makeTemplate({ name: "Eski/Stale Sunucu Adı" }));
      await firstPromise;
    });

    // Kullanıcının düzenlemesi KORUNMALI — stale yanıt onu EZMEMELİ.
    expect(result.current.name).toBe("Kullanıcının Yazdığı Ad");
  });

  it("stale bir load() BAŞARISIZ olursa (hata), aktif (en son) generation'ın loadError'ını SİLMEZ", async () => {
    let rejectFirst!: (err: unknown) => void;
    const firstPromise = new Promise<EmailTemplate>((_resolve, reject) => {
      rejectFirst = reject;
    });
    let resolveSecond!: (t: EmailTemplate) => void;
    const secondPromise = new Promise<EmailTemplate>((resolve) => {
      resolveSecond = resolve;
    });

    const getTemplateMock = vi.mocked(emailTemplatesApi.getTemplate);
    getTemplateMock.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);
    vi.mocked(emailTemplatesApi.previewTemplate).mockResolvedValue({ renderedHtml: "", renderedSubject: "" });

    const { result } = renderHook(() => useEmailTemplateEditor("tpl-1"));

    act(() => {
      result.current.reload();
    });

    await act(async () => {
      resolveSecond(makeTemplate({ name: "Sunucudan Gelen Ad" }));
      await secondPromise;
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      rejectFirst(new Error("stale ağ hatası"));
      await firstPromise.catch(() => {});
    });

    // Stale hatanın loadError'ı DOLDURMAMASI ve `loaded` durumunun BOZULMAMASI gerekir.
    expect(result.current.loadError).toBeNull();
    expect(result.current.loaded).toBe(true);
    expect(result.current.name).toBe("Sunucudan Gelen Ad");
  });
});
