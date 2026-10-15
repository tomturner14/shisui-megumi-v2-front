import { requireAdmin, adminJson, adminError } from "@/lib/server/admin-auth";
import { getDB } from "@/lib/server/db";
import { listAdminOrders } from "@/lib/server/admin-orders";
export async function GET(request: Request) {
  try {
    await requireAdmin(request.headers);
    return adminJson(
      await listAdminOrders(await getDB(), new URL(request.url).searchParams),
    );
  } catch (error) {
    return adminError(error);
  }
}
