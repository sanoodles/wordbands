#!/usr/bin/env node
// Proves the vendored Fondue skill is where both the CLI and the agent expect it.
//
// `skills update` exits 0 whether it refreshed the skill or never found it, so the
// workflow runs this either side of it. Everything it reads is committed, so it is also
// the check a fresh clone needs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "frontify/fondue";

try {
  const { skills } = JSON.parse(readFileSync(join(ROOT, "skills-lock.json"), "utf8"));
  const source = skills?.fondue?.source;
  if (source !== SOURCE) throw new Error(`skills-lock.json names ${source ?? "no fondue entry"}, not ${SOURCE}`);

  // Read through .claude/skills/ rather than .agents/: that is the path an agent uses, so
  // it is also the one that fails on a clone which wrote the symlink as text.
  const skill = readFileSync(join(ROOT, ".claude", "skills", "fondue", "SKILL.md"), "utf8");
  const version = skill.match(/@frontify\/fondue@([^`]+)/)?.[1] ?? "an unstated version";

  console.log(`fondue: ${SOURCE}, readable through .claude/skills/, authored against ${version}`);
} catch (err) {
  console.error(`fondue skill: ${err.message}`);
  console.error(`Reinstall with \`pnpm exec skills add ${SOURCE}/packages/sdk\`.`);
  process.exit(1);
}
