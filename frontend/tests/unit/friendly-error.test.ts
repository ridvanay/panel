import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/error";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";

describe("friendlyErrorMessage", () => {
  it("returns the ApiClientError message when given one", () => {
    const err = new ApiClientError(404, { code: "NOT_FOUND", message: "Sayfa bulunamadı." });
    expect(friendlyErrorMessage(err)).toBe("Sayfa bulunamadı.");
  });

  it("returns a generic fallback for non-ApiClientError values", () => {
    expect(friendlyErrorMessage(new Error("boom"))).toBe("An unexpected error occurred. Please try again.");
    expect(friendlyErrorMessage("plain string")).toBe("An unexpected error occurred. Please try again.");
    expect(friendlyErrorMessage(undefined)).toBe("An unexpected error occurred. Please try again.");
  });
});

describe("fieldErrorsFrom", () => {
  it("maps each field to its first detail message", () => {
    const err = new ApiClientError(422, {
      code: "VALIDATION_ERROR",
      message: "Girdi doğrulama hatası.",
      details: { email: ["Geçersiz e-posta.", "İkinci mesaj"], password: ["Çok kısa."] },
    });

    expect(fieldErrorsFrom(err)).toEqual({ email: "Geçersiz e-posta.", password: "Çok kısa." });
  });

  it("returns an empty object when there are no details", () => {
    const err = new ApiClientError(401, { code: "UNAUTHORIZED", message: "Kimlik doğrulama gerekli." });
    expect(fieldErrorsFrom(err)).toEqual({});
  });

  it("returns an empty object for non-ApiClientError values", () => {
    expect(fieldErrorsFrom(new Error("boom"))).toEqual({});
  });
});
