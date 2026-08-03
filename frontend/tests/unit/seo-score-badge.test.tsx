import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SeoScoreBadge, seoScoreTone } from "@/components/admin/content-list/seo-score-badge";
import type { SeoScoreIssue } from "@/lib/api/types";

describe("seoScoreTone", () => {
  it("< 50 için danger döner", () => {
    expect(seoScoreTone(0)).toBe("danger");
    expect(seoScoreTone(49)).toBe("danger");
  });

  it("50-79 için warning döner", () => {
    expect(seoScoreTone(50)).toBe("warning");
    expect(seoScoreTone(79)).toBe("warning");
  });

  it(">= 80 için success döner", () => {
    expect(seoScoreTone(80)).toBe("success");
    expect(seoScoreTone(100)).toBe("success");
  });
});

describe("SeoScoreBadge", () => {
  it("skoru rozet içinde gösterir", () => {
    render(<SeoScoreBadge score={42} issues={[]} entityLabel="Ana Sayfa" />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("tıklanınca eksik kriterleri listeler", async () => {
    const issues: SeoScoreIssue[] = [
      { code: "SEO_TITLE_MISSING", label: "SEO başlığı eksik" },
      { code: "IMAGE_ALT_MISSING", label: "Görsel alt metni eksik" },
    ];
    render(<SeoScoreBadge score={30} issues={issues} entityLabel="Ana Sayfa" />);

    fireEvent.click(screen.getByLabelText("Ana Sayfa SEO skoru: 30/100"));

    expect(await screen.findByText("SEO Tamlık Skoru: 30/100")).toBeInTheDocument();
    expect(screen.getByText("SEO başlığı eksik")).toBeInTheDocument();
    expect(screen.getByText("Görsel alt metni eksik")).toBeInTheDocument();
  });

  it("hiç sorun yoksa tamlık mesajını gösterir", async () => {
    render(<SeoScoreBadge score={100} issues={[]} entityLabel="Ana Sayfa" />);
    fireEvent.click(screen.getByLabelText("Ana Sayfa SEO skoru: 100/100"));

    await waitFor(() => {
      expect(screen.getByText("Tüm SEO kriterleri karşılanıyor")).toBeInTheDocument();
    });
  });
});
