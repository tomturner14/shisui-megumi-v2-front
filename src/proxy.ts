import { NextResponse, type NextRequest } from "next/server";
import {
  requireAdmin,
  adminHeaders,
  adminError,
} from "@/lib/server/admin-auth";
export async function proxy(request: NextRequest) {
  try {
    await requireAdmin(request.headers);
    const response = NextResponse.next();
    for (const [name, value] of Object.entries(adminHeaders))
      response.headers.set(name, value);
    return response;
  } catch (error) {
    return adminError(error);
  }
}
export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
