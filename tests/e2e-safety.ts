// No allow-unsafe flag: tests that create orders can only target loopback HTTP.
export function localE2EBaseURL(value = "http://127.0.0.1:3000"): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "E2E_BASE_URL must be a loopback HTTP origin (localhost, 127.0.0.1, or [::1]).",
    );
  return url.origin;
}
export function localRequestURL(value: string, baseURL: string): string {
  const base = localE2EBaseURL(baseURL),
    url = new URL(value, base);
  if (url.origin !== base || url.username || url.password)
    throw new Error("E2E request outside the local test origin is blocked.");
  return url.href;
}
