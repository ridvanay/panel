import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/error";
import { PasswordField, passwordPolicyMessage } from "@/components/auth/password-field";
import { authStrings as en } from "@/lib/i18n/site-dictionaries/en/auth";
import { authStrings as tr } from "@/lib/i18n/site-dictionaries/tr/auth";
import { authStrings as de } from "@/lib/i18n/site-dictionaries/de/auth";
import { authStrings as es } from "@/lib/i18n/site-dictionaries/es/auth";
import { authStrings as ar } from "@/lib/i18n/site-dictionaries/ar/auth";
import { authStrings as ru } from "@/lib/i18n/site-dictionaries/ru/auth";
import { PASSWORD_RULES } from "@/lib/password-policy";

/** Paket S — yeni şifre alanı: canlı kural listesi, güç göstergesi, "şifreyi göster", sunucu kural kodları 6 dilde. */
function Harness({ email, name }: { email?: string; name?: string }) {
  const [value, setValue] = useState("");
  return (
    <PasswordField
      id="pw"
      label="Yeni şifre"
      value={value}
      context={{ email, name }}
      strings={tr.passwordRules}
      inputProps={{ value, onChange: (e) => setValue(e.target.value) }}
    />
  );
}

const ruleState = () => Object.fromEntries(PASSWORD_RULES.map((r) => [r, document.querySelector(`[data-rule="${r}"]`)!.getAttribute("data-ok")]));

describe("PasswordField", () => {
  it("kurallar yazdıkça işaretlenir; zayıf ve güçlü şifrede güç göstergesi", async () => {
    const user = userEvent.setup();
    render(<Harness email="ayse.kaya@example.com" name="Ayşe Kaya" />);
    const input = screen.getByLabelText("Yeni şifre");
    await user.type(input, "12345678");
    expect(ruleState()).toMatchObject({ length: "false", groups: "false", notDigitsOnly: "false", noSequence: "false", notCommon: "false" });
    expect(screen.getByTestId("password-strength")).toHaveTextContent("Güç: Çok zayıf");
    await user.clear(input);
    await user.type(input, "Gökyüzü-Mavi7");
    expect(Object.values(ruleState()).every((v) => v === "true")).toBe(true);
    expect(screen.getByTestId("password-strength")).toHaveTextContent("Güç: İyi");
    await user.clear(input);
    await user.type(input, "Kaya-Deniz-77");
    expect(ruleState().notPersonal).toBe("false");
  });

  it("'Şifreyi göster' düğmesi alan türünü değiştirir", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Yeni şifre");
    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Şifreyi göster" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Şifreyi gizle" })).toBeInTheDocument();
  });

  it("sunucunun kural kodları aktif dilde tek mesaja çevrilir; 6 dilin tamamında metinler var", () => {
    const err = new ApiClientError(422, { code: "VALIDATION_ERROR", message: "x", details: { password: ["..."], passwordRules: ["length", "notCommon"] } });
    expect(passwordPolicyMessage(err, tr.passwordRules)).toBe("Lütfen daha güçlü bir şifre seçin: 10–128 karakter olmalı; yaygın bir şifre olmamalı");
    expect(passwordPolicyMessage(err, en.passwordRules)).toContain("Please choose a stronger password:");
    expect(passwordPolicyMessage(new ApiClientError(422, { code: "VALIDATION_ERROR", message: "x", details: { email: ["..."] } }), en.passwordRules)).toBeNull();
    for (const dict of [en, tr, de, es, ar, ru]) {
      for (const rule of PASSWORD_RULES) expect(dict.passwordRules[rule].length, rule).toBeGreaterThan(5);
      expect(dict.passwordRules.levels).toHaveLength(5);
      expect(dict.passwordRules.serverInvalid).toContain("{rules}");
    }
    expect(new Set([en, tr, de, es, ar, ru].map((d) => d.passwordRules.notCommon)).size).toBe(6);
  });
});
