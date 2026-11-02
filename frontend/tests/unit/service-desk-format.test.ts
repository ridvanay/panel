import { describe, expect, it } from "vitest";
import {
  findHourOverlaps,
  formatMinutesTr,
  isJoinWindowOpen,
  languageName,
  minutesUntilJoinOpens,
  minutesToHHMM,
} from "@/components/admin/service-desk/service-desk-format";
import { consultationToMeeting } from "@/components/admin/service-desk/coordinator-room";
import { defaultDisplayName } from "@/components/admin/service-desk/coordinators-manager";

const START = "2026-11-10T10:00:00.000Z";
const END = "2026-11-10T10:30:00.000Z";
const at = (iso: string) => new Date(iso).getTime();

describe("hizmet masası yardımcıları", () => {
  it("katılım penceresi: başlangıç-15 dk ... bitiş (bitiş hariç)", () => {
    expect(isJoinWindowOpen(START, END, at("2026-11-10T09:44:59.000Z"))).toBe(false);
    expect(isJoinWindowOpen(START, END, at("2026-11-10T09:45:00.000Z"))).toBe(true);
    expect(isJoinWindowOpen(START, END, at("2026-11-10T10:29:59.000Z"))).toBe(true);
    expect(isJoinWindowOpen(START, END, at("2026-11-10T10:30:00.000Z"))).toBe(false);
  });

  it("pencere açılana kalan dakika yukarı yuvarlanır; açıksa 0", () => {
    expect(minutesUntilJoinOpens(START, at("2026-11-10T09:00:00.000Z"))).toBe(45);
    expect(minutesUntilJoinOpens(START, at("2026-11-10T09:44:30.000Z"))).toBe(1);
    expect(minutesUntilJoinOpens(START, at("2026-11-10T09:50:00.000Z"))).toBe(0);
  });

  it("çakışan aralıklar aynı gün için bulunur; bitişik aralıklar çakışma değildir", () => {
    expect(
      findHourOverlaps([
        { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
        { dayOfWeek: 1, startMinute: 700, endMinute: 800 },
        { dayOfWeek: 2, startMinute: 540, endMinute: 720 },
        { dayOfWeek: 2, startMinute: 720, endMinute: 900 },
      ])
    ).toEqual([1]);
    expect(findHourOverlaps([])).toEqual([]);
  });

  it("süre ve dil biçimleri", () => {
    expect(formatMinutesTr(35)).toBe("35 dk");
    expect(formatMinutesTr(60)).toBe("1 sa");
    expect(formatMinutesTr(125)).toBe("2 sa 5 dk");
    expect(minutesToHHMM(545)).toBe("09:05");
    expect(languageName("sr-latn")).toBe("Sırpça");
    expect(languageName("xx")).toBe("xx");
    expect(languageName(null)).toBe("-");
  });

  it("varsayılan görünen ad 'Ad S.' biçimindedir ve unvan içermez", () => {
    expect(defaultDisplayName("Ayşe Yılmaz")).toBe("Ayşe Y.");
    expect(defaultDisplayName("  ece   kaya demir ")).toBe("ece D.");
    expect(defaultDisplayName("Cem")).toBe("Cem");
    expect(defaultDisplayName("")).toBe("");
  });

  it("koordinatör görüşmesi AG Meeting biçimine çevrilir (sabit başlık, faz)", () => {
    const base = { id: "c1", startsAt: START, endsAt: END, status: "SCHEDULED" as const };
    const open = consultationToMeeting(base, at("2026-11-10T09:50:00.000Z"));
    expect(open).toMatchObject({ id: "c1", title: "WM Health online consultation", phase: "open", status: "SCHEDULED", durationMin: 30, note: null });
    expect(consultationToMeeting(base, at("2026-11-10T08:00:00.000Z")).phase).toBe("upcoming");
    expect(consultationToMeeting(base, at("2026-11-10T11:00:00.000Z")).phase).toBe("ended");
    const cancelled = consultationToMeeting({ ...base, status: "CANCELLED" }, at("2026-11-10T09:50:00.000Z"));
    expect(cancelled).toMatchObject({ phase: "cancelled", status: "CANCELLED" });
  });
});
