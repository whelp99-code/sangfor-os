import { describe, expect, it } from "vitest";

import { API_ERRORS } from "../_lib/api-error";
import { createApiResponse, createApiErrorResponse } from "../_lib/api-response";

describe("API response format", () => {
  it("createApiResponse returns success envelope", async () => {
    const response = createApiResponse({ id: 1, name: "test" });
    const json = await response.json();

    expect(json.success).toBe(true);
    expect(json.data).toEqual({ id: 1, name: "test" });
    expect(json.meta.timestamp).toBeTypeOf("number");
    expect(response.status).toBe(200);
  });

  it("createApiResponse honors custom status code", async () => {
    const response = createApiResponse({ created: true }, 201);
    expect(response.status).toBe(201);
  });

  it("createApiErrorResponse maps ApiError to envelope and status", async () => {
    const response = createApiErrorResponse(API_ERRORS.NOT_FOUND());
    const json = await response.json();

    expect(json.success).toBe(false);
    expect(json.error.code).toBe("NOT_FOUND");
    expect(response.status).toBe(404);
  });

  it("createApiErrorResponse wraps plain Error as UNKNOWN_ERROR 500", async () => {
    const response = createApiErrorResponse(new Error("boom"));
    const json = await response.json();

    expect(json.success).toBe(false);
    expect(json.error.code).toBe("UNKNOWN_ERROR");
    expect(json.error.message).toBe("boom");
    expect(response.status).toBe(500);
  });
});
