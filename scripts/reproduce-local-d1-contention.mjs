// Diagnostic, not a passing-test assertion: --multiple-owners exercises the old
// unsafe topology. It may or may not hit SQLITE_BUSY on a particular machine.
// Default uses one owner for both callers; all data is disposable in /tmp.
import { getPlatformProxy } from "wrangler";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const path = await mkdtemp(join(tmpdir(), "shisui-busy-"));
const options = { configPath: "wrangler.jsonc", persist: { path }, remoteBindings: false };
let owner, writes, stop = false, attempted = 0, failed = 0;
try {
  owner = await getPlatformProxy(options);
  await owner.env.DB.prepare("CREATE TABLE probe (id INTEGER PRIMARY KEY,n INTEGER NOT NULL)").run();
  await owner.env.DB.prepare("INSERT INTO probe VALUES(1,0)").run();
  writes = (async () => {
    while (!stop) {
      attempted++;
      try { await owner.env.DB.prepare("UPDATE probe SET n=n+1 WHERE id=1").run(); }
      catch { failed++; }
    }
  })();
  for (let round = 0; round < 40; round++) {
    const helper = process.argv.includes("--multiple-owners")
      ? await getPlatformProxy(options) : owner;
    try { await helper.env.DB.prepare("SELECT n FROM probe").first(); }
    catch { failed++; }
    finally { if (helper !== owner) await helper.dispose(); }
  }
  stop = true;
  await writes;
  console.log(JSON.stringify({
    rounds: 40, attempted, failed,
    saved: await owner.env.DB.prepare("SELECT n FROM probe").first("n"),
  }));
} finally {
  stop = true;
  await writes;
  await owner?.dispose();
  await rm(path, { recursive: true, force: true });
}
