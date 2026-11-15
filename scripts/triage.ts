/**
 * Manifest of everything sitting in brain/raw waiting to be ingested.
 *
 * INGEST reads this first so it can decide what deserves pages *before* it
 * starts reading whole transcripts — and so anything it can't confidently
 * classify gets batched into one question instead of a guess. See
 * AGENTS.md > INGEST step 0.
 *
 * This only computes deterministic signals (duration, tags, word count, which
 * speakers match existing entity pages). Whether a conversation is actually
 * idea-bearing is a judgement call left to the ingest itself.
 *
 *   npm run triage           # human-readable table
 *   npm run triage -- --json # for the agent
 */

import { parseArgs } from "node:util";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { VAULT_DIR, RAW_DIR, allRawDirs } from "./lib.ts";

const ENTITIES_DIR = join(VAULT_DIR, "wiki", "entities");

/** Suggestion, not a verdict. `ask` means the ingest must check with the owner. */
type Suggestion = "ingest" | "ingest-restricted" | "log-only" | "ask";

interface Item {
  file: string;
  title: string;
  date: string;
  source: string;
  medium: string;
  capture: string;
  disposition: string;
  tags: string;
  durationSeconds: number | null;
  words: number;
  wordsPerMinute: number | null;
  summary: string;
  people: string[];
  knownEntities: string[];
  suggestion: Suggestion;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

interface Entity { name: string; isPerson: boolean }

function entityNames(): Entity[] {
  if (!existsSync(ENTITIES_DIR)) return [];
  return readdirSync(ENTITIES_DIR)
    .filter((n) => n.endsWith(".md"))
    .map((n) => ({
      name: n.slice(0, -3),
      isPerson: readFileSync(join(ENTITIES_DIR, n), "utf8")
        .slice(0, 200)
        .includes("type: person"),
    }));
}

function splitFrontmatter(text: string): [Record<string, string>, string] {
  if (!text.startsWith("---")) return [{}, text];
  const end = text.indexOf("\n---", 3);
  if (end === -1) return [{}, text];
  const front: Record<string, string> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    front[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
  }
  return [front, text.slice(end + 4)];
}

/** Speaker labels used in the body, e.g. `**Ada Lovelace:**`. */
function speakersInBody(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/^\*\*([^*:]+):\*\*/gm)) found.add(m[1]!.trim());
  return [...found];
}

function matchEntities(names: string[], entities: string[]): string[] {
  const hits = new Set<string>();
  for (const raw of names) {
    const name = raw.toLowerCase().trim();
    if (!name || name === "unknown" || /^speaker [a-z]$|^microphone$|^speaker$/i.test(name)) continue;
    for (const entity of entities) {
      const e = entity.toLowerCase();
      // "Ada" matches "Ada Lovelace"; the owner's own name matches nothing useful.
      if (e === name || e.startsWith(`${name} `) || name.startsWith(`${e} `)) hits.add(entity);
    }
  }
  return [...hits];
}

/**
 * Pocket has no speaker diarization, so attendee lists are empty and the only
 * evidence of who was in the room is who gets *named* in it. Scan the text for
 * entity names instead. Noisy by design — it's a signal, not a verdict.
 */
// Words that are also names, or names that are also words. Only relevant for
// the first-name fallback, which is why it's short.
const AMBIGUOUS = new Set([
  "mike", "will", "mark", "grace", "rich", "art", "dawn", "done", "ann", "hope", "may", "bill", "pat",
  // Your own first name is in nearly every transcript; without this it can
  // match someone else who shares it and mark everything as a known contact.
  // Set FLUX_OWNER in .env. Add more with FLUX_AMBIGUOUS=name,name.
  ...[process.env.FLUX_OWNER ?? "", ...(process.env.FLUX_AMBIGUOUS ?? "").split(",")]
    .map((n) => n.trim().toLowerCase().split(/\s+/)[0] ?? "")
    .filter(Boolean),
]);

function namesMentioned(text: string, entities: Entity[]): string[] {
  const haystack = text.slice(0, 40_000).toLowerCase();
  const hits = new Set<string>();
  for (const { name, isPerson } of entities) {
    const lower = name.toLowerCase();
    if (lower.length < 4 || AMBIGUOUS.has(lower)) continue;
    // Full name always. First name only for people — otherwise
    // "Really Great Reading" matches every transcript containing "really".
    const candidates = [lower];
    const firstWord = lower.split(" ")[0]!;
    if (isPerson && firstWord !== lower && firstWord.length >= 4 && !AMBIGUOUS.has(firstWord)) {
      candidates.push(firstWord);
    }
    for (const candidate of candidates) {
      const re = new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (re.test(haystack)) {
        hits.add(name);
        break;
      }
    }
  }
  return [...hits];
}

/** Does this look like a room of other people rather than my own conversation? */
const ROOM_PATTERN =
  /\b(training|workshop|cohort|facilitat\w*|orientation|icebreaker|session|teach-?back|jamat\w*|onsite|breakout|evaluator)\b/i;

function looksLikeARoom(item: { title: string; summary: string }): boolean {
  return ROOM_PATTERN.test(item.title) || ROOM_PATTERN.test(item.summary);
}

function classify(item: Omit<Item, "suggestion" | "confidence" | "reasons">): {
  suggestion: Suggestion;
  confidence: Item["confidence"];
  reasons: string[];
} {
  const reasons: string[] = [];
  const short =
    (item.durationSeconds !== null && item.durationSeconds > 0 && item.durationSeconds < 120) ||
    item.words < 300;
  if (short) reasons.push(`short (${item.words} words${item.durationSeconds ? `, ${item.durationSeconds}s` : ""})`);

  // Duration alone is a bad signal for a wearable: a mic left running on a
  // flight is five hours long and says nothing. Real conversation runs
  // ~100-150 words/min; ambient capture runs far below that.
  if (item.wordsPerMinute !== null && item.wordsPerMinute < 40 && (item.durationSeconds ?? 0) > 600) {
    reasons.push(`${item.wordsPerMinute} words/min over ${Math.round((item.durationSeconds ?? 0) / 60)}min — likely ambient, mic left running`);
    return { suggestion: "ask", confidence: "low", reasons };
  }
  if (item.knownEntities.length) reasons.push(`known: ${item.knownEntities.slice(0, 4).join(", ")}`);
  else reasons.push("no known entities in speakers/attendees");
  if (item.tags) reasons.push(`tagged: ${item.tags}`);

  if (item.capture === "observed") {
    reasons.push("observed capture — restricted rules, no per-person assessments");
    return { suggestion: "ingest-restricted", confidence: "medium", reasons };
  }
  if (short) {
    reasons.push(item.disposition === "triage" ? "sync flagged disposition: triage" : "");
    return {
      suggestion: item.words < 60 ? "ask" : "log-only",
      confidence: item.words < 60 ? "low" : "medium",
      reasons: reasons.filter(Boolean),
    };
  }
  // A room of other people that isn't tagged as one. This is the case worth
  // interrupting for: the restricted rules only fire if capture says observed.
  if (item.source === "pocket" && looksLikeARoom(item)) {
    reasons.push("reads like a room of other people but capture: self — should this be observed?");
    return { suggestion: "ask", confidence: "low", reasons };
  }
  if (item.knownEntities.length === 0 && item.source === "pocket") {
    reasons.push("nobody recognised in the transcript");
    return { suggestion: "ask", confidence: "low", reasons };
  }
  return { suggestion: "ingest", confidence: "high", reasons };
}

function build(): Item[] {
  if (!existsSync(RAW_DIR)) return [];
  const entities = entityNames();
  const items: Item[] = [];
  // Pending only — anything under processed/ has already been ingested,
  // and observed-archive/ holds already-ingested observed captures.
  const pending = allRawDirs()
    .filter((d) => !d.endsWith("processed") && !d.endsWith("observed-archive"))
    .flatMap((dir) => readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => join(dir, n)))
    .sort();
  for (const file of pending) {
    const name = basename(file);
    const [front, body] = splitFrontmatter(readFileSync(file, "utf8"));
    const people = [
      ...(front["attendees"] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      ...speakersInBody(body),
    ];
    const duration = front["duration_seconds"] ? Number(front["duration_seconds"]) : null;
    const words = body.split(/\s+/).filter(Boolean).length;
    const base = {
      file: basename(name),
      title: front["title"] ?? name,
      date: (front["date"] ?? "").slice(0, 10),
      source: front["source"] ?? "granola",
      medium: front["medium"] ?? "call",
      capture: front["capture"] ?? "self",
      disposition: front["disposition"] ?? "ingest",
      tags: front["tags"] ?? "",
      durationSeconds: Number.isFinite(duration) ? duration : null,
      words,
      wordsPerMinute:
        duration && Number.isFinite(duration) && duration > 60
          ? Math.round(words / (duration / 60))
          : null,
      summary: front["pocket_summary"] ?? "",
      people: [...new Set(people)],
      knownEntities: [
        ...new Set([
          ...matchEntities([...new Set(people)], entities.map((e) => e.name)),
          ...namesMentioned(`${front["title"] ?? ""} ${body}`, entities),
        ]),
      ],
    };
    items.push({ ...base, ...classify(base) });
  }
  return items;
}

function main() {
  const { values } = parseArgs({ options: { json: { type: "boolean", default: false } } });
  const items = build();

  if (values.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("brain/raw is empty — nothing to ingest.");
    return;
  }

  const order: Suggestion[] = ["ask", "ingest-restricted", "log-only", "ingest"];
  console.log(`${items.length} file(s) awaiting ingest:\n`);
  for (const suggestion of order) {
    const group = items.filter((i) => i.suggestion === suggestion);
    if (!group.length) continue;
    console.log(`── ${suggestion.toUpperCase()} (${group.length})`);
    for (const item of group) {
      console.log(`   ${item.date}  ${item.title}`);
      console.log(`   ${item.file}`);
      console.log(
        `   ${item.source}/${item.medium}, capture: ${item.capture}, ${item.words} words` +
          (item.durationSeconds ? `, ${Math.round(item.durationSeconds / 60)}min` : "") +
          (item.wordsPerMinute !== null ? `, ${item.wordsPerMinute} wpm` : ""),
      );
      if (item.summary) console.log(`   “${item.summary.slice(0, 120)}”`);
      console.log(`   ${item.reasons.join(" · ")}\n`);
    }
  }
  const asking = items.filter((i) => i.suggestion === "ask").length;
  console.log(
    asking
      ? `${asking} need a decision from you before ingest writes anything.`
      : "Nothing ambiguous — ingest can proceed without asking.",
  );
}

main();
