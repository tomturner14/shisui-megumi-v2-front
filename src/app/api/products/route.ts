import { getProducts } from "@/lib/server/catalog";
import { json, apiError } from "@/lib/server/api";
export async function GET() {
  try {
    return json(await getProducts());
  } catch (error) {
    return apiError(error);
  }
}
