import "server-only";

export function hasJsonContentType(response: Response): boolean {
  const contentType = response.headers.get("content-type");

  if (contentType === null) {
    return false;
  }

  return contentType.includes("application/json");
}

export function hasSuccessfulStatus(response: Response): boolean {
  return response.ok;
}

export async function parseJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("レスポンス本文をJSONとして解析できませんでした。");
  }
}
