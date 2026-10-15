import { requireAdmin, adminJson, adminError } from "@/lib/server/admin-auth";
import { getDB } from "@/lib/server/db";
import { getAdminOrder } from "@/lib/server/admin-orders";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request.headers);
    return adminJson(
      await getAdminOrder(await getDB(), (await context.params).id),
    );
  } catch (error) {
    return adminError(error);
  }
}
