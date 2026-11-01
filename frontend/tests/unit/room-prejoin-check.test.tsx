import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsultationRoom } from "@/components/site/telehealth/consultation-room";
import { PREFS_STORAGE_KEY } from "@/components/site/telehealth/room/device-prefs";
import { levelFromSamples } from "@/components/site/telehealth/room/prejoin-device-check";
import { buildToneWav } from "@/components/site/telehealth/room/test-tone";
import { harness, installMediaDevices, removeMediaDevices } from "./helpers/room-harness";

/**
 * Paket AF (Aşama 2) — giriş öncesi cihaz testi: kamera önizlemesi, mikrofon seviye çubuğu, hoparlör test sesi, cihaz seçimi,
 * izin reddi mesajı; önizleme izleri katılımdan ÖNCE durdurulur; seçimler katılımda yakalama seçeneği olarak kullanılır.
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
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => ({ status: "authenticated", user: { doctorProfileId: null } }) }));
vi.mock("@/context/locale-alternates-context", async () => {
  const h = await import("./helpers/room-harness");
  return { useActiveLocaleCode: () => h.harness.localeCode, useLocalizePath: () => (path: string) => path };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function fakeStream() {
  const video = { kind: "video", stop: vi.fn() };
  const audio = { kind: "audio", stop: vi.fn() };
  return {
    video,
    audio,
    stream: {
      getTracks: () => [video, audio],
      getAudioTracks: () => [audio],
      getVideoTracks: () => [video],
    } as unknown as MediaStream,
  };
}

const devices = [
  { kind: "videoinput", deviceId: "cam-1", label: "Camera 1" },
  { kind: "videoinput", deviceId: "cam-2", label: "Camera 2" },
  { kind: "audioinput", deviceId: "mic-1", label: "Mic 1" },
  { kind: "audiooutput", deviceId: "spk-1", label: "Speaker 1" },
  { kind: "audiooutput", deviceId: "spk-2", label: "Speaker 2" },
];

async function renderPrejoin() {
  render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
  const user = userEvent.setup({ delay: null });
  const start = await screen.findByTestId("prejoin-test-start");
  return { user, start };
}

beforeEach(() => {
  harness.reset();
  window.localStorage.clear();
  removeMediaDevices();
  HTMLMediaElement.prototype.play = vi.fn(async () => {}) as never;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
  delete (window as { AudioContext?: unknown }).AudioContext;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe("giriş öncesi cihaz testi", () => {
  it("'Görüşmeye Katıl'dan önce test bölümü görünür; izin penceresi kullanıcı isteyene kadar açılmaz", async () => {
    const md = installMediaDevices(devices);
    await renderPrejoin();
    expect(screen.getByTestId("prejoin-device-check")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Görüşmeye Katıl" })).toBeInTheDocument();
    expect(md.getUserMedia).not.toHaveBeenCalled();
  });

  it("test başlayınca kamera önizlemesi ve mikrofon seviye çubuğu görünür; seviye AnalyserNode'dan okunur", async () => {
    const md = installMediaDevices(devices);
    const { stream } = fakeStream();
    md.getUserMedia.mockResolvedValue(stream);
    class FakeAudioContext {
      createAnalyser() {
        return {
          fftSize: 0,
          getByteTimeDomainData: (buf: Uint8Array) => buf.fill(200),
        };
      }
      createMediaStreamSource() {
        return { connect: vi.fn() };
      }
      close = vi.fn(async () => {});
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;

    const { user, start } = await renderPrejoin();
    await user.click(start);

    const preview = await screen.findByTestId("prejoin-preview");
    expect(preview).toHaveAccessibleName("Kamera önizlemesi");
    expect((preview as HTMLVideoElement).srcObject).toBe(stream);
    expect(md.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });

    const meter = await screen.findByRole("meter", { name: "Mikrofon seviyesi" });
    await waitFor(() => expect(Number(meter.getAttribute("aria-valuenow"))).toBeGreaterThan(50));
  });

  it("testi durdurmak izleri durdurur ve önizlemeyi kaldırır", async () => {
    const md = installMediaDevices(devices);
    const { stream, video, audio } = fakeStream();
    md.getUserMedia.mockResolvedValue(stream);
    const { user, start } = await renderPrejoin();
    await user.click(start);
    await screen.findByTestId("prejoin-preview");

    await user.click(screen.getByRole("button", { name: "Testi durdur" }));
    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).toHaveBeenCalled();
    expect(screen.queryByTestId("prejoin-preview")).not.toBeInTheDocument();
  });

  it("önizleme izleri katılımdan ÖNCE durdurulur (token isteğinden önce)", async () => {
    const md = installMediaDevices(devices);
    const { stream, video, audio } = fakeStream();
    md.getUserMedia.mockResolvedValue(stream);
    const { user, start } = await renderPrejoin();
    await user.click(start);
    await screen.findByTestId("prejoin-preview");

    await user.click(screen.getByRole("button", { name: "Görüşmeye Katıl" }));
    await screen.findByTestId("lk-room");

    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).toHaveBeenCalled();
    expect(video.stop.mock.invocationCallOrder[0]!).toBeLessThan(harness.requestMeetingToken.mock.invocationCallOrder[0]!);
    expect(screen.queryByTestId("prejoin-device-check")).not.toBeInTheDocument();
  });

  it("izin reddedilirse çevrilmiş açıklama gösterilir (ham hata metni değil)", async () => {
    const md = installMediaDevices(devices);
    md.getUserMedia.mockRejectedValue(Object.assign(new Error("Permission denied by system"), { name: "NotAllowedError" }));
    const { user, start } = await renderPrejoin();
    await user.click(start);

    const alert = await screen.findByTestId("prejoin-error");
    expect(alert).toHaveTextContent("Kamera/mikrofon izni reddedildi");
    expect(alert).not.toHaveTextContent("Permission denied by system");
    expect(screen.queryByTestId("prejoin-preview")).not.toBeInTheDocument();
    // Test tekrar denenebilir.
    expect(screen.getByTestId("prejoin-test-start")).toBeInTheDocument();
  });

  it("izin reddi Arapça arayüzde Arapça açıklama verir", async () => {
    harness.localeCode = "ar";
    const md = installMediaDevices(devices);
    md.getUserMedia.mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
    const user = userEvent.setup({ delay: null });
    await user.click(await screen.findByTestId("prejoin-test-start"));
    expect(await screen.findByTestId("prejoin-error")).toHaveTextContent(/[؀-ۿ]/);
  });

  it("kamera bulunamazsa ve mediaDevices yoksa anlaşılır mesaj", async () => {
    const md = installMediaDevices(devices);
    md.getUserMedia.mockRejectedValue(Object.assign(new Error("x"), { name: "NotFoundError" }));
    const { user, start } = await renderPrejoin();
    await user.click(start);
    expect(await screen.findByTestId("prejoin-error")).toHaveTextContent("Kamera veya mikrofon bulunamadı");
  });

  it("cihaz seçimi saklanır, önizleme seçilen cihazla yeniden başlar ve katılımda yakalama seçeneği olur (Room options değişmez)", async () => {
    const md = installMediaDevices(devices);
    const first = fakeStream();
    const second = fakeStream();
    md.getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    const { user, start } = await renderPrejoin();
    await user.click(start);
    const select = await screen.findByTestId("prejoin-select-videoinput");
    await waitFor(() => expect(select.querySelectorAll("option").length).toBeGreaterThanOrEqual(2));

    fireEvent.change(select, { target: { value: "cam-2" } });
    await waitFor(() => expect(md.getUserMedia).toHaveBeenCalledTimes(2));
    expect(md.getUserMedia).toHaveBeenLastCalledWith({ video: { deviceId: { ideal: "cam-2" } }, audio: true });
    expect(first.video.stop).toHaveBeenCalled(); // eski önizleme bırakıldı
    expect(JSON.parse(window.localStorage.getItem(PREFS_STORAGE_KEY)!).videoinput).toBe("cam-2");

    await user.click(screen.getByRole("button", { name: "Görüşmeye Katıl" }));
    await screen.findByTestId("lk-room");
    expect(harness.lkProps.video).toEqual({ deviceId: "cam-2" });
    expect(harness.lkProps.options).toEqual({ adaptiveStream: true, dynacast: true });
  });

  it("hoparlör testi: setSinkId destekliyorsa seçili çıkışa kısa ton çalınır", async () => {
    (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId = vi.fn();
    const md = installMediaDevices(devices);
    md.getUserMedia.mockResolvedValue(fakeStream().stream);
    const played: { sink?: string; played: boolean }[] = [];
    class FakeAudio {
      state: { sink?: string; played: boolean } = { played: false };
      constructor() {
        played.push(this.state);
      }
      addEventListener() {}
      async setSinkId(id: string) {
        this.state.sink = id;
      }
      async play() {
        this.state.played = true;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    URL.createObjectURL = vi.fn(() => "blob:tone");
    URL.revokeObjectURL = vi.fn();

    const { user, start } = await renderPrejoin();
    await user.click(start);
    const speaker = await screen.findByTestId("prejoin-select-audiooutput");
    await waitFor(() => expect(within(speaker).getAllByRole("option").length).toBeGreaterThanOrEqual(2));
    fireEvent.change(speaker, { target: { value: "spk-2" } });
    await user.click(screen.getByTestId("prejoin-tone"));

    await waitFor(() => expect(played).toHaveLength(1));
    expect(played[0]).toEqual({ sink: "spk-2", played: true });
  });

  it("setSinkId yoksa hoparlör seçimi gizli; test sesi yine çalınır", async () => {
    const md = installMediaDevices(devices);
    md.getUserMedia.mockResolvedValue(fakeStream().stream);
    const played: boolean[] = [];
    class FakeAudio {
      addEventListener() {}
      async play() {
        played.push(true);
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    URL.createObjectURL = vi.fn(() => "blob:tone");
    URL.revokeObjectURL = vi.fn();

    const { user, start } = await renderPrejoin();
    await user.click(start);
    await screen.findByTestId("prejoin-tone");
    expect(screen.queryByTestId("prejoin-select-audiooutput")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("prejoin-tone"));
    await waitFor(() => expect(played).toEqual([true]));
  });
});

describe("saf yardımcılar", () => {
  it("levelFromSamples: sessizlik 0, yüksek ses büyük", () => {
    expect(levelFromSamples(new Uint8Array(64).fill(128))).toBe(0);
    expect(levelFromSamples(new Uint8Array(64).fill(250))).toBeGreaterThan(0.9);
  });

  it("buildToneWav geçerli bir WAV başlığı üretir", () => {
    const wav = buildToneWav(0.1, 440, 8000);
    const text = (from: number, len: number) => String.fromCharCode(...wav.slice(from, from + len));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(wav.length).toBe(44 + Math.floor(0.1 * 8000) * 2);
  });
});
