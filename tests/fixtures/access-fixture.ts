import { generateKeyPair, exportJWK, importJWK, SignJWT } from "jose";
import { mkdir, writeFile, readFile } from "node:fs/promises";
export const fixturePath = ".wrangler/admin-auth-fixture.json";
export const issuer = "https://local-validation.cloudflareaccess.com",
  audience = "local-validation-only",
  subject = "local-operator";
export async function prepareAccessFixture() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const pub = {
    ...(await exportJWK(publicKey)),
    kid: "ephemeral-local-key",
    alg: "RS256",
    use: "sig",
  };
  await mkdir(".wrangler", { recursive: true });
  await writeFile(
    fixturePath,
    JSON.stringify({ keys: [pub], privateKey: await exportJWK(privateKey) }),
    { mode: 0o600 },
  );
}
export async function accessToken(claims: Record<string, unknown> = {}) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  return new SignJWT({ type: "app", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "ephemeral-local-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(typeof claims.sub === "string" ? claims.sub : subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(await importJWK(fixture.privateKey, "RS256"));
}
