// Local bare-repository rehearsal ONLY. Never updates a real branch, remote or worktree.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const git = (args, repo = process.cwd()) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const refs = process.argv.slice(2);
if (refs.length !== 4)
  throw new Error("Pass verified main, PR1, PR2 and PR3 SHAs (four arguments)");
const tips = refs.map((ref) => git(["rev-parse", `${ref}^{commit}`]));
for (let i = 1; i < tips.length; i++)
  git(["merge-base", "--is-ancestor", tips[i - 1], tips[i]]);
const path = await mkdtemp(join(tmpdir(), "shisui-stack-rehearsal-"));
try {
  const repo = join(path, "rehearsal.git");
  execFileSync(
    "git",
    ["clone", "--quiet", "--bare", "--shared", process.cwd(), repo],
    { stdio: "pipe" },
  );
  let current = tips[0];
  const steps = [];
  for (let i = 1; i < tips.length; i++) {
    const tree = git(
      ["merge-tree", "--write-tree", current, tips[i]],
      repo,
    ).split("\n")[0];
    const expectedTree = git(["rev-parse", `${tips[i]}^{tree}`], repo);
    if (tree !== expectedTree) throw new Error(`Unexpected tree for PR ${i}`);
    current = git(
      [
        "-c",
        "user.name=Local Stack Rehearsal",
        "-c",
        "user.email=stack-rehearsal@example.invalid",
        "commit-tree",
        tree,
        "-p",
        current,
        "-p",
        tips[i],
        "-m",
        `LOCAL REHEARSAL ONLY PR ${i}`,
      ],
      repo,
    );
    const exclusiveCommits = Number(
      git(["rev-list", "--count", `${tips[i - 1]}..${tips[i]}`], repo),
    );
    steps.push({
      pr: i,
      head: tips[i],
      exclusiveCommits,
      conflicts: false,
      treeMatchesHead: true,
    });
  }
  console.log(
    JSON.stringify(
      {
        main: tips[0],
        steps,
        finalTreeMatchesPR3: true,
        remoteMutations: false,
        realBranchMutations: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(path, { recursive: true, force: true });
}
