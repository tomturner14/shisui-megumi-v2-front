import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { adminSettings } from "@/lib/server/admin-config";
export class AdminError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export type AdminConfig = {
  issuer: string;
  audience: string;
  subjects: string[];
  origin: string;
};
export function parseAdminConfig(
  values: Record<string, string | undefined>,
): AdminConfig {
  const {
    ACCESS_ISSUER: issuer,
    ACCESS_AUD: audience,
    ADMIN_SUBJECTS,
    ADMIN_ORIGIN: origin,
  } = values;
  if (
    !issuer ||
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(
      issuer,
    ) ||
    !audience ||
    !ADMIN_SUBJECTS ||
    !origin
  )
    throw new AdminError("ADMIN_NOT_CONFIGURED", 503);
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new AdminError("ADMIN_NOT_CONFIGURED", 503);
  }
  const subjects = ADMIN_SUBJECTS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    url.origin !== origin ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )) ||
    !subjects.length ||
    subjects.some((s) => !/^[a-zA-Z0-9:_-]{1,200}$/.test(s))
  )
    throw new AdminError("ADMIN_NOT_CONFIGURED", 503);
  return { issuer, audience, subjects, origin };
}
const resolvers = new Map<string, JWTVerifyGetKey>();
function keyFor(config: AdminConfig) {
  let resolver = resolvers.get(config.issuer);
  if (!resolver) {
    resolver = createRemoteJWKSet(
      new URL(`${config.issuer}/cdn-cgi/access/certs`),
      { timeoutDuration: 5000 },
    );
    resolvers.set(config.issuer, resolver);
  }
  return resolver;
}
// Optional resolver is dependency injection for in-process signature tests only.
// No request or environment variable can select keys, a JWKS URL, or bypass verification.
export async function verifyAdmin(
  headers: Headers,
  config: AdminConfig,
  resolver: JWTVerifyGetKey = keyFor(config),
) {
  const cookieTokens = (headers.get("cookie") ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("CF_Authorization="));
  if (cookieTokens.length > 1) throw new AdminError("UNAUTHENTICATED", 401);
  const assertion = headers.get("cf-access-jwt-assertion");
  const cookie = cookieTokens[0]?.slice("CF_Authorization=".length);
  if (assertion && cookie && assertion !== cookie)
    throw new AdminError("UNAUTHENTICATED", 401);
  const token = assertion || cookie;
  if (!token || token.length > 16000)
    throw new AdminError("UNAUTHENTICATED", 401);
  try {
    const { payload } = await jwtVerify(token, resolver, {
      algorithms: ["RS256"],
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ["sub", "iss", "aud", "exp", "iat"],
    });
    if (
      typeof payload.iat !== "number" ||
      payload.iat > Math.floor(Date.now() / 1000) ||
      typeof payload.exp !== "number" ||
      payload.exp <= payload.iat
    )
      throw new AdminError("UNAUTHENTICATED", 401);
    if (
      payload.type !== "app" ||
      typeof payload.sub !== "string" ||
      !config.subjects.includes(payload.sub)
    )
      throw new AdminError("FORBIDDEN", 403);
    return { id: payload.sub };
  } catch (error) {
    if (error instanceof AdminError) throw error;
    throw new AdminError("UNAUTHENTICATED", 401);
  }
}
export async function requireAdmin(headers: Headers) {
  const config = parseAdminConfig(adminSettings());
  return { principal: await verifyAdmin(headers, config), config };
}
export function requireAdminMutation(request: Request, config: AdminConfig) {
  // Exact configured Origin, non-simple JSON + custom header, and no CORS allowances.
  // Do not derive trust from Host/X-Forwarded-* supplied by the requester.
  if (
    request.headers.get("origin") !== config.origin ||
    request.headers.get("sec-fetch-site") === "cross-site" ||
    request.headers.get("x-admin-action") !== "1" ||
    request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
  )
    throw new AdminError("FORBIDDEN", 403);
}
export const adminHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  Vary: "Cookie, Cf-Access-Jwt-Assertion",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
export function adminError(error: unknown) {
  const e =
    error instanceof AdminError
      ? error
      : new AdminError("SERVICE_UNAVAILABLE", 503);
  return Response.json(
    {
      code: e.code,
      message:
        "管理操作を実行できません。認証・権限・注文の状態を確認してください。",
    },
    { status: e.status, headers: adminHeaders },
  );
}
export function adminJson(value: unknown) {
  return Response.json(value, { headers: adminHeaders });
}
