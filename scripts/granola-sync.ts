/**
 * Sync Granola meeting transcripts into brain/raw/ for ingestion.
 *
 * Reads API keys from .env at the repo root. Every line of the form
 * GRANOLA_KEY_<LABEL>=grn_... defines one account; <label> is recorded as the
 * account name on each synced file.
 *
 *   npm run sync:granola
 *   npm run sync:granola -- --limit 5          # cap notes per account
 *   npm run sync:granola -- --since 2026-06-01
 *   npm run sync:granola -- --account personal
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  apiGet, fail, first, loadAccounts, loadState, rebuildFromDisk, relative,
  renderTranscript, REQUEST_GAP_MS, saveState, STATE_DIR, sleep, slugify, uniquePath,
  type SyncState,
} from "./lib.ts";

const API_BASE = "https://public-api.granola.ai/v1";
const STATE_FILE = join(STATE_DIR, "granola.json");

interface Attendee { name?: string; email?: string }
interface Note {
  id: string;
  title?: string;
  created_at?: string;
  web_url?: string;
  attendees?: Attendee[];
  transcript?: unknown[];
}
interface NotesPage { notes?: Note[]; hasMore?: boolean; cursor?: string }

/** Same meeting synced from two accounts has different ids — dedupe on
 *  title + start time to the minute. */
function fingerprint(note: Note): string {
  return `${(note.title ?? "").trim().toLowerCase()}|${(note.created_at ?? "").slice(0, 16)}`;
}

async function listAllNotes(token: string, since: string | undefined, limit?: number) {
  const notes: Note[] = [];
  let cursor: string | undefined;
  for (;;) {
    const params: Record<string, string | number> = { page_size: 30 };
    if (since) params["updated_after"] = since;
    if (cursor) params["cursor"] = cursor;
    const page = await apiGet<NotesPage>(`${API_BASE}/notes`, token, params);
    notes.push(...(page?.notes ?? []));
    if (limit && notes.length >= limit) return notes.slice(0, limit);
    if (!page?.hasMore || !page.cursor) return notes;
    cursor = page.cursor;
    await sleep(REQUEST_GAP_MS);
  }
}

function writeNote(note: Note, account: string): string {
  const date = (note.created_at ?? "").slice(0, 10);
  const path = uniquePath(`${date}-${slugify(note.title)}`, `granola_id: ${note.id}`, "granola");
  const attendees = (note.attendees ?? [])
    .map((a) => a.name ?? a.email ?? "?")
    .join(", ");
  const front = [
    "---",
    `granola_id: ${note.id}`,
    `account: ${account}`,
    `title: ${JSON.stringify(note.title ?? "Untitled")}`,
    `date: ${note.created_at ?? ""}`,
    `attendees: ${JSON.stringify(attendees)}`,
    `web_url: ${note.web_url ?? ""}`,
    "source: granola",
    "medium: call",
    "capture: self",
    "type: transcript",
    "---",
    "",
  ].join("\n");
  const body = renderTranscript(
    note.transcript ?? [],
    (seg) => {
      const sp = (seg["speaker"] ?? {}) as Record<string, string>;
      return sp["name"] || sp["diarization_label"] || sp["source"] || "Unknown";
    },
    (seg) => String(seg["text"] ?? ""),
  );
  writeFileSync(path, `${front}${body}\n`);
  return path;
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      since: { type: "string" },
      account: { type: "string" },
    },
  });
  const limit = values.limit ? Number(values.limit) : undefined;

  let accounts = loadAccounts("GRANOLA_", "GRANOLA_KEY_PERSONAL=grn_...");
  if (values.account) {
    const key = values.account.toLowerCase();
    if (!accounts.has(key)) {
      fail(`No such account '${values.account}'. Found: ${[...accounts.keys()].join(", ")}`);
    }
    accounts = new Map([[key, accounts.get(key)!]]);
  }

  const state: SyncState = loadState(STATE_FILE);
  const fingerprints = new Set(state.fingerprints ?? []);
  rebuildFromDisk(state, "granola_id", (front) => {
    if (front["title"]) {
      fingerprints.add(`${front["title"].toLowerCase()}|${(front["date"] ?? "").slice(0, 16)}`);
    }
  });

  const synced: string[] = [];
  const failedAccounts: string[] = [];
  for (const [account, token] of accounts) {
    const acct = (state.accounts[account] ??= {});
    const since = values.since ?? acct.last_sync;
    const runStarted = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    let notes: Note[];
    try {
      notes = await listAllNotes(token, since, limit);
    } catch (err) {
      console.log(`[${account}] FAILED to list notes — ${(err as Error).message} (check GRANOLA_${account.toUpperCase()} in .env)`);
      failedAccounts.push(account);
      continue;
    }
    console.log(`[${account}] ${notes.length} note(s) since ${since ?? "the beginning"}`);

    for (const note of notes) {
      const fp = fingerprint(note);
      if (acct.seen_ids?.includes(note.id) || fingerprints.has(fp)) {
        console.log(`  skip (already synced): ${note.title}`);
        continue;
      }
      await sleep(REQUEST_GAP_MS);
      let full: Note | null;
      try {
        full = await apiGet<Note>(`${API_BASE}/notes/${note.id}`, token, { include: "transcript" });
      } catch (err) {
        console.log(`  FAILED (will retry next run): ${note.title} — ${(err as Error).message}`);
        continue;
      }
      if (!full) {
        console.log(`  skip (still processing): ${note.title}`);
        continue;
      }
      const path = writeNote(full, account);
      (acct.seen_ids ??= []).push(note.id);
      fingerprints.add(fp);
      synced.push(path);
      console.log(`  synced: ${relative(path)}`);
      state.fingerprints = [...fingerprints].sort();
      saveState(STATE_FILE, state);
    }
    acct.last_sync = runStarted;
  }

  state.fingerprints = [...fingerprints].sort();
  saveState(STATE_FILE, state);
  console.log(`\n${synced.length} new transcript(s) in brain/raw/ — ready to ingest.`);
  if (failedAccounts.length) {
    console.log(`Accounts that failed: ${failedAccounts.join(", ")} — their last_sync was not advanced.`);
  }
}

await main();
