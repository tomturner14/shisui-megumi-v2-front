// Node test-process preload only; never imported by src/, Next config, or a Worker.
// Replaces ONLY the fictitious cert endpoint, not JWT validation or authorization.
import { readFileSync } from "node:fs";
const { keys } = JSON.parse(
  readFileSync(
    new URL("../../.wrangler/admin-auth-fixture.json", import.meta.url),
    "utf8",
  ),
);
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (
    url === "https://local-validation.cloudflareaccess.com/cdn-cgi/access/certs"
  )
    return Promise.resolve(Response.json({ keys }));
  return originalFetch(input, init);
};
