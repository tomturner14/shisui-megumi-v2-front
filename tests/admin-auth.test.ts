import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createLocalJWKSet, generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  verifyAdmin,
  parseAdminConfig,
  requireAdminMutation,
  AdminError,
  adminError,
} from "../src/lib/server/admin-auth";
const config = parseAdminConfig({
  ACCESS_ISSUER: "https://unit-validation.cloudflareaccess.com",
  ACCESS_AUD: "unit-aud",
  ADMIN_SUBJECTS: "allowed-sub",
  ADMIN_ORIGIN: "https://shop.example.invalid",
});
let keys: Awaited<ReturnType<typeof generateKeyPair>>,
  wrong: typeof keys,
  resolver: ReturnType<typeof createLocalJWKSet>;
before(async () => {
  keys = await generateKeyPair("RS256");
  wrong = await generateKeyPair("RS256");
  resolver = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: "unit", alg: "RS256" }],
  });
});
async function token(
  changes: Record<string, unknown> = {},
  badSignature = false,
) {
  return new SignJWT({
    iss: config.issuer,
    aud: config.audience,
    sub: "allowed-sub",
    type: "app",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
    ...changes,
  })
    .setProtectedHeader({ alg: "RS256", kid: "unit" })
    .sign(badSignature ? wrong.privateKey : keys.privateKey);
}
async function check(value: string | undefined, status: number) {
  await assert.rejects(
    () =>
      verifyAdmin(
        new Headers(value ? { "cf-access-jwt-assertion": value } : {}),
        config,
        resolver,
      ),
    (e) => e instanceof AdminError && e.status === status,
  );
}
test("Access signatures, expiry, issuer, audience and required claims fail closed", async () => {
  await check(undefined, 401);
  await check(await token({}, true), 401);
  for (const claims of [
    { exp: 0 },
    { iss: "https://wrong.cloudflareaccess.com" },
    { aud: "wrong" },
    { nbf: 9999999999 },
    { iat: 9999999999 },
    { iat: undefined },
    { exp: undefined },
    { sub: undefined },
    { type: "service" },
  ])
    await check(await token(claims), claims.type ? 403 : 401);
  await check("eyJhbGciOiJub25lIn0.e30.", 401);
});
test("verified subject allowlist and cookies; spoofed email/header/body do not authorize", async () => {
  await check(
    await token({ sub: "not-allowed", email: "admin@example.invalid" }),
    403,
  );
  assert.deepEqual(
    await verifyAdmin(
      new Headers({ cookie: `CF_Authorization=${await token()}` }),
      config,
      resolver,
    ),
    { id: "allowed-sub" },
  );
  await assert.rejects(
    () =>
      verifyAdmin(
        new Headers({
          "cf-access-authenticated-user-email": "admin@example.invalid",
          cookie: "admin=true",
        }),
        config,
        resolver,
      ),
    AdminError,
  );
  await assert.rejects(
    async () =>
      verifyAdmin(
        new Headers({
          cookie: `CF_Authorization=${await token()}; CF_Authorization=other`,
        }),
        config,
        resolver,
      ),
    AdminError,
  );
  await assert.rejects(
    async () =>
      verifyAdmin(
        new Headers({
          cookie: `CF_Authorization=${await token()}`,
          "cf-access-jwt-assertion": "other",
        }),
        config,
        resolver,
      ),
    AdminError,
  );
});
test("missing/malformed server configuration denies and cannot choose a local JWKS endpoint", () => {
  for (const fields of [
    {},
    { ACCESS_ISSUER: config.issuer },
    {
      ACCESS_ISSUER: "http://127.0.0.1:9999",
      ACCESS_AUD: "x",
      ADMIN_SUBJECTS: "a",
      ADMIN_ORIGIN: config.origin,
    },
    {
      ACCESS_ISSUER: config.issuer,
      ACCESS_AUD: "x",
      ADMIN_SUBJECTS: "",
      ADMIN_ORIGIN: config.origin,
    },
  ])
    assert.throws(() => parseAdminConfig(fields), AdminError);
});
test("strict Origin, custom header and JSON reject CSRF and untrusted forwarded host", () => {
  const headers = {
    Origin: config.origin,
    "X-Admin-Action": "1",
    "Content-Type": "application/json",
  };
  requireAdminMutation(
    new Request(`${config.origin}/api/admin/orders/id/transition`, {
      method: "POST",
      headers,
    }),
    config,
  );
  for (const change of [
    { Origin: "https://evil.example.invalid" },
    { Origin: "" },
    { "X-Admin-Action": "" },
    { "Content-Type": "text/plain" },
    { "Sec-Fetch-Site": "cross-site" },
  ] as Record<string, string>[])
    assert.throws(
      () =>
        requireAdminMutation(
          new Request(`${config.origin}/api/admin/orders/id/transition`, {
            method: "POST",
            headers: {
              ...headers,
              ...change,
              "X-Forwarded-Host": "evil.example.invalid",
            },
          }),
          config,
        ),
      AdminError,
    );
  const response = adminError(new Error("private SQL/PII"));
  assert.equal(response.status, 503);
  assert.match(response.headers.get("cache-control")!, /no-store/);
});
