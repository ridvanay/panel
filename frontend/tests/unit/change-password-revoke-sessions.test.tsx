import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Paket G — şifre değiştirmede "Diğer cihazlardaki oturumları hemen kapat". */
const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  apiFetchPage: vi.fn(),
}));

import { changePassword } from "@/lib/api/users";
import { getAccessToken, setAccessToken } from "@/lib/api/token-store";
import { RevokeOtherSessionsOption, passwordChangedMessage } from "@/components/shared/revoke-other-sessions-option";

beforeEach(() => {
  apiFetch.mockReset();
  setAccessToken("eski-token");
});

describe("changePassword istemcisi", () => {
  it("revokeOtherSessions: true → yanıttaki yeni access token belleğe yazılır (oturum düşmez)", async () => {
    apiFetch.mockResolvedValue({ accessToken: "yeni-token", accessTokenExpiresAt: "2026-10-19T12:15:00.000Z" });
    await changePassword({ currentPassword: "a", newPassword: "bbbbbbbb", revokeOtherSessions: true });
    expect(apiFetch).toHaveBeenCalledWith(
      "/users/me/change-password",
      expect.objectContaining({ method: "POST", body: { currentPassword: "a", newPassword: "bbbbbbbb", revokeOtherSessions: true } })
    );
    expect(getAccessToken()).toBe("yeni-token");
  });

  it("seçenek yoksa (204) token değişmez", async () => {
    apiFetch.mockResolvedValue(undefined);
    await changePassword({ currentPassword: "a", newPassword: "bbbbbbbb" });
    expect(getAccessToken()).toBe("eski-token");
  });
});

describe("RevokeOtherSessionsOption", () => {
  it("varsayılan işaretsiz; tıklanınca değişir; mesaj seçime göre", async () => {
    const onChange = vi.fn();
    render(<RevokeOtherSessionsOption id="x" checked={false} onCheckedChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("checkbox", { name: /Diğer cihazlardaki oturumları hemen kapat/ }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(passwordChangedMessage(true)).toMatch(/hemen kapatıldı/);
    expect(passwordChangedMessage(false)).toMatch(/15 dakika/);
  });
});
