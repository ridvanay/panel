import type { z } from "zod";
import { ValidationError } from "../../lib/errors";

/** CRM admin uçları — zod hatasını projenin 422 zarfına (`details` alan → mesajlar) çevirir. */
export function parseOr422<T extends z.ZodTypeAny>(schema: T, value: unknown, message = "Girdi geçersiz."): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const details: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".") || "body";
    (details[key] ??= []).push(issue.message);
  }
  throw new ValidationError(message, details);
}
