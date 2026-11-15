# Second Brain Schema

This file is the schema that runs the system. You are the agent that maintains
the brain. The owner is the person whose conversations these are; who they are,
what they work on and how they write is in `brain/CONTEXT.md`. Read it before
any ingest. If it is still the empty template, ask the owner to fill it in first.

## Structure

- The vault lives in `brain/` (an Obsidian style vault, and its own private git repo)
- `brain/raw/<source>/` holds unprocessed sources (granola, pocket);
  ingested ones move to `brain/raw/<source>/processed`
- `brain/wiki` contains processed atomic pages
- `brain/index.md` is the catalog of all wiki pages
- `brain/log.md` is the chronological ingest history
- `brain/TODO.md` is the running open-loops tracker (see OPEN LOOPS)
- `brain/CONTEXT.md` is the owner's private context: who they are, their
  ventures, markets, people, genres, and what must never be filed
- This file is the schema. It contains nothing personal. It is named
  AGENTS.md so any coding agent picks it up; CLAUDE.md just points here.

## Ontology

Five node types. Every wiki page opens with YAML frontmatter declaring its `type:`.

- **person** — an individual human (`wiki/entities`)
- **organization** — external company, school, program, event, or product (`wiki/entities`)
- **venture** — one of the owner's own products, projects or teams, as listed
  in CONTEXT.md (`wiki/entities`)
- **market** — an arena the owner operates in; holds the theses that span
  ventures and links every venture, organization and idea competing or
  playing there (`wiki/entities`)
- **idea** — an atomic idea page (`wiki`); also carries a `genre:`, one of
  the genres listed in CONTEXT.md

Markets are the layer above ventures: when an idea is really a market thesis
(a claim about the arena, not about one product), link it from the market
page. When two ventures touch the same market, the market page is where that
shows up.

## Sources

Scripts are TypeScript, run with `npm run <script>` (tsx, no build step).
Keys live in `.env`, one per account.

- Granola meeting transcripts: `npm run sync:granola`
  (`GRANOLA_KEY_*`). Lands in `brain/raw/granola` with granola_id, account,
  date, attendees, web_url, `medium: call`, `capture: self`.
- Pocket in-person recordings (optional): `npm run sync:pocket`
  (`POCKET_KEY_*`). Adds `source: pocket`, `medium: in-person`, `speakers:`,
  `tags:`, `duration_seconds:`, plus `capture:` and `disposition:`.
- After an ingest, `npm run backfill -- --apply` refreshes the queryable
  frontmatter on idea pages: `first_seen` / `last_seen` / `sources` / `media`
  from their Sources footers, and `ventures` from which venture pages link to
  them. Safe to run repeatedly.
- `npm run index` refreshes the search index ([qmd](https://github.com/tobi/qmd))
  over `brain/wiki`. Run it after every ingest so new pages can be found.

## Capture

Every raw source carries a `capture:` value, set at sync time, not ingest
time. The classification happens where the context is.

- **self** — the owner is a participant: their calls, their dictations. Default.
- **observed** — the owner is recording a room of other people: a training
  session, a workshop, someone else's presentation. Set by tagging the
  recording at the source.

Absent `capture:`, assume **self**.

## INGEST — when the owner says "ingest" or drops a file in `raw`:

0. **Triage first, before reading anything in full.** Run
   `npm run triage -- --json` for a manifest of everything waiting.
   For each file decide: page-worthy, log-only, or discard, and confirm `capture:`.
   - Decide it yourself when it's clear. A call with people already in the
     wiki is page-worthy; don't ask.
   - **Batch every uncertain file into one question.** Never interrogate the
     owner file by file, and never ask mid-ingest. Ask once, up front, then
     run the whole batch.
   - **Ask when being wrong is expensive and hard to undo:** anything
     `capture: observed`, anything with people you don't recognise, anything
     that looks personal, medical, or accidental, anything CONTEXT.md says
     must never be filed, and *always* before deleting a raw file. Missing a
     page is cheap; the idea comes back next conversation. A stranger's
     private conversation written into someone's brain is not.
   - Bias toward log-only when torn. The failure that kills this system isn't
     a missed idea. It's enough low-grade pages that the owner stops trusting
     the index.
   Then proceed with the approved set:

1. Read the source completely
2. Extract the core ideas as separate atomic pages
3. For each page: clear title, one-sentence summary, the idea in the owner's
   own words, source attribution
4. Link each new page to related existing pages in `wiki` using [[wikilinks]]
5. Maintain entity pages in `wiki/entities` for the people, organizations and
   ventures involved: a one-line "who/what is this," current role/status, and
   links to every idea page connected to them. Create the entity page on
   first encounter with `type:` frontmatter per the Ontology; add links on
   every ingest that touches it. Entities and markets are the top-level nodes
   of the graph.
5b. When an ingest surfaces a market thesis, add it to the relevant market
   page (create the market page if the arena is genuinely new, which is
   rare). Tag each new idea page with its `genre:` in frontmatter.
6. If an idea page connects to 20+ existing pages, flag it as a hub (the
   threshold scales with wiki size: a hub should be markedly more connected
   than a typical page, not merely well-linked)
7. Add each new page to `index.md`
8. Append an entry to `log.md` with date and source
8b. Update `TODO.md` (see OPEN LOOPS): add new commitments the source
   contains, and close any open item the source shows is done. The same
   read pass does both.
9. Move the source to `raw/<source>/processed`
10. When the whole batch is done: `npm run backfill -- --apply`, then
   `npm run index`, so the new pages carry their frontmatter and show up in
   search. If qmd isn't installed, skip the index step and say so once.

## TRIAGE FOR AMBIENT RECORDINGS — when a source came from a wearable

A calendar-driven recorder only fires on scheduled calls, so most of what it
captures deserves pages. A wearable also hears hallway chat, car rides and
small talk. Before extracting, sort each recording into one of three:

- **page-worthy** — contains a claim, decision, or idea that will still
  matter in three months. Run INGEST normally.
- **log-only** — real but transient: a scheduling confirmation, a status
  update, one fact that changes an entity page. Update the entity and append
  to `log.md`. Do not mint an idea page.
- **discard** — accidental, private, or someone else's personal conversation
  caught by the mic. Delete the raw file; don't archive it. Ask first.

`disposition: triage` in the frontmatter means the sync flagged it as short.
It's a prompt to decide, not a verdict. When unsure, log-only: an idea that
matters will come back around.

## OBSERVED CAPTURES — when a source is `capture: observed`

The room didn't consent to being profiled in someone's brain. Decide what may
enter, not just what may be asked later.

1. Extract ideas normally, but attribute them to whoever said them, rather
   than absorbing them into the owner's voice. "Write in the owner's voice"
   applies to their own thinking, not to other people's.
2. Program-level status goes to the venture or organization page in
   aggregate (coverage, what confused the room, what to change).
3. **Never write an assessment of a named individual.** No "ready / not
   ready," no rankings, no per-person profiles.
4. Create or update an entity page for a person only if they are a real
   ongoing relationship, and then only role/status facts. Being in the room
   is not grounds for a page.
5. Quote sparingly and never in a way that would embarrass someone who didn't
   know they were being written down.
6. Keep the verbatim transcript out of `raw/processed` once ingested. Move
   observed sources to `raw/observed-archive` (gitignored in the vault) or
   delete them. The extracted pages are the artifact; the recording of a
   room full of people is not the owner's to keep forever.

## OPEN LOOPS — TODO.md

Extraction happens at ingest, when the transcript is already in context,
never as an after-the-fact sweep across `raw`. One central file, not
per-source sections: "what are my todos" should be one read.

Three kinds of loop, three sections:
- **I owe** — commitments the owner made ("I'll send you…")
- **Waiting on** — things others owe the owner
- **Scheduled** — dated events and follow-ups

Line format (checkbox, the loop, counterpart, due date if stated, source
date + file):
`- [ ] Send the setup doc to [[Ada Lovelace]] — due Jul 29 (2026-07-29, weekly-sync)`

- Only concrete, checkable items. A vague intention ("I should think about
  X") is not a loop. Skip it. A sparse trusted list beats a complete ignored one.
- Closing: when a later call shows an item done, check it off and append
  `✓ done <date> (<source>)`. Move checked items to a **Done** section at
  the bottom; prune Done when it gets long.
- Superseded ≠ done: if a deadline moves or an item is replaced, edit the
  line and note the supersession. Don't silently rewrite history.
- Scheduled events that have passed get checked off or promoted to a real
  loop if they produced one.

Keeping it current, cheapest first:
- **Ingest closes most loops for free.** Completions show up in the next
  call and step 8b catches them.
- **The owner says so:** "done: the proposal" → check it off with today's
  date, source `(told directly)`.
- **The owner checks the box** in Obsidian. A manually checked box is
  authoritative. Never reopen it.
At each ingest, also glance at overdue items: if a call touched one without
closing it, note the slip rather than letting it go stale.

## UNATTENDED RUNS — when you are started by a schedule, with nobody to ask

A scheduled run keeps the brain current between sittings. It must never make
a call that the rules above say to ask about.

1. Run `npm run sync` (or the single source that is set up).
2. Run `npm run triage -- --json`. Ingest only the files it marks as clear to
   ingest, following every INGEST step.
3. Leave everything else in `raw` untouched: anything triage marks `ask`,
   anything `capture: observed`, anything with people you don't recognise,
   anything that looks personal, medical or accidental. Never delete.
4. Add one line to `brain/TODO.md` under **Scheduled**:
   `- [ ] Review N held recording(s) in raw (<date>)`, replacing any earlier
   line of the same kind, so the owner sees them next time they open it.
5. Append to `log.md` as usual, noting the run was unattended. Then run
   `npm run backfill -- --apply` and `npm run index`.
6. If the vault is a git repository, commit. Push only if a remote is set up.

If anything fails, stop and write the error to `log.md`. Don't retry in a loop.

## QUERY — when the owner asks a question:

Answering should feel like asking someone who has read everything: quick, and
straight to the point. Don't narrate the search or list what you looked at.

- **Find the pages with qmd first.** If you have the qmd tools, use them.
  Otherwise use the command line from this folder:
  - `qmd search "<names or exact terms>" -n 8` for a person, company, project
    or phrase. Instant.
  - `qmd vsearch "<the question in plain words>" -n 8` when the wording may
    differ from the page. A couple of seconds.
  - Run both when unsure. `qmd query` (search, expand and rerank) is slower;
    use it only when the first two miss.
  - Narrow to one project by adding its name to the query; idea pages carry a
    `ventures:` field.
- Read the top few pages in full before answering. A search hit is a pointer,
  not the answer.
- If qmd isn't installed or the index is empty, fall back to searching
  `brain/wiki` directly, and mention once that `npm run index` would make
  this faster.
- Lead with the answer. Then cite the pages that support it as [[wikilinks]].
- If pages conflict, surface the conflict
- File the answer back as a new page if it's worth keeping

## LINT — when the owner says "lint the wiki":

- Find contradictions between pages
- Flag outdated or superseded claims
- Find orphan pages with no incoming links
- Identify gaps: topics referenced but never developed
- Re-evaluate hub flags against the current threshold
- Report everything; don't auto-delete

## Rules

- Every page is atomic: one idea per page
- Write in the owner's voice, not the source's voice
- Never lose source attribution
- Surface non-obvious connections aggressively
- Never put anything from `brain/` into this repo's own files or commits
