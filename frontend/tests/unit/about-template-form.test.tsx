import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AboutTemplateForm } from "@/components/admin/page-builder/about-template-form";
import { buildDefaultAboutContent, emptyAboutContent, type AboutPageContent } from "@/lib/about-page";
import { aboutStrings as trAboutStrings } from "@/lib/i18n/site-dictionaries/tr/about";

const listPublicDoctors = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({ listPublicDoctors: (...args: unknown[]) => listPublicDoctors(...args) }));

/** Formu gerçek bir ebeveyn gibi kontrollü tutar; son değeri dışarı verir. */
function Harness({ initial, onValue }: { initial: AboutPageContent; onValue: (value: AboutPageContent) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <AboutTemplateForm
      value={value}
      localeCode="tr"
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

function renderForm(initial: AboutPageContent = emptyAboutContent()) {
  let latest = initial;
  render(<Harness initial={initial} onValue={(value) => (latest = value)} />);
  return () => latest;
}

beforeEach(() => {
  listPublicDoctors.mockReset();
  listPublicDoctors.mockResolvedValue({
    items: [
      { id: "d1", title: "Dr.", fullName: "Elif Aydemir" },
      { id: "d2", title: "Prof. Dr.", fullName: "Ahmet Kara" },
    ],
    meta: {},
  });
});

describe("AboutTemplateForm", () => {
  it("boş alanlarda sözlük varsayılanını placeholder olarak gösterir", () => {
    renderForm();
    const defaults = buildDefaultAboutContent(trAboutStrings);
    expect(screen.getAllByPlaceholderText(defaults.hero.title)[0]).toHaveValue("");
    expect(screen.getByPlaceholderText(defaults.closing.title)).toBeInTheDocument();
  });

  it("metin değişikliğini ilgili alana yazar", async () => {
    const latest = renderForm();
    const defaults = buildDefaultAboutContent(trAboutStrings);
    await userEvent.type(screen.getByPlaceholderText(defaults.hero.locationTitle), "Ankara");
    expect(latest().hero.locationTitle).toBe("Ankara");
  });

  it("tedavi kartı ekler, sıralar ve siler", async () => {
    const latest = renderForm();
    const addButton = screen.getByRole("button", { name: "Kart ekle" });
    await userEvent.click(addButton);
    await userEvent.click(addButton);
    expect(latest().treatments.items).toHaveLength(2);

    const nameInputs = screen.getAllByPlaceholderText("Ör. Diş tedavileri");
    await userEvent.type(nameInputs[0]!, "Birinci");
    await userEvent.type(nameInputs[1]!, "İkinci");
    const secondId = latest().treatments.items[1]!.id;

    await userEvent.click(screen.getAllByRole("button", { name: "Yukarı taşı" })[1]!);
    expect(latest().treatments.items.map((i) => i.name)).toEqual(["İkinci", "Birinci"]);
    expect(latest().treatments.items[0]!.id).toBe(secondId);

    await userEvent.click(screen.getAllByRole("button", { name: "Sil" })[0]!);
    expect(latest().treatments.items.map((i) => i.name)).toEqual(["Birinci"]);
  });

  it("liste boşken varsayılan kartları düzenlemeye alabilir", async () => {
    const latest = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Varsayılan kartları düzenlemeye al" }));
    expect(latest().treatments.items.map((i) => i.name)).toEqual(buildDefaultAboutContent(trAboutStrings).treatments.items.map((i) => i.name));
  });

  it("madde numaralarını sıradan üretir ve en fazla 6 maddeye izin verir", async () => {
    const latest = renderForm();
    const add = screen.getByRole("button", { name: "Madde ekle" });
    for (let i = 0; i < 6; i++) await userEvent.click(add);
    expect(latest().approach.items).toHaveLength(6);
    expect(screen.getByText("Madde 06")).toBeInTheDocument();
    expect(add).toBeDisabled();
  });

  it("bölümü gizle anahtarları üç bölüm için de çalışır ve gizli bölümün alanlarını kapatır", async () => {
    const latest = renderForm();
    expect(screen.getAllByText("Bölümü göster")).toHaveLength(3);
    await userEvent.click(document.getElementById("about-treatments-enabled")!);
    expect(latest().treatments.enabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Kart ekle" })).not.toBeInTheDocument();

    await userEvent.click(document.getElementById("about-approach-enabled")!);
    await userEvent.click(document.getElementById("about-doctors-enabled")!);
    expect(latest().approach.enabled).toBe(false);
    expect(latest().doctors.enabled).toBe(false);
  });

  it("kurucuyu aktif doktorlar listesinden seçer, 'Seçilmedi' ile temizler ve doktor sayısını ayarlar", async () => {
    const latest = renderForm();
    const founder = screen.getByLabelText("Kurucu doktor");
    await waitFor(() => expect(within(founder).getByRole("option", { name: "Prof. Dr. Ahmet Kara" })).toBeInTheDocument());

    await userEvent.selectOptions(founder, "d2");
    expect(latest().doctors.founderDoctorId).toBe("d2");
    await userEvent.selectOptions(founder, "");
    expect(latest().doctors.founderDoctorId).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Gösterilecek doktor sayısı"), "5");
    expect(latest().doctors.count).toBe(5);
  });

  it("seçili kurucu artık aktif değilse uyarır", async () => {
    const initial = emptyAboutContent();
    initial.doctors.founderDoctorId = "silinmis";
    renderForm(initial);
    expect(await screen.findByText("Seçili doktor artık aktif değil — sitede kurucu etiketi gösterilmez.")).toBeInTheDocument();
  });

  it("doktor listesi alınamazsa çökmez, yalnızca 'Seçilmedi' kalır", async () => {
    listPublicDoctors.mockRejectedValueOnce(new Error("404"));
    renderForm();
    const founder = screen.getByLabelText("Kurucu doktor");
    await waitFor(() => expect(founder).not.toBeDisabled());
    expect(within(founder).getAllByRole("option").map((o) => o.textContent)).toEqual(["Seçilmedi"]);
  });
});
