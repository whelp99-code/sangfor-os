import { NextResponse } from "next/server";
import { ApiResponse } from "@sangfor/shared/types/api";
import { ApiError } from "./api-error";

export function createApiResponse<T>(
  data: T,
  statusCode: number = 200
): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      meta: { timestamp: Date.now() },
    },
    { status: statusCode }
  );
}

export function createApiErrorResponse(
  error: ApiError | Error,
  statusCode?: number
): NextResponse<ApiResponse<null>> {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
        meta: { timestamp: Date.now() },
      },
      { status: error.statusCode }
    );
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: "UNKNOWN_ERROR",
        message: error.message || "Unknown error",
      },
      meta: { timestamp: Date.now() },
    },
    { status: statusCode || 500 }
  );
}
