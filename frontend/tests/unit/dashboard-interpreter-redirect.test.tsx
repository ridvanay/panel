import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

/** Paket AA — 2FA'lı girişten sonra `/dashboard` üzerinden geçen tercüman kendi paneline gider. */
const replace = vi.fn();
let role = "INTERPRETER";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/dashboard" }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ status: "authenticated", user: { doctorProfileId: null, role } }) }));

import DashboardLayout from "@/app/dashboard/layout";

describe("/dashboard rol yönlendirmesi", () => {
  it("INTERPRETER → /interpreter; USER → /patient/appointments", async () => {
    render(<DashboardLayout>{null}</DashboardLayout>);
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/interpreter"));
    role = "USER";
    render(<DashboardLayout>{null}</DashboardLayout>);
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/patient/appointments"));
  });
});
