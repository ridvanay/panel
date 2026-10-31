import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DoctorShowcase } from "@/lib/api/types";

/**
 * 2026-10-31 acil düzeltme — canlıda galeri, lightbox ve video tarayıcıya `http://backend:4000/uploads/...` veriyordu
 * (ERR_NAME_NOT_RESOLVED + Mixed Content). Kök neden: sunucu fetch'leri ham JSON'daki medya kökünü iç adrese
 * çeviriyordu (`toInternalMediaUrl`); bu değer istemci bileşenlerine prop olarak (RSC verisi) ve doğrudan
 * `<img>/<video>/<track>`'e gidiyordu. Artık veri genel adresle kalır; iç adres YALNIZCA next/image `src`'i içindir.
 *
 * Canlı yapılandırma taklit edilir: genel kök https://site.example, iç kök http://backend:4000.
 * `NEXT_PUBLIC_*` sabitleri içe aktarma anında okunduğu için her testte modüller yeniden yüklenir.
 */
const PUBLIC = "https://site.example";
const INTERNAL = "http://backend:4000";
const FORBIDDEN = /backend:4000|localhost|127\.0\.0\.1/i;

vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (path: string) => path,
  useLocaleCodes: () => ({ activeLocaleCode: "en", defaultLocaleCode: "en" }),
}));

const showcase = (origin: string): DoctorShowcase => ({
  procedures: [],
  media: [
    { id: "p1", kind: "photo", category: "clinic", title: "Klinik", description: "", alt: "Klinik", url: `${origin}/uploads/p1.jpg`, width: 800, height: 600 },
    {
      id: "v1",
      kind: "video",
      category: "clinic",
      title: "Tur",
      description: "",
      alt: "Tur",
      videoProvider: "upload",
      videoId: null,
      embedUrl: null,
      thumbnailUrl: `${origin}/uploads/poster.jpg`,
      videoUrl: `${origin}/uploads/v.mp4`,
      captionsUrl: `${origin}/uploads/c.vtt`,
      captionsLang: "tr",
    },
  ] as DoctorShowcase["media"],
});

describe("tarayıcıya giden medya adresleri (iç/loopback adres sızmaz)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_URL", `${PUBLIC}/api/v1`);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", PUBLIC);
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_MEDIA_URL", INTERNAL);
    vi.stubEnv("INTERNAL_API_URL", `${INTERNAL}/api/v1`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sunucu fetch'leri (vitrin, hekim, ürün) medya adresini iç adrese ÇEVİRMEZ", async () => {
    const body = JSON.stringify({ data: { ...showcase(PUBLIC), avatarMedia: { url: `${PUBLIC}/uploads/a.jpg` } } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })));
    const { fetchDoctorShowcaseServer, fetchDoctorBySlugServer } = await import("@/lib/api/server-telehealth");
    const { fetchProductBySlugServer } = await import("@/lib/api/server-products");
    for (const result of [await fetchDoctorShowcaseServer("x"), await fetchDoctorBySlugServer("x"), await fetchProductBySlugServer("x")]) {
      const text = JSON.stringify(result);
      expect(text).toContain(`${PUBLIC}/uploads/`);
      expect(text).not.toMatch(FORBIDDEN);
    }
  });

  it("SafeImage: next/image yalnızca /_next/image (iç adres kodlanmış) görür; düz <img> düşüşü genel adres kullanır", async () => {
    const { SafeImage } = await import("@/components/site/safe-image");
    const { toNextImageSrc, toPublicMediaUrl } = await import("@/lib/env");
    expect(toNextImageSrc(`${PUBLIC}/uploads/a.jpg`)).toBe(`${INTERNAL}/uploads/a.jpg`);
    expect(toNextImageSrc("https://cdn.other.example/a.jpg")).toBe("https://cdn.other.example/a.jpg");
    expect(toPublicMediaUrl(`${INTERNAL}/uploads/a.jpg`)).toBe(`${PUBLIC}/uploads/a.jpg`);
    const { container } = render(<SafeImage src={`${PUBLIC}/uploads/a.jpg`} alt="" width={100} height={100} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toMatch(/^\/_next\/image\?url=/);
    expect(container.innerHTML).not.toMatch(FORBIDDEN);
  });

  it("galeri, lightbox, video modalı (src/poster/track): iç adresle gelen veri bile tarayıcıya genel adres olarak çıkar", async () => {
    const { siteDictionary: en } = await import("@/lib/i18n/site-dictionaries/en");
    const { DoctorMediaGallery } = await import("@/components/site/telehealth/doctor-media-gallery");
    // Savunma: eski önbellekten iç adresle veri gelse bile.
    const { container } = render(<DoctorMediaGallery media={showcase(INTERNAL).media} telehealthDict={en.telehealth} />);
    await userEvent.click(screen.getByRole("button", { name: "Play video: Tur" }));
    const video = document.querySelector("video")!;
    expect(video.getAttribute("src")).toBe(`${PUBLIC}/uploads/v.mp4`);
    expect(video.getAttribute("poster")).toBe(`${PUBLIC}/uploads/poster.jpg`);
    expect(document.querySelector("track")!.getAttribute("src")).toBe(`${PUBLIC}/uploads/c.vtt`);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: /Klinik/ }));
    const lightboxImg = [...document.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
    expect(lightboxImg.some((src) => src === `${PUBLIC}/uploads/p1.jpg`)).toBe(true);
    expect(document.body.innerHTML).not.toMatch(FORBIDDEN);
    expect(container.innerHTML).not.toMatch(FORBIDDEN);
  });

  it("loopback adres (yanlış yapılandırılmış PUBLIC_URL) tarayıcıya gitmez: site köküne indirgenir", async () => {
    const { localThumbnail, safeMediaUrl } = await import("@/components/site/telehealth/video-facade");
    expect(localThumbnail("http://localhost:4000/uploads/t.jpg")).toBe(`${PUBLIC}/uploads/t.jpg`);
    expect(safeMediaUrl("http://127.0.0.1:4000/uploads/v.mp4")).toBe(`${PUBLIC}/uploads/v.mp4`);
    expect(safeMediaUrl("javascript:alert(1)")).toBeNull();
  });
});
