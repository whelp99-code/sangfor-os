import type { ApiResponse } from "@sangfor/shared/types/api";

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** Unwrap the common `{ success, data, error, meta }` API envelope. Throws ApiClientError on failure. */
export function unwrapApiResponse<T>(body: ApiResponse<T>): T {
  if (body && body.success) {
    return body.data as T;
  }
  const err = body?.error;
  throw new ApiClientError(err?.code ?? "UNKNOWN_ERROR", err?.message ?? "Request failed");
}
