import type { ApiErrorCode, ApiErrorResponse } from "@/types/api-error";

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  if (typeof value !== "string") {
    return false;
  }

  switch (value) {
    case "INVALID_HANDLE":
    case "NOT_FOUND":
    case "UPSTREAM_TIMEOUT":
    case "UPSTREAM_ERROR":
    case "INVALID_UPSTREAM_DATA":
    case "UNSUPPORTED_PRODUCT_SHAPE":
    case "INTERNAL_ERROR":
      return true;

    default:
      return false;
  }
}

export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("code" in value) || !isApiErrorCode(value.code)) {
    return false;
  }

  if (!("message" in value) || typeof value.message !== "string") {
    return false;
  }

  return true;
}
