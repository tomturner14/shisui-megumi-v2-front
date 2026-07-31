export type ApiErrorCode =
  | "INVALID_HANDLE"
  | "NOT_FOUND"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "INVALID_UPSTREAM_DATA"
  | "UNSUPPORTED_PRODUCT_SHAPE"
  | "INTERNAL_ERROR";

export type ApiErrorResponse = {
  code: ApiErrorCode;
  message: string;
};
