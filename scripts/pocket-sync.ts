/**
 * Sync Pocket (heypocket.com) recordings into brain/raw/ for ingestion.
 *
 * Companion to granola-sync. Granola captures calls I'm on; Pocket captures the
 * room I'm standing in — which means some recordings are conversations I
 * *observed* rather than participated in. That distinction is set here, at the
 * sensor, and written into the frontmatter as `capture:` so INGEST can branch on
 * it. Tag a recording in Pocket (default: observed / training) and it
 * lands as capture: observed.
 *
 *   npm run sync:pocket
 *   npm run sync:pocket -- --probe                 # dump raw payloads, write nothing
 *   npm run sync:pocket -- --since 2026-07-01
 *   npm run sync:pocket -- --observed-tag cohort-c
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  apiGet, fail, first, loadAccounts, loadState, rebuildFromDisk, relative,
  renderTranscript, REQUEST_GAP_MS, saveState, STATE_DIR, sleep, slugify, uniquePath,
  type SyncState,
} from "./lib.ts";

const API_BASE = "https://public.heypocketai.com/api/v1";
const STATE_FILE = join(STATE_DIR, "pocket.json");
// Add your own with FLUX_OBSERVED_TAGS=tag,tag in .env.
const DEFAULT_OBSERVED_TAGS = [
  "observed", "training",
  ...(process.env.FLUX_OBSERVED_TAGS ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
];
// Never sync these at all. A wearable hears everything; the cheapest filter is
// the one that runs before anything lands on disk.
const DEFAULT_SKIP_TAGS = ["private", "personal", "skip", "medical"];
const DEFAULT_MIN_SECONDS = 120;

// The public docs stub out response bodies, so field names are matched
// tolerantly against the shapes documented for the webhook payload.
const ID_KEYS = ["id", "recording_id", "recordingId", "uuid"] as const;
const TITLE_KEYS = ["title", "name", "display_title", "displayTitle"] as const;
// `recording_at` is when it was recorded; `created_at` is when it hit their
// servers (seconds to minutes later). Prefer the former.
const DATE_KEYS = ["recording_at", "recorded_at", "recordedAt", "created_at", "createdAt", "date"] as const;
const DURATION_KEYS = ["duration", "duration_seconds", "durationSeconds", "length"] as const;
const TRANSCRIPT_KEYS = ["transcript", "transcript_segments", "transcriptSegments", "segments"] as const;
const SPEAKER_KEYS = ["speaker", "speaker_name", "speakerName", "speaker_label", "speakerLabel"] as const;
const TEXT_KEYS = ["text", "content", "transcript"] as const;

type Json = Record<string, unknown>;
interface Envelope { data?: unknown; error?: string; success?: boolean; pagination?: { has_more?: boolean } }

/** Envelope is {data, error, pagination, success}; data may be a list or a
 *  dict wrapping one. */
function unwrap(body: Envelope | null): unknown {
  if (!body) return null;
  let data = body.data ?? (body as Json)["recordings"] ?? null;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const key of ["recordings", "items", "results", "recording"]) {
      if (key in (data as Json)) return (data as Json)[key];
    }
  }
  return data;
}

async function get(path: string, token: string, params?: Record<string, string | number>) {
  const body = await apiGet<Envelope>(`${API_BASE}${path}`, token, params);
  if (body && body.success === false) throw new Error(`${path}: ${body.error}`);
  return body;
}

/** Docs give the path as /public/recordings under a base already ending in
 *  /api/v1; fall back to /recordings if that 404s. */
async function listPage(token: string, params: Record<string, string | number>) {
  for (const path of ["/public/recordings", "/recordings"]) {
    const body = await get(path, token, params);
    if (body !== null) return { body, path };
  }
  return { body: null, path: null };
}

function tagNames(rec: Json): Set<string> {
  const tags = (rec["tags"] ?? rec["tag_names"] ?? []) as unknown[];
  const names = tags.map((t) =>
    typeof t === "object" && t ? String((t as Json)["name"] ?? "") : String(t),
  );
  return new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
}

/**
 * `self` = I'm a participant. `observed` = I'm recording other people — a
 * training room, a workshop, someone else's session. Decided by Pocket tag
 * because that's where I have the context; see AGENTS.md > Capture.
 */
function classifyCapture(rec: Json, observedTags: Set<string>): "self" | "observed" {
  for (const tag of tagNames(rec)) if (observedTags.has(tag)) return "observed";
  return "self";
}

/**
 * Granola only fires on scheduled calls, so everything it captured was worth
 * a page. Pocket hears hallway chat, car rides and small talk too. `disposition`
 * tells INGEST how much of the machinery to run — see AGENTS.md > TRIAGE FOR AMBIENT RECORDINGS.
 * Short recordings default to log-only rather than being dropped, because a
 * four-minute call can still be the one that moves a deal.
 */
function classifyDisposition(rec: Json, minSeconds: number): "ingest" | "triage" {
  const seconds = Number(first(rec, DURATION_KEYS, 0)) || 0;
  return seconds > 0 && seconds < minSeconds ? "triage" : "ingest";
}

/**
 * Pocket's own one-line summary. Cheap, high-value triage signal — a 5-hour
 * ambient recording summarises as "the conversation contained no words".
 */
function summaryOf(rec: Json): string {
  const summarizations = rec["summarizations"];
  if (!summarizations || typeof summarizations !== "object") return "";
  for (const entry of Object.values(summarizations as Json)) {
    const v2 = (entry as Json)?.["v2"] as Json | undefined;
    const summary = v2?.["summary"] as Json | undefined;
    const text = summary?.["summary"] ?? summary?.["markdown"];
    if (typeof text === "string" && text.trim()) return text.trim().replace(/\s+/g, " ");
  }
  return "";
}

function segmentsOf(rec: Json): unknown[] {
  let segments = first<unknown>(rec, TRANSCRIPT_KEYS, []);
  if (segments && typeof segments === "object" && !Array.isArray(segments)) {
    segments = first<unknown>(segments, ["segments", "turns", "items"], []);
  }
  return Array.isArray(segments) ? segments : [];
}

/**
 * Pocket segments are `{start, end, text}` with no speaker unless diarization
 * has labelled them. Without speakers there are no turns to merge, so render
 * flowing prose with a timestamp every couple of minutes — long recordings stay
 * navigable and a quote stays locatable in the audio.
 */
function renderTimestamped(segments: unknown[], everySeconds = 120): string {
  const blocks: string[] = [];
  let current: string[] = [];
  let blockStart: number | null = null;
  const stamp = (s: number) => {
    const total = Math.floor(s);
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const sec = String(total % 60).padStart(2, "0");
    return `${h}:${m}:${sec}`;
  };
  const flush = () => {
    if (current.length && blockStart !== null) {
      blocks.push(`**[${stamp(blockStart)}]** ${current.join(" ")}`);
    }
    current = [];
  };
  for (const raw of segments) {
    if (!raw || typeof raw !== "object") continue;
    const seg = raw as Json;
    const text = String(first(seg, TEXT_KEYS, "")).trim();
    if (!text) continue;
    const start = Number(seg["start"] ?? 0);
    if (blockStart === null || start - blockStart >= everySeconds) {
      flush();
      blockStart = start;
    }
    current.push(text);
  }
  flush();
  return blocks.join("\n\n");
}

function hasSpeakers(segments: unknown[]): boolean {
  return segments.some(
    (s) => s && typeof s === "object" && String(first(s, SPEAKER_KEYS, "")).trim() !== "",
  );
}

function speakersIn(segments: unknown[]): string[] {
  const names: string[] = [];
  for (const seg of segments) {
    if (!seg || typeof seg !== "object") continue;
    const name = String(first(seg, SPEAKER_KEYS, "")).trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function writeRecording(
  rec: Json,
  account: string,
  capture: "self" | "observed",
  disposition: "ingest" | "triage",
): string {
  const id = String(first(rec, ID_KEYS, ""));
  const date = String(first(rec, DATE_KEYS, ""));
  const title = String(first(rec, TITLE_KEYS, "Untitled"));
  const segments = segmentsOf(rec);
  const path = uniquePath(`${date.slice(0, 10) || "undated"}-${slugify(title)}`, `pocket_id: ${id}`, "pocket");

  const front = [
    "---",
    `pocket_id: ${id}`,
    `account: ${account}`,
    `title: ${JSON.stringify(title)}`,
    `date: ${date}`,
    "source: pocket",
    "medium: in-person",
    `capture: ${capture}`,
    `disposition: ${disposition}`,
    `speakers: ${JSON.stringify(speakersIn(segments).join(", "))}`,
    `tags: ${JSON.stringify([...tagNames(rec)].sort().join(", "))}`,
    `duration_seconds: ${first(rec, DURATION_KEYS, "")}`,
    `pocket_summary: ${JSON.stringify(summaryOf(rec).slice(0, 300))}`,
    "type: transcript",
    "---",
    "",
  ];
  const notes: string[] = [];
  if (capture === "observed") {
    notes.push(
      "> Captured in a room of other people. Per AGENTS.md > OBSERVED CAPTURES:",
      "> extract ideas and program-level status, attribute quotes to the speaker,",
      "> and do not write assessments of named individuals into the wiki.",
    );
  }
  if (disposition === "triage") {
    notes.push(
      "> Short recording. Per AGENTS.md > TRIAGE FOR AMBIENT RECORDINGS: decide page-worthy vs",
      "> log-only vs discard before extracting anything.",
    );
  }
  if (notes.length) front.splice(front.length - 1, 0, ...notes, "");
  const body = hasSpeakers(segments)
    ? renderTranscript(
        segments,
        (seg) => String(first(seg, SPEAKER_KEYS, "Unknown")).trim() || "Unknown",
        (seg) => String(first(seg, TEXT_KEYS, "")),
      )
    : renderTimestamped(segments);
  writeFileSync(path, `${front.join("\n")}${body}\n`);
  return path;
}

/** Print raw payloads so the field mapping can be verified against the live
 *  API — the public docs stub out response bodies. */
async function probe(accounts: Map<string, string>) {
  for (const [account, token] of accounts) {
    const { body, path } = await listPage(token, { page: 1, limit: 1 });
    console.log(`\n[${account}] list endpoint: ${API_BASE}${path}`);
    console.log(JSON.stringify(body, null, 2).slice(0, 1500));
    const items = unwrap(body);
    const one = (Array.isArray(items) ? items[0] : items) as Json | undefined;
    if (!one) continue;
    const detail = await get(`${path}/${String(first(one, ID_KEYS, ""))}`, token, {
      include_transcript: "true",
      include_summarizations: "true",
    });
    const data = unwrap(detail) as Json | null;
    console.log(`\n[${account}] detail keys: ${Object.keys(data ?? {}).sort().join(", ")}`);
    console.log(JSON.stringify(data, null, 2).slice(0, 2000));
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      account: { type: "string" },
      "observed-tag": { type: "string", multiple: true, default: [] },
      "skip-tag": { type: "string", multiple: true, default: [] },
      "min-duration": { type: "string" },
      probe: { type: "boolean", default: false },
    },
  });
  const limit = values.limit ? Number(values.limit) : undefined;
  const minSeconds =
    values["min-duration"] !== undefined ? Number(values["min-duration"]) : DEFAULT_MIN_SECONDS;

  let accounts = loadAccounts("POCKET_", "POCKET_KEY_PERSONAL=pk_...");
  if (values.account) {
    const key = values.account.toLowerCase();
    if (!accounts.has(key)) {
      fail(`No such account '${values.account}'. Found: ${[...accounts.keys()].join(", ")}`);
    }
    accounts = new Map([[key, accounts.get(key)!]]);
  }

  if (values.probe) return probe(accounts);

  const tags = values["observed-tag"].length ? values["observed-tag"] : DEFAULT_OBSERVED_TAGS;
  const observedTags = new Set(tags.map((t) => t.toLowerCase()));
  const skipTags = new Set(
    (values["skip-tag"].length ? values["skip-tag"] : DEFAULT_SKIP_TAGS).map((t) => t.toLowerCase()),
  );
  const state: SyncState = loadState(STATE_FILE);
  rebuildFromDisk(state, "pocket_id");

  const synced: string[] = [];
  const observed: string[] = [];
  const triage: string[] = [];
  let skipped = 0;

  for (const [account, token] of accounts) {
    const acct = (state.accounts[account] ??= {});
    const since = values.since ?? acct.last_sync;
    const runStarted = new Date().toISOString().replace(/\.\d+Z$/, "Z");

    const recordings: Json[] = [];
    for (let page = 1; ; page++) {
      const params: Record<string, string | number> = { page, limit: 100 };
      if (since) params["start_date"] = since.slice(0, 10);
      if (values.until) params["end_date"] = values.until.slice(0, 10);
      const { body } = await listPage(token, params);
      const batch = unwrap(body);
      recordings.push(...((Array.isArray(batch) ? batch : batch ? [batch] : []) as Json[]));
      if (limit && recordings.length >= limit) break;
      if (!body?.pagination?.has_more) break;
      await sleep(REQUEST_GAP_MS);
    }
    const todo = limit ? recordings.slice(0, limit) : recordings;
    console.log(`[${account}] ${todo.length} recording(s) since ${since ?? "the beginning"}`);

    for (const rec of todo) {
      const id = String(first(rec, ID_KEYS, ""));
      const title = String(first(rec, TITLE_KEYS, id));
      if (!id) {
        console.log(`  skip (no id): ${title}`);
        continue;
      }
      if (acct.seen_ids?.includes(id)) {
        console.log(`  skip (already synced): ${title}`);
        continue;
      }
      const blocked = [...tagNames(rec)].filter((t) => skipTags.has(t));
      if (blocked.length) {
        // Never fetch or store it. Mark it seen so it isn't reconsidered.
        (acct.seen_ids ??= []).push(id);
        skipped++;
        console.log(`  skip (tagged ${blocked.join(", ")}): ${title}`);
        saveState(STATE_FILE, state);
        continue;
      }
      await sleep(REQUEST_GAP_MS);
      let full: Json;
      try {
        const detail = await get(`/public/recordings/${id}`, token, {
          include_transcript: "true",
          include_summarizations: "true",
        });
        full = { ...rec, ...((unwrap(detail) as Json) ?? {}) };
      } catch (err) {
        console.log(`  FAILED (will retry next run): ${title} — ${(err as Error).message}`);
        continue;
      }
      const recState = String(full["state"] ?? "completed");
      if (recState !== "completed") {
        console.log(`  skip (state: ${recState}, will retry next run): ${title}`);
        continue;
      }
      if (segmentsOf(full).length === 0) {
        // Marked seen — an empty transcript on a *completed* recording means
        // nothing was said, not that it's still processing.
        (acct.seen_ids ??= []).push(id);
        skipped++;
        console.log(`  skip (no speech): ${title}`);
        saveState(STATE_FILE, state);
        continue;
      }
      const capture = classifyCapture(full, observedTags);
      const disposition = classifyDisposition(full, minSeconds);
      const path = writeRecording(full, account, capture, disposition);
      (acct.seen_ids ??= []).push(id);
      synced.push(path);
      if (capture === "observed") observed.push(path);
      if (disposition === "triage") triage.push(path);
      console.log(`  synced [${capture}/${disposition}]: ${relative(path)}`);
      saveState(STATE_FILE, state);
    }
    acct.last_sync = runStarted;
  }

  saveState(STATE_FILE, state);
  console.log(`\n${synced.length} new recording(s) in brain/raw/ — ready to ingest.`);
  if (skipped) console.log(`${skipped} never fetched (skip-tagged).`);
  if (observed.length) {
    console.log(`${observed.length} marked capture: observed (restricted ingest rules apply):`);
    for (const path of observed) console.log(`  - ${relative(path)}`);
  } else if (synced.length) {
    console.log(
      `All marked capture: self. Tag a recording in Pocket (${[...observedTags].join(", ")}) ` +
        "if it was someone else's room.",
    );
  }
  if (triage.length) {
    console.log(`${triage.length} under ${minSeconds}s — triage before extracting:`);
    for (const path of triage) console.log(`  - ${relative(path)}`);
  }
}

await main();
