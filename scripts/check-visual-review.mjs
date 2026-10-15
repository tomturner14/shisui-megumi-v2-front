// Integrity/allowlist guard only. Pixel-level privacy still requires manual review.
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const path = "docs/visual-review",
  manifest = JSON.parse(await readFile(`${path}/manifest.json`, "utf8"));
assert.match(manifest.sourceSha, /^[0-9a-f]{40}$/);
assert.equal(manifest.images.length, 19);
const expected = [
  "README.md",
  "manifest.json",
  ...manifest.images.map((i) => i.file),
].sort();
assert.deepEqual(
  (await readdir(path)).sort(),
  expected,
  "Only reviewed images and public documentation may be published",
);
let bytes = 0;
for (const row of manifest.images) {
  assert.match(row.file, /^(0[1-9]|1[0-9])-[a-z-]+\.webp$/);
  const buffer = await readFile(`${path}/${row.file}`);
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WEBP");
  assert.equal(createHash("sha256").update(buffer).digest("hex"), row.sha256);
  assert.equal(buffer.length, row.bytes);
  assert.ok([390, 1280].includes(row.width));
  bytes += buffer.length;
}
assert.equal(bytes, manifest.totalBytes);
assert.ok(bytes <= 2 * 1024 * 1024);
console.log(
  JSON.stringify({
    reviewedImages: manifest.images.length,
    bytes,
    integrity: "passed",
    manualPrivacyReviewRequired: true,
  }),
);
