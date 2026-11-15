/**
 * Set up an empty vault. Copies template/brain to brain/ (or FLUX_VAULT) if it
 * isn't there yet, and never overwrites anything that exists.
 *
 *   npm run init
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, VAULT_DIR, relative } from "./lib.ts";

const TEMPLATE = join(REPO_ROOT, "template", "brain");

if (existsSync(VAULT_DIR) && readdirSync(VAULT_DIR).length > 0) {
  console.log(`${relative(VAULT_DIR)}/ already exists. Leaving it alone.`);
} else {
  cpSync(TEMPLATE, VAULT_DIR, { recursive: true });
  console.log(`Created ${relative(VAULT_DIR)}/ with an empty wiki, index, log and TODO.`);
}

if (!existsSync(join(REPO_ROOT, ".env"))) {
  cpSync(join(REPO_ROOT, ".env.example"), join(REPO_ROOT, ".env"));
  console.log("Created .env from .env.example. Add your Granola key there.");
}

const hasQmd = spawnSync("qmd", ["--version"], { stdio: "ignore" }).status === 0;
if (!hasQmd)
  console.log("Search: qmd isn't installed yet. For fast answers, run: npm install -g @tobilu/qmd");

console.log(`
Next:
  1. Put your Granola API key in .env
  2. Tell the system who you are in ${relative(VAULT_DIR)}/CONTEXT.md
  3. npm run sync:granola
  4. Open this folder in Claude Code and say: ingest
`);
