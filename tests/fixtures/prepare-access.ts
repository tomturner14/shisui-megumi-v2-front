import { prepareAccessFixture } from "./access-fixture";
prepareAccessFixture().catch(() => {
  console.error("Could not create ephemeral local test keys");
  process.exitCode = 1;
});
