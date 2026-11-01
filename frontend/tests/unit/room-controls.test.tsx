import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsultationRoom } from "@/components/site/telehealth/consultation-room";
import { PREFS_STORAGE_KEY } from "@/components/site/telehealth/room/device-prefs";
import { EndingSoonNotice, SessionTimer, formatElapsed } from "@/components/site/telehealth/room/session-timer";
import { doctor, harness, installMediaDevices, installPointerEvent, local, makeLocalTrack, removeMediaDevices } from "./helpers/room-harness";

/**
 * Paket AF (Aşama 2) — kontrol çubuğu (kısayollar, tooltip/aria, 44 px, soluklaşma), ayarlar paneli (cihaz seçimi, ses
 * anahtarları, setSinkId yokluğu, localStorage hatası), görüşme süresi sayacı ve randevu bitişi uyarısı.
 */
vi.mock("@livekit/components-styles", () => ({}));
vi.mock("@livekit/components-react", async () => (await import("./helpers/room-harness")).componentsReactMock);
vi.mock("livekit-client", async () => (await import("./helpers/room-harness")).livekitClientMock);
vi.mock("@/lib/api/telehealth", async () => {
  const h = await import("./helpers/room-harness");
  return {
    getAppointment: vi.fn(async () => ({ ...h.makeAppointment(), ...h.harness.appointmentOverride })),
    requestMeetingToken: (...args: unknown[]) => h.harness.requestMeetingToken(...args),
    getRecordingStatus: vi.fn(async () => null),
  };
});
vi.mock("@/lib/api/interpreter", () => ({
  removeAppointmentInterpreter: vi.fn(async () => undefined),
  getAppointmentInterpreter: vi.fn(async () => null),
}));
vi.mock("@/lib/api/modules", () => ({ listPublicModules: vi.fn(async () => []) }));
vi.mock("@/context/auth-context", async () => {
  const h = await import("./helpers/room-harness");
  return { useAuthOptional: () => ({ status: "authenticated", user: { doctorProfileId: h.harness.doctorSession ? "doctor-1" : null } }) };
});
vi.mock("@/context/locale-alternates-context", async () => {
  const h = await import("./helpers/room-harness");
  return { useActiveLocaleCode: () => h.harness.localeCode, useLocalizePath: () => (path: string) => path };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const cam = (participant: typeof local) => ({ participant, source: "camera" });

async function joinRoom() {
  render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
  const user = userEvent.setup({ delay: null });
  await user.click(await screen.findByRole("button", { name: harness.localeCode === "ar" ? "الانضمام إلى الاستشارة" : "Görüşmeye Katıl" }));
  await screen.findByTestId("lk-room");
  return user;
}

const toolbar = () => screen.getByRole("toolbar");
const savedPrefs = () => JSON.parse(window.localStorage.getItem(PREFS_STORAGE_KEY) ?? "{}") as Record<string, unknown>;

beforeAll(() => installPointerEvent());

beforeEach(() => {
  harness.reset();
  harness.participants = [local, doctor];
  harness.tracks = [cam(doctor), cam(local)];
  window.localStorage.clear();
  removeMediaDevices();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
  delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
  vi.restoreAllMocks();
  cleanup();
});

describe("kontrol çubuğu", () => {
  it("M mikrofonu, V kamerayı açıp kapatır; Ctrl/Alt ile ve metin alanındayken çalışmaz", async () => {
    await joinRoom();
    fireEvent.keyDown(window, { key: "m", code: "KeyM" });
    expect(harness.toggles.microphone!.toggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "V", code: "KeyV" });
    expect(harness.toggles.camera!.toggle).toHaveBeenCalledTimes(1);

    // Arapça/Kiril düzeninde `key` Latin olmasa da fiziksel tuş (`code`) yakalanır.
    fireEvent.keyDown(window, { key: "ь", code: "KeyM" });
    expect(harness.toggles.microphone!.toggle).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "m", code: "KeyM", ctrlKey: true });
    fireEvent.keyDown(window, { key: "m", code: "KeyM", altKey: true });
    expect(harness.toggles.microphone!.toggle).toHaveBeenCalledTimes(2);

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "m", code: "KeyM" });
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    fireEvent.keyDown(textarea, { key: "v", code: "KeyV" });
    expect(harness.toggles.microphone!.toggle).toHaveBeenCalledTimes(2);
    expect(harness.toggles.camera!.toggle).toHaveBeenCalledTimes(1);
  });

  it("her düğmede aria-label + tooltip (kısayolla); kısayol aria-keyshortcuts'ta; araç çubuğunun adı çevrilmiş", async () => {
    (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen = vi.fn();
    await joinRoom();
    expect(toolbar()).toHaveAccessibleName("Görüşme kontrolleri");
    const mic = screen.getByRole("button", { name: "Mikrofonu kapat" });
    expect(mic).toHaveAttribute("aria-keyshortcuts", "M");
    const tip = screen.getByText("Mikrofonu kapat (M)");
    expect(tip).toHaveAttribute("role", "tooltip");
    expect(mic).toHaveAttribute("aria-describedby", tip.id);
    expect(screen.getByText("Kamerayı kapat (V)")).toHaveAttribute("role", "tooltip");
    for (const name of ["Ekranı paylaş", "Ayarlar", "Izgara görünümüne geç", "Tam Ekran", "Görüşmeyi sonlandır"]) {
      // Tarayıcı özellik tespiti ilk render'dan sonra (effect) işaretlenir → asenkron sorgu.
      expect(await within(toolbar()).findByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("bütün düğmeler en az 44 px (h-11/w-11 ve üstü); görüşmeden ayrıl kırmızı ve onay akışı korunur", async () => {
    const user = await joinRoom();
    const buttons = within(toolbar()).getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    for (const button of buttons) {
      expect(button.className, button.getAttribute("aria-label") ?? "").toMatch(/\bh-(11|12)\b/);
      expect(button.className).toMatch(/\bw-(11|12)\b/);
    }
    const end = screen.getByRole("button", { name: "Görüşmeyi sonlandır" });
    expect(end.className).toContain("bg-danger");
    await user.click(end);
    expect(await screen.findByText("Görüşmeyi sonlandırmak istediğinize emin misiniz?")).toBeInTheDocument();
    expect(harness.room.disconnect).not.toHaveBeenCalled();
  });

  it("ekran paylaşımı mevcut davranışla çalışır (hasta da paylaşabilir)", async () => {
    const user = await joinRoom();
    await user.click(screen.getByRole("button", { name: "Ekranı paylaş" }));
    expect(harness.toggles.screen_share!.toggle).toHaveBeenCalledTimes(1);
  });

  it("3 sn hareketsizlikte soluklaşır; fare/dokunma/klavye ile geri gelir", async () => {
    await joinRoom();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const bar = toolbar();
    act(() => {
      fireEvent.pointerMove(document.body);
    });
    expect(bar).toHaveAttribute("data-faded", "false");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(bar).toHaveAttribute("data-faded", "false");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(bar).toHaveAttribute("data-faded", "true");

    for (const wake of [() => fireEvent.pointerMove(document.body), () => fireEvent.touchStart(document.body), () => fireEvent.keyDown(document.body, { key: "Shift" })]) {
      act(() => {
        wake();
      });
      expect(bar).toHaveAttribute("data-faded", "false");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(bar).toHaveAttribute("data-faded", "true");
    }
  });

  it("klavye odağı çubuğun içindeyken soluklaşmaz", async () => {
    await joinRoom();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      fireEvent.pointerMove(document.body);
    });
    act(() => {
      fireEvent.keyDown(document.body, { key: "Tab" });
      screen.getByTestId("bar-mic").focus();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(toolbar()).toHaveAttribute("data-faded", "false");

    // Odak çubuktan çıkınca yine soluklaşır.
    act(() => {
      screen.getByTestId("bar-mic").blur();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(toolbar()).toHaveAttribute("data-faded", "true");
  });

  it("fareyle tıklanan düğmenin odağı çubuğu görünür TUTMAZ (yalnızca klavye odağı tutar)", async () => {
    await joinRoom();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      fireEvent.pointerDown(screen.getByTestId("bar-mic"));
      screen.getByTestId("bar-mic").focus();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(toolbar()).toHaveAttribute("data-faded", "true");
  });

  it("Arapça: araç çubuğu ve düğme adları çevrilmiş", async () => {
    harness.localeCode = "ar";
    await joinRoom();
    expect(toolbar()).toHaveAccessibleName("عناصر التحكم في الاستشارة");
    expect(within(toolbar()).getByRole("button", { name: "الإعدادات" })).toBeInTheDocument();
  });
});

describe("ayarlar paneli", () => {
  const devices = [
    { kind: "videoinput", deviceId: "cam-front", label: "Front camera" },
    { kind: "videoinput", deviceId: "cam-back", label: "Back camera" },
    { kind: "audioinput", deviceId: "mic-1", label: "Mic 1" },
    { kind: "audioinput", deviceId: "mic-2", label: "Mic 2" },
    { kind: "audiooutput", deviceId: "spk-1", label: "Speaker 1" },
    { kind: "audiooutput", deviceId: "spk-2", label: "Speaker 2" },
  ];

  async function openSettings() {
    const user = await joinRoom();
    await user.click(screen.getByRole("button", { name: "Ayarlar" }));
    return { user, panel: await screen.findByRole("dialog", { name: "Cihaz ayarları" }) };
  }

  it("kamera ve mikrofon listelenir; seçim room.switchActiveDevice çağırır ve saklanır; setSinkId yokken hoparlör GİZLİ", async () => {
    installMediaDevices(devices);
    harness.room.activeDevices = { videoinput: "cam-front", audioinput: "mic-1" };
    const { panel } = await openSettings();

    await waitFor(() => expect(within(panel).getByTestId("device-select-videoinput").querySelectorAll("option")).toHaveLength(2));
    expect(within(panel).getByTestId("device-select-audioinput").querySelectorAll("option")).toHaveLength(2);
    expect(within(panel).queryByTestId("device-select-audiooutput")).not.toBeInTheDocument();

    fireEvent.change(within(panel).getByTestId("device-select-videoinput"), { target: { value: "cam-back" } });
    await waitFor(() => expect(harness.room.switchActiveDevice).toHaveBeenCalledWith("videoinput", "cam-back"));
    fireEvent.change(within(panel).getByTestId("device-select-audioinput"), { target: { value: "mic-2" } });
    await waitFor(() => expect(harness.room.switchActiveDevice).toHaveBeenCalledWith("audioinput", "mic-2"));
    await waitFor(() => expect(savedPrefs()).toMatchObject({ videoinput: "cam-back", audioinput: "mic-2" }));
  });

  it("setSinkId destekleniyorsa hoparlör seçimi görünür ve audiooutput için switchActiveDevice çağrılır", async () => {
    (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId = vi.fn();
    installMediaDevices(devices);
    const { panel } = await openSettings();
    await waitFor(() => expect(within(panel).getByTestId("device-select-audiooutput").querySelectorAll("option")).toHaveLength(3));
    fireEvent.change(within(panel).getByTestId("device-select-audiooutput"), { target: { value: "spk-2" } });
    await waitFor(() => expect(harness.room.switchActiveDevice).toHaveBeenCalledWith("audiooutput", "spk-2"));
  });

  it("cihaz değişimi başarısız olursa çevrilmiş hata gösterilir ve seçim eskiye döner", async () => {
    installMediaDevices(devices);
    harness.room.activeDevices = { videoinput: "cam-front" };
    harness.room.switchActiveDevice.mockRejectedValueOnce(new Error("NotReadableError"));
    const { panel } = await openSettings();
    const select = await waitFor(() => {
      const el = within(panel).getByTestId("device-select-videoinput") as HTMLSelectElement;
      expect(el.querySelectorAll("option")).toHaveLength(2);
      return el;
    });
    fireEvent.change(select, { target: { value: "cam-back" } });
    expect(await within(panel).findByTestId("settings-error")).toHaveTextContent("Değişiklik uygulanamadı");
    expect(select.value).toBe("cam-front");
  });

  it("ses anahtarları varsayılan AÇIK; kapatınca mikrofon izi YENİ kısıtlarla restartTrack edilir (yayın kapatılıp açılmaz)", async () => {
    installMediaDevices(devices);
    const mic = makeLocalTrack({ deviceId: "mic-1" });
    harness.room.publications.microphone = { audioTrack: mic };
    harness.room.activeDevices = { audioinput: "mic-1" };
    const { user, panel } = await openSettings();

    for (const name of ["Gürültü bastırma", "Yankı engelleme", "Otomatik kazanç"]) {
      expect(within(panel).getByRole("switch", { name })).toHaveAttribute("aria-checked", "true");
    }
    await user.click(within(panel).getByRole("switch", { name: "Gürültü bastırma" }));
    await waitFor(() => expect(mic.restartTrack).toHaveBeenCalledTimes(1));
    // LiveKit `deviceId` olmadan ses kısıtlarını düşürür → etkin mikrofon kimliği her zaman eklenir.
    expect(mic.restartTrack).toHaveBeenCalledWith({ deviceId: "mic-1", noiseSuppression: false, echoCancellation: true, autoGainControl: true });
    expect(within(panel).getByRole("switch", { name: "Gürültü bastırma" })).toHaveAttribute("aria-checked", "false");

    await user.click(within(panel).getByRole("switch", { name: "Yankı engelleme" }));
    await waitFor(() => expect(mic.restartTrack).toHaveBeenCalledTimes(2));
    expect(mic.restartTrack).toHaveBeenLastCalledWith({ deviceId: "mic-1", noiseSuppression: false, echoCancellation: false, autoGainControl: true });
    expect(savedPrefs()).toMatchObject({ noiseSuppression: false, echoCancellation: false, autoGainControl: true });
    expect(harness.room.disconnect).not.toHaveBeenCalled();
    expect(harness.room.connect).not.toHaveBeenCalled();
  });

  it("localStorage okunamaz/yazılamazsa çökmez; varsayılanlarla çalışır", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    installMediaDevices(devices);
    const mic = makeLocalTrack({ deviceId: "mic-1" });
    harness.room.publications.microphone = { audioTrack: mic };
    const { user, panel } = await openSettings();
    expect(within(panel).getByRole("switch", { name: "Gürültü bastırma" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(panel).getByRole("switch", { name: "Gürültü bastırma" }));
    await waitFor(() => expect(mic.restartTrack).toHaveBeenCalled());
    expect(screen.getByTestId("lk-room")).toBeInTheDocument();
    expect(harness.lkProps.video).toBe(true);
    expect(harness.lkProps.audio).toBe(true);
  });

  it("Escape paneli kapatır ve odak ayarlar düğmesine döner", async () => {
    installMediaDevices(devices);
    const { user, panel } = await openSettings();
    await user.keyboard("{Escape}");
    expect(panel).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ayarlar" })).toHaveFocus();
  });
});

describe("kayıtlı tercihler Room seçeneklerine DEĞİL, yalnızca yakalama seçeneklerine girer", () => {
  it("video/audio prop'u cihaz kimliği ve ses kısıtlarını taşır; options aynen kalır", async () => {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ videoinput: "cam-back", audioinput: "mic-2", noiseSuppression: false }));
    await joinRoom();
    expect(harness.lkProps.video).toEqual({ deviceId: "cam-back" });
    expect(harness.lkProps.audio).toEqual({ deviceId: "mic-2", noiseSuppression: false, echoCancellation: true, autoGainControl: true });
    expect(harness.lkProps.options).toEqual({ adaptiveStream: true, dynacast: true });
    expect(harness.lkProps).not.toHaveProperty("connectOptions");
  });

  it("kayıtlı hoparlör, bağlanınca room.switchActiveDevice('audiooutput') ile uygulanır (setSinkId varsa)", async () => {
    (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId = vi.fn();
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ audiooutput: "spk-2" }));
    await joinRoom();
    await waitFor(() => expect(harness.room.switchActiveDevice).toHaveBeenCalledWith("audiooutput", "spk-2"));
  });
});

describe("görüşme süresi sayacı ve randevu bitişi uyarısı", () => {
  it("odaya bağlanınca sayaç görünür", async () => {
    await joinRoom();
    expect(await screen.findByTestId("session-timer")).toHaveTextContent("00:00");
    expect(screen.getByRole("timer", { name: "Görüşme süresi" })).toBeInTheDocument();
  });

  it("biçim: mm:ss, bir saati geçince h:mm:ss", () => {
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
  });

  it("SessionTimer: ilk Connected'ta başlangıç bildirilir; geçen süre saniyede bir güncellenir (istemci saati)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T09:00:00Z"));
    const onStart = vi.fn();
    const { rerender } = render(<SessionTimer startedAt={null} onStart={onStart} />);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("session-timer")).not.toBeInTheDocument();

    rerender(<SessionTimer startedAt={Date.now()} onStart={onStart} />);
    expect(screen.getByTestId("session-timer")).toHaveTextContent("00:00");
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByTestId("session-timer")).toHaveTextContent("01:05");
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("EndingSoonNotice: bitişe 5 dk kala görünür, kapatılabilir, kapatınca geri gelmez", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T09:20:00Z"));
    render(<EndingSoonNotice endsAt="2026-09-22T09:30:00.000Z" />);
    expect(screen.queryByTestId("ending-soon-notice")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4 * 60_000 + 30_000); // kalan 5:30 → henüz yok
    });
    expect(screen.queryByTestId("ending-soon-notice")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(31_000); // kalan 4:59
    });
    expect(screen.getByTestId("ending-soon-notice")).toHaveTextContent("yaklaşık 5 dakika içinde dolacak");

    fireEvent.click(screen.getByRole("button", { name: "Kapat" }));
    expect(screen.queryByTestId("ending-soon-notice")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByTestId("ending-soon-notice")).not.toBeInTheDocument();
  });

  it("randevu bittikten sonra uyarı gösterilmez", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T09:31:00Z"));
    render(<EndingSoonNotice endsAt="2026-09-22T09:30:00.000Z" />);
    expect(screen.queryByTestId("ending-soon-notice")).not.toBeInTheDocument();
  });

  it("odada: randevu bitişine ≤5 dk varsa bilgi uyarısı çıkar; kapatılır; görüşme kesilmez", async () => {
    harness.appointmentOverride = { endsAt: new Date(Date.now() + 4 * 60_000).toISOString() };
    const user = await joinRoom();
    const notice = await screen.findByTestId("ending-soon-notice");
    expect(notice).toHaveTextContent("Randevu süreniz yaklaşık 4 dakika içinde dolacak. Görüşme otomatik olarak kesilmez.");
    await user.click(within(notice).getByRole("button", { name: "Kapat" }));
    expect(screen.queryByTestId("ending-soon-notice")).not.toBeInTheDocument();
    expect(harness.room.disconnect).not.toHaveBeenCalled();
    expect(screen.getByTestId("lk-room")).toBeInTheDocument();
  });
});
