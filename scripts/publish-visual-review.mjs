// Public export is opt-in, after inspecting every image. No trace/HAR/DB/profile export.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
// Reuse the image processor already installed by Next.js; no extra image package.
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
if (!process.argv.includes("--reviewed-fixtures"))
  throw new Error(
    "Inspect every screenshot and verify fictional data before public export",
  );
const source = ".wrangler/visual-review",
  target = "docs/visual-review";
const rows = JSON.parse(await readFile(`${source}/manifest.json`, "utf8"));
if (rows.length !== 19 || new Set(rows.map((r) => r.file)).size !== 19)
  throw new Error("Expected exactly 19 uniquely named reviewed screenshots");
await mkdir(target, { recursive: true });
const exported = [];
for (const row of rows) {
  if (
    !/^(0[1-9]|1[0-9])-[a-z-]+\.png$/.test(row.file) ||
    !row.path.startsWith("/") ||
    row.path.includes("?") ||
    ![390, 1280].includes(row.width)
  )
    throw new Error("Unexpected screenshot metadata");
  const file = row.file.replace(/\.png$/, ".webp");
  await sharp(`${source}/${row.file}`)
    .webp({ quality: 80, effort: 6 })
    .toFile(`${target}/${file}`);
  const buffer = await readFile(`${target}/${file}`);
  const metadata = await sharp(buffer).metadata();
  exported.push({
    file,
    path: row.path,
    state: row.state,
    width: row.width,
    viewportHeight: row.height,
    pixelHeight: metadata.height,
    fixture: row.fixture,
    runtime: row.runtime,
    capturedAt: row.capturedAt,
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  });
}
const totalBytes = exported.reduce((sum, r) => sum + r.bytes, 0);
if (totalBytes > 2 * 1024 * 1024)
  throw new Error(
    "Public screenshots exceed 2 MiB; review image size before committing",
  );
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
await writeFile(
  `${target}/manifest.json`,
  JSON.stringify({ sourceSha, totalBytes, images: exported }, null, 2) + "\n",
);
console.log(JSON.stringify({ images: exported.length, totalBytes }));
