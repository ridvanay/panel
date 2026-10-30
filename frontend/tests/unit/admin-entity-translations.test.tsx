import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Locale, Media, Specialty } from "@/lib/api/types";
import type { Slide } from "@/lib/sliders/types";

/**
 * Paket O (İş 4) — menü / footer / uzmanlık / slayt çevirileri:
 *  - dil sekmeleri: EN (kanonik) ilk; TR dahil diğer diller `translations.<dil>`
 *  - menü ağacı RU sekmesinde etiketi değil çeviriyi düzenler; kayıt yükünde `translations` taşınır
 *  - uzmanlık formu RU sekmesinde girilen adı `translations.ru.name` olarak kaydeder
 *  - slayt "Dile özel görsel": yalnızca kütüphane medyası id'leri istek gövdesine gider
 *  - site tarafı: menü/uzmanlık/slider istekleri aktif dili `?locale=` ile ister
 */
const LOCALES: Locale[] = [
  { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
  { code: "ru", label: "Rusça", nativeLabel: "Русский", isDefault: false, enabled: true, sortOrder: 2, hreflang: null },
];

vi.mock("@/lib/api/locales", () => ({ listAdminLocales: vi.fn(async () => LOCALES) }));

const SPECIALTY = {
  id: "sp1",
  name: "Cardiology",
  slug: "cardiology",
  icon: "heart-pulse",
  description: null,
  order: 0,
  isActive: true,
  imageMediaId: null,
  imageUrl: null,
  translations: { tr: { name: "Kardiyoloji" } },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as Specialty;
const updateSpecialty = vi.fn<(id: string, body: unknown) => Promise<Specialty>>(async () => SPECIALTY);
vi.mock("@/lib/api/telehealth", () => ({
  listAdminSpecialties: vi.fn(async () => [SPECIALTY]),
  createSpecialty: vi.fn(),
  updateSpecialty: (id: string, body: unknown) => updateSpecialty(id, body),
  deleteSpecialty: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const fetchServerJson = vi.fn<(path: string, options?: unknown) => Promise<null>>(async () => null);
vi.mock("@/lib/api/server-fetch", () => ({ fetchServerJson: (path: string, options?: unknown) => fetchServerJson(path, options) }));

import { orderTranslationLocales, setTranslation, translationStatus } from "@/components/admin/translation-locale-tabs";
import { NavTreeEditor } from "@/components/admin/navigation/nav-tree-editor";
import { toNavigationItemsPayload, type FlatNavItem } from "@/components/admin/navigation/nav-tree-utils";
import { SlideLocaleImages, toSlideTranslationsRequest } from "@/components/admin/hero-studio/inspector/slide-locale-images";

beforeEach(() => {
  updateSpecialty.mockClear();
  fetchServerJson.mockClear();
});

describe("dil sekmesi yardımcıları", () => {
  it("EN (kanonik) önce ve kaynak sekme; TR dahil diğerleri çeviri", () => {
    const ordered = orderTranslationLocales(LOCALES);
    expect(ordered.map((l) => [l.code, l.isDefault])).toEqual([
      ["en", true],
      ["tr", false],
      ["ru", false],
    ]);
  });

  it("boş metin çeviriyi siler (EN'e düşer); durum hesaplanır", () => {
    const t = setTranslation({}, "ru", "label", "Врачи");
    expect(t).toEqual({ ru: { label: "Врачи" } });
    expect(setTranslation(t, "ru", "label", "  ")).toEqual({});
    expect(translationStatus([{ translations: t, fields: ["label"] }], "ru")).toBe("translated");
    expect(translationStatus([{ translations: t, fields: ["label"] }, { translations: {}, fields: ["label"] }], "ru")).toBe("partial");
    expect(translationStatus([{ translations: t, fields: ["label"] }], "tr")).toBe("untranslated");
  });
});

describe("menü ağacı RU sekmesi", () => {
  function Harness({ onChange }: { onChange: (items: FlatNavItem[]) => void }) {
    const [items, setItems] = useState<FlatNavItem[]>([{ id: "a", label: "Doctors", href: "/physicians", parentId: null, translations: { tr: { label: "Doktorlar" } } }]);
    return (
      <NavTreeEditor
        items={items}
        hrefHint="hint"
        locale="ru"
        onChange={(next) => {
          setItems(next);
          onChange(next);
        }}
      />
    );
  }

  it("etiket alanı çeviriyi düzenler, kanonik etiket ve diğer diller korunur; kayıt yükü çevirileri taşır", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Düzenle" }));
    const input = screen.getByLabelText("Etiket (RU)");
    expect(input).toHaveAttribute("placeholder", "Doctors");
    await user.type(input, "Врачи");
    const last = onChange.mock.calls.at(-1)![0] as FlatNavItem[];
    expect(last[0]).toMatchObject({ label: "Doctors", translations: { tr: { label: "Doktorlar" }, ru: { label: "Врачи" } } });
    expect(toNavigationItemsPayload(last)[0]).toMatchObject({ id: "a", label: "Doctors", translations: { ru: { label: "Врачи" } } });
  });
});

describe("uzmanlık formu dil sekmeleri", () => {
  it("RU sekmesinde girilen ad translations.ru.name olarak kaydedilir; EN kanonik ve TR çevirisi korunur", async () => {
    const { default: Page } = await import("@/app/admin/telehealth/specialties/page");
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: '"Cardiology" uzmanlığını düzenle' }));
    await user.click(await screen.findByRole("tab", { name: /^ru/i }));
    const ru = screen.getByLabelText("Uzmanlık adı (RU)");
    expect(ru).toHaveAttribute("placeholder", "Cardiology");
    await user.type(ru, "Кардиология");
    await user.click(screen.getByRole("tab", { name: /^tr/i }));
    expect(screen.getByLabelText("Uzmanlık adı (TR)")).toHaveValue("Kardiyoloji");
    await user.click(screen.getByRole("tab", { name: /^en/i }));
    expect(screen.getByLabelText(/^Uzmanlık adı/)).toHaveValue("Cardiology");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSpecialty).toHaveBeenCalled());
    expect(updateSpecialty.mock.calls[0]![1]).toMatchObject({
      name: "Cardiology",
      translations: { tr: { name: "Kardiyoloji" }, ru: { name: "Кардиология" } },
    });
  });
});

describe("slayt — dile özel görsel", () => {
  const media = (id: string): Media => ({ id, url: `/uploads/${id}.jpg`, filename: `${id}.jpg`, mimeType: "image/jpeg" }) as Media;

  it("istek gövdesine yalnızca kütüphane id'leri gider", () => {
    expect(toSlideTranslationsRequest({ ru: { bgMedia: media("m1"), bgTabletMedia: null, bgMobileMedia: media("m2") } })).toEqual({
      ru: { bgMediaId: "m1", bgTabletMediaId: null, bgMobileMediaId: "m2" },
    });
    expect(toSlideTranslationsRequest(undefined)).toEqual({});
  });

  it("dil seçici ve dile ait görsel alanları; kaldırma dil kaydını siler", async () => {
    const onUpdate = vi.fn();
    const slide = { id: "s1", translations: { ru: { bgMedia: media("m1"), bgTabletMedia: null, bgMobileMedia: null } } } as unknown as Slide;
    const user = userEvent.setup();
    render(<SlideLocaleImages slide={slide} onUpdate={onUpdate} />);
    expect(await screen.findByText("Dile özel görsel")).toBeInTheDocument();
    expect(screen.getByText("Tanımlı diller: RU")).toBeInTheDocument();
    // Bu bileşende dış URL alanı yoktur — yalnızca kütüphane seçimi.
    expect(screen.queryByRole("textbox", { name: /url/i })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Dil"), "ru");
    await user.click(screen.getByRole("button", { name: "RU görselini kaldır" }));
    expect(onUpdate).toHaveBeenCalledWith({ translations: {} });
  });
});

describe("site istekleri aktif dili taşır", () => {
  it("menü, uzmanlık ve slider ?locale= ile istenir", async () => {
    const { fetchNavigationConfigServer } = await import("@/lib/api/server-navigation");
    const { fetchSpecialtiesServer, fetchSpecialtyBySlugServer } = await import("@/lib/api/server-telehealth");
    const { fetchSliderServer } = await import("@/lib/api/server-sliders");
    await fetchNavigationConfigServer("ru");
    await fetchSpecialtiesServer("ar");
    await fetchSpecialtyBySlugServer("oncology", "tr");
    await fetchSliderServer("abc", "de");
    await waitFor(() => expect(fetchServerJson).toHaveBeenCalledTimes(4));
    expect(fetchServerJson.mock.calls.map((c) => c[0])).toEqual(["/navigation?locale=ru", "/specialties?locale=ar", "/specialties/oncology?locale=tr", "/sliders/abc?locale=de"]);
  });
});
