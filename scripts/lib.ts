/** Shared helpers for the transcript sync scripts. No runtime dependencies. */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPTS_DIR, "..");
// Load FLUX_* settings from .env so they work without exporting anything.
// (API keys are read from the same file by loadAccounts.)
{
  const envPath = join(REPO_ROOT, ".env");
  if (existsSync(envPath))
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = /^\s*(FLUX_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
}

/**
 * The vault: your private data. Kept in its own folder (and its own git repo)
 * so the engine can be public while the notes are not. Override with FLUX_VAULT.
 */
export const VAULT_DIR = resolve(REPO_ROOT, process.env.FLUX_VAULT || "brain");
export const RAW_DIR = join(VAULT_DIR, "raw");
/** Sync cursors live with the data they describe, not with the engine. */
export const STATE_DIR = join(VAULT_DIR, ".state");

/**
 * Each source gets its own tree: brain/raw/<source>/ for pending,
 * brain/raw/<source>/processed/ for ingested. Granola produces a few curated
 * transcripts a week; a wearable produces dozens a day, and mixing them makes
 * both harder to see.
 */
export function sourceDir(source: string): string {
  return join(RAW_DIR, source);
}

/** Every directory holding raw transcripts, pending and processed. */
export function allRawDirs(): string[] {
  if (!existsSync(RAW_DIR)) return [];
  const dirs = [RAW_DIR];
  for (const name of readdirSync(RAW_DIR, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const dir = join(RAW_DIR, name.name);
    dirs.push(dir);
    const processed = join(dir, "processed");
    if (existsSync(processed)) dirs.push(processed);
  }
  return dirs;
}

export const REQUEST_GAP_MS = 250; // stay under 5 req/s sustained

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read `<PREFIX><LABEL>=value` lines out of .env. The label after the prefix
 * becomes the account name recorded on every synced file.
 */
export function loadAccounts(prefix: string, example: string): Map<string, string> {
  const envPath = join(REPO_ROOT, ".env");
  if (!existsSync(envPath)) {
    fail(`No .env file at repo root. Add lines like ${example}`);
  }
  const accounts = new Map<string, string>();
  for (const raw of readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!key.startsWith(prefix) || !value) continue;
    // GRANOLA_KEY_PERSONAL and GRANOLA_PERSONAL both mean "personal".
    const label = key.slice(prefix.length).replace(/^KEY_/, "").toLowerCase();
    accounts.set(label || "default", value);
  }
  if (accounts.size === 0) fail(`No ${prefix}* entries found in .env (format: ${example})`);
  return accounts;
}

export interface AccountState {
  seen_ids?: string[];
  last_sync?: string;
}
export interface SyncState {
  accounts: Record<string, AccountState>;
  fingerprints?: string[];
}

export function loadState(file: string): SyncState {
  if (!existsSync(file)) return { accounts: {}, fingerprints: [] };
  return JSON.parse(readFileSync(file, "utf8")) as SyncState;
}

export function saveState(file: string, state: SyncState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/** Parse the leading `key: value` lines of a raw transcript's frontmatter. */
export function readFrontmatter(path: string, lines = 14): Record<string, string> {
  const front: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n").slice(0, lines)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    front[line.slice(0, idx).trim()] = line
      .slice(idx + 1)
      .trim()
      .replace(/^"|"$/g, "");
  }
  return front;
}

/**
 * Recover seen ids from files already on disk, so an interrupted run never
 * re-downloads what's already there. `idField` is granola_id or pocket_id.
 */
export function rebuildFromDisk(
  state: SyncState,
  idField: string,
  onFile?: (front: Record<string, string>) => void,
): void {
  for (const folder of allRawDirs()) {
    for (const name of readdirSync(folder)) {
      if (!name.endsWith(".md")) continue;
      const front = readFrontmatter(join(folder, name));
      onFile?.(front);
      const id = front[idField];
      const account = front["account"];
      if (!id || !account) continue;
      const acct = (state.accounts[account] ??= {});
      acct.seen_ids ??= [];
      if (!acct.seen_ids.includes(id)) acct.seen_ids.push(id);
    }
  }
}

/** GET with retry on 429/5xx. Returns null on 404. */
export async function apiGet<T = unknown>(
  url: string,
  token: string,
  params?: Record<string, string | number | boolean>,
): Promise<T | null> {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params ?? {})) {
    target.searchParams.set(key, String(value));
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(target, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status === 404) return null;
    if (resp.status === 429 || resp.status >= 500) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText} on ${target.pathname}`);
    return (await resp.json()) as T;
  }
  throw new Error(`Too many retries (429/5xx) on ${target.pathname}`);
}

/** Pick the first present value among candidate key names. */
export function first<T = string>(
  obj: unknown,
  keys: readonly string[],
  fallback: T,
): T {
  if (obj && typeof obj === "object") {
    for (const key of keys) {
      const value = (obj as Record<string, unknown>)[key];
      if (value !== undefined && value !== null && value !== "") return value as T;
    }
  }
  return fallback;
}

export interface Segment {
  speaker?: unknown;
  text?: string;
  [key: string]: unknown;
}

/** Merge consecutive same-speaker segments into readable turns. */
export function renderTranscript(
  segments: unknown[],
  label: (seg: Segment) => string,
  text: (seg: Segment) => string,
): string {
  const turns: Array<[string, string[]]> = [];
  for (const raw of segments ?? []) {
    const seg = (typeof raw === "string" ? { text: raw } : raw) as Segment;
    const who = label(seg);
    const what = text(seg).trim();
    if (!what) continue;
    const last = turns.at(-1);
    if (last && last[0] === who) last[1].push(what);
    else turns.push([who, [what]]);
  }
  return turns.map(([who, parts]) => `**${who}:** ${parts.join(" ")}`).join("\n\n");
}

export function slugify(title: string | undefined): string {
  const slug = (title ?? "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.slice(0, 60) || "untitled";
}

/** Pick a filename that doesn't collide with a *different* recording. */
export function uniquePath(base: string, idLine: string, source: string): string {
  const dir = sourceDir(source);
  mkdirSync(dir, { recursive: true });
  let path = join(dir, `${base}.md`);
  let n = 2;
  while (existsSync(path) && !readFileSync(path, "utf8").includes(idLine)) {
    path = join(dir, `${base}-${n}.md`);
    n++;
  }
  return path;
}

export function relative(path: string): string {
  return path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1) : path;
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
