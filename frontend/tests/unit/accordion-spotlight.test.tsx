import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createBlock } from "@/lib/page-builder/registry";
import type { AccordionBlock } from "@/lib/page-builder/types";
import { AccordionBlockView } from "@/components/site/blocks/accordion-block";

function spotlightBlock(overrides: Partial<AccordionBlock["data"]> = {}): AccordionBlock {
  const base = createBlock("accordion") as AccordionBlock;
  return {
    ...base,
    data: {
      ...base.data,
      layoutStyle: "spotlight",
      badge: "FAQ",
      intro: "Clear information to help you plan your treatment journey.",
      defaultOpenFirst: true,
      items: [
        { id: "q1", question: "How do I start?", answer: "Contact us." },
        { id: "q2", question: "How long does it take?", answer: "It depends." },
      ],
      ...overrides,
    },
  };
}

describe("AccordionBlockView — layoutStyle: spotlight", () => {
  it("hap etiketi (badge) ve giriş metnini (intro) render eder", () => {
    render(<AccordionBlockView block={spotlightBlock()} chrome="page" />);
    expect(screen.getByText("FAQ")).toBeInTheDocument();
    expect(screen.getByText("Clear information to help you plan your treatment journey.")).toBeInTheDocument();
  });

  it("defaultOpenFirst:true iken İLK soru aria-expanded=true, diğerleri false gelir", () => {
    render(<AccordionBlockView block={spotlightBlock()} chrome="page" />);
    const firstTrigger = screen.getByRole("button", { name: "How do I start?" });
    const secondTrigger = screen.getByRole("button", { name: "How long does it take?" });
    expect(firstTrigger).toHaveAttribute("aria-expanded", "true");
    expect(secondTrigger).toHaveAttribute("aria-expanded", "false");
  });

  it("defaultOpenFirst:false/yok iken HİÇBİR soru varsayılan açık gelmez", () => {
    render(<AccordionBlockView block={spotlightBlock({ defaultOpenFirst: false })} chrome="page" />);
    const firstTrigger = screen.getByRole("button", { name: "How do I start?" });
    expect(firstTrigger).toHaveAttribute("aria-expanded", "false");
  });

  it("bir soruya tıklayınca aria-expanded değişir (klavye/fare ile kullanılabilir)", () => {
    render(<AccordionBlockView block={spotlightBlock({ defaultOpenFirst: false })} chrome="page" />);
    const secondTrigger = screen.getByRole("button", { name: "How long does it take?" });
    expect(secondTrigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(secondTrigger);
    expect(secondTrigger).toHaveAttribute("aria-expanded", "true");
  });

  it("boş soru/cevap içeren öğeleri filtreler, hiç dolu öğe yoksa null döner (DİĞER layoutStyle'larla AYNI davranış)", () => {
    const { container } = render(
      <AccordionBlockView block={spotlightBlock({ items: [{ id: "empty", question: "", answer: "" }] })} chrome="page" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AccordionBlockView — bordered/card/minimal piksel-eş regresyon kontrolü", () => {
  it("layoutStyle verilmediğinde (bordered varsayılan) spotlight'a özgü badge/intro render EDİLMEZ", () => {
    const base = createBlock("accordion") as AccordionBlock;
    const block: AccordionBlock = {
      ...base,
      data: { ...base.data, items: [{ id: "q1", question: "Soru", answer: "Cevap" }] },
    };
    render(<AccordionBlockView block={block} chrome="page" />);
    expect(screen.queryByText("FAQ")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Soru" })).toBeInTheDocument();
  });
});
