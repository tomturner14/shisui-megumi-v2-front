import { getDB } from "@/lib/server/db";
import { submitOrder } from "@/lib/server/orders";
import { json, readBody, apiError } from "@/lib/server/api";
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    return json(
      await submitOrder(
        await getDB(),
        body,
        request.headers.get("Idempotency-Key"),
      ),
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
