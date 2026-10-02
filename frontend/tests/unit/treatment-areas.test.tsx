import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TreatmentAreas } from "@/components/site/about/treatment-areas";
import type { AboutPageContent } from "@/lib/about-page";

function treatments(items: AboutPageContent["treatments"]["items"]): AboutPageContent["treatments"] {
  return { enabled: true, eyebrow: "Eyebrow", title: "Our treatment areas", body: "Body text.", items };
}

describe("TreatmentAreas", () => {
  it("isim bazlı (case-insensitive) eşleşen kart bir uzmanlık bağlantısı olur, eşleşmeyen sade kutu kalır", () => {
    render(
      <TreatmentAreas
        treatments={treatments([
          { id: "t1", name: "Obesity Surgery", icon: "Scale" },
          { id: "t2", name: "Dental Care", icon: "Smile" },
        ])}
        specialtyHrefByName={{ "obesity surgery": "/en/specialties/obesity-surgery" }}
      />
    );

    const link = screen.getByRole("link", { name: /Obesity Surgery/ });
    expect(link).toHaveAttribute("href", "/en/specialties/obesity-surgery");

    const unmatched = screen.getByText("Dental Care");
    expect(unmatched.closest("a")).toBeNull(); // eşleşme yok → bağlantı değil, sade kutu
  });

  it("eşleşme yoksa hiçbir kart bağlantı olmaz (boş harita)", () => {
    render(
      <TreatmentAreas
        treatments={treatments([{ id: "t1", name: "Hair Transplant", icon: "Scissors" }])}
        specialtyHrefByName={{}}
      />
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Hair Transplant")).toBeInTheDocument();
  });
});
