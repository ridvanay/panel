import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DoctorCvEntry, DoctorProfile } from "@/lib/api/types";
import { DoctorProfileTabs, cvYearLabel } from "@/components/site/telehealth/doctor-profile-tabs";
import { DoctorCvEntriesEditor } from "@/components/site/telehealth/doctor-cv-entries-editor";
import { toDoctorCvPayload } from "@/components/site/telehealth/doctor-cv-fields";
import { telehealthStrings } from "@/lib/i18n/site-dictionaries/en/telehealth";

vi.mock("@/lib/i18n/use-portal-strings", async () => {
  const { portalStrings } = await import("@/lib/i18n/site-dictionaries/en/portal");
  return { usePortalStrings: () => ({ t: portalStrings }) };
});

/**
 * Paket L (2026-10-23) — CV'de yılsız üyelik, tek yıllı sertifika ve ekli belge bağlantısı.
 */
const CERTIFICATE: DoctorCvEntry = {
  kind: "CERTIFICATE",
  title: "Wiley Reviewer Certificate — Journal of Obesity",
  organization: "Wiley",
  startYear: 2025,
  endYear: 2025,
  mediaId: "11111111-1111-4111-8111-111111111111",
  url: "/uploads/wiley.pdf",
};
const MEMBERSHIP: DoctorCvEntry = { kind: "MEMBERSHIP", title: "Member", organization: "IFSO", startYear: null, endYear: null };

function doctor(cvEntries: DoctorCvEntry[]): DoctorProfile {
  return {
    bio: "Özet",
    aboutHtml: null,
    cvEntries,
    publications: [],
    specialty: null,
    subSpecialty: null,
  } as unknown as DoctorProfile;
}

describe("Paket L — CV belge ve yıl", () => {
  it("yıl etiketi: yılsız üyelikte yok, aynı yılda tek yıl, devam edende 'Ongoing'", () => {
    expect(cvYearLabel(MEMBERSHIP, "Ongoing")).toBeNull();
    expect(cvYearLabel(CERTIFICATE, "Ongoing")).toBe("2025");
    expect(cvYearLabel({ ...CERTIFICATE, startYear: 2023, endYear: null }, "Ongoing")).toBe("2023 — Ongoing");
  });

  it("CV ve uzmanlık sekmelerinde 'View certificate' yeni sekmede PDF'i açar; üyelikte yıl yazmaz", async () => {
    const user = userEvent.setup();
    render(<DoctorProfileTabs doctor={doctor([CERTIFICATE, MEMBERSHIP])} dict={telehealthStrings} />);

    await user.click(screen.getByRole("tab", { name: telehealthStrings.tabCv }));
    const link = screen.getByRole("link", { name: /View certificate/ });
    expect(link).toHaveAttribute("href", "/uploads/wiley.pdf");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: telehealthStrings.tabExpertise }));
    expect(screen.getByRole("link", { name: /View certificate/ })).toHaveAttribute("href", "/uploads/wiley.pdf");
    expect(screen.getByText("IFSO")).toBeInTheDocument();
  });

  it("düzenleyici kalemi değiştirirken mediaId/url alanlarını silmez; payload onları korur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DoctorCvEntriesEditor entries={[CERTIFICATE]} onChange={onChange} />);
    await user.type(screen.getByDisplayValue("Wiley"), "!");
    expect(onChange.mock.calls.at(-1)![0][0]).toMatchObject({ organization: "Wiley!", mediaId: CERTIFICATE.mediaId, url: CERTIFICATE.url });

    const payload = toDoctorCvPayload({ subSpecialty: "", practiceStartYear: "", aboutHtml: "", cvEntries: [CERTIFICATE, MEMBERSHIP], publications: [] });
    expect(payload.cvEntries).toEqual([CERTIFICATE, MEMBERSHIP]);
  });

  it("üyelikte başlangıç yılı boş bırakılabilir (null gönderilir)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DoctorCvEntriesEditor entries={[{ ...MEMBERSHIP, startYear: 2020 }]} onChange={onChange} />);
    await user.clear(screen.getByLabelText("Start Year (optional for memberships)"));
    expect(onChange.mock.calls.at(-1)![0][0].startYear).toBeNull();
  });
});
