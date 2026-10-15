// Generates a test-only entry beside the existing built chunks. The normal
// dist/server/wrangler.json and index.js are untouched and never import it.
import { readFile, writeFile } from "node:fs/promises";
import {
  prepareAccessFixture,
  fixturePath,
  issuer,
  audience,
  subject,
} from "./access-fixture";
async function prepare() {
  await prepareAccessFixture();
  const { keys } = JSON.parse(await readFile(fixturePath, "utf8"));
  const config = JSON.parse(
    await readFile("dist/server/wrangler.json", "utf8"),
  );
  config.main = "test-only-access.mjs";
  config.vars = {
    ...config.vars,
    ACCESS_ISSUER: issuer,
    ACCESS_AUD: audience,
    ADMIN_SUBJECTS: subject,
    ADMIN_ORIGIN: "http://127.0.0.1:3000",
  };
  config.workers_dev = false;
  config.preview_urls = false;
  await writeFile(
    "dist/server/test-only-fetch.mjs",
    `// TEST ONLY. Never deploy this entry.\nconst keys=${JSON.stringify(keys)};\nconst originalFetch=globalThis.fetch;\nglobalThis.fetch=(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url; if(url==='${issuer}/cdn-cgi/access/certs')return Promise.resolve(Response.json({keys})); return originalFetch(input,init);};\n`,
  );
  // Install the fixture before vinext captures its original fetch implementation.
  await writeFile(
    "dist/server/test-only-access.mjs",
    "import './test-only-fetch.mjs';\nexport { default } from './index.js';\n",
  );
  await writeFile(
    "dist/server/test-only-wrangler.json",
    JSON.stringify(config),
  );
}
prepare().catch(() => {
  console.error("Could not prepare signed local Worker fixture");
  process.exitCode = 1;
});
