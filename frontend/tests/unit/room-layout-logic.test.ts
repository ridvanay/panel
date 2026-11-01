import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assignRoles, gridColumnsClass, oppositeCorner, thumbShiftPx, type StageTileInfo } from "@/components/site/telehealth/room/stage-layout";
import { cycleSize, nearestCorner, pinchStep, stepSize } from "@/components/site/telehealth/room/pip-geometry";
import { DEFAULT_PREFS, PREFS_STORAGE_KEY, buildCaptureOptions, loadPrefs, savePrefs, supportsSetSinkId } from "@/components/site/telehealth/room/device-prefs";
import { readFacing } from "@/components/site/telehealth/room/camera-facing";
import { resolveExpectedCounterpartName, type LabelContext } from "@/components/site/telehealth/room/participant-label";
import { consultationStrings as tr } from "@/lib/i18n/site-dictionaries/tr/consultation";

/** Paket AF (Aşama 2) — yerleşim/PiP/tercih saf mantığı. */
const tiles = (...kinds: StageTileInfo["kind"][]): StageTileInfo[] => kinds.map((kind) => ({ key: kind, kind }));
const rolesOf = (map: ReturnType<typeof assignRoles>) => Object.fromEntries([...map].map(([key, v]) => [key, v.role]));

describe("assignRoles", () => {
  it("konuşmacı görünümü: karşı taraf büyük, kendi görüntüsü PiP", () => {
    expect(rolesOf(assignRoles({ layout: "speaker", swapped: false, tiles: tiles("counterpart", "local"), speakerKind: "counterpart" }))).toEqual({ counterpart: "main", local: "pip" });
  });

  it("yer değiştirme: kendi görüntüsü büyük, karşı taraf PiP", () => {
    expect(rolesOf(assignRoles({ layout: "speaker", swapped: true, tiles: tiles("counterpart", "local"), speakerKind: "counterpart" }))).toEqual({ counterpart: "pip", local: "main" });
  });

  it("karşı taraf yokken kendi görüntüsü büyük; yalnızca tercüman varsa o küçük kutuda kalır", () => {
    expect(rolesOf(assignRoles({ layout: "speaker", swapped: false, tiles: tiles("local"), speakerKind: "counterpart" }))).toEqual({ local: "main" });
    expect(rolesOf(assignRoles({ layout: "speaker", swapped: false, tiles: tiles("interpreter", "local"), speakerKind: "counterpart" }))).toEqual({ local: "main", interpreter: "thumb" });
  });

  it("tercümanla 3 kişi: konuşan büyük, diğeri küçük yan kutu; ekran paylaşımı her zaman odak", () => {
    const three = tiles("counterpart", "interpreter", "local");
    expect(rolesOf(assignRoles({ layout: "speaker", swapped: false, tiles: three, speakerKind: "interpreter" }))).toEqual({ interpreter: "main", counterpart: "thumb", local: "pip" });
    const withScreen = tiles("screen", "counterpart", "interpreter", "local");
    const roles = assignRoles({ layout: "speaker", swapped: false, tiles: withScreen, speakerKind: "interpreter" });
    expect(roles.get("screen")!.role).toBe("main");
    expect([roles.get("counterpart")!.thumbIndex, roles.get("interpreter")!.thumbIndex].sort()).toEqual([0, 1]);
  });

  it("ızgara: herkes eşit (3 katılımcıda 3 kutu)", () => {
    const roles = assignRoles({ layout: "grid", swapped: true, tiles: tiles("counterpart", "interpreter", "local"), speakerKind: "counterpart" });
    expect(Object.values(rolesOf(roles))).toEqual(["grid", "grid", "grid"]);
    expect(gridColumnsClass(3)).toContain("sm:grid-cols-3");
    expect(gridColumnsClass(2)).toContain("sm:grid-cols-2");
    expect(gridColumnsClass(1)).toBe("grid-cols-1");
  });

  it("köşe yardımcıları mantıksal", () => {
    expect(oppositeCorner("bottom-end")).toBe("bottom-start");
    expect(oppositeCorner("top-start")).toBe("top-end");
    expect(thumbShiftPx("top-end", 1)).toBeGreaterThan(0);
    expect(thumbShiftPx("bottom-end", 1)).toBeLessThan(0);
  });
});

describe("PiP geometrisi", () => {
  const stage = { left: 0, top: 0, width: 1000, height: 600 };
  it("en yakın köşe; RTL'de start/end yer değiştirir", () => {
    expect(nearestCorner({ x: 100, y: 100 }, stage, "ltr")).toBe("top-start");
    expect(nearestCorner({ x: 900, y: 500 }, stage, "ltr")).toBe("bottom-end");
    expect(nearestCorner({ x: 100, y: 500 }, stage, "ltr")).toBe("bottom-start");
    expect(nearestCorner({ x: 100, y: 100 }, stage, "rtl")).toBe("top-end");
    expect(nearestCorner({ x: 900, y: 500 }, stage, "rtl")).toBe("bottom-start");
  });

  it("boyut basamakları sınırda durur; döngü küçük → orta → büyük → küçük; pinch eşikleri", () => {
    expect(stepSize("large", 1)).toBe("large");
    expect(stepSize("small", -1)).toBe("small");
    expect(stepSize("small", 1)).toBe("medium");
    expect(cycleSize("large")).toBe("small");
    expect(pinchStep(100, 140)).toBe(1);
    expect(pinchStep(100, 70)).toBe(-1);
    expect(pinchStep(100, 110)).toBe(0);
    expect(pinchStep(0, 50)).toBe(0);
  });
});

describe("tercihler (localStorage)", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("varsayılanlar: ses işleme AÇIK; kayıt yokken yakalama seçenekleri aynen true", () => {
    expect(loadPrefs()).toMatchObject({ noiseSuppression: true, echoCancellation: true, autoGainControl: true, layout: "speaker" });
    expect(buildCaptureOptions(loadPrefs())).toEqual({ video: true, audio: true });
  });

  it("kaydet/oku turu; bozuk JSON ve geçersiz değerler varsayılana düşer", () => {
    savePrefs({ videoinput: "cam", noiseSuppression: false, pipCorner: "top-end" });
    expect(loadPrefs()).toMatchObject({ videoinput: "cam", noiseSuppression: false, pipCorner: "top-end" });
    window.localStorage.setItem(PREFS_STORAGE_KEY, "{bozuk");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ layout: "x", pipSize: 5, pipCorner: "orta", noiseSuppression: "evet" }));
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("depolama hata verirse okuma varsayılan, yazma sessiz; birleşik değer yine döner", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs({ layout: "grid" })).not.toThrow();
    expect(savePrefs({ layout: "grid" }).layout).toBe("grid");
  });

  it("yakalama seçenekleri: cihaz kimliği ve ses kısıtları yalnızca varsayılandan farklıysa eklenir", () => {
    expect(buildCaptureOptions({ ...DEFAULT_PREFS, videoinput: "cam-2" })).toEqual({ video: { deviceId: "cam-2" }, audio: true });
    expect(buildCaptureOptions({ ...DEFAULT_PREFS, autoGainControl: false })).toEqual({
      video: true,
      audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: false },
    });
    expect(buildCaptureOptions({ ...DEFAULT_PREFS, audioinput: "mic-2" }).audio).toEqual({ deviceId: "mic-2", noiseSuppression: true, echoCancellation: true, autoGainControl: true });
  });

  it("supportsSetSinkId özellik denetimidir", () => {
    expect(supportsSetSinkId()).toBe(false);
    (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId = () => {};
    expect(supportsSetSinkId()).toBe(true);
    delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
  });
});

describe("kamera yönü", () => {
  const track = (settings: MediaTrackSettings, label = "") => ({ mediaStreamTrack: { label, getSettings: () => settings } });
  it("facingMode ayarı, yoksa etiket, yoksa 'user'", () => {
    expect(readFacing(track({ facingMode: "environment" }))).toBe("environment");
    expect(readFacing(track({ facingMode: "user" }, "back camera"))).toBe("user");
    expect(readFacing(track({}, "Back Camera"))).toBe("environment");
    expect(readFacing(track({}, "Integrated Webcam"))).toBe("user");
    expect(readFacing(undefined)).toBe("user");
  });
});

describe("bekleme odası adı", () => {
  const base = { t: tr, fmt: (s: string) => s } as unknown as Pick<LabelContext, "t" | "fmt">;
  it("doktor ekranında hasta, hasta ekranında doktor; ad yoksa rol adı", () => {
    expect(resolveExpectedCounterpartName({ ...base, viewer: "doctor", patientName: "Zeynep Kaya" } as LabelContext)).toBe("Zeynep Kaya");
    expect(resolveExpectedCounterpartName({ ...base, viewer: "doctor" } as LabelContext)).toBe(tr.rolePatient);
    expect(resolveExpectedCounterpartName({ ...base, viewer: "patient", doctorName: "Prof. Dr. D. Yıldırım" } as LabelContext)).toBe("Prof. Dr. D. Yıldırım");
    expect(resolveExpectedCounterpartName({ ...base, viewer: "patient" } as LabelContext)).toBe(tr.roleDoctor);
  });
});
