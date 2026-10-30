import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MatcherRecommendation, MatcherTopic } from "@/lib/api/matcher";

/**
 * Paket W — "Find my physician": sözlük eşitliği (9 dil), arama (eş anlamlı, İ/ı, aksan), kırmızı
 * bayrak (seçim + serbest metin, ülkeye göre numara), sonuç kartları (tercüman rozeti ayara bağlı,
 * randevu bağlantısı yalnızca ?topic&from), URL ve CRM olaylarında kişisel veri yok.
 */
const nav = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => {
      nav.push(url);
      nav.params = new URLSearchParams(url.split("?")[1] ?? "");
    },
    back: nav.back,
    replace: vi.fn(),
  }),
  usePathname: () => "/tr/find-a-physician",
  useSearchParams: () => nav.params,
}));
vi.mock("@/context/locale-alternates-context", () => ({ useActiveLocaleCode: () => "tr", useLocalizePath: () => (p: string) => `/tr${p}` }));
const tzState = vi.hoisted(() => ({ timeZone: "Europe/Istanbul" as string | undefined }));
vi.mock("@/components/site/telehealth/use-patient-time-zone", () => ({ usePatientTimeZoneState: () => ({ timeZone: tzState.timeZone, ipHint: null }) }));
vi.mock("@/components/site/telehealth/dual-time", () => ({ DualSlotLabel: ({ iso }: { iso: string }) => <span>{iso.slice(11, 16)}</span> }));
vi.mock("@/lib/legal-pages", () => ({
  fetchLegalPagesClient: async () => [],
  resolveExplicitConsentPage: () => ({ slug: "acik-riza-metni", title: "Açık rıza" }),
  resolveKvkkNoticePage: () => ({ slug: "kvkk-aydinlatma-metni", title: "Aydınlatma" }),
}));

const api = vi.hoisted(() => ({
  catalog: { contactRequired: false, topics: [] as MatcherTopic[] },
  rec: null as MatcherRecommendation | null,
  recommend: vi.fn(),
  progress: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@/lib/api/matcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/matcher")>();
  return {
    ...actual,
    getMatcherCatalog: async () => api.catalog,
    recommendPhysicians: async (input: unknown) => (api.recommend(input), api.rec),
    reportMatcherProgress: (step: string) => api.progress(step),
    submitMatcher: async (input: { consentContact: boolean; callback?: boolean }) => (
      api.submit(input), input.consentContact || input.callback ? { id: "s1", number: 7, token: "t".repeat(30), stored: true } : { id: "x", number: 0, token: "", stored: false }
    ),
    requestMatcherCallback: vi.fn(async () => undefined),
    getMatcherWhatsappDigits: async () => "905551112233",
  };
});

import { MATCHER_DICTIONARIES } from "@/lib/i18n/use-matcher-strings";
import { matcherStrings as en } from "@/lib/i18n/matcher-dictionaries/en";
import { PhysicianMatcher } from "@/components/site/matcher/physician-matcher";
import { bookingHref, emergencyNumberFor, searchTopics, topicsInText } from "@/components/site/matcher/matcher-helpers";

const topic = (id: string, slug: string, label: string, synonyms: string[], bodyArea: MatcherTopic["bodyArea"] = "abdomen", isRedFlag = false): MatcherTopic => ({ id, slug, label, synonyms, bodyArea, isRedFlag, description: "" });
const TOPICS: MatcherTopic[] = [
  topic("t1", "reflux-heartburn", "Reflü / mide yanması", ["mide yanması", "ağza acı su gelmesi", "Sodbrennen", "حرقة المعدة", "изжога", "heartburn"]),
  topic("t2", "neck-pain", "Boyun ağrısı", ["boynum ağrıyor", "neck pain"], "neck-spine"),
  topic("t3", "kasik-fitigi", "Kasık fıtığı", ["KASIK FITIĞI"]),
  topic("rf1", "rf-chest-pain-breathless", "Göğüs ağrısı ve nefes darlığı", ["nefes alamıyorum", "can't breathe"], "chest", true),
];

const REC: MatcherRecommendation = {
  redFlag: false,
  redFlagTopicSlugs: [],
  coordinator: false,
  interpreterIncluded: true,
  topicSlugs: ["reflux-heartburn"],
  specialties: [{ id: "s-gas", slug: "gastroenterology", name: "Gastroenteroloji", description: "Sindirim sistemi", score: 100 }],
  doctors: [
    { id: "d1", slug: "ali-veli", displayName: "A. Veli", title: "Prof. Dr.", avatarUrl: null, specialtyName: "Gastroenteroloji", matchedSpecialtySlug: "gastroenterology", languages: ["tr", "en"], primaryMatch: true, speaksLanguage: true, slots: [{ startsAt: "2026-11-02T09:00:00.000Z", endsAt: "2026-11-02T09:30:00.000Z" }] },
  ],
};

function keyPaths(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
}
function values(value: unknown): string[] {
  if (value && typeof value === "object") return Object.values(value).flatMap(values);
  return [String(value)];
}

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.push.mockClear();
  api.catalog = { contactRequired: false, topics: TOPICS };
  api.rec = REC;
  api.recommend.mockClear();
  api.progress.mockClear();
  api.submit.mockClear();
  tzState.timeZone = "Europe/Istanbul";
  (window as unknown as { WMCRM?: unknown }).WMCRM = undefined;
});

describe("sözlük (9 dil)", () => {
  it("anahtar eşitliği, boş değer yok, yer tutucular korunmuş; sr-latn Latin, ro virgül altı", () => {
    const base = keyPaths(en).sort();
    expect(Object.keys(MATCHER_DICTIONARIES).sort()).toEqual(["ar", "de", "en", "es", "fr", "ro", "ru", "sr-latn", "tr"]);
    for (const [lang, dict] of Object.entries(MATCHER_DICTIONARIES)) {
      expect(keyPaths(dict).sort(), lang).toEqual(base);
      for (const v of values(dict)) expect(v.trim().length, lang).toBeGreaterThan(0);
      for (const key of ["progress", "book", "speaks", "requestNumber", "redFlagCall"] as const) {
        const placeholders = (en[key].match(/\{\w+\}/g) ?? []).sort();
        expect((dict[key].match(/\{\w+\}/g) ?? []).sort(), `${lang}.${key}`).toEqual(placeholders);
      }
    }
    expect(JSON.stringify(MATCHER_DICTIONARIES["sr-latn"])).not.toMatch(/[Ѐ-ӿ]/);
    expect(JSON.stringify(MATCHER_DICTIONARIES.ro)).not.toMatch(/[şţ]/);
  });

  it("ön yüz ve backend arama normalleştirmesi birebir aynı", () => {
    const body = (file: string) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/^\/\*\*[\s\S]*?\*\/\n/, "");
    expect(body(path.resolve(__dirname, "../../src/lib/matcher/text.ts"))).toBe(body(path.resolve(__dirname, "../../../backend/src/lib/matcher-text.ts")));
  });
});

describe("arama ve yardımcılar", () => {
  it("eş anlamlılar 9 dilde (TR, DE, AR, RU); İ/ı ve aksan duyarsız", () => {
    for (const q of ["mide yanması", "MİDE YANMASI", "mıde yanmasi", "Sodbrennen", "حرقة", "изжога", "Heartburn"]) {
      expect(searchTopics(TOPICS, q).map((t) => t.slug), q).toContain("reflux-heartburn");
    }
    expect(searchTopics(TOPICS, "kasık fıtığı")[0]!.slug).toBe("kasik-fitigi");
    expect(searchTopics(TOPICS, "kasik fitigi")[0]!.slug).toBe("kasik-fitigi");
    expect(searchTopics(TOPICS, "zzz")).toEqual([]);
    expect(topicsInText(TOPICS, "Dün gece nefes alamıyorum dedi").map((t) => t.slug)).toEqual(["rf-chest-pain-breathless"]);
  });

  it("ülkeye göre acil numarası; randevu bağlantısında yalnızca uzmanlık ve from (sağlık konusu YOK)", () => {
    expect([emergencyNumberFor("TR"), emergencyNumberFor("DE"), emergencyNumberFor("US"), emergencyNumberFor("GB"), emergencyNumberFor(null)]).toEqual(["112", "112", "911", "999", "112"]);
    expect(bookingHref((p) => `/tr${p}`, "ali-veli", "gastroenterology")).toBe("/tr/physicians/ali-veli?specialty=gastroenterology&from=matcher#randevu");
    expect(bookingHref((p) => `/en${p}`, "ali-veli", null)).toBe("/en/physicians/ali-veli?from=matcher#randevu");
  });
});

describe("sihirbaz akışı", () => {
  async function chooseReflux(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByTestId("matcher-search"), "mide yan");
    await user.click(screen.getByRole("option", { name: /Reflü \/ mide yanması/ }));
  }

  it("kırmızı bayrak seçilince tam ekran acil uyarısı; ülkeye göre numara (ABD → 911); 'Acil değil, devam et' kayda geçer", async () => {
    tzState.timeZone = "America/New_York";
    const user = userEvent.setup();
    render(<PhysicianMatcher mode="page" />);
    await user.type(await screen.findByTestId("matcher-search"), "nefes");
    await user.click(screen.getByRole("option", { name: /Göğüs ağrısı ve nefes darlığı/ }));
    const screenEl = await screen.findByTestId("matcher-red-flag");
    expect(within(screenEl).getByRole("heading")).toHaveTextContent("Bu belirtiler acil olabilir");
    expect(within(screenEl).getByText(/Türkiye 112, AB 112, ABD 911, BK 999/)).toBeInTheDocument();
    expect(screen.getByTestId("matcher-emergency-number")).toHaveAttribute("href", "tel:911");
    expect(api.progress).toHaveBeenCalledWith("red_flag");
    expect(screenEl.parentElement).toBe(document.body);
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("matcher-red-flag")).toBeInTheDocument();
    await user.click(screen.getByTestId("matcher-red-flag-continue"));
    expect(screen.queryByTestId("matcher-red-flag")).not.toBeInTheDocument();
    expect(api.progress).toHaveBeenCalledWith("red_flag_continue");
  });

  it("serbest metinde kırmızı bayrak: devam edince acil ekranı (TR → 112)", async () => {
    const user = userEvent.setup();
    render(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByRole("button", { name: "Listede yok, kendim yazayım" }));
    await user.type(screen.getByTestId("matcher-free-text"), "babam nefes alamıyorum diyor");
    await user.click(screen.getByTestId("matcher-continue"));
    expect(await screen.findByTestId("matcher-red-flag")).toBeInTheDocument();
    expect(screen.getByTestId("matcher-emergency-number")).toHaveAttribute("href", "tel:112");
  });

  it("tam akış (iletişim opsiyonel): sonuç kartı, tercüman rozeti, randevu bağlantısı, 'tanı değildir' notu; URL'de ve CRM olaylarında kişisel veri yok", async () => {
    const track = vi.fn();
    (window as unknown as { WMCRM: unknown }).WMCRM = { track };
    const user = userEvent.setup();
    const { rerender } = render(<PhysicianMatcher mode="page" />);
    await chooseReflux(user);
    await user.click(screen.getByRole("button", { name: "Listede yok, kendim yazayım" }));
    await user.type(screen.getByTestId("matcher-free-text"), "Ayşe Yılmaz, yemekten sonra yanma");
    await user.click(screen.getByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByLabelText("Kendim"));
    await user.click(screen.getByLabelText("1–6 ay"));
    await user.click(screen.getByLabelText("Hayır"));
    await user.click(screen.getByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByLabelText("Online görüşme"));
    await user.click(screen.getByTestId("matcher-continue"));
    await waitFor(() => expect(nav.params.get("step")).toBe("5"));
    rerender(<PhysicianMatcher mode="page" />);

    const card = await screen.findByTestId("matcher-doctor-card");
    expect(card).toHaveTextContent("Prof. Dr. A. Veli");
    expect(within(card).getByTestId("matcher-interpreter-badge")).toHaveTextContent("Ücretsiz tercüman desteği");
    expect(within(card).getByTestId("matcher-book")).toHaveAttribute("href", "/tr/physicians/ali-veli?specialty=gastroenterology&from=matcher#randevu");
    expect(within(card).getByTestId("matcher-book").getAttribute("href")).not.toMatch(/topic|reflux|mide/);
    expect(within(card).getByTestId("matcher-book")).toHaveTextContent("A. Veli ile randevu al");
    expect(screen.getByTestId("matcher-disclaimer")).toHaveTextContent("Bu araç tanı koymaz ve tıbbi tavsiye vermez.");
    expect(screen.getByRole("link", { name: "WhatsApp’tan yazın" })).toHaveAttribute("href", "https://wa.me/905551112233");
    expect(api.recommend).toHaveBeenCalledWith({ topicIds: ["t1"], preferredLanguage: "tr", locale: "tr", preference: "online" });

    // URL'de yalnızca adım; CRM olaylarında kişisel veri/şikayet yok.
    for (const [url] of nav.push.mock.calls) expect(url).toMatch(/^\/tr\/find-a-physician\?step=[1-5]$/);
    const tracked = JSON.stringify(track.mock.calls);
    expect(tracked).not.toMatch(/Ayşe|yanma|reflux|mide/i);
    expect(track.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["matcher_start", "matcher_step", "matcher_result"]));
  });

  it("tercüman rozeti ayara bağlı (interpreterIncluded=false → yok); eşleşme yoksa koordinatör yolu", async () => {
    api.rec = { ...REC, interpreterIncluded: false };
    nav.params = new URLSearchParams("step=1");
    const user = userEvent.setup();
    const { rerender } = render(<PhysicianMatcher mode="page" />);
    await chooseReflux(user);
    await user.click(screen.getByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByLabelText("1–6 ay"));
    await user.click(screen.getByLabelText("Hayır"));
    await user.click(screen.getByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByLabelText("Farketmez"));
    await user.click(screen.getByTestId("matcher-continue"));
    await waitFor(() => expect(nav.params.get("step")).toBe("5"));
    rerender(<PhysicianMatcher mode="page" />);
    await screen.findByTestId("matcher-doctor-card");
    expect(screen.queryByTestId("matcher-interpreter-badge")).not.toBeInTheDocument();

    api.rec = { ...REC, coordinator: true, specialties: [], doctors: [] };
    await user.click(screen.getByRole("button", { name: "Cevapları değiştir" }));
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByTestId("matcher-continue"));
    await waitFor(() => expect(nav.params.get("step")).toBe("5"));
    rerender(<PhysicianMatcher mode="page" />);
    expect(await screen.findByTestId("matcher-no-match")).toHaveTextContent("koordinatörümüz size en uygun hekimi 1 iş günü içinde bildirsin");
  });

  it("iletişim zorunlu: 18 yaş altı veli alanı; iki onay kutusu varsayılan işaretsiz; gönderimde sağlık rızası olduğu gibi iletilir", async () => {
    api.catalog = { contactRequired: true, topics: TOPICS };
    const user = userEvent.setup();
    const { rerender } = render(<PhysicianMatcher mode="page" />);
    await chooseReflux(user);
    await user.click(screen.getByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByLabelText("1–6 ay"));
    await user.click(screen.getByLabelText("Hayır"));
    await user.click(screen.getByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByLabelText("Online görüşme"));
    await user.click(screen.getByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);

    expect(await screen.findByTestId("matcher-consent-health")).not.toBeChecked();
    expect(screen.getByTestId("matcher-consent-contact")).not.toBeChecked();
    expect(screen.getByTestId("matcher-no-contact-note")).toHaveTextContent("Bu izni vermezseniz adınızı, telefonunuzu, e-postanızı ve sağlık bilgilerinizi kaydetmeyiz");
    await user.type(screen.getByLabelText("Ad soyad"), "Deniz Kaya");
    await user.type(screen.getByTestId("matcher-age"), "15");
    expect(screen.getByText("Hasta 18 yaşından küçük. Lütfen formu veli ya da vasi olarak doldurun.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("E-posta"), "veli@example.com");
    // İletişim izni verilince veli adı zorunlu.
    await user.click(screen.getByTestId("matcher-consent-contact"));
    await user.click(screen.getByTestId("matcher-continue"));
    expect(api.submit).not.toHaveBeenCalled();
    // İzin geri alınırsa: ad/e-posta/konu/sağlık bilgisi GÖNDERİLMEZ (yalnızca anonim sayaç).
    await user.click(screen.getByTestId("matcher-consent-contact"));
    await user.click(screen.getByTestId("matcher-continue"));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    const sent = api.submit.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ consentContact: false, consentHealth: false, topicIds: [] });
    for (const key of ["name", "email", "phoneNumber", "age", "guardianName", "freeText"]) expect(sent).not.toHaveProperty(key);
    for (const [url] of nav.push.mock.calls) expect(url).not.toMatch(/Deniz|veli@|Kaya/);
  });

  it("arama klavyeyle kullanılır (ok tuşları + Enter), aydınlatma metni bağlantısı 1. adımda", async () => {
    const user = userEvent.setup();
    render(<PhysicianMatcher mode="page" />);
    const input = await screen.findByTestId("matcher-search");
    expect(screen.getByTestId("matcher-privacy-note")).toHaveTextContent("Sağlık bilgileriniz ancak açık rızanızla kaydedilir.");
    await waitFor(() => expect(screen.getByRole("link", { name: "Aydınlatma metni" })).toHaveAttribute("href", "/tr/kvkk-aydinlatma-metni"));
    await user.type(input, "boyun");
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "matcher-option-0");
    await user.keyboard("{Enter}");
    expect(within(screen.getByTestId("matcher-selected")).getByRole("button", { name: /Boyun ağrısı/ })).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("18 yaş altında rıza metni veli/vasi beyanı; geri dönülüp tekrar gönderilince talep TEKRAR gönderilmez", async () => {
    api.catalog = { contactRequired: true, topics: TOPICS };
    const user = userEvent.setup();
    const { rerender } = render(<PhysicianMatcher mode="page" />);
    await chooseReflux(user);
    await user.click(screen.getByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByLabelText("1–6 ay"));
    await user.click(screen.getByLabelText("Hayır"));
    await user.click(screen.getByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByLabelText("Online görüşme"));
    await user.click(screen.getByTestId("matcher-continue"));
    rerender(<PhysicianMatcher mode="page" />);
    await user.type(await screen.findByLabelText("Ad soyad"), "Deniz Kaya");
    await user.type(screen.getByTestId("matcher-age"), "12");
    expect(screen.getByText(/Hastanın velisi ya da vasisi olduğumu beyan eder/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Veli/vasinin adı soyadı"), "Ahmet Kaya");
    await user.type(screen.getByLabelText("E-posta"), "veli@example.com");
    await user.click(screen.getByTestId("matcher-consent-contact"));
    await user.click(screen.getByTestId("matcher-continue"));
    await waitFor(() => expect(nav.params.get("step")).toBe("5"));
    rerender(<PhysicianMatcher mode="page" />);
    await screen.findByTestId("matcher-result");
    expect(api.submit.mock.calls[0]![0]).toMatchObject({ name: "Deniz Kaya", age: 12, guardianName: "Ahmet Kaya", email: "veli@example.com", consentContact: true });
    nav.params = new URLSearchParams("step=4");
    rerender(<PhysicianMatcher mode="page" />);
    await user.click(await screen.findByTestId("matcher-continue"));
    await waitFor(() => expect(nav.params.get("step")).toBe("5"));
    expect(api.submit).toHaveBeenCalledTimes(1);
  });
});
