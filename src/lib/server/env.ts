import "server-only";

export function getExpressApiBaseUrl() {
  const expressApiBaseUrl = process.env.EXPRESS_API_BASE_URL;

  if (!expressApiBaseUrl) {
    throw new Error("EXPRESS_API_BASE_URLがありません。");
  }

  return expressApiBaseUrl;
}
