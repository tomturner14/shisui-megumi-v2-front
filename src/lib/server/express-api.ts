import "server-only";

import { getExpressApiBaseUrl } from "@/lib/server/env";

import {
  hasJsonContentType,
  hasSuccessfulStatus,
  parseJsonBody,
} from "@/lib/server/http";
import { isApiErrorResponse } from "@/lib/validators/api-error";
import type { ApiErrorResponse } from "@/types/api-error";

export type ExpressJsonResponse =
  | {
      ok: true;
      status: number;
      body: unknown;
    }
  | {
      ok: false;
      status: number;
      body: ApiErrorResponse;
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

  if (!ok) {
    if (!isApiErrorResponse(body)) {
      throw new Error(
        "Express APIから受け取ったエラー内容が契約に違反しています。",
      );
    }

    return {
      ok: false,
      status,
      body,
    };
  }

  return {
    ok: true,
    status,
    body,
  };
}
