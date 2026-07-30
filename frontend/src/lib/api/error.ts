import type { ApiErrorCode } from "./types";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: Record<string, string[]>;

  constructor(status: number, error: { code: ApiErrorCode; message: string; details?: Record<string, string[]> }) {
    super(error.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }

  /** İlk alan hatasını forma bağlamak için pratik yardımcı. */
  firstDetailFor(field: string): string | undefined {
    return this.details?.[field]?.[0];
  }
}
