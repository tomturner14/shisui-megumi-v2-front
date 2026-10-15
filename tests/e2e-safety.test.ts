import { test } from "node:test";
import assert from "node:assert/strict";
import { localE2EBaseURL, localRequestURL } from "./e2e-safety";
test("only loopback HTTP origins are accepted", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"])
    assert.equal(
      localE2EBaseURL(`http://${host}:3000/`),
      `http://${host}:3000`,
    );
  for (const url of [
    "https://example.com",
    "http://example.com",
    "http://localhost.example.com",
    "http://192.168.1.1",
    "http://0.0.0.0",
    "https://localhost",
    "http://user:pass@localhost",
    "http://localhost/api",
    "http://localhost/?q=1",
    "http://localhost/#x",
    "file:///tmp/test",
  ])
    assert.throws(() => localE2EBaseURL(url));
});
test("absolute API URLs and redirects cannot escape the selected test origin", () => {
  assert.equal(
    localRequestURL("/api/orders", "http://127.0.0.1:3000"),
    "http://127.0.0.1:3000/api/orders",
  );
  for (const url of [
    "https://example.com/api/orders",
    "//example.com",
    "http://localhost:3000",
    "http://127.0.0.1:3001",
    "http://user@127.0.0.1:3000",
  ])
    assert.throws(() => localRequestURL(url, "http://127.0.0.1:3000"));
});
