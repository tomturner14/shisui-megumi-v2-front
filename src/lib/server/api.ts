import "server-only";
import { OrderError } from "./orders";
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function readBody(request: Request): Promise<unknown> {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const requestOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (
    (origin && origin !== requestOrigin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new OrderError("FORBIDDEN", 403, "この送信元からは申し込めません。");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new OrderError("INVALID_REQUEST", 415, "JSONで送信してください。");
  if (Number(request.headers.get("content-length")) > 16384)
    throw new OrderError("TOO_LARGE", 413, "送信内容が大きすぎます。");
  // Enforce actual bytes as well as the untrusted Content-Length.
  const reader = request.body?.getReader();
  if (!reader)
    throw new OrderError("INVALID_REQUEST", 400, "送信内容がありません。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new OrderError("TOO_LARGE", 413, "送信内容が大きすぎます。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new OrderError(
      "INVALID_REQUEST",
      400,
      "送信内容を確認してください。",
    );
  }
}
export function apiError(error: unknown) {
  if (error instanceof OrderError)
    return json({ code: error.code, message: error.message }, error.status);
  // Never expose SQL, bindings, request bodies, or buyer data in the public response/log.
  return json(
    {
      code: "SERVICE_UNAVAILABLE",
      message: "現在処理できません。しばらくしてから再試行してください。",
    },
    503,
  );
}
