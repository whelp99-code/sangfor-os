export class ApiError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const API_ERRORS = {
  UNAUTHORIZED: () => new ApiError("UNAUTHORIZED", "Unauthorized", 401),
  FORBIDDEN: () => new ApiError("FORBIDDEN", "Forbidden", 403),
  NOT_FOUND: () => new ApiError("NOT_FOUND", "Not found", 404),
  VALIDATION_ERROR: (msg: string) => new ApiError("VALIDATION_ERROR", msg, 400),
  INTERNAL_ERROR: () => new ApiError("INTERNAL_ERROR", "Internal server error", 500),
  DATABASE_ERROR: (msg?: string) => new ApiError("DATABASE_ERROR", msg || "Database error", 500),
} as const;
