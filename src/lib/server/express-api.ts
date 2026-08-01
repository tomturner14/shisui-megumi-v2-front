import "server-only";

import { getExpressApiBaseUrl } from "@/lib/server/env";

import {
  hasJsonContentType,
  hasSuccessfulStatus,
  parseJsonBody,
} from "@/lib/server/http";

export type ExpressJsonResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

export async function fetchFromExpress(
  path: string,
): Promise<ExpressJsonResponse> {
  const expressApiBaseUrl = getExpressApiBaseUrl();
  const requestUrl = new URL(path, expressApiBaseUrl);

  let response: Response;

  try {
    response = await fetch(requestUrl);
  } catch {
    throw new Error("Express APIへ接続できませんでした。");
  }

  if (!hasJsonContentType(response)) {
    throw new Error(
      "Express APIからJSON形式のレスポンスを受け取れませんでした。",
    );
  }

  const ok = hasSuccessfulStatus(response);
  const status = response.status;

  const body = await parseJsonBody(response);

  return {
    ok,
    status,
    body,
  };
}
