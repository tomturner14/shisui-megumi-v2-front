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
  const signed = process.env.E2E_ADMIN_AUTH === "1";
  if (signed) await prepareAccessFixture();
  const { keys } = signed
    ? JSON.parse(await readFile(fixturePath, "utf8"))
    : { keys: [] };
  const token = await readFile(".wrangler/e2e-db-token", "utf8");
  const config = JSON.parse(
    await readFile("dist/server/wrangler.json", "utf8"),
  );
  config.main = "test-only-access.mjs";
  if (signed) config.vars = {
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
  await writeFile(
    "dist/server/test-only-d1.mjs",
    await readFile("tests/fixtures/d1-rpc.mjs", "utf8"),
  );
  // Install the fixture before vinext captures its original fetch implementation.
  await writeFile(
    "dist/server/test-only-access.mjs",
    `${signed ? "import './test-only-fetch.mjs';" : ""}
import app from './index.js';
import { dispatchD1 } from './test-only-d1.mjs';
const token=${JSON.stringify(token)};
export default {
  ...app,
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if(url.pathname==='/__test/d1') {
      if(url.origin!=='http://127.0.0.1:3000' || request.method!=='POST' ||
         request.headers.get('Authorization')!==\`Bearer \${token}\` || request.headers.has('Origin'))
        return new Response(null,{status:403,headers:{'Cache-Control':'no-store'}});
      try {
        const body=await request.text();
        if(body.length>65536) throw new Error('Test payload too large');
        return Response.json(await dispatchD1(env.DB,JSON.parse(body)),{headers:{'Cache-Control':'no-store'}});
      } catch { return new Response('Test D1 operation failed',{status:500,headers:{'Cache-Control':'no-store'}}); }
    }
    return app.fetch(request,env,ctx);
  }
};
`,
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
