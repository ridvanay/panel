import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VariablePanel } from "@/components/admin/email-editor/variable-panel";
import type { EmailVariableDefinition } from "@/lib/api/types";
import type { VariableTarget } from "@/hooks/use-variable-target";

function makeTarget(hasTarget: boolean, insertVariable = vi.fn()): VariableTarget {
  return { hasTarget, insertVariable, setTarget: vi.fn(), clearTarget: vi.fn() };
}

const BASE_VARIABLES: EmailVariableDefinition[] = [
  { key: "site_name", label: "Site Adı", sampleValue: "Acme", source: "system" },
  { key: "site_url", label: "Site URL", sampleValue: "https://acme.test", source: "system" },
  { key: "user_name", label: "Kullanıcı Adı", sampleValue: "Ada", source: "system" },
  { key: "reset_link", label: "Sıfırlama Bağlantısı", sampleValue: "https://…", source: "system" },
];

describe("VariablePanel", () => {
  it("hedef yokken tüm satırlar disabled olur ve bilgi çubuğu görünür", () => {
    render(
      <VariablePanel variables={BASE_VARIABLES} customVariables={[]} onAddCustomVariable={vi.fn()} target={makeTarget(false)} />
    );
    expect(screen.getByText("Önce bir metin alanına tıklayın")).toBeInTheDocument();
    const rows = screen.getAllByRole("button", { name: /Site Adı|Kullanıcı Adı/ });
    for (const row of rows) expect(row).toBeDisabled();
  });

  it("değişkenleri source'a göre gruplar: Genel (site_name/site_url) ayrı, Sistem ayrı", () => {
    render(
      <VariablePanel variables={BASE_VARIABLES} customVariables={[]} onAddCustomVariable={vi.fn()} target={makeTarget(true)} />
    );
    expect(screen.getByText("Genel")).toBeInTheDocument();
    expect(screen.getByText("Sistem Değişkenleri")).toBeInTheDocument();
    expect(screen.getByText("Site Adı")).toBeInTheDocument();
    expect(screen.getByText("{{site_name}}")).toBeInTheDocument();
  });

  it("toplam değişken sayısı 8'in altındaysa arama kutusu gizlenir", () => {
    render(
      <VariablePanel variables={BASE_VARIABLES} customVariables={[]} onAddCustomVariable={vi.fn()} target={makeTarget(true)} />
    );
    expect(screen.queryByLabelText("Değişken ara")).not.toBeInTheDocument();
  });

  it("toplam değişken sayısı >= 8 ise arama kutusu görünür", () => {
    const many: EmailVariableDefinition[] = [
      ...BASE_VARIABLES,
      { key: "a", label: "A", sampleValue: "1", source: "custom" },
      { key: "b", label: "B", sampleValue: "1", source: "custom" },
      { key: "c", label: "C", sampleValue: "1", source: "custom" },
      { key: "d", label: "D", sampleValue: "1", source: "custom" },
    ];
    render(<VariablePanel variables={many} customVariables={[]} onAddCustomVariable={vi.fn()} target={makeTarget(true)} />);
    expect(screen.getByLabelText("Değişken ara")).toBeInTheDocument();
  });

  it("bir değişkene tıklanınca insertVariable(key) çağrılır", async () => {
    const insertVariable = vi.fn();
    const user = userEvent.setup();
    render(
      <VariablePanel
        variables={BASE_VARIABLES}
        customVariables={[]}
        onAddCustomVariable={vi.fn()}
        target={makeTarget(true, insertVariable)}
      />
    );
    await user.click(screen.getByText("Kullanıcı Adı"));
    expect(insertVariable).toHaveBeenCalledWith("user_name");
  });

  it("özel değişken ekleme formu: etiketten anahtar önerir, çakışan anahtarda Ekle disabled olur", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <VariablePanel variables={BASE_VARIABLES} customVariables={[]} onAddCustomVariable={onAdd} target={makeTarget(true)} />
    );
    await user.click(screen.getByText("Özel Değişken Ekle"));
    // "Site Name" → slugifyVariableKey ile "site_name" üretir, BASE_VARIABLES'taki sistem
    // değişkeniyle (site_name) ÇAKIŞIR.
    await user.type(screen.getByLabelText("Etiket"), "Site Name");
    expect(screen.getByText("Bu anahtar zaten kullanılıyor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ekle" })).toBeDisabled();
  });

  it("geçerli özel değişken eklenince onAddCustomVariable doğru payload ile çağrılır", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <VariablePanel variables={BASE_VARIABLES} customVariables={[]} onAddCustomVariable={onAdd} target={makeTarget(true)} />
    );
    await user.click(screen.getByText("Özel Değişken Ekle"));
    await user.type(screen.getByLabelText("Etiket"), "Telefon Numarası");
    await user.type(screen.getByLabelText("Örnek Değer"), "0555 000 00 00");
    await user.click(screen.getByRole("button", { name: "Ekle" }));
    expect(onAdd).toHaveBeenCalledWith({ key: "telefon_numarasi", label: "Telefon Numarası", sampleValue: "0555 000 00 00" });
  });

  // BUG DÜZELTMESİ (qa-agent, design-notes §A.7 ihlali) — `customVariables` (bellek içi, henüz
  // KAYDEDİLMEMİŞ) `variables` (sunucudan en son yüklenen) prop'uyla BİRLEŞTİRİLMELİ; aksi halde
  // "Eklenen değişken ANINDA 'Özel Değişkenler' grubunun listesine düşer" davranışı ihlal edilir.
  describe("bellek içi (henüz kaydedilmemiş) özel değişkenler — design-notes §A.7", () => {
    it("`customVariables` prop'undaki bir değişken `variables` içinde OLMASA BİLE panelde ANINDA görünür", () => {
      render(
        <VariablePanel
          variables={BASE_VARIABLES}
          customVariables={[{ key: "telefon_numarasi", label: "Telefon Numarası", sampleValue: "0555 000 00 00" }]}
          onAddCustomVariable={vi.fn()}
          target={makeTarget(true)}
        />
      );
      expect(screen.getByText("Özel Değişkenler")).toBeInTheDocument();
      expect(screen.getByText("Telefon Numarası", { exact: true })).toBeInTheDocument();
      expect(screen.getByText("{{telefon_numarasi}}")).toBeInTheDocument();
    });

    it("bellek içi değişkene tıklanınca da insertVariable(key) çağrılır (kaydetmeden kullanılabilir)", async () => {
      const insertVariable = vi.fn();
      const user = userEvent.setup();
      render(
        <VariablePanel
          variables={BASE_VARIABLES}
          customVariables={[{ key: "telefon_numarasi", label: "Telefon Numarası", sampleValue: "0555 000 00 00" }]}
          onAddCustomVariable={vi.fn()}
          target={makeTarget(true, insertVariable)}
        />
      );
      await user.click(screen.getByText("Telefon Numarası", { exact: true }));
      expect(insertVariable).toHaveBeenCalledWith("telefon_numarasi");
    });

    it("bellek içi değişken toplam sayıma katılır (>=8 eşiğinde arama kutusunu tetikleyebilir)", () => {
      const seven: EmailVariableDefinition[] = [
        ...BASE_VARIABLES,
        { key: "a", label: "A", sampleValue: "1", source: "custom" },
        { key: "b", label: "B", sampleValue: "1", source: "custom" },
        { key: "c", label: "C", sampleValue: "1", source: "custom" },
      ];
      render(
        <VariablePanel
          variables={seven}
          customVariables={[{ key: "yeni_ozel", label: "Yeni Özel", sampleValue: "x" }]}
          onAddCustomVariable={vi.fn()}
          target={makeTarget(true)}
        />
      );
      expect(screen.getByLabelText("Değişken ara")).toBeInTheDocument();
      expect(screen.getByText("Yeni Özel", { exact: true })).toBeInTheDocument();
    });

    it("kaydedilmiş (variables içindeki) bir anahtar bellek içi kopyasıyla YİNELENMEZ", () => {
      render(
        <VariablePanel
          variables={BASE_VARIABLES}
          customVariables={[{ key: "site_name", label: "Eski Etiket", sampleValue: "x" }]}
          onAddCustomVariable={vi.fn()}
          target={makeTarget(true)}
        />
      );
      // Sunucu sürümü ("Site Adı") tek kalır — bellek içi kopyanın "Eski Etiket" etiketi görünmez.
      expect(screen.getAllByText("{{site_name}}")).toHaveLength(1);
      expect(screen.queryByText("Eski Etiket")).not.toBeInTheDocument();
    });

    it("yeni özel değişkenin anahtarı `variables`'ta OLMASA bile çakışma kontrolü onu YAKALAR", async () => {
      const user = userEvent.setup();
      render(
        <VariablePanel
          variables={BASE_VARIABLES}
          customVariables={[{ key: "telefon_numarasi", label: "Telefon Numarası", sampleValue: "0555 000 00 00" }]}
          onAddCustomVariable={vi.fn()}
          target={makeTarget(true)}
        />
      );
      await user.click(screen.getByText("Özel Değişken Ekle"));
      await user.type(screen.getByLabelText("Etiket"), "Telefon Numarası");
      expect(screen.getByText("Bu anahtar zaten kullanılıyor")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ekle" })).toBeDisabled();
    });
  });
});
