import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsultationRoom } from "@/components/site/telehealth/consultation-room";
import { PREFS_STORAGE_KEY } from "@/components/site/telehealth/room/device-prefs";
import { doctor, harness, installMediaDevices, installPointerEvent, interpreter, local, makeLocalTrack, removeMediaDevices } from "./helpers/room-harness";

/**
 * Paket AF (Aşama 2) — sahne yerleşimi, kendi görüntüsü (PiP), kamera çevirme/aynalama ve BAĞLANTI DAYANIKLILIĞI.
 * LiveKit katmanı `helpers/room-harness.tsx`'te sahtelenir; `FakeRoom` bağlantıyı etkileyen çağrıları sayar.
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
const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

async function joinRoom() {
  render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
  const user = userEvent.setup({ delay: null });
  await user.click(await screen.findByRole("button", { name: harness.localeCode === "ar" ? "الانضمام إلى الاستشارة" : "Görüşmeye Katıl" }));
  await screen.findByTestId("lk-room");
  return user;
}

const tileFor = (identity: string) => screen.getAllByTestId("tile").find((el) => el.getAttribute("data-identity") === identity)!;
const wrapperFor = (identity: string) => tileFor(identity).closest("[data-tile-role]") as HTMLElement;
const roleOf = (identity: string) => wrapperFor(identity).getAttribute("data-tile-role");
const pipBox = () => screen.getByRole("group", { name: harness.localeCode === "ar" ? "الفيديو الخاص بك" : "Kendi görüntünüz" });
const stageArea = () => document.querySelector("[data-layout]") as HTMLElement;
const savedPrefs = () => JSON.parse(window.localStorage.getItem(PREFS_STORAGE_KEY) ?? "{}") as Record<string, unknown>;

beforeAll(() => installPointerEvent());

beforeEach(() => {
  harness.reset();
  window.localStorage.clear();
  removeMediaDevices();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe("yerleşim — konuşmacı / ızgara", () => {
  it("konuşmacı görünümü varsayılan: karşı taraf büyük ekran, kendi görüntüsü küçük kutu (PiP)", async () => {
    harness.participants = [local, doctor];
    harness.tracks = [cam(doctor), cam(local)];
    await joinRoom();
    expect(stageArea()).toHaveAttribute("data-layout", "speaker");
    expect(roleOf(doctor.identity)).toBe("main");
    expect(roleOf(local.identity)).toBe("pip");
  });

  it("büyük ekran 2 sn gecikmeyle değişir: 1999 ms'te hâlâ eski kişi, 2000 ms'te yeni konuşan", async () => {
    harness.participants = [local, doctor, interpreter];
    harness.tracks = [cam(doctor), cam(interpreter), cam(local)];
    await joinRoom();
    expect(roleOf(doctor.identity)).toBe("main");
    expect(roleOf(interpreter.identity)).toBe("thumb");

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => harness.room.emit("activeSpeakersChanged", [interpreter]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(roleOf(doctor.identity)).toBe("main");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(roleOf(interpreter.identity)).toBe("main");
    expect(roleOf(doctor.identity)).toBe("thumb");
  });

  it("2 sn dolmadan susan kişi büyük ekranı değiştirmez (ani geçiş yok)", async () => {
    harness.participants = [local, doctor, interpreter];
    harness.tracks = [cam(doctor), cam(interpreter), cam(local)];
    await joinRoom();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => harness.room.emit("activeSpeakersChanged", [interpreter]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    act(() => harness.room.emit("activeSpeakersChanged", []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(roleOf(doctor.identity)).toBe("main");
    expect(roleOf(interpreter.identity)).toBe("thumb");
  });

  it("ızgara görünümü: tercümanla 3 kişide herkes eşit; geri dönüşte konuşmacı görünümü", async () => {
    harness.participants = [local, doctor, interpreter];
    harness.tracks = [cam(doctor), cam(interpreter), cam(local)];
    const user = await joinRoom();

    await user.click(screen.getByRole("button", { name: "Izgara görünümüne geç" }));
    expect(stageArea()).toHaveAttribute("data-layout", "grid");
    for (const p of [doctor, interpreter, local]) expect(roleOf(p.identity)).toBe("grid");
    expect(savedPrefs().layout).toBe("grid");

    await user.click(screen.getByRole("button", { name: "Konuşmacı görünümüne geç" }));
    expect(stageArea()).toHaveAttribute("data-layout", "speaker");
    expect(roleOf(doctor.identity)).toBe("main");
  });

  it("yerleşim değişince video elemanları sökülüp takılmaz (aynı <video> düğümü)", async () => {
    harness.participants = [local, doctor];
    harness.tracks = [cam(doctor), cam(local)];
    const user = await joinRoom();
    const before = [document.querySelector(`video[data-identity="${doctor.identity}"]`), document.querySelector(`video[data-identity="${local.identity}"]`)];

    await user.click(screen.getByRole("button", { name: "Izgara görünümüne geç" }));
    await user.click(screen.getByRole("button", { name: "Konuşmacı görünümüne geç" }));

    expect(document.querySelector(`video[data-identity="${doctor.identity}"]`)).toBe(before[0]);
    expect(document.querySelector(`video[data-identity="${local.identity}"]`)).toBe(before[1]);
  });
});

describe("kendi görüntüsü (PiP)", () => {
  beforeEach(() => {
    harness.participants = [local, doctor];
    harness.tracks = [cam(doctor), cam(local)];
  });

  it("sürükleme sırasında konum kayar; bırakınca en yakın köşeye yapışır ve tercih saklanır", async () => {
    await joinRoom();
    const box = pipBox();
    expect(box).toHaveAttribute("data-pip-corner", "bottom-end");
    stageArea().getBoundingClientRect = () => rect(0, 0, 1000, 600);
    box.getBoundingClientRect = () => rect(20, 20, 150, 110);

    fireEvent.pointerDown(box, { pointerId: 1, clientX: 900, clientY: 520 });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 100, clientY: 60 });
    expect(box.style.transform).toContain("translate(-800px, -460px)");
    fireEvent.pointerUp(box, { pointerId: 1, clientX: 100, clientY: 60 });

    expect(box).toHaveAttribute("data-pip-corner", "top-start");
    expect(box.style.transform).toBe("");
    expect(savedPrefs().pipCorner).toBe("top-start");
  });

  it("köşe mantığı mantıksal: RTL'de fiziksel sol üst = top-end", async () => {
    harness.localeCode = "ar";
    await joinRoom();
    const box = pipBox();
    stageArea().getBoundingClientRect = () => rect(0, 0, 1000, 600);
    box.getBoundingClientRect = () => rect(20, 20, 150, 110);

    fireEvent.pointerDown(box, { pointerId: 1, clientX: 900, clientY: 520 });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerUp(box, { pointerId: 1, clientX: 100, clientY: 60 });

    expect(box).toHaveAttribute("data-pip-corner", "top-end");
  });

  it("boyut düğmesi küçük → orta → büyük döner", async () => {
    const user = await joinRoom();
    expect(pipBox()).toHaveAttribute("data-pip-size", "medium");
    await user.click(screen.getByRole("button", { name: "Kendi görüntü boyutu: orta" }));
    expect(pipBox()).toHaveAttribute("data-pip-size", "large");
    await user.click(screen.getByRole("button", { name: "Kendi görüntü boyutu: büyük" }));
    expect(pipBox()).toHaveAttribute("data-pip-size", "small");
    expect(savedPrefs().pipSize).toBe("small");
  });

  it("iki parmakla büyütme/küçültme (pointer events): açılınca bir basamak büyür, kapanınca küçülür; dokunma sayılmaz", async () => {
    await joinRoom();
    const box = pipBox();
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(box, { pointerId: 2, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(box, { pointerId: 2, clientX: 240, clientY: 100 });
    expect(box).toHaveAttribute("data-pip-size", "large");
    fireEvent.pointerMove(box, { pointerId: 2, clientX: 190, clientY: 100 });
    expect(box).toHaveAttribute("data-pip-size", "medium");
    fireEvent.pointerUp(box, { pointerId: 2 });
    fireEvent.pointerUp(box, { pointerId: 1 });
    // Pinch sonrası parmak kalkışı "çift dokunma → yer değiştir" tetiklemez.
    expect(roleOf(local.identity)).toBe("pip");
  });

  it("gizle → yalnızca avatar balonu; göster → geri gelir (video elemanı sökülmez)", async () => {
    const user = await joinRoom();
    const video = document.querySelector(`video[data-identity="${local.identity}"]`);
    await user.click(screen.getByRole("button", { name: "Kendi görüntünüzü gizleyin" }));
    expect(pipBox()).toHaveAttribute("data-pip-hidden", "true");
    expect(document.querySelector(`video[data-identity="${local.identity}"]`)).toBe(video);

    await user.click(screen.getByRole("button", { name: "Kendi görüntünüzü gösterin" }));
    expect(pipBox()).toHaveAttribute("data-pip-hidden", "false");
    expect(screen.queryByRole("button", { name: "Kendi görüntünüzü gösterin" })).not.toBeInTheDocument();
  });

  it("çift dokunma/tıklama kendi görüntüsünü büyük ekrana alır, karşı taraf küçük kutuya geçer; tekrar çift dokunma geri alır", async () => {
    await joinRoom();
    const remoteVideo = document.querySelector(`video[data-identity="${doctor.identity}"]`);
    const tap = (el: Element) => {
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 10, clientY: 10 });
    };

    tap(pipBox());
    expect(roleOf(local.identity)).toBe("pip"); // tek dokunma: yer değişmez
    tap(pipBox());
    expect(roleOf(local.identity)).toBe("main");
    expect(roleOf(doctor.identity)).toBe("pip");
    expect(document.querySelector(`video[data-identity="${doctor.identity}"]`)).toBe(remoteVideo);

    tap(wrapperFor(doctor.identity));
    tap(wrapperFor(doctor.identity));
    expect(roleOf(doctor.identity)).toBe("main");
    expect(roleOf(local.identity)).toBe("pip");
  });

  it("yer değiştir düğmesi (klavye erişimi) aynı işi yapar", async () => {
    const user = await joinRoom();
    await user.click(screen.getByRole("button", { name: "Kendi görüntünüzle ana görüntünün yerini değiştirin" }));
    expect(roleOf(local.identity)).toBe("main");
  });
});

describe("bekleme odası", () => {
  it("karşı taraf yokken kendi görüntüsü büyük; hasta ekranında doktor adıyla metin", async () => {
    harness.participants = [local];
    harness.tracks = [cam(local)];
    await joinRoom();
    expect(roleOf(local.identity)).toBe("main");
    expect(screen.getByTestId("waiting-overlay")).toHaveTextContent("Dr. Elif Aydemir birazdan katılacak");
  });

  it("doktor ekranında hastanın adıyla metin", async () => {
    harness.doctorSession = true;
    harness.participants = [local];
    harness.tracks = [cam(local)];
    await joinRoom();
    expect(screen.getByTestId("waiting-overlay")).toHaveTextContent("Zeynep Kaya birazdan katılacak");
  });

  it("karşı taraf gelince büyük ekran ona geçer ve metin kalkar", async () => {
    harness.participants = [local];
    harness.tracks = [cam(local)];
    const { rerender } = render(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
    const user = userEvent.setup({ delay: null });
    await user.click(await screen.findByRole("button", { name: "Görüşmeye Katıl" }));
    await screen.findByTestId("lk-room");
    expect(roleOf(local.identity)).toBe("main");

    harness.participants = [local, doctor];
    harness.tracks = [cam(doctor), cam(local)];
    rerender(<ConsultationRoom appointmentId="appointment-1" accessToken="guest-token" />);
    expect(roleOf(doctor.identity)).toBe("main");
    expect(roleOf(local.identity)).toBe("pip");
    expect(screen.queryByTestId("waiting-overlay")).not.toBeInTheDocument();
  });
});

describe("kamera çevirme ve yerel önizleme aynalama", () => {
  const devices = [
    { kind: "videoinput", deviceId: "cam-front", label: "Front" },
    { kind: "videoinput", deviceId: "cam-back", label: "Back" },
  ];

  function setupTrack() {
    const track = makeLocalTrack({ facingMode: "user", deviceId: "cam-front" });
    // Gerçek telefondaki gibi: arka kamera istenince cihaz kimliği de değişir.
    track.restartTrack.mockImplementation(async (opts?: { facingMode?: string }) => {
      track.settings.facingMode = opts?.facingMode;
      track.settings.deviceId = opts?.facingMode === "environment" ? "cam-back" : "cam-front";
    });
    harness.room.publications.camera = { videoTrack: track };
    harness.room.activeDevices.videoinput = "cam-front";
    return track;
  }

  beforeEach(() => {
    harness.participants = [local, doctor];
    harness.tracks = [cam(doctor), cam(local)];
  });

  it("ön kamerada yerel önizleme aynalanır (data-mirrored=true)", async () => {
    installMediaDevices(devices);
    setupTrack();
    await joinRoom();
    expect(pipBox()).toHaveAttribute("data-facing", "user");
    expect(pipBox()).toHaveAttribute("data-mirrored", "true");
  });

  it("tek kameralı cihazda 'Kamerayı çevir' düğmesi yok", async () => {
    installMediaDevices([devices[0]!]);
    setupTrack();
    await joinRoom();
    expect(screen.queryByRole("button", { name: "Kamerayı çevir" })).not.toBeInTheDocument();
  });

  it("user → environment: restartTrack({ facingMode }) ile çevrilir; arka kamerada önizleme AYNALANMAZ; geri çevirince yine aynalanır", async () => {
    installMediaDevices(devices);
    const track = setupTrack();
    const user = await joinRoom();

    await user.click(await screen.findByRole("button", { name: "Kamerayı çevir" }));
    expect(track.restartTrack).toHaveBeenCalledWith({ facingMode: "environment" });
    expect(harness.room.switchActiveDevice).not.toHaveBeenCalled();
    expect(pipBox()).toHaveAttribute("data-facing", "environment");
    expect(pipBox()).toHaveAttribute("data-mirrored", "false");

    await user.click(screen.getByRole("button", { name: "Kamerayı çevir" }));
    expect(track.restartTrack).toHaveBeenLastCalledWith({ facingMode: "user" });
    expect(pipBox()).toHaveAttribute("data-mirrored", "true");
  });

  it("facingMode desteklenmiyorsa cihaz listesinden sıradaki kamera room.switchActiveDevice ile seçilir", async () => {
    installMediaDevices(devices, { facingModeSupported: false });
    const track = setupTrack();
    harness.room.switchActiveDevice.mockImplementation(async (_kind: string, id: string) => {
      track.settings.deviceId = id;
      track.settings.facingMode = id === "cam-back" ? "environment" : "user";
      return true;
    });
    const user = await joinRoom();

    await user.click(await screen.findByRole("button", { name: "Kamerayı çevir" }));
    expect(track.restartTrack).not.toHaveBeenCalled();
    expect(harness.room.switchActiveDevice).toHaveBeenCalledWith("videoinput", "cam-back");
    expect(pipBox()).toHaveAttribute("data-mirrored", "false");
  });

  it("restartTrack kamerayı gerçekte değiştirmediyse (iki web kamerası) cihaz listesine düşer", async () => {
    installMediaDevices(devices);
    const track = setupTrack();
    track.restartTrack.mockImplementation(async () => {}); // aynı cihaz kaldı
    const user = await joinRoom();

    await user.click(await screen.findByRole("button", { name: "Kamerayı çevir" }));
    expect(track.restartTrack).toHaveBeenCalledTimes(1);
    expect(harness.room.switchActiveDevice).toHaveBeenCalledWith("videoinput", "cam-back");
  });
});

describe("bağlantı dayanıklılığı — görsel işlemler yeniden bağlanma tetiklemez", () => {
  it("kamera çevirme, yerleşim değiştirme ve PiP işlemleri: token isteği, oda kurulumu, connect/disconnect değişmez", async () => {
    installMediaDevices([
      { kind: "videoinput", deviceId: "cam-front", label: "Front" },
      { kind: "videoinput", deviceId: "cam-back", label: "Back" },
    ]);
    const track = makeLocalTrack({ facingMode: "user", deviceId: "cam-front" });
    track.restartTrack.mockImplementation(async (opts?: { facingMode?: string }) => {
      track.settings.facingMode = opts?.facingMode;
      track.settings.deviceId = opts?.facingMode === "environment" ? "cam-back" : "cam-front";
    });
    harness.room.publications.camera = { videoTrack: track };
    harness.participants = [local, doctor, interpreter];
    harness.tracks = [cam(doctor), cam(interpreter), cam(local)];
    const user = await joinRoom();

    const tokenCalls = harness.requestMeetingToken.mock.calls.length;
    const mounts = [...harness.mounts];
    const token = harness.lkProps.token;
    expect(tokenCalls).toBe(1);

    // Kamera çevirme (iki yön)
    await user.click(await screen.findByRole("button", { name: "Kamerayı çevir" }));
    await user.click(screen.getByRole("button", { name: "Kamerayı çevir" }));
    expect(track.restartTrack).toHaveBeenCalledTimes(2);

    // Yerleşim değiştirme
    await user.click(screen.getByRole("button", { name: "Izgara görünümüne geç" }));
    await user.click(screen.getByRole("button", { name: "Konuşmacı görünümüne geç" }));

    // PiP: boyut, gizle/göster, yer değiştir, sürükle
    await user.click(screen.getByRole("button", { name: /Kendi görüntü boyutu/ }));
    await user.click(screen.getByRole("button", { name: "Kendi görüntünüzü gizleyin" }));
    await user.click(screen.getByRole("button", { name: "Kendi görüntünüzü gösterin" }));
    await user.click(screen.getByRole("button", { name: "Kendi görüntünüzle ana görüntünün yerini değiştirin" }));
    const box = wrapperFor(doctor.identity);
    stageArea().getBoundingClientRect = () => rect(0, 0, 1000, 600);
    box.getBoundingClientRect = () => rect(20, 20, 150, 110);
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 900, clientY: 520 });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerUp(box, { pointerId: 1, clientX: 100, clientY: 60 });

    // Bağlantı olay sayaçları: hiçbir şey değişmedi.
    expect(harness.requestMeetingToken).toHaveBeenCalledTimes(tokenCalls);
    expect(harness.mounts).toEqual(mounts);
    expect(harness.unmounts).toBe(0);
    expect(harness.lkProps.token).toBe(token);
    expect(screen.getByTestId("lk-room")).toHaveAttribute("data-token", token);
    expect(harness.room.connect).not.toHaveBeenCalled();
    expect(harness.room.disconnect).not.toHaveBeenCalled();
    expect(screen.queryByTestId("reconnecting-overlay")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reconnect-failed")).not.toBeInTheDocument();
  });

  it("kırmızı çizgi: Room seçenekleri aynen { adaptiveStream: true, dynacast: true }; kayıtlı tercih yokken video/audio = true", async () => {
    harness.participants = [local, doctor];
    harness.tracks = [cam(doctor), cam(local)];
    await joinRoom();
    expect(harness.lkProps.options).toEqual({ adaptiveStream: true, dynacast: true });
    expect(harness.lkProps.video).toBe(true);
    expect(harness.lkProps.audio).toBe(true);
  });
});
