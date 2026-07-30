import { describe, expect, it } from "vitest";
import {
  ApiError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../src/lib/errors";

describe("ApiError subclasses", () => {
  it.each([
    [new UnauthorizedError(), 401, "UNAUTHORIZED"],
    [new ForbiddenError(), 403, "FORBIDDEN"],
    [new NotFoundError(), 404, "NOT_FOUND"],
    [new ConflictError(), 409, "CONFLICT"],
    [new ValidationError(), 422, "VALIDATION_ERROR"],
  ] as const)("%# sets the right statusCode/code", (error, statusCode, code) => {
    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(statusCode);
    expect(error.code).toBe(code);
  });

  it("uses a sensible default message when none is given", () => {
    expect(new NotFoundError().message).toBe("Kaynak bulunamadı.");
  });

  it("accepts a custom message", () => {
    expect(new NotFoundError("Sayfa bulunamadı.").message).toBe("Sayfa bulunamadı.");
  });

  it("carries field-level details for ValidationError", () => {
    const error = new ValidationError("Girdi hatası.", { email: ["Geçersiz e-posta."] });
    expect(error.details).toEqual({ email: ["Geçersiz e-posta."] });
  });
});
