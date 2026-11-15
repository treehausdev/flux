# flux

<p align="left">
  <img src="assets/flux-capacitor.svg" alt="A hand sketch of a flux capacitor: three tubes meeting in a Y inside a box" width="260">
</p>

> “This is what makes time travel possible: the flux capacitor!”
>
> — **Doc Brown**, *Back to the Future* (1985)

A second brain that runs on your conversations.

- **[Skip reading, give this to my agent →](#the-easy-way-give-this-to-your-agent)**
- [What you get](#what-you-get)
- [Setup by hand](#setup-by-hand)
- [Asking it things](#asking-it-things)
- [Keeping it private](#keeping-your-vault-private-and-backed-up)
- [How it decides what to keep](#how-it-decides-what-to-keep)
- [In-person recordings](#in-person-recordings-optional)
- [What's in here](#whats-in-here)

You already say your best ideas out loud, on calls and in meetings. flux pulls
those transcripts in and has an agent turn them into a linked wiki: one page
per idea, a page for every person, company and project, a running list of what
you owe and what you're waiting on. You never take a note.

It is a folder of markdown, an instruction file, and a few small scripts. The
agent is whichever coding agent you already use; it was built with
[Claude Code](https://claude.com/claude-code). The wiki can open in
[Obsidian](https://obsidian.md) if you want. There is no app and nothing to host.

Named for the flux capacitor.

## What you get

- **Idea pages.** Each one a single idea in your own words, linked to related
  ideas, with the conversation it came from.
- **Entity pages** for people, organizations and your own ventures: who they
  are, where things stand, and every idea connected to them.
- **Open loops.** One file listing what you owe, what you're waiting on and
  what's scheduled, updated every time new conversations come in.
- **An index and a log**, so you can see what's in there and when it arrived.

## The easy way: give this to your agent

Open your coding agent in the folder where you keep projects, paste the block
below, and it will walk you through the whole setup. It takes about fifteen
minutes, most of it answering a few questions about yourself.

flux was built and is used with [Claude Code](https://claude.com/claude-code).
Nothing in it is specific to Claude: the rules are in a plain `AGENTS.md`, and
the rest is markdown and a few scripts. So it should work the same in Codex,
Pi, or any agent that can read files and run commands in a folder on your
machine, including their desktop apps. Those haven't been tested yet. If you
try one, tell us how it went.

````text
Set up flux for me. It's a second brain built from my meeting transcripts:
https://github.com/treehausdev/flux

Walk me through it one step at a time, and wait for me at each step that needs me.
Whenever you need a decision or an answer from me, use your ask-the-user or
question tool if you have one, so I can pick from options instead of typing.
Give me sensible choices and always let me write my own answer.

1. Check I have Node.js 20 or later and git. If something is missing, tell me
   how to install it and stop until I have.

2. Clone https://github.com/treehausdev/flux into a folder called flux, run
   `npm install`, then `npm run init`. Read README.md and AGENTS.md in the
   repo before going further. AGENTS.md is the rulebook you'll follow.

3. Granola key. Tell me to open the Granola desktop app, go to Settings ->
   Connectors -> API keys, and create a key with the "Personal notes" scope.
   I'll put it in the .env file myself: do not ask me to paste the key into
   this chat, and never print the contents of .env. Tell me exactly which
   line to edit (GRANOLA_KEY_PERSONAL=) and to set FLUX_OWNER to my first
   name. Wait until I say it's saved.

4. Interview me to fill in brain/CONTEXT.md, using your question tool. Ask
   about one section at a time: who I am and what I do, my projects or
   ventures, the markets I work in, the people I work with most, how I like
   to write, and anything that should never be filed (medical, family, a
   confidential client). Write my answers into the file in my words, then
   show it to me and let me correct it.

5. Run `npm run sync:granola -- --limit 5` so we start with only my five most
   recent meetings. Tell me what came in, by title and date.

6. Ingest those, following AGENTS.md exactly. Triage first, and ask me once,
   up front, about anything you're unsure of. Don't delete anything without
   asking me.

7. When it's done, show me what you made: the idea pages, the people and
   organization pages, and brain/TODO.md. Pick the two best idea pages and
   show them to me in full. Ask me what's wrong with them, and fix it.

8. Help me open the brain/ folder as a vault in Obsidian. If I don't have
   Obsidian, tell me where to get it; it's optional.

9. Back up my vault. Explain that brain/ is private and is not part of the
   flux repo. With my permission, make brain/ its own git repository and
   push it to a new PRIVATE GitHub repo. Check that it's private before you
   push, and tell me the name you used.

10. Finish up:
    a. Tell me the two things I'll do from now on: sync, then say "ingest".
    b. Ask whether I want the rest of my meetings pulled in now.
    c. Recommend that flux keeps itself up to date every hour, and ask me
       whether to set that up. Explain the two halves: an hourly sync is
       cheap and safe; an hourly ingest means you run with nobody to ask, so
       it follows the UNATTENDED RUNS rules in AGENTS.md, files only the
       clear cases and holds the rest for me. Offer three choices: sync and
       ingest hourly, sync hourly and ingest when I ask, or neither.
       Set it up with whatever scheduling you have (scheduled tasks or
       routines if your app has them, otherwise cron or launchd running your
       command-line mode in this folder). Tell me exactly what you created
       and how to turn it off, and run it once now so we both see it work.

Rules for you throughout: keep everything from my vault out of the flux repo's
own files and commits. Don't run more than the five-meeting sync until step 10.
If any step fails, show me the error and what you think it means before trying a fix.
````

The agent does the typing; you answer the questions and paste one API key
into a file. If you'd rather do it by hand, the steps follow.

## Setup by hand

You need [Node.js](https://nodejs.org) 20 or later, a coding agent such as
[Claude Code](https://claude.com/claude-code), and a [Granola](https://granola.ai) account with some recorded meetings.

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

Open this folder in your agent and say:

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

In your agent, in this folder:

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

The rules are in [`AGENTS.md`](./AGENTS.md), which is the whole system. Read
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
AGENTS.md            the schema: every rule the agent follows
CLAUDE.md            one line pointing Claude Code at AGENTS.md
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
