import "server-only";

import { getExpressApiBaseUrl } from "@/lib/server/env";

export async function fetchFromExpress(path: string): Promise<Response> {
  const expressApiBaseUrl = getExpressApiBaseUrl();
  const requestUrl = new URL(path, expressApiBaseUrl);

  try {
    const response = await fetch(requestUrl);
    return response;
  } catch {
    throw new Error("Express APIへ接続できませんでした。");
  }
}
