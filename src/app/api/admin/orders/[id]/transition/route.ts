import {
  requireAdmin,
  requireAdminMutation,
  adminJson,
  adminError,
} from "@/lib/server/admin-auth";
import { getDB } from "@/lib/server/db";
import { operateAdminOrder } from "@/lib/server/admin-orders";
import { OrderError } from "@/lib/server/orders";
import { AdminError } from "@/lib/server/admin-auth";
import { readBody } from "@/lib/server/api";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { principal, config } = await requireAdmin(request.headers);
    requireAdminMutation(request, config);
    return adminJson(
      await operateAdminOrder(
        await getDB(),
        (await context.params).id,
        await readBody(request),
        principal.id,
      ),
    );
  } catch (error) {
    return adminError(
      error instanceof OrderError
        ? new AdminError(error.code, error.status)
        : error,
    );
  }
}
