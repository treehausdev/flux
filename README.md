# flux

A second brain that runs on your conversations.

You already say your best ideas out loud, on calls and in meetings. flux pulls
those transcripts in and has an agent turn them into a linked wiki: one page
per idea, a page for every person, company and project, a running list of what
you owe and what you're waiting on. You never take a note.

It is a folder of markdown, an instruction file, and a few small scripts. The
agent is [Claude Code](https://claude.com/claude-code). The wiki opens in
[Obsidian](https://obsidian.md). There is no app and nothing to host.

Named for the flux capacitor.

## What you get

- **Idea pages.** Each one a single idea in your own words, linked to related
  ideas, with the conversation it came from.
- **Entity pages** for people, organizations and your own ventures: who they
  are, where things stand, and every idea connected to them.
- **Open loops.** One file listing what you owe, what you're waiting on and
  what's scheduled, updated every time new conversations come in.
- **An index and a log**, so you can see what's in there and when it arrived.

## Setup

You need [Node.js](https://nodejs.org) 20 or later, [Claude Code](https://claude.com/claude-code),
and a [Granola](https://granola.ai) account with some recorded meetings.

```sh
git clone https://github.com/treehausdev/flux.git
cd flux
npm install
npm run init
```

`npm run init` creates your vault at `brain/` and a `.env` file.

### 1. Add your Granola key

In the Granola desktop app: **Settings → Connectors → API keys**, and create a
key with the **Personal notes** scope. Put it in `.env`:

```
FLUX_OWNER=YourFirstName
GRANOLA_KEY_PERSONAL=grn_...
```

The word after `GRANOLA_KEY_` is a label that gets recorded on every synced
file. If you have a second Granola account, add `GRANOLA_KEY_WORK=...` and
both will sync.

### 2. Tell it who you are

Open `brain/CONTEXT.md` and fill it in: what you do, your projects, the people
you work with most, and anything that must never be filed. Ten minutes here
makes every page better.

### 3. Pull your transcripts

```sh
npm run sync:granola
```

Your meetings land in `brain/raw/granola/` as markdown. To start smaller, pass
a date: `npm run sync:granola -- --since 2026-01-01`.

### 4. Ingest

Open this folder in Claude Code and say:

```
ingest
```

The agent lists what's waiting, asks you once about anything it's unsure of,
then reads each transcript and writes the pages. The first run takes a while
if you have a lot of meetings. Start with a handful and read what it produces.

### 5. Read it

Open `brain/` as a vault in Obsidian. Start with `index.md` and `TODO.md`.

After that, the routine is `npm run sync:granola`, then "ingest", whenever you
want it current.

## Asking it things

In Claude Code, in this folder:

- "What did we decide about pricing?"
- "What do I owe people this week?"
- "What has Ada said about hiring?"
- "Lint the wiki" to find contradictions, stale claims and orphan pages.

Answers cite the pages they came from.

## Keeping your vault private and backed up

`brain/` is ignored by this repository. Nothing in it can be committed here by
accident. Back it up as its own **private** repository:

```sh
cd brain
git init
git add -A && git commit -m "Start"
gh repo create my-brain --private --source . --push
```

Your notes then live in one private repo, and the engine in this public one.
To update the engine later: `git pull` in the outer folder.

## How it decides what to keep

The rules are in [`CLAUDE.md`](./CLAUDE.md), which is the whole system. Read
it, and change it to suit you. The ones that matter most:

- **One idea per page**, in your voice, with its source attached.
- **Triage before reading.** Each transcript is sorted into page-worthy,
  log-only or discard. When torn, it logs and moves on.
- **Ask when being wrong is expensive.** Anything personal, anything with
  people it doesn't recognise, and always before deleting.
- **Rooms you only observed are treated differently.** If you record a
  workshop, it keeps the ideas and attributes them, and never writes an
  assessment of a named person.

## In-person recordings (optional)

flux also syncs [Pocket](https://heypocket.com) recordings: add
`POCKET_KEY_PERSONAL=` to `.env`, run `npm run sync:pocket -- --probe` once to
check the field mapping, then `npm run sync:pocket`. A wearable hears far more
than a meeting recorder, so these go through stricter triage. Tag a recording
`observed` at the source when you were recording other people and not taking part.

## What's in here

```
CLAUDE.md            the schema: every rule the agent follows
scripts/             sync, triage and backfill (TypeScript, no build step)
template/brain/      the empty vault that `npm run init` copies
brain/               your vault (created by init; private; not in this repo)
```

## A note on other people

Your transcripts contain other people's words. flux is built to be careful
with them, but you are responsible for what you record and keep. Tell people
when you're recording, and use `brain/CONTEXT.md` to list what must never be filed.

## License

MIT
