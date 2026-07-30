import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Yayında</Badge>);
    expect(screen.getByText("Yayında")).toBeInTheDocument();
  });

  it("applies the success tone classes", () => {
    render(<Badge tone="success">Yayında</Badge>);
    expect(screen.getByText("Yayında")).toHaveClass("bg-success/10", "text-success");
  });

  it("defaults to the neutral tone", () => {
    render(<Badge>Taslak</Badge>);
    expect(screen.getByText("Taslak")).toHaveClass("bg-surface-muted");
  });
});
