import type { ApiErrorCode } from "./types";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: Record<string, string[]>;
  /**
   * Bu isteğin backend'e gönderdiği `x-request-id` (bkz. lib/api/client.ts::doFetch) — backend
   * `x-request-id` header'ını `request.id` olarak kabul edip aynısını response'ta geri yansıtır
   * (bkz. backend/src/plugins/request-id.ts), böylece bu id ile backend pino log satırları ve
   * Sentry event'leri (backend `tags.requestId`) eşleştirilebilir. Trace correlation — bkz.
   * proje kökü CLAUDE.md § Kurallar.
   */
  readonly requestId?: string;

  constructor(
    status: number,
    error: { code: ApiErrorCode; message: string; details?: Record<string, string[]> },
    requestId?: string
  ) {
    super(error.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
    this.requestId = requestId;
  }

  /** İlk alan hatasını forma bağlamak için pratik yardımcı. */
  firstDetailFor(field: string): string | undefined {
    return this.details?.[field]?.[0];
  }
}
