import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavDropdown, groupSpecialtyNavChildren, specialtySlugFromHref, type NavDropdownLink, type NavSpecialty } from "@/components/site/nav-dropdown";

const SPECIALTIES: NavSpecialty[] = [
  { slug: "kardiyoloji", name: "Kardiyoloji", icon: "HeartPulse", imageUrl: "/uploads/k.png" },
  { slug: "dermatoloji", name: "Dermatoloji", icon: "Sparkles", imageUrl: null },
];

function renderDropdown(link: NavDropdownLink) {
  return render(
    <NavDropdown
      link={link}
      localize={(href) => (href.startsWith("/") ? `/en${href === "/" ? "" : href}` : href)}
      active={false}
      specialties={SPECIALTIES}
      viewAllLabel={`View all ${link.label}`}
      findDoctorLabel="Find a doctor"
      triggerClassName="text-foreground"
      activeTriggerClassName="text-primary"
    />
  );
}

async function open(label: string) {
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: new RegExp(`^${label}`) });
  await user.click(trigger);
  return { user, trigger };
}

describe("specialtySlugFromHref", () => {
  it.each([
    ["/specialties/kardiyoloji", "kardiyoloji"],
    ["/specialties/kardiyoloji/", "kardiyoloji"],
    ["/en/specialties/kardiyoloji", "kardiyoloji"],
    ["/physicians?specialty=dermatoloji", "dermatoloji"],
    ["/physicians/?specialty=dermatoloji&x=1", "dermatoloji"],
    ["/physicians", null],
    ["/specialties", null],
    ["/about", null],
    ["https://example.com/specialties/x", null],
    ["#", null],
  ])("%s → %s", (href, expected) => {
    expect(specialtySlugFromHref(href)).toBe(expected);
  });
});

describe("NavDropdown", () => {
  it("üstte üst öğenin adı, uzmanlıkta görsel/ikon, uzmanlık olmayanda görsel alanı yok", async () => {
    renderDropdown({
      id: "spec",
      label: "Specialties",
      href: "/specialties",
      children: [
        { id: "a", label: "Kardiyoloji", href: "/specialties/kardiyoloji" },
        { id: "b", label: "Dermatoloji", href: "/physicians?specialty=dermatoloji" },
        { id: "c", label: "FAQ", href: "/faq" },
      ],
    });
    const { trigger } = await open("Specialties");
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(trigger).toHaveAttribute("data-popup-open"));
    expect(within(menu).getByText("Specialties")).toBeInTheDocument();

    const cardio = within(menu).getByRole("menuitem", { name: "Kardiyoloji" });
    expect(cardio).toHaveAttribute("href", "/en/specialties/kardiyoloji");
    expect(cardio.querySelector("img")).toHaveAttribute("src", "/uploads/k.png");
    expect(cardio.className).toContain("min-h-[60px]");

    const derma = within(menu).getByRole("menuitem", { name: "Dermatoloji" });
    expect(derma.querySelector("img")).toBeNull();
    expect(derma.querySelector("svg")).not.toBeNull();

    const faq = within(menu).getByRole("menuitem", { name: "FAQ" });
    expect(faq.querySelector("svg, img")).toBeNull();

    // 4 veya daha az öğe → tek kolon
    expect(menu.querySelector(".grid-cols-2")).toBeNull();
    // Alt bölüm: kendi linki var → View all; uzmanlık menüsü ve üst öğe /doctors değil → Find a doctor
    expect(within(menu).getByRole("menuitem", { name: "View all Specialties" })).toHaveAttribute("href", "/en/specialties");
    expect(within(menu).getByRole("menuitem", { name: "Find a doctor" })).toHaveAttribute("href", "/en/physicians");
  });

  it("4'ten fazla öğede 2 kolon; üst öğe /doctors ise 'Find a doctor' tekrar edilmez; '#' linkte 'View all' yok", async () => {
    const children = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, label: `Item ${i}`, href: `/physicians?specialty=s${i}` }));
    const { unmount } = renderDropdown({ id: "p", label: "Branşlar", href: "/physicians", children });
    let menu = await (async () => {
      await open("Branşlar");
      return screen.findByRole("menu");
    })();
    expect(menu.querySelector(".grid-cols-2")).not.toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "View all Branşlar" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Find a doctor" })).toBeNull();
    unmount();

    renderDropdown({ id: "q", label: "More", href: "#", children: [{ id: "x", label: "Blog", href: "/blog" }] });
    await open("More");
    menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /View all/ })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Find a doctor" })).toBeNull();
  });

  it("klavye: Enter ile açılır, oklarla gezilir, Esc ile kapanır ve odak düğmeye döner", async () => {
    renderDropdown({
      id: "spec",
      label: "Specialties",
      href: "/specialties",
      children: [
        { id: "a", label: "Kardiyoloji", href: "/specialties/kardiyoloji" },
        { id: "b", label: "Dermatoloji", href: "/specialties/dermatoloji" },
      ],
    });
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: /^Specialties/ });
    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getAllByRole("menuitem").some((el) => el === document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

describe("Paket AG — alt uzmanlık gruplama", () => {
  const SPECS: NavSpecialty[] = [
    { slug: "gastroenterology", name: "Gastroenterology", icon: "Stethoscope", imageUrl: null, parentSlug: null },
    { slug: "esd", name: "ESD", icon: "Stethoscope", imageUrl: null, parentSlug: "gastroenterology" },
    { slug: "ercp", name: "ERCP", icon: "Stethoscope", imageUrl: null, parentSlug: "gastroenterology" },
    { slug: "cardiology", name: "Cardiology", icon: "HeartPulse", imageUrl: null },
  ];
  const link = (children: NavDropdownLink["children"]): NavDropdownLink => ({ id: "spec", label: "Specialties", href: "/specialties", children });

  it("üst uzmanlık menüdeyse alt öğeler ayrı kart olmaz, 'Procedures' satırında bağlantı olur", async () => {
    renderDropdownWith(
      link([
        { id: "g", label: "Gastroenterology", href: "/specialties/gastroenterology" },
        { id: "e", label: "ESD", href: "/specialties/esd" },
        { id: "r", label: "ERCP", href: "/physicians?specialty=ercp" },
        { id: "c", label: "Cardiology", href: "/specialties/cardiology" },
      ]),
      SPECS
    );
    await open("Specialties");
    const menu = await screen.findByRole("menu");
    const procedures = within(menu).getByTestId("nav-procedures");
    expect(procedures).toHaveTextContent("Procedures:");
    expect(within(procedures).getByRole("menuitem", { name: "ESD" })).toHaveAttribute("href", "/en/specialties/esd");
    expect(within(procedures).getByRole("menuitem", { name: "ERCP" })).toHaveAttribute("href", "/en/physicians?specialty=ercp");
    // Ayrı kart olarak yalnızca iki üst uzmanlık (min-h-[60px] kartlar).
    const cards = within(menu).getAllByRole("menuitem").filter((el) => el.className.includes("min-h-[60px]"));
    expect(cards.map((c) => c.textContent)).toEqual(["Gastroenterology", "Cardiology"]);
  });

  it("üst uzmanlık menüde yoksa alt öğe olduğu gibi kalır (veri kaybı yok)", () => {
    const grouped = groupSpecialtyNavChildren(
      [
        { id: "e", label: "ESD", href: "/specialties/esd" },
        { id: "c", label: "Cardiology", href: "/specialties/cardiology" },
      ],
      SPECS
    );
    expect(grouped.map((g) => g.label)).toEqual(["ESD", "Cardiology"]);
    expect(grouped.every((g) => g.procedures.length === 0)).toBe(true);
  });

  it("parentSlug alanı olmayan (eski API) uzmanlıklarda gruplama yapılmaz", () => {
    const grouped = groupSpecialtyNavChildren(
      [
        { id: "g", label: "Gastroenterology", href: "/specialties/gastroenterology" },
        { id: "e", label: "ESD", href: "/specialties/esd" },
      ],
      [
        { slug: "gastroenterology", name: "G", icon: "Stethoscope", imageUrl: null },
        { slug: "esd", name: "ESD", icon: "Stethoscope", imageUrl: null },
      ]
    );
    expect(grouped).toHaveLength(2);
  });
});

function renderDropdownWith(link: NavDropdownLink, specialties: NavSpecialty[]) {
  return render(
    <NavDropdown
      link={link}
      localize={(href) => (href.startsWith("/") ? `/en${href === "/" ? "" : href}` : href)}
      active={false}
      specialties={specialties}
      viewAllLabel="View all"
      findDoctorLabel="Find a doctor"
      proceduresLabel="Procedures"
      triggerClassName="text-foreground"
      activeTriggerClassName="text-primary"
    />
  );
}
