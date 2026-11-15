/**
 * Add queryable date, source and venture frontmatter to wiki idea pages.
 *
 * Every idea page ends with a prose footer like:
 *
 *   Sources: "Weekly sync" (2026-07-21); "Design review" (2026-07-22). Granola transcripts.
 *
 * which is good attribution and useless for querying. This lifts the dates out
 * of that footer into frontmatter so "everything since July 1" or "everything
 * from Pocket" is a real query instead of a regex over prose. The footer is left
 * exactly as it is — it remains the human-readable attribution.
 *
 * Idempotent: re-run it after any ingest to pick up new and evolved pages.
 *
 *   npm run backfill            # dry run, prints a report
 *   npm run backfill -- --apply
 */

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative as relativeTo } from "node:path";
import { VAULT_DIR } from "./lib.ts";

const WIKI = join(VAULT_DIR, "wiki");
const FOOTER = /^Sources?:(.+)$/m;
const PAREN = /\(([^)]*)\)/g;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
const QUOTED = /"([^"]+)"/g;

type Fields = Record<string, string>;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

function mediaOf(footer: string): string[] {
  // Match the medium phrase, not the word anywhere — a recording titled
  // "Granola voice call on data model" is a Pocket recording.
  const low = footer.toLowerCase();
  const media: string[] = [];
  if (/granola transcript/.test(low)) media.push("granola");
  if (/pocket recording/.test(low)) media.push("pocket");
  if (/teams transcript/.test(low)) media.push("teams");
  if (/\bdocument\b|\bpdf\b/.test(low)) media.push("document");
  if (/\bvideo\b|youtube/.test(low)) media.push("video");
  if (/told directly|\btext from\b|imessage/.test(low)) media.push("direct");
  return media.length ? media : ["unknown"];
}

const LINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
const linksIn = (text: string): string[] => [...text.matchAll(LINK)].map((m) => m[1]!.trim());
const titleOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");

/**
 * Which of the owner's ventures each idea page belongs to. A page belongs to
 * a venture when the venture's entity page links to it, or when it links to
 * the venture itself. Written to frontmatter as `ventures:` so a search can
 * be narrowed to one project, and so another project's agent can be handed
 * only its own pages.
 */
function ventureMap(paths: string[]): { names: Set<string>; byIdea: Map<string, Set<string>> } {
  const names = new Set<string>();
  const byIdea = new Map<string, Set<string>>();
  for (const path of paths) {
    if (!path.includes("/entities/")) continue;
    const text = readFileSync(path, "utf8");
    if (!/^type:\s*venture\s*$/m.test(text.slice(0, 300))) continue;
    const venture = titleOf(path);
    names.add(venture);
    for (const linked of linksIn(text)) {
      if (!byIdea.has(linked)) byIdea.set(linked, new Set());
      byIdea.get(linked)!.add(venture);
    }
  }
  return { names, byIdea };
}

function parse(path: string, ventures: ReturnType<typeof ventureMap>): { front: string; body: string; fields: Fields; text: string } | null {
  const text = readFileSync(path, "utf8");
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("---", 3);
  if (end === -1) return null;
  const front = text.slice(3, end).trim();
  const body = text.slice(end + 3);
  if (!front.includes("type: idea")) return null;

  const match = FOOTER.exec(body);
  if (!match?.[1]) return null;
  const footer = match[1];
  const dates = [...new Set([...footer.matchAll(PAREN)].flatMap((m) => [...m[1]!.matchAll(ISO_DATE)].map((d) => d[0])))].sort();
  if (dates.length === 0) return null;

  const titles = [...footer.matchAll(QUOTED)].length;
  // If the footer names a medium we don't recognise, keep whatever the page
  // already says rather than overwriting it with "unknown".
  const detected = mediaOf(footer);
  const existing = /^media:\s*(.+)$/m.exec(front)?.[1]?.trim();
  const media = detected[0] === "unknown" && existing && existing !== "unknown" ? existing : detected.join(", ");

  const mine = new Set(ventures.byIdea.get(titleOf(path)) ?? []);
  for (const linked of linksIn(body)) if (ventures.names.has(linked)) mine.add(linked);

  return {
    front,
    body,
    text,
    fields: {
      first_seen: dates[0]!,
      last_seen: dates.at(-1)!,
      sources: String(Math.max(titles, dates.length)),
      media,
      ventures: [...mine].sort().join(", "),
    },
  };
}

/** Replace managed keys in place, keep everything else, append what's new. */
function render(front: string, fields: Fields): string {
  const managed = new Set(Object.keys(fields));
  const kept = front.split("\n").filter((line) => {
    const key = line.split(":")[0]?.trim();
    return !key || !managed.has(key);
  });
  // An empty value means "remove this key": a page that no longer belongs to
  // any venture shouldn't keep a stale one.
  const entries = Object.entries(fields).filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${v}`);
  return [...kept, ...entries].join("\n");
}

function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });

  const changed: Array<[string, Fields]> = [];
  const skipped: string[] = [];

  const all = walk(WIKI).sort();
  const ventures = ventureMap(all);
  for (const path of all) {
    const parsed = parse(path, ventures);
    if (!parsed) {
      if (!path.includes(`${"entities"}/`)) skipped.push(path);
      continue;
    }
    const next = `---\n${render(parsed.front, parsed.fields)}\n---${parsed.body}`;
    if (next !== parsed.text) {
      changed.push([path, parsed.fields]);
      if (values.apply) writeFileSync(path, next);
    }
  }

  console.log(`${values.apply ? "updated" : "would update"} ${changed.length} idea page(s)`);
  for (const [path, fields] of changed.slice(0, 5)) {
    console.log(`  ${relativeTo(WIKI, path)}: ${JSON.stringify(fields)}`);
  }
  if (changed.length > 5) console.log(`  ... and ${changed.length - 5} more`);

  if (skipped.length) {
    console.log(`\n${skipped.length} page(s) skipped (no parseable ISO date in footer):`);
    for (const path of skipped.slice(0, 12)) console.log(`  ${relativeTo(WIKI, path)}`);
    if (skipped.length > 12) console.log(`  ... and ${skipped.length - 12} more`);
  }
  if (!values.apply && changed.length) console.log("\nDry run. Re-run with --apply to write.");
}

main();
