import { describe, expect, it } from "vitest";
import { localizedDoctorTitle } from "@/components/site/telehealth/room/doctor-title";

/** Paket AF (kullanıcı kararı) — doktor unvanı izleyicinin dilinde; yoksa mevcut unvan. */
describe("localizedDoctorTitle", () => {
  const doctor = { title: "Doç. Dr.", titleTranslations: { en: "Assoc. Prof. Dr.", sr: "Vanr. prof. dr", de: "  " } };

  it("izleyicinin dilindeki çeviri", () => {
    expect(localizedDoctorTitle(doctor, "en")).toBe("Assoc. Prof. Dr.");
    expect(localizedDoctorTitle(doctor, "EN")).toBe("Assoc. Prof. Dr.");
  });
  it("tam kod yoksa ana dil (sr-latn → sr)", () => {
    expect(localizedDoctorTitle(doctor, "sr-latn")).toBe("Vanr. prof. dr");
  });
  it("çeviri yoksa ya da boşsa mevcut unvan", () => {
    expect(localizedDoctorTitle(doctor, "fr")).toBe("Doç. Dr.");
    expect(localizedDoctorTitle(doctor, "de")).toBe("Doç. Dr.");
    expect(localizedDoctorTitle({ title: "Dr." }, "ar")).toBe("Dr.");
    expect(localizedDoctorTitle(null, "tr")).toBe("");
  });
});
