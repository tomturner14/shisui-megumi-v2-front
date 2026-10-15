import { getDB } from "@/lib/server/db";
import { parseItems, quote, OrderError } from "@/lib/server/orders";
import { json, readBody, apiError } from "@/lib/server/api";
export async function POST(request: Request) {
  try {
    const body = (await readBody(request)) as {
      items?: unknown;
      fulfillment?: unknown;
    };
    if (!body)
      throw new OrderError("INVALID_REQUEST", 400, "商品を確認してください。");
    return json(
      await quote(await getDB(), parseItems(body.items), body.fulfillment),
    );
  } catch (error) {
    return apiError(error);
  }
}
