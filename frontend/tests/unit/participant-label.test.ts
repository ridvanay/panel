import { describe, expect, it } from "vitest";
import { participantRole, resolveParticipantLabel, resolveScreenShareLabel, type LabelContext } from "@/components/site/telehealth/room/participant-label";
import { CONSULTATION_DICTIONARIES, fmt } from "@/lib/i18n/use-consultation-strings";
import { qualityBars } from "@/components/site/telehealth/room/participant-tile";

/**
 * Paket AF (İş 1) — video kutusu ad etiketi (saf yardımcı). Rol identity önekinden; ad izleyicinin rolüne göre;
 * hasta adı yalnızca randevu verisinden (token'da yok), tercümanda maskeli; identity HİÇBİR koşulda etiket olmaz.
 */
const tr = CONSULTATION_DICTIONARIES.tr!;
const en = CONSULTATION_DICTIONARIES.en!;
const languageName = (code: string) => ({ ar: "العربية", ru: "русский" })[code] ?? code.toUpperCase();

function ctx(over: Partial<LabelContext> = {}): LabelContext {
  return { viewer: "patient", patientName: "Zeynep Kaya", doctorName: "Prof. Dr. D. Yıldırım", t: tr, fmt, languageName, ...over };
}

const doctor = { identity: "doctor:77bd0977-1111-2222" };
const patient = { identity: "patient:appointment-1" };
const interpreter = {
  identity: "interpreter:p1:b1",
  name: "A. Yılmaz · Interpreter (العربية)",
  metadata: JSON.stringify({ role: "interpreter", language: "ar" }),
};

describe("participantRole", () => {
  it("rol identity önekinden / metadata'dan", () => {
    expect(participantRole(doctor)).toBe("doctor");
    expect(participantRole(patient)).toBe("patient");
    expect(participantRole(interpreter)).toBe("interpreter");
    expect(participantRole({ identity: "x", metadata: '{"role":"interpreter"}' })).toBe("interpreter");
    expect(participantRole({ identity: "qa-listener-u1" })).toBe("listener");
    expect(participantRole({ identity: "x", metadata: '{"role":"qa_listener"}' })).toBe("listener");
    expect(participantRole({ identity: "bilinmeyen" })).toBe("unknown");
  });
});

describe("resolveParticipantLabel", () => {
  it("hasta ve doktor ekranında hasta TAM adı; doktor unvan + görünen ad (randevu verisi)", () => {
    for (const viewer of ["patient", "doctor"] as const) {
      expect(resolveParticipantLabel(patient, ctx({ viewer }))).toBe("Zeynep Kaya");
      expect(resolveParticipantLabel(doctor, ctx({ viewer }))).toBe("Prof. Dr. D. Yıldırım");
    }
  });

  it("tercüman ekranında hasta YALNIZCA baş harfler; tam ad ctx'te olsa bile kullanılmaz", () => {
    const label = resolveParticipantLabel(patient, ctx({ viewer: "interpreter", patientInitial: "Z. K." }));
    expect(label).toBe("Z. K.");
    expect(label).not.toContain("Zeynep");
    // Baş harf verisi yoksa tam ada DÜŞMEZ; rol adı.
    expect(resolveParticipantLabel(patient, ctx({ viewer: "interpreter", patientInitial: null }))).toBe("Hasta");
  });

  it("tercüman: '<ad> · Tercüman (<dilin kendi adı>)' — rol sözcüğü izleyicinin dilinde", () => {
    expect(resolveParticipantLabel(interpreter, ctx())).toBe("A. Yılmaz · Tercüman (العربية)");
    expect(resolveParticipantLabel(interpreter, ctx({ t: en }))).toBe("A. Yılmaz · Interpreter (العربية)");
    expect(resolveParticipantLabel(interpreter, ctx({ t: CONSULTATION_DICTIONARIES.de! }))).toBe("A. Yılmaz · Dolmetscher (العربية)");
    expect(resolveParticipantLabel(interpreter, ctx({ t: CONSULTATION_DICTIONARIES.ar! }))).toContain("مترجم");
  });

  it("tercüman adı yoksa 'Tercüman · <dil>'; dil de yoksa yalnızca rol adı", () => {
    const bare = { identity: "interpreter:p1:b1", metadata: '{"role":"interpreter","language":"ar"}' };
    expect(resolveParticipantLabel(bare, ctx())).toBe("Tercüman · العربية");
    expect(resolveParticipantLabel({ identity: "interpreter:p1:b1" }, ctx())).toBe("Tercüman");
  });

  it("ad bulunamazsa izleyicinin dilinde rol adı; identity ASLA etiket olmaz (name=identity dahil)", () => {
    const empty = ctx({ patientName: null, doctorName: null });
    expect(resolveParticipantLabel(patient, empty)).toBe("Hasta");
    expect(resolveParticipantLabel(doctor, empty)).toBe("Doktor");
    expect(resolveParticipantLabel(patient, { ...empty, t: en })).toBe("Patient");
    expect(resolveParticipantLabel(doctor, { ...empty, t: en })).toBe("Doctor");
    // SDK'nın boş ad yerine identity geçirdiği durum.
    expect(resolveParticipantLabel({ ...doctor, name: doctor.identity }, empty)).toBe("Doktor");
    expect(resolveParticipantLabel({ ...doctor, name: "doctor:abc" }, empty)).toBe("Doktor");
    for (const p of [patient, doctor, interpreter]) {
      const out = resolveParticipantLabel(p, empty) ?? "";
      expect(out).not.toMatch(/doctor:|patient:|interpreter:|77bd0977/);
    }
  });

  it("doktor adı: randevu verisi yoksa token name, o da yoksa atamadaki ad (tercüman ekranı), sonra rol", () => {
    const base = ctx({ doctorName: null });
    expect(resolveParticipantLabel({ ...doctor, name: "Dr. Token" }, base)).toBe("Dr. Token");
    expect(resolveParticipantLabel(doctor, { ...base, doctorFallbackName: "H. Sofu" })).toBe("H. Sofu");
    expect(resolveParticipantLabel({ ...doctor, name: "Dr. Token" }, { ...base, doctorFallbackName: "H. Sofu" })).toBe("Dr. Token");
  });

  it("dinleyici için etiket yok (video kutusu çizilmez)", () => {
    expect(resolveParticipantLabel({ identity: "qa-listener-u1", name: "WM Health – Kalite Kontrol" }, ctx())).toBeNull();
  });

  it("ekran paylaşımı etiketi", () => {
    expect(resolveScreenShareLabel(doctor, ctx())).toBe("Prof. Dr. D. Yıldırım – ekran");
  });
});

describe("bağlantı kalitesi çubukları", () => {
  it("3 çubuk: excellent=3, good=2, poor=1, lost/unknown=0", () => {
    expect([qualityBars("excellent"), qualityBars("good"), qualityBars("poor"), qualityBars("lost"), qualityBars("unknown")]).toEqual([3, 2, 1, 0, 0]);
  });
});
